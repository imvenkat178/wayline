import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { DomainError } from "../domain/journeys.mjs";

// -- Sandbox commerce/payment adapter (roadmap features 34, 39-41 groundwork) --
// This is the ENTIRE "provider" behind the order/quote/hold/confirm/exchange/reconcile state
// machine in server/domain/commerce.mjs and server/commerce-routes.mjs. It never calls a real
// carrier or payment processor, never moves real money, and never issues a real, boardable
// ticket -- every id and timestamp below is synthetic, generated locally. It exists so the
// state machine, idempotency handling, and webhook-signature verification can be built and
// tested now, with exactly one adapter swap -- not a redesign -- once a real, contracted
// provider exists (a signed carrier reseller/API agreement, and a payment processor merchant
// account; see docs/FEATURE_STATUS.md rows 34/39-41 and README's "Known gaps" for what that
// actually takes). This mirrors the same honesty convention `bookingConfirmed` already
// established for journeys (domain/journeys.mjs): a real-sounding field that is always
// reachable here, but only ever synthetic, clearly documented as such at its source.

function webhookSecret() {
  const configured = process.env.SANDBOX_WEBHOOK_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production")
    throw new DomainError("Commerce webhook signing is not configured.", 500);
  // Development-only fallback so the sandbox webhook loop works out of the box without any
  // setup -- never used in production (guarded above), and never a substitute for a real
  // provider's own signing secret once one exists.
  return "sandbox-dev-secret-not-for-real-money";
}

// A deterministic, illustrative price breakdown -- not a real fare or a real service fee.
export function sandboxQuote({ from, to, fareCents }) {
  const feeCents = Math.round(fareCents * 0.03) + 150;
  const now = Date.now();
  return {
    from,
    to,
    fareCents,
    feeCents,
    totalCents: fareCents + feeCents,
    currency: "USD",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 15 * 60000).toISOString(),
    sandbox: true,
  };
}

// Always "succeeds" -- there is no real payment method behind it to decline. Standing in for
// the moment a real processor would place an authorization hold on a card.
export function sandboxAuthorize() {
  return {
    id: `sandbox_auth_${randomUUID()}`,
    authorizedAt: new Date().toISOString(),
    sandbox: true,
  };
}
// Standing in for a real processor capturing a previously authorized hold.
export function sandboxCapture() {
  return {
    id: `sandbox_capture_${randomUUID()}`,
    capturedAt: new Date().toISOString(),
    sandbox: true,
  };
}
// Standing in for a real processor reversing a capture.
export function sandboxRefund() {
  return {
    id: `sandbox_refund_${randomUUID()}`,
    refundedAt: new Date().toISOString(),
    sandbox: true,
  };
}

// HMAC-SHA256 over the raw request body, matching how a real payment/carrier provider signs a
// webhook so the receiving server can prove the request actually came from them and was not
// tampered with in transit. Reuses the same primitive (createHmac + timingSafeEqual) already
// used elsewhere in this codebase for keyed comparisons (see store.mjs's emailHash and password
// verification) rather than inventing a new crypto pattern for this one case.
export function signWebhookPayload(rawBody) {
  return createHmac("sha256", webhookSecret()).update(rawBody).digest("hex");
}

export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (typeof signatureHeader !== "string" || !signatureHeader)
    throw new DomainError("Missing webhook signature.", 401, "INVALID_SIGNATURE");
  const expected = Buffer.from(signWebhookPayload(rawBody), "hex");
  const provided = Buffer.from(signatureHeader, "hex");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided))
    throw new DomainError("Webhook signature does not match.", 401, "INVALID_SIGNATURE");
}
