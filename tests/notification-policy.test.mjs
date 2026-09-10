import test from "node:test";
import assert from "node:assert/strict";
import {
  isQuietHour,
  isNotificationAllowed,
  notificationContent,
  GENERIC_TITLE,
  GENERIC_BODY,
  GENERIC_FALLBACK_BODY,
} from "../server/domain/notificationPolicy.mjs";

// R07: server/domain/notificationPolicy.mjs is the ONE function guardian.mjs (creation) and
// push.mjs (delivery) both run every alert through. These tests cover the policy directly,
// independent of either call site, against the review's own reproduction and acceptance checks.

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

// A fixed instant well inside 22:00-07:00 Los Angeles time (11pm PDT) and one well outside it
// (2pm PDT), so these tests never depend on the real wall-clock time they happen to run at.
const QUIET_INSTANT = Date.parse("2026-01-15T07:00:00Z"); // 23:00 PST (UTC-8) on the 14th
const AWAKE_INSTANT = Date.parse("2026-01-15T22:00:00Z"); // 14:00 PST on the 15th

test("isQuietHour is true inside the window and false outside it, for a window crossing midnight", () => {
  assert.equal(isQuietHour(prefs(), QUIET_INSTANT), true);
  assert.equal(isQuietHour(prefs(), AWAKE_INSTANT), false);
});

test("isQuietHour handles a window that does NOT cross midnight the same way", () => {
  const p = prefs({ quietStart: "12:00", quietEnd: "18:00" });
  const inside = Date.parse("2026-01-15T22:00:00Z"); // 14:00 PST
  const outside = Date.parse("2026-01-15T07:00:00Z"); // 23:00 PST (previous day)
  assert.equal(isQuietHour(p, inside), true);
  assert.equal(isQuietHour(p, outside), false);
});

test("isQuietHour uses the account's saved timezone, not the process's own zone", () => {
  // The same instant reads as two different local times in two different zones -- 11pm in Los
  // Angeles is already 7am the next day in London, well outside a 22:00-07:00 window there.
  const la = prefs({ timezone: "America/Los_Angeles" });
  const london = prefs({ timezone: "Europe/London" });
  assert.equal(isQuietHour(la, QUIET_INSTANT), true);
  assert.equal(isQuietHour(london, QUIET_INSTANT), false);
});

test("isQuietHour is correct across a daylight-saving transition, not just a fixed UTC offset", () => {
  const p = prefs({ timezone: "America/Los_Angeles", quietStart: "22:00", quietEnd: "07:00" });
  // After the US spring-forward date (2026-03-08), Los Angeles is on PDT (UTC-7), not PST
  // (UTC-8). 2026-04-01T14:15:00Z is 07:15 local in PDT -- just past the 07:00 quiet-hours end,
  // so the correct answer is "not quiet." A calculation that used a fixed UTC-8 offset instead
  // of the real DST-aware zone would compute 06:15 local and wrongly call this still quiet --
  // exactly the class of bug Intl.DateTimeFormat's real timeZone support avoids.
  const justAfterQuietEnds = Date.parse("2026-04-01T14:15:00Z");
  assert.equal(isQuietHour(p, justAfterQuietEnds), false);
});

test("isNotificationAllowed: a critical alert is suppressed by notifyCritical off, but never by quiet hours (the emergency exception)", () => {
  const alert = { severity: "critical", read: false };
  assert.equal(isNotificationAllowed(alert, prefs(), QUIET_INSTANT), true);
  assert.equal(
    isNotificationAllowed(alert, prefs({ notifyCritical: false }), AWAKE_INSTANT),
    false,
  );
  assert.equal(
    isNotificationAllowed(alert, prefs({ notifyCritical: true }), QUIET_INSTANT),
    true,
    "critical bypasses quiet hours",
  );
});

test("isNotificationAllowed: a non-critical alert needs notifyInfo AND is suppressed during quiet hours (the review's exact reproduction)", () => {
  const alert = { severity: "warning", read: false };
  assert.equal(
    isNotificationAllowed(alert, prefs({ notifyInfo: false }), AWAKE_INSTANT),
    false,
    "notifyInfo off suppresses it even outside quiet hours",
  );
  assert.equal(
    isNotificationAllowed(alert, prefs({ notifyInfo: true }), QUIET_INSTANT),
    false,
    "quiet hours suppress it even with notifyInfo on",
  );
  assert.equal(isNotificationAllowed(alert, prefs({ notifyInfo: true }), AWAKE_INSTANT), true);
});

test("isNotificationAllowed: a read alert never re-notifies, regardless of every other preference", () => {
  const alert = { severity: "critical", read: true };
  assert.equal(isNotificationAllowed(alert, prefs({ notifyCritical: true }), AWAKE_INSTANT), false);
});

test("notificationContent: generic by default, real content once pushDetails is on", () => {
  const alert = { title: "Real title", body: "Real body.", kind: "renewal" };
  const generic = notificationContent(alert, prefs({ pushDetails: false }));
  assert.equal(generic.title, GENERIC_TITLE);
  assert.equal(generic.body, GENERIC_BODY.renewal);
  const detailed = notificationContent(alert, prefs({ pushDetails: true }));
  assert.equal(detailed.title, "Real title");
  assert.equal(detailed.body, "Real body.");
});

test("notificationContent: an unrecognized alert kind falls back to the generic fallback body, never crashes", () => {
  const alert = { title: "t", body: "b", kind: "some-future-kind" };
  const content = notificationContent(alert, prefs({ pushDetails: false }));
  assert.equal(content.body, GENERIC_FALLBACK_BODY);
});

test("notificationContent: sample/illustrative labeling survives at every detail level", () => {
  const alert = {
    title: "Real title",
    body: "Real body.",
    kind: "renewal",
    dataMode: "illustrative",
  };
  const generic = notificationContent(alert, prefs({ pushDetails: false }));
  const detailed = notificationContent(alert, prefs({ pushDetails: true }));
  assert.match(generic.title, /^Sample · /);
  assert.match(detailed.title, /^Sample · /);
});
