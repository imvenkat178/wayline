import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { createApplication } from "../server/server.mjs";
import { LogEmailProvider } from "../server/email.mjs";

// Regression coverage for a real bug found by actually running the app through the README's
// own documented two-terminal dev workflow (`npm run dev` serving the frontend from Vite on
// one port, `npm start` serving this API on another): every mutating request -- including the
// AI agent chat -- came back 403 "Origin is not allowed.", because the browser's real Origin
// header (the Vite port) never matched this server's own computed origin (its own port), and
// the strict-equality check in server.mjs had no allowance for that. It looked like "the AI
// features don't work" from the UI, but the underlying cause was origin-pinning rejecting the
// request before it ever reached runAgentGraph -- a rules-vs-model question never even arose.

async function withServer(t, { production = false, publicOrigin, devClientOrigin } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "wayline-origin-test-"));
  const store = new Store({ directory, key: "78".repeat(32), production });
  const emailProvider = new LogEmailProvider({ quiet: true });

  const prevPublicOrigin = process.env.PUBLIC_ORIGIN;
  const prevDevClientOrigin = process.env.DEV_CLIENT_ORIGIN;
  if (publicOrigin !== undefined) process.env.PUBLIC_ORIGIN = publicOrigin;
  else delete process.env.PUBLIC_ORIGIN;
  if (devClientOrigin !== undefined) process.env.DEV_CLIENT_ORIGIN = devClientOrigin;
  else delete process.env.DEV_CLIENT_ORIGIN;

  const { server } = createApplication({ store, production, quiet: true, emailProvider });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    rmSync(directory, { recursive: true, force: true });
    if (prevPublicOrigin === undefined) delete process.env.PUBLIC_ORIGIN;
    else process.env.PUBLIC_ORIGIN = prevPublicOrigin;
    if (prevDevClientOrigin === undefined) delete process.env.DEV_CLIENT_ORIGIN;
    else process.env.DEV_CLIENT_ORIGIN = prevDevClientOrigin;
  });
  return base;
}

function cookieOf(res) {
  const set = res.headers.get("set-cookie");
  return set ? set.split(";")[0] : null;
}

async function freshSession(base) {
  const res = await fetch(base + "/api/bootstrap");
  const boot = await res.json();
  return { cookie: cookieOf(res), csrf: boot.csrf };
}

async function postAgent(base, session, originHeader) {
  const headers = {
    "content-type": "application/json",
    cookie: session.cookie,
    "x-csrf-token": session.csrf,
  };
  if (originHeader !== undefined) headers.origin = originHeader;
  return fetch(base + "/api/agent", {
    method: "POST",
    headers,
    body: JSON.stringify({ input: "why is my train late today?" }),
  });
}

test("a same-origin POST (no Origin header, as Node's own fetch sends) is unaffected", async (t) => {
  const base = await withServer(t);
  const session = await freshSession(base);
  const res = await postAgent(base, session);
  assert.equal(res.status, 200);
});

test("dev mode: a POST whose Origin is the default Vite dev port (127.0.0.1:5173) now succeeds", async (t) => {
  const base = await withServer(t, { production: false });
  const session = await freshSession(base);
  const res = await postAgent(base, session, "http://127.0.0.1:5173");
  assert.equal(res.status, 200, "the documented two-terminal dev workflow must not 403");
  const reply = await res.json();
  assert.ok(reply.reply, "expected an actual agent reply, not just a 200");
});

test("dev mode: DEV_CLIENT_ORIGIN overrides the default allowed dev origin", async (t) => {
  const base = await withServer(t, { production: false, devClientOrigin: "http://127.0.0.1:5555" });
  const session = await freshSession(base);

  const overridden = await postAgent(base, session, "http://127.0.0.1:5555");
  assert.equal(overridden.status, 200);

  const stillDefault = await postAgent(base, session, "http://127.0.0.1:5173");
  assert.equal(
    stillDefault.status,
    403,
    "the old default must not also be allowed once overridden",
  );
});

test("dev mode: an arbitrary third-party Origin is still rejected -- the allowance is exactly one dev origin, not a wildcard", async (t) => {
  const base = await withServer(t, { production: false });
  const session = await freshSession(base);
  const res = await postAgent(base, session, "https://evil.example.com");
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, "Origin is not allowed.");
});

test("production mode: the Vite dev origin is NOT allowed -- no dev bypass leaks into production", async (t) => {
  const base = await withServer(t, {
    production: true,
    publicOrigin: "https://wayline.example.com",
  });
  const session = await freshSession(base);
  const res = await postAgent(base, session, "http://127.0.0.1:5173");
  assert.equal(res.status, 403);
});

test("production mode: only the exact PUBLIC_ORIGIN is accepted, exactly as before this fix", async (t) => {
  const base = await withServer(t, {
    production: true,
    publicOrigin: "https://wayline.example.com",
  });
  const session = await freshSession(base);
  const res = await postAgent(base, session, "https://wayline.example.com");
  assert.equal(res.status, 200);
});
