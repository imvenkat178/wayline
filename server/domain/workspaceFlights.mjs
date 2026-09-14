import { randomUUID } from "node:crypto";
import { DomainError } from "./journeys.mjs";
import { searchRequest, rankCandidates } from "../shopping/contracts.mjs";
import { localDate } from "../shopping/duffel.mjs";
import { serviceIdentity } from "../shopping/connections.mjs";

// Deliberately explicit airport choices; city names must not silently choose a hub.
export const workspaceAirports = [
  ["BOS", "Boston Logan"], ["JFK", "New York JFK"], ["LGA", "New York LaGuardia"],
  ["EWR", "Newark Liberty"], ["PHL", "Philadelphia"], ["DCA", "Washington Reagan"],
].map(([iata, name]) => ({ id: "airport:" + iata, iata, name, kind: "airport", country: "US", timezone: "America/New_York" }));
export function workspaceAirport(value, references = []) {
  const text = typeof value === "string" ? value : value?.name;
  return [...references,...workspaceAirports].find(p => [p.iata, p.id, p.name].some(n => n.toLowerCase() === text?.toLowerCase()));
}
export function normalizeFlightConstraints(constraints, patch = {}) {
  if (constraints.mode !== "flights") return constraints;
  if (patch.bags !== undefined && !patch.passengers && patch.bags !== constraints.passengers?.reduce((n, p) => n + p.cabin + p.checked, 0))
    throw new DomainError("For flights, specify cabin and checked bags for each traveler in Trip requirements.");
  for(const code of [...(constraints.originAirports??[]),...(constraints.destinationAirports??[])])if(!workspaceAirport(code,constraints.resolvedAirports))throw new DomainError("Resolve each alternate airport in the US airport directory.");
  let passengers = constraints.passengers;
  if (!passengers || (patch.travelers !== undefined && !patch.passengers)) {
    if (passengers?.some(p => p.type === "child")) throw new DomainError("Edit the traveler list to keep each child's age and baggage requirements.");
    if (constraints.travelers > 9) throw new DomainError("Flight shopping supports up to nine travelers.");
    if (!passengers && constraints.bags > 0) throw new DomainError("Specify cabin and checked bags per traveler before searching flights.");
    passengers = Array.from({ length: constraints.travelers }, (_, i) => passengers?.[i] ?? { id: "adult-" + (i + 1), type: "adult", personal: 0, cabin: 0, checked: 0 });
  }
  return { ...constraints, passengers, travelers: passengers.length, bags: passengers.reduce((n, p) => n + p.cabin + p.checked, 0),
    from: workspaceAirport(constraints.from, constraints.resolvedAirports)?.iata ?? constraints.from, to: workspaceAirport(constraints.to, constraints.resolvedAirports)?.iata ?? constraints.to,
    timezone: workspaceAirport(constraints.from,constraints.resolvedAirports)?.timezone ?? constraints.timezone };
}
export function flightRequest(c) {
  const origin = workspaceAirport(c.from,c.resolvedAirports), destination = workspaceAirport(c.to,c.resolvedAirports);
  if (!origin || !destination) throw new DomainError("Choose exact departure and arrival airports in Trip requirements (for example BOS and JFK).", 400, "AIRPORT_REQUIRED");
  const latestDeparture = new Date(Date.parse(c.departure) + (c.flightWindowHours ?? 23) * 3600000).toISOString();
  const firstDate = localDate(c.departure, origin.timezone), lastDate = localDate(latestDeparture, origin.timezone);
  const additionalSlices=(c.additionalFlights??[]).map(s=>{const origin=workspaceAirport(s.from,c.resolvedAirports),destination=workspaceAirport(s.to,c.resolvedAirports);if(!origin||!destination)throw new DomainError('Resolve each multi-city airport before searching.');return {origin,destination,departure:s.departure,latestDeparture:new Date(Date.parse(s.departure)+23*3600000).toISOString()};});
  return searchRequest.parse({ origin, destination, additionalSlices, ...(c.returnDate?{returnDate:c.returnDate}:{}), departure: c.departure, latestDeparture,
    originAirports:c.originAirports??[], destinationAirports:c.destinationAirports??[], flexibleDates: [...new Set([...(firstDate === lastDate ? [] : [lastDate]),...(c.flexibleDates??[])])].slice(0,3),
    ...(c.deadline ? { deadline: c.deadline } : {}), passengers: c.passengers, currency: "USD",
    budget: c.preferences.budgetCents ? { amount: c.preferences.budgetCents, currency: "USD", scale: 2 } : null,
    maxTransfers: Math.min(4, c.preferences.maxTransfers), maxWalkMinutes: c.preferences.maxWalkMinutes,
    wheelchair: c.preferences.wheelchair || c.preferences.stepFree, allowOvernight: !c.avoidOvernight, modes: ["air"],
  });
}
export const flightServiceKey = s => JSON.stringify([serviceIdentity(s), s.departure, s.arrival]);
export function checkFlightCandidate(candidate, constraints, locks = []) {
  const ranked = rankCandidates([candidate], flightRequest(constraints));
  const reasons = ranked.excluded.map(e => e.reason);
  if (Date.parse(candidate.expiresAt) <= Date.now()) reasons.push("Supplier offer expired");
  if (locks.some(l => !candidate.services.some(s => flightServiceKey(s) === l.serviceKey))) reasons.push("Does not preserve every service in the locked ticket group");
  if (candidate.connections.some(c => c.slackMinutes != null && c.slackMinutes < constraints.preferences.minConnectionMinutes)) reasons.push("Below your connection buffer");
  return { reasons, candidate: ranked.complete[0] ?? ranked.incomplete[0], complete: ranked.complete.length === 1 };
}
// Display projection only. Supplier services, ticket groups and prices remain authoritative.
export function flightItinerary(candidate, constraints) {
  const first = candidate.services[0], last = candidate.services.at(-1), total = candidate.pricing.total;
  return { id: candidate.id, name: candidate.services.map(s => s.operator + " " + s.serviceNumber).join(" → "),
    from: first.origin.name, to: last.destination.name, fromId: first.origin.id, toId: last.destination.id,
    fromCoords: [first.origin.lon, first.origin.lat], toCoords: [last.destination.lon, last.destination.lat],
    timezone: first.origin.timezone, destinationTimezone: last.destination.timezone,
    departure: candidate.departure, arrival: candidate.arrival, durationMinutes: candidate.durationMinutes,
    walkMinutes: candidate.walkMinutes, transfers: candidate.transfers, accessible: candidate.accessible,
    price: { totalCents: total?.currency === "USD" ? total.amount : null, currency: total?.currency ?? "USD", unknown: !candidate.pricing.complete },
    travelers: constraints.travelers, bags: constraints.bags, dataMode: candidate.live === false ? "illustrative" : "provider", bookable: false,
    source: (candidate.provider ?? "Supplier") + (candidate.live === false ? " test inventory" : " offer snapshot"),
    reliability: null, legs: candidate.services.map(s => ({ id: s.id, mode: s.mode === "air" ? "flight" : s.mode, operator: s.operator,
      service: s.operator + " " + s.serviceNumber, tripId: serviceIdentity(s), serviceKey: flightServiceKey(s),
      from: s.origin.name, to: s.destination.name, departure: s.departure, arrival: s.arrival,
      fromTimezone: s.origin.timezone, toTimezone: s.destination.timezone,
      durationMinutes: Math.round((Date.parse(s.arrival) - Date.parse(s.departure)) / 60000),
      fromCoords: [s.origin.lon, s.origin.lat], toCoords: [s.destination.lon, s.destination.lat] })) };
}
export function putFlightSet(store, userId, conversation, search, constraints, locks, baseVersion) {
  const excluded = search.results.excluded.map(e => ({ name: e.id, reason: e.reason }));
  const options = [...search.results.complete, ...search.results.incomplete].flatMap(c => {
    const checked = checkFlightCandidate(c, constraints, locks);
    if (checked.reasons.length) { excluded.push({ name: c.id, reason: checked.reasons.join("; ") }); return []; }
    const candidate = checked.candidate;
    return [{ id: randomUUID(), flight: candidate, journey: flightItinerary(candidate, constraints), complete: checked.complete,
      unknowns: [...candidate.pricing.unknownComponents, ...(candidate.limitation ? [candidate.limitation] : [])],
      connectionMarginMinutes: candidate.connections.length && candidate.connections.every(c => c.status === "verified") ? candidate.minimumSlack : null, labels: [] }];
  });
  const complete = options.filter(o => o.complete);
  const cheapest = [...complete].sort((a, b) => a.flight.pricing.total.amount - b.flight.pricing.total.amount)[0];
  const fastest = [...complete].sort((a, b) => a.journey.durationMinutes - b.journey.durationMinutes)[0];
  const balanced = [...complete].sort((a, b) => a.flight.ticketGroups.filter(g=>g.protection!=='supplier-confirmed').length-b.flight.ticketGroups.filter(g=>g.protection!=='supplier-confirmed').length || a.journey.transfers - b.journey.transfers || a.flight.pricing.total.amount-b.flight.pricing.total.amount || a.flight.durationMinutes-b.flight.durationMinutes)[0];
  const recommended = constraints.preferences.priority === "price" ? cheapest : constraints.preferences.priority === "fastest" ? fastest : balanced;
  for (const option of complete) option.labels = [...(option === cheapest ? ["Lowest complete price found"] : []), ...(option === fastest ? ["Fastest"] : []), ...(option === balanced ? ["More resilient connections"] : []), ...(option === recommended ? ["Recommended"] : [])];
  return store.put(userId, "candidate-set", { conversationId: conversation.id, kind: "flights", searchId: search.id,
    searchVersion: search.version, baseVersion, constraints: structuredClone(constraints), options, excluded,
    source: `Duffel · selected US airports · ${constraints.returnDate ? "return" : constraints.additionalFlights?.length ? "multi-city" : "one-way"} economy · up to 50 returned offers per selected date`,
    fetchedAt: search.completedAt ?? search.updatedAt, expiresAt: Math.min(Date.now() + 3600000, ...options.map(o => Date.parse(o.flight.expiresAt))),
    warning: search.reason ?? "Airport-to-airport comparison. Airport transport and hotels are outside this search.",
    recommendationPolicy: "workspace-flight-v1: hard constraints, verified complete whole-party totals, duration, transfers and connection margin",
    reliabilityNotice: "Supplier test offers, missing baggage prices and unverified connections cannot win a complete-price recommendation. Historical reliability is unavailable.",
  }, { expiresAt: conversation.expiresAt });
}
