import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store.mjs";
import { createApplication } from "../server/server.mjs";
import { LogEmailProvider, TestCaptureEmailProvider } from "../server/email.mjs";

// R09: before this fix, POST /api/auth/recovery/request always claimed "a reset link has been
// sent to it," regardless of whether a real email provider was configured -- with only the
// log-only default (server/email.mjs's LogEmailProvider) actually wired up in server.mjs, that
// claim was false for every account, and an ordinary user had no way to recover access or even
// know the flow didn't work. These tests cover: the response is now honest about that (driven by
// a static provider-level `real` flag, not a per-message result, so enumeration resistance is
// unaffected); the production default no longer retains an unbounded in-memory list of past
// reset links; the reset link/token itself never appears in server logs; and the link is built
// from the canonical PUBLIC_ORIGIN rather than a client-controlled Host header.

function cookieOf(res) {
  const set = res.headers.get("set-cookie");
  return set ? set.split(";")[0] : null;
}

async function withServer(t, { emailProvider, publicOrigin } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "wayline-email-test-"));
  const store = new Store({ directory, key: "78".repeat(32), production: false });
  const provider = emailProvider ?? new TestCaptureEmailProvider();

  const prevPublicOrigin = process.env.PUBLIC_ORIGIN;
  if (publicOrigin !== undefined) process.env.PUBLIC_ORIGIN = publicOrigin;
  else delete process.env.PUBLIC_ORIGIN;

  const { server, stopBackgroundJobs } = createApplication({
    store,
    production: false,
    quiet: true,
    emailProvider: provider,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await stopBackgroundJobs();
    store.close();
    rmSync(directory, { recursive: true, force: true });
    if (prevPublicOrigin === undefined) delete process.env.PUBLIC_ORIGIN;
    else process.env.PUBLIC_ORIGIN = prevPublicOrigin;
  });
  return { base, store, emailProvider: provider };
}

async function freshSession(base) {
  const res = await fetch(base + "/api/bootstrap");
  const boot = await res.json();
  return { cookie: cookieOf(res), csrf: boot.csrf };
}

function headers({ cookie, csrf }) {
  return { "content-type": "application/json", cookie, "x-csrf-token": csrf };
}

async function registerAlice(store, session, base) {
  const boot = await (
    await fetch(base + "/api/bootstrap", { headers: { cookie: session.cookie } })
  ).json();
  await store.register(boot.user.id, {
    name: "Alice",
    email: "alice@example.com",
    password: "longenoughpassword1",
  });
  return session;
}

test("LogEmailProvider and TestCaptureEmailProvider both report real:false -- neither genuinely delivers mail yet", () => {
  assert.equal(new LogEmailProvider({ quiet: true }).real, false);
  assert.equal(new TestCaptureEmailProvider().real, false);
});

test("LogEmailProvider retains nothing across calls -- no unbounded in-memory message list", async () => {
  const provider = new LogEmailProvider({ quiet: true });
  assert.equal(provider.sent, undefined);
  await provider.send({ to: "a@example.com", subject: "s1", text: "body 1" });
  await provider.send({ to: "b@example.com", subject: "s2", text: "body 2" });
  assert.equal(provider.sent, undefined);
});

test("LogEmailProvider's console output never includes the message body or any token/link -- only recipient and subject", async () => {
  const originalLog = console.log;
  const logged = [];
  console.log = (line) => logged.push(line);
  try {
    const provider = new LogEmailProvider({ quiet: false });
    await provider.send({
      to: "carol@example.com",
      subject: "Reset your Wayline password",
      text: "Use this link: https://wayline.example/#reset-password?token=super-secret-token-value",
    });
  } finally {
    console.log = originalLog;
  }
  assert.equal(logged.length, 1);
  const parsed = JSON.parse(logged[0]);
  assert.equal(parsed.to, "carol@example.com");
  assert.equal(parsed.subject, "Reset your Wayline password");
  assert.doesNotMatch(JSON.stringify(parsed), /super-secret-token-value/);
  assert.doesNotMatch(JSON.stringify(parsed), /reset-password/);
});

test("recovery/request is honest that email delivery isn't available yet, when only the default (non-real) provider is configured", async (t) => {
  const { base, store } = await withServer(t, {
    emailProvider: new LogEmailProvider({ quiet: true }),
  });
  let session = await freshSession(base);
  session = await registerAlice(store, session, base);
  const res = await fetch(base + "/api/auth/recovery/request", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ email: "alice@example.com" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.doesNotMatch(body.message, /has been sent/i);
  assert.match(body.message, /not available|isn't available/i);
});

test("recovery/request's honest response does not depend on whether the account actually exists (still enumeration-resistant)", async (t) => {
  const { base, store } = await withServer(t, {
    emailProvider: new LogEmailProvider({ quiet: true }),
  });
  let session = await freshSession(base);
  session = await registerAlice(store, session, base);
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

test("recovery/request builds the reset link from the canonical PUBLIC_ORIGIN, not the request's own Host header", async (t) => {
  const { base, store, emailProvider } = await withServer(t, {
    publicOrigin: "https://wayline.example",
  });
  let session = await freshSession(base);
  session = await registerAlice(store, session, base);
  await fetch(base + "/api/auth/recovery/request", {
    method: "POST",
    headers: { ...headers(session), host: "attacker.example" },
    body: JSON.stringify({ email: "alice@example.com" }),
  });
  assert.equal(emailProvider.sent.length, 1);
  assert.match(emailProvider.sent[0].text, /https:\/\/wayline\.example\/#reset-password\?token=/);
  assert.doesNotMatch(emailProvider.sent[0].text, /attacker\.example/);
});

test("server.mjs never imports or references TestCaptureEmailProvider -- it has no path into production", () => {
  const serverSource = readFileSync(
    fileURLToPath(new URL("../server/server.mjs", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(serverSource, /TestCaptureEmailProvider/);
  assert.match(serverSource, /LogEmailProvider/);
});
