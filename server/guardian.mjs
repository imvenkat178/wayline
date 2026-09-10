import { digitalTwin, preferences } from "./domain/journeys.mjs";
import { fanOutPush } from "./push.mjs";
import { hashToken } from "./store.mjs";

// A single in-process 30s timer sweeping every account (see server.mjs) is an accepted
// pilot-scale constraint -- it is not leased or distributed across workers, and a crash
// mid-sweep simply picks back up next tick because `add()` below is idempotent on
// `dedupeKey`. Building a persisted, leased job queue is later-stage architectural work,
// not a pilot fix. What must not happen at ANY scale, though, is silently dropping
// accounts past a fixed page size: that was the previous bug (`LIMIT 1000`, no
// continuation, so the 1001st account was never evaluated by the periodic sweep, ever).
// This scans by keyset pagination over `records.user_id` instead, so a full sweep always
// reaches every account that has a journey, commute, or pass on file, however many there
// are, and skips accounts with nothing to evaluate rather than loading every registered
// user up front.
export const GUARDIAN_SCAN_BATCH_SIZE = 500;

function* scanOwners(store, batchSize) {
  let cursor = "";
  for (;;) {
    const rows = store.db
      .prepare(
        `SELECT DISTINCT user_id AS id FROM records
         WHERE kind IN ('journey','commute','pass') AND user_id > ?
         ORDER BY user_id LIMIT ?`,
      )
      .all(cursor, batchSize);
    if (rows.length === 0) return;
    for (const row of rows) yield row;
    if (rows.length < batchSize) return;
    cursor = rows[rows.length - 1].id;
  }
}

/** Restart-safe, per-recipient deduplication. It never buys, rebooks, or sends external messages. */
export function runGuardian(
  store,
  onlyUser,
  now = Date.now(),
  batchSize = GUARDIAN_SCAN_BATCH_SIZE,
) {
  const owners = onlyUser ? [{ id: onlyUser }] : scanOwners(store, batchSize);
  for (const { id: userId } of owners) {
    const user = store.user(userId);
    if (!user) continue;
    const p = preferences(user.preferences);
    const prior = new Set(store.list(userId, "alert").map((a) => a.dedupeKey));
    // R06: creating the alert record and enqueueing its push-delivery jobs must commit
    // together. Before this fix they were two separate, un-transacted writes -- a crash or DB
    // error between them left a real alert on file with no push ever queued for it, silently
    // (the in-app alert still worked fine, so nothing surfaced the gap), which is exactly what
    // the R06 review reproduced. Wrapping both in one store.transaction() means either both
    // commit or neither does.
    //
    // dedupeHash also gives the alert a real, database-enforced uniqueness constraint (see
    // store.mjs), so a duplicate insert attempt for the same key -- whether from a genuine race
    // between two overlapping sweeps, or from `prior` above missing it because an account has
    // more than 1000 alerts on file (store.list's LIMIT) -- returns the existing row instead of
    // crashing this sweep, and re-running fanOutPush against that existing alert self-heals any
    // push-delivery job that a prior, pre-R06 write left missing (enqueueJob is itself
    // idempotent per (alertId,subscriptionId) -- see jobs.mjs).
    const add = (key, alert) => {
      if (prior.has(key)) return;
      try {
        store.transaction(() => {
          const created = store.put(
            userId,
            "alert",
            {
              ...alert,
              read: false,
              dedupeKey: key,
              delivery: "in-app",
              at: new Date(now).toISOString(),
            },
            { expiresAt: now + 7 * 86400000, dedupeHash: hashToken(`${userId}:${key}`) },
          );
          // Fan out a durable push-delivery job (see push.mjs) to every device this account has
          // subscribed, for every alert this function actually creates -- never for one that
          // was filtered out above (e.g. an info-severity twin alert with notifyInfo off). A
          // user with no push subscriptions enqueues nothing here.
          fanOutPush(store, userId, created.id);
        });
        prior.add(key);
      } catch (e) {
        // Never let one bad alert (a DB error unrelated to the dedupe race handled above, e.g.
        // a full disk) abort the rest of this sweep -- every other account, and every other
        // alert for this same account, still deserves its own attempt.
        console.error(`Guardian: failed to create/deliver alert "${key}" for user ${userId}:`, e);
      }
    };
    for (const j of store.list(userId, "journey")) {
      if (["ARRIVED", "CANCELLED"].includes(j.state)) continue;
      const twin = digitalTwin(j, { preferences: p });
      for (const alert of twin.alerts)
        if (alert.severity === "critical" || p.notifyInfo)
          add(`${j.id}:${alert.id}`, { ...alert, journeyId: j.id, dataMode: j.dataMode });
      const leave = (Date.parse(twin.leave.leaveAt) - now) / 60000;
      if (leave >= -5 && leave <= 15)
        add(`${j.id}:leave`, {
          journeyId: j.id,
          severity: "warning",
          title: leave <= 0 ? "Time to leave" : "Your departure is coming up",
          body: `Allow ${twin.leave.walkMinutes} minutes to walk and ${twin.leave.boardingBuffer} minutes at the station. Check the operator's current departure.`,
          kind: "leave",
          dataMode: j.dataMode,
        });
      if (
        now > Date.parse(j.arrival) + p.emergencyMinutes * 60000 &&
        store.list(userId, "contact").some((c) => c.consent)
      )
        add(`${j.id}:checkin`, {
          journeyId: j.id,
          severity: "critical",
          title: "Check in with your contact",
          body: "Your recorded arrival time has passed. No emergency message has been sent; contact your chosen person directly.",
          kind: "check-in",
          dataMode: j.dataMode,
        });
    }
    for (const commute of store.list(userId, "commute")) {
      if (!commute.enabled) continue;
      const date = new Intl.DateTimeFormat("en-US", {
        timeZone: commute.timezone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(now);
      const parts = Object.fromEntries(date.map((x) => [x.type, x.value]));
      const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
      const [h, m] = commute.time.split(":").map(Number);
      const minutes = h * 60 + m - ((Number(parts.hour) % 24) * 60 + Number(parts.minute));
      if (commute.days.includes(day) && minutes >= 0 && minutes <= 30) {
        const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: commute.timezone }).format(
          now,
        );
        add(`${commute.id}:${localDate}`, {
          severity: "info",
          title: `Check ${commute.name}`,
          body: "Your usual commute is coming up. Search current options before you leave.",
          kind: "commute",
          commuteId: commute.id,
        });
      }
    }
    for (const pass of store.list(userId, "pass"))
      if (Date.parse(pass.renewal) - now < 3 * 86400000 && Date.parse(pass.renewal) > now)
        add(`${pass.id}:renewal:${pass.renewal}`, {
          severity: "info",
          title: `${pass.name} renewal reminder`,
          body: "Review this self-reported pass with the operator. Wayline does not manage its billing.",
          kind: "renewal",
        });
  }
}

// R06: repairs alerts left behind by pre-fix code, where the alert record and its push-delivery
// jobs were two separate, un-transacted writes -- a crash or DB error between them left a real
// alert on file with no push ever queued for it. Safe to call on every server startup (see
// server.mjs): it only looks at non-expired alerts that still have no push-deliver job of any
// status referencing them, and the fanOutPush/enqueueJob calls it makes are themselves
// idempotent (R06, jobs.mjs), so running this again against an already-consistent database, or
// twice in a row, does nothing beyond one fast, empty query.
//
// An alert for an account with zero push subscriptions will always match "no push-deliver job
// exists" (fanOutPush intentionally enqueues nothing for it) and so will keep being selected by
// this query until it expires -- harmless (fanOutPush's own loop is a no-op), just not worth
// special-casing at this pilot's scale.
export function reconcileOrphanedAlerts(store, { now = Date.now(), limit = 500 } = {}) {
  const orphans = store.db
    .prepare(
      `SELECT id, user_id FROM records
       WHERE kind='alert' AND (expires_at IS NULL OR expires_at>?)
       AND NOT EXISTS (
         SELECT 1 FROM jobs WHERE kind='push-deliver' AND json_extract(jobs.payload,'$.alertId')=records.id
       )
       LIMIT ?`,
    )
    .all(now, limit);
  let repaired = 0;
  for (const { id, user_id: userId } of orphans) {
    if (store.list(userId, "push-subscription").length === 0) continue;
    fanOutPush(store, userId, id);
    repaired++;
  }
  return repaired;
}
