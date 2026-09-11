import { assertServiceAvailable } from "./disruptions.mjs";
import { createHash, randomUUID } from "node:crypto";
import {
  DomainError,
  preferences,
  sampleSearch,
  transition,
  assertRecoverable,
} from "./journeys.mjs";
const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export async function searchTrips(store, userId, input, travel) {
  if (!["provider", "sample"].includes(input.mode))
    throw new DomainError("Choose sample or provider schedules.", 400);
  const request = {
    ...input,
    from: input.fromPlace ?? input.from,
    to: input.toPlace ?? input.to,
    preferences: preferences({ ...store.user(userId).preferences, ...input.preferences }),
  };
  const result =
    request.mode === "provider" ? await travel.call("search", request) : sampleSearch(request);
  const search = store.put(
    userId,
    "search",
    { input: request, result },
    { expiresAt: Date.now() + 3600000 },
  );
  return { ...result, searchId: search.id, agencies: [] };
}
export function searchCandidate(store, userId, searchId, candidateId) {
  const search = store.get(userId, searchId, "search");
  const candidate = search.result.journeys.find((j) => j.id === candidateId);
  if (!candidate) throw new DomainError("Choose a route from a current search.", 404);
  return { search, candidate };
}
export function saveTrip(store, userId, { searchId, journeyId, private: privateChoice }, key) {
  if (typeof key !== "string" || !key || key.length > 100)
    throw new DomainError("An idempotency key is required.", 400);
  const requestHash = digest({ searchId, journeyId, private: privateChoice });
  return store.transaction(() => {
    const prior = store.list(userId, "idempotency").find((x) => x.key === key);
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new DomainError("Idempotency key already used.", 409);
      return store.get(userId, prior.journeyId, "journey");
    }
    const { candidate } = searchCandidate(store, userId, searchId, journeyId);
    if (Date.parse(candidate.arrival) <= Date.now())
      throw new DomainError("This itinerary has expired. Search again.", 409);
    const p = preferences(store.user(userId).preferences),
      privateTrip = !!privateChoice || !p.saveHistory || p.historyDays === 0;
    const j = store.put(
      userId,
      "journey",
      {
        ...candidate,
        state: "PLANNED",
        bookingConfirmed: false,
        privateTrip,
        events: [
          {
            id: randomUUID(),
            at: new Date().toISOString(),
            type: "JOURNEY_SAVED",
            source: "traveler",
          },
        ],
      },
      {
        expiresAt: Math.max(
          Date.now() + 3600000,
          privateTrip
            ? Date.parse(candidate.arrival) + 86400000
            : Date.now() + p.historyDays * 86400000,
        ),
      },
    );
    store.put(
      userId,
      "idempotency",
      { key, requestHash, journeyId: j.id },
      { expiresAt: Date.now() + 86400000 },
    );
    return j;
  });
}
export function changeState(store, userId, id, state, version) {
  return store.transaction(() => {
    const j = store.get(userId, id, "journey");
    if (j.version !== version)
      throw new DomainError("Journey changed. Refresh and review again.", 409, "VERSION_CONFLICT");
    return store.put(userId, "journey", transition(j, state), {
      id,
      expectedVersion: version,
      ...(j.privateTrip && state === "ARRIVED" ? { expiresAt: Date.now() + 3600000 } : {}),
    });
  });
}
export function createAction(store, userId, request) {
  const { kind } = request;
  if (!["add", "change", "cancel", "recovery"].includes(kind))
    throw new DomainError("Unknown trip action.", 400);
  const journey = kind === "add" ? null : store.get(userId, request.journeyId, "journey");
  if (journey && ["CANCELLED", "ARRIVED"].includes(journey.state))
    throw new DomainError("This journey is finished.", 409);
  let candidate = null,
    search = null;
  if (kind !== "cancel")
    ({ candidate, search } = searchCandidate(store, userId, request.searchId, request.candidateId));
  if (kind === "recovery") assertRecoverable(journey, candidate);
  if (kind === "change" && !["PLANNED", "BOOKED"].includes(journey.state))
    throw new DomainError("Use recovery alternatives once the journey is underway.", 409);
  const expiresAt = Math.min(
    Date.now() + 15 * 60000,
    candidate ? Date.parse(candidate.departure) : Infinity,
  );
  if (expiresAt <= Date.now()) throw new DomainError("The route has departed. Search again.", 409);
  return store.put(
    userId,
    "pending-action",
    {
      kind,
      journeyId: journey?.id ?? null,
      journeyVersion: journey?.version ?? null,
      searchId: search?.id ?? null,
      candidateId: candidate?.id ?? null,
      private: !!request.private,
      candidate,
      before: journey
        ? {
            from: journey.from,
            to: journey.to,
            departure: journey.departure,
            arrival: journey.arrival,
            totalCents: journey.price.totalCents,
          }
        : null,
      status: "pending",
      expiresAt,
      notice:
        kind === "cancel"
          ? "Stops monitoring this saved plan. Cancel purchased tickets with the operator."
          : "Updates your saved itinerary. No carrier ticket is purchased or exchanged.",
    },
    { expiresAt: expiresAt + 86400000 },
  );
}
function sameTrip(a, b) {
  return (
    digest(
      a.legs.map((l) => [
        l.mode,
        l.tripId,
        l.departure,
        l.arrival,
        l.fromStopId ?? l.fromCoords,
        l.toStopId ?? l.toCoords,
      ]),
    ) ===
    digest(
      b.legs.map((l) => [
        l.mode,
        l.tripId,
        l.departure,
        l.arrival,
        l.fromStopId ?? l.fromCoords,
        l.toStopId ?? l.toCoords,
      ]),
    )
  );
}
export async function confirmAction(store, userId, id, travel) {
  const initial = store.get(userId, id, "pending-action");
  if (initial.status === "applied")
    return { action: initial, journey: store.get(userId, initial.resultJourneyId, "journey") };
  if (initial.status !== "pending" || initial.expiresAt <= Date.now())
    throw new DomainError("This review has expired. Prepare a new action.", 409, "ACTION_EXPIRED");
  if (initial.candidate?.dataMode === "provider") {
    const { search } = searchCandidate(store, userId, initial.searchId, initial.candidateId);
    const [fresh] = await Promise.all([
      travel.call("search", search.input),
      assertServiceAvailable(travel, initial.candidate),
    ]);
    if (fresh.cache === "stale" || !fresh.journeys.some((j) => sameTrip(j, initial.candidate)))
      throw new DomainError(
        "The route has changed. Search again and review the new times.",
        409,
        "ROUTE_CHANGED",
      );
  }
  return store.transaction(() => {
    const action = store.get(userId, id, "pending-action");
    if (action.status === "applied")
      return { action, journey: store.get(userId, action.resultJourneyId, "journey") };
    if (action.expiresAt <= Date.now())
      throw new DomainError("This review has expired.", 409, "ACTION_EXPIRED");
    let journey;
    if (action.kind === "add")
      journey = saveTrip(
        store,
        userId,
        { searchId: action.searchId, journeyId: action.candidateId, private: action.private },
        "action:" + id,
      );
    else {
      const j = store.get(userId, action.journeyId, "journey");
      if (j.version !== action.journeyVersion)
        throw new DomainError(
          "Journey changed. Refresh and review again.",
          409,
          "VERSION_CONFLICT",
        );
      if (action.kind === "cancel")
        journey = changeState(store, userId, j.id, "CANCELLED", j.version);
      else {
        if (["CANCELLED", "ARRIVED"].includes(j.state))
          throw new DomainError("Journey is finished.", 409);
        if (action.kind === "recovery") assertRecoverable(j, action.candidate);
        const candidate = action.candidate;
        if (Date.parse(candidate.departure) <= Date.now())
          throw new DomainError("The selected route has departed. Search again.", 409);
        const snapshot = { ...j };
        delete snapshot.events;
        delete snapshot.revisions;
        journey = store.put(
          userId,
          "journey",
          {
            ...candidate,
            id: j.id,
            state: "PLANNED",
            privateTrip: j.privateTrip,
            bookingConfirmed: false,
            revisions: [...(j.revisions ?? []).slice(-19), snapshot],
            events: [
              ...(j.events ?? []),
              {
                id: randomUUID(),
                at: new Date().toISOString(),
                type: action.kind === "recovery" ? "RECOVERY_APPLIED" : "ITINERARY_CHANGED",
                source: "traveler",
              },
            ],
          },
          {
            id: j.id,
            expectedVersion: j.version,
            ...(j.privateTrip ? { expiresAt: Date.parse(candidate.arrival) + 86400000 } : {}),
          },
        );
        for (const r of store
          .list(userId, "recovery")
          .filter((r) => r.journeyId === j.id && r.state === "prepared"))
          store.put(
            userId,
            "recovery",
            { ...r, state: r.alternative?.id === candidate.id ? "applied" : "superseded" },
            { id: r.id, expectedVersion: r.version },
          );
      }
    }
    const applied = store.put(
      userId,
      "pending-action",
      {
        ...action,
        status: "applied",
        resultJourneyId: journey.id,
        appliedAt: new Date().toISOString(),
      },
      { id, expectedVersion: action.version },
    );
    return { action: applied, journey };
  });
}
