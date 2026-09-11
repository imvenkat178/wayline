import { DomainError } from "./journeys.mjs";

const BLOCKING_EFFECTS = new Set([
  "NO_SERVICE", "SUSPENSION", "STOP_CLOSURE", "STATION_CLOSURE",
]);

export function alertAffectsJourney(alert, journey) {
  return (alert.informed ?? []).some((entity) => {
    if (entity.agency && !["1", "MBTA", "mbta"].includes(entity.agency)) return false;
    if (!entity.trip && !entity.route && !entity.stop) return false;
    return journey.legs.some((leg) => {
      if (leg.agency !== "mbta" ||
          (entity.trip && entity.trip !== leg.tripId) ||
          (entity.route && entity.route !== leg.routeId) ||
          (entity.stop && ![leg.fromStopId, leg.toStopId, leg.fromParentStopId, leg.toParentStopId].includes(entity.stop)) ||
          (entity.direction_id != null && String(leg.directionId) !== String(entity.direction_id)) ||
          (entity.service_date && leg.serviceDate !== entity.service_date)) return false;
      // Match time to the affected leg, including its latest prediction, rather than to
      // an unrelated part of a longer itinerary. Open-ended periods remain supported.
      const start = Date.parse(leg.predictedDeparture ?? leg.departure);
      const end = Date.parse(leg.predictedArrival ?? leg.arrival);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      return (alert.activePeriods ?? []).some((period) =>
        (!period.start || Date.parse(period.start) <= end) &&
        (!period.end || Date.parse(period.end) >= start));
    });
  });
}

export function blockingDisruptions(alerts, journey) {
  return alerts.filter((alert) => BLOCKING_EFFECTS.has(alert.effect) && alertAffectsJourney(alert, journey));
}

export function requireFreshDisruptions(data, now = Date.now()) {
  const age = now - Date.parse(data?.fetchedAt);
  if (data?.cache !== "fresh" || !Array.isArray(data.alerts) || !Number.isFinite(age) || age > 120000 || age < -60000 || data.coverageLimited)
    throw new DomainError("Current disruption information is unavailable. Refresh alternatives when the service reconnects.", 503, "DISRUPTIONS_UNAVAILABLE");
  return data;
}

export function usesCancelledTrip(candidate, knownLegs, now = Date.now()) {
  return candidate.legs.some((leg) => leg.cancelled || knownLegs.some((known) =>
    known.cancelled && known.predictionStatus === "available" &&
    now - Date.parse(known.predictionObservedAt) >= -60000 &&
    now - Date.parse(known.predictionObservedAt) < 120000 &&
    leg.agency === known.agency && leg.tripId && leg.tripId === known.tripId &&
    leg.serviceDate === known.serviceDate));
}

// OTP revalidation is necessary but service suspensions may be delivered only by MBTA
// alerts. Recheck both, and check cancelled boarding/alighting predictions at confirmation.
export async function assertServiceAvailable(travel, journey) {
  const data = requireFreshDisruptions(await travel.call("disruptions"));
  if (blockingDisruptions(data.alerts, journey).length || journey.legs.some((l) => l.cancelled))
    throw new DomainError("This route is affected by a confirmed closure or cancellation. Prepare new alternatives.", 409, "ROUTE_DISRUPTED");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: journey.timezone ?? "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const legs = journey.legs.filter((l) => l.agency === "mbta" && l.tripId && l.serviceDate === today);
  await Promise.all([...new Set(legs.map((l) => l.tripId))].map(async (tripId) => {
    const result = await travel.call("predictions", { tripId });
    if (result.cache !== "fresh" || !Array.isArray(result.predictions) ||
        !Number.isFinite(Date.parse(result.fetchedAt)) || Date.now() - Date.parse(result.fetchedAt) > 120000)
      throw new DomainError("Departure predictions are unavailable. Try confirming again when connected.", 503);
    const cancelled = result.predictions.some((p) => p.tripId === tripId && p.cancelled &&
      legs.some((l) => l.tripId === tripId && [l.fromStopId, l.toStopId].includes(p.stopId)));
    if (cancelled) throw new DomainError("A departure on this route has been cancelled. Prepare new alternatives.", 409, "ROUTE_DISRUPTED");
  }));
  return data;
}
