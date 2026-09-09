import { randomUUID } from "node:crypto";
import { DomainError, text } from "./domain/journeys.mjs";
import { hashToken } from "./store.mjs";
import { transitionOrder, validateQuoteRequest, validateOrderRequest } from "./domain/commerce.mjs";
import {
  sandboxQuote,
  sandboxAuthorize,
  sandboxCapture,
  sandboxRefund,
  verifyWebhookSignature,
} from "./adapters/payments.mjs";

// Sandbox commerce scaffolding (roadmap features 34, 39-41 groundwork -- see
// adapters/payments.mjs and domain/commerce.mjs for what "sandbox" means here: no real carrier
// or payment integration exists anywhere in this codebase). Quotes and orders are stored as
// ordinary `quote`/`order` kinds in the existing per-user records table -- no new table needed,
// the same way `journey`/`ticket`/`pass` already share it -- but routed here, not through the
// generic /api/records/:kind handler in router.mjs, because creating and transitioning an order
// needs real business logic (idempotency, the state machine, payment calls), not just field
// validation and a blind put().
export async function commerceRoutes({ req, res, url, b, store, session, send }) {
  const userId = session.userId;
  if (url.pathname === "/api/commerce/quotes" && req.method === "POST") {
    const request = validateQuoteRequest(b);
    const quote = sandboxQuote(request);
    const stored = store.put(userId, "quote", quote, {
      expiresAt: Date.parse(quote.expiresAt),
    });
    return send(res, 201, stored);
  }
  if (url.pathname === "/api/commerce/orders" && req.method === "GET")
    return send(res, 200, store.list(userId, "order"));
  // Idempotent order creation -- identical pattern to POST /api/journeys in router.mjs: a
  // required Idempotency-Key header, a hash of the meaningful request fields, and a replay of
  // the prior result if the same key comes back with the same request. Placing a sandbox
  // "hold" (authorization) is the only side effect at this step; capturing funds only happens
  // on an explicit /confirm below, matching how a real payment flow separates authorize/capture.
  if (url.pathname === "/api/commerce/orders" && req.method === "POST") {
    const key = text(req.headers["idempotency-key"], "Idempotency key", 100);
    const { quoteId, passenger, journeyId } = validateOrderRequest(b);
    const requestHash = hashToken(JSON.stringify({ quoteId, passenger, journeyId }));
    const result = store.transaction(() => {
      const prior = store.list(userId, "idempotency").find((x) => x.key === key);
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw new DomainError("Idempotency key was used for a different request.", 409);
        return store.get(userId, prior.orderId, "order");
      }
      const quote = store.get(userId, quoteId, "quote");
      if (journeyId) store.get(userId, journeyId, "journey"); // must exist and be owned
      const authorization = sandboxAuthorize();
      const order = store.put(
        userId,
        "order",
        {
          quote,
          passenger,
          journeyId,
          authorization,
          state: "HELD",
          sandbox: true,
          events: [
            {
              id: randomUUID(),
              type: "STATE_CHANGED",
              from: null,
              to: "HELD",
              at: new Date().toISOString(),
            },
          ],
        },
        { expiresAt: Date.now() + 30 * 86400000 },
      );
      store.put(
        userId,
        "idempotency",
        { key, requestHash, orderId: order.id },
        { expiresAt: Date.now() + 86400000 },
      );
      return order;
    });
    return send(res, 201, result);
  }
  const m = url.pathname.match(/^\/api\/commerce\/orders\/([^/]+)\/(confirm|exchange|cancel)$/);
  if (m && req.method === "POST") {
    const [, id, action] = m;
    const order = store.get(userId, id, "order");
    if (action === "confirm") {
      const capture = sandboxCapture();
      const next = transitionOrder(order, "CONFIRMED");
      return send(
        res,
        200,
        store.put(userId, "order", { ...next, capture }, { id, expectedVersion: order.version }),
      );
    }
    if (action === "cancel") {
      const refund = order.capture ? sandboxRefund() : null;
      const next = transitionOrder(order, "CANCELLED");
      return send(
        res,
        200,
        store.put(userId, "order", { ...next, refund }, { id, expectedVersion: order.version }),
      );
    }
    if (action === "exchange") {
      const quoteId = text(b.quoteId, "Quote", 100);
      const quote = store.get(userId, quoteId, "quote");
      const next = transitionOrder(order, "EXCHANGED");
      return send(
        res,
        200,
        store.put(userId, "order", { ...next, quote }, { id, expectedVersion: order.version }),
      );
    }
  }
  throw new DomainError("Endpoint not found.", 404);
}

// Resolves a sandbox settlement event against the order it settles, without a user session --
// a real provider's webhook has no session cookie, only whatever opaque id it was told to
// reference. `systemGetOrder` (store.mjs) is the one place order lookup is intentionally NOT
// scoped by userId, for exactly this reason; it is never reachable from a routed per-user
// endpoint. Called only after verifyWebhookSignature has already confirmed authenticity.
export function reconcileOrder(store, event) {
  const orderId = typeof event?.orderId === "string" ? event.orderId : null;
  const settlementId = typeof event?.settlementId === "string" ? event.settlementId : null;
  if (!orderId || !settlementId)
    throw new DomainError("Malformed settlement event.", 400, "INVALID_EVENT");
  const { userId, order } = store.systemGetOrder(orderId);
  const settlement = {
    settlementId,
    status: typeof event.status === "string" ? event.status : "settled",
    receivedAt: new Date().toISOString(),
  };
  const next = transitionOrder({ ...order, settlement }, "RECONCILED");
  return store.put(userId, "order", next, { id: order.id, expectedVersion: order.version });
}

// The webhook endpoint itself: unauthenticated (no session, no CSRF -- a provider callback
// can't carry either), reached from server.mjs before the normal /api/ session gate, exactly
// like the existing public /api/shared/:token route. Reads the raw body itself (rather than the
// shared body() helper in server.mjs, which only returns already-parsed JSON) because signature
// verification must run over the exact bytes that were signed, not a re-serialized copy.
export async function handleCommerceWebhook({ req, res, store, send }) {
  let length = 0;
  const parts = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 100_000) throw new DomainError("Request is too large.", 413);
    parts.push(chunk);
  }
  const raw = Buffer.concat(parts).toString("utf8");
  verifyWebhookSignature(raw, req.headers["x-sandbox-signature"]);
  let event;
  try {
    event = JSON.parse(raw || "{}");
  } catch {
    throw new DomainError("Invalid JSON body.", 400);
  }
  const order = reconcileOrder(store, event);
  return send(res, 200, { ok: true, orderId: order.id, state: order.state });
}
