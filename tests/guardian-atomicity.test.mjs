import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, hashToken } from "../server/store.mjs";
import { runGuardian, reconcileOrphanedAlerts } from "../server/guardian.mjs";

// R06: guardian.mjs used to create an alert record and enqueue its push-delivery job(s) as two
// separate, un-transacted writes -- a crash or DB error between them left a real, visible alert
// on file with no push ever queued for it. The fix wraps both writes in one store.transaction(),
// gives alerts a real database uniqueness constraint (beyond the 1000-row in-memory dedup
// window), makes the push-delivery enqueue idempotent per (alertId,subscriptionId), and adds a
// startup repair pass for anything a pre-fix database already left orphaned. These tests cover
// each piece directly, plus the end-to-end integration through runGuardian.

function temporaryStore(t) {
  const directory = mkdtempSync(join(tmpdir(), "wayline-test-"));
  const store = new Store({ directory, key: "91".repeat(32), production: false });
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return store;
}

function pushSubscription(store, userId, suffix = "a") {
  return store.put(userId, "push-subscription", {
    endpoint: `https://push.example/${suffix}`,
    keys: { p256dh: "p1", auth: "a1" },
  });
}

test("put(): a second insert with the same dedupeHash returns the existing row instead of a duplicate (R06)", () => {
  const store = temporaryStore(test);
  const user = store.createGuest();
  const dedupeHash = hashToken(`${user.id}:leave-alert`);
  const first = store.put(user.id, "alert", { title: "first" }, { dedupeHash });
  const second = store.put(
    user.id,
    "alert",
    { title: "second, should be dropped" },
    { dedupeHash },
  );
  assert.equal(second.id, first.id);
  assert.equal(second.title, "first", "the row that actually won the race keeps its own content");
  const rows = store.db
    .prepare("SELECT * FROM records WHERE kind='alert' AND user_id=?")
    .all(user.id);
  assert.equal(rows.length, 1, "no duplicate row should have been inserted");
});

test("put(): the dedupeHash uniqueness constraint is scoped per-user, not global (R06)", () => {
  const store = temporaryStore(test);
  const userA = store.createGuest();
  const userB = store.createGuest();
  const dedupeHash = hashToken("same-key-different-users");
  const a = store.put(userA.id, "alert", { title: "a" }, { dedupeHash });
  const b = store.put(userB.id, "alert", { title: "b" }, { dedupeHash });
  assert.notEqual(a.id, b.id, "the same dedupeHash for two different accounts must not collide");
});

test("guardian: an alert and its push-delivery job commit atomically -- a failure enqueueing the job rolls back the alert too (R06)", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const user = store.createGuest();
  pushSubscription(store, user.id);
  store.put(user.id, "pass", { name: "Pass", renewal: new Date(now + 86400000).toISOString() });

  const realPrepare = store.db.prepare.bind(store.db);
  let armed = true;
  store.db.prepare = (sql) => {
    if (armed && sql.startsWith("INSERT INTO jobs")) {
      armed = false;
      throw new Error("simulated failure enqueueing the push-delivery job");
    }
    return realPrepare(sql);
  };
  try {
    runGuardian(store, user.id, now);
  } finally {
    store.db.prepare = realPrepare;
  }

  assert.equal(
    store.list(user.id, "alert").length,
    0,
    "the alert must not survive if its push-delivery job never got queued",
  );
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM jobs WHERE kind='push-deliver'").get().n,
    0,
  );
});

test("guardian: a failed alert for one account does not abort the sweep for the next account (R06)", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const broken = store.createGuest();
  const healthy = store.createGuest();
  store.put(broken.id, "pass", { name: "Broken", renewal: new Date(now + 86400000).toISOString() });
  store.put(healthy.id, "pass", {
    name: "Healthy",
    renewal: new Date(now + 86400000).toISOString(),
  });

  const realPrepare = store.db.prepare.bind(store.db);
  // A single shared flag, not one per prepare() call -- sabotages exactly the first "INSERT
  // INTO records" .run() across the whole sweep, whichever account it belongs to (scan order
  // between the two accounts isn't guaranteed), and lets every insert after that succeed
  // normally. That's what proves the OTHER account's alert survives regardless of which one
  // hits the simulated failure.
  let armed = true;
  store.db.prepare = (sql) => {
    const stmt = realPrepare(sql);
    if (armed && sql.startsWith("INSERT INTO records")) {
      const originalRun = stmt.run.bind(stmt);
      stmt.run = (...args) => {
        if (armed) {
          armed = false;
          throw new Error("simulated one-time insert failure");
        }
        return originalRun(...args);
      };
    }
    return stmt;
  };
  try {
    runGuardian(store, undefined, now, 500);
  } finally {
    store.db.prepare = realPrepare;
  }

  const totalAlerts =
    store.list(broken.id, "alert").length + store.list(healthy.id, "alert").length;
  assert.equal(
    totalAlerts,
    1,
    "exactly one of the two accounts loses its alert to the simulated failure",
  );
});

test("reconcileOrphanedAlerts: backfills a missing push-delivery job for an alert a pre-R06 database left orphaned, and is idempotent (R06)", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const user = store.createGuest();
  pushSubscription(store, user.id);
  // Simulate exactly what the pre-fix bug left behind: a real alert record with zero
  // push-deliver jobs referencing it (no dedupeHash needed here -- this predates that too).
  const orphan = store.put(user.id, "alert", {
    title: "Orphaned alert",
    severity: "warning",
    dedupeKey: "orphan:1",
    read: false,
    delivery: "in-app",
    at: new Date(now).toISOString(),
  });

  const firstPass = reconcileOrphanedAlerts(store, { now });
  assert.equal(firstPass, 1);
  const jobs = store.db
    .prepare("SELECT * FROM jobs WHERE kind='push-deliver' AND json_extract(payload,'$.alertId')=?")
    .all(orphan.id);
  assert.equal(jobs.length, 1);

  const secondPass = reconcileOrphanedAlerts(store, { now });
  assert.equal(
    secondPass,
    0,
    "an alert that already has its push-delivery job is not an orphan anymore",
  );
  const jobsAfter = store.db
    .prepare("SELECT * FROM jobs WHERE kind='push-deliver' AND json_extract(payload,'$.alertId')=?")
    .all(orphan.id);
  assert.equal(jobsAfter.length, 1, "the second pass must not enqueue a duplicate");
});

test("reconcileOrphanedAlerts: an alert for an account with no push subscription is left alone, not endlessly retried into jobs (R06)", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const user = store.createGuest();
  store.put(user.id, "alert", {
    title: "No subscriptions on this account",
    severity: "info",
    dedupeKey: "orphan:2",
    read: false,
    delivery: "in-app",
    at: new Date(now).toISOString(),
  });

  const repaired = reconcileOrphanedAlerts(store, { now });
  assert.equal(repaired, 0);
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM jobs WHERE kind='push-deliver'").get().n,
    0,
  );
});

test("reconcileOrphanedAlerts: an already-consistent alert (job already exists) is left untouched (R06)", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const user = store.createGuest();
  pushSubscription(store, user.id);
  store.put(user.id, "pass", { name: "Pass", renewal: new Date(now + 86400000).toISOString() });
  runGuardian(store, user.id, now);
  const before = store.db
    .prepare("SELECT count(*) AS n FROM jobs WHERE kind='push-deliver'")
    .get().n;
  assert.equal(before, 1);

  const repaired = reconcileOrphanedAlerts(store, { now });
  assert.equal(repaired, 0);
  const after = store.db
    .prepare("SELECT count(*) AS n FROM jobs WHERE kind='push-deliver'")
    .get().n;
  assert.equal(after, 1, "a healthy alert's job must not be duplicated by the repair pass");
});

test("guardian: dedup beyond the in-memory 1000-alert window falls back to the real database constraint instead of crashing (R06)", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const user = store.createGuest();
  store.put(user.id, "pass", { name: "Pass", renewal: new Date(now + 86400000).toISOString() });

  // First sweep creates the renewal alert normally.
  runGuardian(store, user.id, now);
  assert.equal(store.list(user.id, "alert").length, 1);

  // Directly exercise the same path guardian's add() takes when its in-memory `prior` Set
  // (built from store.list's newest-1000 window) doesn't know about an alert that's actually
  // already on file -- store.put() with the same dedupeHash must still refuse to duplicate it.
  const pass = store.list(user.id, "pass")[0];
  const key = `${pass.id}:renewal:${pass.renewal}`;
  const dedupeHash = hashToken(`${user.id}:${key}`);
  const duplicate = store.put(
    user.id,
    "alert",
    { title: "should not create a second row", dedupeKey: key, read: false },
    { dedupeHash },
  );
  assert.equal(store.list(user.id, "alert").length, 1, "still only one alert for this key");
  assert.equal(duplicate.dedupeKey, key);
});
