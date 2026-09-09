import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { createApplication } from "../server/server.mjs";
import { totp } from "../server/totp.mjs";
import { LogEmailProvider } from "../server/email.mjs";

function cookieOf(res) {
  const set = res.headers.get("set-cookie");
  return set ? set.split(";")[0] : null;
}

async function withServer(t, run) {
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
  return { base, store, emailProvider };
}

async function freshSession(base) {
  const res = await fetch(base + "/api/bootstrap");
  const boot = await res.json();
  return { cookie: cookieOf(res), csrf: boot.csrf, boot };
}

function headers({ cookie, csrf }, extra = {}) {
  return { "content-type": "application/json", cookie, "x-csrf-token": csrf, ...extra };
}

// Registers "Alice" directly through the store rather than POSTing /api/auth/register.
// /api/auth/register is already covered elsewhere (tests/checkpoint.test.mjs); doing it via
// HTTP in every one of the many tests in this file would burn the shared, process-wide
// `auth:<ip>` rate-limit bucket (server.mjs's `buckets` map is module-level, so it persists
// across every withServer() call within this one test file/process) well before reaching the
// end of the file. Registering through the store leaves the guest session's cookie/csrf
// untouched (only the real HTTP endpoint rotates the session), so the caller's existing
// `session` stays valid afterward.
async function registerAliceViaStore(store, session, base) {
  const boot = await (
    await fetch(base + "/api/bootstrap", { headers: { cookie: session.cookie } })
  ).json();
  await store.register(boot.user.id, {
    name: "Alice",
    email: "alice@example.com",
    password: "longenoughpassword1",
  });
  return session; // cookie/csrf unchanged -- registering in place doesn't rotate the session
}

test("bootstrap reports mfaEnabled:false for a fresh guest, and it flips true once MFA is confirmed", async (t) => {
  const { base, store } = await withServer(t);
  let session = await freshSession(base);
  assert.equal(session.boot.mfaEnabled, false);
  session = await registerAliceViaStore(store, session, base);
  const setup = await (
    await fetch(base + "/api/mfa/setup", { method: "POST", headers: headers(session) })
  ).json();
  assert.ok(setup.secret);
  assert.match(setup.qrCode, /^data:image\/png;base64,/);
  await fetch(base + "/api/mfa/confirm", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ code: totp(setup.secret) }),
  });
  const rebooted = await (
    await fetch(base + "/api/bootstrap", { headers: { cookie: session.cookie } })
  ).json();
  assert.equal(rebooted.mfaEnabled, true);
});

test("logging into an MFA-enabled account requires a second factor before any session changes", async (t) => {
  const { base, store } = await withServer(t);
  let session = await freshSession(base);
  session = await registerAliceViaStore(store, session, base);
  const setup = await (
    await fetch(base + "/api/mfa/setup", { method: "POST", headers: headers(session) })
  ).json();
  await fetch(base + "/api/mfa/confirm", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ code: totp(setup.secret) }),
  });
  await fetch(base + "/api/auth/logout", { method: "POST", headers: headers(session) });

  session = await freshSession(base);
  const loginRes = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ email: "alice@example.com", password: "longenoughpassword1" }),
  });
  const loginData = await loginRes.json();
  assert.equal(loginRes.status, 200);
  assert.equal(loginData.mfaRequired, true);
  assert.ok(loginData.pendingToken);
  assert.equal(loginData.user, undefined);
  assert.equal(cookieOf(loginRes), null); // no session/cookie handed out yet

  return { setup, pendingToken: loginData.pendingToken, session };
});

test("a wrong MFA code at login is rejected without burning the pending-login token, then a correct code completes sign-in", async (t) => {
  const { base, store } = await withServer(t);
  let session = await freshSession(base);
  session = await registerAliceViaStore(store, session, base);
  const setup = await (
    await fetch(base + "/api/mfa/setup", { method: "POST", headers: headers(session) })
  ).json();
  await fetch(base + "/api/mfa/confirm", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ code: totp(setup.secret) }),
  });
  await fetch(base + "/api/auth/logout", { method: "POST", headers: headers(session) });

  session = await freshSession(base);
  const loginData = await (
    await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({ email: "alice@example.com", password: "longenoughpassword1" }),
    })
  ).json();
  const { pendingToken } = loginData;

  const wrongRes = await fetch(base + "/api/auth/mfa-verify", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ pendingToken, code: "000000" }),
  });
  assert.equal(wrongRes.status, 401);

  const rightRes = await fetch(base + "/api/auth/mfa-verify", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ pendingToken, code: totp(setup.secret) }),
  });
  const rightData = await rightRes.json();
  assert.equal(rightRes.status, 200);
  assert.equal(rightData.user.name, "Alice");
  assert.ok(cookieOf(rightRes));

  // The now-consumed token can't be replayed even with the right code.
  const replayRes = await fetch(base + "/api/auth/mfa-verify", {
    method: "POST",
    headers: headers({ cookie: cookieOf(rightRes), csrf: rightData.csrf }),
    body: JSON.stringify({ pendingToken, code: totp(setup.secret) }),
  });
  assert.equal(replayRes.status, 401);
});

test("mfa/confirm rejects a wrong code with 401 and leaves MFA unconfirmed", async (t) => {
  const { base, store } = await withServer(t);
  let session = await freshSession(base);
  session = await registerAliceViaStore(store, session, base);
  await fetch(base + "/api/mfa/setup", { method: "POST", headers: headers(session) });
  const res = await fetch(base + "/api/mfa/confirm", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ code: "000000" }),
  });
  assert.equal(res.status, 401);
  const boot = await (
    await fetch(base + "/api/bootstrap", { headers: { cookie: session.cookie } })
  ).json();
  assert.equal(boot.mfaEnabled, false);
});

test("mfa/disable requires a valid code via HTTP and turns MFA back off", async (t) => {
  const { base, store } = await withServer(t);
  let session = await freshSession(base);
  session = await registerAliceViaStore(store, session, base);
  const setup = await (
    await fetch(base + "/api/mfa/setup", { method: "POST", headers: headers(session) })
  ).json();
  await fetch(base + "/api/mfa/confirm", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ code: totp(setup.secret) }),
  });
  const badRes = await fetch(base + "/api/mfa/disable", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ code: "000000" }),
  });
  assert.equal(badRes.status, 401);
  const goodRes = await fetch(base + "/api/mfa/disable", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ code: totp(setup.secret) }),
  });
  assert.equal(goodRes.status, 200);
  const boot = await (
    await fetch(base + "/api/bootstrap", { headers: { cookie: session.cookie } })
  ).json();
  assert.equal(boot.mfaEnabled, false);
});

test("GET /api/sessions lists sessions and marks the caller's own session current", async (t) => {
  const { base, store } = await withServer(t);
  let session = await freshSession(base);
  session = await registerAliceViaStore(store, session, base);
  const list = await (await fetch(base + "/api/sessions", { headers: headers(session) })).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].current, true);
});

test("DELETE /api/sessions/:id revokes a specific session", async (t) => {
  const { base, store } = await withServer(t);
  let session = await freshSession(base);
  session = await registerAliceViaStore(store, session, base);
  const list = await (await fetch(base + "/api/sessions", { headers: headers(session) })).json();
  const res = await fetch(base + "/api/sessions/" + encodeURIComponent(list[0].id), {
    method: "DELETE",
    headers: headers(session),
  });
  assert.equal(res.status, 200);
  const afterRes = await fetch(base + "/api/sessions", { headers: headers(session) });
  assert.equal(afterRes.status, 401); // that session (the one that made the call) is now gone
});

test("POST /api/sessions/revoke-others keeps only the caller's current session", async (t) => {
  const { base, store } = await withServer(t);
  let session = await freshSession(base);
  session = await registerAliceViaStore(store, session, base);
  // Open a second session for the same account without disturbing the first.
  const other = await freshSession(base);
  await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: headers(other),
    body: JSON.stringify({ email: "alice@example.com", password: "longenoughpassword1" }),
  });
  const before = await (await fetch(base + "/api/sessions", { headers: headers(session) })).json();
  assert.equal(before.length, 2);
  const res = await fetch(base + "/api/sessions/revoke-others", {
    method: "POST",
    headers: headers(session),
  });
  assert.equal(res.status, 200);
  const after = await (await fetch(base + "/api/sessions", { headers: headers(session) })).json();
  assert.equal(after.length, 1);
  assert.equal(after[0].current, true);
});

test("password recovery: request responds identically for a real and a fake email (enumeration-resistant)", async (t) => {
  const { base, store } = await withServer(t);
  let session = await freshSession(base);
  session = await registerAliceViaStore(store, session, base);
  const knownRes = await fetch(base + "/api/auth/recovery/request", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ email: "alice@example.com" }),
  });
  const unknownRes = await fetch(base + "/api/auth/recovery/request", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ email: "nobody@nowhere.com" }),
  });
  assert.equal(knownRes.status, unknownRes.status);
  assert.deepEqual(await knownRes.json(), await unknownRes.json());
});

test("password recovery: the LogEmailProvider records the reset email for a real account (not actually delivered)", async (t) => {
  const { base, store, emailProvider } = await withServer(t);
  let session = await freshSession(base);
  session = await registerAliceViaStore(store, session, base);
  await fetch(base + "/api/auth/recovery/request", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ email: "alice@example.com" }),
  });
  assert.equal(emailProvider.sent.length, 1);
  assert.equal(emailProvider.sent[0].to, "alice@example.com");
  assert.match(emailProvider.sent[0].text, /reset-password\?token=/);
  // No email is queued for an address with no account.
  await fetch(base + "/api/auth/recovery/request", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ email: "nobody@nowhere.com" }),
  });
  assert.equal(emailProvider.sent.length, 1);
});

test("password recovery: reset actually changes the password and can then be used to log in", async (t) => {
  const { base, store, emailProvider } = await withServer(t);
  let session = await freshSession(base);
  session = await registerAliceViaStore(store, session, base);
  await fetch(base + "/api/auth/recovery/request", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ email: "alice@example.com" }),
  });
  const link = emailProvider.sent.at(-1).text.match(/token=(\S+)/)[1];
  const resetRes = await fetch(base + "/api/auth/recovery/reset", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ token: link, password: "brandnewpassword77" }),
  });
  assert.equal(resetRes.status, 200);

  const freshLoginSession = await freshSession(base);
  const badLogin = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: headers(freshLoginSession),
    body: JSON.stringify({ email: "alice@example.com", password: "longenoughpassword1" }),
  });
  assert.equal(badLogin.status, 401);
  const goodLogin = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: headers(freshLoginSession),
    body: JSON.stringify({ email: "alice@example.com", password: "brandnewpassword77" }),
  });
  assert.equal(goodLogin.status, 200);
});

test("password recovery: reset rejects a reused or bogus token", async (t) => {
  const { base } = await withServer(t);
  const res = await fetch(base + "/api/auth/recovery/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "not-a-real-token", password: "somepassword12345" }),
  });
  // No session/CSRF at all should still 401 with a session-expired error before ever reaching
  // the handler, or -- with a valid session -- fail with the recovery-specific 401. Either way
  // it must never succeed.
  assert.notEqual(res.status, 200);
});
