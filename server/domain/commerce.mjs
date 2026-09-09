import { randomUUID } from "node:crypto";
import { DomainError, text, integer } from "./journeys.mjs";
import { cities } from "../catalog.mjs";

// -- Sandbox commerce state machine (roadmap features 34, 39-41 groundwork) --
// Mirrors journeys.mjs's own pattern (see its `transitions` map and `transition()`): a plain
// adjacency map plus a pure function that throws on an illegal move and appends an event to a
// persisted history, instead of a bespoke check per endpoint. There is no real carrier or
// payment integration behind any of this -- see adapters/payments.mjs's header comment -- every
// state below is reachable using only that sandbox adapter's synthetic responses; a real
// integration would plug into the same transitions without changing this file.
export const orderTransitions = {
  HELD: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["EXCHANGED", "CANCELLED", "RECONCILED"],
  EXCHANGED: ["CANCELLED", "RECONCILED"],
  CANCELLED: [],
  RECONCILED: [],
};

export function transitionOrder(order, next, now = Date.now()) {
  if (!orderTransitions[order.state]?.includes(next))
    throw new DomainError(`Cannot move from ${order.state} to ${next}.`, 409, "INVALID_TRANSITION");
  // Mirrors journeys.mjs's bookingConfirmed guard: CONFIRMED requires an authorization the
  // sandbox adapter actually issued, not a client-supplied claim that payment happened.
  if (next === "CONFIRMED" && !order.authorization)
    throw new DomainError(
      "A payment authorization is required before confirming an order.",
      409,
      "PAYMENT_REQUIRED",
    );
  // RECONCILED is reachable only through the signed webhook handler (see commerce-routes.mjs's
  // reconcileOrder), which is the only caller that ever attaches `settlement` -- never accepted
  // directly from a client request body.
  if (next === "RECONCILED" && !order.settlement)
    throw new DomainError(
      "Reconciliation requires a verified settlement event.",
      409,
      "SETTLEMENT_REQUIRED",
    );
  return {
    ...order,
    state: next,
    updatedAt: new Date(now).toISOString(),
    events: [
      ...(order.events ?? []),
      {
        id: randomUUID(),
        type: "STATE_CHANGED",
        from: order.state,
        to: next,
        at: new Date(now).toISOString(),
      },
    ],
  };
}

export function validateQuoteRequest(b) {
  const from = text(b.from, "Origin", 60);
  const to = text(b.to, "Destination", 60);
  if (!cities.some((c) => c.id === from) || !cities.some((c) => c.id === to) || from === to)
    throw new DomainError("Choose different supported endpoints.");
  const fareCents = integer(b.fareCents, "Fare", 100, 200000);
  return { from, to, fareCents };
}

export function validateOrderRequest(b) {
  const quoteId = text(b.quoteId, "Quote", 100);
  const passenger = text(b.passenger, "Passenger", 100);
  const journeyId = b.journeyId ? text(b.journeyId, "Journey", 100) : null;
  return { quoteId, passenger, journeyId };
}
