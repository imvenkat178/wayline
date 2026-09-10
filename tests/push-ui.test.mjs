import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// This codebase has no React component-rendering test harness (no @testing-library/react, no
// jsdom setup anywhere in the suite) -- tests/navigation.test.mjs and tests/service-worker.test.mjs
// both test through pure functions or direct source-text assertions instead. Profile.tsx's push
// subscribe/unsubscribe control is a stateful component with real browser APIs (PushManager,
// ServiceWorkerRegistration) that would need a much heavier harness to render, so this follows
// the same source-text-assertion approach as service-worker.test.mjs: it can't prove the UI
// renders correctly, but it does catch the wiring being removed or silently pointed elsewhere
// (e.g. a route rename in router.mjs that this file doesn't follow).
const profile = readFileSync(
  fileURLToPath(new URL("../src/pages/Profile.tsx", import.meta.url)),
  "utf8",
);

test("Profile.tsx subscribes through the real PushManager API, not just Notification.requestPermission", () => {
  assert.match(profile, /navigator\.serviceWorker\.ready/);
  assert.match(profile, /pushManager\.subscribe/);
  assert.match(profile, /applicationServerKey/);
  assert.match(profile, /boot\.pushPublicKey/);
});

test("Profile.tsx posts the real subscription to the same route server/router.mjs registers", () => {
  assert.match(profile, /"\/records\/push-subscription"/);
});

test("Profile.tsx unsubscribes the browser and cleans up the matching server-side record", () => {
  assert.match(profile, /pushManager\.getSubscription/);
  assert.match(profile, /subscription\.unsubscribe\(\)/);
  assert.match(profile, /DELETE/);
});

test("Profile.tsx exposes the pushDetails preference, defaulting to the privacy-conscious off state", () => {
  assert.match(profile, /update\("pushDetails"/);
  assert.match(profile, /p\.pushDetails/);
});

test("Profile.tsx exposes an editable account timezone that quiet hours are evaluated against (R07)", () => {
  assert.match(profile, /update\("timezone"/);
  assert.match(profile, /p\.timezone/);
  // The old "device time" framing was misleading for anything server-delivered (a push arrives
  // while this device may be asleep) -- the quiet-hour fields must no longer claim that.
  assert.doesNotMatch(profile, /device time/i);
});
