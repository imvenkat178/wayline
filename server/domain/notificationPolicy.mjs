// R07: the ONE place that decides whether an alert is allowed to interrupt the user outside the
// app -- a push notification, or the foreground Notification the frontend shows while a tab is
// open (see src/App.tsx, which mirrors this same logic since it can't import a server module).
// Used twice on the server: at alert-creation time (guardian.mjs, deciding whether to even
// enqueue a push-delivery job for what it just created) and again at delivery time (push.mjs's
// deliverPush, immediately before actually sending), so a preference changed after the job was
// queued -- or the alert being read in the meantime -- still takes effect. Before this fix those
// two call sites each had their own, inconsistent gating logic (see the review this closes).
//
// This never gates the in-app alert record itself -- store.list(userId,"alert") always shows
// everything guardian created, regardless of notifyCritical/notifyInfo. Opting out of push for a
// category still leaves the alert visible in your in-app history; these preferences only ever
// govern whether it's also allowed to buzz a device or light up a lock screen.
//
// Emergency exception: a critical-severity alert (which, today, only ever means a twin-alert
// critical case or the missed-arrival check-in reminder -- see guardian.mjs) always bypasses
// quiet hours. It still respects notifyCritical (an explicit account-level opt-out is honored
// even for critical alerts -- the review's "always permits critical twin alerts" bug is what
// this closes), but never the quiet-hours suppression, since silencing a safety notification
// overnight defeats its purpose.

// Computes whether `now` falls inside the account's configured quiet-hours window, in the
// account's own configured zone (preferences.timezone) -- not the server process's zone, and not
// assumed to be the same as whatever device happens to be polling. Handles a window that crosses
// midnight (quietStart > quietEnd, e.g. 22:00-07:00) the same way the frontend's pre-R07 check
// already did; DST is handled correctly "for free" because Intl.DateTimeFormat with an IANA
// `timeZone` always returns the real local wall-clock time for that instant, transition or not.
export function isQuietHour(preferences, now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: preferences.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  // Intl can format midnight as "24:00" for hour12:false -- normalize with %24 so the minutes
  // math below never sees an out-of-range hour.
  const minutes = (Number(map.hour) % 24) * 60 + Number(map.minute);
  const [startH, startM] = preferences.quietStart.split(":").map(Number);
  const [endH, endM] = preferences.quietEnd.split(":").map(Number);
  const start = startH * 60 + startM,
    end = endH * 60 + endM;
  return start > end ? minutes >= start || minutes < end : minutes >= start && minutes < end;
}

// The single gate both the creation-time (guardian.mjs) and delivery-time (push.mjs) call sites
// run every alert through before it's allowed to become a push. `alert` needs `severity` and
// `read`; a freshly created alert (guardian.mjs) is never read yet, so passing `read: false`
// there is always correct without a second DB round trip.
export function isNotificationAllowed(alert, preferences, now = Date.now()) {
  if (alert.read) return false;
  const critical = alert.severity === "critical";
  if (critical) return Boolean(preferences.notifyCritical);
  if (!preferences.notifyInfo) return false;
  return !isQuietHour(preferences, now);
}

// Privacy-conscious default: unless an account opts into `pushDetails` (see catalog.mjs's
// defaultPreferences), a push or foreground notification's visible text is a generic phrase keyed
// by the alert's `kind`, not the real journey/operator detail. Either can surface on a locked
// screen or as an OS-level toast -- a materially different exposure than the in-app alert list
// sitting behind a signed-in session. Shared by push.mjs (service-worker/background path) and,
// in spirit, src/App.tsx (foreground path, which keeps its own copy of this same map since it
// can't import a server module) -- see the review's "foreground notification path independently
// exposes alert.body" finding, which is exactly the inconsistency this closes.
export const GENERIC_BODY = {
  connection: "One of your journeys has a connection alert. Open Wayline for details.",
  accessibility: "An accessibility alert affects one of your journeys. Open Wayline for details.",
  tracking: "One of your journeys has a tracking update. Open Wayline for details.",
  leave: "It's nearly time to leave for an upcoming journey. Open Wayline for details.",
  "check-in": "A check-in reminder needs your attention. Open Wayline for details.",
  commute: "Your usual commute window is coming up. Open Wayline for details.",
  renewal: "One of your passes needs review. Open Wayline for details.",
};
export const GENERIC_TITLE = "Wayline alert";
export const GENERIC_FALLBACK_BODY = "Wayline has an update for you. Open the app for details.";

// The "Sample · " prefix mirrors the foreground path's own labeling (src/notifications.ts) --
// preserved at every detail level, generic included, so a push about a synthetic/illustrative
// journey never reads as a real one even when its title is otherwise the generic phrase.
export function notificationContent(alert, preferences) {
  const detailed = Boolean(preferences.pushDetails);
  const prefix = alert.dataMode === "illustrative" ? "Sample · " : "";
  return {
    title: prefix + (detailed ? alert.title : GENERIC_TITLE),
    body: detailed ? alert.body : (GENERIC_BODY[alert.kind] ?? GENERIC_FALLBACK_BODY),
  };
}
