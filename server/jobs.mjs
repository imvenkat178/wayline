import { randomUUID } from "node:crypto";

// R05: a lease alone (leased_until/leased_by) tells a second drain when it's ALLOWED to reclaim
// an abandoned job, but it does nothing to stop the FIRST, still-running handler from later
// calling completeJob/failJob on a job that has since been reclaimed and possibly already
// completed by someone else -- exactly the review's reproduction (the same job executing twice
// concurrently in one process because a slow handler outlived its lease while a later drain
// reclaimed it). lease_token closes that: claimDueJobs mints a fresh one on every claim, and
// completeJob/failJob only take effect `WHERE lease_token=?` -- so a completion/failure call
// carrying a stale token (the caller's own claim has since been superseded) safely does nothing,
// rather than corrupting whatever the newer claim is doing.

// A durable job/outbox queue (roadmap: "Durable background processing"). A single in-process
// worker draining this table on a timer (see server.mjs) remains an accepted pilot-scale
// constraint -- the same one already documented in guardian.mjs -- but unlike a bare
// `setInterval` calling a function directly, work tracked here survives a restart: a lease that
// isn't renewed before it expires is reclaimed by the next drain instead of silently vanishing
// mid-run, and a job that keeps failing backs off (recurring jobs) or is dead-lettered (one-shot
// jobs, after `max_attempts`) instead of wedging the queue or retrying forever. This does not
// attempt cross-worker leases beyond what a single process needs to survive its own restarts --
// multiple concurrent workers sharing one SQLite file is out of scope for a pilot, per the
// roadmap's own guidance, and would need a different database engine first.

export const DEFAULT_LEASE_MS = 60000;
const MAX_BACKOFF_MS = 5 * 60000;

// See store.mjs's identical helper -- duplicated rather than imported so this module keeps its
// existing boundary of depending only on the `store` object passed into each function, never on
// store.mjs's module itself.
function isUniqueViolation(e) {
  return e?.errcode === 2067 || /UNIQUE constraint failed/i.test(e?.message ?? "");
}

function backoffMs(attempts) {
  const base = Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS);
  return base + Math.floor(Math.random() * Math.min(1000, base));
}

// Enqueues a one-shot job. Safe to call inside the same transaction as the write that should
// trigger it (the "outbox" half of the pattern): both commit together, or neither does.
//
// R06: a "push-deliver" job has a real database constraint -- one row per (alertId,
// subscriptionId) pair (see store.mjs's migrateJobsColumns). Losing that race is not an error:
// it means guardian.mjs already enqueued this exact delivery (a retried transaction, or the
// startup orphan-reconciliation pass re-checking an alert that already has one), so this
// returns the existing job's id instead of throwing.
export function enqueueJob(
  store,
  kind,
  payload = {},
  { runAt, maxAttempts = 8, id = randomUUID(), userId = null } = {},
) {
  const now = Date.now();
  try {
    store.db
      .prepare(
        `INSERT INTO jobs(id,kind,payload,status,attempts,max_attempts,interval_ms,run_at,created_at,updated_at,user_id)
         VALUES(?,?,?,'pending',0,?,NULL,?,?,?,?)`,
      )
      .run(id, kind, JSON.stringify(payload), maxAttempts, runAt ?? now, now, now, userId);
  } catch (e) {
    if (isUniqueViolation(e)) {
      const existing = store.db
        .prepare(
          "SELECT id FROM jobs WHERE kind=? AND json_extract(payload,'$.alertId')=? AND json_extract(payload,'$.subscriptionId')=?",
        )
        .get(kind, payload.alertId ?? null, payload.subscriptionId ?? null);
      if (existing) return existing.id;
    }
    throw e;
  }
  return id;
}

// Seeds a recurring job (one persistent row per kind, re-scheduled on every completion instead
// of spawning a new row) if it doesn't already exist. Safe to call on every server startup: the
// partial unique index on jobs(kind) WHERE interval_ms IS NOT NULL rejects a second row for the
// same recurring kind, which this treats as "already seeded," not an error.
export function ensureRecurringJob(store, kind, payload, intervalMs, now = Date.now()) {
  const existing = store.db
    .prepare("SELECT id FROM jobs WHERE kind=? AND interval_ms IS NOT NULL")
    .get(kind);
  if (existing) return existing.id;
  const id = randomUUID();
  try {
    store.db
      .prepare(
        `INSERT INTO jobs(id,kind,payload,status,attempts,max_attempts,interval_ms,run_at,created_at,updated_at)
         VALUES(?,?,?,'pending',0,999999,?,?,?,?)`,
      )
      .run(id, kind, JSON.stringify(payload), intervalMs, now, now, now);
  } catch {
    // Lost a race with another call to ensureRecurringJob for the same kind (the unique index
    // rejected it) -- the row exists either way, which is all this function promises.
    return store.db
      .prepare("SELECT id FROM jobs WHERE kind=? AND interval_ms IS NOT NULL")
      .get(kind).id;
  }
  return id;
}

// Claims every due job (pending and ready, or leased but its lease expired -- i.e. abandoned by
// an interrupted run) up to `limit`, atomically marking each leased so a concurrent call cannot
// claim the same row twice.
export function claimDueJobs(store, { limit = 10, now = Date.now(), workerId = "single" } = {}) {
  return store.transaction(() => {
    const rows = store.db
      .prepare(
        `SELECT * FROM jobs
         WHERE (status='pending' AND run_at<=?) OR (status='leased' AND leased_until<?)
         ORDER BY run_at ASC LIMIT ?`,
      )
      .all(now, now, limit);
    const leasedUntil = now + DEFAULT_LEASE_MS;
    const claimed = [];
    for (const row of rows) {
      const leaseToken = randomUUID();
      store.db
        .prepare(
          "UPDATE jobs SET status='leased',leased_until=?,leased_by=?,lease_token=?,updated_at=? WHERE id=?",
        )
        .run(leasedUntil, workerId, leaseToken, now, row.id);
      claimed.push({ ...row, lease_token: leaseToken });
    }
    return claimed.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  });
}

// A recurring job never goes 'done' -- it reschedules itself for `interval_ms` from now with a
// clean attempt count, so one row represents "the next run" for the life of the process.
//
// Returns true if this call's lease_token still matched (i.e. it actually took effect) and false
// if it was stale -- the job had already been reclaimed by a newer claim (R05), so this call's
// own, presumably-abandoned work is silently dropped instead of clobbering whatever the current
// claim is doing.
export function completeJob(store, job, now = Date.now()) {
  const result = job.interval_ms
    ? store.db
        .prepare(
          "UPDATE jobs SET status='pending',attempts=0,run_at=?,leased_until=NULL,leased_by=NULL,lease_token=NULL,last_error=NULL,updated_at=? WHERE id=? AND lease_token=?",
        )
        .run(now + job.interval_ms, now, job.id, job.lease_token)
    : store.db
        .prepare(
          "UPDATE jobs SET status='done',leased_until=NULL,lease_token=NULL,updated_at=? WHERE id=? AND lease_token=?",
        )
        .run(now, job.id, job.lease_token);
  return result.changes === 1;
}

// A recurring job is never dead-lettered -- guardian-sweep (and anything else recurring) must
// keep trying, capped at MAX_BACKOFF_MS between attempts, since there is no later "resubmit" for
// a periodic task the way there is for a one-shot notification. A one-shot job is dead-lettered
// once max_attempts is reached, so a permanently-broken delivery (e.g. an unreachable push
// subscription) stops retrying forever instead of clogging the queue.
//
// Same lease_token guard and return value as completeJob above: a stale caller's failure report
// is dropped rather than overwriting a newer claim's attempts/backoff state (R05).
export function failJob(store, job, error, now = Date.now()) {
  const attempts = job.attempts + 1;
  const message = String(error?.message ?? error).slice(0, 500);
  const result =
    !job.interval_ms && attempts >= job.max_attempts
      ? store.db
          .prepare(
            "UPDATE jobs SET status='dead',attempts=?,last_error=?,leased_until=NULL,lease_token=NULL,updated_at=? WHERE id=? AND lease_token=?",
          )
          .run(attempts, message, now, job.id, job.lease_token)
      : store.db
          .prepare(
            "UPDATE jobs SET status='pending',attempts=?,run_at=?,last_error=?,leased_until=NULL,lease_token=NULL,updated_at=? WHERE id=? AND lease_token=?",
          )
          .run(attempts, now + backoffMs(attempts), message, now, job.id, job.lease_token);
  return result.changes === 1;
}

// Gives a handler no more wall-clock time than its own lease (minus a safety margin): a handler
// that's still running when its lease is about to be considered abandoned is exactly the
// situation R05's fix is closing, so this call gives up on it here -- cleanly, with a normal
// failJob backoff -- rather than let it run indefinitely and rely solely on a future drain's
// reclaim. This does NOT cancel the underlying work (JS has no way to force that on an arbitrary
// promise); a handler with a stalled transport of its own should still set its own timeout, as
// sendPush does (see push.mjs) -- this is a backstop for a handler kind that doesn't.
const HANDLER_DEADLINE_MS = DEFAULT_LEASE_MS - 5000;
function withDeadline(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Drains every currently-due job through `handlers` (a { kind: (store, payload, job) => any }
// map). A job whose kind has no registered handler fails like any other error -- it does not
// throw out of processJobs and abort the rest of the batch.
export async function processJobs(store, handlers, options = {}) {
  const now = options.now ?? Date.now();
  // Configurable purely so tests can exercise a hung handler's deadline on a short, real wait
  // instead of the real ~55s default.
  const handlerDeadlineMs = options.handlerDeadlineMs ?? HANDLER_DEADLINE_MS;
  const jobs = claimDueJobs(store, { ...options, now });
  const results = [];
  for (const job of jobs) {
    try {
      const handler = handlers[job.kind];
      if (!handler) throw new Error(`No handler registered for job kind "${job.kind}".`);
      await withDeadline(
        handler(store, job.payload, job),
        handlerDeadlineMs,
        `Handler for job kind "${job.kind}" exceeded its lease.`,
      );
      completeJob(store, job, now);
      results.push({ id: job.id, kind: job.kind, ok: true });
    } catch (e) {
      failJob(store, job, e, now);
      results.push({ id: job.id, kind: job.kind, ok: false, error: String(e?.message ?? e) });
    }
  }
  return results;
}
