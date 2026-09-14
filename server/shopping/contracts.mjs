import { z } from "zod";
import { createHash } from "node:crypto";

export const scales = Object.freeze({ USD:2, CAD:2, EUR:2, GBP:2, JPY:0, KWD:3, BHD:3 });
export const moneySchema = z.object({ amount:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency:z.enum(Object.keys(scales)), scale:z.number().int().min(0).max(3) }).strict()
  .refine(m => scales[m.currency] === m.scale, "Currency scale mismatch");
export function moneyFromDecimal(value, currency) {
  const scale = scales[currency];
  if (scale === undefined || typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value))
    throw Error("Unsupported currency or invalid decimal amount");
  const [whole, fraction=""] = value.split(".");
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) throw Error("Unspecified monetary rounding");
  const amount = Number(BigInt(whole) * 10n ** BigInt(scale) + BigInt((fraction.slice(0,scale).padEnd(scale,"0")) || "0"));
  return moneySchema.parse({amount,currency,scale});
}
export function sumMoney(values) {
  if (!values.length || values.some(v => v === null)) return null;
  const parsed = values.map(v=>moneySchema.parse(v)), first=parsed[0];
  if (parsed.some(v=>v.currency!==first.currency || v.scale!==first.scale)) return null;
  return moneySchema.parse({...first,amount:parsed.reduce((s,v)=>s+v.amount,0)});
}
const id = z.string().min(1).max(160), iso = z.string().datetime({offset:true});
export const place = z.object({id,name:z.string().min(1).max(200),kind:z.enum(["airport","station","address"]),
  lat:z.number().min(-90).max(90),lon:z.number().min(-180).max(180),timezone:z.string().min(1).max(80),
  country:z.literal("US"),iata:z.string().regex(/^[A-Z]{3}$/).optional()}).strict();
const requestPlace=place.partial({lat:true,lon:true}).refine(p=>p.kind==="airport" ? !!p.iata : p.lat!==undefined&&p.lon!==undefined,"Choose an airport code or exact coordinates");
export const passenger = z.object({id,type:z.enum(["adult","child"]),age:z.number().int().min(2).max(120).optional(),
  personal:z.number().int().min(0).max(1).default(0),cabin:z.number().int().min(0).max(2).default(0),
  checked:z.number().int().min(0).max(3).default(0)}).strict().refine(p=>p.type==="adult" || (p.age>=2 && p.age<18),"Children need their age");
export const searchRequest = z.object({
  origin:requestPlace,destination:requestPlace,departure:iso,latestDeparture:iso,deadline:iso.optional(),
  returnDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  additionalSlices:z.array(z.object({origin:requestPlace,destination:requestPlace,departure:iso,latestDeparture:iso}).strict()).max(5).default([]),
  passengers:z.array(passenger).min(1).max(9),
  currency:z.enum(Object.keys(scales)).default("USD"),
  budget:moneySchema.nullable().default(null),emergencyCashCap:moneySchema.nullable().default(null),
  maxDurationMinutes:z.number().int().min(1).max(4320).default(1440),
  maxTransfers:z.number().int().min(0).max(4).default(1),maxWalkMinutes:z.number().min(0).max(120).default(30),
  wheelchair:z.boolean().default(false),allowOvernight:z.boolean().default(false),
  allowSeparateTickets:z.boolean().default(false),allowAirportChange:z.boolean().default(false),
  modes:z.array(z.enum(["air","train","bus","metro","walk"])).min(1).default(["air","train","bus","metro","walk"]),
  originAirports:z.array(z.string().regex(/^[A-Z]{3}$/)).max(2).default([]),
  destinationAirports:z.array(z.string().regex(/^[A-Z]{3}$/)).max(2).default([]),
  flexibleDates:z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(3).default([]),
}).strict().superRefine((r,ctx)=>{
  const fail=message=>ctx.addIssue({code:"custom",message});
  if(r.origin.id===r.destination.id)fail("Choose different endpoints");
  if(Date.parse(r.latestDeparture)<Date.parse(r.departure))fail("Invalid departure window");
  if(Date.parse(r.latestDeparture)-Date.parse(r.departure)>3*86400000)fail("Departure window is limited to three days");
  if(r.deadline && Date.parse(r.deadline)<=Date.parse(r.departure))fail("Deadline must follow departure");
  if(new Set(r.passengers.map(p=>p.id)).size!==r.passengers.length)fail("Passenger IDs must be unique");
  if(!r.passengers.some(p=>p.type==="adult"))fail("An adult traveler is required for this pilot");
  if([r.budget,r.emergencyCashCap].some(m=>m && m.currency!==r.currency))fail("Budget currency must match search currency");
  for(const p of [r.origin,r.destination]) { try { new Intl.DateTimeFormat("en",{timeZone:p.timezone}); } catch { fail("Invalid place timezone"); } }
  for(const date of r.flexibleDates) if(!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date)fail("Invalid flexible date");
  if(r.returnDate && r.additionalSlices.length)fail('Choose return or multi-city, not both');
  let prior=r.departure;
  for(const slice of r.additionalSlices){if(slice.origin.id===slice.destination.id||Date.parse(slice.departure)<=Date.parse(prior)||Date.parse(slice.latestDeparture)<Date.parse(slice.departure))fail('Multi-city slices must have distinct endpoints and increasing departures');prior=slice.departure;}
  if(r.returnDate && (!Number.isFinite(Date.parse(r.returnDate)) || r.returnDate<r.departure.slice(0,10)))fail("Return must follow departure");
});
export const observation = z.object({provider:id,providerVersion:id,observedAt:iso,receivedAt:iso}).strict();
export const serviceInstance = z.object({id,provider:id,mode:z.enum(["air","train","bus","metro","walk"]),
  operator:id,marketingOperator:id.optional(),operatingCarrierCode:z.string().regex(/^[A-Z0-9]{2,3}$/).optional(),serviceNumber:id.optional(),serviceDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  origin:place,destination:place,departure:iso,arrival:iso,source:observation}).strict();
export const priceComponent = z.object({id,label:z.string().max(200),money:moneySchema.nullable(),
  kind:z.enum(["live","tariff","estimate","unknown"]),required:z.boolean(),includedIn:id.optional(),
  passengerIds:z.array(id),serviceIds:z.array(id),source:observation,expiresAt:iso.optional()}).strict();
export const offerSchema = z.object({id,provider:id,seller:id,live:z.boolean(),expiresAt:iso,
  services:z.array(serviceInstance).min(1),passengerIds:z.array(id).min(1),components:z.array(priceComponent).min(1),
  ticketGroupId:id,passengerMap:z.record(z.string()).default({}),conditions:z.object({refund:z.enum(["allowed","not-allowed","unknown"]),
    change:z.enum(["allowed","not-allowed","unknown"]),protection:z.enum(["supplier-confirmed","unknown"])}),
  sliceServiceIds:z.array(z.array(id).min(1)).min(1),
  source:observation}).strict();
export const ticketGroupSchema = z.object({id,kind:z.enum(["offer","tariff"]).default("offer"),offerIds:z.array(id),serviceIds:z.array(id).min(1),
  passengerIds:z.array(id).min(1),issuedReferences:z.array(id).default([]),
  protection:z.enum(["supplier-confirmed","unknown"]),indivisible:z.boolean()}).strict().refine(g=>g.kind==="tariff"||g.offerIds.length>0&&g.indivisible,"Supplier offers must preserve indivisible ticket groups");
export function totalPrice(components, now=Date.now()) {
  const parsed=components.map(p=>priceComponent.parse(p));
  const ids=new Map(parsed.map(c=>[c.id,c]));
  if(ids.size!==parsed.length)throw Error("Duplicate price components");
  for(const c of parsed.filter(c=>c.includedIn)) {
    const parent=ids.get(c.includedIn);
    if(!parent || parent.includedIn || parent.id===c.id ||
      !c.passengerIds.every(id=>parent.passengerIds.includes(id)) || !c.serviceIds.every(id=>parent.serviceIds.includes(id)))
      throw Error("Invalid price inclusion scope");
  }
  const billable=parsed.filter(c=>c.required && !c.includedIn);
  const unresolved=parsed.filter(c=>c.required && ((!c.includedIn && c.money===null) || c.kind==="unknown" ||
    (c.expiresAt && Date.parse(c.expiresAt)<=now)));
  const total=unresolved.length ? null : sumMoney(billable.map(c=>c.money));
  const indicative=parsed.some(c=>c.required && c.kind==="estimate");
  return {total,complete:total!==null&&!indicative,indicative,unknownComponents:unresolved.map(c=>c.label)};
}
// Includes all constraints, ages, bag quantities, eligibility and caller scope. No cross-user fare cache.
export const requestKey=(userId,request)=>createHash("sha256").update(JSON.stringify({userId,request:searchRequest.parse(request)})).digest("hex");
export function capabilitySet(supported={}) {
  return Object.fromEntries(["search","refreshOffer","getStatus","getFareConditions","hold","book","cancel","exchange","refund",
    "backgroundShoppingAllowed","priceHistoryAllowed"].map(k=>[k,supported[k]===true]));
}
export function rankCandidates(candidates, request, now=Date.now()) {
  const excluded=[], complete=[], incomplete=[];
  for(const c of candidates) {
    const pricing=totalPrice(c.components,now), start=Date.parse(c.departure), end=Date.parse(c.arrival);
    const date=new Intl.DateTimeFormat("en-CA",{timeZone:c.services.find(s=>s.mode==="air")?.origin.timezone??request.origin.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(start));
    const flexible=request.flexibleDates.includes(date);
    const reason = start<now || (!flexible && (start<Date.parse(request.departure) || start>Date.parse(request.latestDeparture))) ? "Outside departure window"
      : request.deadline && end>Date.parse(request.deadline) ? "After arrival deadline"
      : c.durationMinutes>request.maxDurationMinutes ? "Duration limit"
      : c.transfers>request.maxTransfers ? "Transfer limit" : c.walkMinutes>request.maxWalkMinutes ? "Walking limit"
      : c.services.some(s=>!request.modes.includes(s.mode)) ? "Mode excluded"
      : c.overnight && !request.allowOvernight ? "Overnight travel excluded"
      : request.wheelchair && c.accessible!==true ? "Accessibility unverified"
      : c.separateTickets && !request.allowSeparateTickets ? "Separate tickets excluded"
      : c.airportChange && !request.allowAirportChange ? "Airport change excluded"
      : c.connections.some(x=>x.status==="infeasible") ? "Connection is not feasible"
      : pricing.total && request.budget && pricing.total.currency===request.budget.currency && pricing.total.amount>request.budget.amount ? "Over total budget" : null;
    if(reason) {excluded.push({id:c.id,reason});continue;}
    const result={...c,pricing};
    if(pricing.complete && pricing.total.currency===request.currency && c.live!==false &&
      c.connections.every(x=>x.status==="verified")) complete.push(result);
    else incomplete.push({...result,limitation:pricing.total && pricing.total.currency!==request.currency ? "Currency conversion unavailable" :
      c.live===false ? "Supplier test inventory" : c.connections.some(x=>x.status!=="verified") ? "Connection procedures need verification" :
      pricing.indicative ? "Contains estimates" : "Required prices are incomplete"});
  }
  complete.sort((a,b)=>a.pricing.total.amount-b.pricing.total.amount || a.durationMinutes-b.durationMinutes || a.transfers-b.transfers);
  const fastest=[...complete].sort((a,b)=>a.durationMinutes-b.durationMinutes)[0];
  const resilient=[...complete].sort((a,b)=>a.transfers-b.transfers || (b.minimumSlack??0)-(a.minimumSlack??0))[0];
  return {complete:complete.map((c,i)=>({...c,badges:[...(i===0?["Lowest complete price found"]:[]),
    ...(c.id===fastest?.id?["Fastest"]:[]),...(c.id===resilient?.id?["More connection time"]:[])]})),incomplete,excluded};
}
