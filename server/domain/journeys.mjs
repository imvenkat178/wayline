import { randomUUID } from "node:crypto";
import { cities, corridors, defaultPreferences, operatorForCorridor } from "../catalog.mjs";

export class DomainError extends Error {
  constructor(message, status = 400, code = "INVALID_INPUT") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function integer(value, name, min, max, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max)
    throw new DomainError(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}
export function text(value, name, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new DomainError(`${name} is required (maximum ${max} characters).`);
  return value.trim();
}
export function preferences(input = {}) {
  const out = { ...defaultPreferences };
  for (const k of Object.keys(out)) {
    if (input[k] === undefined) continue;
    if (typeof input[k] !== typeof out[k]) throw new DomainError(`Invalid ${k}.`);
    out[k] = input[k];
  }
  for (const [k, min, max] of [
    ["budgetCents", 0, 1000000],
    ["maxTransfers", 0, 8],
    ["maxWalkMinutes", 0, 120],
    ["minConnectionMinutes", 0, 120],
    ["historyDays", 0, 3650],
    ["recoveryLimitCents", 0, 100000],
    ["emergencyMinutes", 5, 1440],
  ])
    integer(out[k], k, min, max);
  if (!Number.isFinite(out.walkSpeed) || out.walkSpeed < 0.3 || out.walkSpeed > 2.5)
    throw new DomainError("Walking speed must be between 0.3 and 2.5 m/s.");
  for (const [k, values] of Object.entries({
    priority: ["balanced", "price", "fastest", "reliable", "walking", "transfers", "carbon"],
    riskTolerance: ["conservative", "balanced", "aggressive"],
    importance: ["casual", "normal", "important", "critical"],
    language: ["en", "es", "hi"],
  })) {
    if (!values.includes(out[k])) throw new DomainError(`Invalid ${k}.`);
  }
  for (const k of ["quietStart", "quietEnd"])
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(out[k])) throw new DomainError(`Invalid ${k}.`);
  return out;
}
export function freshness(signal, now = Date.now()) {
  if (signal.source === "sample")
    return {
      ...signal,
      source: "sample",
      ageSeconds: null,
      confidence: null,
      stale: false,
      ghost: false,
      label: "Sample signal",
    };
  const stamp = Date.parse(signal.observedAt),
    age = Number.isFinite(stamp) ? Math.max(0, Math.round((now - stamp) / 1000)) : null;
  const fresh = age !== null && age <= 90 && stamp <= now + 30000;
  const source =
    signal.source === "live-gps"
      ? fresh
        ? "live-gps"
        : age !== null && age < 900
          ? "predicted"
          : "schedule"
      : signal.source;
  return {
    ...signal,
    source,
    ageSeconds: age,
    stale: !fresh,
    confidence: source === "schedule" ? null : (signal.confidence ?? null),
    ghost: signal.source === "live-gps" && !fresh,
    label:
      source === "live-gps"
        ? "Live GPS"
        : source === "predicted"
          ? "Stale position · estimate"
          : source === "crowdsourced"
            ? "Rider report · unverified"
            : "Schedule only",
  };
}
export function connectionGraph(
  journey,
  { delayMinutes = 0, accessibilityOutage = false, weather = "clear", preferences: p = {} } = {},
) {
  const pref = { ...defaultPreferences, ...p };
  let propagated = delayMinutes;
  const transit = journey.legs.filter(
    (l) => !["walk", "drive", "bike", "scooter"].includes(l.mode),
  );
  const connections = [];
  for (let i = 0; i < transit.length - 1; i++) {
    const incoming = transit[i],
      outgoing = transit[i + 1];
    const walk = Math.ceil((outgoing.transferWalkMeters ?? 240) / (pref.walkSpeed * 60));
    const access =
      accessibilityOutage && (pref.stepFree || pref.wheelchair || pref.elevatorRequired) ? 12 : 0;
    const weatherBuffer =
      weather === "snow" ? 10 : weather === "rain" ? 4 : weather === "heat" ? 3 : 0;
    const cutoff = outgoing.boardingCutoffMinutes ?? 3;
    const required = walk + cutoff + pref.minConnectionMinutes + access + weatherBuffer;
    const scheduledBuffer = Math.round(
      (Date.parse(outgoing.departure) - Date.parse(incoming.arrival)) / 60000,
    );
    const buffer = scheduledBuffer - Math.max(incoming.delayMinutes ?? 0, propagated);
    const spare = buffer - required;
    const probability = Math.max(1, Math.min(99, Math.round(100 / (1 + Math.exp(-spare / 6)))));
    connections.push({
      id: `${incoming.id}:${outgoing.id}`,
      from: incoming.id,
      to: outgoing.id,
      station: outgoing.from,
      scheduledBuffer,
      buffer,
      requiredMinutes: required,
      walkMinutes: walk,
      cutoffMinutes: cutoff,
      spareMinutes: spare,
      risk: spare < 0 ? "high" : spare < 8 ? "moderate" : "low",
      probability,
      model: "heuristic; not a calibrated probability",
      blocked: access > 0,
    });
    propagated = Math.max(0, propagated - Math.max(0, scheduledBuffer - required));
  }
  return {
    connections,
    arrivalDelayMinutes: propagated,
    overallRisk: connections.some((c) => c.risk === "high")
      ? "high"
      : connections.some((c) => c.risk === "moderate")
        ? "moderate"
        : "low",
    model: "illustrative" === journey.dataMode ? "sample assumptions" : "heuristic, uncalibrated",
  };
}
export function leaveNow(journey, p = defaultPreferences, now = Date.now()) {
  const first = journey.legs.find((l) => l.mode !== "walk") ?? journey.legs[0];
  const walk = journey.legs
    .filter((l) => l.mode === "walk")
    .slice(0, 1)
    .reduce((a, l) => a + l.durationMinutes, 0);
  const buffer = 10 + (p.wheelchair || p.stepFree ? 10 : 0);
  const leaveAt = Date.parse(first.departure) - (walk + buffer) * 60000;
  return {
    leaveAt: new Date(leaveAt).toISOString(),
    minutes: Math.floor((leaveAt - now) / 60000),
    walkMinutes: walk,
    boardingBuffer: buffer,
    locationBased: false,
  };
}
export function priceBreakdown(
  fareCents,
  { travelers = 1, bags = 0, bookingFeeCents = 421, parkingCents = 0, lastMileCents = 0 } = {},
) {
  integer(travelers, "Travelers", 1, 12);
  integer(bags, "Bags", 0, 10);
  integer(bookingFeeCents, "Booking fee", 0, 100000);
  integer(parkingCents, "Parking", 0, 100000);
  integer(lastMileCents, "Last mile", 0, 100000);
  const items = [
    {
      label: `Transit fares × ${travelers}`,
      cents: integer(fareCents, "Fare", 0, 1000000) * travelers,
    },
    { label: "Booking fees", cents: bookingFeeCents * travelers },
    { label: `Extra bags × ${bags}`, cents: bags * 500 },
    { label: "Parking", cents: parkingCents },
    { label: "Last-mile allowance", cents: lastMileCents },
  ];
  return { items, totalCents: items.reduce((a, b) => a + b.cents, 0), currency: "USD" };
}
function iso(ms) {
  return new Date(ms).toISOString();
}

// Hours treated as "night" for the nightWalking preference: 21:00 up to
// (not including) 06:00, wrapping across midnight. This is a preference
// amplifier the traveler opts into, not a safety claim (see feature 58,
// which still needs a verified environmental-safety dataset).
const NIGHT_START_HOUR = 21;
const NIGHT_END_HOUR = 6;

// Resolve the wall-clock hour (0-23) of an ISO instant in the journey's
// applicable local timezone (IANA name, e.g. "America/New_York"), rather
// than UTC. Intl.DateTimeFormat resolves DST transitions and midnight
// rollover correctly for any supported zone; falls back to UTC only if no
// timezone is available or the zone is invalid.
export function localHour(dateIso, timezone) {
  const date = new Date(dateIso);
  if (!timezone) return date.getUTCHours();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(date);
    const hour = parts.find((part) => part.type === "hour")?.value;
    return hour === undefined ? date.getUTCHours() : Number(hour);
  } catch {
    return date.getUTCHours();
  }
}

function isNightHour(hour) {
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

// The extra weight applied to a journey's walk minutes when the traveler has
// asked to avoid night walking and the journey departs during the origin's
// local night window. Kept as its own function so it can be tested directly
// without depending on the composite ranking formula below.
export function nightWalkingPenalty(journey, prefs) {
  if (!prefs.nightWalking) return 0;
  return isNightHour(localHour(journey.departure, journey.timezone)) ? journey.walkMinutes * 2 : 0;
}

// Combines every ranking preference into one comparable score for a single
// journey; lower is better. Named "custom"/"balanced" priorities (and any
// other value not in the fixed list below) fall through to the weighted
// composite so a single preferences object drives search, comparison and
// recovery consistently (feature 27).
export function rankingScore(journey, prefs) {
  switch (prefs.priority) {
    case "price":
      return journey.price.totalCents;
    case "fastest":
      return journey.durationMinutes;
    case "walking":
      return journey.walkMinutes;
    case "transfers":
      return journey.transfers;
    case "carbon":
      return journey.carbonKg;
    case "reliable":
      return -journey.reliability;
    default:
      return (
        journey.durationMinutes / 4 +
        journey.price.totalCents / 100 +
        (journey.graph.overallRisk === "high" ? 80 : 0) +
        (prefs.lessCrowded ? journey.legs[2].crowding : 0) +
        (prefs.preferTrain && journey.legs[2].mode !== "train" ? 40 : 0) +
        (prefs.coveredTransfers && journey.walkMinutes > 10 ? 25 : 0) +
        nightWalkingPenalty(journey, prefs)
      );
  }
}
export function sampleSearch(input) {
  const from = cities.find((c) => c.id === input.from),
    to = cities.find((c) => c.id === input.to);
  if (!from || !to || from.id === to.id)
    throw new DomainError("Choose two different supported places.");
  const corridor = corridors.find(
    (c) => (c.from === from.id && c.to === to.id) || (c.to === from.id && c.from === to.id),
  );
  const p = preferences(input.preferences ?? {});
  const travelers = integer(input.travelers ?? 1, "Travelers", 1, 12);
  const bags = integer(input.bags ?? 0, "Bags", 0, 10);
  const date = Date.parse(input.departure);
  if (!Number.isFinite(date)) throw new DomainError("Choose a valid departure date and time.");
  const deadline = input.deadline ? Date.parse(input.deadline) : null;
  if (deadline !== null && !Number.isFinite(deadline))
    throw new DomainError("Choose a valid arrival deadline.");
  if (!corridor)
    return {
      journeys: [],
      excluded: [],
      reason:
        "No sample corridor for these cities. Connect OpenTripPlanner to search your own service area.",
      dataMode: "illustrative",
    };
  const local = corridor.km < 100;
  const water = [from.id, to.id].includes("bai");
  const dataMode = "illustrative";
  const variants = [
    {
      name: "Balanced",
      mode: water ? "ferry" : "bus",
      extra: 0,
      buffer: 26,
      fare: local ? 750 : 6424,
      crowding: 42,
      walk: 9,
      reliability: 94,
    },
    {
      name: "Lowest cost",
      mode: water ? "ferry" : "bus",
      extra: 62,
      buffer: 12,
      fare: local ? 425 : 5899,
      crowding: 78,
      walk: 18,
      reliability: 79,
    },
    {
      name: "More breathing room",
      mode: water ? "ferry" : "train",
      extra: 32,
      buffer: 38,
      fare: local ? 1100 : 7489,
      crowding: 26,
      walk: 6,
      reliability: 98,
    },
    {
      name: water ? "Ferry + bikeshare" : "Park & ride",
      mode: water ? "ferry" : "train",
      extra: -16,
      buffer: 23,
      fare: local ? 875 : 7100,
      crowding: 38,
      walk: 4,
      reliability: 92,
    },
    {
      name: water ? "Ferry + scooter" : "Rideshare connection",
      mode: water ? "ferry" : "train",
      extra: -29,
      buffer: 28,
      fare: local ? 950 : 7550,
      crowding: 35,
      walk: 3,
      reliability: 93,
    },
  ];
  const journeys = variants.map((v, index) => {
    const duration = corridor.minutes + v.extra;
    const start = date + index * 12 * 60000;
    const firstDuration = Math.min(25, Math.round(duration * 0.1));
    const arrive = start + duration * 60000;
    const mainMode = v.mode;
    // Ground the sample operator in this corridor's real agency graph (roadmap feature 44,
    // Phase 11 -- see server/catalog.mjs's agenciesForCorridor/operatorForCorridor) when it has
    // one for this mode; otherwise fall back to the original generic guess. The graph currently
    // covers every water/"train"-mode variant for all six sample corridors (Amtrak for the
    // three long-distance ones, BART/LA Metro/Washington State Ferries for the three short/
    // local ones) but not the short local corridors' "bus"-mode variants, which keep the
    // original fallback since no real regional coach operator is seeded for them.
    const mainOperator =
      operatorForCorridor(corridor, mainMode)?.name ??
      (water
        ? "Washington State Ferries"
        : mainMode === "train"
          ? "Amtrak"
          : index === 1
            ? "Greyhound"
            : "FlixBus");
    const feederMode =
      index === 3
        ? water
          ? "bike"
          : "drive"
        : index === 4
          ? water
            ? "scooter"
            : "rideshare"
          : "metro";
    const mainStart = start + (firstDuration + v.buffer) * 60000;
    const legs = [
      {
        id: "walk-start",
        mode: "walk",
        operator: "Walk",
        service: "To your stop",
        from: `${from.name} starting point`,
        to: from.station,
        departure: iso(start - v.walk * 60000),
        arrival: iso(start),
        durationMinutes: v.walk,
        priceCents: 0,
      },
      {
        id: "feeder",
        mode: feederMode,
        operator: feederMode === "metro" ? "Local transit" : "First mile",
        service:
          index === 3 ? "Park & ride" : index === 4 ? "Connection ride" : "Station connection",
        from: from.station,
        to: `${from.name} transfer`,
        departure: iso(start),
        arrival: iso(start + firstDuration * 60000),
        durationMinutes: firstDuration,
        priceCents: 175,
        delayMinutes: 0,
      },
      {
        id: "main",
        mode: mainMode,
        operator: mainOperator,
        service: `${mainMode === "train" ? "Rail" : water ? "Ferry" : "Coach"} · sample ${218 + index}`,
        from: `${from.name} transfer`,
        to: to.station,
        departure: iso(mainStart),
        arrival: iso(arrive - 5 * 60000),
        durationMinutes: Math.round((arrive - mainStart) / 60000) - 5,
        priceCents: v.fare - 175,
        vehicleId: `SAMPLE-${218 + index}`,
        delayMinutes: 0,
        transferWalkMeters: 120,
        boardingCutoffMinutes: 3,
      },
      {
        id: "walk-end",
        mode: "walk",
        operator: "Walk",
        service: "To your destination",
        from: to.station,
        to: `${to.name} destination`,
        departure: iso(arrive - 5 * 60000),
        arrival: iso(arrive),
        durationMinutes: 5,
        priceCents: 0,
      },
    ].map((l) => ({
      ...l,
      accessible: index !== 1,
      accessibilitySource: "sample assumption",
      crowding: l.mode === "walk" ? null : v.crowding,
      crowdingSource: "sample assumption",
      tracking: { source: "sample", observedAt: null, confidence: null },
      boardingHint:
        "Illustrative boarding guide. Use the carrier’s departure board for the actual gate.",
      platform: null,
      platformSource: "unknown",
    }));
    const price = priceBreakdown(v.fare, {
      travelers,
      bags,
      bookingFeeCents: local ? 0 : 421,
      parkingCents: index === 3 && !water ? 800 : 0,
      lastMileCents: index === 4 && !water ? 1200 : 0,
    });
    const j = {
      id: `sample-${from.id}-${to.id}-${index}`,
      name: v.name,
      from: from.name,
      to: to.name,
      fromId: from.id,
      toId: to.id,
      fromCoords: [from.lon, from.lat],
      toCoords: [to.lon, to.lat],
      timezone: from.timezone,
      destinationTimezone: to.timezone,
      departure: legs[0].departure,
      arrival: iso(arrive),
      durationMinutes: duration + v.walk,
      price,
      travelers,
      bags,
      dataMode,
      legs,
      reliability: v.reliability,
      reliabilitySource: "sample assumption",
      carbonKg:
        Math.round(
          corridor.km * (mainMode === "train" ? 0.04 : water ? 0.12 : 0.07) * travelers * 10,
        ) / 10,
      drivingCarbonKg: Math.round(corridor.km * 0.192 * 10) / 10,
      carbonSource: "illustrative emissions factors; excludes vehicle lifecycle",
      walkMinutes: v.walk + 5,
      transfers: feederMode === "metro" ? 1 : 0,
      accessible: index !== 1,
      bookable: false,
      shape: null,
      generatedAt: iso(Date.now()),
    };
    const graph = connectionGraph(j, {
      preferences: p,
      weather: input.weather ?? "clear",
      accessibilityOutage: Boolean(input.accessibilityOutage),
    });
    return { ...j, graph, leave: leaveNow(j, p) };
  });
  const excluded = [];
  const filtered = journeys.filter((j) => {
    let reason = null;
    if (j.price.totalCents > p.budgetCents) reason = "Over total group budget";
    else if (j.walkMinutes > p.maxWalkMinutes) reason = "Exceeds walking limit";
    else if (j.transfers > p.maxTransfers) reason = "Too many transfers";
    else if ((p.wheelchair || p.stepFree || p.avoidStairs || p.elevatorRequired) && !j.accessible)
      reason = "Step-free access unavailable";
    else if (p.avoidBus && j.legs.some((l) => l.mode === "bus")) reason = "Bus excluded";
    else if (deadline && Date.parse(j.arrival) > deadline) reason = "Arrives after your deadline";
    else if (["important", "critical"].includes(p.importance) && j.graph.overallRisk === "high")
      reason = "Connection risk too high for an important trip";
    else if (p.riskTolerance === "conservative" && j.graph.overallRisk !== "low")
      reason = "Connection below your risk threshold";
    else if (
      input.accessibilityOutage &&
      (p.wheelchair || p.elevatorRequired) &&
      j.legs.some((l) => l.mode === "metro")
    )
      reason = "Elevator outage blocks this transfer";
    if (reason) excluded.push({ name: j.name, reason });
    return !reason;
  });
  filtered.sort((a, b) => rankingScore(a, p) - rankingScore(b, p));
  return {
    journeys: filtered,
    excluded,
    reason: filtered.length
      ? null
      : "No journey meets every constraint. Adjust your budget, deadline or preferences.",
    dataMode,
  };
}
export const transitions = {
  PLANNED: ["TRAVEL_TO_STOP", "BOOKED", "CANCELLED"],
  BOOKED: ["TRAVEL_TO_STOP", "CANCELLED"],
  TRAVEL_TO_STOP: ["WAITING", "DELAYED", "CANCELLED"],
  WAITING: ["BOARDING", "DELAYED", "CANCELLED"],
  BOARDING: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["TRANSFER", "ARRIVED", "DELAYED", "CANCELLED"],
  TRANSFER: ["WAITING", "BOARDING", "IN_TRANSIT", "MISSED_CONNECTION", "DELAYED", "ARRIVED"],
  DELAYED: ["WAITING", "IN_TRANSIT", "MISSED_CONNECTION", "REROUTING", "CANCELLED"],
  MISSED_CONNECTION: ["REROUTING", "CANCELLED"],
  REROUTING: ["RECOVERY_PENDING", "CANCELLED"],
  RECOVERY_PENDING: ["RECOVERED", "CANCELLED"],
  RECOVERED: ["TRAVEL_TO_STOP", "WAITING", "IN_TRANSIT", "ARRIVED"],
  ARRIVED: [],
  CANCELLED: [],
};
// Matches each leg of a journey against a live-vehicle feed, returning new leg objects (with
// `tracking`/`vehicleId` applied) and the count of legs that matched. A leg is eligible only
// when its canonical `agency` (the live-tracking source, e.g. "mbta") is present in the feed's
// vehicles -- NOT based on `provider` (the routing engine that produced the leg, e.g. "otp").
// Conflating the two previously meant every OTP-routed leg was silently skipped even when its
// true operating agency does have live tracking (see providers.mjs canonicalAgencyId).
// A route-id cross-check guards against a coincidental trip-id collision when both sides carry
// one; neither the leg nor the feed currently carries a service date, so an exact same-day trip
// instance still cannot be fully guaranteed (see the roadmap's tracking-provenance work).
export function matchLiveTracking(legs, vehicles, agency) {
  let matches = 0;
  const matchedLegs = legs.map((leg) => {
    if (leg.agency !== agency) return leg;
    if (!leg.tripId) return leg;
    const vehicle = vehicles.find(
      (v) => v.tripId === leg.tripId && (!leg.routeId || !v.routeId || v.routeId === leg.routeId),
    );
    if (!vehicle) return leg;
    matches++;
    return { ...leg, tracking: vehicle.tracking, vehicleId: vehicle.vehicleId };
  });
  return { legs: matchedLegs, matches };
}
export function transition(journey, next, now = Date.now()) {
  if (!transitions[journey.state]?.includes(next))
    throw new DomainError(
      `Cannot move from ${journey.state} to ${next}.`,
      409,
      "INVALID_TRANSITION",
    );
  if (next === "BOOKED" && !journey.bookingConfirmed)
    throw new DomainError(
      "An issued provider ticket is required before marking a journey booked.",
      409,
      "PROVIDER_REQUIRED",
    );
  return {
    ...journey,
    state: next,
    updatedAt: iso(now),
    events: [
      ...(journey.events ?? []),
      {
        id: randomUUID(),
        type: "STATE_CHANGED",
        from: journey.state,
        to: next,
        at: iso(now),
        source: "traveler",
      },
    ],
  };
}

// The floor, in minutes, a traveler needs after becoming free to act before they could
// plausibly reach a stop and board a different service. This sample-data model has no real
// walking-time or transfer graph, so this is a deliberately conservative minimum rather than a
// computed distance -- its purpose is only to stop recovery from ever offering something that
// cannot physically be caught, not to model actual transfer time.
export const RECOVERY_MIN_TRANSFER_MINUTES = 10;

// States in which the traveler has not yet boarded (or even departed toward) the journey being
// replaced: recovering from here still departs from the journey's own origin, exactly as before.
// Every other state means at least the first leg is already underway or complete, so the
// traveler is no longer standing at the original origin.
const RECOVERY_NOT_YET_DEPARTED = new Set([
  "PLANNED",
  "BOOKED",
  "TRAVEL_TO_STOP",
  "WAITING",
  "BOARDING",
]);

// Where a traveler can actually recover from right now: the stop they can currently reach, and
// the earliest moment they could plausibly board something else there. This sample-data model
// represents a journey as one corridor between exactly two catalog cities (no intermediate stop
// graph), so "current or next safely reachable stop" reduces to two cases: still at the original
// origin (nothing has departed yet), or already committed past it, in which case the traveler
// only becomes reachable again once their current/next leg actually lets them off -- which is
// the earliest a different service could realistically be boarded, not "any time before its
// listed arrival."
export function recoveryPosition(journey, now = Date.now()) {
  if (RECOVERY_NOT_YET_DEPARTED.has(journey.state))
    return { stopId: journey.fromId, earliestDeparture: now };
  const upcoming = journey.legs.find((l) => Date.parse(l.arrival) > now);
  const lastLeg = journey.legs[journey.legs.length - 1];
  return {
    stopId: journey.toId,
    earliestDeparture: upcoming ? Date.parse(upcoming.arrival) : Date.parse(lastLeg.arrival),
  };
}

// Validates a proposed recovery alternative against where the traveler can actually depart from
// and when, instead of only checking that it shares a destination and arrives in the future
// (feature 27, "Recovery origin"). Throws a DomainError describing exactly what failed; callers
// should not need to re-derive the reason. Because this sample-data model has no stop graph, an
// alternative can only be reachable while the traveler is still at the journey's original origin
// -- once they are already committed past it, no whole-corridor "alternative" from a fresh search
// is a coherent replacement, and this says so explicitly rather than silently accepting one.
export function assertRecoverable(journey, alternative, now = Date.now()) {
  if (["ARRIVED", "CANCELLED"].includes(journey.state))
    throw new DomainError("This journey is already finished; there is nothing to recover.", 409);
  if (alternative.toId !== journey.toId)
    throw new DomainError("Choose an alternative to the same destination from your search.");
  const position = recoveryPosition(journey, now);
  if (alternative.fromId !== position.stopId)
    throw new DomainError(
      "This alternative does not depart from where you can currently reach. Search again from your current position.",
      409,
    );
  const earliestBoardable = position.earliestDeparture + RECOVERY_MIN_TRANSFER_MINUTES * 60000;
  if (Date.parse(alternative.departure) < earliestBoardable)
    throw new DomainError(
      "This alternative departs before you could reach it. Choose a later option.",
      409,
    );
  if (Date.parse(alternative.arrival) < now)
    throw new DomainError("This alternative is in the past. Run a fresh search.");
}

// Two legs are the "same" leg for retention purposes: same mode, same named endpoints and same
// scheduled departure. This is a conservative, exact match -- it will not fire across different
// sample-search variants (their times differ by design), but it is correct wherever it does fire,
// and becomes meaningful once journeys are built from a real, shared leg/trip-instance model
// (Stage B) rather than five independently generated whole-corridor variants.
function sameLeg(a, b) {
  return a.mode === b.mode && a.from === b.from && a.to === b.to && a.departure === b.departure;
}

// What a recovery alternative would actually cost the traveler to switch to, instead of the
// previous whole-itinerary subtraction (feature 27, "Recovery economics"). Two corrections over
// that: (1) any leg identical between the original and the alternative has already been paid for
// and boarded, or will be regardless, so it is excluded from the cost of the CHANGE; (2) when a
// self-reported ticket with an actual paid amount exists for this journey, that paid amount --
// not the abstract itinerary estimate -- is the baseline for "what was already spent."
//
// This codebase has no payment integration (bookingConfirmed is never set true anywhere), no
// exchange/refund-rule data, and no nonrefundable-amount data -- none of that exists to calculate
// with yet (Stage D/E work per the roadmap). `basis` says plainly which baseline was used so a
// caller cannot present an estimate as a real quote, and nonrefundableCents is always null rather
// than a guessed number.
export function recoveryCost(journey, alternative, paidCentsForJourney = null) {
  const retainedLegCents = journey.legs
    .filter((leg) => (alternative.legs ?? []).some((other) => sameLeg(leg, other)))
    .reduce((sum, leg) => sum + (leg.priceCents ?? 0), 0);
  const baselineCents = paidCentsForJourney ?? journey.price.totalCents;
  const alternativeCents = alternative.price.totalCents;
  if (baselineCents === null || alternativeCents === null)
    return {
      incrementalCents: null,
      basis: "unknown",
      retainedLegCents,
      nonrefundableCents: null,
    };
  return {
    incrementalCents: alternativeCents - baselineCents - retainedLegCents,
    basis: paidCentsForJourney === null ? "estimate" : "paid",
    retainedLegCents,
    nonrefundableCents: null,
  };
}
// Returns the journey with every leg's `tracking` recomputed by freshness() against `now`,
// instead of whatever derived age/stale/label happened to be stored. Measurement time
// (observedAt) is the only part of tracking that is ever persisted; everything else is a
// function of "now" and must be recomputed at the moment of response or render, not baked in
// when the provider data was fetched or when /tracking was last refreshed. Apply this at every
// place a journey (or list of journeys) is about to be sent as a response.
export function withFreshTracking(journey, now = Date.now()) {
  return {
    ...journey,
    legs: journey.legs.map((leg) => ({
      ...leg,
      tracking: freshness(leg.tracking ?? { source: "schedule" }, now),
    })),
  };
}
export function digitalTwin(journey, options = {}, now = Date.now()) {
  const graph = connectionGraph(journey, options);
  const fresh = withFreshTracking(journey, now);
  const alerts = [];
  for (const c of graph.connections) {
    if (c.risk === "high")
      alerts.push({
        id: `risk:${c.id}`,
        severity: "critical",
        title: "Your connection needs attention",
        body: `${c.buffer} minutes remain; allow ${c.requiredMinutes} minutes to transfer at ${c.station}.`,
        kind: "connection",
      });
    if (c.blocked)
      alerts.push({
        id: `access:${c.id}`,
        severity: "critical",
        title: "Accessible transfer affected",
        body: "An elevator outage adds a modeled detour. Verify a step-free alternative with station staff.",
        kind: "accessibility",
      });
  }
  for (const leg of fresh.legs) {
    const f = leg.tracking;
    if (f.ghost)
      alerts.push({
        id: `ghost:${leg.id}`,
        severity: "warning",
        title: "Vehicle has not been confirmed recently",
        body: `${leg.service}: ${f.ageSeconds === null ? "no timestamp" : `${Math.floor(f.ageSeconds / 60)} minutes since its last signal`}. A missing signal does not prove cancellation.`,
        kind: "tracking",
      });
  }
  return {
    journeyId: journey.id,
    state: journey.state ?? "PLANNED",
    graph,
    alerts,
    leave: leaveNow(journey, options.preferences),
    arrival: iso(Date.parse(journey.arrival) + graph.arrivalDelayMinutes * 60000),
    tracking: fresh.legs.map((l) => ({
      legId: l.id,
      ...l.tracking,
    })),
    financial: { totalCents: journey.price.totalCents, refundableCents: null },
    updatedAt: iso(Date.now()),
  };
}
export function fareCompare({
  singleCents,
  rides,
  spentCents = 0,
  dayCapCents = 0,
  weeklyCents = 0,
  monthlyCents = 0,
}) {
  for (const [k, v] of Object.entries({
    singleCents,
    rides,
    spentCents,
    dayCapCents,
    weeklyCents,
    monthlyCents,
  }))
    integer(v, k, 0, k === "rides" ? 500 : 1000000);
  const options = [{ name: "Single rides", cents: singleCents * rides }];
  if (dayCapCents)
    options.push({
      name: "Daily cap (same eligible day)",
      cents: Math.min(singleCents * rides, Math.max(0, dayCapCents - spentCents)),
    });
  if (weeklyCents) options.push({ name: "Weekly pass (rides in one week)", cents: weeklyCents });
  if (monthlyCents)
    options.push({ name: "Monthly pass (rides in one month)", cents: monthlyCents });
  options.sort((a, b) => a.cents - b.cents);
  return {
    options,
    savingCents: singleCents * rides - options[0].cents,
    remainingCapCents: dayCapCents ? Math.max(0, dayCapCents - spentCents) : null,
    disclaimer:
      "User-entered fares. Compare rides in the same valid period and verify eligibility with the operator.",
  };
}
export function airportDeadline({
  flightDeparture,
  international = false,
  checkedBags = false,
  terminalMinutes = 20,
}) {
  const time = Date.parse(flightDeparture);
  if (!Number.isFinite(time)) throw new DomainError("Enter a valid flight departure.");
  integer(terminalMinutes, "Terminal transfer", 0, 180);
  const bufferMinutes = (international ? 180 : 120) + (checkedBags ? 30 : 0) + terminalMinutes;
  return {
    arrivalDeadline: iso(time - bufferMinutes * 60000),
    bufferMinutes,
    source: "User-configured planning allowance, not a live TSA forecast",
  };
}
