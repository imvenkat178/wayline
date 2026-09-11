import { createHash } from "node:crypto";
import { fetchBounded, normalizeGtfsId } from "../adapters/providers.mjs";
import { DomainError, connectionGraph, leaveNow } from "../domain/journeys.mjs";
export const OTP_QUERY = `query Plan($from:PlanLabeledLocationInput!,$to:PlanLabeledLocationInput!,$when:PlanDateTimeInput!,$preferences:PlanPreferencesInput!){planConnection(origin:$from,destination:$to,dateTime:$when,preferences:$preferences,first:5){edges{node{duration start end walkTime numberOfTransfers legs{mode start{scheduledTime estimated{time}} end{scheduledTime estimated{time}} duration serviceDate from{name lat lon stop{gtfsId platformCode parentStation{gtfsId}}} to{name lat lon stop{gtfsId platformCode parentStation{gtfsId}}} route{shortName longName gtfsId agency{gtfsId name}} trip{gtfsId directionId} legGeometry{points}}}} routingErrors{code description}}}`;
export async function otpPlan(input) {
  if (!process.env.OTP_GRAPHQL_URL)
    throw new DomainError("Boston routing is not configured.", 503, "PROVIDER_REQUIRED");
  const { from, to } = input;
  for (const p of [from, to])
    if (p.lat < 41 || p.lat > 43.5 || p.lon < -73.6 || p.lon > -69)
      throw new DomainError(
        "Live routing currently covers the Boston / MBTA region. Choose Boston stations or switch to sample routes.",
        400,
        "OUTSIDE_COVERAGE",
      );
  const p = input.preferences ?? {};
  const variables = {
    from: {
      label: from.name,
      location: { coordinate: { latitude: from.lat, longitude: from.lon } },
    },
    to: { label: to.name, location: { coordinate: { latitude: to.lat, longitude: to.lon } } },
    when: input.deadline
      ? { latestArrival: input.deadline }
      : { earliestDeparture: input.departure },
    preferences: {
      accessibility: { wheelchair: { enabled: !!(p.wheelchair || p.stepFree) } },
      transit: {
        transfer: {
          maximumTransfers: p.maxTransfers ?? 3,
          slack: "PT" + (p.minConnectionMinutes ?? 8) * 60 + "S",
        },
      },
    },
  };
  const bytes = await fetchBounded(process.env.OTP_GRAPHQL_URL, {
    method: "POST",
    timeoutMs: 15000,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: OTP_QUERY, variables }),
  });
  const r = JSON.parse(bytes.toString());
  if (r.errors?.length)
    throw new DomainError(
      "Boston routing rejected this request. " + r.errors[0].message,
      502,
      "OTP_SCHEMA_ERROR",
    );
  const itineraries = r.data?.planConnection?.edges?.map((e) => e.node);
  if (!Array.isArray(itineraries))
    throw new DomainError("Routing returned an invalid response.", 502);
  const journeys = itineraries
    .filter((i) => i.legs?.length)
    .map((i) => normalizeItinerary(i, input));
  const excluded = [];
  const eligible = journeys.filter((j) => {
    const reason =
      j.walkMinutes > (p.maxWalkMinutes ?? 120)
        ? "Walking limit"
        : j.transfers > (p.maxTransfers ?? 8)
          ? "Transfer limit"
          : p.avoidBus && j.legs.some((l) => l.mode === "bus")
            ? "Bus excluded"
            : input.deadline && Date.parse(j.arrival) > Date.parse(input.deadline)
              ? "After arrival deadline"
              : null;
    if (reason) excluded.push({ name: j.name, reason });
    return !reason;
  });
  return {
    journeys: eligible,
    excluded,
    dataMode: "provider",
    reason: eligible.length
      ? undefined
      : "No eligible itineraries returned. Try a later departure or different preferences.",
    warning:
      "Live Boston schedules. Fares and accessibility details require operator verification; no tickets are issued.",
  };
}
export function normalizeItinerary(i, input) {
  const stamp = (v) => new Date(typeof v === "number" ? v : v).toISOString();
  const { from, to } = input;
  const legs = i.legs.map((l, n) => ({
    id: "leg-" + n,
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
    operator: l.route?.agency?.name ?? (l.mode === "WALK" ? "Walking" : "Transit"),
    service: l.route?.shortName ?? l.route?.longName ?? l.mode,
    from: l.from.name,
    to: l.to.name,
    fromCoords: [l.from.lon, l.from.lat],
    toCoords: [l.to.lon, l.to.lat],
    fromStopId: normalizeGtfsId(l.from.stop?.gtfsId),
    fromParentStopId: normalizeGtfsId(l.from.stop?.parentStation?.gtfsId),
    toParentStopId: normalizeGtfsId(l.to.stop?.parentStation?.gtfsId),
    toStopId: normalizeGtfsId(l.to.stop?.gtfsId),
    scheduledDeparture: stamp(l.start.scheduledTime),
    scheduledArrival: stamp(l.end.scheduledTime),
    departure: stamp(l.start.estimated?.time ?? l.start.scheduledTime),
    arrival: stamp(l.end.estimated?.time ?? l.end.scheduledTime),
    durationMinutes: Math.round(l.duration / 60),
    delayMinutes: l.end.estimated
      ? Math.round((Date.parse(l.end.estimated.time) - Date.parse(l.end.scheduledTime)) / 60000)
      : 0,
    departureDelayMinutes: l.start.estimated
      ? Math.round((Date.parse(l.start.estimated.time) - Date.parse(l.start.scheduledTime)) / 60000)
      : 0,
    tripId: normalizeGtfsId(l.trip?.gtfsId),
    routingTripId: l.trip?.gtfsId ?? null,
    routeId: normalizeGtfsId(l.route?.gtfsId),
    provider: "otp",
    agency: l.route?.agency?.name?.toUpperCase().includes("MBTA") ? "mbta" : null,
    serviceDate: l.serviceDate,
    directionId: l.trip?.directionId ?? null,
    priceCents: null,
    crowding: null,
    accessible: null,
    tracking: {
      source: l.start.estimated ? "predicted" : "schedule",
      observedAt: l.start.estimated ? new Date().toISOString() : null,
      confidence: null,
    },
    platform: l.from.stop?.platformCode ?? null,
    platformSource: l.from.stop?.platformCode ? "MBTA GTFS" : undefined,
    boardingHint: "Check the station board for current departure and boarding information.",
    geometry: l.legGeometry?.points,
  }));
  const signature = legs.map((l) => [l.tripId, l.fromStopId, l.toStopId, l.departure, l.arrival]);
  const j = {
    id: "otp-" + createHash("sha256").update(JSON.stringify(signature)).digest("hex").slice(0, 20),
    name: "Boston scheduled journey",
    from: from.name,
    to: to.name,
    fromId: from.id,
    toId: to.id,
    fromPlace: from,
    toPlace: to,
    fromCoords: [from.lon, from.lat],
    toCoords: [to.lon, to.lat],
    timezone: "America/New_York",
    destinationTimezone: "America/New_York",
    departure: stamp(i.start),
    arrival: stamp(i.end),
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
    transfers: i.numberOfTransfers,
    accessible: null,
    bookable: false,
    shape: null,
    observedAt: new Date().toISOString(),
  };
  return {
    ...j,
    graph: connectionGraph(j, { preferences: input.preferences }),
    leave: leaveNow(j, input.preferences),
  };
}
