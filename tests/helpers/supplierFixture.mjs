import {flightItinerary} from '../../server/domain/workspaceFlights.mjs';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {Store} from '../../server/store.mjs';
import {createApplication} from '../../server/server.mjs';
import {createConversation} from '../../server/domain/tripWorkspace.mjs';
import {DuffelBookingAdapter} from '../../server/shopping/duffelBooking.mjs';
import {normalizeDuffelOffer} from '../../server/shopping/duffel.mjs';
import {searchRequest,capabilitySet,totalPrice} from '../../server/shopping/contracts.mjs';
import {composeOffer} from '../../server/shopping/composer.mjs';
import {runBookingOperation} from '../../server/shopping/booking.mjs';
const airport=iata=>({id:'arp_'+iata,name:iata,iata_code:iata,iata_country_code:'US',latitude:42,longitude:-71,time_zone:'America/New_York'});
const point=iata=>({id:'airport:'+iata,name:iata,iata,country:'US',timezone:'America/New_York',kind:'airport'});
function rawOffer({live=false,start=Date.now()+7*86400000}={}){return {id:'off_fixture',owner:{name:'Fixture Air'},live_mode:live,expires_at:new Date(Date.now()+900000).toISOString(),total_amount:'100.10',total_currency:'USD',intended_payment_methods:[{type:'card',card_id:'tcd_fixture',surcharge_amount:'2.05',surcharge_currency:'USD'}],intended_services:[],conditions:{refund_before_departure:{allowed:true},change_before_departure:{allowed:true}},slices:[{id:'sli_original',segments:[{id:'seg_original',origin:airport('BOS'),destination:airport('JFK'),departing_at:new Date(start).toISOString(),arriving_at:new Date(start+3600000).toISOString(),operating_carrier:{name:'Fixture Air',iata_code:'B6'},marketing_carrier:{name:'Fixture Air'},operating_carrier_flight_number:'123',passengers:[{passenger_id:'pas_fixture',baggages:[{type:'carry_on',quantity:1}]}]}]}]};}
export async function supplierFixture(t){

 mkdirSync('tmp',{recursive:true});const directory=mkdtempSync(join(resolve('tmp'),'supplier-http-'));const store=new Store({directory,production:false});
 const user=store.createGuest(),foreign=store.createGuest(),session=store.session(user.id),otherSession=store.session(foreign.id),w=createConversation(store,user.id),raw=rawOffer();
 const request=searchRequest.parse({origin:point('BOS'),destination:point('JFK'),departure:new Date(Date.parse(raw.slices[0].segments[0].departing_at)-3600000).toISOString(),latestDeparture:new Date(Date.parse(raw.slices[0].segments[0].departing_at)+3600000).toISOString(),passengers:[{id:'adult-1',type:'adult',cabin:1}],allowOvernight:true,budget:{amount:50000,currency:'USD',scale:2}});
 const offer=normalizeDuffelOffer(raw,request,{pas_fixture:'adult-1'}),candidate=composeOffer(offer,request),search=store.put(user.id,'shopping-search',{request,offers:[offer],state:'complete'}),set=store.put(user.id,'candidate-set',{conversationId:w.conversation.id,searchId:search.id,options:[],constraints:w.draft.constraints});
 const draft=store.put(user.id,'trip-draft',{...w.draft,constraints:{...w.draft.constraints,from:'BOS',to:'JFK',mode:'flights',departure:request.departure,passengers:request.passengers},selected:{flight:candidate,setId:set.id,optionId:'fixture-option',journey:flightItinerary({...candidate,pricing:totalPrice(candidate.components)},{travelers:1,bags:1})}},{id:w.draft.id,expectedVersion:w.draft.version});
 const state={calls:[],submitted:0,metadata:null,confirmed:false,changed:false,amount:'100.10'};
 const cancellation=()=>({id:'ore_fixture',order_id:'ord_fixture',live_mode:false,expires_at:new Date(Date.now()+240000).toISOString(),confirmed_at:state.confirmed?new Date().toISOString():null,refund_amount:'80.00',refund_currency:'USD',refund_to:'original_form_of_payment'});
 const changeStart=Date.now()+8*86400000;
 const change=()=>({id:'oce_fixture',order_id:'ord_fixture',live_mode:false,expires_at:new Date(Date.now()+240000).toISOString(),confirmed_at:state.changed?new Date().toISOString():null,change_total_amount:'10.00',change_total_currency:'USD',penalty_total_amount:'5.00',penalty_total_currency:'USD',new_total_amount:'110.10',new_total_currency:'USD',refund_to:null,slices:{remove:[{id:'sli_original'}],add:rawOffer({start:changeStart}).slices}});
 const adapter=new DuffelBookingAdapter({env:{DUFFEL_ACCESS_TOKEN:'fixture-only',DUFFEL_BOOKING_APPROVED:'true',DUFFEL_CARDS_APPROVED:'true'},transport:async(url,options)=>{const path=new URL(url).pathname,body=options.body?JSON.parse(options.body).data:null;state.calls.push({path,method:options.method,body,timeout:options.timeoutMs});let data;
  if(path.endsWith('/actions/price'))data={...raw,total_amount:state.amount,intended_services:body.intended_services};
  else if(path==='/air/offers/off_fixture')data={...raw,available_services:[]};
  else if(path==='/air/orders'&&options.method==='POST'){state.submitted++;state.metadata=body.metadata;assert.equal(body.payments[0].amount,'102.15');assert.equal(body.passengers[0].id,'pas_fixture');assert.equal(options.timeoutMs,135000);data={id:'ord_fixture',live_mode:false,metadata:body.metadata,payment_status:{awaiting_payment:false},documents:[{type:'electronic_ticket',unique_identifier:'TEST-001'}],booking_reference:'TESTPNR'};}
  else if(path==='/air/orders/ord_fixture')data={id:'ord_fixture',live_mode:false,metadata:state.metadata,available_actions:['cancel','change'],slices:state.changed?change().slices.add:raw.slices,payment_status:{awaiting_payment:false},documents:[{type:'electronic_ticket',unique_identifier:state.changed?'TEST-002':'TEST-001'}]};
  else if(path==='/air/order_cancellations'){assert.equal(body.order_id,'ord_fixture');data=cancellation();}
  else if(path==='/air/order_cancellations/ore_fixture')data=cancellation();
  else if(path==='/air/order_cancellations/ore_fixture/actions/confirm'){state.confirmed=true;data=cancellation();}
  else if(path==='/air/order_change_requests'){assert.equal(body.slices.remove[0].slice_id,'sli_original');data={id:'ocr_fixture',order_id:'ord_fixture',live_mode:false,order_change_offers:[{id:'oco_fixture',live_mode:false,expires_at:new Date(Date.now()+240000).toISOString(),change_total_amount:'10.00',change_total_currency:'USD',slices:{add:change().slices.add}}]};}
  else if(path==='/air/order_changes'){assert.equal(body.selected_order_change_offer,'oco_fixture');data=change();}
  else if(path==='/air/order_changes/oce_fixture')data=change();
  else if(path==='/air/order_changes/oce_fixture/actions/confirm'){assert.equal(body.payment.amount,'10.00');state.changed=true;data=change();}
  else throw Error('Unexpected fixture network request: '+path);
  return Buffer.from(JSON.stringify({data}));}});
 const app=createApplication({store,flightStatusProvider:t.flightStatusProvider,checkoutProvider:t.checkoutProvider,bookingAdapter:adapter,travel:{flightShoppingCapabilities:{provider:'duffel',configured:true,capabilities:capabilitySet({search:true,backgroundShoppingAllowed:true,priceHistoryAllowed:true})},status:{name:'fixture'},close:async()=>{},call:async()=>{throw Error('Unexpected travel request');}},quiet:true,drainIntervalMs:600000,immediateJobs:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 t.after(async()=>{await app.stopBackgroundJobs();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));store.close();assert.ok(resolve(directory).startsWith(resolve('tmp')+sep));rmSync(directory,{recursive:true,force:true});});
 const call=async(path,body,who=session,method=body?'POST':'GET')=>{const r=await fetch(base+(path.startsWith('/api/')?path:'/api/shopping/'+path),{method,headers:{cookie:'wayline_session='+who.token,'x-csrf-token':who.csrf,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,value:await r.json()};};
 const details=await call('booking/details',{conversationId:w.conversation.id,draftVersion:draft.version,details:{passengers:[{id:'adult-1',givenName:'Fixture',familyName:'Traveler',bornOn:'1990-01-01',title:'ms',gender:'f',email:'fixture@example.invalid',phone:'+12025550123'}],services:[],paymentMethod:'card',cardId:'tcd_fixture'}});assert.equal(details.status,201);
 const review=async(body={kind:'book',detailsId:details.value.id})=>{const r=await call('booking/reviews',body);assert.equal(r.status,201,JSON.stringify(r.value));return r.value;};
 const submit=async r=>{const result=await call('operations',{reviewId:r.id,key:r.id,confirmed:true,confirmationToken:r.confirmationToken,paymentSessionId:'3ds_fixture'});assert.equal(result.status,202,JSON.stringify(result.value));return result.value;};
 const book=async()=>runBookingOperation(store,user.id,(await submit(await review())).id,adapter);
 return {store,user,otherSession,w,call,review,submit,book,adapter,state,raw,request,download:path=>fetch(base+path,{headers:{cookie:'wayline_session='+session.token}})};
}
