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

test("a nonrefundable $100 original and $80 replacement require $80 cash, $180 spent",()=>{
 const c=recoveryCost(journey({price:{totalCents:10000}}),journey({price:{totalCents:8000}}),10000);
 assert.equal(c.cashRequiredNowCents,8000);assert.equal(c.totalSpentCents,18000);
 assert.equal(c.planPriceDifferenceCents,-2000);assert.equal(c.incrementalCents,8000);
});
test("matching a priced leg does not prove ticket reuse",()=>{
 const c=recoveryCost(journey(),journey(),5000);
 assert.equal(c.retainedLegCents,0);assert.equal(c.cashRequiredNowCents,5000);
});
test("unknown payment history does not turn a known replacement into unknown",()=>{
 const c=recoveryCost(journey({price:{totalCents:null}}),journey({price:{totalCents:8000}}));
 assert.equal(c.cashRequiredNowCents,8000);assert.equal(c.totalSpentCents,null);
});
test("unknown replacement prices remain unknown",()=>{
 assert.equal(recoveryCost(journey(),journey({price:{totalCents:null}}),5000).cashRequiredNowCents,null);
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
