import { randomUUID } from "node:crypto";

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

function backoffMs(attempts) {
  const base = Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS);
  return base + Math.floor(Math.random() * Math.min(1000, base));
}

// Enqueues a one-shot job. Safe to call inside the same transaction as the write that should
// trigger it (the "outbox" half of the pattern): both commit together, or neither does.
export function enqueueJob(
  store,
  kind,
  payload = {},
  { runAt, maxAttempts = 8, id = randomUUID() } = {},
) {
  const now = Date.now();
  store.db
    .prepare(
      `INSERT INTO jobs(id,kind,payload,status,attempts,max_attempts,interval_ms,run_at,created_at,updated_at)
       VALUES(?,?,?,'pending',0,?,NULL,?,?,?)`,
    )
    .run(id, kind, JSON.stringify(payload), maxAttempts, runAt ?? now, now, now);
  return id;
}

// Seeds a recurring job (one persistent row per kind, re-scheduled on every completion instead
// of spawning a new row) if it doesn't already exist. Safe to call on every server startup: the
// partial unique index on jobs(kind) WHERE interval_ms IS NOT NULL rejects a second row for the
// same recurring kind, which this treats as "already seeded," not an error.
export function ensureRecurringJob(store, kind, payload, intervalMs) {
  const existing = store.db
    .prepare("SELECT id FROM jobs WHERE kind=? AND interval_ms IS NOT NULL")
    .get(kind);
  if (existing) return existing.id;
  const now = Date.now();
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
    for (const row of rows) {
      store.db
        .prepare(
          "UPDATE jobs SET status='leased',leased_until=?,leased_by=?,updated_at=? WHERE id=?",
        )
        .run(leasedUntil, workerId, now, row.id);
    }
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  });
}

// A recurring job never goes 'done' -- it reschedules itself for `interval_ms` from now with a
// clean attempt count, so one row represents "the next run" for the life of the process.
export function completeJob(store, job, now = Date.now()) {
  if (job.interval_ms) {
    store.db
      .prepare(
        "UPDATE jobs SET status='pending',attempts=0,run_at=?,leased_until=NULL,leased_by=NULL,last_error=NULL,updated_at=? WHERE id=?",
      )
      .run(now + job.interval_ms, now, job.id);
  } else {
    store.db
      .prepare("UPDATE jobs SET status='done',leased_until=NULL,updated_at=? WHERE id=?")
      .run(now, job.id);
  }
}

// A recurring job is never dead-lettered -- guardian-sweep (and anything else recurring) must
// keep trying, capped at MAX_BACKOFF_MS between attempts, since there is no later "resubmit" for
// a periodic task the way there is for a one-shot notification. A one-shot job is dead-lettered
// once max_attempts is reached, so a permanently-broken delivery (e.g. an unreachable push
// subscription) stops retrying forever instead of clogging the queue.
export function failJob(store, job, error, now = Date.now()) {
  const attempts = job.attempts + 1;
  const message = String(error?.message ?? error).slice(0, 500);
  if (!job.interval_ms && attempts >= job.max_attempts) {
    store.db
      .prepare(
        "UPDATE jobs SET status='dead',attempts=?,last_error=?,leased_until=NULL,updated_at=? WHERE id=?",
      )
      .run(attempts, message, now, job.id);
    return;
  }
  store.db
    .prepare(
      "UPDATE jobs SET status='pending',attempts=?,run_at=?,last_error=?,leased_until=NULL,updated_at=? WHERE id=?",
    )
    .run(attempts, now + backoffMs(attempts), message, now, job.id);
}

// Drains every currently-due job through `handlers` (a { kind: (store, payload, job) => any }
// map). A job whose kind has no registered handler fails like any other error -- it does not
// throw out of processJobs and abort the rest of the batch.
export async function processJobs(store, handlers, options = {}) {
  const now = options.now ?? Date.now();
  const jobs = claimDueJobs(store, { ...options, now });
  const results = [];
  for (const job of jobs) {
    try {
      const handler = handlers[job.kind];
      if (!handler) throw new Error(`No handler registered for job kind "${job.kind}".`);
      await handler(store, job.payload, job);
      completeJob(store, job, now);
      results.push({ id: job.id, kind: job.kind, ok: true });
    } catch (e) {
      failJob(store, job, e, now);
      results.push({ id: job.id, kind: job.kind, ok: false, error: String(e?.message ?? e) });
    }
  }
  return results;
}
