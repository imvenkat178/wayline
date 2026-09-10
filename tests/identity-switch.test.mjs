import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Store, hashToken } from "../server/store.mjs";
import { createApplication } from "../server/server.mjs";
import { LogEmailProvider } from "../server/email.mjs";

// R10: a Web Push subscription is scoped to this BROWSER's origin, not to whichever Wayline
// identity happens to be signed in -- before this fix, nothing ever tied a push-subscription
// record back to the session that created it, so ending that session (logout, "revoke that
// device," or switching to a different account entirely) left the subscription live and its
// server-side record untouched: alerts for an account nobody was using anymore could keep
// reaching a shared device. These tests cover the fix at the Store level (every place a session
// ends now cascades to any push-subscription it created) and over real HTTP (the record actually
// gets tagged at creation, and a real logout/login cycle actually removes it) -- plus the
// App.tsx/Profile.tsx client-side wiring that reads/writes `sessionId`, covered as source-text
// assertions per this codebase's established pattern (see tests/push-ui.test.mjs) since there's
// no component-rendering harness here.

function temporaryStore(t) {
  const directory = mkdtempSync(join(tmpdir(), "wayline-test-"));
  const store = new Store({ directory, key: "78".repeat(32), production: false });
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return store;
}

function validPushKeys() {
  return {
    p256dh: Buffer.concat([Buffer.from([0x04]), randomBytes(64)]).toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
}

// -- Store-level: revokeSession/revokeOtherSessions/logout all cascade to push-subscription --

test("revokeSession also detaches the push subscription tagged with that exact session, leaving a different session's subscription alone", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const sessionA = store.session(user.id, { userAgent: "device-A" });
  const sessionB = store.session(user.id, { userAgent: "device-B" });
  store.put(user.id, "push-subscription", {
    endpoint: "https://fcm.googleapis.com/a",
    sessionId: hashToken(sessionA.token),
  });
  const subB = store.put(user.id, "push-subscription", {
    endpoint: "https://fcm.googleapis.com/b",
    sessionId: hashToken(sessionB.token),
  });
  const rowA = store.sessions(user.id, null).find((s) => s.userAgent === "device-A");
  store.revokeSession(user.id, rowA.id);
  const remaining = store.list(user.id, "push-subscription");
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, subB.id);
});

test("revokeOtherSessions detaches every OTHER session's push subscription but keeps the caller's own", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const current = store.session(user.id, { userAgent: "current" });
  const other1 = store.session(user.id, { userAgent: "other-1" });
  const other2 = store.session(user.id, { userAgent: "other-2" });
  const keep = store.put(user.id, "push-subscription", {
    endpoint: "https://fcm.googleapis.com/current",
    sessionId: hashToken(current.token),
  });
  store.put(user.id, "push-subscription", {
    endpoint: "https://fcm.googleapis.com/other-1",
    sessionId: hashToken(other1.token),
  });
  store.put(user.id, "push-subscription", {
    endpoint: "https://fcm.googleapis.com/other-2",
    sessionId: hashToken(other2.token),
  });
  store.revokeOtherSessions(user.id, current.token);
  const remaining = store.list(user.id, "push-subscription");
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, keep.id);
});

test("revokeOtherSessions leaves a push-subscription record with no sessionId untouched (pre-fix legacy data, not guessed at)", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const current = store.session(user.id, { userAgent: "current" });
  store.session(user.id, { userAgent: "other" });
  const legacy = store.put(user.id, "push-subscription", {
    endpoint: "https://fcm.googleapis.com/legacy",
    // No sessionId -- simulates a record created before this fix existed.
  });
  store.revokeOtherSessions(user.id, current.token);
  const remaining = store.list(user.id, "push-subscription");
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, legacy.id);
});

test("logout() detaches the push subscription tied to that exact session, leaving a different session's subscription for the same account untouched", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const sessionA = store.session(user.id, { userAgent: "device-A" });
  const sessionB = store.session(user.id, { userAgent: "device-B" });
  store.put(user.id, "push-subscription", {
    endpoint: "https://fcm.googleapis.com/a",
    sessionId: hashToken(sessionA.token),
  });
  const subB = store.put(user.id, "push-subscription", {
    endpoint: "https://fcm.googleapis.com/b",
    sessionId: hashToken(sessionB.token),
  });
  store.logout(sessionA.token);
  const remaining = store.list(user.id, "push-subscription");
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, subB.id);
  // Session A itself is really gone, not just its subscription.
  assert.equal(store.findSession(sessionA.token), null);
  assert.ok(store.findSession(sessionB.token));
});

test("logout() on a session with no push subscription is a harmless no-op for push-subscription records", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const session = store.session(user.id, {});
  store.logout(session.token); // must not throw just because there's nothing to detach
  assert.equal(store.list(user.id, "push-subscription").length, 0);
});

// -- HTTP-level: the real record gets tagged, and a real logout/login cycle removes it --

function cookieOf(res) {
  const set = res.headers.get("set-cookie");
  return set ? set.split(";")[0] : null;
}

async function withServer(t) {
  const directory = mkdtempSync(join(tmpdir(), "wayline-test-"));
  const store = new Store({ directory, key: "78".repeat(32), production: false });
  const emailProvider = new LogEmailProvider({ quiet: true });
  const { server } = createApplication({ store, production: false, quiet: true, emailProvider });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  return { base, store };
}

async function freshSession(base) {
  const res = await fetch(base + "/api/bootstrap");
  const boot = await res.json();
  return { cookie: cookieOf(res), csrf: boot.csrf, userId: boot.user.id };
}

function headers({ cookie, csrf }) {
  return { "content-type": "application/json", cookie, "x-csrf-token": csrf };
}

test("POST /records/push-subscription tags the record with the current session's own id (the same id /api/sessions lists)", async (t) => {
  const { base } = await withServer(t);
  const session = await freshSession(base);
  await fetch(base + "/api/records/push-subscription", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({
      endpoint: "https://fcm.googleapis.com/fcm/send/real-looking-id",
      keys: validPushKeys(),
      userAgent: "TestAgent/1.0",
    }),
  });
  const [sub] = await (
    await fetch(base + "/api/records/push-subscription", { headers: headers(session) })
  ).json();
  const [ownSession] = await (
    await fetch(base + "/api/sessions", { headers: headers(session) })
  ).json();
  assert.equal(sub.sessionId, ownSession.id);
});

test("a real logout removes this device's push-subscription record server-side, even simulating no client-side cleanup running", async (t) => {
  const { base, store } = await withServer(t);
  const session = await freshSession(base);
  await store.register(session.userId, {
    name: "Alice",
    email: "alice@example.com",
    password: "longenoughpassword1",
  });
  await fetch(base + "/api/records/push-subscription", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({
      endpoint: "https://fcm.googleapis.com/fcm/send/real-looking-id",
      keys: validPushKeys(),
      userAgent: "TestAgent/1.0",
    }),
  });
  assert.equal(store.list(session.userId, "push-subscription").length, 1);
  // Simulates a tab closing mid-logout: only the server call, no client-side unsubscribe.
  await fetch(base + "/api/auth/logout", { method: "POST", headers: headers(session) });
  assert.equal(store.list(session.userId, "push-subscription").length, 0);
});

test("a guest's push subscription is detached server-side when that guest logs into a different, already-existing account", async (t) => {
  const { base, store } = await withServer(t);
  // Bob already has a registered account, created directly through the store (not this browser).
  const bobGuest = store.createGuest();
  await store.register(bobGuest.id, {
    name: "Bob",
    email: "bob@example.com",
    password: "longenoughpassword1",
  });
  // A guest on THIS browser subscribes to push before ever signing in.
  const guestSession = await freshSession(base);
  await fetch(base + "/api/records/push-subscription", {
    method: "POST",
    headers: headers(guestSession),
    body: JSON.stringify({
      endpoint: "https://fcm.googleapis.com/fcm/send/guest-device",
      keys: validPushKeys(),
      userAgent: "TestAgent/1.0",
    }),
  });
  assert.equal(store.list(guestSession.userId, "push-subscription").length, 1);
  // That same browser now logs into Bob's existing, unrelated account.
  const loginRes = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: headers(guestSession),
    body: JSON.stringify({ email: "bob@example.com", password: "longenoughpassword1" }),
  });
  assert.equal(loginRes.status, 200);
  // The guest identity's subscription is gone -- it must not keep receiving alerts for a guest
  // account nobody on this device is signed into anymore.
  assert.equal(store.list(guestSession.userId, "push-subscription").length, 0);
  // And it was never attributed to Bob's account either.
  assert.equal(store.list(bobGuest.id, "push-subscription").length, 0);
});

// -- Client-side wiring (source-text assertions -- no component-rendering harness, see
// tests/push-ui.test.mjs's own note on this) --

const appSource = readFileSync(fileURLToPath(new URL("../src/App.tsx", import.meta.url)), "utf8");
const profileSource = readFileSync(
  fileURLToPath(new URL("../src/pages/Profile.tsx", import.meta.url)),
  "utf8",
);

test("App.tsx's switchIdentity clears the previous identity's saved-journeys list and re-fetches a full Bootstrap under the new session", () => {
  const switchIdentityBody = appSource.slice(
    appSource.indexOf("const switchIdentity = useCallback"),
    appSource.indexOf("}, []);", appSource.indexOf("const switchIdentity = useCallback")),
  );
  assert.match(switchIdentityBody, /setJourneys\(\[\]\)/);
  assert.match(switchIdentityBody, /api<Bootstrap>\("\/bootstrap"\)/);
  assert.match(switchIdentityBody, /sessionEpoch\.current \+= 1/);
  assert.match(switchIdentityBody, /if \(sessionEpoch\.current !== epoch\) return/);
});

test("App.tsx's Guardian poll ignores a response that arrives after the identity it was requested for has changed", () => {
  const pollBody = appSource.slice(
    appSource.indexOf('void api<Alert[]>("/guardian/check"'),
    appSource.indexOf(
      ".catch(() => {});",
      appSource.indexOf('void api<Alert[]>("/guardian/check"'),
    ),
  );
  assert.match(pollBody, /if \(sessionEpoch\.current !== epoch\) return/);
});

test("Profile.tsx reconciles push-subscription state against the CURRENT identity's own server records, re-running on every identity change", () => {
  assert.match(profileSource, /\[boot\.user\.id\]/);
  assert.match(profileSource, /api<\{ endpoint: string \}\[\]>\("\/records\/push-subscription"\)/);
  assert.match(profileSource, /records\.some\(\(r\) => r\.endpoint === subscription\.endpoint\)/);
  assert.match(profileSource, /if \(!owned\) await subscription\.unsubscribe\(\)/);
});

test("Profile.tsx detaches this device's push subscription during logout, before the session it was registered under ends", () => {
  const logoutBody = profileSource.slice(
    profileSource.indexOf("const logout = () =>"),
    profileSource.indexOf("location.href", profileSource.indexOf("const logout = () =>")),
  );
  const detachIndex = logoutBody.indexOf("detachPushSubscription()");
  const apiLogoutIndex = logoutBody.indexOf('"/auth/logout"');
  assert.notEqual(detachIndex, -1);
  assert.notEqual(apiLogoutIndex, -1);
  assert.ok(detachIndex < apiLogoutIndex, "detachPushSubscription() must run before /auth/logout");
});
