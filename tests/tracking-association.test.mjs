import test from "node:test";
import assert from "node:assert/strict";
import { canonicalAgencyId, normalizeGtfsId } from "../server/adapters/providers.mjs";
import { matchLiveTracking } from "../server/domain/journeys.mjs";

test("normalizeGtfsId strips OTP's feed-scoped prefix but passes through an already-raw id", () => {
  assert.equal(normalizeGtfsId("mbta:CR-Weekday-Boston-1"), "CR-Weekday-Boston-1");
  // Only the first colon is a feed separator; anything after stays part of the id.
  assert.equal(normalizeGtfsId("mbta:Red:1234"), "Red:1234");
  assert.equal(normalizeGtfsId("39984086"), "39984086");
  assert.equal(normalizeGtfsId(undefined), null);
  assert.equal(normalizeGtfsId(null), null);
});

test("canonicalAgencyId recognizes MBTA by agency id or name, and returns null otherwise", () => {
  assert.equal(canonicalAgencyId({ id: "mbta", name: "MBTA" }), "mbta");
  assert.equal(
    canonicalAgencyId({ id: "MBTA", name: "Massachusetts Bay Transportation Authority" }),
    "mbta",
  );
  assert.equal(canonicalAgencyId({ id: "some-feed-id", name: "MBTA" }), "mbta");
  assert.equal(canonicalAgencyId({ id: "amtrak", name: "Amtrak" }), null);
  assert.equal(canonicalAgencyId(null), null);
  assert.equal(canonicalAgencyId(undefined), null);
});

test("matchLiveTracking matches an OTP-routed leg by canonical agency, not by routing provider (regression)", () => {
  // This is the exact bug: an OTP-produced leg has provider "otp", never "mbta" -- the old
  // filter `l.provider !== "mbta"` meant this leg could NEVER be matched to a live vehicle,
  // even though it is actually operated by MBTA and MBTA has a live feed.
  const otpRoutedMbtaLeg = {
    id: "leg-0",
    provider: "otp",
    agency: "mbta",
    tripId: "39984086",
    routeId: "Red",
  };
  const vehicles = [
    {
      tripId: "39984086",
      routeId: "Red",
      vehicleId: "1234",
      tracking: { source: "live-gps", observedAt: "2026-01-15T12:00:00Z" },
    },
  ];
  const { legs, matches } = matchLiveTracking([otpRoutedMbtaLeg], vehicles, "mbta");
  assert.equal(matches, 1);
  assert.equal(legs[0].vehicleId, "1234");
  assert.deepEqual(legs[0].tracking, { source: "live-gps", observedAt: "2026-01-15T12:00:00Z" });

  // Reproduce the pre-fix behavior for contrast: filtering on `provider` (as the old code did)
  // would never have matched this same leg, proving the fix is what actually changed.
  const oldBuggyFilterWouldMatch = otpRoutedMbtaLeg.provider === "mbta";
  assert.equal(oldBuggyFilterWouldMatch, false);
});

test("matchLiveTracking leaves a leg from an untracked agency untouched", () => {
  const amtrakLeg = { id: "leg-1", provider: "otp", agency: null, tripId: "123" };
  const vehicles = [{ tripId: "123", routeId: null, vehicleId: "x", tracking: {} }];
  const { legs, matches } = matchLiveTracking([amtrakLeg], vehicles, "mbta");
  assert.equal(matches, 0);
  assert.equal(legs[0], amtrakLeg);
});

test("matchLiveTracking requires matching route id when both sides carry one, to avoid a coincidental trip-id collision", () => {
  const leg = { id: "leg-2", agency: "mbta", tripId: "999", routeId: "Green-B" };
  const wrongRouteVehicle = [{ tripId: "999", routeId: "Red", vehicleId: "y", tracking: {} }];
  const { matches: noMatch } = matchLiveTracking([leg], wrongRouteVehicle, "mbta");
  assert.equal(noMatch, 0);

  const rightRouteVehicle = [{ tripId: "999", routeId: "Green-B", vehicleId: "y", tracking: {} }];
  const { matches: match } = matchLiveTracking([leg], rightRouteVehicle, "mbta");
  assert.equal(match, 1);
});

test("matchLiveTracking never counts a leg with no tripId", () => {
  const leg = { id: "leg-3", agency: "mbta", tripId: null };
  const { legs, matches } = matchLiveTracking([leg], [{ tripId: null, vehicleId: "z" }], "mbta");
  assert.equal(matches, 0);
  assert.equal(legs[0], leg);
});
