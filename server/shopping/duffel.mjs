import { z } from "zod";
import { fetchBounded } from "../adapters/providers.mjs";
import { DomainError } from "../domain/journeys.mjs";
import { capabilitySet, moneyFromDecimal, offerSchema, searchRequest } from "./contracts.mjs";

let active=0;
let lastSuccess=null;
export function duffelCapabilities(env=process.env) {
  const configured=!!env.DUFFEL_ACCESS_TOKEN && env.ENABLE_EXTERNAL_FEEDS!=="false";
  return {provider:"duffel",configured,mode:env.DUFFEL_LIVE_ENABLED==="true"?"live-enabled":"test-only",
    lastSuccess,coverage:"Supplier-returned domestic US economy offers; no inventory guarantee",
    reason:configured?"Search is configured. Live access is verified by returned offers.":"Approved Duffel access is not configured.",
    capabilities:capabilitySet({search:configured,refreshOffer:configured,getFareConditions:configured,
      backgroundShoppingAllowed:configured&&env.DUFFEL_BACKGROUND_SHOPPING_ALLOWED==="true",
      priceHistoryAllowed:configured&&env.DUFFEL_PRICE_HISTORY_ALLOWED==="true"})};
}
export function localDate(instant,timezone) {
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(instant)).map(p=>[p.type,p.value]));
  return p.year+"-"+p.month+"-"+p.day;
}
export function localInstant(value,timezone) {
  if(/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    if(!Number.isFinite(Date.parse(value)))throw Error("Invalid time");
    return new Date(value).toISOString();
  }
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value))throw Error("Invalid local time");
  const target=Date.parse(value+"Z");
  const fmt=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  const wall=ms=>{const p=Object.fromEntries(fmt.formatToParts(ms).map(p=>[p.type,p.value]));
    return Date.parse(p.year+"-"+p.month+"-"+p.day+"T"+p.hour+":"+p.minute+":"+p.second+"Z");};
  const candidates=[...new Set([-36,0,36].map(h=>{const probe=target+h*3600000;return target-(wall(probe)-probe);}))].filter(ms=>wall(ms)===target);
  if(candidates.length!==1)throw Error("Ambiguous or nonexistent supplier local time");
  return new Date(candidates[0]).toISOString();
}
const rawPlace=z.object({id:z.string(),name:z.string(),iata_code:z.string().regex(/^[A-Z]{3}$/),
  iata_country_code:z.literal("US"),time_zone:z.string(),latitude:z.coerce.number(),longitude:z.coerce.number()});
const rawSegment=z.object({id:z.string(),origin:rawPlace,destination:rawPlace,departing_at:z.string(),arriving_at:z.string(),
  operating_carrier:z.object({name:z.string(),iata_code:z.string().optional()}),marketing_carrier:z.object({name:z.string()}),
  operating_carrier_flight_number:z.string(),passengers:z.array(z.object({passenger_id:z.string(),
    baggages:z.array(z.object({type:z.string(),quantity:z.number().int().nonnegative()})).optional()}))});
const rawOffer=z.object({id:z.string().regex(/^off_[a-zA-Z0-9]+$/),owner:z.object({name:z.string()}),
  live_mode:z.boolean(),expires_at:z.string().datetime({offset:true}),total_amount:z.string(),total_currency:z.string(),
  slices:z.array(z.object({segments:z.array(rawSegment).min(1)})).min(1).max(6),
  conditions:z.object({refund_before_departure:z.object({allowed:z.boolean()}).nullable().optional(),
    change_before_departure:z.object({allowed:z.boolean()}).nullable().optional()}).optional()});
export function normalizeDuffelOffer(raw,request,passengerMap,now=Date.now()) {
  const r=rawOffer.parse(raw);
  if(Date.parse(r.expires_at)<=now)throw Error("Expired offer");
  if(r.slices.length!==(request.returnDate?2:1+(request.additionalSlices?.length??0)))throw Error("Incomplete ticket group");
  for(let i=1;i<(request.additionalSlices?.length??0)+1;i++) {
    const expected=request.additionalSlices[i-1],actual=r.slices[i];
    if(actual.segments[0].origin.iata_code!==expected.origin.iata||actual.segments.at(-1).destination.iata_code!==expected.destination.iata||actual.segments[0].departing_at.slice(0,10)!==localDate(expected.departure,expected.origin.timezone))throw Error('Different multi-city slice');
  }
  const source={provider:"duffel",providerVersion:"v2",observedAt:new Date(now).toISOString(),receivedAt:new Date(now).toISOString()};
  const endpoint=p=>({id:p.id,name:p.name,kind:"airport",lat:p.latitude,lon:p.longitude,
    timezone:p.time_zone,country:"US",iata:p.iata_code});
  const rawServices=r.slices.flatMap(s=>s.segments);
  const mapped=Object.values(passengerMap);
  if(mapped.length!==request.passengers.length || new Set(mapped).size!==mapped.length || !request.passengers.every(p=>mapped.includes(p.id)) || rawServices.some(s=>s.passengers.length!==mapped.length || new Set(s.passengers.map(p=>p.passenger_id)).size!==mapped.length || !s.passengers.every(p=>Object.hasOwn(passengerMap,p.passenger_id)))) throw Error("Invalid passenger scope");
  const services=rawServices.map(s=>({id:s.id,provider:"duffel",mode:"air",operator:s.operating_carrier.name,
    marketingOperator:s.marketing_carrier.name,...(s.operating_carrier.iata_code?{operatingCarrierCode:s.operating_carrier.iata_code}:{}),serviceNumber:s.operating_carrier_flight_number,
    serviceDate:s.departing_at.slice(0,10),origin:endpoint(s.origin),destination:endpoint(s.destination),
    departure:localInstant(s.departing_at,s.origin.time_zone),arrival:localInstant(s.arriving_at,s.destination.time_zone),source}));
  if(services.some(s=>Date.parse(s.arrival)<=Date.parse(s.departure)))throw Error("Invalid segment time");
  for(const slice of r.slices) for(let i=1;i<slice.segments.length;i++) {
    const before=services.find(s=>s.id===slice.segments[i-1].id),after=services.find(s=>s.id===slice.segments[i].id);
    if(Date.parse(after.departure)<Date.parse(before.arrival))throw Error("Overlapping service instances");
  }
  for(let i=1;i<r.slices.length;i++) {
    const previous=services.find(s=>s.id===r.slices[i-1].segments.at(-1).id),next=services.find(s=>s.id===r.slices[i].segments[0].id);
    if(Date.parse(next.departure)<=Date.parse(previous.arrival))throw Error('Flight sections overlap');
    const expected=request.additionalSlices?.[i-1];
    if(expected&&(Date.parse(next.departure)<Date.parse(expected.departure)||Date.parse(next.departure)>Date.parse(expected.latestDeparture)))throw Error('Multi-city departure outside its window');
  }
  if(r.slices.length===2 && Date.parse(services.find(s=>s.id===r.slices[1].segments[0].id).departure)<=Date.parse(services.find(s=>s.id===r.slices[0].segments.at(-1).id).arrival))throw Error("Return precedes outbound arrival");
  const passengerIds=request.passengers.map(p=>p.id), serviceIds=services.map(s=>s.id);
  const components=[{id:r.id+":fare",label:"Supplier fare for the entire party, including taxes",
    money:moneyFromDecimal(r.total_amount,r.total_currency),kind:r.live_mode?"live":"estimate",required:true,
    passengerIds,serviceIds,source,expiresAt:r.expires_at}];
  for(const person of request.passengers) for(const category of ["personal","cabin","checked"]) {
    if(!person[category])continue;
    const supplierId=Object.keys(passengerMap).find(id=>passengerMap[id]===person.id);
    const included=category!=="personal" && rawServices.every(s=>{
      const p=s.passengers.find(p=>p.passenger_id===supplierId);
      return p?.baggages?.some(b=>b.type===(category==="cabin"?"carry_on":"checked")&&b.quantity>=person[category]);
    });
    components.push({id:r.id+":"+person.id+":"+category,label:category+" baggage for "+person.id,
      money:included?moneyFromDecimal("0",r.total_currency):null,kind:included?(r.live_mode?"live":"estimate"):"unknown",
      required:true,...(included?{includedIn:r.id+":fare"}:{}),passengerIds:[person.id],serviceIds,source,expiresAt:r.expires_at});
  }
  const condition=x=>x?.allowed===true?"allowed":x?.allowed===false?"not-allowed":"unknown";
  return offerSchema.parse({id:r.id,provider:"duffel",seller:r.owner.name,live:r.live_mode,expiresAt:r.expires_at,
    services,passengerIds,components,ticketGroupId:"duffel:"+r.id,passengerMap,
    sliceServiceIds:r.slices.map(s=>s.segments.map(s=>s.id)),
    conditions:{refund:condition(r.conditions?.refund_before_departure),change:condition(r.conditions?.change_before_departure),protection:"unknown"},source});
}
export function withCardPaymentUncertainty(offer) {
 return offerSchema.parse({...offer,components:[...offer.components,{id:offer.id+':payment-fee',label:'Card payment surcharge (requires a protected card quote)',money:null,kind:'unknown',required:true,passengerIds:offer.passengerIds,serviceIds:offer.services.map(s=>s.id),source:offer.source,expiresAt:offer.expiresAt}]});
}
export class DuffelAdapter {
  constructor({env=process.env,request=fetchBounded,now=()=>Date.now()}={}) {this.env=env;this.request=request;this.now=now;}
  async call(path,method="GET",data) {
    if(!duffelCapabilities(this.env).configured)throw new DomainError("Approved flight-shopping access is not configured.",503,"SUPPLIER_REQUIRED");
    if(active>=2)throw new DomainError("Flight search is busy. Retry shortly.",429,"SUPPLIER_BUSY");
    active++;
    try {
      const bytes=await this.request("https://api.duffel.com/air/"+path,{method,timeoutMs:15000,
        headers:{"Content-Type":"application/json","Duffel-Version":"v2",Authorization:"Bearer "+this.env.DUFFEL_ACCESS_TOKEN},
        ...(data?{body:JSON.stringify({data})}:{})},6000000);
      const response=JSON.parse(bytes.toString());
      lastSuccess=new Date(this.now()).toISOString();
      return response.data;
    } catch(e) {
      if(e.code==="SUPPLIER_REQUIRED"||e.code==="SUPPLIER_BUSY")throw e;
      throw new DomainError("Flight provider could not complete this request. Try again; no ticket was purchased.",503,"FLIGHT_PROVIDER_UNAVAILABLE");
    } finally {active--;}
  }
  async search(input) {
    const request=searchRequest.parse(input.request);
    const origin=z.string().regex(/^[A-Z]{3}$/).parse(input.origin),destination=z.string().regex(/^[A-Z]{3}$/).parse(input.destination);
    if(!(request.origin.kind==="airport"&&request.origin.iata===origin)&&!request.originAirports.includes(origin))throw new DomainError("Origin airport was not selected.");
    if(!(request.destination.kind==="airport"&&request.destination.iata===destination)&&!request.destinationAirports.includes(destination))throw new DomainError("Destination airport was not selected.");
    const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(input.date);
    if(date!==localDate(request.departure,request.origin.timezone)&&!request.flexibleDates.includes(date))throw new DomainError("Travel date was not selected.");
    const slices=[{origin,destination,departure_date:date},...(request.returnDate?[{origin:destination,destination:origin,departure_date:request.returnDate}]:[]),...request.additionalSlices.map(s=>({origin:s.origin.iata,destination:s.destination.iata,departure_date:localDate(s.departure,s.origin.timezone)}))];
    const data=await this.call("offer_requests?return_offers=true&supplier_timeout=10000","POST",{slices,
      passengers:request.passengers.map(p=>p.type==="child"?{age:p.age}:{type:"adult"}),cabin_class:"economy",
      max_connections:Math.min(request.maxTransfers,1)});
    if(!Array.isArray(data?.offers)||!Array.isArray(data.passengers)||data.passengers.length!==request.passengers.length)
      throw new DomainError("Flight provider returned an invalid passenger group.",502,"INVALID_FLIGHT_RESULT");
    const map=Object.fromEntries(data.passengers.map((p,i)=>[p.id,request.passengers[i].id]));
    const offers=[],rejected=[];
    for(const raw of data.offers.slice(0,50)) {
      try {
        const offer=normalizeDuffelOffer(raw,request,map,this.now());
        if(offer.live&&this.env.DUFFEL_LIVE_ENABLED!=="true")throw Error("Live shopping is disabled");
        const first=offer.services[0],outbound=offer.services.find(s=>s.id===offer.sliceServiceIds[0].at(-1));
        if(first.origin.iata!==origin||outbound.destination.iata!==destination||first.serviceDate!==date)throw Error("Different endpoints");
        if(request.returnDate) {
          const returning=offer.services.filter(s=>offer.sliceServiceIds[1].includes(s.id));
          if(returning[0].origin.iata!==destination||returning.at(-1).destination.iata!==origin||returning[0].serviceDate!==request.returnDate)throw Error("Different return scope");
        }
        offers.push(withCardPaymentUncertainty(offer));
      } catch {rejected.push("Offer omitted: invalid, expired, unsupported, or outside the enabled inventory mode.");}
    }
    return {offers,rejected,source:"Duffel",fetchedAt:new Date(this.now()).toISOString(),
      scope:{origin,destination,date,returnDate:request.returnDate??null,received:data.offers.length,examined:Math.min(data.offers.length,50)}};
  }
  async refresh({offer,request}) {
    const prior=offerSchema.parse(offer), r=searchRequest.parse(request);
    const raw=await this.call("offers/"+encodeURIComponent(prior.id)+"?return_available_services=true");
    const refreshed=normalizeDuffelOffer(raw,r,prior.passengerMap,this.now());
    if(refreshed.id!==prior.id||refreshed.live&&this.env.DUFFEL_LIVE_ENABLED!=="true")throw new DomainError("Offer changed outside enabled scope.",409);
    return {offer:withCardPaymentUncertainty(refreshed),source:"Duffel",fetchedAt:new Date(this.now()).toISOString()};
  }
}
