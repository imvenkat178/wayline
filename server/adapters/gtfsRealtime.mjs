// GTFS-Realtime ingestion (ROADMAP G11.1). Decodes protocol buffer feeds for VehiclePositions,
// TripUpdates and ServiceAlerts and normalizes them into the same shapes the MBTA V3 JSON adapters
// return, so live tracking, predictions and disruption matching work for any agency that publishes
// standard GTFS-Realtime. MBTA_REALTIME_SOURCE=gtfs-rt switches the MBTA adapters to these feeds.
import * as gtfsRealtimeBindings from "gtfs-realtime-bindings";
import { fetchBounded } from "./providers.mjs";

const realtime = (gtfsRealtimeBindings.default ?? gtfsRealtimeBindings).transit_realtime;

export const MBTA_REALTIME_FEEDS = {
  vehicles: "https://cdn.mbta.com/realtime/VehiclePositions.pb",
  tripUpdates: "https://cdn.mbta.com/realtime/TripUpdates.pb",
  alerts: "https://cdn.mbta.com/realtime/Alerts.pb",
};

export function realtimeSource(env = process.env) {
  return env.MBTA_REALTIME_SOURCE === "gtfs-rt" ? "gtfs-rt" : "v3-api";
}

export function decodeFeed(bytes) {
  return realtime.FeedMessage.toObject(realtime.FeedMessage.decode(bytes), {
    longs: Number,
    enums: String,
    defaults: false,
  });
}

const iso = (seconds) => (Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null);
const text = (translated) =>
  translated?.translation?.find((t) => !t.language || t.language === "en")?.text ??
  translated?.translation?.[0]?.text ??
  null;

export function normalizeVehicles(feed, { provider = "mbta" } = {}) {
  const feedTime = iso(feed.header?.timestamp);
  return (feed.entity ?? [])
    .filter((entity) => entity.vehicle?.position)
    .map((entity) => {
      const vehicle = entity.vehicle;
      const lat = vehicle.position.latitude;
      const lon = vehicle.position.longitude;
      return {
        id: vehicle.vehicle?.id ?? entity.id,
        vehicleId: vehicle.vehicle?.label ?? vehicle.vehicle?.id ?? null,
        tripId: vehicle.trip?.tripId,
        routeId: vehicle.trip?.routeId,
        provider,
        lat,
        lon,
        bearing: vehicle.position.bearing ?? null,
        status: vehicle.currentStatus ?? null,
        occupancy: vehicle.occupancyStatus ?? "unknown",
        // Raw measurement only; consumers compute freshness at response time (see mbtaVehicles).
        tracking: {
          source: "live-gps",
          observedAt: iso(vehicle.timestamp) ?? feedTime,
          confidence: null,
          position: [lon, lat],
        },
      };
    })
    .filter((vehicle) => Number.isFinite(vehicle.lat) && Number.isFinite(vehicle.lon));
}

export function normalizePredictions(feed, tripId) {
  const predictions = [];
  for (const entity of feed.entity ?? []) {
    const update = entity.tripUpdate;
    if (!update || update.trip?.tripId !== tripId) continue;
    const tripCancelled = update.trip.scheduleRelationship === "CANCELED";
    for (const stop of update.stopTimeUpdate ?? [])
      predictions.push({
        id: `${tripId}-${stop.stopSequence ?? ""}-${stop.stopId ?? ""}`,
        tripId,
        stopId: stop.stopId ?? null,
        arrival: iso(stop.arrival?.time),
        departure: iso(stop.departure?.time),
        cancelled: tripCancelled || stop.scheduleRelationship === "SKIPPED",
        status: null,
      });
  }
  return predictions;
}

export function normalizeAlerts(feed) {
  const updatedAt = iso(feed.header?.timestamp);
  return (feed.entity ?? [])
    .filter((entity) => entity.alert)
    .map((entity) => {
      const alert = entity.alert;
      return {
        id: entity.id,
        header: text(alert.headerText),
        description: text(alert.descriptionText),
        severity: alert.severityLevel ?? null,
        // MBTA publishes its own effect names (SUSPENSION, SHUTTLE, STATION_CLOSURE and others) in the
        // effectDetail extension. Prefer them so disruption matching sees the same values as the V3 API;
        // other agencies fall back to the standard GTFS-Realtime effect such as NO_SERVICE.
        effect: text(alert.effectDetail) ?? alert.effect ?? "UNKNOWN_EFFECT",
        updatedAt,
        activePeriods: (alert.activePeriod ?? []).map((period) => ({ start: iso(period.start), end: iso(period.end) })),
        informed: (alert.informedEntity ?? []).map((informed) => ({
          ...(informed.agencyId ? { agency: informed.agencyId } : {}),
          ...(informed.routeId ? { route: informed.routeId } : {}),
          ...(informed.routeType != null ? { route_type: informed.routeType } : {}),
          ...(informed.stopId ? { stop: informed.stopId } : {}),
          ...(informed.trip?.tripId ? { trip: informed.trip.tripId } : {}),
          ...(informed.directionId != null
            ? { direction_id: informed.directionId }
            : informed.trip?.directionId != null
              ? { direction_id: informed.trip.directionId }
              : {}),
        })),
        url: text(alert.url),
      };
    });
}

export async function loadFeed(url) {
  const bytes = await fetchBounded(url, { headers: { Accept: "application/x-protobuf" }, timeoutMs: 15000 }, 20_000_000);
  return decodeFeed(bytes);
}

export async function gtfsRtVehicles(url = MBTA_REALTIME_FEEDS.vehicles) {
  return { source: "MBTA GTFS-realtime", coverageLimited: false, vehicles: normalizeVehicles(await loadFeed(url)) };
}

export async function gtfsRtAlerts(url = MBTA_REALTIME_FEEDS.alerts) {
  return { source: "MBTA GTFS-realtime", coverageLimited: false, alerts: normalizeAlerts(await loadFeed(url)) };
}
