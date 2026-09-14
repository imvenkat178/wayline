import {flightScopeLanguage} from './flightScopeLanguage.mjs';
import { actionIds,actionInputs } from '../../shared/travelerActions.mjs';
import { z } from "zod";
import { place as airportSchema, passenger as passengerSchema } from "../shopping/contracts.mjs";
import { workspaceAirport } from "./workspaceFlights.mjs";
import { endpointSchema } from "../travel/schemas.mjs";
import { parseRequest } from "./agent.mjs";
import { parseDeparture } from "./agentTools.mjs";
import { DomainError } from "./journeys.mjs";

const dateTime = z.string().datetime({ offset: true });
export const constraintsPatch = z.object({
  from: endpointSchema.optional(), to: endpointSchema.optional(),
  departure: dateTime.optional(), deadline: dateTime.nullable().optional(),
  travelers: z.number().int().min(1).max(12).optional(),
  bags: z.number().int().min(0).max(12).optional(),
  mode: z.enum(["provider", "sample", "flights"]).optional(),
  passengers: z.array(passengerSchema).min(1).max(9).optional(),
  originAirports:z.array(z.string().regex(/^[A-Z]{3}$/)).max(2).optional(), destinationAirports:z.array(z.string().regex(/^[A-Z]{3}$/)).max(2).optional(), flexibleDates:z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(3).optional(),
  resolvedAirports: z.array(airportSchema).max(20).optional(),
  additionalFlights: z.array(z.object({from:z.string().min(3).max(160),to:z.string().min(3).max(160),departure:dateTime}).strict()).max(5).optional(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  flightWindowHours: z.number().int().min(1).max(24).optional(),
  avoidOvernight: z.boolean().optional(),
  preferences: z.object({
    budgetCents: z.number().int().min(0).max(1000000).optional(),
    priority: z.enum(["balanced", "price", "fastest", "reliable", "walking", "transfers", "carbon"]).optional(),
    maxTransfers: z.number().int().min(0).max(8).optional(),
    maxWalkMinutes: z.number().int().min(0).max(120).optional(),
    minConnectionMinutes: z.number().int().min(0).max(120).optional(),
    wheelchair: z.boolean().optional(), stepFree: z.boolean().optional(),
    avoidBus: z.boolean().optional(), importance: z.enum(["casual", "normal", "important", "critical"]).optional(),
    lessCrowded: z.boolean().optional(),
  }).strict().optional(),
}).strict();
export const workspaceCommand = z.object({
  op: z.enum(actionIds),
  maxExtraCents: z.number().int().min(0).max(100000).optional(),
  arrivalDeadline: dateTime.optional(),
  patch: constraintsPatch.optional(),
  setId: z.string().max(100).optional(),
  searchId: z.string().max(100).optional(),
  optionIds: z.array(z.string().max(100)).max(5).optional(),
  positions: z.array(z.number().int().min(1).max(100)).max(5).optional(),
  legId: z.string().max(100).optional(),
  legMode: z.enum(["bus", "train", "metro", "tram", "ferry", "walk", "flight"]).optional(),
  replacementMode: z.enum(["bus", "train", "metro", "tram", "ferry", "walk", "flight"]).optional(),
  locked: z.boolean().optional(), name: z.string().max(80).optional(), scenarioId: z.string().max(100).optional(),
}).strict().superRefine((command,ctx)=>{for(const key of Object.keys(command))if(key!=='op'&&!(actionInputs[command.op]??[]).includes(key))ctx.addIssue({code:'custom',message:'Unsupported input '+key+' for '+command.op});});

const ordinals = ["first", "second", "third", "fourth", "fifth"];
function positions(input) {
  const found = [...input.matchAll(/\b(first|second|third|fourth|fifth|option\s+\d+|\d+(?:st|nd|rd|th))\b/gi)];
  return [...new Set(found.map(m => ordinals.indexOf(m[0].toLowerCase()) + 1 || Number(m[0].match(/\d+/)[0])))];
}

export function interpretRules(input, draft, now = Date.now()) {
  const q = input.toLowerCase(), patch = {};
  if (/\b(recover|recovery|alternatives|backup)\b|\b(?:my|the) (?:flight|train|bus|trip) (?:is |was )?(?:late|delayed|cancelled)\b/.test(q)) {
    const extra = q.match(/\$\s*(\d+(?:\.\d{1,2})?)\s*(?:extra|more)/);
    const end = /\btonight\b/.test(q) ? parseDeparture("today at 11:59 pm", { zone: draft.constraints.timezone, relativeDay: 0, now }) : null;
    return { op: "prepare_recovery", ...(extra ? { maxExtraCents: Math.round(Number(extra[1]) * 100) } : {}), ...(end?.departure ? { arrivalDeadline: end.departure } : {}) };
  }
  if (/\b(cancel|stop) (?:the |this )?search\b/.test(q)) return { op: "cancel_search" };
  if (/\b(show|load|collect) (?:the |current |flight )?offers\b/.test(q)) return { op: "collect_options" };
  const scoped=(draft.constraints.mode==='flights'||/\b(flight|flights|fly|airfare|multi[ -]?city|round[ -]?trip)\b/i.test(input))?flightScopeLanguage(input,draft,{parseDeparture,now,resolveAirport:value=>workspaceAirport(value,draft.constraints.resolvedAirports)}):{text:input,patch:{}};
  input=scoped.text;
  const parsed=input.trim()?parseRequest(input):{overrides:{}};
  const route = input.match(/(?:\bfrom\s+|\bplan\s+)(.+?)\s+to\s+(.+?)(?=\s+(?:tomorrow|today|tonight|at|on|under|before|by|with|this|next)\b|[,!?]|$)/i);
  if (route) Object.assign(patch, { from: route[1].trim(), to: route[2].trim().replace(/\.$/, "") });
  else {
    const to = input.match(/(?:destination|trip)\s+to\s+(.+?)(?=\s+(?:tomorrow|today|at|on|under|with)\b|[.!?]|$)/i);
    if (to) patch.to = to[1].trim();
  }
  if (/\b(flights?|fly|airfare)\b/.test(q) && (route || /search|find/.test(q))) patch.mode = "flights";
  const isFlight = (patch.mode ?? draft.constraints.mode) === "flights";
  if (isFlight && route) {
    patch.from = workspaceAirport(patch.from)?.iata ?? patch.from;
    patch.to = workspaceAirport(patch.to)?.iata ?? patch.to;
  }
  if (Object.keys(parsed.overrides).length) patch.preferences = parsed.overrides;
  if (/\b(show|compare)\b/.test(q) && /cheapest|fastest|reliable|recommend/.test(q) && !route) delete patch.preferences;
  const bag = q.match(/\b(no|one|two|three|\d+)\s+(?:cabin |carry.on |checked )?bags?\b/);
  const counts = { no: 0, one: 1, two: 2, three: 3 };
  if (bag) patch.bags = counts[bag[1]] ?? Number(bag[1]);
  const travelers = q.match(/\b(one|two|three|\d+)\s+(?:travelers?|passengers?|adults?|people)\b/);
  if (travelers) patch.travelers = counts[travelers[1]] ?? Number(travelers[1]);
  const flightBags = [...q.matchAll(/\b(no|one|two|three|\d+)\s+(?:(cabin|carry.on|checked) bags?|personal items?|bags?)\b/g)];
  if (isFlight && (flightBags.length || patch.travelers)) {
    const count = patch.travelers ?? draft.constraints.travelers;
    if (count > 9) throw new DomainError("Flight shopping supports up to nine travelers.");
    if (flightBags.length && count > 1 && !/\b(each|per (?:person|traveler|passenger))\b/.test(q)) throw new DomainError("Specify bags per traveler, or edit the traveler list in Trip requirements.");
    if (draft.constraints.passengers?.some(p => p.type === "child") && patch.travelers) throw new DomainError("Edit the traveler list to retain each child’s age.");
    const bagPatch = {};
    for (const match of flightBags) {
      const count = counts[match[1]] ?? Number(match[1]);
      const kind = /personal/.test(match[0]) ? "personal" : match[2] === "checked" ? "checked" : match[2] ? "cabin" : null;
      if (!kind && count !== 0) throw new DomainError("For flights, specify cabin or checked bags.");
      if (kind && bagPatch[kind] !== undefined) throw new DomainError("Specify each bag type once, or use the traveler controls.");
      Object.assign(bagPatch, kind ? { [kind]: count } : { personal: 0, cabin: 0, checked: 0 });
    }
    patch.passengers = Array.from({ length: count }, (_, i) => ({ ...(draft.constraints.passengers?.[i] ?? { id: "adult-" + (i + 1), type: "adult", personal: 0, cabin: 0, checked: 0 }), ...bagPatch }));
    delete patch.bags;
  }
  if (/avoid (?:overnight|night)|no overnight/.test(q)) patch.avoidOvernight = true;
  if (/allow overnight/.test(q)) patch.avoidOvernight = false;
  if (/avoid (?:the )?bus|no bus/.test(q)) patch.preferences = { ...patch.preferences, avoidBus: true };
  if (/allow bus/.test(q)) patch.preferences = { ...patch.preferences, avoidBus: false };
  const extra = q.match(/(?:spend|budget|allow)\s*\$?(\d+(?:\.\d{1,2})?)\s+more/);
  if (extra) patch.preferences = { ...patch.preferences, budgetCents: draft.constraints.preferences.budgetCents + Math.round(Number(extra[1]) * 100) };
  let timeInput = input;
  const zone = draft.constraints.timezone;
  const weekday = q.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (weekday) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
    const wall = new Date(day + "T12:00:00Z");
    const target = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(weekday[1]);
    const delta = (target - wall.getUTCDay() + 7) % 7 || 7;
    wall.setUTCDate(wall.getUTCDate() + delta);
    timeInput = timeInput.replace(new RegExp("(?:next )?" + weekday[1], "i"), wall.toISOString().slice(0, 10));
  }
  if (/\bevening\b/.test(q) && !/\bat\s+\d/.test(q)) timeInput += " at 6 pm";
  if (/\bmorning\b/.test(q) && !/\bat\s+\d/.test(q)) timeInput += " at 9 am";
  if (/\bafternoon\b/.test(q) && !/\bat\s+\d/.test(q)) timeInput += " at 1 pm";
  const when = parseDeparture(timeInput, { base: draft.constraints.departure, zone, relativeDay: parsed.relativeDay, now });
  if (when.error) throw new DomainError(when.error);
  if (when.departure) patch.departure = when.departure;
  if (/\b(later|earlier)\b/.test(q) && !patch.departure) {
    const offset = q.match(/\b(\d+)\s*(hours?|minutes?)\b/);
    const minutes = offset ? Number(offset[1]) * (offset[2].startsWith("hour") ? 60 : 1) : 60;
    patch.departure = new Date(Date.parse(draft.constraints.departure) + (/earlier/.test(q) ? -1 : 1) * minutes * 60000).toISOString();
  }
  const deadline = q.match(/(?:arrive |arrival )?(?:before|by)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/);
  if (deadline) {
    const value = parseDeparture("at " + deadline[1], { base: patch.departure ?? draft.constraints.departure, zone, now });
    if (value.error) throw new DomainError(value.error);
    patch.deadline = value.departure;
  }
  Object.assign(patch,scoped.patch);
  if(Object.keys(scoped.patch).length)patch.mode="flights";
  const refs = positions(input);
  const base = { ...(Object.keys(patch).length ? { patch } : {}), ...(refs.length ? { positions: refs } : {}) };
  if (/\bundo\b/.test(q)) return { op: "undo_draft_edit" };
  if (/\bwhat if\b|\b(?:create|save) (?:a )?scenario\b/.test(q)) return { ...base, op: "branch_scenario", name: input.slice(0, 80) };
  if (/\b(save|watch|monitor) (this|my|the|it|connections)\b/.test(q)) return { op: "prepare_review" };
  const replace = q.match(/\b(?:replace|swap|change)\b.*?\b(bus|train|metro|tram|ferry|walk|flight)\b.*?\b(?:with|to|for)\s+(?:a |the )?(bus|train|metro|tram|ferry|walk|flight)\b/);
  if (replace) return { ...base, op: "replace_leg", legMode: replace[1], replacementMode: replace[2] };
  const lock = q.match(/\b(keep|lock|unlock)\b.*?\b(bus|train|metro|tram|ferry|walk|flight)\b/);
  if (lock) return { ...base, op: "lock_leg", legMode: lock[2], locked: lock[1] !== "unlock" };
  if (/\b(compare|recommend|cheapest|fastest|most reliable)\b/.test(q) && !route && !Object.keys(patch).length) return { ...base, op: "compare_options" };
  if (/\b(choose|select|use|customize|pick)\b/.test(q) && refs.length) return { ...base, op: "select_option" };
  if (Object.keys(patch).length) return { ...base, op: route || /find|search/.test(q) ? "search_options" : "update_constraints" };
  if (/\b(search|find|refresh options)\b/.test(q)) return { op: "search_options" };
  return null;
}

export async function interpretWorkspace(input, draft, set, provider) {
  if(!provider?.available) return workspaceCommand.parse(interpretRules(input,draft) ?? {op:'advice'});
  const {planConversation,compileInstruction}=await import('./conversationPlanner.mjs');
  const plan=await planConversation(input,draft,{hasOptions:!!set},provider);
  if(plan.commands.length!==1) return {op:'clarify'};
  const command=compileInstruction(plan.commands[0],draft);
  // Labeled multi-step execution is provided by the conversation API.
  return command;
}
