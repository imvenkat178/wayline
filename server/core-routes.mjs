import { DomainError, preferences } from "./domain/journeys.mjs";
import { createAction, confirmAction } from "./domain/tripActions.mjs";
import { prepareRecovery } from "./recovery.mjs";
import { itineraryPdf } from "./itineraryPdf.mjs";
import { nextCommuteDeparture } from "./domain/commutes.mjs";
export async function handleCoreRoutes({
  req,
  res,
  url,
  b,
  store,
  session,
  send,
  travel,
  rateLimit,
}) {
  const userId = session.userId;
  const commute = url.pathname.match(/^\/api\/commutes\/([^/]+)\/next$/);
  if (commute && req.method === "GET") {
    const c = store.get(userId, commute[1], "commute"), departure = nextCommuteDeparture(c);
    if (!departure) throw new DomainError("This commute is paused or has no scheduled departure.", 409);
    send(res, 200, { from: c.from, to: c.to, fromPlace: c.fromPlace, toPlace: c.toPlace,
      mode: c.mode ?? "sample", departure, travelers: 1, bags: 0, preferences: preferences(store.user(userId).preferences) });
    return true;
  }
  if (url.pathname === "/api/alerts/read" && req.method === "POST") {
    if (!Array.isArray(b.ids) || b.ids.length > 1000 || b.ids.some(id => typeof id !== "string"))
      throw new DomainError("Choose up to 1,000 updates.");
    store.transaction(() => {
      // Resolve every owner-scoped ID before applying any change.
      const alerts = [...new Set(b.ids)].map(id => store.get(userId, id, "alert"));
      for (const a of alerts) if (!a.read) store.put(userId, "alert", { ...a, read: true }, { id: a.id, expectedVersion: a.version });
    });
    send(res, 200, store.list(userId, "alert"));
    return true;
  }
  if (url.pathname === "/api/places" && req.method === "GET") {
    rateLimit("places:" + userId, 60);
    send(res, 200, await travel.call("places", { q: url.searchParams.get("q") ?? "" }));
    return true;
  }
  const checkTravel = url.pathname === "/api/travel/check" && req.method === "POST";
  if ((url.pathname === "/api/travel/health" && req.method === "GET") || checkTravel) {
    if (checkTravel) {
      rateLimit("travel-check:" + userId, 6);
      // Do not hold the HTTP request open across multiple provider timeouts.
      // The coalesced probe continues on the server; health polling reports it.
      void travel.probe().catch(() => {});
    }
    const health = await travel.call("health").catch(() => ({ services: [] }));
    send(res, checkTravel ? 202 : 200, {
      services: [travel.status, ...health.services],
      checking: !!travel.probing,
      lastChecked: travel.lastChecked,
      observedAt: new Date().toISOString(),
      backup: store.backupStatus ?? { status: store.backupsEnabled ? "scheduled" : "disabled" },
    });
    return true;
  }
  if (url.pathname === "/api/agent/actions" && req.method === "POST") {
    rateLimit("actions:" + userId, 30);
    send(res, 201, createAction(store, userId, b));
    return true;
  }
  const confirmation = url.pathname.match(/^\/api\/agent\/actions\/([^/]+)\/confirm$/);
  if (confirmation && req.method === "POST") {
    rateLimit("confirm:" + userId, 30);
    send(res, 200, await confirmAction(store, userId, confirmation[1], travel));
    return true;
  }
  const match = url.pathname.match(
    /^\/api\/journeys\/([^/]+)\/(recoveries|prepare-recovery|change|itinerary.pdf|weather)$/,
  );
  if (!match) return false;
  const [, id, action] = match,
    j = store.get(userId, id, "journey");
  if (action === "weather" && req.method === "GET") {
    if (j.dataMode !== "provider" || !j.fromCoords) throw new DomainError("Live weather needs a resolved journey location.", 409);
    rateLimit("journey-weather:" + userId, 20);
    send(res, 200, await travel.call("weather", { lat: j.fromCoords[1], lon: j.fromCoords[0] }));
    return true;
  }
  if (action === "recoveries" && req.method === "GET") {
    send(
      res,
      200,
      store
        .list(userId, "recovery")
        .filter((r) => r.journeyId === id && ["prepared", "applied"].includes(r.state)),
    );
    return true;
  }
  if (action === "prepare-recovery" && req.method === "POST") {
    rateLimit("recover:" + userId, 12);
    send(res, 201, await prepareRecovery(store, userId, j, travel));
    return true;
  }
  if (action === "change" && req.method === "POST") {
    send(res, 201, createAction(store, userId, { ...b, kind: "change", journeyId: id }));
    return true;
  }
  if (action === "itinerary.pdf" && req.method === "GET") {
    rateLimit("pdf:" + userId, 20);
    const bytes = await itineraryPdf(
      j,
      store.list(userId, "ticket").filter((t) => t.journeyId === id),
    );
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-disposition":
        'attachment; filename="wayline-itinerary-' + id.replace(/[^a-zA-Z0-9-]/g, "") + '.pdf"',
      "cache-control": "no-store",
      "content-length": bytes.length,
    });
    res.end(bytes);
    return true;
  }
  throw new DomainError("Method not allowed.", 405);
}
