import type { Alert, Preferences } from "./types";

// R07: the frontend's foreground notification path (App.tsx, shown while a tab is open) and the
// server's push path (server/push.mjs, server/guardian.mjs) each decide independently whether
// and how to notify -- they're different runtimes (bundled TypeScript/React here, plain Node
// ESM there) that can't share a module directly, which is exactly how they drifted before this
// fix (the review's "notification preferences and device privacy are inconsistent" finding: the
// foreground path exposed alert.body regardless of pushDetails, and used the browser's own clock
// for quiet hours instead of the account's saved zone). This module is the frontend half of the
// same policy server/domain/notificationPolicy.mjs implements -- kept in sync by hand, with each
// side covered by its own tests against the same review reproduction.

export const GENERIC_TITLE = "Wayline alert";
export const GENERIC_FALLBACK_BODY = "Wayline has an update for you. Open the app for details.";
export const GENERIC_BODY: Record<string, string> = {
  connection: "One of your journeys has a connection alert. Open Wayline for details.",
  accessibility: "An accessibility alert affects one of your journeys. Open Wayline for details.",
  tracking: "One of your journeys has a tracking update. Open Wayline for details.",
  leave: "It's nearly time to leave for an upcoming journey. Open Wayline for details.",
  "check-in": "A check-in reminder needs your attention. Open Wayline for details.",
  commute: "Your usual commute window is coming up. Open Wayline for details.",
  renewal: "One of your passes needs review. Open Wayline for details.",
};

// Applies the same generic-versus-detailed rule the server already applies to a push payload
// (server/domain/notificationPolicy.mjs's notificationContent) to the foreground OS
// notification -- before this fix, the foreground path always showed the real alert.title/body,
// ignoring pushDetails entirely. The "Sample · " prefix is preserved at every detail level,
// generic included, matching the server side, so a synthetic/illustrative alert never reads as a
// real one.
export function notificationContent(alert: Alert, preferences: Preferences) {
  const detailed = Boolean(preferences.pushDetails);
  const prefix = alert.dataMode === "illustrative" ? "Sample · " : "";
  return {
    title: prefix + (detailed ? alert.title : GENERIC_TITLE),
    body: detailed ? alert.body : (GENERIC_BODY[alert.kind] ?? GENERIC_FALLBACK_BODY),
  };
}

// Same math as server/domain/notificationPolicy.mjs's isQuietHour, evaluated against the
// account's saved preferences.timezone rather than this device's own clock -- a push is
// delivered by the server, possibly while this device is asleep, so the two paths have to agree
// on what "quiet hours" means using the same saved zone, not whichever device happens to be
// polling right now. Handles a window crossing midnight, and DST transitions "for free" the same
// way the server side does: Intl.DateTimeFormat with an IANA timeZone always returns the real
// local wall-clock time for that instant.
export function isQuietHour(preferences: Preferences, now: Date | number = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: preferences.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minutes = (Number(map.hour) % 24) * 60 + Number(map.minute);
  const [startH, startM] = preferences.quietStart.split(":").map(Number);
  const [endH, endM] = preferences.quietEnd.split(":").map(Number);
  const start = startH * 60 + startM,
    end = endH * 60 + endM;
  return start > end ? minutes >= start || minutes < end : minutes >= start && minutes < end;
}

// Mirrors server/domain/notificationPolicy.mjs's isNotificationAllowed exactly: a critical alert
// always bypasses quiet hours (the same "emergency exception" reasoning) but still respects
// notifyCritical; a non-critical alert needs notifyInfo and is suppressed during quiet hours; a
// read alert never re-notifies.
export function isNotificationAllowed(
  alert: Alert,
  preferences: Preferences,
  now: Date | number = new Date(),
): boolean {
  if (alert.read) return false;
  const critical = alert.severity === "critical";
  if (critical) return Boolean(preferences.notifyCritical);
  if (!preferences.notifyInfo) return false;
  return !isQuietHour(preferences, now);
}
