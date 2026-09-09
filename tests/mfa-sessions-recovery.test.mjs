import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../server/store.mjs";
import { totp } from "../server/totp.mjs";

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

test("a fresh database already has the widened sessions table and the new MFA/recovery tables", (t) => {
  const store = temporaryStore(t);
  const columns = store.db
    .prepare("PRAGMA table_info(sessions)")
    .all()
    .map((c) => c.name);
  assert.deepEqual(
    columns.sort(),
    [
      "created_at",
      "csrf",
      "expires_at",
      "last_seen_at",
      "token_hash",
      "user_agent",
      "user_id",
    ].sort(),
  );
  const tables = store.db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  for (const name of ["mfa", "pending_logins", "recovery_tokens"]) assert.ok(tables.includes(name));
});

test("migrateSessionColumns backfills a pre-existing 4-column sessions table without losing data", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "wayline-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // Simulate an install created before this migration existed: the original 4-column schema,
  // with one real row already in it.
  const db = new DatabaseSync(join(directory, "wayline.sqlite"));
  db.exec(
    "CREATE TABLE users(id TEXT PRIMARY KEY, email_hash TEXT, password_hash TEXT, profile BLOB, created_at INTEGER) STRICT;",
  );
  db.exec(
    "CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf TEXT NOT NULL,expires_at INTEGER NOT NULL) STRICT;",
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
    "legacyhash",
    "legacy-user",
    "legacycsrf",
    Date.now() + 100000,
  );
  db.close();
  const store = new Store({ directory, key: "78".repeat(32), production: false });
  const columns = store.db
    .prepare("PRAGMA table_info(sessions)")
    .all()
    .map((c) => c.name);
  assert.ok(["created_at", "user_agent", "last_seen_at"].every((c) => columns.includes(c)));
  const row = store.db.prepare("SELECT * FROM sessions WHERE token_hash=?").get("legacyhash");
  assert.equal(row.user_id, "legacy-user");
  assert.equal(row.csrf, "legacycsrf");
  assert.equal(row.created_at, 0); // backfilled default, not fabricated
  store.close();
});

test("migrateSessionColumns is idempotent -- running it again on an already-migrated db is a no-op", (t) => {
  const store = temporaryStore(t);
  assert.doesNotThrow(() => store.migrateSessionColumns());
});

test("session() records userAgent and createdAt; findSession() touches lastSeenAt", async (t) => {
  const store = temporaryStore(t);
  const user = await registeredUser(store);
  const before = Date.now();
  const sess = store.session(user.id, { userAgent: "TestAgent/1.0" });
  const [row] = store.sessions(user.id, null);
  assert.equal(row.userAgent, "TestAgent/1.0");
  assert.ok(row.createdAt >= before);
  const firstSeen = row.lastSeenAt;
  await new Promise((r) => setTimeout(r, 5));
  store.findSession(sess.token);
  const [rowAfter] = store.sessions(user.id, null);
  assert.ok(rowAfter.lastSeenAt >= firstSeen);
});

test("session() truncates an absurdly long user-agent string rather than storing it unbounded", (t) => {
  const store = temporaryStore(t);
  const longAgent = "x".repeat(5000);
  const user = store.createGuest();
  store.session(user.id, { userAgent: longAgent });
  const [row] = store.sessions(user.id, null);
  assert.ok(row.userAgent.length <= 200);
});

test("sessions() lists newest-active-first and flags the caller's own session as current", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const first = store.session(user.id, { userAgent: "device-A" });
  const second = store.session(user.id, { userAgent: "device-B" });
  store.findSession(second.token); // bump last_seen_at so ordering is deterministic
  const list = store.sessions(user.id, second.token);
  assert.equal(list.length, 2);
  assert.equal(list[0].userAgent, "device-B");
  assert.equal(list[0].current, true);
  assert.equal(list.find((s) => s.userAgent === "device-A").current, false);
});

test("revokeSession removes exactly the named session and is scoped to its owner", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const other = store.createGuest();
  const mine = store.session(user.id, {});
  const [row] = store.sessions(user.id, null);
  assert.throws(() => store.revokeSession(other.id, row.id), { status: 404 });
  store.revokeSession(user.id, row.id);
  assert.equal(store.findSession(mine.token), null);
});

test("revokeSession on an unknown id throws Not Found rather than silently succeeding", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  assert.throws(() => store.revokeSession(user.id, "does-not-exist"), { status: 404 });
});

test("revokeOtherSessions keeps the caller's current session and drops every other one", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const current = store.session(user.id, { userAgent: "current" });
  store.session(user.id, { userAgent: "other-1" });
  store.session(user.id, { userAgent: "other-2" });
  assert.equal(store.sessions(user.id, null).length, 3);
  store.revokeOtherSessions(user.id, current.token);
  const remaining = store.sessions(user.id, current.token);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].current, true);
  assert.equal(store.findSession(current.token).userId, user.id);
});

test("mfaStatus reports disabled until mfaConfirm succeeds, then enabled", async (t) => {
  const store = temporaryStore(t);
  const user = await registeredUser(store);
  assert.equal(store.mfaStatus(user.id).enabled, false);
  const setup = store.mfaSetup(user.id);
  assert.equal(store.mfaStatus(user.id).enabled, false); // setup alone doesn't enable it
  store.mfaConfirm(user.id, totp(setup.secret));
  assert.equal(store.mfaStatus(user.id).enabled, true);
});

test("mfaSetup can be safely restarted before confirmation, replacing the pending secret", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const first = store.mfaSetup(user.id);
  const second = store.mfaSetup(user.id);
  assert.notEqual(first.secret, second.secret);
  // The first (now-replaced) secret's code must no longer verify -- only the latest setup counts.
  assert.throws(() => store.mfaConfirm(user.id, totp(first.secret)), { status: 401 });
  assert.equal(store.mfaConfirm(user.id, totp(second.secret)).length, 8);
});

test("mfaConfirm rejects an incorrect code and never enables MFA on a bad attempt", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  store.mfaSetup(user.id);
  assert.throws(() => store.mfaConfirm(user.id, "000000"), { status: 401 });
  assert.equal(store.mfaStatus(user.id).enabled, false);
});

test("mfaConfirm without a prior mfaSetup call fails with Conflict, not a crash", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  assert.throws(() => store.mfaConfirm(user.id, "123456"), { status: 409 });
});

test("mfaVerifyCode accepts a live TOTP code repeatedly (it's not single-use)", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const setup = store.mfaSetup(user.id);
  store.mfaConfirm(user.id, totp(setup.secret));
  const code = totp(setup.secret);
  assert.equal(store.mfaVerifyCode(user.id, code), true);
  assert.equal(store.mfaVerifyCode(user.id, code), true);
});

test("mfaVerifyCode accepts a recovery code exactly once, then rejects it", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const setup = store.mfaSetup(user.id);
  const codes = store.mfaConfirm(user.id, totp(setup.secret));
  assert.equal(store.mfaVerifyCode(user.id, codes[0]), true);
  assert.throws(() => store.mfaVerifyCode(user.id, codes[0]), { status: 401 });
});

test("mfaVerifyCode normalizes a recovery code's formatting before checking it", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const setup = store.mfaSetup(user.id);
  const codes = store.mfaConfirm(user.id, totp(setup.secret));
  const messy = "  " + codes[1].toLowerCase().replace(/-/g, " ") + "  ";
  assert.equal(store.mfaVerifyCode(user.id, messy), true);
});

test("mfaVerifyCode on an account without MFA enabled fails with Conflict", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  assert.throws(() => store.mfaVerifyCode(user.id, "123456"), { status: 409 });
});

test("mfaDisable requires a valid code and removes MFA entirely once satisfied", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const setup = store.mfaSetup(user.id);
  const codes = store.mfaConfirm(user.id, totp(setup.secret));
  assert.throws(() => store.mfaDisable(user.id, "000000"), { status: 401 });
  assert.equal(store.mfaStatus(user.id).enabled, true);
  store.mfaDisable(user.id, totp(setup.secret));
  assert.equal(store.mfaStatus(user.id).enabled, false);
  // Re-verifying anything against it now correctly reports MFA as not enabled.
  assert.throws(() => store.mfaVerifyCode(user.id, codes[0]), { status: 409 });
});

test("pendingLogin issues a short-lived token; peekPendingLogin does not consume it", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const token = store.pendingLogin(user.id);
  assert.equal(store.peekPendingLogin(token), user.id);
  assert.equal(store.peekPendingLogin(token), user.id); // still there -- peek never consumes
});

test("consumePendingLogin returns the user id once, then the token is gone", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const token = store.pendingLogin(user.id);
  assert.equal(store.consumePendingLogin(token), user.id);
  assert.throws(() => store.consumePendingLogin(token), { status: 401 });
  assert.throws(() => store.peekPendingLogin(token), { status: 401 });
});

test("an expired pending login is rejected even before its natural cleanup sweep", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const token = store.pendingLogin(user.id);
  // Force it into the past directly, simulating time passing well beyond the 5-minute window.
  store.db
    .prepare("UPDATE pending_logins SET expires_at=? WHERE user_id=?")
    .run(Date.now() - 1000, user.id);
  assert.throws(() => store.peekPendingLogin(token), { status: 401 });
});

test("a wrong second-factor attempt does not burn the pending login token (regression)", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const setup = store.mfaSetup(user.id);
  store.mfaConfirm(user.id, totp(setup.secret));
  const token = store.pendingLogin(user.id);
  // Mirrors the router's real ordering: peek (non-destructive), verify, and only consume on
  // success -- so a mistyped code must leave the token intact for a retry.
  const uid = store.peekPendingLogin(token);
  assert.throws(() => store.mfaVerifyCode(uid, "000000"), { status: 401 });
  assert.equal(store.peekPendingLogin(token), user.id); // still valid after the failed attempt
  assert.equal(store.mfaVerifyCode(uid, totp(setup.secret)), true);
  assert.equal(store.consumePendingLogin(token), user.id); // now it can be spent
});

test("createRecoveryToken returns null for an unregistered or unknown email, without throwing", (t) => {
  const store = temporaryStore(t);
  assert.equal(store.createRecoveryToken("nobody@nowhere.com"), null);
  assert.equal(store.createRecoveryToken(""), null);
  assert.equal(store.createRecoveryToken(null), null);
});

test("createRecoveryToken issues a real token for a registered email", async (t) => {
  const store = temporaryStore(t);
  await registeredUser(store, "real@example.com");
  const token = store.createRecoveryToken("real@example.com");
  assert.ok(typeof token === "string" && token.length > 20);
});

test("resetPassword rejects an invalid or already-used token", async (t) => {
  const store = temporaryStore(t);
  await registeredUser(store, "real2@example.com");
  const token = store.createRecoveryToken("real2@example.com");
  await store.resetPassword(token, "brandnewpassword99");
  await assert.rejects(store.resetPassword(token, "anotherpassword99"), (e) => e.status === 401);
  await assert.rejects(
    store.resetPassword("not-a-real-token", "anotherpassword99"),
    (e) => e.status === 401,
  );
});

test("resetPassword enforces the same password length rule as registration", async (t) => {
  const store = temporaryStore(t);
  await registeredUser(store, "real3@example.com");
  const token = store.createRecoveryToken("real3@example.com");
  await assert.rejects(store.resetPassword(token, "short"), (e) => e.status === 400);
});

test("resetPassword actually changes the password (old fails, new succeeds) and signs out everywhere", async (t) => {
  const store = temporaryStore(t);
  const user = await registeredUser(store, "real4@example.com", "originalpassword1");
  store.session(user.id, {});
  store.session(user.id, {});
  assert.equal(store.sessions(user.id, null).length, 2);
  const token = store.createRecoveryToken("real4@example.com");
  await store.resetPassword(token, "brandnewpassword42");
  await assert.rejects(
    store.login("real4@example.com", "originalpassword1"),
    (e) => e.status === 401,
  );
  const relogged = await store.login("real4@example.com", "brandnewpassword42");
  assert.equal(relogged.id, user.id);
  assert.equal(store.sessions(user.id, null).length, 0);
});

test("cleanup() expires stale pending logins and used/expired recovery tokens", async (t) => {
  const store = temporaryStore(t);
  const user = await registeredUser(store, "cleanup@example.com");
  const pending = store.pendingLogin(user.id);
  store.db
    .prepare("UPDATE pending_logins SET expires_at=? WHERE user_id=?")
    .run(Date.now() - 1000, user.id);
  const resetToken = store.createRecoveryToken("cleanup@example.com");
  store.db
    .prepare("UPDATE recovery_tokens SET expires_at=? WHERE user_id=?")
    .run(Date.now() - 1000, user.id);
  store.cleanup();
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM pending_logins").get().n, 0);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM recovery_tokens").get().n, 0);
});
