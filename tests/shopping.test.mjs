import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { resolve,sep } from "node:path";
import { Store } from "../server/store.mjs";
import { moneyFromDecimal, sumMoney, totalPrice, requestKey, searchRequest, capabilitySet, rankCandidates } from "../server/shopping/contracts.mjs";
import { connectionPolicy,acceptObservation,serviceIdentity,recoveryOrigin } from "../server/shopping/connections.mjs";
import { DuffelAdapter,normalizeDuffelOffer,localInstant,withCardPaymentUncertainty } from "../server/shopping/duffel.mjs";
import { createShoppingSearch,runShoppingQuery,runShoppingConnections,shoppingSearchView,reviewOffer,confirmComparison,cancelShoppingSearch } from "../server/shopping/service.mjs";
import { composeOffer,offerFingerprint } from "../server/shopping/composer.mjs";
import { financialLedger,executeSupplierOperation,reconcileSupplierOperation } from "../server/shopping/operations.mjs";
import { createPriceWatch,sweepPriceWatches,cancelPriceWatch } from "../server/shopping/watches.mjs";
import { recoveryEconomics,ticketFunding } from "../server/domain/recoveryEconomics.mjs";
import { applyBostonTariff,tariff } from "../server/shopping/bostonFares.mjs";
import { runAgentGraph } from "../server/domain/agentGraph.mjs";
import { groundedReply,parseRequest } from "../server/domain/agent.mjs";
import { sampleSearch } from "../server/domain/journeys.mjs";
import { definitions } from "../server/travel/schemas.mjs";
const now=Date.now(),future=new Date(now+7*86400000),date=future.toISOString().slice(0,10);
const p=(iata)=>({id:"arp_"+iata,name:iata,kind:"airport",country:"US",iata,lat:42,lon:-71,timezone:"America/New_York"});
const request=()=>searchRequest.parse({origin:p("BOS"),destination:p("JFK"),departure:date+"T10:00:00Z",latestDeparture:date+"T23:00:00Z",
  passengers:[{id:"adult-1",type:"adult",personal:0,cabin:0,checked:0}],maxTransfers:1});
const airport=iata=>({id:"arp_"+iata,name:iata,iata_code:iata,iata_country_code:"US",latitude:42,longitude:-71,time_zone:"America/New_York"});
const rawOffer=(overrides={})=>({id:"off_test123",owner:{name:"Fixture seller"},live_mode:true,
  expires_at:new Date(now+1800000).toISOString(),total_amount:"80.00",total_currency:"USD",
  slices:[{segments:[{id:"seg_1",origin:airport("BOS"),destination:airport("JFK"),departing_at:date+"T08:00:00",arriving_at:date+"T10:00:00",
    operating_carrier:{name:"Fixture operating carrier"},marketing_carrier:{name:"Fixture marketing carrier"},operating_carrier_flight_number:"123",
    passengers:[{passenger_id:"pas_1",baggages:[{type:"carry_on",quantity:1},{type:"checked",quantity:1}]}]}]}],...overrides});
const offer=(r=request(),raw=rawOffer())=>normalizeDuffelOffer(raw,r,{"pas_1":"adult-1"},now);
const fixture=t=>{
  const directory=mkdtempSync(resolve("tmp/shopping-test-")),store=new Store({directory,production:false});
  t.after(()=>{store.close();assert.ok(resolve(directory).startsWith(resolve("tmp")+ sep));rmSync(directory,{recursive:true,force:true});});
  return {store,user:store.createGuest(),other:store.createGuest()};
};
const caps={configured:true,capabilities:capabilitySet({search:true,backgroundShoppingAllowed:true,priceHistoryAllowed:true})};
const travel={call:async(name,args)=>name==="flight_search"?{offers:[offer(args.request)],fetchedAt:new Date(now).toISOString()}:{offer:args.offer,fetchedAt:new Date().toISOString()}};
test("decimal money preserves JPY and KWD scales without floating-point rounding",()=>{
  assert.deepEqual(moneyFromDecimal("125","JPY"),{amount:125,currency:"JPY",scale:0});
  assert.equal(moneyFromDecimal("1.005","KWD").amount,1005);assert.equal(moneyFromDecimal("0.29","USD").amount,29);
  assert.throws(()=>moneyFromDecimal("1.005","USD"));assert.throws(()=>moneyFromDecimal("99999999999999999","USD"));
  assert.equal(sumMoney([moneyFromDecimal("1","USD"),moneyFromDecimal("1","JPY")]),null);
});
test("party totals and included bag/tax scopes are counted once",()=>{
  const o=offer();const included={...o.components[0],id:"tax",includedIn:o.components[0].id,label:"Included tax",money:moneyFromDecimal("10","USD")};
  assert.equal(totalPrice([...o.components,included]).total.amount,8000);
  assert.throws(()=>totalPrice([...o.components,{...included,includedIn:"missing"}]));
  assert.throws(()=>totalPrice([...o.components,{...included,passengerIds:["other"]}]));
});
test("missing bags cannot win lowest complete price, while included bags add no cost",()=>{
  const r=request();r.passengers[0].checked=2;
  const c=composeOffer(offer(r),r);assert.equal(totalPrice(c.components).total,null);
  const result=rankCandidates([c,composeOffer(offer(),request())],request());
  assert.equal(result.complete.length,1);assert.equal(result.incomplete.length,1);
  const r2=request();r2.passengers[0].cabin=1;assert.equal(totalPrice(offer(r2).components).total.amount,8000);
});
test("all query constraints, passenger ages and bags participate in the user-scoped request key",()=>{
  const r=request(),base=requestKey("one",r);assert.notEqual(base,requestKey("two",r));
  r.passengers[0].checked=1;assert.notEqual(base,requestKey("one",r));
  assert.throws(()=>searchRequest.parse({...r,command:"curl",url:"http://localhost"}));
});
test("supplier local time rejects DST gaps and ambiguous times",()=>{
  assert.throws(()=>localInstant("2026-03-08T02:30:00","America/New_York"));
  assert.throws(()=>localInstant("2026-11-01T01:30:00","America/New_York"));
  assert.equal(localInstant("2026-09-12T08:00:00","America/New_York"),"2026-09-12T12:00:00.000Z");
});
test("MCP flight schemas accept valid dates and reject injected endpoint commands",()=>{
  const value={request:request(),origin:"BOS",destination:"JFK",date};
  assert.equal(definitions.flight_search.input.safeParse(value).success,true);
  assert.equal(definitions.flight_search.input.safeParse({...value,origin:"https://evil.test"}).success,false);
});
test("Duffel request is bounded, fixed-host, and preserves whole party amounts",async()=>{
  let seen;const adapter=new DuffelAdapter({env:{DUFFEL_ACCESS_TOKEN:"fixture",DUFFEL_LIVE_ENABLED:"true"},now:()=>now,
    request:async(url,options,limit)=>{seen={url,options,limit};return Buffer.from(JSON.stringify({data:{passengers:[{id:"pas_1"}],offers:[rawOffer()]}}));}});
  const r=request();const result=await adapter.search({request:r,origin:"BOS",destination:"JFK",date});
  assert.match(seen.url,/^https:\/\/api.duffel.com\/air\/offer_requests/);assert.equal(seen.options.timeoutMs,15000);
  assert.equal(seen.limit,6000000);assert.equal(JSON.parse(seen.options.body).data.passengers.length,1);
  assert.equal(result.offers[0].components[0].money.amount,8000);assert.equal(result.offers[0].services[0].operator,"Fixture operating carrier");
});
test("an unconfigured flight adapter makes no outbound call or fake offer",async()=>{
  let calls=0;const adapter=new DuffelAdapter({env:{},request:()=>{calls++;}});
  await assert.rejects(()=>adapter.search({request:request(),origin:"BOS",destination:"JFK",date}),/not configured/);assert.equal(calls,0);
});
test("mixed valid and invalid supplier offers retain only valid offers",async()=>{
  const adapter=new DuffelAdapter({env:{DUFFEL_ACCESS_TOKEN:"fixture",DUFFEL_LIVE_ENABLED:"true"},now:()=>now,
    request:async()=>Buffer.from(JSON.stringify({data:{passengers:[{id:"pas_1"}],offers:[rawOffer(),rawOffer({total_amount:"-10"}),rawOffer({expires_at:"2000-01-01T00:00:00Z"})]}}))});
  const result=await adapter.search({request:request(),origin:"BOS",destination:"JFK",date});
  assert.equal(result.offers.length,1);assert.equal(result.rejected.length,2);
});
test("round-trip offers keep the entire group price rather than pricing two sliced tickets",()=>{
  const r=request();r.returnDate=new Date(future.getTime()+86400000).toISOString().slice(0,10);
  const raw=rawOffer();raw.slices.push({segments:[{...raw.slices[0].segments[0],id:"seg_return",origin:airport("JFK"),destination:airport("BOS"),
    departing_at:r.returnDate+"T08:00:00",arriving_at:r.returnDate+"T10:00:00"}]});
  const c=composeOffer(offer(r,raw),r);
  assert.equal(c.ticketGroups.length,1);assert.equal(c.ticketGroups[0].serviceIds.length,2);
  assert.equal(totalPrice(c.components).total.amount,8000);
});
test("airport connection minimum is not double counted with procedures",()=>{
  const c=connectionPolicy({kind:"ground-air",availableMinutes:120,supplierMinimum:100,components:[
    {name:"Check-in and bag drop",minutes:40,evidence:"verified"},{name:"Security and boarding",minutes:50,evidence:"verified"}]});
  assert.equal(c.requiredMinutes,100);assert.equal(c.slackMinutes,20);assert.equal(c.status,"verified");
  assert.equal(connectionPolicy({kind:"through-air",availableMinutes:120,components:[]}).status,"unverified");
  assert.equal(connectionPolicy({kind:"self-transfer",availableMinutes:120,components:[]}).status,"infeasible");
});
test("missing airport access cannot produce a complete door price",()=>{
  const r=request();r.origin={...r.origin,kind:"station",id:"station",name:"South Station"};
  const c=composeOffer(offer(r),r);assert.equal(totalPrice(c.components).total,null);
  assert.ok(c.connections.some(c=>c.status==="unverified"));
});
for(const [name,override] of [
  ["budget",{budget:{amount:5000,currency:"USD",scale:2}}],["deadline",{deadline:date+"T13:00:00Z"}],
  ["duration",{maxDurationMinutes:60}],["accessibility",{wheelchair:true}],["mode",{modes:["train"]}],
])test("hard "+name+" constraint is enforced before price ranking",()=>{
  const r={...request(),...override};assert.equal(rankCandidates([composeOffer(offer(),request())],r).complete.length,0);
});
test("observations match service identity and ignore stale, duplicate or out-of-order events",()=>{
  const service=offer().services[0],event={serviceKey:serviceIdentity(service),observedAt:new Date(now).toISOString(),receivedAt:new Date(now).toISOString(),status:"cancelled"};
  assert.equal(acceptObservation(service,null,event,now).accepted,true);
  assert.equal(acceptObservation(service,event,event,now).accepted,false);
  assert.equal(acceptObservation(service,null,{...event,serviceKey:"other-date"},now).accepted,false);
  assert.equal(acceptObservation(service,null,{...event,observedAt:new Date(now-180000).toISOString()},now).accepted,false);
  assert.equal(recoveryOrigin({delayMinutes:30}).status,"location-required");
});
test("recovery cash remains separate from paid spending, later refunds and applicable credits",()=>{
  const j={price:{totalCents:10000,currency:"USD"}},a={price:{totalCents:8000,currency:"USD"}};
  const c=recoveryEconomics(j,a,10000,{confirmedPendingRefundCents:5000});
  assert.equal(c.cashRequiredNowCents,8000);assert.equal(c.totalSpentCents,18000);assert.equal(c.projectedSpendAfterRefundCents,13000);
  const credit=recoveryEconomics(j,a,10000,{applicableCreditCents:2000});
  assert.equal(credit.cashRequiredNowCents,6000);assert.equal(credit.usedCreditCents,2000);
});
test("all linked ticket payments count and incomplete or mixed currency history stays unknown",()=>{
  const tickets=[{journeyId:"j",paidCents:4000},{journeyId:"j",paidCents:6000},{journeyId:"other",paidCents:10000}];
  assert.equal(ticketFunding(tickets,"j").originalPaidCents,10000);
  assert.equal(ticketFunding([...tickets,{journeyId:"j",paidCents:null}],"j").originalPaidCents,null);
  assert.equal(ticketFunding([{journeyId:"j",paidCents:300,currency:"JPY"}],"j").originalPaidCents,null);
});
test("ledger deduplicates event IDs and disallows the same refund both pending and received",()=>{
  const p={id:"p",ticketGroupId:"g",passengerIds:["a"],type:"paid",amount:moneyFromDecimal("100","USD"),supplierReference:"charge"};
  assert.equal(financialLedger([p,p]).paid.amount,10000);
  const refund={...p,id:"r",type:"refund-pending",amount:moneyFromDecimal("50","USD"),supplierReference:"refund",relatedPaymentId:"p"};
  assert.equal(financialLedger([p,refund])["refund-pending"].amount,5000);
  assert.throws(()=>financialLedger([p,refund,{...refund,id:"r2",type:"refund-received"}]));
});
test("published Boston tariff prices a supported ride for the whole party, never unsupported modes",()=>{
  const j={departure:"2026-09-14T12:00:00Z",price:{totalCents:null},legs:[{mode:"metro",routeId:"Red",agency:"mbta"}]};
  assert.equal(applyBostonTariff(j,{travelers:3},Date.parse("2026-09-12")).price.totalCents,720);
  assert.equal(applyBostonTariff({...j,legs:[{mode:"train",routeId:"CR-Worcester",agency:"mbta"}]},{travelers:1},Date.parse("2026-09-12")).price.totalCents,null);
  assert.equal(applyBostonTariff(j,{travelers:1},Date.parse("2027-01-01")).price.totalCents,null);
  assert.match(tariff.sha256,/^[a-f0-9]{64}$/);
});
test("queued search → private MCP → review → repeat confirmation preserves ownership and one record",async t=>{
  const {store,user,other}=fixture(t),s=createShoppingSearch(store,user.id,request(),{capabilities:caps,key:"search"});
  await runShoppingQuery(store,travel,{userId:user.id,searchId:s.id,index:0});
  const done=store.get(user.id,s.id,"shopping-search");assert.equal(done.state,"complete");assert.equal(done.results.complete.length,1);
  await assert.rejects(()=>reviewOffer(store,other.id,s.id,done.offers[0].id,travel),/not found/);
  const review=await reviewOffer(store,user.id,s.id,done.offers[0].id,travel);
  const [a,b]=await Promise.all([confirmComparison(store,user.id,review.id,travel),confirmComparison(store,user.id,review.id,travel)]);
  assert.equal(a.id,b.id);assert.equal(store.list(user.id,"travel-comparison").length,1);assert.equal(a.bookingConfirmed,false);
});
test("cancelled or erased searches suppress late provider results",async t=>{
  const {store,user}=fixture(t),s=createShoppingSearch(store,user.id,request(),{capabilities:caps});
  let release;const waiting={call:()=>new Promise(r=>{release=r;})};
  const pending=runShoppingQuery(store,waiting,{userId:user.id,searchId:s.id,index:0});
  cancelShoppingSearch(store,user.id,s.id,s.version);
  release({offers:[offer()],fetchedAt:new Date().toISOString()});await pending;
  assert.equal(store.get(user.id,s.id,"shopping-search").offers.length,0);
  store.deleteHistory(user.id);assert.equal(store.list(user.id,"shopping-search").length,0);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM jobs WHERE user_id=? AND kind='shopping-query'").get(user.id).n,0);
});
test("search failure remains a failure with no substituted sample inventory",async t=>{
  const {store,user}=fixture(t),s=createShoppingSearch(store,user.id,request(),{capabilities:caps});
  await runShoppingQuery(store,{call:async()=>{throw Error("offline");}},{userId:user.id,searchId:s.id,index:0});
  const done=store.get(user.id,s.id,"shopping-search");assert.equal(done.state,"failed");assert.equal(done.offers.length,0);
});
test("an offer repriced after review requires a new review",async t=>{
  const {store,user}=fixture(t),s=createShoppingSearch(store,user.id,request(),{capabilities:caps});
  await runShoppingQuery(store,travel,{userId:user.id,searchId:s.id,index:0});
  const review=await reviewOffer(store,user.id,s.id,"off_test123",travel);
  const changed=offer(request(),rawOffer({total_amount:"90.00"}));
  assert.notEqual(offerFingerprint(changed),offerFingerprint(review.offer));
  await assert.rejects(()=>confirmComparison(store,user.id,review.id,{call:async()=>({offer:changed})}),/changed|new review/);
  assert.equal(store.list(user.id,"travel-comparison").length,0);
});
test("price watches require consent and explicit supplier rights, dedupe alerts and can be cancelled",async t=>{
  const {store,user}=fixture(t),s=createShoppingSearch(store,user.id,request(),{capabilities:caps});
  const body={searchId:s.id,consent:true,threshold:moneyFromDecimal("100","USD"),expiresAt:new Date(now+86400000).toISOString()};
  assert.throws(()=>createPriceWatch(store,user.id,{...body,consent:false},{capabilities:caps}),/consent/);
  assert.throws(()=>createPriceWatch(store,user.id,body,{capabilities:{capabilities:capabilitySet()}}),/not authorized/);
  // Retired rows must not starve active watches beyond the first sweep page.
  for(let i=0;i<201;i++)store.put(user.id,"price-watch",{state:"cancelled"},{id:"!retired-"+String(i).padStart(3,"0"),expiresAt:now+86400000});
  store.db.prepare("UPDATE records SET updated_at=? WHERE kind='price-watch'").run(now-1000);
  const watch=createPriceWatch(store,user.id,body,{capabilities:caps});
  sweepPriceWatches(store,{capabilities:caps,now:Date.now()+10});
  const updated=store.get(user.id,watch.id,"price-watch");
  await runShoppingQuery(store,travel,{userId:user.id,searchId:updated.activeSearchId,index:0});
  sweepPriceWatches(store,{capabilities:caps,now:now+1000});
  sweepPriceWatches(store,{capabilities:caps,now:now+2000});
  assert.equal(store.list(user.id,"alert").length,1);
  const latest=store.get(user.id,watch.id,"price-watch");
  assert.equal(cancelPriceWatch(store,user.id,watch.id,latest.version).state,"cancelled");
});
test("ambiguous supplier timeouts are reconciled, never blindly purchased again",async t=>{
  const {store,user}=fixture(t);const review=store.put(user.id,"shopping-review",{expiresAt:now+60000,offer:offer()});
  let calls=0;const adapter={capabilities:{book:true},execute:async()=>{calls++;throw Error("timeout");},
    reconcile:async()=>({confirmed:true,paymentCaptured:true,ticketIssued:false})};
  const input={kind:"book",reviewId:review.id,key:"book-once"};
  const first=await executeSupplierOperation(store,user.id,input,adapter);
  await executeSupplierOperation(store,user.id,input,adapter);
  assert.equal(first.state,"reconcile-required");assert.equal(calls,1);
  const reconciled=await reconcileSupplierOperation(store,user.id,first.id,adapter);
  assert.equal(reconciled.paymentState,"captured");assert.equal(reconciled.ticketState,"not-issued");
  assert.equal(reconciled.state,"manual-help");
});
const journey=sampleSearch({from:"sf",to:"oak",departure:"2026-09-13T12:00:00Z"}).journeys[0];
const attacks=["Your airline is Delta Air Lines.","Your ticket is refundable.","Your platform is 99.","The carrier guarantees this connection.","Payment succeeded.","Your bag is included.","The train is cancelled.","You are already on board.","The seat is reserved.","This is the cheapest flight anywhere."];
for(let i=0;i<100;i++)test("AI evidence boundary adversarial case "+(i+1),async()=>{
  const intent=["cost","boarding","delay","refund","connection"][i%5],input="Explain "+intent+"; adversarial case "+i;let calls=0;
  const provider={available:true,model:"fixture",chat:async({jsonSchema})=>{
    calls++;assert.ok(jsonSchema,"Free-form operational rewriting must never be requested");
    return JSON.stringify({intent,unsupported:attacks[i%attacks.length]});}};
  const result=await runAgentGraph({input,journey,preferences:{},provider});
  const expected=groundedReply(intent,{journey,preferences:{},parsed:parseRequest(input)});
  assert.equal(result.reply,expected.reply);assert.equal(calls,1);
});

test("group-scoped ticket payments are counted once and conflicts remain unknown",()=>{
  const rows=[{id:"a",journeyId:"j",paidCents:10000,paymentScope:"group",paymentGroupId:"group1"},
    {id:"b",journeyId:"j",paidCents:10000,paymentScope:"group",paymentGroupId:"group1"}];
  assert.equal(ticketFunding(rows,"j").originalPaidCents,10000);
  assert.equal(ticketFunding([rows[0],{...rows[1],paidCents:9000}],"j").originalPaidCents,null);
});
test("a changed passenger scope cannot become a valid supplier offer",()=>{
  const r=request();r.passengers.push({...r.passengers[0],id:"adult-2"});
  assert.throws(()=>offer(r),/passenger scope/);
});
test("connector composition includes timed ground fares exactly once and preserves ticket boundaries",async()=>{
  const {flightGroundConnections}=await import("../server/shopping/groundConnections.mjs");
  const r=request();r.origin={...p("BOS"),kind:"station",id:"south",name:"South Station"};r.departure=date+"T08:00:00Z";
  const o=offer(r),mock={call:async()=>({cache:"fresh",fetchedAt:new Date().toISOString(),journeys:[{
    from:"South Station",to:"Boston Logan",departure:date+"T08:15:00Z",arrival:date+"T08:45:00Z",
    price:{totalCents:240},durationMinutes:30,walkMinutes:5,transfers:0,
    legs:[{id:"ground",mode:"metro",operator:"MBTA",from:"South Station",to:"Airport",fromCoords:[-71.05,42.35],toCoords:[-71.01,42.36],departure:date+"T08:15:00Z",arrival:date+"T08:45:00Z"}]}]})};
  const connectors=await flightGroundConnections(o,r,mock),c=composeOffer(o,r,connectors);
  assert.equal(totalPrice(c.components).total.amount,8240);
  assert.equal(c.services[0].operator,"MBTA");assert.equal(c.ticketGroups.length,2);assert.equal(c.ticketGroups[0].indivisible,true);assert.equal(c.ticketGroups[1].serviceIds[0],c.services[0].id);
  assert.equal(c.connections[0].status,"unverified");
});
test("shopping HTTP endpoints enforce CSRF and ownership, and never enable transactions",async t=>{
  const {createApplication}=await import("../server/server.mjs");
  const {store}=fixture(t),app=createApplication({store,travel:{...travel,close:async()=>{}},quiet:true});
  await new Promise(resolve=>app.server.listen(0,"127.0.0.1",resolve));
  try {
    const base="http://127.0.0.1:"+app.server.address().port;
    const boot=await fetch(base+"/api/bootstrap"),user=await boot.json(),cookie=boot.headers.get("set-cookie").split(";")[0];
    const post=(path,body,csrf=user.csrf)=>fetch(base+"/api/shopping"+path,{method:"POST",headers:{cookie,"content-type":"application/json","x-csrf-token":csrf},body:JSON.stringify(body)});
    assert.equal((await post("/searches",{request:request()},"wrong")).status,403);
    const created=await post("/searches",{request:request()}),search=await created.json();assert.equal(created.status,202);
    const other=await fetch(base+"/api/bootstrap"),otherCookie=other.headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(base+"/api/shopping/searches/"+search.id,{headers:{cookie:otherCookie}})).status,404);
    assert.equal((await post("/operations",{kind:"book"})).status,501);
  } finally {await app.stopBackgroundJobs();await new Promise(resolve=>app.server.close(resolve));}
});

test("operational graph tracing remains private even when global LangSmith tracing is enabled",async()=>{
  const {getCurrentRunTree}=await import("langsmith/traceable");
  const previous=process.env.LANGSMITH_TRACING;process.env.LANGSMITH_TRACING="true";
  const originalFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response("{}",{status:200});};
  try {
    const provider={available:true,model:"private-fixture",chat:async()=>{
      assert.equal(getCurrentRunTree().tracingEnabled,false);return '{"intent":"cost"}';
    }};
    await runAgentGraph({input:"cost",journey,preferences:{},provider});
    assert.equal(calls,0,"No trace payload may be transmitted");
  } finally {globalThis.fetch=originalFetch;if(previous===undefined)delete process.env.LANGSMITH_TRACING;else process.env.LANGSMITH_TRACING=previous;}
});

test("durable ground shopping composes transport costs, ticket groups and airport wait before comparison",async t=>{
 const f=fixture(t),r=searchRequest.parse({...request(),origin:{id:'station:fixture',name:'Boston center',kind:'station',country:'US',timezone:'America/New_York',lat:42.33,lon:-71.06},originAirports:['BOS'],allowSeparateTickets:true,departure:date+'T08:00:00Z'});
 const flight=offer(r),search=createShoppingSearch(f.store,f.user.id,r,{capabilities:caps});
 const travel={call:async name=>name==='flight_search'?{offers:[flight],fetchedAt:new Date().toISOString()}:{cache:'fresh',fetchedAt:new Date().toISOString(),journeys:[{id:'ground-fixture',from:'Boston center',to:'BOS',departure:date+'T08:00:00Z',arrival:date+'T08:30:00Z',durationMinutes:30,walkMinutes:5,transfers:0,price:{totalCents:400},legs:[{id:'bus',mode:'bus',operator:'Fixture bus',from:'Boston center',to:'BOS',fromCoords:[-71.06,42.33],toCoords:[-71,42],departure:date+'T08:00:00Z',arrival:date+'T08:30:00Z'}]}]}};
 await runShoppingQuery(f.store,travel,{userId:f.user.id,searchId:search.id,index:0});
 assert.equal(f.store.get(f.user.id,search.id).state,'partial');
 await runShoppingConnections(f.store,travel,{userId:f.user.id,searchId:search.id,offerId:flight.id});
 const result=shoppingSearchView(f.store,f.user.id,search.id),candidate=result.results.incomplete[0];
 assert.equal(result.state,'complete');assert.equal(candidate.ticketGroups.length,2);assert.equal(candidate.separateTickets,true);
 assert.equal(candidate.components.find(c=>c.label.startsWith('Outbound access')).money.amount,400);
 assert.equal(candidate.durationMinutes,360);assert.equal(candidate.connections[0].status,'unverified');
 const count=result.connectionQueries.length;await runShoppingConnections(f.store,travel,{userId:f.user.id,searchId:search.id,offerId:flight.id});assert.equal(shoppingSearchView(f.store,f.user.id,search.id).connectionQueries.length,count);
});

test('unquoted card surcharges cannot establish a complete or cheapest supplier price',()=>{const o=withCardPaymentUncertainty(offer()),r=compareForCard(o);assert.equal(totalPrice(o.components).complete,false);assert.equal(r.complete.length,0);assert.ok(r.incomplete[0].pricing.unknownComponents.some(s=>s.includes('Card payment')));});
function compareForCard(o){return rankCandidates([composeOffer(o,request())],request());}
