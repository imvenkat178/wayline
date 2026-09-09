import test from "node:test";
import assert from "node:assert/strict";
import { DomainError, recoveryCost } from "../server/domain/journeys.mjs";
import { validateRecord } from "../server/records.mjs";

function leg(overrides = {}) {
  return {
    id: "main",
    mode: "train",
    from: "Boston South Station",
    to: "New York Penn",
    departure: "2026-06-01T12:10:00.000Z",
    priceCents: 4500,
    ...overrides,
  };
}

function journey(overrides = {}) {
  return {
    price: { totalCents: 5000 },
    legs: [leg()],
    ...overrides,
  };
}

test("recoveryCost: falls back to the itinerary estimate when no paid amount is on file", () => {
  const j = journey({ price: { totalCents: 5000 } });
  const alt = journey({
    price: { totalCents: 6000 },
    legs: [leg({ departure: "2026-06-01T13:00:00.000Z" })],
  });
  const cost = recoveryCost(j, alt, null);
  assert.equal(cost.basis, "estimate");
  assert.equal(cost.incrementalCents, 1000);
  assert.equal(cost.retainedLegCents, 0);
  assert.equal(cost.nonrefundableCents, null);
});

test("recoveryCost: uses a self-reported paid amount as the baseline instead of the estimate", () => {
  const j = journey({ price: { totalCents: 5000 } });
  const alt = journey({
    price: { totalCents: 6000 },
    legs: [leg({ departure: "2026-06-01T13:00:00.000Z" })],
  });
  const cost = recoveryCost(j, alt, 4200);
  assert.equal(cost.basis, "paid");
  assert.equal(cost.incrementalCents, 6000 - 4200);
});

test("recoveryCost: nets out a leg that is identical between the original and the alternative", () => {
  const sharedLeg = leg({ id: "walk-start", mode: "walk", priceCents: 0 });
  const mainLeg = leg({ priceCents: 4500 });
  const j = journey({ price: { totalCents: 5000 }, legs: [sharedLeg, mainLeg] });
  const alt = journey({
    price: { totalCents: 6000 },
    legs: [sharedLeg, leg({ priceCents: 5500, departure: "2026-06-01T13:00:00.000Z" })],
  });
  const cost = recoveryCost(j, alt, null);
  // sharedLeg contributes 0 in priceCents here, so retainedLegCents is 0 even though it matched --
  // use a priced shared leg to prove retention actually nets out real cost.
  assert.equal(cost.retainedLegCents, 0);
});

test("recoveryCost: a priced shared leg reduces the incremental cost", () => {
  const sharedLeg = leg({ id: "feeder", mode: "metro", priceCents: 175 });
  const j = journey({ price: { totalCents: 5000 }, legs: [sharedLeg] });
  const alt = journey({ price: { totalCents: 6000 }, legs: [sharedLeg] });
  const cost = recoveryCost(j, alt, null);
  assert.equal(cost.retainedLegCents, 175);
  assert.equal(cost.incrementalCents, 6000 - 5000 - 175);
});

test("recoveryCost: unknown pricing on either side yields an unknown, not a wrong number", () => {
  const j = journey({ price: { totalCents: null } });
  const alt = journey({ price: { totalCents: 6000 } });
  const cost = recoveryCost(j, alt, null);
  assert.equal(cost.incrementalCents, null);
  assert.equal(cost.basis, "unknown");
});

test("ticket paidCents: optional and defaults to null when omitted", () => {
  const ticket = validateRecord("ticket", {
    operator: "Amtrak",
    service: "Northeast Regional",
    confirmation: "ABC123",
    passenger: "A Traveler",
    departure: "2026-06-01T12:00:00.000Z",
    origin: "Boston",
    destination: "New York",
  });
  assert.equal(ticket.paidCents, null);
});

test("ticket paidCents: accepted when a valid non-negative integer is provided", () => {
  const ticket = validateRecord("ticket", {
    operator: "Amtrak",
    service: "Northeast Regional",
    confirmation: "ABC123",
    passenger: "A Traveler",
    departure: "2026-06-01T12:00:00.000Z",
    origin: "Boston",
    destination: "New York",
    paidCents: 4200,
  });
  assert.equal(ticket.paidCents, 4200);
});

test("ticket paidCents: rejects a negative or non-integer amount", () => {
  const base = {
    operator: "Amtrak",
    service: "Northeast Regional",
    confirmation: "ABC123",
    passenger: "A Traveler",
    departure: "2026-06-01T12:00:00.000Z",
    origin: "Boston",
    destination: "New York",
  };
  assert.throws(() => validateRecord("ticket", { ...base, paidCents: -1 }), DomainError);
  assert.throws(() => validateRecord("ticket", { ...base, paidCents: 4.5 }), DomainError);
});
