import { DomainError, text, integer } from "./domain/journeys.mjs";
import { isAllowedPushHost } from "./netGuard.mjs";
export function validTime(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new DomainError(`Enter a valid ${label}.`);
  return new Date(value).toISOString();
}
// A ticket's optional attached document: the photo itself (base64), never verified against
// any issuer system. Bounded well under the request-body cap server.mjs allows specifically
// for this endpoint (8,000,000 bytes of raw JSON, itself sized for a base64-inflated ~5 MB
// photo) so one oversized upload can't be used to balloon a single record indefinitely.
function validateTicketDocument(doc) {
  if (doc === undefined || doc === null) return null;
  if (typeof doc !== "object" || Array.isArray(doc))
    throw new DomainError("Invalid ticket document.");
  const name = text(doc.name, "Document name", 200);
  const type = text(doc.type, "Document type", 100);
  if (typeof doc.base64 !== "string" || !doc.base64)
    throw new DomainError("Document data is required.");
  if (doc.base64.length > 7_000_000) throw new DomainError("Document is too large.");
  if (!/^[A-Za-z0-9+/]+=*$/.test(doc.base64)) throw new DomainError("Invalid document data.");
  return { name, type, base64: doc.base64 };
}
// R03: a push subscription's `endpoint` is a URL this server will later make an unauthenticated
// outbound HTTPS request to, on its own initiative, whenever an alert fires (see
// server/push.mjs's sendPush) -- so accepting an arbitrary one from a guest session is a
// server-side request forgery primitive, not just an odd input. Every check below narrows this
// down to "looks like a real browser push service" rather than merely "isn't an obviously-private
// address" (see server/netGuard.mjs for the shared allowlist and the complementary DNS-resolved
// re-check push.mjs does right before it actually connects).
function validatePushEndpoint(raw) {
  if (typeof raw !== "string" || !raw || raw.length > 500)
    throw new DomainError("Push endpoint is invalid.");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new DomainError("Push endpoint is invalid.");
  }
  if (url.protocol !== "https:") throw new DomainError("Push endpoint must use HTTPS.");
  if (url.username || url.password)
    throw new DomainError("Push endpoint must not include credentials.");
  if (url.port && url.port !== "443")
    throw new DomainError("Push endpoint uses an unapproved port.");
  if (!isAllowedPushHost(url.hostname))
    throw new DomainError("Push endpoint is not a supported browser push service.");
  return url.toString();
}
// Validates a Web Push key (p256dh or auth, RFC 8291) as base64url of exactly the byte length
// the spec requires -- a "malformed key" (wrong length, wrong alphabet, or plain junk) is
// rejected at registration rather than surfacing later as an obscure encryption failure at
// delivery time. p256dh additionally must start with 0x04, the uncompressed-EC-point marker
// every real subscription's key has.
function validatePushKey(raw, label, expectedBytes, { uncompressedPoint = false } = {}) {
  if (typeof raw !== "string" || !raw) throw new DomainError(`${label} is required.`);
  if (raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw))
    throw new DomainError(`${label} is malformed.`);
  const decoded = Buffer.from(raw, "base64url");
  if (decoded.length !== expectedBytes) throw new DomainError(`${label} is malformed.`);
  if (uncompressedPoint && decoded[0] !== 0x04) throw new DomainError(`${label} is malformed.`);
  return raw;
}
export function validateRecord(kind, b) {
  if (kind === "favorite")
    return {
      name: text(b.name, "Shortcut name", 60),
      from: text(b.from, "Origin", 30),
      to: text(b.to, "Destination", 30),
    };
  if (kind === "traveler")
    return {
      name: text(b.name, "Name", 100),
      fareClass: ["adult", "student", "senior", "military", "accessibility", "child"].includes(
        b.fareClass,
      )
        ? b.fareClass
        : "adult",
      assistance: Boolean(b.assistance),
      verification: "not verified",
    };
  if (kind === "contact")
    return {
      name: text(b.name, "Name", 100),
      contact: text(b.contact, "Contact address or number", 200),
      consent: Boolean(b.consent),
      delivery: "not configured",
    };
  if (kind === "commute") {
    const days = b.days;
    if (
      !Array.isArray(days) ||
      !days.length ||
      days.some((x) => !Number.isInteger(x) || x < 0 || x > 6)
    )
      throw new DomainError("Choose valid commute days.");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time ?? ""))
      throw new DomainError("Choose a valid commute time.");
    const timezone = text(b.timezone ?? "America/Los_Angeles", "Timezone", 80);
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      throw new DomainError("Invalid timezone.");
    }
    return {
      name: text(b.name, "Commute name", 60),
      from: text(b.from, "Origin", 30),
      to: text(b.to, "Destination", 30),
      time: b.time,
      days: [...new Set(days)],
      enabled: b.enabled !== false,
      timezone,
    };
  }
  if (kind === "pass")
    return {
      name: text(b.name, "Pass name", 80),
      operator: text(b.operator, "Operator", 80),
      costCents: integer(b.costCents, "Cost", 0, 100000),
      renewal: validTime(b.renewal, "renewal date"),
      autoRenew: Boolean(b.autoRenew),
      source: "self-reported",
    };
  if (kind === "ticket")
    return {
      operator: text(b.operator, "Operator", 80),
      service: text(b.service, "Service", 80),
      confirmation: text(b.confirmation, "Confirmation code", 100),
      passenger: text(b.passenger, "Passenger", 100),
      departure: validTime(b.departure, "departure time"),
      origin: text(b.origin, "Origin", 160),
      destination: text(b.destination, "Destination", 160),
      seat: String(b.seat ?? "").slice(0, 40),
      coach: String(b.coach ?? "").slice(0, 40),
      platform: String(b.platform ?? "").slice(0, 40),
      journeyId: String(b.journeyId ?? "").slice(0, 100),
      // Optional, self-reported: what the traveler says they actually paid. There is no
      // payment integration anywhere in this codebase (bookingConfirmed is never set true),
      // so this is the only amount-paid data available at all; recovery economics uses it,
      // when present, in place of the abstract itinerary estimate (see recoveryCost()).
      paidCents:
        b.paidCents === undefined || b.paidCents === null
          ? null
          : integer(b.paidCents, "Paid amount", 0, 1000000),
      validity: "self-reported",
      // Roadmap feature 18/19 (Phase 6): a ticket can now optionally carry a barcode decoded
      // client-side from an attached photo (QR/PDF417/Aztec/Code128/Data Matrix -- open
      // standards, decoded entirely in the browser, see src/components/TicketImport.tsx) and
      // the photo itself, base64-encoded and encrypted at rest the same as every other record.
      // None of this is verified against any issuer or carrier system -- it is exactly as
      // "unverified" as a manually typed confirmation code, just with more evidence attached.
      barcodeFormat: b.barcodeFormat ? text(b.barcodeFormat, "Barcode format", 20) : null,
      barcodeText: b.barcodeText ? text(b.barcodeText, "Barcode payload", 2000) : null,
      document: validateTicketDocument(b.document),
      source: b.document
        ? "document import (photo + decoded barcode when detected); not verified by operator"
        : "manual import; not verified by operator",
    };
  if (kind === "report") {
    const types = [
      "bus-missing",
      "stop-moved",
      "elevator-broken",
      "boarding-location",
      "crowding",
      "on-board",
    ];
    if (!types.includes(b.type)) throw new DomainError("Choose a report type.");
    if (!b.consent) throw new DomainError("Consent is required to contribute a report.");
    return {
      type: b.type,
      station: text(b.station, "Station or stop", 160),
      service: text(b.service, "Service", 80),
      note: String(b.note ?? "").slice(0, 1000),
      consent: true,
      source: "unverified rider report",
      // confidence/confirmations start at their honest defaults here (pure validation has no
      // database access); router.mjs's report-creation handler immediately overwrites both with
      // a real distinct-contributor count via store.reportConfirmations() before this ever
      // reaches storage -- see server/store.mjs for what "confidence weighting" means in
      // practice (roadmap feature 99). status/resolutionNote/moderatedAt are the report
      // lifecycle fields moderateReport() updates; every new report starts "open" and
      // unresolved.
      confidence: null,
      confirmations: 0,
      status: "open",
      resolutionNote: null,
      moderatedAt: null,
      observedAt: new Date().toISOString(),
    };
  }
  if (kind === "push-subscription")
    return {
      // A Web Push subscription (see server/push.mjs): the push service endpoint URL plus the
      // two keys PushManager.subscribe() returns, needed to encrypt each message per RFC 8291.
      // Stored via the same encrypted, owner-scoped `records` table every other kind uses, keyed
      // by endpoint (server/router.mjs upserts on endpoint so re-subscribing the same device
      // updates in place instead of accumulating duplicates).
      endpoint: validatePushEndpoint(b.endpoint),
      p256dh: validatePushKey(b.keys?.p256dh ?? b.p256dh, "Push key", 65, {
        uncompressedPoint: true,
      }),
      auth: validatePushKey(b.keys?.auth ?? b.auth, "Push auth secret", 16),
      userAgent: String(b.userAgent ?? "").slice(0, 200),
    };
  throw new DomainError("Unsupported record type.");
}
export function receipt(j) {
  return {
    journeyId: j.id,
    from: j.from,
    to: j.to,
    state: j.state,
    dataMode: j.dataMode,
    scheduled: { departure: j.departure, arrival: j.arrival },
    price: j.price,
    events: j.events ?? [],
    issuedAt: new Date().toISOString(),
    notice: "Journey record, not a carrier-issued ticket or tax invoice.",
  };
}
