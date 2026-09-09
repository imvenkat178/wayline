import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import webpush from "web-push";
import { Store } from "../server/store.mjs";
import { createApplication } from "../server/server.mjs";
import { runGuardian } from "../server/guardian.mjs";
import {
  vapidKeys,
  configureWebPush,
  pushPublicKey,
  sendPush,
  fanOutPush,
  deliverPush,
} from "../server/push.mjs";

function temporaryStore(t) {
  const directory = mkdtempSync(join(tmpdir(), "wayline-test-"));
  const store = new Store({ directory, key: "78".repeat(32), production: false });
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return store;
}

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), "wayline-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("vapidKeys generates a keypair once and persists it across calls", (t) => {
  const directory = temporaryDirectory(t);
  const first = vapidKeys(directory);
  assert.ok(first.publicKey);
  assert.ok(first.privateKey);
  const second = vapidKeys(directory);
  assert.equal(second.publicKey, first.publicKey);
  assert.equal(second.privateKey, first.privateKey);
  // And it's really on disk, 0600, not just cached in memory.
  const onDisk = JSON.parse(readFileSync(join(directory, ".vapid-keys.json"), "utf8"));
  assert.equal(onDisk.publicKey, first.publicKey);
});

test("configureWebPush sets the process-wide public key returned by pushPublicKey", (t) => {
  const directory = temporaryDirectory(t);
  const key = configureWebPush(directory);
  assert.equal(pushPublicKey(), key);
  assert.equal(key, vapidKeys(directory).publicKey);
});

test("sendPush resolves ok:true on success", async (t) => {
  t.mock.method(webpush, "sendNotification", async () => ({ statusCode: 201 }));
  const result = await sendPush(
    { endpoint: "https://push.example/x", p256dh: "p", auth: "a" },
    { title: "t", body: "b" },
  );
  assert.deepEqual(result, { ok: true });
});

test("sendPush treats a 404 or 410 as gone, not a failure to retry", async (t) => {
  for (const statusCode of [404, 410]) {
    t.mock.method(webpush, "sendNotification", async () => {
      throw Object.assign(new Error("gone"), { statusCode });
    });
    const result = await sendPush(
      { endpoint: "https://push.example/x", p256dh: "p", auth: "a" },
      { title: "t", body: "b" },
    );
    assert.deepEqual(result, { ok: false, gone: true });
    t.mock.reset();
  }
});

test("sendPush rethrows any other error so the durable job queue can retry it", async (t) => {
  t.mock.method(webpush, "sendNotification", async () => {
    throw Object.assign(new Error("upstream unavailable"), { statusCode: 500 });
  });
  await assert.rejects(
    sendPush({ endpoint: "https://push.example/x", p256dh: "p", auth: "a" }, { title: "t" }),
    /upstream unavailable/,
  );
});

test("fanOutPush enqueues one push-deliver job per subscription the user has", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  store.put(user.id, "push-subscription", {
    endpoint: "https://push.example/a",
    keys: { p256dh: "p1", auth: "a1" },
  });
  store.put(user.id, "push-subscription", {
    endpoint: "https://push.example/b",
    keys: { p256dh: "p2", auth: "a2" },
  });
  const alert = store.put(user.id, "alert", {
    severity: "critical",
    title: "x",
    body: "y",
    kind: "renewal",
    read: false,
    dedupeKey: "d1",
    delivery: "in-app",
    at: new Date().toISOString(),
  });
  fanOutPush(store, user.id, alert.id);
  const jobs = store.db.prepare("SELECT * FROM jobs WHERE kind='push-deliver'").all();
  assert.equal(jobs.length, 2);
  const payloads = jobs.map((j) => JSON.parse(j.payload));
  assert.ok(payloads.every((p) => p.userId === user.id && p.alertId === alert.id));
});

test("fanOutPush enqueues nothing for a user with no push subscriptions", (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const alert = store.put(user.id, "alert", {
    severity: "critical",
    title: "x",
    body: "y",
    kind: "renewal",
    read: false,
    dedupeKey: "d1",
    delivery: "in-app",
    at: new Date().toISOString(),
  });
  fanOutPush(store, user.id, alert.id);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM jobs").get().n, 0);
});

test("deliverPush is a silent no-op when the alert was already deleted or expired", async (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const sub = store.put(user.id, "push-subscription", {
    endpoint: "https://push.example/a",
    keys: { p256dh: "p1", auth: "a1" },
  });
  t.mock.method(webpush, "sendNotification", async () => {
    throw new Error("should never be called");
  });
  await assert.doesNotReject(
    deliverPush(store, { userId: user.id, alertId: "missing-alert", subscriptionId: sub.id }),
  );
});

test("deliverPush is a silent no-op when the subscription was already removed", async (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const alert = store.put(user.id, "alert", {
    severity: "critical",
    title: "x",
    body: "y",
    kind: "renewal",
    read: false,
    dedupeKey: "d1",
    delivery: "in-app",
    at: new Date().toISOString(),
  });
  t.mock.method(webpush, "sendNotification", async () => {
    throw new Error("should never be called");
  });
  await assert.doesNotReject(
    deliverPush(store, { userId: user.id, alertId: alert.id, subscriptionId: "missing-sub" }),
  );
});

test("deliverPush sends a generic, non-identifying body by default (pushDetails off)", async (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const sub = store.put(user.id, "push-subscription", {
    endpoint: "https://push.example/a",
    keys: { p256dh: "p1", auth: "a1" },
  });
  const alert = store.put(user.id, "alert", {
    severity: "info",
    title: "Real secret operator detail",
    body: "Your 5:12pm Amtrak to Providence has a real disruption.",
    kind: "renewal",
    journeyId: "j1",
    read: false,
    dedupeKey: "d1",
    delivery: "in-app",
    at: new Date().toISOString(),
  });
  let sent;
  t.mock.method(webpush, "sendNotification", async (subscription, body) => {
    sent = JSON.parse(body);
    return { statusCode: 201 };
  });
  await deliverPush(store, { userId: user.id, alertId: alert.id, subscriptionId: sub.id });
  assert.ok(sent);
  assert.equal(sent.title, "Wayline alert");
  assert.doesNotMatch(sent.body, /Amtrak|Providence|secret/);
  assert.equal(sent.alertId, alert.id);
});

test("deliverPush sends the real alert title/body once the user opts into pushDetails", async (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  store.updateUser(user.id, { preferences: { pushDetails: true } });
  const sub = store.put(user.id, "push-subscription", {
    endpoint: "https://push.example/a",
    keys: { p256dh: "p1", auth: "a1" },
  });
  const alert = store.put(user.id, "alert", {
    severity: "info",
    title: "Renewal reminder",
    body: "Detailed real body text.",
    kind: "renewal",
    read: false,
    dedupeKey: "d1",
    delivery: "in-app",
    at: new Date().toISOString(),
  });
  let sent;
  t.mock.method(webpush, "sendNotification", async (subscription, body) => {
    sent = JSON.parse(body);
    return { statusCode: 201 };
  });
  await deliverPush(store, { userId: user.id, alertId: alert.id, subscriptionId: sub.id });
  assert.equal(sent.title, "Renewal reminder");
  assert.equal(sent.body, "Detailed real body text.");
});

test("deliverPush removes the subscription when the push service reports it gone", async (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  const sub = store.put(user.id, "push-subscription", {
    endpoint: "https://push.example/a",
    keys: { p256dh: "p1", auth: "a1" },
  });
  const alert = store.put(user.id, "alert", {
    severity: "critical",
    title: "x",
    body: "y",
    kind: "renewal",
    read: false,
    dedupeKey: "d1",
    delivery: "in-app",
    at: new Date().toISOString(),
  });
  t.mock.method(webpush, "sendNotification", async () => {
    throw Object.assign(new Error("gone"), { statusCode: 410 });
  });
  await deliverPush(store, { userId: user.id, alertId: alert.id, subscriptionId: sub.id });
  assert.throws(() => store.get(user.id, sub.id, "push-subscription"), { status: 404 });
});

test("guardian's alert creation fans out a real push-deliver job when a subscription exists", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const user = store.createGuest();
  store.put(user.id, "push-subscription", {
    endpoint: "https://push.example/a",
    keys: { p256dh: "p1", auth: "a1" },
  });
  store.put(user.id, "pass", {
    name: "Pass",
    renewal: new Date(now + 86400000).toISOString(),
  });
  runGuardian(store, user.id, now);
  assert.equal(store.list(user.id, "alert").length, 1);
  const jobs = store.db.prepare("SELECT * FROM jobs WHERE kind='push-deliver'").all();
  assert.equal(jobs.length, 1);
});

test("bootstrap reports a real VAPID public key once the server has started", async (t) => {
  const store = temporaryStore(t);
  const { server } = createApplication({ store, production: false, quiet: true });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const boot = await (await fetch(base + "/api/bootstrap")).json();
    assert.ok(boot.pushPublicKey);
    const remotePush = boot.capabilities.find((c) => c.id === "remote-push");
    assert.equal(remotePush.status, "configured, not checked");
    assert.equal(remotePush.enabled, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POSTing a push subscription twice with the same endpoint upserts instead of duplicating", async (t) => {
  const store = temporaryStore(t);
  const { server } = createApplication({ store, production: false, quiet: true });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const bootResponse = await fetch(base + "/api/bootstrap");
    const boot = await bootResponse.json();
    const cookie = bootResponse.headers.get("set-cookie").split(";")[0];
    const headers = {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": boot.csrf,
    };
    const body = JSON.stringify({
      endpoint: "https://push.example/same-device",
      keys: { p256dh: "p1", auth: "a1" },
      userAgent: "test-agent",
    });
    const first = await fetch(base + "/api/records/push-subscription", {
      method: "POST",
      headers,
      body,
    });
    assert.equal(first.status, 201);
    const firstRecord = await first.json();
    const second = await fetch(base + "/api/records/push-subscription", {
      method: "POST",
      headers,
      body,
    });
    assert.equal(second.status, 201);
    const secondRecord = await second.json();
    assert.equal(secondRecord.id, firstRecord.id);
    assert.equal(secondRecord.version, firstRecord.version + 1);
    const list = await (
      await fetch(base + "/api/records/push-subscription", { headers: { cookie } })
    ).json();
    assert.equal(list.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
