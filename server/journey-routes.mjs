import {
  DomainError,
  text,
  integer,
  digitalTwin,
  transition,
  preferences,
  matchLiveTracking,
} from "./domain/journeys.mjs";
import { mbtaVehicles } from "./adapters/providers.mjs";
import { receipt } from "./records.mjs";
export async function journeyRoutes({ req, res, url, b, store, session, send }) {
  const userId = session.userId;
  const m = url.pathname.match(
    /^\/api\/journeys\/([^/]+)(?:\/(state|twin|receipt|claim|recovery|tracking|share|calendar))?$/,
  );
  if (!m) throw new DomainError("Endpoint not found.", 404);
  const [, id, action] = m,
    j = store.get(userId, id, "journey");
  if (!action && req.method === "GET") return send(res, 200, j);
  if (!action && req.method === "DELETE") {
    store.transaction(() => {
      for (const kind of ["ticket", "claim", "alert", "agent", "recovery"])
        for (const r of store.list(userId, kind))
          if (r.journeyId === id) store.remove(userId, r.id);
      store.remove(userId, id);
    });
    return send(res, 200, { ok: true });
  }
  if (action === "state" && req.method === "POST") {
    const next = transition(j, b.state);
    if (b.version !== j.version)
      throw new DomainError("Journey changed. Refresh and try again.", 409);
    return send(
      res,
      200,
      store.put(userId, "journey", next, {
        id,
        expectedVersion: b.version,
        expiresAt: j.privateTrip && next.state === "ARRIVED" ? Date.now() + 3600000 : undefined,
      }),
    );
  }
  if (action === "twin" && req.method === "POST") {
    const delayMinutes = integer(b.delayMinutes ?? 0, "Delay", 0, 480);
    return send(res, 200, {
      ...digitalTwin(j, {
        delayMinutes,
        weather: ["clear", "rain", "snow", "heat"].includes(b.weather) ? b.weather : "clear",
        accessibilityOutage: Boolean(b.accessibilityOutage),
        preferences: preferences(store.user(userId).preferences),
      }),
      scenario: Boolean(
        delayMinutes || b.accessibilityOutage || (b.weather && b.weather !== "clear"),
      ),
    });
  }
  if (action === "receipt" && req.method === "GET")
    return send(res, 200, receipt(j), {
      "content-disposition": `attachment; filename="wayline-journey-${id}.json"`,
    });
  if (action === "calendar" && req.method === "GET") {
    const stamp = (v) =>
      new Date(v)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
    const safe = (s) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, "\\$&");
    res.writeHead(200, {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'attachment; filename="wayline-trip.ics"',
      "cache-control": "no-store",
    });
    return res.end(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Wayline//Journey//EN",
        "BEGIN:VEVENT",
        `UID:${id}@wayline.local`,
        `DTSTAMP:${stamp(Date.now())}`,
        `DTSTART:${stamp(j.departure)}`,
        `DTEND:${stamp(j.arrival)}`,
        `SUMMARY:${safe(`${j.dataMode === "illustrative" ? "SAMPLE: " : ""}${j.from} to ${j.to}`)}`,
        "DESCRIPTION:Itinerary reminder. Verify departure with the operator.",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
  }
  if (action === "share" && req.method === "POST")
    return send(res, 201, store.share(userId, id, b));
  if (action === "claim" && req.method === "POST") {
    const reason = text(b.reason, "Claim reason", 2000),
      expensesCents = integer(b.expensesCents ?? 0, "Expenses", 0, 1000000);
    const claim = store.put(userId, "claim", {
      journeyId: id,
      reason,
      expensesCents,
      status: "draft",
      eligibility: "operator review required",
      submitted: false,
      evidence: receipt(j),
      draft: `Subject: Request for review — ${j.from} to ${j.to}\n\nPlease review the disruption on my journey departing ${j.departure}.\n\n${reason}\n\nAdditional expenses reported: $${(expensesCents / 100).toFixed(2)}.\n\nPlease advise whether the carrier policy permits a refund or reimbursement. Supporting receipts will be supplied by the traveler.\n\n${j.dataMode === "illustrative" ? "SAMPLE JOURNEY — do not submit as a real claim." : ""}`,
    });
    return send(res, 201, claim);
  }
  if (action === "recovery" && req.method === "POST") {
    const search = store.get(userId, b.searchId, "search");
    const alt = search.result.journeys.find((x) => x.id === b.journeyId);
    if (!alt || alt.toId !== j.toId)
      throw new DomainError("Choose an alternative to the same destination from your search.");
    if (Date.parse(alt.arrival) < Date.now())
      throw new DomainError("This alternative is in the past. Run a fresh search.");
    const delta =
      alt.price.totalCents === null || j.price.totalCents === null
        ? null
        : alt.price.totalCents - j.price.totalCents;
    return send(
      res,
      201,
      store.put(userId, "recovery", {
        journeyId: id,
        alternative: alt,
        fareDifferenceCents: delta,
        state: "prepared",
        inventoryHeld: false,
        booked: false,
        authorizedSpend: false,
        message: "Alternative saved for review. No seat held, charge made, or ticket exchanged.",
      }),
    );
  }
  if (action === "tracking" && req.method === "POST") {
    if (j.dataMode !== "provider")
      throw new DomainError("Sample journeys do not receive live positions.", 409);
    const feed = await mbtaVehicles();
    const { legs, matches } = matchLiveTracking(j.legs, feed.vehicles, "mbta");
    if (!matches)
      return send(res, 200, {
        matched: 0,
        journey: j,
        message: "No position matches the exact provider and trip ID.",
      });
    return send(res, 200, {
      matched: matches,
      journey: store.put(userId, "journey", { ...j, legs }, { id, expectedVersion: j.version }),
    });
  }
  throw new DomainError("Method not allowed.", 405);
}
