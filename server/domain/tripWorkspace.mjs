import { validateAirportReferences } from '../shopping/airports.mjs';
import { actionById } from '../../shared/travelerActions.mjs';
import { travelerActionResult } from './travelerActions.mjs';
import { protectChatInput } from './conversationPlanner.mjs';
import { createHash, randomUUID } from "node:crypto";
import { DomainError, preferences, connectionGraph } from "./journeys.mjs";
import { searchTrips, createAction } from "./tripActions.mjs";
import { workspaceCommand, interpretWorkspace } from "./workspaceInterpreter.mjs";
import { createToolRunner } from "./agentTools.mjs";
import { groundedReply, parseRequest } from "./agent.mjs";
import { defaultChatProvider } from "../adapters/llm.mjs";
import { cities } from "../catalog.mjs";
import { prepareRecovery } from "../recovery.mjs";
import { createShoppingSearch, shoppingSearchView, cancelShoppingSearch, reviewOffer } from "../shopping/service.mjs";
import { normalizeFlightConstraints, workspaceAirport, flightRequest, checkFlightCandidate, putFlightSet } from "./workspaceFlights.mjs";

const hash = v => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");
const clone = v => structuredClone(v);
const name = place => typeof place === "string" ? place : place?.name;
const fail = (message, code = "INVALID_INPUT", status = 400) => { throw new DomainError(message, status, code); };
function maybe(store, userId, id, kind) {
  if (!id) return null;
  try { return store.get(userId, id, kind); } catch (e) { if (e.status === 404) return null; throw e; }
}
function related(store, userId, id, kind, conversationId) {
  const record = store.get(userId, id, kind);
  if (record.conversationId !== conversationId) fail("That item belongs to a different conversation.", "NOT_FOUND", 404);
  return record;
}
export function createConversation(store, userId, { journeyId, searchId, candidateId } = {}) {
  const p = preferences(store.user(userId).preferences);
  let journey = journeyId ? store.get(userId, journeyId, "journey") : null;
  const search = searchId ? store.get(userId, searchId, "search") : null;
  if (search) {
    journey = search.result.journeys.find(j => j.id === candidateId);
    if (!journey) fail("Choose an option from that search.");
  }
  const expiresAt = Date.now() + (p.saveHistory && p.historyDays > 0 && !journey?.privateTrip ? p.historyDays : 1) * 86400000;
  return store.transaction(() => {
    const conversation = store.put(userId, "conversation", { title: journey ? `${journey.from} → ${journey.to}` : "New trip", draftId: null, journeyId: journeyId ?? null, turnIds: [], expiresAt, pending: null }, { expiresAt });
    const constraints = { from: journey?.fromPlace ?? journey?.fromId ?? "", to: journey?.toPlace ?? journey?.toId ?? "", departure: journey?.departure ?? new Date(Date.now() + 3600000).toISOString(), deadline: null, travelers: journey?.travelers ?? 1, bags: journey?.bags ?? 0, mode: journey?.dataMode === "illustrative" ? "sample" : "provider", timezone: journey?.timezone ?? p.timezone, avoidOvernight: false, preferences: preferences({ ...p, ...search?.input.preferences, ...journey?.searchConstraints?.preferences }) };
    let set = null;
    if (search) set = putSet(store, userId, conversation, { ...search.result, searchId: search.id }, constraints, [], 1);
    const option = set?.options.find(o => o.journey.id === candidateId);
    const draft = store.put(userId, "trip-draft", { conversationId: conversation.id, constraints, selected: option ? selection(set, option) : journey ? { journey, setId: null, optionId: null } : null, activeSetId: set?.id ?? null, comparison: [], locks: [], undoIds: [], scenarioIds: [], lastChange: null }, { expiresAt });
    store.put(userId, "conversation", { ...conversation, draftId: draft.id }, { id: conversation.id, expectedVersion: conversation.version });
    return workspaceSnapshot(store, userId, conversation.id);
  });
}
export function listConversations(store, userId) {
  return store.list(userId, "conversation").map(({ id, title, updatedAt, journeyId }) => ({ id, title, updatedAt, journeyId }));
}
function refreshMessage(store, userId, turn) {
  return { id: turn.id, input: turn.input, status: turn.status, retryCommand: turn.command, ...(turn.response ?? { reply: turn.error ?? (turn.status === "running" ? "Checking your trip. Refresh to resume this turn." : "This turn was interrupted. Retry the message to continue."), mode: "Trip workspace", intent: "help", actions: [] }), flightReview: turn.response?.flightReview ? maybe(store, userId, turn.response.flightReview.id, "shopping-review") : null, pendingActions: turn.response?.pendingActions?.map(a => maybe(store, userId, a.id, "pending-action") ?? { ...a, status: "expired", expiresAt: 0 }) };
}
export function workspaceSnapshot(store, userId, id) {
  const conversation = store.get(userId, id, "conversation"), draft = related(store, userId, conversation.draftId, "trip-draft", id);
  const messages = conversation.turnIds.map(t => maybe(store, userId, t, "conversation-turn")).filter(Boolean).map(t => refreshMessage(store, userId, t.status === "running" && (!conversation.pending || conversation.pending.until <= Date.now()) ? { ...t, status: "failed" } : t));
  const setIds = [...new Set([draft.activeSetId, draft.selected?.setId, ...draft.comparison.map(r => r.setId), ...messages.flatMap(m => m.setIds ?? [])].filter(Boolean))];
  const shoppingIds = [...new Set([draft.activeShoppingId, ...messages.map(m => m.shoppingSearchId)].filter(Boolean))];
  const shoppingSearches = shoppingIds.map(s => maybe(store, userId, s, "shopping-search")).filter(s => s?.conversationId === id).map(({ id: searchId, version, state, reason, queries, scope }) => ({ id: searchId, version, state, reason, queries, scope }));
  return { conversation, draft, messages, execution: maybe(store,userId,conversation.executionId,"conversation-execution"), shoppingSearches, savedComparison: maybe(store, userId, conversation.comparisonId, "travel-comparison"), sets: setIds.map(s => maybe(store, userId, s, "candidate-set")).filter(s=>s?.conversationId===id), scenarios: draft.scenarioIds.map(s => maybe(store, userId, s, "draft-scenario")).filter(s=>s?.conversationId===id).map(({ id: scenarioId, name: title, state, summary }) => ({ id: scenarioId, name: title, summary, departure: state.constraints.departure })), journey: maybe(store, userId, conversation.journeyId, "journey") };
}
const legKey = l => hash([l.mode, l.tripId ?? l.service, l.departure, l.arrival, l.fromStopId ?? l.fromCoords ?? l.from, l.toStopId ?? l.toCoords ?? l.to]);
const stateOf = d => clone({ constraints: d.constraints, selected: d.selected, activeSetId: d.activeSetId, activeShoppingId: d.activeShoppingId ?? null, comparison: d.comparison, locks: d.locks, scenarioIds: d.scenarioIds });
const selection = (set, option) => ({ setId: set.id, optionId: option.id, journey: option.journey, ...(option.flight ? { flight: option.flight } : {}) });
function connectionMargin(j) {
  return j.graph?.connections?.length ? Math.min(...j.graph.connections.map(c => c.spareMinutes)) : null;
}
export function evaluateOption(j, constraints, locks = []) {
  const p = constraints.preferences, reasons = [], unknowns = [];
  if (Date.parse(j.departure) < Date.parse(constraints.departure)) reasons.push("Before the departure window");
  if (constraints.deadline && Date.parse(j.arrival) > Date.parse(constraints.deadline)) reasons.push("After the arrival deadline");
  if (j.transfers > p.maxTransfers) reasons.push("Too many transfers");
  if (j.walkMinutes > p.maxWalkMinutes) reasons.push("Above the walking limit");
  if (p.avoidBus && j.legs.some(l => l.mode === "bus")) reasons.push("Includes a bus");
  if (j.price.totalCents !== null && p.budgetCents > 0 && j.price.totalCents > p.budgetCents) reasons.push("Over the total budget");
  if ((p.wheelchair || p.stepFree) && j.accessible !== true) reasons.push("Step-free accessibility is not verified");
  if (locks.some(lock => !j.legs.some(l => legKey(l) === lock.key))) reasons.push("Does not preserve a locked service");
  const graph = connectionGraph(j, { preferences: p });
  if (graph.connections.some(c => c.blocked || c.spareMinutes < 0)) reasons.push("Insufficient connection time");
  const day = iso => new Intl.DateTimeFormat("en-CA", { timeZone: j.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  if (constraints.avoidOvernight && day(j.departure) !== day(j.arrival)) reasons.push("Crosses midnight at the origin");
  if (!Number.isSafeInteger(j.price.totalCents) || j.price.unknown || j.price.currency !== "USD") unknowns.push("Complete fare unavailable; budget cannot be verified");
  if (constraints.bags > 0 && j.dataMode === "provider") unknowns.push("Baggage allowance and any required fees need verification");
  return { reasons, unknowns, complete: !reasons.length && !unknowns.length, connectionMarginMinutes: connectionMargin({ ...j, graph }) };
}
function putSet(store, userId, conversation, search, constraints, locks, baseVersion, replacement) {
  const excluded = [...(search.excluded ?? [])];
  const options = search.journeys.flatMap(j => {
    const check = evaluateOption(j, constraints, locks);
    if (replacement && !j.legs.some(l => l.mode === replacement.mode && l.from === replacement.from && l.to === replacement.to)) check.reasons.push("Requested segment replacement not found");
    if (check.reasons.length) { excluded.push({ name: j.name, reason: check.reasons.join("; ") }); return []; }
    return [{ id: randomUUID(), journey: j, ...check, labels: [] }];
  });
  const complete = options.filter(o => o.complete);
  const cheapest = [...complete].sort((a, b) => a.journey.price.totalCents - b.journey.price.totalCents)[0];
  const fastest = [...complete].sort((a, b) => a.journey.durationMinutes - b.journey.durationMinutes)[0];
  const resilient = [...complete].sort((a, b) => a.journey.transfers - b.journey.transfers || (b.connectionMarginMinutes ?? 0) - (a.connectionMarginMinutes ?? 0))[0];
  const policy = constraints.preferences.priority;
  const recommended = policy === "price" ? cheapest : policy === "fastest" ? fastest : policy === "walking" ? [...complete].sort((a,b) => a.journey.walkMinutes - b.journey.walkMinutes)[0] : resilient;
  for (const o of options) {
    if (o === cheapest) o.labels.push(o.journey.dataMode === "illustrative" ? "Lowest sample price" : "Lowest complete price found");
    if (o === fastest) o.labels.push("Fastest");
    if (o === resilient) o.labels.push("Fewer transfers / more connection time");
    if (o === recommended) o.labels.push("Recommended");
  }
  return store.put(userId, "candidate-set", { conversationId: conversation.id, searchId: search.searchId, baseVersion, constraints: clone(constraints), options, excluded, source: search.source ?? "Wayline sample schedules", fetchedAt: search.fetchedAt ?? new Date().toISOString(), expiresAt: Math.min(Date.now() + 3600000, ...options.map(o => Date.parse(o.journey.departure))), warning: search.warning ?? null, recommendationPolicy: "workspace-v1: hard constraints, complete totals, selected preference; balanced prioritizes fewer transfers then connection margin", reliabilityNotice: "Historical service reliability is unavailable. Connection margins describe resilience, not an on-time probability." }, { expiresAt: conversation.expiresAt });
}
function resolveOptions(store, userId, conversation, draft, command, visibleSetId) {
  const setId = command.setId ?? visibleSetId ?? draft.activeSetId;
  if (!setId) fail("Search for routes first.");
  const set = related(store, userId, setId, "candidate-set", conversation.id);
  if (command.positions?.length && !command.setId && !visibleSetId) fail("Choose the result set you mean, or use Compare on the exact cards.");
  if (set.kind === "flights" && store.get(userId, set.searchId, "shopping-search").state === "cancelled") fail("This search was cancelled. Search again before selecting an offer.", "OPTIONS_STALE", 409);
  const ids = command.optionIds ?? command.positions?.map(p => set.options[p - 1]?.id);
  const options = ids?.length ? ids.map(id => set.options.find(o => o.id === id)) : set.options;
  if (!options.length || options.some(o => !o)) fail("That option is not in the referenced result set.");
  return { set, options };
}
function resolveLeg(draft, command) {
  if (!draft.selected) fail("Select an itinerary before editing a leg.");
  const legs = draft.selected.journey.legs.filter(l => command.legId ? l.id === command.legId : l.mode === command.legMode);
  if (legs.length !== 1) fail("Choose the exact leg in the itinerary timeline; that reference is ambiguous.");
  return legs[0];
}
function validateSelection(option, set, draft) {
  if (set.expiresAt <= Date.now()) fail("These options have expired. Refresh the search before selecting or saving.", "OPTIONS_EXPIRED", 409);
  if (hash(set.constraints) !== hash(draft.constraints)) fail("These options use different trip requirements. Restore the scenario or search again before selecting.", "OPTIONS_STALE", 409);
  const check = option.flight ? checkFlightCandidate(option.flight, draft.constraints, draft.locks) : evaluateOption(option.journey, draft.constraints, draft.locks);
  if (check.reasons.length) fail(check.reasons.join("; "), "CONSTRAINT_CONFLICT", 409);
}
function summary(before, after) {
  const changes = [];
  const labels = { from: "Origin", to: "Destination", departure: "Departure", deadline: "Arrival deadline", bags: "Bags", travelers: "Travelers", mode: "Inventory", returnDate: "Return date", avoidOvernight: "Avoid overnight travel" };
  for (const [key, label] of Object.entries(labels)) if (hash(before.constraints[key]) !== hash(after.constraints[key])) changes.push({ label, before: typeof before.constraints[key] === "object" && before.constraints[key] ? name(before.constraints[key]) : before.constraints[key] ?? "None", after: typeof after.constraints[key] === "object" && after.constraints[key] ? name(after.constraints[key]) : after.constraints[key] ?? "None" });
  for (const key of Object.keys(after.constraints.preferences)) if (before.constraints.preferences[key] !== after.constraints.preferences[key]) changes.push({ label: key, before: before.constraints.preferences[key], after: after.constraints.preferences[key] });
  if (before.selected?.optionId !== after.selected?.optionId) {
    changes.push({ label: "Selected itinerary", before: before.selected?.journey.name ?? "None", after: after.selected?.journey.name ?? "None" });
    for (const key of ["arrival", "walkMinutes", "transfers"]) changes.push({ label: key, before: before.selected?.journey[key] ?? "None", after: after.selected?.journey[key] ?? "None" });
    changes.push({ label: "Total fare (cents)", before: before.selected?.journey.price?.totalCents ?? "Unknown", after: after.selected?.journey.price?.totalCents ?? "Unknown" });
  }
  if (hash(before.constraints.passengers) !== hash(after.constraints.passengers)) changes.push({ label: "Traveler baggage and ages", before: JSON.stringify(before.constraints.passengers ?? []), after: JSON.stringify(after.constraints.passengers ?? []) });
  if (before.constraints.flightWindowHours !== after.constraints.flightWindowHours) changes.push({ label: "Flight departure window (hours)", before: before.constraints.flightWindowHours ?? 23, after: after.constraints.flightWindowHours ?? 23 });
  for(const [key,label] of [["additionalFlights","Multi-city sections"],["originAirports","Alternate departure airports"],["destinationAirports","Alternate arrival airports"],["flexibleDates","Additional departure dates"]])if(hash(before.constraints[key])!==hash(after.constraints[key]))changes.push({label,before:JSON.stringify(before.constraints[key]??[]),after:JSON.stringify(after.constraints[key]??[])});
  if (hash(before.locks) !== hash(after.locks)) changes.push({ label: "Locked services", before: before.locks.length, after: after.locks.length });
  return changes;
}

async function execute(store, userId, c, original, command, input, visibleSetId, travel) {
  let draft = clone(original);
  let response = { reply: "Trip draft updated.", mode: "Trip workspace", intent: command.op, actions: [], setIds: [], pendingActions: [], results: [] };
  if(actionById[command.op]?.capability !== 'planning') {
    response=await travelerActionResult(store,userId,c,draft,command,travel,input);
    return {draft,response,command};
  }
  let newSearch = null, replacement = null, branch = false, shoppingRequest = null, shoppingResult = null, cancelSearch = null;
  if (command.op === "undo_draft_edit") {
    const id = draft.undoIds.pop();
    if (!id) fail("There is no earlier draft edit to undo.");
    const revision = related(store, userId, id, "draft-revision", c.id);
    Object.assign(draft, revision.before);
    response.reply = "Restored the previous draft. Expired options must be refreshed before saving. Saved journeys and tickets are unchanged.";
  } else if (command.op === "restore_scenario") {
    const restore = related(store, userId, command.scenarioId, "draft-scenario", c.id);
    Object.assign(draft, clone(restore.state), { scenarioIds: original.scenarioIds });
    response.reply = "Scenario restored as your current draft. Review it before updating a saved journey.";
  } else {
    if (command.op === "select_option" || (command.op === "replace_leg" && (command.optionIds?.length || command.positions?.length))) {
      const { set, options } = resolveOptions(store, userId, c, draft, command, visibleSetId);
      if (options.length !== 1) fail("Choose one itinerary to customize.");
      validateSelection(options[0], set, draft);
      draft.selected = selection(set, options[0]); draft.activeSetId = set.id;
      draft.locks = draft.locks.map(lock => ({ ...lock, legId: options[0].journey.legs.find(l => legKey(l) === lock.key)?.id ?? lock.legId }));
    }
    if (command.op === "collect_options") {
      if(!command.searchId&&!draft.activeShoppingId)fail("Start a flight search before collecting its results.");
      const search = related(store, userId, command.searchId ?? draft.activeShoppingId, "shopping-search", c.id);
      if (search.id !== draft.activeShoppingId || hash(search.workspaceConstraints) !== hash(draft.constraints)) fail("This search uses earlier requirements. Restore its scenario or search again.", "OPTIONS_STALE", 409);
      if (!["complete", "partial-failure"].includes(search.state)) fail(search.reason || "Wait for this search to finish before loading its offers.");
      const active = maybe(store, userId, draft.activeSetId, "candidate-set");
      if (active?.searchId === search.id && active.searchVersion === search.version) { response.setIds = [active.id]; response.reply = "These are the same saved result cards."; }
      else shoppingResult = shoppingSearchView(store, userId, search.id);
    }
    if (command.op === "cancel_search") {
      if(!command.searchId&&!draft.activeShoppingId)fail("There is no active flight search to cancel.");
      cancelSearch = related(store, userId, command.searchId ?? draft.activeShoppingId, "shopping-search", c.id);
      response.reply = "Flight search cancelled. Your draft requirements are retained.";
    }
    if (command.op === "lock_leg" && command.locked === false && !draft.selected) {
      const lock = draft.locks.find(l => l.legId === command.legId);
      if (!lock) fail("Choose a kept service to unlock.");
      draft.locks = draft.locks.filter(l => lock.ticketGroupId ? l.ticketGroupId !== lock.ticketGroupId : l.key !== lock.key);
      response.reply = lock.ticketGroupId ? "Whole ticket group unlocked." : "Service unlocked.";
    } else if (["lock_leg", "replace_leg"].includes(command.op) && draft.selected?.flight) {
      const leg = resolveLeg(draft, command);
      const group = draft.selected.flight.ticketGroups.find(g => g.serviceIds.includes(leg.id));
      if (!group) fail("This service is not part of the selected supplier ticket group.");
      const legs = draft.selected.journey.legs.filter(l => group.serviceIds.includes(l.id));
      if (command.op === "replace_leg") {
        if (legs.some(l => draft.locks.some(lock => lock.serviceKey === l.serviceKey))) fail("Unlock the whole ticket group before replacing it.");
        if (command.replacementMode !== "flight") fail("An authorized rail or bus shopping provider is needed to replace this flight. The supplier ticket group must be repriced as a whole.", "MODE_UNAVAILABLE", 409);
        draft.selected = null;
      } else {
        draft.locks = draft.locks.filter(l => !legs.some(leg => leg.serviceKey === l.serviceKey));
        if (command.locked !== false) draft.locks.push(...legs.map(l => ({ key: legKey(l), serviceKey: l.serviceKey, legId: l.id, service: l.service, mode: l.mode, ticketGroupId: group.id })));
        response.reply = command.locked === false ? "Whole supplier ticket group unlocked." : "Every flight in this supplier ticket group is locked. New offers must preserve all of them and reprice the complete party. Seats are not reserved.";
      }
    } else if (["lock_leg", "replace_leg"].includes(command.op)) {
      const leg = resolveLeg(draft, command), key = legKey(leg);
      if (command.op === "lock_leg") {
        draft.locks = draft.locks.filter(l => l.key !== key);
        if (command.locked !== false) draft.locks.push({ key, legId: leg.id, service: leg.service, mode: leg.mode });
        response.reply = command.locked === false ? "Service unlocked." : "Service locked for future searches. This does not hold inventory.";
      } else {
        if (draft.locks.some(l => l.key === key)) fail("Unlock this service before replacing it.");
        if (!command.replacementMode) fail("Choose the replacement mode.");
        // Existing transit providers search complete itineraries. Retain every other
        // service as an exact constraint instead of splicing incompatible tickets/legs.
        replacement = { mode: command.replacementMode, from: leg.from, to: leg.to };
        draft.locks = [...draft.locks, ...draft.selected.journey.legs.filter(l => l.id !== leg.id && l.mode !== "walk" && !draft.locks.some(lock => lock.key === legKey(l))).map(l => ({ key: legKey(l), legId: l.id, service: l.service, mode: l.mode, temporary: true }))];
      }
    }
    if (command.patch) {
      const patch = command.patch;
      if(patch.resolvedAirports)validateAirportReferences(store,userId,patch.resolvedAirports);
      draft.constraints = { ...draft.constraints, ...patch, preferences: preferences({ ...draft.constraints.preferences, ...patch.preferences }) };
      draft.constraints = normalizeFlightConstraints(draft.constraints, patch);
      if (typeof patch.from === "object") draft.constraints.timezone = patch.from.timezone;
      if (Date.parse(draft.constraints.departure) <= Date.now()) fail("Choose a future departure time.");
      if (draft.constraints.deadline && Date.parse(draft.constraints.deadline) <= Date.parse(draft.constraints.departure)) fail("Arrival deadline must follow departure.");
      if (draft.selected) draft.selected = null;
    }
    if (["search_options", "update_constraints", "replace_leg", "branch_scenario"].includes(command.op) || (command.op === "lock_leg" && command.patch)) {
      branch = command.op === "branch_scenario";
      if (!name(draft.constraints.from) || !name(draft.constraints.to)) {
        response.reply = "Your requirements are saved. Tell me the origin and destination to find routes.";
        const missing=['from','to'].filter(key=>!name(draft.constraints[key]));
        response.clarification={version:1,kind:'missing-endpoint',field:missing.length===1?missing[0]:null,required:missing,question:response.reply};
      } else {
        const request = { ...draft.constraints, deadline: draft.constraints.deadline ?? undefined };
        if (draft.constraints.mode === "flights") {
          draft.constraints = normalizeFlightConstraints(draft.constraints);
          shoppingRequest = flightRequest(draft.constraints);
        } else newSearch = await searchTrips(store, userId, request, travel);
        // Resolve provider places/timezone once and retain them on subsequent turns.
        const first = newSearch?.journeys[0];
        if (first?.fromPlace) draft.constraints.from = first.fromPlace;
        if (first?.toPlace) draft.constraints.to = first.toPlace;
        if (first?.timezone) draft.constraints.timezone = first.timezone;
      }
    }
    if (["compare_options", "explain_option"].includes(command.op)) {
      const { set, options } = resolveOptions(store, userId, c, draft, command, visibleSetId);
      draft.comparison = options.map(o => ({ setId: set.id, optionId: o.id }));
      response.setIds = [set.id]; response.comparison = draft.comparison;
      response.reply = "Compare complete journey times, transfers, walking and known costs below. Unknown prices cannot establish the cheapest trip. Historical reliability is unavailable; connection margins describe resilience only.";
    }
    if (command.op === "prepare_review") {
      if (!draft.selected?.setId) fail("Select an option from a current search before saving. Search again to refresh a saved itinerary.");
      const set = related(store, userId, draft.selected.setId, "candidate-set", c.id);
      const option = set.options.find(o => o.id === draft.selected.optionId);
      if (!option) fail("The selected option is unavailable.");
      validateSelection(option, set, draft);
      if (option.flight) {
        response.flightReview = await reviewOffer(store, userId, set.searchId, option.flight.id, travel);
        response.reply = "The supplier offer has been refreshed. Review the complete party, baggage, conditions and any changes before saving this comparison.";
      } else response.reviewRequest = { kind: c.journeyId ? "change" : "add", journeyId: c.journeyId, searchId: set.searchId, candidateId: option.journey.id, conversationId: c.id, draftId: draft.id, draftVersion: original.version };
      if (!option.flight) response.reply = "Review this complete itinerary before saving. Unknown fares and baggage conditions still need verification. Saving does not purchase tickets.";
    }
    if (command.op === "prepare_recovery" && draft.constraints.mode === "flights") {
      response.protectedPanel="prepare_recovery";response.reply="Confirm your reached airport and boarding-ready time below. I will verify completed flights against licensed status data and compare replacement costs separately from previous spending. Supplier purchases require a new exact review.";
    }
    if (command.op === "prepare_recovery" && draft.constraints.mode !== "flights") {
      if (!c.journeyId) fail("Choose the affected saved journey before preparing recovery. Your draft is unchanged.");
      const journey = store.get(userId, c.journeyId, "journey");
      const recoveryJourney = { ...journey, searchConstraints: { ...journey.searchConstraints, deadline: command.arrivalDeadline ?? journey.searchConstraints?.deadline, preferences: { ...journey.searchConstraints?.preferences, ...(command.maxExtraCents !== undefined ? { budgetCents: command.maxExtraCents } : {}) } } };
      const attempt = store.get(userId, c.id, "conversation").pending?.attemptId;
      const recoveries = await prepareRecovery(store, userId, recoveryJourney, travel, { canCommit: () => { const pending = store.get(userId, c.id, "conversation").pending; return pending?.attemptId === attempt && pending.until > Date.now(); } });
      const eligible = recoveries.filter(r => (command.maxExtraCents === undefined || (r.economics.cashRequiredNowCents !== null && r.economics.cashRequiredNowCents <= command.maxExtraCents)) && (!command.arrivalDeadline || Date.parse(r.alternative.arrival) <= Date.parse(command.arrivalDeadline)));
      response.results = [{ type: "recovery", recovery: eligible }];
      response.reply = eligible.length ? "Review these alternatives from the journey’s recorded reachable position. Cash required now is shown separately from previous spending. Your reported delay is not a confirmed operator update; check your actual location before applying a replacement." : "No replacement could be verified within these recovery requirements. Unknown costs cannot satisfy an extra-cash limit. Your current plan is unchanged.";
    }
    if (command.op === "advice" && draft.constraints.mode === "flights") {
      if (/status|delay|gate|cancelled|canceled/i.test(input)) response.reply = "Flight status, gates and delays require a licensed status provider. This workspace currently holds shopping offers, not verified operational updates.";
      else if (draft.selected?.flight) {
        response.reply = "Here are the supplier-recorded whole-party costs, requested baggage and ticket conditions for your selected flight. This is an airport-to-airport comparison; airport transport and hotels are outside its scope. Unverified costs or connections remain explicit below.";
        response.setIds = [draft.selected.setId]; response.comparison = [{ setId: draft.selected.setId, optionId: draft.selected.optionId }];
      } else response.reply = "Choose exact airports and each traveler’s baggage in Trip requirements, then search and load the returned offers. Select an offer to inspect its party price and supplier conditions. Live inventory requires approved supplier access.";
    } else if (command.op === "advice") {
      const tool = await createToolRunner({ store, userId, travel, context: { journeyId: c.journeyId } })({ input, provider: null });
      if (tool) response = { ...response, ...tool };
      else {
        const parsed = parseRequest(input);
        response = { ...response, ...groundedReply(parsed.intent, { journey: draft.selected?.journey, preferences: draft.constraints.preferences, parsed }) };
      }
    }
  }
  return { draft, response, newSearch, replacement, branch, command, shoppingRequest, shoppingResult, cancelSearch };
}

export async function runWorkspaceTurn(store, userId, conversationId, request, travel, provider = defaultChatProvider()) {
  const { clientTurnId, expectedVersion, input = "Trip controls", visibleSetId } = request;
  protectChatInput(input);
  if (typeof clientTurnId !== "string" || !clientTurnId || clientTurnId.length > 100) fail("A client turn ID is required.");
  if (typeof input !== "string" || !input.trim() || input.length > 2000) fail("Enter a message of up to 2,000 characters.");
  if (!Number.isInteger(expectedVersion)) fail("The current draft version is required.");
  const turnId = hash([userId, conversationId, clientTurnId]);
  const requestHash = hash({ input, command: request.command, expectedVersion, visibleSetId });
  const c = store.get(userId, conversationId, "conversation");
  if(c.executionId && c.executionId!==request.executionId) {
    const execution=maybe(store,userId,c.executionId,'conversation-execution');
    if(execution && !['completed','failed','cancelled'].includes(execution.state))fail('Another conversation turn is running.','TURN_PENDING',409);
  }
  const existing = maybe(store, userId, turnId, "conversation-turn");
  if (existing && existing.requestHash !== requestHash) fail("This message ID was already used for different input.", "IDEMPOTENCY_CONFLICT", 409);
  if (existing?.status === "completed") return workspaceSnapshot(store, userId, c.id);
  if (c.pending && c.pending.until > Date.now()) fail("Another edit is still running. Refresh this conversation shortly.", "TURN_PENDING", 409);
  const original = related(store, userId, c.draftId, "trip-draft", c.id);
  if (original.version !== expectedVersion) fail("This trip changed in another tab. Refresh and review the latest draft.", "VERSION_CONFLICT", 409);
  if (visibleSetId) related(store, userId, visibleSetId, "candidate-set", c.id);
  const attemptId = randomUUID();
  store.transaction(() => {
    if (c.pending && c.pending.turnId !== turnId) {
      const interrupted = related(store, userId, c.pending.turnId, "conversation-turn", c.id);
      store.put(userId, "conversation-turn", { ...interrupted, status: "failed", error: "This search was interrupted. Retry to continue." }, { id: interrupted.id, expectedVersion: interrupted.version });
    }
    store.put(userId, "conversation-turn", { conversationId, clientTurnId, requestHash, input, command: request.command, baseVersion: expectedVersion, status: "running", attemptId }, { id: turnId, ...(existing ? { expectedVersion: existing.version } : {}), expiresAt: c.expiresAt });
    store.put(userId, "conversation", { ...c, pending: { turnId, attemptId, until: Date.now() + 90000 }, turnIds: [...c.turnIds.filter(id => id !== turnId), turnId].slice(-100) }, { id: c.id, expectedVersion: c.version });
  });
  try {
    const set = maybe(store, userId, visibleSetId ?? original.activeSetId, "candidate-set");
    let command = request.command ? workspaceCommand.parse(request.command) : await interpretWorkspace(input, original, set, provider);
    if (!request.command && command.patch?.from) {
      // Resolve the departure timezone before interpreting a local date/time.
      let from = command.patch.from;
      if (typeof from === "string") {
        if ((command.patch.mode ?? original.constraints.mode) === "flights") from = workspaceAirport(from);
        else if (original.constraints.mode === "sample") from = cities.find(city => city.id === from || city.name.toLowerCase() === from.toLowerCase());
        else {
          const data = await travel.call("places", { q: from });
          const exact = data.places.filter(p => p.id === from || p.name.toLowerCase() === from.toLowerCase());
          from = exact.length === 1 ? exact[0] : data.places.length === 1 ? data.places[0] : null;
        }
      }
      if (!from?.timezone) fail((command.patch.mode ?? original.constraints.mode) === "flights" ? "Choose an exact airport code in Trip requirements, such as BOS or JFK." : "Choose an exact origin in Trip requirements so I can use its local departure time.", "PLACE_REQUIRED");
      const localized = await interpretWorkspace(input, { ...original, constraints: { ...original.constraints, timezone: from.timezone } }, set, { available: false });
      if (localized.patch) command = localized;
      command.patch.from = (command.patch.mode ?? original.constraints.mode) === "flights" ? from.iata : original.constraints.mode === "sample" ? from.id : from;
      if (original.constraints.mode === "sample" && typeof command.patch.to === "string") {
        const to = cities.find(city => city.id === command.patch.to || city.name.toLowerCase() === command.patch.to.toLowerCase());
        if (to) command.patch.to = to.id;
      }
    }
    const result = await execute(store, userId, c, original, command, input, visibleSetId, travel);
    store.transaction(() => {
      const current = store.get(userId, c.id, "conversation"), latest = store.get(userId, original.id, "trip-draft");
      if (current.pending?.attemptId !== attemptId || current.pending.until <= Date.now() || latest.version !== original.version) fail("A newer edit superseded this result. Refresh the conversation.", "VERSION_CONFLICT", 409);
      let { draft, response } = result;
      if (result.cancelSearch) cancelShoppingSearch(store, userId, result.cancelSearch.id, result.cancelSearch.version);
      if (result.shoppingRequest) {
        const prior = maybe(store, userId, original.activeShoppingId, "shopping-search");
        if (!result.branch && prior && ["queued", "partial"].includes(prior.state)) cancelShoppingSearch(store, userId, prior.id, prior.version);
        const search = createShoppingSearch(store, userId, result.shoppingRequest, { key: turnId, capabilities: travel.flightShoppingCapabilities });
        store.put(userId, "shopping-search", { ...search, conversationId: c.id, workspaceConstraints: clone(draft.constraints) }, { id: search.id, expectedVersion: search.version, expiresAt: Math.min(c.expiresAt, Date.now() + 3600000) });
        draft.activeShoppingId = search.id; draft.activeSetId = null; draft.selected = null; draft.comparison = [];
        response.shoppingSearchId = search.id;
        response.reply = search.state === "blocked" ? "Your flight requirements are saved. Approved supplier access is not configured, so no fares are available. You can keep editing this trip and retry when access is connected." : "Your flight search is running. When it finishes, load the offers below to compare stable result cards. Prices cover the whole party and requested baggage.";
      }
      if (result.shoppingResult) {
        const set = putFlightSet(store, userId, c, result.shoppingResult, draft.constraints, draft.locks, original.version);
        draft.activeSetId = set.id; draft.selected = null; draft.comparison = [];
        response.setIds = [set.id];
        response.reply = set.options.length ? "Your flight offers are ready. Compare or select a whole itinerary to customize. Required costs and connection details that need verification are shown on each card." : "No returned offers satisfy these requirements and ticket-group locks. Review the exclusions or change a constraint.";
      }
      if (result.newSearch) {
        const candidateSet = putSet(store, userId, c, result.newSearch, draft.constraints, draft.locks, original.version, result.replacement);
        draft.activeSetId = candidateSet.id; draft.comparison = [];
        draft.locks = draft.locks.filter(l => !l.temporary);
        // Never silently pick an alternative after requirements change.
        if (command.op !== "replace_leg") draft.selected = null;
        if (draft.selected && evaluateOption(draft.selected.journey, draft.constraints, draft.locks).reasons.length) draft.selected = null;
        response.setIds = [candidateSet.id];
        response.reply = candidateSet.options.length ? "Your options are ready. Compare them or select one to customize. " + (result.replacement ? "Every other transit service was preserved and the whole connection chain was checked. " : "") + (candidateSet.options.some(o => !o.complete) ? "Some options need price or baggage verification." : "") : "No options meet all these requirements. Your constraints and locks are retained. Review the exclusions below, or relax a specific constraint and search again.";
      }
      if (result.branch) {
        const scenario = store.put(userId, "draft-scenario", { conversationId: c.id, name: command.name || "Departure scenario", state: stateOf(draft), summary: summary(original, draft) }, { expiresAt: c.expiresAt });
        draft = { ...clone(original), scenarioIds: [...original.scenarioIds, scenario.id].slice(-20) };
        response.reply = "Saved this comparison scenario. Your current plan is unchanged. Restore the scenario when you want to continue editing it.";
      }
      const changed = hash(stateOf(original)) !== hash(stateOf(draft));
      if (changed) {
        const change = summary(original, draft);
        const revision = store.put(userId, "draft-revision", { conversationId: c.id, draftId: draft.id, turnId, baseVersion: original.version, operation: command.op, before: stateOf(original), after: stateOf(draft), changes: change }, { expiresAt: c.expiresAt });
        draft.lastChange = { operation: command.op, changes: change };
        if (command.op !== "undo_draft_edit") draft.undoIds = [...draft.undoIds, revision.id].slice(-30);
        store.put(userId, "trip-draft", draft, { id: draft.id, expectedVersion: original.version });
        response.change = draft.lastChange;
      }
      if (response.reviewRequest) {
        const action = createAction(store, userId, response.reviewRequest);
        response.pendingActions = [action]; delete response.reviewRequest;
      }
      const turn = store.get(userId, turnId, "conversation-turn");
      store.put(userId, "conversation-turn", { ...turn, status: "completed", response }, { id: turnId, expectedVersion: turn.version });
      const title = name(draft.constraints.from) && name(draft.constraints.to) ? `${name(draft.constraints.from)} → ${name(draft.constraints.to)}` : current.title;
      store.put(userId, "conversation", { ...current, title, pending: null, ...(!request.executionId?{executionId:null}:{}), lastCommittedTurnId: turnId }, { id: c.id, expectedVersion: current.version });
    });
    return workspaceSnapshot(store, userId, c.id);
  } catch (e) {
    store.transaction(() => {
      const current = store.get(userId, c.id, "conversation"), turn = store.get(userId, turnId, "conversation-turn");
      if (current.pending?.attemptId === attemptId) {
        store.put(userId, "conversation", { ...current, pending: null }, { id: c.id, expectedVersion: current.version });
        store.put(userId, "conversation-turn", { ...turn, status: "failed", error: e instanceof DomainError ? e.message : "The provider could not complete this request. Your draft is unchanged. Retry when the connection is available." }, { id: turnId, expectedVersion: turn.version });
      }
    });
    if (e.name === "ZodError") throw new DomainError("That edit has invalid or unsupported fields.");
    throw e;
  }
}
