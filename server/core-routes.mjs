import { DomainError } from "./domain/journeys.mjs";
import { createAction, confirmAction } from "./domain/tripActions.mjs";
import { prepareRecovery } from "./recovery.mjs";
import { itineraryPdf } from "./itineraryPdf.mjs";
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
  if (url.pathname === "/api/places" && req.method === "GET") {
    rateLimit("places:" + userId, 60);
    send(res, 200, await travel.call("places", { q: url.searchParams.get("q") ?? "" }));
    return true;
  }
  if (url.pathname === "/api/travel/health" && req.method === "GET") {
    const health = await travel.call("health");
    send(res, 200, {
      services: [travel.status, ...health.services],
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
    /^\/api\/journeys\/([^/]+)\/(recoveries|prepare-recovery|change|itinerary.pdf)$/,
  );
  if (!match) return false;
  const [, id, action] = match,
    j = store.get(userId, id, "journey");
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
