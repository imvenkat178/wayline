// GTFS-Realtime decoding and normalization (ROADMAP G11.1), schedule freshness (G11.3), map
// security policy (G11.5) and the OpenTripPlanner real-time updater configuration (G11.2).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import gtfsRealtimeBindings from "gtfs-realtime-bindings";
import {
  decodeFeed,
  normalizeAlerts,
  normalizePredictions,
  normalizeVehicles,
  realtimeSource,
} from "../server/adapters/gtfsRealtime.mjs";
import { gtfsRealtime, mbtaAlerts, mbtaVehicles } from "../server/adapters/providers.mjs";
import { blockingDisruptions } from "../server/domain/disruptions.mjs";
import { scheduleStatus } from "../server/travel/providers.mjs";
import { contentSecurityPolicy, mapOrigins, mapStyleUrl } from "../server/securityPolicy.mjs";

const { transit_realtime: rt } = gtfsRealtimeBindings;
const header = { gtfsRealtimeVersion: "2.0", incrementality: "FULL_DATASET", timestamp: 1789430971 };
const encode = (entity) => Buffer.from(rt.FeedMessage.encode(rt.FeedMessage.fromObject({ header, entity })).finish());
const protobufResponse = (bytes) => ({
  ok: true,
  headers: { get: () => null },
  body: { async *[Symbol.asyncIterator]() { yield bytes; } },
});

const vehicleFeed = encode([
  {
    id: "y1001",
    vehicle: {
      trip: { tripId: "t-red-1", routeId: "Red" },
      position: { latitude: 42.352, longitude: -71.055, bearing: 90 },
      currentStatus: "STOPPED_AT",
      occupancyStatus: "MANY_SEATS_AVAILABLE",
      timestamp: 1789430960,
      vehicle: { id: "y1001", label: "1001" },
    },
  },
  { id: "no-position", vehicle: { trip: { tripId: "t-red-2" }, vehicle: { id: "y1002" } } },
]);
const tripUpdateFeed = encode([
  {
    id: "tu-1",
    tripUpdate: {
      trip: { tripId: "t-red-1", routeId: "Red", startDate: "20260914" },
      stopTimeUpdate: [
        { stopSequence: 1, stopId: "70080", departure: { time: 1789432122 } },
        { stopSequence: 2, stopId: "70068", scheduleRelationship: "SKIPPED" },
      ],
    },
  },
  {
    id: "tu-2",
    tripUpdate: {
      trip: { tripId: "t-red-3", scheduleRelationship: "CANCELED" },
      stopTimeUpdate: [{ stopSequence: 1, stopId: "70080", arrival: { time: 1789432200 } }],
    },
  },
]);
const alertFeed = encode([
  {
    id: "alert-suspension",
    alert: {
      activePeriod: [{ start: 1789430000, end: 1789440000 }],
      informedEntity: [{ agencyId: "1", routeId: "Red", routeType: 1, stopId: "place-harsq", trip: { tripId: "t-red-1" }, directionId: 0 }],
      effect: "NO_SERVICE",
      effectDetail: { translation: [{ text: "SUSPENSION", language: "en" }] },
      severityLevel: "SEVERE",
      headerText: { translation: [{ text: "Red Line suspended", language: "en" }] },
      descriptionText: { translation: [{ text: "Shuttle buses replace trains.", language: "en" }] },
      url: { translation: [{ text: "https://www.mbta.com/alerts", language: "en" }] },
    },
  },
  {
    id: "alert-other-agency",
    alert: { informedEntity: [{ agencyId: "other", routeId: "5" }], effect: "DETOUR", severityLevel: "INFO" },
  },
]);

test("realtimeSource defaults to the MBTA V3 API and switches only for gtfs-rt", () => {
  assert.equal(realtimeSource({}), "v3-api");
  assert.equal(realtimeSource({ MBTA_REALTIME_SOURCE: "gtfs-rt" }), "gtfs-rt");
  assert.equal(realtimeSource({ MBTA_REALTIME_SOURCE: "GTFS" }), "v3-api");
});

test("VehiclePositions decode into the vehicle shape used for live tracking", () => {
  const vehicles = normalizeVehicles(decodeFeed(vehicleFeed));
  assert.equal(vehicles.length, 1, "entities without a position are skipped");
  assert.deepEqual(vehicles[0], {
    id: "y1001",
    vehicleId: "1001",
    tripId: "t-red-1",
    routeId: "Red",
    provider: "mbta",
    lat: vehicles[0].lat,
    lon: vehicles[0].lon,
    bearing: 90,
    status: "STOPPED_AT",
    occupancy: "MANY_SEATS_AVAILABLE",
    tracking: { source: "live-gps", observedAt: "2026-09-15T00:09:20.000Z", confidence: null, position: [vehicles[0].lon, vehicles[0].lat] },
  });
  assert.ok(Math.abs(vehicles[0].lat - 42.352) < 1e-5 && Math.abs(vehicles[0].lon + 71.055) < 1e-5);
});

test("TripUpdates decode into predictions with skipped stops and cancelled trips marked", () => {
  const feed = decodeFeed(tripUpdateFeed);
  const predictions = normalizePredictions(feed, "t-red-1");
  assert.deepEqual(
    predictions.map(({ stopId, departure, arrival, cancelled }) => ({ stopId, departure, arrival, cancelled })),
    [
      { stopId: "70080", departure: "2026-09-15T00:28:42.000Z", arrival: null, cancelled: false },
      { stopId: "70068", departure: null, arrival: null, cancelled: true },
    ],
  );
  assert.equal(normalizePredictions(feed, "t-red-3")[0].cancelled, true);
  assert.deepEqual(normalizePredictions(feed, "unknown-trip"), []);
});

test("ServiceAlerts decode into alerts that disruption matching blocks on", () => {
  const alerts = normalizeAlerts(decodeFeed(alertFeed));
  const [suspension] = alerts;
  assert.equal(suspension.effect, "SUSPENSION", "MBTA effectDetail wins over the standard effect");
  assert.equal(suspension.severity, "SEVERE");
  assert.equal(suspension.header, "Red Line suspended");
  assert.equal(suspension.url, "https://www.mbta.com/alerts");
  assert.deepEqual(suspension.activePeriods, [{ start: "2026-09-14T23:53:20.000Z", end: "2026-09-15T02:40:00.000Z" }]);
  assert.deepEqual(suspension.informed, [{ agency: "1", route: "Red", route_type: 1, stop: "place-harsq", trip: "t-red-1", direction_id: 0 }]);
  assert.equal(alerts[1].effect, "DETOUR");
  const journey = {
    legs: [{ agency: "mbta", tripId: "t-red-1", routeId: "Red", fromStopId: "place-sstat", toStopId: "place-harsq", directionId: 0, departure: "2026-09-14T23:40:00.000Z", arrival: "2026-09-14T23:55:00.000Z" }],
  };
  assert.deepEqual(blockingDisruptions(alerts, journey).map((a) => a.id), ["alert-suspension"]);
});

test("decodeFeed rejects bytes that are not a GTFS-Realtime message", () => {
  assert.throws(() => decodeFeed(Buffer.from("not protobuf at all, just text")));
});

test("MBTA_REALTIME_SOURCE=gtfs-rt serves vehicles and alerts from the protobuf feeds", async (t) => {
  const previous = process.env.MBTA_REALTIME_SOURCE;
  process.env.MBTA_REALTIME_SOURCE = "gtfs-rt";
  t.after(() => (previous === undefined ? delete process.env.MBTA_REALTIME_SOURCE : (process.env.MBTA_REALTIME_SOURCE = previous)));
  const requested = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requested.push(String(url));
    return protobufResponse(String(url).endsWith("VehiclePositions.pb") ? vehicleFeed : alertFeed);
  });
  const vehicles = await mbtaVehicles();
  const alerts = await mbtaAlerts();
  assert.equal(vehicles.source, "MBTA GTFS-realtime");
  assert.equal(vehicles.coverageLimited, false);
  assert.deepEqual(vehicles.vehicles.map((v) => v.id), ["y1001"]);
  assert.deepEqual(alerts.alerts.map((a) => a.id), ["alert-suspension", "alert-other-agency"]);
  assert.deepEqual(requested, ["https://cdn.mbta.com/realtime/VehiclePositions.pb", "https://cdn.mbta.com/realtime/Alerts.pb"]);
});

test("a configured GTFS-RT source is decoded through the shared decoder", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "wayline-gtfs-rt-"));
  const file = join(dir, "sources.json");
  writeFileSync(file, JSON.stringify([{ id: "test-alerts", name: "Test alerts", url: "https://feeds.example.org/alerts.pb", kind: "alerts" }]));
  const previous = process.env.TRANSIT_SOURCES_FILE;
  process.env.TRANSIT_SOURCES_FILE = file;
  t.after(() => {
    if (previous === undefined) delete process.env.TRANSIT_SOURCES_FILE;
    else process.env.TRANSIT_SOURCES_FILE = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  t.mock.method(globalThis, "fetch", async () => protobufResponse(alertFeed));
  const feed = await gtfsRealtime("test-alerts");
  assert.deepEqual(feed.source, { id: "test-alerts", name: "Test alerts", kind: "alerts" });
  assert.equal(feed.entities.length, 2);
  assert.equal(feed.timestamp, 1789430971);
});

test("schedule freshness reports connected, expiring within 7 days, and expired", () => {
  const now = Date.parse("2026-09-14T12:00:00Z");
  assert.deepEqual(scheduleStatus("2026-11-15T05:00:00Z", now), { daysRemaining: 61, status: "connected" });
  assert.equal(scheduleStatus("2026-09-18T12:00:00Z", now).status, "expiring");
  assert.equal(scheduleStatus("2026-09-13T12:00:00Z", now).status, "expired");
});

test("vector map settings add only valid HTTPS origins to the security policy", () => {
  assert.equal(contentSecurityPolicy(), contentSecurityPolicy(false, {}), "unset settings leave the policy unchanged");
  const env = {
    MAP_STYLE_URL: "https://tiles.example.org/styles/wayline.json",
    MAP_TILE_ORIGINS: "https://glyphs.example.org, http://insecure.example.org, https://user:secret@creds.example.org, not a url",
  };
  assert.deepEqual(mapOrigins(env), ["https://tiles.example.org", "https://glyphs.example.org"]);
  const policy = contentSecurityPolicy(false, env);
  assert.match(policy, /img-src [^;]*https:\/\/tiles\.example\.org https:\/\/glyphs\.example\.org;/);
  assert.match(policy, /connect-src [^;]*https:\/\/tiles\.example\.org https:\/\/glyphs\.example\.org;/);
  assert.doesNotMatch(policy, /insecure\.example\.org|creds\.example\.org/);
  assert.equal(mapStyleUrl(env), "https://tiles.example.org/styles/wayline.json");
  assert.equal(mapStyleUrl({ MAP_STYLE_URL: "http://tiles.example.org/style.json" }), null);
  assert.equal(mapStyleUrl({}), null);
});

test("OpenTripPlanner loads MBTA trip updates, vehicle positions and alerts", () => {
  const config = JSON.parse(readFileSync(new URL("../infra/otp/router-config.json", import.meta.url), "utf8"));
  assert.deepEqual(
    config.updaters.map(({ type, url, feedId }) => [type, url, feedId]),
    [
      ["stop-time-updater", "https://cdn.mbta.com/realtime/TripUpdates.pb", "mbta-ma-us"],
      ["vehicle-positions", "https://cdn.mbta.com/realtime/VehiclePositions.pb", "mbta-ma-us"],
      ["real-time-alerts", "https://cdn.mbta.com/realtime/Alerts.pb", "mbta-ma-us"],
    ],
  );
});
