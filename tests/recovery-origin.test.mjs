import test from "node:test";
import assert from "node:assert/strict";
import {
  DomainError,
  recoveryPosition,
  assertRecoverable,
  RECOVERY_MIN_TRANSFER_MINUTES,
} from "../server/domain/journeys.mjs";

function baseJourney(overrides = {}) {
  const now = Date.parse("2026-06-01T12:00:00.000Z");
  return {
    id: "j1",
    fromId: "bos",
    toId: "nyc",
    state: "PLANNED",
    price: { totalCents: 5000 },
    legs: [
      {
        id: "walk-start",
        departure: new Date(now).toISOString(),
        arrival: new Date(now + 5 * 60000).toISOString(),
      },
      {
        id: "main",
        departure: new Date(now + 10 * 60000).toISOString(),
        arrival: new Date(now + 240 * 60000).toISOString(),
      },
      {
        id: "walk-end",
        departure: new Date(now + 240 * 60000).toISOString(),
        arrival: new Date(now + 245 * 60000).toISOString(),
      },
    ],
    ...overrides,
  };
}

function alt(overrides = {}) {
  const now = Date.parse("2026-06-01T12:00:00.000Z");
  return {
    id: "alt1",
    fromId: "bos",
    toId: "nyc",
    departure: new Date(now + 30 * 60000).toISOString(),
    arrival: new Date(now + 260 * 60000).toISOString(),
    price: { totalCents: 6000 },
    ...overrides,
  };
}

const NOW = Date.parse("2026-06-01T12:00:00.000Z");

test("recoveryPosition: before departure, the traveler's stop is the journey's own origin", () => {
  const j = baseJourney({ state: "PLANNED" });
  const pos = recoveryPosition(j, NOW);
  assert.equal(pos.stopId, "bos");
  assert.equal(pos.earliestDeparture, NOW);
});

test("recoveryPosition: once underway, the traveler is only reachable again at their destination stop", () => {
  const j = baseJourney({ state: "IN_TRANSIT" });
  const pos = recoveryPosition(j, NOW + 60 * 60000);
  assert.equal(pos.stopId, "nyc");
  // The first upcoming leg (arrival > now) is "main", arriving at now+240min.
  assert.equal(pos.earliestDeparture, Date.parse(j.legs[1].arrival));
});

test("recoveryPosition: after every leg has arrived, falls back to the last leg's arrival", () => {
  const j = baseJourney({ state: "DELAYED" });
  const pos = recoveryPosition(j, NOW + 300 * 60000);
  assert.equal(pos.stopId, "nyc");
  assert.equal(pos.earliestDeparture, Date.parse(j.legs[2].arrival));
});

test("assertRecoverable: accepts a same-origin, reachable, future-arriving alternative before departure", () => {
  const j = baseJourney({ state: "PLANNED" });
  assert.doesNotThrow(() => assertRecoverable(j, alt(), NOW));
});

test("assertRecoverable: rejects an alternative to a different destination", () => {
  const j = baseJourney({ state: "PLANNED" });
  assert.throws(() => assertRecoverable(j, alt({ toId: "phl" }), NOW), DomainError);
});

test("assertRecoverable: rejects a finished journey (ARRIVED/CANCELLED) -- nothing to recover", () => {
  for (const state of ["ARRIVED", "CANCELLED"]) {
    const j = baseJourney({ state });
    assert.throws(() => assertRecoverable(j, alt(), NOW), DomainError);
  }
});

test("assertRecoverable: rejects an alternative that departs from a stop the traveler cannot currently reach", () => {
  // Once underway, recoverable position moves to the destination ("nyc"); an alternative that
  // still departs from the original origin ("bos") is no longer reachable, unlike before this
  // fix, which never checked departure origin at all.
  const j = baseJourney({ state: "IN_TRANSIT" });
  assert.throws(() => assertRecoverable(j, alt({ fromId: "bos" }), NOW + 60 * 60000), DomainError);
});

test("assertRecoverable: rejects an alternative that has already departed (previously only arrival was checked)", () => {
  const j = baseJourney({ state: "PLANNED" });
  const already = alt({ departure: new Date(NOW - 5 * 60000).toISOString() });
  assert.throws(() => assertRecoverable(j, already, NOW), DomainError);
});

test("assertRecoverable: rejects an alternative departing sooner than the minimum reachable transfer time", () => {
  const j = baseJourney({ state: "PLANNED" });
  const tooSoon = alt({
    departure: new Date(NOW + (RECOVERY_MIN_TRANSFER_MINUTES - 1) * 60000).toISOString(),
  });
  assert.throws(() => assertRecoverable(j, tooSoon, NOW), DomainError);
});

test("assertRecoverable: accepts an alternative departing exactly at the minimum reachable transfer time", () => {
  const j = baseJourney({ state: "PLANNED" });
  const justInTime = alt({
    departure: new Date(NOW + RECOVERY_MIN_TRANSFER_MINUTES * 60000).toISOString(),
  });
  assert.doesNotThrow(() => assertRecoverable(j, justInTime, NOW));
});

test("assertRecoverable: rejects an alternative that has already arrived", () => {
  const j = baseJourney({ state: "PLANNED" });
  const past = alt({
    departure: new Date(NOW - 120 * 60000).toISOString(),
    arrival: new Date(NOW - 5 * 60000).toISOString(),
  });
  assert.throws(() => assertRecoverable(j, past, NOW), DomainError);
});
