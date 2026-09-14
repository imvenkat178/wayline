import assert from 'node:assert/strict';
import {totalPrice} from '../server/shopping/contracts.mjs';
export async function personalMonitoringJourney(f,j,chat) {
 const id=f.w.conversation.id;
 await chat(f,id,'Schedule my weekday commute','manage_commutes',j);
 const commute=await f.call('/api/records/commute',{name:'Fixture commute',mode:'sample',from:'bos',to:'nyc',time:'08:30',timezone:'America/New_York',days:[1,2,3,4,5]});assert.equal(commute.status,201);
 assert.equal((await f.call('/api/commutes/'+commute.value.id+'/next')).status,200);
 await chat(f,id,'Pause my commute','manage_commutes',j);
 assert.equal((await f.call('/api/records/commute/'+commute.value.id,{version:commute.value.version,enabled:false},undefined,'PATCH')).status,200);
 assert.equal((await f.call('/api/commutes/'+commute.value.id+'/next')).status,409);
 await chat(f,id,'Add a transit pass','manage_passes',j);
 const pass=await f.call('/api/records/pass',{name:'Fixture monthly pass',operator:'Fixture Rail',costCents:9000,renewal:new Date(Date.now()+30*86400000).toISOString(),autoRenew:false});assert.equal(pass.status,201);assert.equal(pass.value.source,'self-reported');
 let w=(await f.call('/api/conversations/'+id)).value;const searchId=f.store.get(f.user.id,w.draft.selected.setId,'candidate-set').searchId;
 await chat(f,id,'Set a price alert','manage_watches',j);
 const watch=await f.call('watches',{searchId,threshold:{amount:10000,currency:'USD',scale:2},expiresAt:new Date(Date.now()+86400000).toISOString(),consent:true});assert.equal(watch.status,201);assert.equal(watch.value.state,'active');
 await chat(f,id,'Stop my fare watch','manage_watches',j);
 assert.equal((await f.call('watches/'+watch.value.id+'/cancel',{version:watch.value.version})).value.state,'cancelled');
 const c=f.store.get(f.user.id,id,'conversation'),d=f.store.get(f.user.id,c.draftId,'trip-draft');
 const plan=f.store.put(f.user.id,'travel-comparison',{candidate:{...d.selected.flight,pricing:totalPrice(d.selected.flight.components)},request:f.request,offer:{source:{observedAt:new Date().toISOString()}},state:'saved',bookingConfirmed:false,inventoryHeld:false});
 f.store.put(f.user.id,'conversation',{...c,comparisonId:plan.id},{id,expectedVersion:c.version});
 await chat(f,id,'Share my journey','share_trip',j);
 const shared=await f.call('saved/'+plan.id+'/share',{hours:1,location:false});assert.equal(shared.status,201);assert.match(f.store.shared(shared.value.token).state,/NOT BOOKED/);
 await chat(f,id,'Revoke my shared trip link','revoke_share',j);
 assert.equal((await f.call('/api/shares/'+shared.value.id,undefined,undefined,'DELETE')).status,200);assert.throws(()=>f.store.shared(shared.value.token));
 for(const [input,op,mime] of [['Add this itinerary to my calendar','export_calendar','text/calendar'],['Download my itinerary PDF','export_pdf','application/pdf']]){
  w=await chat(f,id,input,op,j);const response=await f.download(w.messages.at(-1).documents[0].url);assert.equal(response.status,200);assert.ok(response.headers.get('content-type').includes(mime));assert.ok((await response.arrayBuffer()).byteLength>100);
 }
 w=await chat(f,id,'Make my trip available offline','offline_pack',j);assert.equal(w.messages.at(-1).protectedPanel,'offline_pack');const pack=(await f.call('saved/'+plan.id+'/itinerary')).value;assert.equal(pack.bookingConfirmed,false);assert.ok(pack.legs.length);
}
