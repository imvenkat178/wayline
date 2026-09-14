import { createHash } from "node:crypto";
import { offerSchema, rankCandidates, totalPrice } from "./contracts.mjs";
import { connectionPolicy, serviceIdentity } from "./connections.mjs";

export function composeOffer(value, request, connectors={}) {
  const offer=offerSchema.parse(value), outbound=offer.services.filter(s=>offer.sliceServiceIds[0].includes(s.id));
  const components=[...offer.components],services=[...offer.services],connections=[];
  let walkMinutes=0,groundTransfers=0;const groundTicketGroups=[];
  const attach=(name,endpoint,airport,part)=>{
    if(endpoint.kind==="airport"&&endpoint.iata===airport.iata)return;
    const connector=connectors[name];
    if(!connector) {
      components.push({id:offer.id+":"+name,label:name+" transport to "+endpoint.name,money:null,
        kind:"unknown",required:true,passengerIds:offer.passengerIds,serviceIds:[],source:offer.source});
      connections.push({status:"unverified",reason:name+" transport and airport procedures need verification"});
      return;
    }
    components.push(...connector.components);
    services.push(...connector.services);
    walkMinutes+=connector.walkMinutes;
    const ticketed=connector.services.filter(s=>s.mode!=="walk");
    if(ticketed.length)groundTicketGroups.push(...(connector.ticketGroups??[{id:offer.id+":"+name,kind:"tariff",offerIds:[],serviceIds:ticketed.map(s=>s.id),passengerIds:offer.passengerIds,indivisible:false,issuedReferences:[],protection:"unknown"}]));
    groundTransfers+=connector.transfers+1;
    connections.push(connectionPolicy({kind:part==="access"?"ground-air":"air-ground",
      availableMinutes:connector.availableMinutes,supplierMinimum:connector.supplierMinimum??null,
      components:connector.procedures??[{name:"Airport procedures",minutes:null,evidence:"unknown"}]}));
  };
  attach("Outbound access",request.origin,outbound[0].origin,"access");
  attach("Outbound egress",request.destination,outbound.at(-1).destination,"egress");
  if(request.returnDate && offer.sliceServiceIds.length===2) {
    const inbound=offer.services.filter(s=>offer.sliceServiceIds[1].includes(s.id));
    attach("Return access",request.destination,inbound[0].origin,"access");
    attach("Return egress",request.origin,inbound.at(-1).destination,"egress");
  }
  for(let i=0;i<(request.additionalSlices?.length??0);i++){const section=request.additionalSlices[i],legs=offer.sliceServiceIds[i+1].map(id=>offer.services.find(s=>s.id===id));attach(`Section ${i+2} access`,section.origin,legs[0].origin,"access");attach(`Section ${i+2} egress`,section.destination,legs.at(-1).destination,"egress");}
  let transfers=groundTransfers,overnight=false;
  for(const slice of offer.sliceServiceIds) {
    const ss=slice.map(id=>offer.services.find(s=>s.id===id));
    transfers+=ss.length-1;
    for(let i=1;i<ss.length;i++) {
      const changed=ss[i-1].destination.id!==ss[i].origin.id;
      connections.push(connectionPolicy({kind:"through-air",availableMinutes:Math.max(0,(Date.parse(ss[i].departure)-Date.parse(ss[i-1].arrival))/60000),
        supplierMinimum:null,components:[{name:changed?"Airport change transport":"Supplier connection minimum",minutes:null,evidence:"unknown"}]}));
    }
    const firstLocal=new Intl.DateTimeFormat("en-CA",{timeZone:ss[0].origin.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(ss[0].departure));
    const lastLocal=new Intl.DateTimeFormat("en-CA",{timeZone:ss.at(-1).destination.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(ss.at(-1).arrival));
    overnight ||= firstLocal!==lastLocal;
  }
  const first=outbound[0],last=outbound.at(-1);
  return {id:offer.id,offerIds:[offer.id],ticketGroups:[{id:offer.ticketGroupId,offerIds:[offer.id],
    serviceIds:offer.services.map(s=>s.id),passengerIds:offer.passengerIds,indivisible:true,issuedReferences:[],protection:offer.conditions.protection},...groundTicketGroups],
    services:services.sort((a,b)=>Date.parse(a.departure)-Date.parse(b.departure)),components,connections,departure:connectors["Outbound access"]?.departure??first.departure,
    arrival:request.additionalSlices?.length?(connectors[`Section ${offer.sliceServiceIds.length} egress`]?.arrival??offer.services.at(-1).arrival):connectors["Outbound egress"]?.arrival??last.arrival,returnArrival:request.returnDate?(connectors["Return egress"]?.arrival??offer.services.at(-1).arrival):null,
    durationMinutes:Math.round(offer.sliceServiceIds.reduce((n,ids,i)=>{const label=i===0?"Outbound":request.returnDate?"Return":`Section ${i+1}`,first=offer.services.find(s=>s.id===ids[0]),last=offer.services.find(s=>s.id===ids.at(-1));return n+(Date.parse(connectors[label+" egress"]?.arrival??last.arrival)-Date.parse(connectors[label+" access"]?.departure??first.departure))/60000;},0)),transfers,walkMinutes,
    accessible:null,overnight,separateTickets:groundTicketGroups.length>0,
    airportChange:offer.sliceServiceIds.some(ids=>ids.some((id,i)=>i>0&&offer.services.find(s=>s.id===ids[i-1]).destination.id!==offer.services.find(s=>s.id===id).origin.id)),
    live:offer.live,expiresAt:offer.expiresAt,conditions:offer.conditions,
    minimumSlack:connections.length?Math.min(...connections.map(c=>c.slackMinutes??0)):0};
}
export function compareOffers(offers,request,now=Date.now(),connectors={}) {
  return rankCandidates(offers.map(offer=>composeOffer(offer,request,connectors[offer.id]??{})),request,now);
}
export function offerFingerprint(offer) {
  // Expiry and observation times alone are not price/itinerary changes.
  return createHash("sha256").update(JSON.stringify({services:offer.services.map(s=>[serviceIdentity(s),s.departure,s.arrival]),
    components:offer.components.map(c=>[c.id,c.money,c.kind,c.includedIn,c.passengerIds,c.serviceIds]),
    conditions:offer.conditions,passengerIds:offer.passengerIds})).digest("hex");
}
export function recoveryChoices(candidates,request,financialPosition,now=Date.now()) {
  const ranked=rankCandidates(candidates,request,now);
  const eligible=ranked.complete.filter(c=>{
    const p=totalPrice(c.components,now).total;
    return !request.emergencyCashCap || (p.currency===request.emergencyCashCap.currency&&p.amount<=request.emergencyCashCap.amount);
  });
  const chosen=[eligible[0],[...eligible].sort((a,b)=>Date.parse(a.arrival)-Date.parse(b.arrival))[0],
    [...eligible].sort((a,b)=>b.minimumSlack-a.minimumSlack)[0]].filter(Boolean);
  return [...new Map(chosen.map(c=>[c.id,c])).values()].map(c=>({...c,financialPosition,inventoryHeld:false,state:"awaiting_review"}));
}
