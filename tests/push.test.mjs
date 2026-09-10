import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
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

// A real Web Push subscription's endpoint always lands on one of a small set of known browser
// push services (server/netGuard.mjs's allowlist), and its keys are RFC 8291-shaped: p256dh a
// 65-byte uncompressed EC point (leading 0x04), auth 16 random bytes, both base64url. Tests below
// that go through the real HTTP route (which now validates both, per R03) need fixtures that
// actually pass -- unlike the placeholder "p1"/"a1" strings used elsewhere in this file by tests
// that call store.put() directly and so skip validateRecord entirely.
function validPushKeys() {
  return {
    p256dh: Buffer.concat([Buffer.from([0x04]), randomBytes(64)]).toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
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
  // R07: deliverPush now re-checks the same notification policy guardian.mjs already applied
  // at creation time -- an info-severity alert needs notifyInfo, which defaults off, and is
  // subject to quiet hours, which this test doesn't want interfering regardless of the real
  // wall-clock time it happens to run at (quietStart===quietEnd never matches). Opt in here
  // since this test is about the pushDetails content rule, not the notification gate itself
  // (that has its own dedicated tests below).
  store.updateUser(user.id, {
    preferences: { notifyInfo: true, quietStart: "00:00", quietEnd: "00:00" },
  });
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
  store.updateUser(user.id, {
    preferences: {
      pushDetails: true,
      notifyInfo: true,
      quietStart: "00:00",
      quietEnd: "00:00",
    },
  });
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

test("guardian's alert creation fans out a real push-deliver job when a subscription exists and the account allows it (R07)", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const user = store.createGuest();
  // A pass-renewal reminder is info-severity, so it needs notifyInfo -- default preferences
  // have that off (see the dedicated R07 default-suppression test below), so opt in explicitly
  // here since this test's purpose is "does a real subscription actually get a job." Quiet
  // hours are also disabled deterministically (quietStart===quietEnd never matches) since this
  // test doesn't mock `now` and shouldn't be sensitive to the real wall-clock time it happens
  // to run at.
  store.updateUser(user.id, {
    preferences: { notifyInfo: true, quietStart: "00:00", quietEnd: "00:00" },
  });
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

test("guardian's alert creation still happens, but no push is queued, when the account's default preferences don't allow it (R07)", () => {
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
  // Default preferences have notifyInfo off -- a pass-renewal reminder is info-severity, so
  // this is exactly the review's reproduction (an opted-out category still queued a push job).
  runGuardian(store, user.id, now);
  assert.equal(store.list(user.id, "alert").length, 1, "the alert is still created in-app");
  const jobs = store.db.prepare("SELECT * FROM jobs WHERE kind='push-deliver'").all();
  assert.equal(jobs.length, 0, "but no push job should be queued for an opted-out category");
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
      endpoint: "https://fcm.googleapis.com/fcm/send/same-device",
      keys: validPushKeys(),
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

test("background job drain never overlaps itself, even once a hung handler's lease looks expired (R05)", async (t) => {
  const store = temporaryStore(t);
  const user = store.createGuest();
  store.put(user.id, "push-subscription", {
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
  fanOutPush(store, user.id, alert.id);
  let calls = 0;
  let resolveSend;
  t.mock.method(webpush, "sendNotification", () => {
    calls++;
    return new Promise((resolve) => {
      resolveSend = resolve;
    });
  });
  // A real short drain interval (so several elapse quickly, in real time) combined with a
  // controllable Date.now() (so this can jump straight past the 60s lease boundary without
  // waiting 60 real seconds) reproduces the review's exact scenario: a handler still running
  // when its lease would already look abandoned to a naive reclaim.
  let mockedNow = Date.now();
  t.mock.method(Date, "now", () => mockedNow);
  const { server, stopBackgroundJobs } = createApplication({
    store,
    production: false,
    quiet: true,
    drainIntervalMs: 20,
  });
  try {
    // Let the first drain fire, claim the job, and call the (now permanently hanging) handler.
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(calls, 1);
    // Jump the logical clock well past the 60s default lease -- the still-in-flight job's lease
    // now looks expired to anything that would (wrongly) attempt to reclaim it.
    mockedNow += 120000;
    // Let several more real drain intervals elapse while the handler is still hanging.
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      calls,
      1,
      "an overlapping drain must not re-invoke the handler while it is still in flight",
    );
  } finally {
    resolveSend?.({ statusCode: 201 });
    await stopBackgroundJobs();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a single account is capped at 20 push subscriptions (R03)", async (t) => {
  const store = temporaryStore(t);
  const { server } = createApplication({ store, production: false, quiet: true });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const bootResponse = await fetch(base + "/api/bootstrap");
    const boot = await bootResponse.json();
    const cookie = bootResponse.headers.get("set-cookie").split(";")[0];
    const headers = { "content-type": "application/json", cookie, "x-csrf-token": boot.csrf };
    for (let i = 0; i < 20; i++) {
      const response = await fetch(base + "/api/records/push-subscription", {
        method: "POST",
        headers,
        body: JSON.stringify({
          endpoint: `https://fcm.googleapis.com/fcm/send/device-${i}`,
          keys: validPushKeys(),
        }),
      });
      assert.equal(response.status, 201, `subscription ${i} should be accepted`);
    }
    const overLimit = await fetch(base + "/api/records/push-subscription", {
      method: "POST",
      headers,
      body: JSON.stringify({
        endpoint: "https://fcm.googleapis.com/fcm/send/device-21",
        keys: validPushKeys(),
      }),
    });
    assert.equal(overLimit.status, 429);
    // Re-subscribing an already-registered device (an upsert on its existing endpoint) is not
    // subject to the cap -- only genuinely new subscriptions are.
    const resubscribe = await fetch(base + "/api/records/push-subscription", {
      method: "POST",
      headers,
      body: JSON.stringify({
        endpoint: "https://fcm.googleapis.com/fcm/send/device-0",
        keys: validPushKeys(),
      }),
    });
    assert.equal(resubscribe.status, 201);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
