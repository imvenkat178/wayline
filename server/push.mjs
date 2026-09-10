import webpush from "web-push";
import https from "node:https";
import dns from "node:dns";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { preferences } from "./domain/journeys.mjs";
import { enqueueJob } from "./jobs.mjs";
import { isForbiddenAddress } from "./netGuard.mjs";

// Web Push (RFC 8030) plus VAPID (RFC 8292) needs a keypair identifying this server to each
// browser's push service. This is explicitly NOT a carrier or payment contract -- see the
// roadmap's own note on feature 89 ("not inherently a carrier contract") -- it is a standard,
// self-issued keypair, generated locally with no external account.
const VAPID_FILE = ".vapid-keys.json";

// Privacy-conscious default: unless a user opts into `pushDetails` (see catalog.mjs's
// defaultPreferences and domain/journeys.mjs's preferences() validator), a push notification's
// visible text is a generic phrase keyed by the alert's `kind`, not the real journey/operator
// detail. A push notification can surface on a locked device's screen, which is a materially
// different exposure than the in-app alert list sitting behind a signed-in session.
const GENERIC_BODY = {
  connection: "One of your journeys has a connection alert. Open Wayline for details.",
  accessibility: "An accessibility alert affects one of your journeys. Open Wayline for details.",
  tracking: "One of your journeys has a tracking update. Open Wayline for details.",
  leave: "It's nearly time to leave for an upcoming journey. Open Wayline for details.",
  "check-in": "A check-in reminder needs your attention. Open Wayline for details.",
  commute: "Your usual commute window is coming up. Open Wayline for details.",
  renewal: "One of your passes needs review. Open Wayline for details.",
};
const GENERIC_TITLE = "Wayline alert";
const GENERIC_FALLBACK_BODY = "Wayline has an update for you. Open the app for details.";

// R03 (defense in depth): re-validates the actual DNS-resolved address right before the outbound
// socket connects, so a hostname that passed registration-time validation (server/records.mjs's
// allowlist) but resolves to a private/loopback/link-local address -- a rebound or compromised
// DNS answer, or simply a subscription row written before this check existed -- still can't
// actually be reached. Passed to https.Agent below as `lookup`, which every request made through
// that agent uses in place of the default resolver, so this is the address the connection itself
// uses, not a separate check that a later resolution could disagree with.
export function safeLookup(hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [addresses];
    const allowed = list.filter((a) => !isForbiddenAddress(a.address));
    if (!allowed.length)
      return callback(new Error(`Refusing to connect: ${hostname} has no public address`));
    if (options.all) return callback(null, allowed);
    callback(null, allowed[0].address, allowed[0].family);
  });
}

// A dedicated agent (rather than Node's default global one) so the custom DNS lookup above, and a
// bounded socket count, apply specifically to outbound push delivery.
const pushAgent = new https.Agent({ lookup: safeLookup, keepAlive: false, maxSockets: 10 });

// How long a single delivery attempt may run before it's treated as a failure. Without this, a
// hostile or simply stalled push endpoint could hold a job-processing worker open indefinitely.
const PUSH_TIMEOUT_MS = 10000;

function vapidPath(directory) {
  return join(directory, VAPID_FILE);
}

// Reads the persisted VAPID keypair, generating and persisting one on first use. Mirrors the
// encryption-key bootstrap already used by store.mjs's constructor: a single 0600 file, written
// once with the exclusive "wx" flag (so a concurrent first-boot race fails the write rather than
// silently overwriting a sibling process's freshly generated keys), then only ever read after.
export function vapidKeys(directory) {
  const path = vapidPath(directory);
  if (!existsSync(path)) {
    const { publicKey, privateKey } = webpush.generateVAPIDKeys();
    try {
      writeFileSync(path, JSON.stringify({ publicKey, privateKey }), { mode: 0o600, flag: "wx" });
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
    }
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

let configuredPublicKey = null;

// Sets the process-wide VAPID identity used by every sendPush call below. Idempotent and cheap,
// meant to be called once at server startup (see server.mjs). `subject` is a contact URI a push
// service may use to reach the sender about a misbehaving endpoint; the spec requires a
// `mailto:` or `https:` URI but does not require it to be monitored, so an operator can set
// VAPID_SUBJECT to a real address without that being a prerequisite for push to work at all.
export function configureWebPush(directory, { subject = process.env.VAPID_SUBJECT } = {}) {
  const keys = vapidKeys(directory);
  webpush.setVapidDetails(
    subject || "mailto:wayline-push@example.invalid",
    keys.publicKey,
    keys.privateKey,
  );
  configuredPublicKey = keys.publicKey;
  return keys.publicKey;
}

// The public key the frontend needs for PushManager.subscribe's applicationServerKey. Returns
// null until configureWebPush has run at least once in this process (server.mjs calls it at
// startup before the HTTP server accepts requests, so in practice this is always set by the time
// a request could ask for it).
export function pushPublicKey() {
  return configuredPublicKey;
}

// Sends one push message. Resolves {ok:true} on success, {ok:false, gone:true} when the push
// service reports the subscription no longer exists (HTTP 404/410 -- the browser unsubscribed,
// the endpoint's own TTL expired, etc.), which the caller should treat as "delete this
// subscription, do not retry" rather than a transient failure. Any other error is rethrown so
// the durable job queue's existing backoff/dead-letter handling applies (see jobs.mjs).
export async function sendPush(subscription, payload) {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      { agent: pushAgent, timeout: PUSH_TIMEOUT_MS },
    );
    return { ok: true };
  } catch (e) {
    if (e?.statusCode === 404 || e?.statusCode === 410) return { ok: false, gone: true };
    throw e;
  }
}

// Enqueues one durable "push-deliver" job per subscription the user currently has registered.
// Called from guardian.mjs's add() right after an alert is created, using the exact same
// severity/preference gate that already decided whether to create the in-app alert at all -- so
// push never notifies about something the user opted out of seeing in-app either. A user with no
// subscriptions (push was never enabled on any device) enqueues nothing, which is the common case.
export function fanOutPush(store, userId, alertId) {
  for (const sub of store.list(userId, "push-subscription"))
    enqueueJob(store, "push-deliver", { userId, alertId, subscriptionId: sub.id }, { userId });
}

// The "push-deliver" job handler, registered in server.mjs's jobHandlers map under the
// "push-deliver" kind. Looks up the alert and subscription fresh at delivery time -- not at
// enqueue time -- so an alert that was read/expired, or a subscription that was already removed
// by an earlier delivery's "gone" cleanup, is handled as a no-op rather than an error.
export async function deliverPush(store, { userId, alertId, subscriptionId }) {
  let alert;
  try {
    alert = store.get(userId, alertId, "alert");
  } catch {
    return;
  }
  let subscription;
  try {
    subscription = store.get(userId, subscriptionId, "push-subscription");
  } catch {
    return;
  }
  const p = preferences(store.user(userId)?.preferences);
  const detailed = Boolean(p.pushDetails);
  const result = await sendPush(subscription, {
    title: detailed ? alert.title : GENERIC_TITLE,
    body: detailed ? alert.body : (GENERIC_BODY[alert.kind] ?? GENERIC_FALLBACK_BODY),
    severity: alert.severity,
    alertId,
    journeyId: alert.journeyId ?? null,
  });
  if (result.gone) {
    try {
      store.remove(userId, subscriptionId);
    } catch {
      // Already gone from a concurrent cleanup -- fine.
    }
  }
}
