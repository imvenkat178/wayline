import test from "node:test";
import assert from "node:assert/strict";
import { freshness, withFreshTracking, digitalTwin } from "../server/domain/journeys.mjs";

test("freshness recomputes age/stale/label from raw observedAt for whatever `now` is passed", () => {
  const observedAt = "2026-01-15T12:00:00Z";
  const rawSignal = { source: "live-gps", observedAt, confidence: null, position: [0, 0] };

  // Right at measurement time: fresh.
  const atMeasurement = freshness(rawSignal, Date.parse(observedAt));
  assert.equal(atMeasurement.source, "live-gps");
  assert.equal(atMeasurement.stale, false);
  assert.equal(atMeasurement.label, "Live GPS");
  assert.equal(atMeasurement.ageSeconds, 0);

  // 5 minutes later, the SAME raw signal object must now read as stale/predicted -- proving
  // freshness is a function of "now", not something baked in once and reused.
  const fiveMinutesLater = freshness(rawSignal, Date.parse(observedAt) + 5 * 60000);
  assert.equal(fiveMinutesLater.source, "predicted");
  assert.equal(fiveMinutesLater.stale, true);
  assert.equal(fiveMinutesLater.label, "Stale position · estimate");
  assert.equal(fiveMinutesLater.ageSeconds, 300);

  // The original raw object itself must be untouched (freshness never mutates its input).
  assert.equal(rawSignal.source, "live-gps");
});

test("withFreshTracking recomputes every leg's tracking against `now`, not a stored derived label (regression)", () => {
  const observedAt = "2026-01-15T12:00:00Z";
  // This mirrors exactly what providers.mjs now stores and what matchLiveTracking copies onto a
  // leg: the RAW measurement, with no age/stale/label baked in.
  const journey = {
    id: "j1",
    legs: [
      { id: "leg-0", tracking: { source: "live-gps", observedAt, confidence: null } },
      { id: "leg-1", tracking: { source: "sample", observedAt: null, confidence: null } },
    ],
  };

  const soon = withFreshTracking(journey, Date.parse(observedAt) + 30000);
  assert.equal(soon.legs[0].tracking.source, "live-gps");
  assert.equal(soon.legs[0].tracking.stale, false);

  // The SAME stored journey, viewed 20 minutes later, must show a different, worse label --
  // this is the actual regression: previously the label was computed once when the provider
  // data was fetched (or when /tracking was last POSTed) and then served verbatim afterward,
  // so a client opening this journey later would see a frozen "Live GPS" badge no matter how
  // old the signal actually was.
  const muchLater = withFreshTracking(journey, Date.parse(observedAt) + 20 * 60000);
  assert.equal(muchLater.legs[0].tracking.source, "schedule");
  assert.equal(muchLater.legs[0].tracking.stale, true);
  assert.equal(muchLater.legs[0].tracking.label, "Schedule only");

  // A sample leg's tracking never changes regardless of "now".
  assert.equal(muchLater.legs[1].tracking.label, "Sample signal");

  // withFreshTracking must not mutate the original stored journey.
  assert.equal(journey.legs[0].tracking.source, "live-gps");
  assert.equal("stale" in journey.legs[0].tracking, false);
});

test("digitalTwin's ghost alert and tracking array reflect the same recomputed freshness, not a double-derived value", () => {
  const now = Date.parse("2026-01-15T12:30:00Z");
  const staleObservedAt = new Date(now - 20 * 60000).toISOString(); // 20 minutes old
  const journey = {
    id: "j1",
    departure: "2026-01-15T11:00:00Z",
    arrival: "2026-01-15T13:00:00Z",
    price: { totalCents: 5000 },
    legs: [
      {
        id: "leg-0",
        mode: "metro",
        service: "Red Line",
        departure: "2026-01-15T11:00:00Z",
        durationMinutes: 15,
        tracking: { source: "live-gps", observedAt: staleObservedAt, confidence: null },
      },
    ],
  };
  const twin = digitalTwin(journey, {}, now);
  assert.equal(twin.tracking[0].legId, "leg-0");
  // A signal this old must have been demoted away from "live-gps" and flagged as a ghost.
  assert.equal(twin.tracking[0].source, "schedule");
  assert.equal(twin.tracking[0].ghost, true);
  const ghostAlert = twin.alerts.find((a) => a.kind === "tracking");
  assert.ok(ghostAlert, "expected a ghost/no-recent-signal alert for a 20-minute-old signal");
  assert.match(ghostAlert.body, /20 minutes since its last signal/);
});
