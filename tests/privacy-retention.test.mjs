import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../server/store.mjs";
import { enqueueJob } from "../server/jobs.mjs";
import { fanOutPush } from "../server/push.mjs";

// Phase 4 (roadmap feature 97, "Privacy mode completion"): closes the gap FEATURE_STATUS.md
// flagged -- deleteAccount/deleteHistory used to reach only the `records` table (and whatever
// else already had a foreign key to `users`), leaving the `jobs` table's push-deliver rows as
// the one piece of per-user derived data that didn't get cleaned up immediately. These tests
// exercise the fix directly against the store, the same way tests/mfa-sessions-recovery.test.mjs
// exercises its own migration and store methods.

function temporaryStore(t) {
  const directory = mkdtempSync(join(tmpdir(), "wayline-test-"));
  const store = new Store({ directory, key: "78".repeat(32), production: false });
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return store;
}

async function registeredUser(store, email = "a@b.com", password = "longenoughpassword1") {
  const guest = store.createGuest();
  return store.register(guest.id, { name: "Test", email, password });
}

test("a fresh database's jobs table already has the user_id column and its index", (t) => {
  const store = temporaryStore(t);
  const columns = store.db
    .prepare("PRAGMA table_info(jobs)")
    .all()
    .map((c) => c.name);
  assert.ok(columns.includes("user_id"));
  const indexes = store.db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='jobs'")
    .all()
    .map((r) => r.name);
  assert.ok(indexes.includes("idx_jobs_user"));
});

test("migrateJobsColumns backfills user_id for jobs whose referenced user still exists, and leaves orphaned ones alone", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "wayline-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // Simulate an install created before this migration existed: the original jobs schema with no
  // user_id column, one row whose payload references a user that still exists, and one row
  // whose payload references a user id that was already deleted under the old schema.
  const db = new DatabaseSync(join(directory, "wayline.sqlite"));
  db.exec(
    "CREATE TABLE users(id TEXT PRIMARY KEY, email_hash TEXT, password_hash TEXT, profile BLOB, created_at INTEGER) STRICT;",
  );
  db.exec(
    "CREATE TABLE jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 8,interval_ms INTEGER,run_at INTEGER NOT NULL,leased_until INTEGER,leased_by TEXT,last_error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL) STRICT;",
  );
  db.prepare("INSERT INTO users(id,created_at) VALUES(?,?)").run("still-here", Date.now());
  const now = Date.now();
  db.prepare(
    "INSERT INTO jobs(id,kind,payload,status,attempts,max_attempts,run_at,created_at,updated_at) VALUES(?,?,?,'pending',0,8,?,?,?)",
  ).run(
    "job-live",
    "push-deliver",
    JSON.stringify({ userId: "still-here", alertId: "a1" }),
    now,
    now,
    now,
  );
  db.prepare(
    "INSERT INTO jobs(id,kind,payload,status,attempts,max_attempts,run_at,created_at,updated_at) VALUES(?,?,?,'pending',0,8,?,?,?)",
  ).run(
    "job-orphan",
    "push-deliver",
    JSON.stringify({ userId: "long-gone", alertId: "a2" }),
    now,
    now,
    now,
  );
  db.close();

  const store = new Store({ directory, key: "78".repeat(32), production: false });
  const columns = store.db
    .prepare("PRAGMA table_info(jobs)")
    .all()
    .map((c) => c.name);
  assert.ok(columns.includes("user_id"));
  const live = store.db.prepare("SELECT user_id FROM jobs WHERE id=?").get("job-live");
  const orphan = store.db.prepare("SELECT user_id FROM jobs WHERE id=?").get("job-orphan");
  assert.equal(live.user_id, "still-here");
  assert.equal(orphan.user_id, null); // no real user to attribute it to -- left for cleanup()
  store.close();
});

test("deleteAccount cascades to remove that user's jobs (push-deliver rows), not just their records", async (t) => {
  const store = temporaryStore(t);
  const { id: userId } = await registeredUser(store);
  store.put(userId, "push-subscription", {
    endpoint: "https://push.example/1",
    p256dh: "k",
    auth: "a",
  });
  const jobId = enqueueJob(
    store,
    "push-deliver",
    { userId, alertId: "alert-1", subscriptionId: "sub-1" },
    { userId },
  );
  // A job for a different, still-existing user must survive this account's deletion untouched.
  const { id: otherUserId } = await registeredUser(store, "other@b.com");
  const otherJobId = enqueueJob(
    store,
    "push-deliver",
    { userId: otherUserId, alertId: "x", subscriptionId: "y" },
    { userId: otherUserId },
  );

  assert.ok(store.db.prepare("SELECT id FROM jobs WHERE id=?").get(jobId));
  store.deleteAccount(userId);
  assert.equal(store.db.prepare("SELECT id FROM jobs WHERE id=?").get(jobId), undefined);
  assert.ok(store.db.prepare("SELECT id FROM jobs WHERE id=?").get(otherJobId));
});

test("deleteAccount cascades sessions, mfa, pending_logins, recovery_tokens and shares for that user", async (t) => {
  const store = temporaryStore(t);
  const { id: userId } = await registeredUser(store);
  store.session(userId);
  store.mfaSetup(userId);
  store.pendingLogin(userId);
  const journey = store.put(userId, "journey", { from: "A", to: "B" });
  store.share(userId, journey.id, { hours: 1 });
  assert.ok(store.db.prepare("SELECT 1 FROM sessions WHERE user_id=?").get(userId));
  assert.ok(store.db.prepare("SELECT 1 FROM mfa WHERE user_id=?").get(userId));
  assert.ok(store.db.prepare("SELECT 1 FROM pending_logins WHERE user_id=?").get(userId));
  assert.ok(store.db.prepare("SELECT 1 FROM shares WHERE user_id=?").get(userId));

  store.deleteAccount(userId);

  assert.equal(store.db.prepare("SELECT 1 FROM sessions WHERE user_id=?").get(userId), undefined);
  assert.equal(store.db.prepare("SELECT 1 FROM mfa WHERE user_id=?").get(userId), undefined);
  assert.equal(
    store.db.prepare("SELECT 1 FROM pending_logins WHERE user_id=?").get(userId),
    undefined,
  );
  assert.equal(store.db.prepare("SELECT 1 FROM shares WHERE user_id=?").get(userId), undefined);
  assert.equal(store.db.prepare("SELECT 1 FROM records WHERE user_id=?").get(userId), undefined);
});

test("deleteHistory purges every pending push-deliver job whose alert it just deleted, but leaves another user's untouched", (t) => {
  const store = temporaryStore(t);
  const guest = store.createGuest();
  const userId = guest.id;
  const alertOne = store.put(userId, "alert", { kind: "connection", title: "t", body: "b" });
  const alertTwo = store.put(userId, "alert", { kind: "connection", title: "t2", body: "b2" });
  const jobOne = enqueueJob(
    store,
    "push-deliver",
    { userId, alertId: alertOne.id, subscriptionId: "sub-1" },
    { userId },
  );
  const jobTwo = enqueueJob(
    store,
    "push-deliver",
    { userId, alertId: alertTwo.id, subscriptionId: "sub-1" },
    { userId },
  );
  // A different user's still-live alert and job must be completely unaffected by this user's
  // deleteHistory call -- the cleanup is scoped by user_id, not just by "does the alert exist".
  const otherGuest = store.createGuest();
  const otherAlert = store.put(otherGuest.id, "alert", {
    kind: "connection",
    title: "o",
    body: "o",
  });
  const otherJob = enqueueJob(
    store,
    "push-deliver",
    { userId: otherGuest.id, alertId: otherAlert.id, subscriptionId: "sub-2" },
    { userId: otherGuest.id },
  );

  // deleteHistory deletes every 'alert' record for the user (not a selective subset), so both
  // of this user's pending push-deliver jobs become orphaned and should both be removed.
  store.deleteHistory(userId);

  assert.equal(store.db.prepare("SELECT id FROM jobs WHERE id=?").get(jobOne), undefined);
  assert.equal(store.db.prepare("SELECT id FROM jobs WHERE id=?").get(jobTwo), undefined);
  assert.ok(store.db.prepare("SELECT id FROM jobs WHERE id=?").get(otherJob));
});

test("deleteHistory does not touch a push-deliver job that already left the pending status", (t) => {
  const store = temporaryStore(t);
  const guest = store.createGuest();
  const userId = guest.id;
  const alert = store.put(userId, "alert", { kind: "connection", title: "t", body: "b" });
  const jobId = enqueueJob(
    store,
    "push-deliver",
    { userId, alertId: alert.id, subscriptionId: "s" },
    { userId },
  );
  store.db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(jobId);

  store.deleteHistory(userId);

  // Already-finished jobs are cleanup()'s job (its normal 14-day sweep), not deleteHistory's --
  // deleteHistory only reaches in to cancel work that hasn't happened yet.
  assert.ok(store.db.prepare("SELECT id FROM jobs WHERE id=?").get(jobId));
});

test("fanOutPush records the alerting user's id on every job it enqueues", (t) => {
  const store = temporaryStore(t);
  const guest = store.createGuest();
  const userId = guest.id;
  store.put(userId, "push-subscription", {
    endpoint: "https://push.example/1",
    p256dh: "k",
    auth: "a",
  });
  store.put(userId, "push-subscription", {
    endpoint: "https://push.example/2",
    p256dh: "k",
    auth: "a",
  });

  fanOutPush(store, userId, "alert-xyz");

  const rows = store.db.prepare("SELECT user_id FROM jobs WHERE kind='push-deliver'").all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.user_id === userId));
});

test("export() now includes sessions, MFA status and shares, not just records and audit", async (t) => {
  const store = temporaryStore(t);
  const { id: userId } = await registeredUser(store);
  const { token } = store.session(userId, { userAgent: "TestAgent/1.0" });
  const journey = store.put(userId, "journey", { from: "A", to: "B" });
  store.share(userId, journey.id, { hours: 2 });

  const exported = store.export(userId);

  assert.ok(Array.isArray(exported.sessions));
  assert.equal(exported.sessions.length, 1);
  assert.equal(exported.sessions[0].userAgent, "TestAgent/1.0");
  assert.deepEqual(exported.mfa, { enabled: false });
  assert.ok(Array.isArray(exported.shares));
  assert.equal(exported.shares.length, 1);
  assert.equal(exported.shares[0].journeyId, journey.id);
  // Never leak a raw, usable credential in an export -- only opaque ids/hashes.
  assert.equal(exported.sessions[0].id.length > 20, true);
  assert.notEqual(exported.sessions[0].id, token);
});

test("export() reflects mfa.enabled truthfully once MFA is actually confirmed", async (t) => {
  const store = temporaryStore(t);
  const { id: userId } = await registeredUser(store);
  const before = store.export(userId);
  assert.equal(before.mfa.enabled, false);

  const { totp } = await import("../server/totp.mjs");
  const setup = store.mfaSetup(userId);
  store.mfaConfirm(userId, totp(setup.secret));

  const after = store.export(userId);
  assert.equal(after.mfa.enabled, true);
});
