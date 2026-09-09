import { readFileSync } from "node:fs";
import { DomainError, connectionGraph, leaveNow } from "../domain/journeys.mjs";
import { cities } from "../catalog.mjs";
const cache = new Map(),
  inflight = new Map(),
  health = new Map();
const enabled = () => process.env.ENABLE_EXTERNAL_FEEDS !== "false";
export async function fetchBounded(url, options = {}, maxBytes = 5_000_000) {
  const r = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
    headers: { Accept: "application/json", "User-Agent": "Wayline/2.0", ...options.headers },
  });
  if (!r.ok) throw new DomainError(`Provider returned HTTP ${r.status}.`, 502, "UPSTREAM_ERROR");
  if (Number(r.headers.get("content-length")) > maxBytes) {
    await r.body?.cancel();
    throw new DomainError("Provider response is too large.", 502);
  }
  let total = 0;
  const chunks = [];
  for await (const b of r.body) {
    total += b.length;
    if (total > maxBytes) {
      throw new DomainError("Provider response is too large.", 502);
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}
async function json(url, options) {
  return JSON.parse((await fetchBounded(url, options)).toString());
}
async function cached(key, ttl, fn) {
  if (!enabled()) throw new DomainError("External feeds are disabled.", 503, "FEED_DISABLED");
  const old = cache.get(key);
  if (old && Date.now() - old.at < ttl)
    return { ...old.value, fetchedAt: new Date(old.at).toISOString(), cache: "fresh" };
  if (inflight.has(key)) return inflight.get(key);
  const previous = health.get(key);
  if (previous?.retryAt > Date.now()) {
    if (old)
      return {
        ...old.value,
        fetchedAt: new Date(old.at).toISOString(),
        cache: "stale",
        warning: "Provider temporarily unavailable",
      };
    throw new DomainError(
      "Provider temporarily unavailable. Try again shortly.",
      503,
      "CIRCUIT_OPEN",
    );
  }
  const task = (async () => {
    try {
      const value = await fn();
      cache.set(key, { value, at: Date.now() });
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      health.set(key, {
        name: key,
        status: "connected",
        lastSuccess: new Date().toISOString(),
        failures: 0,
      });
      return { ...value, fetchedAt: new Date().toISOString(), cache: "fresh" };
    } catch (e) {
      health.set(key, {
        name: key,
        status: "unavailable",
        lastSuccess: previous?.lastSuccess ?? null,
        failures: (previous?.failures ?? 0) + 1,
        retryAt: Date.now() + 30000,
      });
      if (old)
        return {
          ...old.value,
          fetchedAt: new Date(old.at).toISOString(),
          cache: "stale",
          warning: "Provider unavailable. Last successful data shown.",
        };
      throw e;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}
export function providerHealth() {
  return [
    { name: "MBTA V3", status: enabled() ? "not checked" : "disabled", lastSuccess: null },
    {
      name: "OpenTripPlanner",
      status: process.env.OTP_GRAPHQL_URL ? "configured, not checked" : "not configured",
      lastSuccess: null,
    },
    {
      name: "GBFS",
      status: process.env.GBFS_URL ? "configured, not checked" : "not configured",
      lastSuccess: null,
    },
    ...health.values(),
  ];
}
export async function mbtaVehicles() {
  return cached("MBTA vehicles", 15000, async () => {
    const d = await json("https://api-v3.mbta.com/vehicles?page%5Blimit%5D=100&sort=-updated_at", {
      headers: process.env.MBTA_API_KEY ? { "x-api-key": process.env.MBTA_API_KEY } : {},
    });
    return {
      source: "MBTA V3",
      vehicles: (d.data ?? [])
        .map((v) => ({
          id: v.id,
          vehicleId: v.attributes.label,
          tripId: v.relationships?.trip?.data?.id,
          routeId: v.relationships?.route?.data?.id,
          provider: "mbta",
          lat: v.attributes.latitude,
          lon: v.attributes.longitude,
          bearing: v.attributes.bearing,
          status: v.attributes.current_status,
          occupancy: v.attributes.occupancy_status ?? "unknown",
          // Store the RAW measurement only -- source, observedAt (the true measurement time),
          // confidence and position. Do NOT call freshness() here: this object is cached for
          // up to 15s (see `cached` above) and then persisted onto journeys, so a derived
          // age/stale/label computed at fetch time would keep answering "how fresh was this
          // when we fetched it" forever, instead of "how fresh is this right now". Every
          // consumer must call freshness(tracking, now) itself, at the actual moment of
          // response or render (see withFreshTracking in domain/journeys.mjs).
          tracking: {
            source: "live-gps",
            observedAt: v.attributes.updated_at,
            confidence: null,
            position: [v.attributes.longitude, v.attributes.latitude],
          },
        }))
        .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon)),
    };
  });
}
export async function mbtaAlerts() {
  return cached("MBTA alerts", 30000, async () => {
    const d = await json("https://api-v3.mbta.com/alerts?page%5Blimit%5D=40", {
      headers: process.env.MBTA_API_KEY ? { "x-api-key": process.env.MBTA_API_KEY } : {},
    });
    return {
      source: "MBTA V3",
      alerts: (d.data ?? []).map((a) => ({
        id: a.id,
        header: a.attributes.header,
        description: a.attributes.description,
        severity: a.attributes.severity,
        effect: a.attributes.effect,
        updatedAt: a.attributes.updated_at,
        activePeriods: a.attributes.active_period,
        informed: a.attributes.informed_entity,
        url: a.attributes.url,
      })),
    };
  });
}
export function configuredSources() {
  if (!process.env.TRANSIT_SOURCES_FILE) return [];
  const d = JSON.parse(readFileSync(process.env.TRANSIT_SOURCES_FILE, "utf8"));
  if (!Array.isArray(d) || d.length > 200)
    throw new Error("Transit sources configuration must be an array with at most 200 entries.");
  for (const s of d) {
    if (!s.id || !s.name || !s.url || !["vehicles", "updates", "alerts"].includes(s.kind))
      throw new Error("Invalid transit source.");
    const u = new URL(s.url);
    if (u.protocol !== "https:" || u.username || u.password)
      throw new Error("GTFS-RT sources require HTTPS.");
  }
  return d;
}
export async function gtfsRealtime(id) {
  const source = configuredSources().find((s) => s.id === id);
  if (!source) throw new DomainError("Transit source not configured.", 404);
  return cached(`GTFS-RT ${id}`, 15000, async () => {
    const module = await import("gtfs-realtime-bindings");
    const proto = (module.default ?? module).transit_realtime;
    const bytes = await fetchBounded(source.url, {
      headers: source.apiKeyEnv
        ? { Authorization: `Bearer ${process.env[source.apiKeyEnv] ?? ""}` }
        : {},
    });
    const feed = proto.FeedMessage.toObject(proto.FeedMessage.decode(bytes), {
      longs: Number,
      enums: String,
    });
    return {
      source: { id: source.id, name: source.name, kind: source.kind },
      timestamp: feed.header.timestamp,
      entities: feed.entity,
    };
  });
}
export async function gbfs() {
  if (!process.env.GBFS_URL)
    throw new DomainError(
      "No bikeshare or scooter feed is connected. Configure GBFS_URL.",
      503,
      "PROVIDER_REQUIRED",
    );
  return cached("GBFS", 30000, async () => {
    const url = process.env.GBFS_URL;
    const root = await json(url);
    const language =
      root.data?.en ?? Object.values(root.data ?? {}).find((x) => x?.feeds) ?? root.data;
    const feeds = language?.feeds ?? [];
    const allowed = new Set([
      new URL(url).hostname,
      ...(process.env.GBFS_ALLOWED_HOSTS ?? "").split(",").filter(Boolean),
    ]);
    const read = async (name) => {
      const f = feeds.find((f) => f.name === name);
      if (!f) return null;
      const u = new URL(f.url);
      if (u.protocol !== "https:" || !allowed.has(u.hostname) || u.username || u.password)
        throw new DomainError("A GBFS feed points outside the configured host allowlist.", 502);
      return json(u.href);
    };
    const [info, status, vehicles] = await Promise.all([
      read("station_information"),
      read("station_status"),
      read("vehicle_status").then((v) => v ?? read("free_bike_status")),
    ]);
    const byId = new Map((status?.data?.stations ?? []).map((s) => [s.station_id, s]));
    return {
      source: "GBFS",
      version: root.version,
      updatedAt: status?.last_updated ?? root.last_updated,
      stations: (info?.data?.stations ?? [])
        .slice(0, 300)
        .map((s) => ({ ...s, ...byId.get(s.station_id) })),
      vehicles: (vehicles?.data?.vehicles ?? vehicles?.data?.bikes ?? []).slice(0, 300),
    };
  });
}
export async function weather(lat, lon) {
  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  )
    throw new DomainError("Invalid weather coordinates.");
  return cached(`weather:${lat.toFixed(2)},${lon.toFixed(2)}`, 600000, async () => {
    const d = await json(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,snowfall,weather_code&timezone=UTC`,
    );
    return {
      source: "Open-Meteo",
      current: d.current,
      units: d.current_units,
      sourceUrl: "https://open-meteo.com/",
    };
  });
}
let geocodeChain = Promise.resolve(),
  lastGeocode = 0;
export async function geocode(q) {
  if (!process.env.GEOCODER_USER_AGENT)
    throw new DomainError(
      "Set GEOCODER_USER_AGENT with a contact address before using public geocoding.",
      503,
    );
  return cached(`geocode:${q.toLowerCase()}`, 86400000, async () => {
    const task = geocodeChain.then(async () => {
      const delay = Math.max(0, 1100 - (Date.now() - lastGeocode));
      if (delay) await new Promise((r) => setTimeout(r, delay));
      lastGeocode = Date.now();
      const u = new URL(process.env.GEOCODER_URL ?? "https://nominatim.openstreetmap.org/search");
      u.search = new URLSearchParams({
        q,
        format: "jsonv2",
        limit: "5",
        countrycodes: "us",
      }).toString();
      const d = await json(u.href, { headers: { "User-Agent": process.env.GEOCODER_USER_AGENT } });
      return {
        source: "OpenStreetMap Nominatim",
        results: d.map((x) => ({ name: x.display_name, lat: Number(x.lat), lon: Number(x.lon) })),
      };
    });
    geocodeChain = task.catch(() => {});
    return task;
  });
}
export async function streetRoute({ fromLat, fromLon, toLat, toLon, mode = "pedestrian" }) {
  if (!process.env.VALHALLA_URL)
    throw new DomainError("Connect VALHALLA_URL for walking, cycling and driving directions.", 503);
  if (!["pedestrian", "bicycle", "auto"].includes(mode))
    throw new DomainError("Unsupported street-routing mode.");
  for (const [v, max] of [
    [fromLat, 90],
    [toLat, 90],
    [fromLon, 180],
    [toLon, 180],
  ])
    if (!Number.isFinite(v) || Math.abs(v) > max) throw new DomainError("Invalid coordinates.");
  return {
    source: "Valhalla",
    ...(await json(process.env.VALHALLA_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        locations: [
          { lat: fromLat, lon: fromLon },
          { lat: toLat, lon: toLon },
        ],
        costing: mode,
        units: "kilometers",
      }),
    })),
  };
}
// Canonical live-tracking agency identifiers this deployment can actually refresh positions
// for (see mbtaVehicles). This is deliberately separate from a leg's `provider`, which records
// which routing engine (e.g. "otp") produced the itinerary -- a routing engine and a live-data
// source are different concerns, and conflating them previously meant every OTP-routed leg was
// silently skipped by tracking refresh even when its true operating agency (e.g. MBTA) does
// have a live feed. Matching by GTFS agency_id first (feed-configuration-specific, so this
// mapping needs confirming against the real deployment's feed) and falling back to the
// human-readable agency name.
const TRACKED_AGENCY_IDS = { mbta: "mbta", MBTA: "mbta" };
export function canonicalAgencyId(agency) {
  if (!agency) return null;
  const byId = TRACKED_AGENCY_IDS[agency.id];
  if (byId) return byId;
  if (typeof agency.name === "string" && agency.name.toUpperCase().includes("MBTA")) return "mbta";
  return null;
}
// OTP's GraphQL `gtfsId` fields are feed-scoped ("feedId:entityId"). MBTA's own v3 API returns
// unprefixed raw GTFS ids for the same entities in its own feed. Strip a leading "feedId:" so a
// leg's tripId/routeId can be compared directly against what mbtaVehicles() returns. This
// assumes OTP's graph for MBTA was built from a feed sharing MBTA's own trip/route ids, which
// needs validating against the real deployment rather than assumed.
export function normalizeGtfsId(gtfsId) {
  if (typeof gtfsId !== "string") return null;
  const colon = gtfsId.indexOf(":");
  return colon === -1 ? gtfsId : gtfsId.slice(colon + 1);
}
// OTP 2.x legacy GraphQL schema. Validate against the region's pinned OTP deployment.
export async function otpSearch(input) {
  if (!process.env.OTP_GRAPHQL_URL)
    throw new DomainError(
      "Connect an OpenTripPlanner region before searching live schedules.",
      503,
      "PROVIDER_REQUIRED",
    );
  const from = cities.find((c) => c.id === input.from),
    to = cities.find((c) => c.id === input.to);
  if (!from || !to) throw new DomainError("Unknown endpoint.");
  const timestamp = Date.parse(input.deadline ?? input.departure);
  if (!Number.isFinite(timestamp)) throw new DomainError("Invalid routing time.");
  const zoned = new Intl.DateTimeFormat("sv-SE", {
    timeZone: from.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
  const [date, time] = zoned.split(" ");
  // Requests agency{id name} and route{gtfsId} in addition to the original fields so live
  // tracking can later identify which agency/route actually operates a leg (see
  // canonicalAgencyId/normalizeGtfsId below), independent of "otp" being the routing engine
  // that produced the itinerary. OTP1 legacy GraphQL is assumed here per the existing adapter;
  // this still needs validation against the deployment's actual OTP version/schema.
  const query = `query Plan($from:String!,$to:String!,$date:String!,$time:String!,$arrive:Boolean!,$wheelchair:Boolean!){plan(fromPlace:$from,toPlace:$to,date:$date,time:$time,arriveBy:$arrive,wheelchair:$wheelchair,numItineraries:5){itineraries{duration startTime endTime walkTime transfers legs{mode startTime endTime duration realTime departureDelay arrivalDelay from{name lat lon} to{name lat lon} route{shortName longName gtfsId agency{id name}} trip{gtfsId} legGeometry{points}}}}}`;
  const d = await json(process.env.OTP_GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query,
      variables: {
        from: `${from.lat},${from.lon}`,
        to: `${to.lat},${to.lon}`,
        date,
        time,
        arrive: Boolean(input.deadline),
        wheelchair: Boolean(input.preferences?.wheelchair || input.preferences?.stepFree),
      },
    }),
  });
  if (d.errors?.length)
    throw new DomainError(
      "The routing provider rejected the request. Check the configured OTP schema and region.",
      502,
      "OTP_SCHEMA_ERROR",
    );
  const journeys = (d.data?.plan?.itineraries ?? []).map((i, index) => {
    const legs = i.legs.map((l, n) => ({
      id: `leg-${n}`,
      mode:
        {
          SUBWAY: "metro",
          TRAM: "tram",
          RAIL: "train",
          BUS: "bus",
          FERRY: "ferry",
          WALK: "walk",
          BICYCLE: "bike",
          CAR: "drive",
        }[l.mode] ?? "bus",
      operator: l.route?.agency?.name ?? l.mode,
      service: l.route?.shortName ?? l.route?.longName ?? l.mode,
      from: l.from.name,
      to: l.to.name,
      departure: new Date(l.startTime).toISOString(),
      arrival: new Date(l.endTime).toISOString(),
      durationMinutes: Math.round(l.duration / 60),
      delayMinutes: Math.round((l.arrivalDelay ?? 0) / 60),
      // Canonical, unprefixed ids used to match this leg against a live-tracking feed (e.g.
      // mbtaVehicles). Kept separate from routingTripId, which preserves OTP's raw feed-scoped
      // id for provenance/debugging (feature 11) even though it isn't what tracking matches on.
      tripId: normalizeGtfsId(l.trip?.gtfsId),
      routingTripId: l.trip?.gtfsId ?? null,
      routeId: normalizeGtfsId(l.route?.gtfsId),
      // "provider" records which routing engine produced this leg (OTP); "agency" records which
      // live-tracking source, if any, actually operates it. These must not be conflated: a leg
      // routed by OTP can still be an MBTA-operated trip with real live tracking available.
      provider: "otp",
      agency: canonicalAgencyId(l.route?.agency),
      priceCents: null,
      tracking: {
        source: l.realTime ? "predicted" : "schedule",
        observedAt: null,
        confidence: null,
      },
      accessible: null,
      platform: null,
      boardingHint: "Confirm the gate or stop using official signs.",
      geometry: l.legGeometry?.points,
    }));
    const j = {
      id: `otp-${timestamp}-${index}`,
      name: "Scheduled route",
      from: from.name,
      to: to.name,
      fromId: from.id,
      toId: to.id,
      fromCoords: [from.lon, from.lat],
      toCoords: [to.lon, to.lat],
      timezone: from.timezone,
      destinationTimezone: to.timezone,
      departure: new Date(i.startTime).toISOString(),
      arrival: new Date(i.endTime).toISOString(),
      durationMinutes: Math.round(i.duration / 60),
      price: { totalCents: null, items: [], currency: "USD", unknown: true },
      travelers: input.travelers ?? 1,
      bags: input.bags ?? 0,
      dataMode: "provider",
      legs,
      reliability: null,
      carbonKg: null,
      drivingCarbonKg: null,
      walkMinutes: Math.round(i.walkTime / 60),
      transfers: i.transfers,
      accessible: null,
      bookable: false,
      shape: null,
    };
    return {
      ...j,
      graph: connectionGraph(j, { preferences: input.preferences }),
      leave: leaveNow(j, input.preferences),
    };
  });
  const p = input.preferences ?? {};
  const excluded = [];
  const eligible = journeys.filter((j) => {
    let reason = null;
    if (j.walkMinutes > (p.maxWalkMinutes ?? 120)) reason = "Walking limit";
    else if (j.transfers > (p.maxTransfers ?? 8)) reason = "Transfer limit";
    else if (p.avoidBus && j.legs.some((l) => l.mode === "bus")) reason = "Bus excluded";
    else if (input.deadline && Date.parse(j.arrival) > Date.parse(input.deadline))
      reason = "After arrival deadline";
    else if (
      (p.importance === "critical" || p.riskTolerance === "conservative") &&
      j.graph.overallRisk !== "low"
    )
      reason = "Connection risk";
    if (reason) excluded.push({ name: j.name, reason });
    return !reason;
  });
  return {
    journeys: eligible,
    excluded,
    dataMode: "provider",
    reason: eligible.length ? null : "No eligible itineraries returned by the connected region.",
    warning:
      "Fare and accessibility details are not returned by this adapter. A budget cannot be verified; confirm prices and access with the operator.",
  };
}
// A capability's status should say why it isn't available, not just that it isn't (feature 12,
// "Integration capabilities"). This previously reported every entry as "not connected" with one
// shared reason implying all twelve need a configured, authorized provider -- which is not true.
// Two honest groups exist in this codebase today:
//   - "provider required": genuinely needs a commercial or contracted third party (a payment
//     processor, a carrier's ticketing/inventory API, an SMS/email vendor, a GDS). No amount of
//     local code closes that gap.
//   - "unsupported": no implementation exists in this codebase at all yet -- distinct from
//     "provider required" because closing the gap does not inherently require a paid contract.
//     Standards-based web push (remote-push), for instance, needs only a subscription endpoint
//     and VAPID keys once built, not a commercial relationship; native-watch, indoor-ar and
//     ev-live-availability need platform-specific engineering and/or a data partnership, which is
//     a different kind of gap than "needs a signed contract."
// Nothing here is reported "healthy" or "authorized": those states require a real, checkable
// connection, and none of these twelve have one. When one gets a real adapter, compute its status
// the same way providerHealth() above does -- configured via env var, then verified by an actual
// check -- rather than adding another hardcoded string.
const CAPABILITY_INFO = {
  "unified-checkout": {
    status: "provider required",
    reason: "Requires an authorized payment provider and carrier checkout contract.",
  },
  "ticket-issuance": {
    status: "provider required",
    reason: "Requires an authorized carrier ticketing contract.",
  },
  "seat-inventory": {
    status: "provider required",
    reason: "Requires a carrier inventory/reservation API agreement.",
  },
  "payment-tokenization": {
    status: "provider required",
    reason: "Requires an authorized payment processor.",
  },
  "automatic-rebooking": {
    status: "provider required",
    reason: "Requires ticket-issuance and exchange/refund rules from an authorized carrier.",
  },
  "refund-submission": {
    status: "provider required",
    reason: "Requires an authorized carrier or payment provider refund API.",
  },
  "native-watch": {
    status: "unsupported",
    reason: "Not implemented in this codebase yet. Needs a native companion app.",
  },
  "flight-inventory": {
    status: "provider required",
    reason: "Requires an authorized flight-data or GDS provider.",
  },
  "indoor-ar": {
    status: "unsupported",
    reason: "Not implemented in this codebase yet. Needs indoor maps and AR platform support.",
  },
  "ev-live-availability": {
    status: "unsupported",
    reason: "Not implemented in this codebase yet. Needs an authorized EV charging-network feed.",
  },
  "remote-push": {
    status: "unsupported",
    reason:
      "Not implemented in this codebase yet. Standards-based web push needs no commercial contract, only a push subscription endpoint and VAPID keys, neither of which exist here today.",
  },
  "sms-email": {
    status: "provider required",
    reason: "Requires a contracted SMS/email delivery provider.",
  },
};
export const commercialCapabilities = Object.entries(CAPABILITY_INFO).map(([id, info]) => ({
  id,
  status: info.status,
  enabled: false,
  reason: info.reason,
}));
