import test from "node:test";
import assert from "node:assert/strict";
import {
  isQuietHour,
  isNotificationAllowed,
  notificationContent,
  GENERIC_TITLE,
  GENERIC_BODY,
  GENERIC_FALLBACK_BODY,
} from "../src/notifications.ts";

// R07: src/notifications.ts is the frontend half of the notification policy -- it mirrors
// server/domain/notificationPolicy.mjs by hand (different runtimes can't share a module
// directly). These tests are the direct TypeScript-side counterpart to
// tests/notification-policy.test.mjs, run against the exact same fixed instants and
// preferences, so a mismatch between the two implementations shows up as one side's test
// failing to match the other's documented expectation, not as silent drift in production.

function prefs(overrides = {}) {
  return {
    notifyCritical: true,
    notifyInfo: false,
    pushDetails: false,
    quietStart: "22:00",
    quietEnd: "07:00",
    timezone: "America/Los_Angeles",
    ...overrides,
  };
}

const QUIET_INSTANT = Date.parse("2026-01-15T07:00:00Z"); // 23:00 PST on the 14th
const AWAKE_INSTANT = Date.parse("2026-01-15T22:00:00Z"); // 14:00 PST on the 15th

test("isQuietHour is true inside the window and false outside it, for a window crossing midnight", () => {
  assert.equal(isQuietHour(prefs(), QUIET_INSTANT), true);
  assert.equal(isQuietHour(prefs(), AWAKE_INSTANT), false);
});

test("isQuietHour uses the account's saved timezone, not this device's own clock", () => {
  const la = prefs({ timezone: "America/Los_Angeles" });
  const london = prefs({ timezone: "Europe/London" });
  assert.equal(isQuietHour(la, QUIET_INSTANT), true);
  assert.equal(isQuietHour(london, QUIET_INSTANT), false);
});

test("isQuietHour is correct across a daylight-saving transition", () => {
  const p = prefs({ timezone: "America/Los_Angeles" });
  // See tests/notification-policy.test.mjs for the full reasoning -- 07:15 local PDT, just past
  // a 07:00 quiet-hours end, which a fixed-offset (non-DST-aware) calculation would get wrong.
  const justAfterQuietEnds = Date.parse("2026-04-01T14:15:00Z");
  assert.equal(isQuietHour(p, justAfterQuietEnds), false);
});

test("isNotificationAllowed: critical bypasses quiet hours but still respects notifyCritical", () => {
  const alert = { severity: "critical", read: false };
  assert.equal(isNotificationAllowed(alert, prefs(), QUIET_INSTANT), true);
  assert.equal(
    isNotificationAllowed(alert, prefs({ notifyCritical: false }), AWAKE_INSTANT),
    false,
  );
});

test("isNotificationAllowed: non-critical needs notifyInfo and is suppressed during quiet hours", () => {
  const alert = { severity: "info", read: false };
  assert.equal(isNotificationAllowed(alert, prefs({ notifyInfo: false }), AWAKE_INSTANT), false);
  assert.equal(isNotificationAllowed(alert, prefs({ notifyInfo: true }), QUIET_INSTANT), false);
  assert.equal(isNotificationAllowed(alert, prefs({ notifyInfo: true }), AWAKE_INSTANT), true);
});

test("isNotificationAllowed: a read alert never re-notifies", () => {
  const alert = { severity: "critical", read: true };
  assert.equal(isNotificationAllowed(alert, prefs(), AWAKE_INSTANT), false);
});

test("notificationContent: generic by default (this is the exact bug R07 closes -- the foreground path used to always show the real title/body)", () => {
  const alert = {
    title: "Real secret operator detail",
    body: "A real disruption.",
    kind: "renewal",
  };
  const generic = notificationContent(alert, prefs({ pushDetails: false }));
  assert.equal(generic.title, GENERIC_TITLE);
  assert.equal(generic.body, GENERIC_BODY.renewal);
  assert.doesNotMatch(generic.body, /disruption/);
});

test("notificationContent: real content once pushDetails is on", () => {
  const alert = { title: "Real title", body: "Real body.", kind: "renewal" };
  const detailed = notificationContent(alert, prefs({ pushDetails: true }));
  assert.equal(detailed.title, "Real title");
  assert.equal(detailed.body, "Real body.");
});

test("notificationContent: an unrecognized kind falls back to the generic fallback body", () => {
  const alert = { title: "t", body: "b", kind: "some-future-kind" };
  assert.equal(notificationContent(alert, prefs()).body, GENERIC_FALLBACK_BODY);
});

test("notificationContent: sample/illustrative labeling survives at every detail level, matching the server side", () => {
  const alert = { title: "Real", body: "Real body", kind: "renewal", dataMode: "illustrative" };
  assert.match(notificationContent(alert, prefs({ pushDetails: false })).title, /^Sample · /);
  assert.match(notificationContent(alert, prefs({ pushDetails: true })).title, /^Sample · /);
});
