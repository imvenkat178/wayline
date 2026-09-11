import { z } from "zod";
import { searchTrips, createAction } from "./tripActions.mjs";
import { parseRequest } from "./agent.mjs";
import { prepareRecovery, refreshActiveJourneys } from "../recovery.mjs";
const commandSchema = z.object({
  intent: z.enum([
    "search",
    "list",
    "add",
    "change",
    "cancel",
    "alternatives",
    "pdf",
    "weather",
    "status",
    "advice",
  ]),
  from: z.string().max(200).optional(),
  to: z.string().max(200).optional(),
  departure: z.string().optional(),
});
export function explicitCommand(input) {
  const q = input.toLowerCase();
  if (/\b(cancel|stop monitoring)\b/.test(q) && !/[?]|how (do|can)|can (i|you) explain/.test(q))
    return "cancel";
  if (/\b(download|pdf|itinerary document)\b/.test(q)) return "pdf";
  if (/\b(backup|alternatives?|recover)\b/.test(q)) return "alternatives";
  if (/\b(weather|forecast|rain)\b/.test(q)) return "weather";
  if (/\b(list|show|view) (my |saved )*(trips|journeys)\b/.test(q)) return "list";
  if (/\b(change|reschedule|move my|update my)\b/.test(q)) return "change";
  if (/\b(add|save) (this |the |a |my |selected )*(trip|journey|route|itinerary)\b/.test(q))
    return "add";
  if (/\b(from .+ to |find |search |plan a trip|travel from)\b/.test(q)) return "search";
  if (/\b(live status|where is my|track my|service alerts)\b/.test(q)) return "status";
  return null;
}
export function createToolRunner({ store, userId, travel, context }) {
  return async ({ input, provider }) => {
    let command = { intent: context.command ?? explicitCommand(input) };
    const parsed = parseRequest(input);
    const route = input.match(
      /from\s+(.+?)\s+to\s+(.+?)(?=\s+(?:tomorrow|today|at|on|under|before|by)\b|[.!?]|$)/i,
    );
    if (route) Object.assign(command, { from: route[1].trim(), to: route[2].trim() });
    if (!route && command.intent === "change") {
      const to = input.match(
        /(?:destination|trip)\s+to\s+(.+?)(?=\s+(?:tomorrow|today|at|on)\b|[.!?]|$)/i,
      );
      if (to) command.to = to[1].trim();
    }
    if (!command.intent && provider?.available) {
      try {
        const raw = await provider.chat({
          messages: [
            {
              role: "system",
              content:
                "Choose a travel tool intent and copy only explicitly named from/to places and ISO departure time from the user. intent is search, list, add, change, cancel, alternatives, pdf, weather, status, or advice. Use advice for explanatory questions. Never invent details. Return JSON.",
            },
            { role: "user", content: input },
          ],
          jsonSchema: {
            type: "object",
            properties: {
              intent: { type: "string" },
              from: { type: "string" },
              to: { type: "string" },
              departure: { type: "string" },
            },
            required: ["intent"],
          },
          maxTokens: 160,
        });
        command = commandSchema.parse(JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw));
      } catch {
        return null;
      }
    }
    for (const field of ["from", "to"]) {
      if (command[field]) {
        const words = command[field].trim().split(/\s+/);
        while (words.length && !input.toLowerCase().includes(words.join(" ").toLowerCase()))
          words.pop();
        command[field] = words.join(" ") || undefined;
      }
    }
    if (
      command.departure &&
      (!/^\d{4}-\d{2}-\d{2}T/.test(command.departure) || !input.includes(command.departure))
    )
      delete command.departure;
    if (!command.intent || command.intent === "advice") return null;
    const result = {
      intent: command.intent,
      mode: "Journey tools",
      actions: [],
      pendingActions: [],
      results: [],
      evidence: [],
    };
    const j = context.journeyId ? store.get(userId, context.journeyId, "journey") : null;
    const reply = (text) => ({ ...result, reply: text });
    if (command.intent === "list") {
      const trips = store.list(userId, "journey");
      result.results = [{ type: "journeys", journeys: trips }];
      return reply(
        trips.length
          ? "Here are your saved journeys. Select one to manage it."
          : "You have no saved journeys yet. Search for a route to add one.",
      );
    }
    if (command.intent === "pdf") {
      if (!j) return reply("Select a saved journey to download its complete itinerary.");
      result.results = [
        {
          type: "document",
          url: "/api/journeys/" + encodeURIComponent(j.id) + "/itinerary.pdf",
          label: "Download itinerary PDF",
        },
      ];
      return reply("Your complete Wayline itinerary is ready to download.");
    }
    if (command.intent === "cancel") {
      if (!j) return reply("Select the saved journey you want to cancel.");
      result.pendingActions = [createAction(store, userId, { kind: "cancel", journeyId: j.id })];
      return reply("Review cancellation below. Your purchased carrier tickets are unaffected.");
    }
    if (command.intent === "add" && context.searchId && context.candidateId) {
      result.pendingActions = [
        createAction(store, userId, {
          kind: "add",
          searchId: context.searchId,
          candidateId: context.candidateId,
        }),
      ];
      return reply("Review this itinerary before adding it to your journeys.");
    }
    if (command.intent === "alternatives") {
      if (!j) return reply("Select a saved journey to prepare alternatives.");
      const recovery = await prepareRecovery(store, userId, j, travel);
      result.results = [{ type: "recovery", recovery }];
      return reply(
        recovery.length
          ? "These alternatives are saved for your review."
          : "No feasible alternatives are available right now. Your existing journey is unchanged.",
      );
    }
    if (command.intent === "weather") {
      if (!j) return reply("Select a journey to check the weather along it.");
      const data = await travel.call("weather", { lat: j.fromCoords[1], lon: j.fromCoords[0] });
      result.results = [{ type: "weather", ...data }];
      result.evidence = [{ source: data.source, observedAt: data.fetchedAt }];
      return reply(
        "Here is the latest available forecast at your departure location. Weather alone does not confirm a transit disruption.",
      );
    }
    if (command.intent === "status") {
      if (!j) return reply("Select a saved journey to check its status.");
      await refreshActiveJourneys(store, travel, { journeyId: j.id });
      const data = await travel.call("disruptions", {});
      result.results = [
        {
          type: "status",
          journey: store.get(userId, j.id, "journey"),
          source: data.source,
          fetchedAt: data.fetchedAt,
        },
      ];
      return reply(
        "The journey panel shows the latest attached updates. Agency-wide notices are matched to your specific services before affecting your itinerary.",
      );
    }
    if (["search", "change", "add"].includes(command.intent)) {
      if (command.intent === "change" && !j)
        return reply("Select the journey you want to change first.");
      let from = command.from ?? j?.fromPlace ?? j?.fromId,
        to = command.to ?? j?.toPlace ?? j?.toId;
      if (!from || !to)
        return reply(
          "Tell me the origin and destination, for example: Find a trip from South Station to Harvard tomorrow.",
        );
      let departure =
        command.departure ?? j?.departure ?? new Date(Date.now() + 3600000).toISOString();
      const when = parseDeparture(input, {
        base: j?.departure,
        zone: j?.timezone ?? "America/New_York",
        relativeDay: parsed.relativeDay,
      });
      if (when.error) return reply(when.error);
      if (when.departure) departure = when.departure;
      if (
        command.intent === "change" &&
        !command.departure &&
        parsed.relativeDay === undefined &&
        !route &&
        !command.to &&
        !when.departure &&
        !Object.keys(parsed.overrides).length
      )
        return reply(
          "What should change: the departure date/time, destination, or travel preferences?",
        );
      const search = await searchTrips(
        store,
        userId,
        {
          from,
          to,
          departure,
          travelers: j?.travelers ?? 1,
          bags: j?.bags ?? 0,
          mode: j?.dataMode === "illustrative" ? "sample" : "provider",
          preferences: parsed.overrides,
        },
        travel,
      );
      result.results = [
        { type: "routes", search, changeJourneyId: command.intent === "change" ? j.id : null },
      ];
      result.evidence = [{ source: search.source, observedAt: search.fetchedAt }];
      return reply(
        search.journeys.length
          ? "Compare these routes, then choose one to review."
          : "No eligible routes were returned. Try another departure or adjust your preferences.",
      );
    }
    return null;
  };
}

export function parseDeparture(
  input,
  { base, zone = "America/New_York", relativeDay, now = Date.now() } = {},
) {
  const iso = input.match(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2}))\b/);
  if (iso)
    return Number.isFinite(Date.parse(iso[1]))
      ? { departure: new Date(iso[1]).toISOString() }
      : { error: "Use a valid departure date and time." };
  const clock = input.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i),
    date = input.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (
    !date &&
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|next month)\b/i.test(
      input,
    )
  )
    return {
      error:
        "Please give the departure date as YYYY-MM-DD and a time with am/pm so I can search the correct day.",
    };
  if (!clock && !date && relativeDay === undefined) return {};
  if (clock && !clock[3] && !clock[2] && Number(clock[1]) <= 12)
    return { error: "Please include am or pm, for example at 9 am or at 17:30." };
  let hour = clock ? Number(clock[1]) : 9,
    minute = clock ? Number(clock[2] ?? 0) : 0;
  if (clock?.[3]) {
    if (hour < 1 || hour > 12) return { error: "Use an hour from 1 to 12 with am or pm." };
    hour = (hour % 12) + (clock[3].toLowerCase() === "pm" ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return { error: "Use a valid departure time." };
  const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }),
    parts = (t) => Object.fromEntries(fmt.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  const p = parts(relativeDay !== undefined ? now : (base ?? now));
  let day = date?.[1] ?? p.year + "-" + p.month + "-" + p.day;
  let wall =
    Date.parse(day + "T00:00:00Z") +
    (relativeDay ?? 0) * 86400000 +
    hour * 3600000 +
    minute * 60000;
  if (!Number.isFinite(wall)) return { error: "Use a valid departure date." };
  let utc = wall;
  for (let n = 0; n < 3; n++) {
    const local = parts(utc);
    const represented = Date.UTC(
      +local.year,
      +local.month - 1,
      +local.day,
      +local.hour,
      +local.minute,
      +local.second,
    );
    utc += wall - represented;
  }
  if (utc <= now)
    return { error: "That departure time is in the past. Choose a future date and time." };
  return { departure: new Date(utc).toISOString() };
}
