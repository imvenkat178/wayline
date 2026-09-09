import test from "node:test";
import assert from "node:assert/strict";
import {
  localHour,
  nightWalkingPenalty,
  rankingScore,
  sampleSearch,
} from "../server/domain/journeys.mjs";

test("localHour resolves wall-clock hour in the given IANA zone, not UTC", () => {
  // 2026-01-15T03:00:00Z is 19:00 the previous evening in America/Los_Angeles (PST, UTC-8 in January).
  assert.equal(localHour("2026-01-15T03:00:00Z", "America/Los_Angeles"), 19);
  // The same instant is 22:00 the previous evening in America/New_York (EST, UTC-5 in January).
  assert.equal(localHour("2026-01-15T03:00:00Z", "America/New_York"), 22);
  // Same instant, no timezone supplied: falls back to UTC hour.
  assert.equal(localHour("2026-01-15T03:00:00Z", undefined), 3);
});

test("localHour handles midnight rollover and cross-zone trips correctly", () => {
  // 2026-06-01T00:30:00Z is 17:30 the same day in Los Angeles (PDT, UTC-7 in June).
  assert.equal(localHour("2026-06-01T00:30:00Z", "America/Los_Angeles"), 17);
  // The same instant is already the next morning, 09:30, in Asia/Tokyo (UTC+9, no DST).
  assert.equal(localHour("2026-06-01T00:30:00Z", "Asia/Tokyo"), 9);
});

test("localHour resolves correctly across a US DST spring-forward transition", () => {
  // The US 2026 DST transition is 2026-03-08 at 02:00 America/New_York local time,
  // which is 07:00 UTC (clocks jump from 01:59:59 EST straight to 03:00:00 EDT).
  // Before the jump (still EST, UTC-5):
  assert.equal(localHour("2026-03-08T06:30:00Z", "America/New_York"), 1);
  // After the jump (now EDT, UTC-4) -- a fixed-offset calculation would be off by an hour here:
  assert.equal(localHour("2026-03-08T09:00:00Z", "America/New_York"), 5);
});

test("localHour falls back to UTC hour for an unrecognized timezone instead of throwing", () => {
  assert.equal(localHour("2026-01-15T03:00:00Z", "Not/AZone"), 3);
});

test("nightWalkingPenalty uses the origin's local hour, not UTC, and respects the preference toggle", () => {
  const journey = {
    departure: "2026-01-15T05:00:00Z",
    timezone: "America/Los_Angeles",
    walkMinutes: 20,
  };
  // 05:00Z is 21:00 the previous evening in Los Angeles -- inside the night window.
  assert.equal(localHour(journey.departure, journey.timezone), 21);
  assert.equal(nightWalkingPenalty(journey, { nightWalking: false }), 0);
  assert.equal(nightWalkingPenalty(journey, { nightWalking: true }), 40);

  // The old getUTCHours()-based bug would have used UTC hour 5 directly (which happens to
  // read as "night" under a naive `< 7` rule too) -- pick a case where the UTC hour and the
  // true local hour disagree on whether it's night, to prove the local zone is what's consulted.
  const crossZone = {
    departure: "2026-01-15T14:00:00Z",
    timezone: "America/Los_Angeles",
    walkMinutes: 20,
  };
  // 14:00Z is 06:00 local in Los Angeles: UTC hour (14) reads as daytime either way, but the
  // true local hour (6) sits right at the edge of the night window and must NOT be flagged as
  // night (the window is "< 6", not "<= 6").
  assert.equal(localHour(crossZone.departure, crossZone.timezone), 6);
  assert.equal(nightWalkingPenalty(crossZone, { nightWalking: true }), 0);

  const earlyMorning = {
    departure: "2026-01-15T13:00:00Z",
    timezone: "America/Los_Angeles",
    walkMinutes: 20,
  };
  // 13:00Z is 05:00 local in Los Angeles -- inside the night window.
  assert.equal(localHour(earlyMorning.departure, earlyMorning.timezone), 5);
  assert.equal(nightWalkingPenalty(earlyMorning, { nightWalking: true }), 40);
});

test("rankingScore falls through to the weighted composite for a non-listed priority and includes the night penalty", () => {
  const journey = {
    departure: "2026-01-15T05:00:00Z",
    timezone: "America/Los_Angeles",
    walkMinutes: 20,
    durationMinutes: 100,
    price: { totalCents: 5000 },
    graph: { overallRisk: "low" },
    legs: [null, null, { mode: "train", crowding: 10 }],
  };
  const base = {
    priority: "balanced",
    lessCrowded: false,
    preferTrain: false,
    coveredTransfers: false,
    nightWalking: false,
  };
  const withNight = { ...base, nightWalking: true };
  // durationMinutes/4 (25) + price/100 (50) + no risk/crowding/train/transfer terms = 75.
  assert.equal(rankingScore(journey, base), 75);
  // Same journey with nightWalking on adds walkMinutes * 2 (40) on top.
  assert.equal(rankingScore(journey, withNight), 115);
});

test("night-walking preference changes real sampleSearch ordering for a local night-time departure", () => {
  const nightDeparture = "2026-01-15T05:00:00Z"; // 21:00 local in Los Angeles
  const withoutNightWalking = sampleSearch({
    from: "la",
    to: "sj",
    departure: nightDeparture,
    preferences: { nightWalking: false, priority: "balanced" },
  });
  const withNightWalking = sampleSearch({
    from: "la",
    to: "sj",
    departure: nightDeparture,
    preferences: { nightWalking: true, priority: "balanced" },
  });
  assert.ok(withoutNightWalking.journeys.length > 0);
  assert.equal(withoutNightWalking.journeys[0].timezone, "America/Los_Angeles");
  // The journey with the most walking should score strictly worse (move later, or stay put if
  // it's already last) once nightWalking is on, for this local-night departure.
  const walkiest = [...withoutNightWalking.journeys].sort(
    (a, b) => b.walkMinutes - a.walkMinutes,
  )[0];
  const rankWithout = withoutNightWalking.journeys.findIndex((j) => j.id === walkiest.id);
  const rankWith = withNightWalking.journeys.findIndex((j) => j.id === walkiest.id);
  assert.ok(
    rankWith >= rankWithout,
    "the most-walking itinerary should not rank better once nightWalking penalizes it",
  );
});
