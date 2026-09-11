import { createHash } from "node:crypto";
import {
  DomainError,
  preferences,
  assertRecoverable,
  recoveryCost,
  recoveryPosition,
  connectionGraph,
  matchLiveTracking,
} from "./domain/journeys.mjs";
import { searchTrips } from "./domain/tripActions.mjs";
import { enqueueJob } from "./jobs.mjs";
import { fanOutPush } from "./push.mjs";
import { isNotificationAllowed } from "./domain/notificationPolicy.mjs";
const digest = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
export { alertAffectsJourney } from "./domain/disruptions.mjs";
import { alertAffectsJourney, blockingDisruptions, requireFreshDisruptions, usesCancelledTrip } from "./domain/disruptions.mjs";
function notifyRecovery(store, userId, j, items) {
  const key = digest([j.id, "recovery", items.map((x) => x.alternative.id)]);
  store.transaction(() => {
    const alert = store.put(
      userId,
      "alert",
      {
        journeyId: j.id,
        kind: "recovery",
        severity: "warning",
        title: "Alternatives are ready",
        body:
          items.length +
          " feasible alternatives are ready to review. Your saved plan has not changed.",
        at: new Date().toISOString(),
        read: false,
        dedupeKey: key,
        delivery: "in-app",
        dataMode: j.dataMode,
      },
      { dedupeHash: key, expiresAt: Date.now() + 7 * 86400000 },
    );
    if (isNotificationAllowed(alert, store.user(userId).preferences))
      fanOutPush(store, userId, alert.id);
  });
}
export async function prepareRecovery(
  store,
  userId,
  j,
  travel,
  { automatic = false, canCommit = () => true, disruptions = null } = {},
) {
  if (["CANCELLED", "ARRIVED"].includes(j.state))
    throw new DomainError("This journey is finished.", 409);
  const position = recoveryPosition(j);
  const from = position.place ?? j.fromPlace ?? j.fromId;
  const departure = new Date(
    Math.max(
      Date.now(),
      position.earliestDeparture,
      ["PLANNED", "BOOKED"].includes(j.state) ? Date.parse(j.departure) : 0,
    ) +
      6 * 60000,
  ).toISOString();
  const [search, disruptionData] = await Promise.all([searchTrips(
    store,
    userId,
    {
      from,
      to: j.toPlace ?? j.toId,
      departure,
      travelers: j.travelers,
      bags: j.bags,
      mode: j.dataMode === "provider" ? "provider" : "sample",
      preferences: store.user(userId).preferences,
    },
    travel,
  ), j.dataMode === "provider" ? (disruptions ?? travel.call("disruptions")) : null]);
  if (disruptionData) requireFreshDisruptions(disruptionData);
  if (search.cache === "stale")
    throw new DomainError("Fresh routes are unavailable. Try again later.", 503);
  if (!canCommit()) throw new DomainError("The refresh window ended. Retrying safely.", 503);
  const current = store.get(userId, j.id, "journey");
  if (current.version !== j.version)
    throw new DomainError("Journey changed while preparing alternatives.", 409);
  const paid =
    store.list(userId, "ticket").find((t) => t.journeyId === j.id && t.paidCents != null)
      ?.paidCents ?? null;
  const eligible = search.journeys
    .filter((a) => {
      try {
        assertRecoverable(current, a);
        if (blockingDisruptions(disruptionData?.alerts ?? [], a).length || usesCancelledTrip(a, current.legs)) return false;
        if (connectionGraph(a, { preferences: store.user(userId).preferences }).overallRisk === "high") return false;
        return (
          digest(a.legs.map((l) => [l.tripId, l.departure, l.arrival])) !==
          digest(j.legs.map((l) => [l.tripId, l.departure, l.arrival]))
        );
      } catch {
        return false;
      }
    })
    .slice(0, 3);
  const prepared = store.transaction(() => {
    for (const old of store
      .list(userId, "recovery")
      .filter((r) => r.journeyId === j.id && r.state === "prepared"))
      store.put(
        userId,
        "recovery",
        { ...old, state: "superseded" },
        { id: old.id, expectedVersion: old.version },
      );
    return eligible.map((alternative) => {
      const cost = recoveryCost(j, alternative, paid);
      return store.put(
        userId,
        "recovery",
        {
          journeyId: j.id,
          journeyVersion: j.version,
          searchId: search.searchId,
          alternative,
          incrementalCostCents: cost.incrementalCents,
          arrivalDifferenceMinutes: Math.round(
            (Date.parse(alternative.arrival) - Date.parse(j.arrival)) / 60000,
          ),
          costBasis: cost.basis,
          state: "prepared",
          inventoryHeld: false,
          booked: false,
          authorizedSpend: false,
          automatic,
          observedAt: search.fetchedAt ?? new Date().toISOString(),
          expiresAt: Math.min(Date.parse(alternative.departure), Date.now() + 15 * 60000),
        },
        { expiresAt: Date.now() + 86400000 },
      );
    });
  });
  if (automatic && prepared.length) notifyRecovery(store, userId, j, prepared);
  return prepared;
}
export async function refreshActiveJourneys(
  store,
  travel,
  { now = Date.now(), journeyId = null, canCommit = () => true } = {},
) {
  const rows = store.db
    .prepare("SELECT * FROM records WHERE kind='journey' AND (expires_at IS NULL OR expires_at>?)")
    .all(now);
  const active = rows
    .map((row) => ({ userId: row.user_id, j: store.decode(row) }))
    .filter(
      ({ j }) =>
        (!journeyId || j.id === journeyId) &&
        j.dataMode === "provider" &&
        !["CANCELLED", "ARRIVED"].includes(j.state) &&
        Date.parse(j.departure) < now + 6 * 3600000 &&
        Date.parse(j.arrival) > now - 3600000,
    );
  if (!active.length) return;
  const [vehicles, alerts] = await Promise.allSettled([
    travel.call("vehicles"),
    travel.call("disruptions"),
  ]);
  for (const { userId, j } of active) {
    try {
      let legs = j.legs;
      if (vehicles.status === "fulfilled")
        legs = matchLiveTracking(legs, vehicles.value.vehicles, "mbta").legs;
      legs = await Promise.all(
        legs.map(async (leg) => {
          if (leg.agency !== "mbta" || !leg.tripId) return leg;
          try {
            const data = await travel.call("predictions", { tripId: leg.tripId });
            if (data.cache === "stale") return { ...leg, predictionStatus: "stale" };
            const start = data.predictions.find((p) => p.stopId === leg.fromStopId),
              end = data.predictions.find((p) => p.stopId === leg.toStopId);
            return {
              ...leg,
              delayMinutes: end?.arrival
                ? Math.round(
                    (Date.parse(end.arrival) - Date.parse(leg.scheduledArrival ?? leg.arrival)) /
                      60000,
                  )
                : leg.delayMinutes,
              departureDelayMinutes: start?.departure
                ? Math.round(
                    (Date.parse(start.departure) -
                      Date.parse(leg.scheduledDeparture ?? leg.departure)) /
                      60000,
                  )
                : leg.departureDelayMinutes,
              predictedDeparture: start?.departure ?? null,
              predictedArrival: end?.arrival ?? null,
              cancelled: !!(start?.cancelled || end?.cancelled),
              predictionObservedAt: start || end ? data.fetchedAt : null,
              predictionStatus: start || end ? "available" : "unavailable",
            };
          } catch {
            return { ...leg, predictionStatus: "unavailable" };
          }
        }),
      );
      const attached =
        alerts.status === "fulfilled" && alerts.value.cache === "fresh"
          ? alerts.value.alerts
              .filter((a) => alertAffectsJourney(a, j))
              .map((a) => ({
                id: a.id,
                title: a.header,
                body: a.description,
                effect: a.effect,
                updatedAt: a.updatedAt,
              }))
          : (j.disruptions ?? []);
      if (!canCommit()) return;
      const current = store.get(userId, j.id, "journey");
      if (current.version !== j.version) continue;
      const updated = store.recordObservation(
        userId,
        j,
        {
          ...j,
          legs,
          disruptions: attached,
          liveUpdatedAt: new Date(now).toISOString(),
          liveSources: {
            vehicles: vehicles.status === "fulfilled" ? vehicles.value.cache : "unavailable",
            disruptions: alerts.status === "fulfilled" ? alerts.value.cache : "unavailable",
          },
        },
        now,
      );
      const p = preferences(store.user(userId).preferences);
      const affected =
        legs.some((l) => l.cancelled && Date.parse(l.predictionObservedAt) > now - 120000) ||
        (alerts.status === "fulfilled" &&
          alerts.value.cache === "fresh" &&
          attached.some((a) =>
            [
              "NO_SERVICE",
              "DETOUR",
              "SIGNIFICANT_DELAYS",
              "STOP_CLOSURE",
              "STATION_CLOSURE",
              "SUSPENSION",
            ].includes(a.effect),
          )) ||
        connectionGraph(updated, { preferences: p }).overallRisk === "high";
      // A newly confirmed closure can invalidate options prepared on a previous tick.
      if (alerts.status === "fulfilled" && alerts.value.cache === "fresh") {
        for (const recovery of store.list(userId, "recovery")) {
          if (recovery.journeyId !== j.id || recovery.state !== "prepared") continue;
          if (blockingDisruptions(alerts.value.alerts, recovery.alternative).length ||
              usesCancelledTrip(recovery.alternative, legs, now))
            store.put(userId, "recovery", { ...recovery, state: "unavailable", reason: "A new disruption affects this alternative." },
              { id: recovery.id, expectedVersion: recovery.version });
        }
      }
      const recent = store
        .list(userId, "recovery")
        .some((r) => r.journeyId === j.id && r.state === "prepared" && r.expiresAt > now);
      if (p.autoRecovery && affected && !recent)
        await prepareRecovery(store, userId, updated, travel, {
          automatic: true, canCommit,
          disruptions: alerts.status === "fulfilled" ? alerts.value : null,
        });
    } catch {
      store.audit(userId, "LIVE_REFRESH_FAILED", j.id);
    }
  }
}

export function scheduleLiveRefresh(store, now = Date.now()) {
  const rows = store.db
    .prepare("SELECT * FROM records WHERE kind='journey' AND (expires_at IS NULL OR expires_at>?)")
    .all(now);
  store.transaction(() => {
    for (const row of rows) {
      const j = store.decode(row);
      if (
        j.dataMode !== "provider" ||
        ["ARRIVED", "CANCELLED"].includes(j.state) ||
        Date.parse(j.departure) > now + 6 * 3600000 ||
        Date.parse(j.arrival) < now - 3600000
      )
        continue;
      const existing = store.db
        .prepare(
          "SELECT id FROM jobs WHERE kind='journey-refresh' AND status IN ('pending','leased') AND json_extract(payload,'$.journeyId')=?",
        )
        .get(j.id);
      if (!existing)
        enqueueJob(store, "journey-refresh", { journeyId: j.id }, { userId: row.user_id });
    }
  });
}
