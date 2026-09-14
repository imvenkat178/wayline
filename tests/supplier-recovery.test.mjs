import test from 'node:test';
import assert from 'node:assert/strict';
import {supplierFixture} from './helpers/supplierFixture.mjs';
import {serviceIdentity} from '../server/shopping/connections.mjs';
import {normalizeDuffelOffer} from '../server/shopping/duffel.mjs';
import {runShoppingQuery} from '../server/shopping/service.mjs';
import {recoveryBookingBinding,recoveryDraftEligible} from '../server/shopping/supplierRecovery.mjs';
test('supplier recovery verifies completed travel, preserves original tickets and separates cash',async t=>{
 const now=Date.now();
 const provider={license:{id:'fixture-license',statusAllowed:true,rawRetentionDays:1},status:async s=>({provider:'flightaware-aeroapi',serviceIdentity:serviceIdentity(s),flightId:'fixture-'+s.id,origin:s.origin.iata,destination:s.destination.iata,scheduledDeparture:s.departure,scheduledArrival:s.arrival,observedAt:new Date().toISOString(),status:Date.parse(s.arrival)<now?'arrived':'cancelled',actualDeparture:Date.parse(s.arrival)<now?s.departure:null,actualArrival:Date.parse(s.arrival)<now?s.arrival:null,gate:null,sourceUrl:'https://www.flightaware.com/live/flight/FIXTURE'})};
 const f=await supplierFixture({after:fn=>t.after(fn),flightStatusProvider:provider}),booked=await f.book();
 let order=f.store.get(f.user.id,booked.orderId,'supplier-order');const first={...order.itinerary.services[0],departure:new Date(now-3*3600000).toISOString(),arrival:new Date(now-2*3600000).toISOString()};
 const second={...first,id:'seg_remaining',origin:first.destination,destination:{...first.destination,id:'arp_LAX',iata:'LAX',name:'Los Angeles',timezone:'America/Los_Angeles'},departure:new Date(now+3*3600000).toISOString(),arrival:new Date(now+6*3600000).toISOString()};
 order=f.store.put(f.user.id,'supplier-order',{...order,itinerary:{...order.itinerary,services:[first,second]}},{id:order.id,expectedVersion:order.version});const before=JSON.stringify(order);
 const input={orderVersion:order.version,completedCount:1,destinationIndex:1,readyAt:new Date(now+3600000).toISOString(),confirmedPosition:true,cashCap:{amount:15000,currency:'USD',scale:2}};
 assert.equal((await f.call('orders/'+order.id+'/recovery',input,f.otherSession)).status,404);
 assert.equal((await f.call('orders/'+order.id+'/recovery',{...input,completedCount:2})).status,400);
 const result=await f.call('orders/'+order.id+'/recovery',input);assert.equal(result.status,201,JSON.stringify(result.value));assert.equal(result.value.completedServices[0].id,first.id);assert.equal(result.value.confirmedPosition.place.iata,'JFK');assert.deepEqual(result.value.originalDocuments,order.documents);
 const search=f.store.get(f.user.id,result.value.searchId,'shopping-search');assert.equal(search.request.origin.iata,'JFK');assert.equal(search.request.destination.iata,'LAX');assert.equal(search.request.budget.amount,15000);
 const raw=structuredClone(f.raw);raw.id='off_recovery';const segment=raw.slices[0].segments[0];segment.id='seg_recovery';segment.origin={...segment.origin,id:'arp_JFK',iata_code:'JFK',name:'JFK'};segment.destination={...segment.destination,id:'arp_LAX',iata_code:'LAX',name:'Los Angeles',time_zone:'America/Los_Angeles'};segment.departing_at=new Date(now+2*3600000).toISOString();segment.arriving_at=new Date(now+5*3600000).toISOString();
 const offer=normalizeDuffelOffer(raw,search.request,{pas_fixture:'adult-1'});
 await runShoppingQuery(f.store,{call:async()=>({offers:[offer],fetchedAt:new Date().toISOString()})},{userId:f.user.id,searchId:search.id,index:0});
 const view=await f.call('recoveries/'+result.value.id);assert.equal(view.status,200);assert.equal(view.value.options.length,1);assert.equal(view.value.options[0].cashRequiredNow.amount,10010);assert.equal(view.value.options[0].previousSpending.amount,10215);assert.equal(view.value.options[0].refundsPending.amount,0);assert.equal(JSON.stringify(f.store.get(f.user.id,order.id,'supplier-order')),before);
 const draft=await f.call('recoveries/'+result.value.id+'/draft',{candidateId:offer.id});assert.equal(draft.status,201,JSON.stringify(draft.value));assert.equal(draft.value.draft.constraints.from,'JFK');assert.equal(draft.value.draft.selected.flight.id,offer.id);
 const binding=recoveryBookingBinding(f.store,f.user.id,draft.value.conversation,draft.value.draft.selected.flight);assert.equal(binding.completedServices[0].id,first.id);assert.equal(binding.originalOrderId,order.id);
 const duplicate=await f.call('recoveries/'+result.value.id+'/draft',{candidateId:offer.id});assert.equal(duplicate.value.conversation.id,draft.value.conversation.id);
 f.store.put(f.user.id,'supplier-order',{...order,paymentState:'refund-pending'},{id:order.id,expectedVersion:order.version});
 assert.equal((await f.call('recoveries/'+result.value.id)).status,409);assert.throws(()=>recoveryBookingBinding(f.store,f.user.id,draft.value.conversation,draft.value.draft.selected.flight),{status:409});assert.equal(f.state.submitted,1);
});
test('supplier recovery stays gated without licensed status and never infers arrival',async t=>{
 const f=await supplierFixture(t),booked=await f.book(),order=f.store.get(f.user.id,booked.orderId,'supplier-order');
 const result=await f.call('orders/'+order.id+'/recovery',{orderVersion:order.version,completedCount:0,destinationIndex:0,readyAt:new Date(Date.now()+3600000).toISOString(),confirmedPosition:true});
 assert.equal(result.status,503);assert.equal(result.value.code,'FLIGHT_STATUS_UNAVAILABLE');assert.equal(f.store.list(f.user.id,'supplier-recovery').length,0);
});

test('a recovery draft can obtain a protected card quote but cannot bypass unresolved travel costs',()=>{
 const component={id:'fare',label:'Fare',money:{amount:10000,currency:'USD',scale:2},kind:'live',required:true,passengerIds:['p'],serviceIds:['s'],source:{provider:'duffel',observedAt:new Date().toISOString(),receivedAt:new Date().toISOString(),providerVersion:'v2'}};
 const candidate={live:true,connections:[],components:[component,{...component,id:'off:payment-fee',label:'Card payment surcharge (requires a protected card quote)',money:null,kind:'unknown'}]};
 assert.equal(recoveryDraftEligible(candidate),true);
 assert.equal(recoveryDraftEligible({...candidate,components:[...candidate.components,{...component,id:'bag',label:'Bag',kind:'unknown',money:null}]}),false);
 assert.equal(recoveryDraftEligible({...candidate,connections:[{status:'unverified'}]}),false);
});
