import { localInstant } from "./duffel.mjs";
import { moneyFromDecimal } from "./contracts.mjs";
// Local connections are searched at the flight's time. Airport procedure durations remain
// explicitly unverified until an authorized operator supplies terminal/check-in/bag-drop rules.
export async function flightGroundConnections(offer,request,travel) {
  const outbound=offer.sliceServiceIds[0].map(id=>offer.services.find(s=>s.id===id));
  const pairs=[
    {name:"Outbound access",point:request.origin,flight:outbound[0],access:true},
    {name:"Outbound egress",point:request.destination,flight:outbound.at(-1),access:false},
  ];
  if(request.returnDate && offer.sliceServiceIds.length===2) {
    const inbound=offer.sliceServiceIds[1].map(id=>offer.services.find(s=>s.id===id));
    pairs.push({name:"Return access",point:request.destination,flight:inbound[0],access:true},
      {name:"Return egress",point:request.origin,flight:inbound.at(-1),access:false});
  }
  for(let i=0;i<(request.additionalSlices?.length??0);i++){const section=request.additionalSlices[i],legs=offer.sliceServiceIds[i+1].map(id=>offer.services.find(s=>s.id===id));pairs.push({name:`Section ${i+2} access`,point:section.origin,flight:legs[0],access:true,departure:section.departure},{name:`Section ${i+2} egress`,point:section.destination,flight:legs.at(-1),access:false});}
  const result={};
  for(const pair of pairs) {
    if(pair.point.kind==="airport")continue;
    const hub=pair.access?pair.flight.origin:pair.flight.destination;
    const inBoston=p=>p.lat>=41&&p.lat<=43.5&&p.lon>=-73.6&&p.lon<=-69;
    if(!inBoston(hub)||!inBoston(pair.point))continue;
    const from=pair.access?pair.point:hub,to=pair.access?hub:pair.point;
    const departure=pair.access?(pair.departure??(pair.name.startsWith("Return")?localInstant(request.returnDate+"T00:00:00",pair.point.timezone):request.departure)):new Date(Date.parse(pair.flight.arrival)+90*60000).toISOString();
    const deadline=pair.access?new Date(Date.parse(pair.flight.departure)-120*60000).toISOString():(pair.name.startsWith("Return")?undefined:request.deadline);
    if(deadline&&Date.parse(deadline)<=Date.parse(departure))continue;
    try {
      const response=await travel.call("search",{from,to,departure,...(deadline?{deadline}:{}),
        travelers:request.passengers.length,bags:request.passengers.reduce((n,p)=>n+p.checked+p.cabin,0),
        preferences:{maxWalkMinutes:request.maxWalkMinutes,maxTransfers:request.maxTransfers,wheelchair:request.wheelchair}});
      if(response.cache!=="fresh")continue;
      const journey=response.journeys.filter(j=>Date.parse(j.departure)>=Date.parse(departure)&&
        (!deadline||Date.parse(j.arrival)<=Date.parse(deadline))).sort((a,b)=>
          (a.price.totalCents??Infinity)-(b.price.totalCents??Infinity)||a.durationMinutes-b.durationMinutes)[0];
      if(!journey)continue;
      const source={provider:"otp-mbta",providerVersion:"2.10/MBTA tariff",observedAt:response.fetchedAt,receivedAt:new Date().toISOString()};
      const endpoint=(name,coords)=>({id:"coordinate:"+coords.join(","),kind:"station",name,lon:coords[0],lat:coords[1],country:"US",timezone:"America/New_York"});
      const services=journey.legs.map(leg=>({id:pair.name+":"+leg.id,mode:leg.mode,provider:"otp-mbta",operator:leg.operator??"Walking",
        serviceDate:leg.serviceDate??leg.departure.slice(0,10),origin:endpoint(leg.from,leg.fromCoords),destination:endpoint(leg.to,leg.toCoords),
        departure:leg.departure,arrival:leg.arrival,source}));
      const total=journey.price.totalCents!==null&&request.passengers.every(p=>p.type==="adult")?
        moneyFromDecimal((journey.price.totalCents/100).toFixed(2),"USD"):null;
      result[pair.name]={services,components:[{id:offer.id+":"+pair.name,label:pair.name+" · "+journey.from+" to "+journey.to,
        money:total,kind:total?"tariff":"unknown",required:true,passengerIds:offer.passengerIds,serviceIds:services.map(s=>s.id),source}],
        departure:journey.departure,arrival:journey.arrival,walkMinutes:journey.walkMinutes,durationMinutes:journey.durationMinutes,
        transfers:journey.transfers,availableMinutes:Math.max(0,pair.access?
          (Date.parse(pair.flight.departure)-Date.parse(journey.arrival))/60000:
          (Date.parse(journey.departure)-Date.parse(pair.flight.arrival))/60000),
        procedures:[{name:"Terminal access, check-in, bag drop, security or baggage reclaim",minutes:null,evidence:"unknown"}],
        assumption:pair.access?"Search allows 120 minutes before the flight; operator procedures are unverified.":
          "Search starts 90 minutes after flight arrival; deplaning and baggage procedures are unverified."};
    } catch {/* Keep this connection unpriced; never invent a ground itinerary. */}
  }
  return result;
}
