import {shoppingCapabilities} from '../server/shopping/service.mjs';
import {totalPrice} from '../server/shopping/contracts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {supplierFixture} from './helpers/supplierFixture.mjs';
import {comparisonJourney,comparisonCalendar} from '../server/shopping/comparisonDocuments.mjs';
import {itineraryPdf} from '../server/itineraryPdf.mjs';
import {travelerActionResult} from '../server/domain/travelerActions.mjs';
test('saved flight comparison exports preserve evidence, timezone and sharing privacy',async t=>{
 const f=await supplierFixture(t),c=f.store.get(f.user.id,f.w.conversation.id,'conversation'),d=f.store.get(f.user.id,c.draftId,'trip-draft');
 const plan=f.store.put(f.user.id,'travel-comparison',{candidate:{...d.selected.flight,pricing:totalPrice(d.selected.flight.components)},request:f.request,offer:{source:{observedAt:new Date().toISOString()}},state:'saved',bookingConfirmed:false,inventoryHeld:false,privatePassenger:'Never share this'});
 comparisonJourney(plan);
 const view=await f.call('saved/'+plan.id+'/itinerary');assert.equal(view.status,200);assert.equal(view.value.bookingConfirmed,false);assert.equal(view.value.state,'SAVED COMPARISON - NOT BOOKED');assert.equal(view.value.dataMode,'illustrative');assert.match(view.value.source,/test inventory/);
 assert.equal((await f.call('saved/'+plan.id+'/itinerary',undefined,f.otherSession)).status,404);
 const shared=await f.call('saved/'+plan.id+'/share',{hours:1,location:true});assert.equal(shared.status,201);
 const publicView=f.store.shared(shared.value.token);assert.match(publicView.state,/NOT BOOKED/);assert.equal(publicView.privatePassenger,undefined);assert.deepEqual(publicView.location,[]);
 f.store.revokeShare(f.user.id,shared.value.id);assert.throws(()=>f.store.shared(shared.value.token),{status:404});
 assert.throws(()=>f.store.share(f.user.id,c.id),{status:404});
 for(const op of ['export_pdf','export_calendar']){const result=await travelerActionResult(f.store,f.user.id,{...c,comparisonId:plan.id},d,{op},{},'Download');assert.match(result.documents[0].url,new RegExp('/saved/'+plan.id+'/'));assert.match(result.reply,/not a purchase/);}
 const journey=comparisonJourney(plan),calendar=comparisonCalendar(journey);assert.match(calendar,/BEGIN:VCALENDAR/);assert.equal((calendar.match(/BEGIN:VEVENT/g)||[]).length,journey.legs.length);assert.match(calendar,/TEST:/);assert.match(calendar,/Not booked/);
 const malicious=comparisonCalendar({...journey,legs:[{...journey.legs[0],service:'Danger\r\nATTENDEE:attacker'}]});assert.ok(!malicious.includes('\r\nATTENDEE:'));
 const pdf=await itineraryPdf(journey);assert.equal(pdf.subarray(0,4).toString(),'%PDF');
 mkdirSync('tmp/pdfs',{recursive:true});writeFileSync('tmp/pdfs/flight-comparison.pdf',pdf);
 const booked=await f.book();assert.equal(booked.ticketState,'issued');assert.equal(f.store.get(f.user.id,plan.id,'travel-comparison').bookingConfirmed,false);
});

test('readiness reports only explicitly authorized operations and licensed status',()=>{const blocked=shoppingCapabilities();assert.equal(blocked.transactionsEnabled,false);const ready=shoppingCapabilities({bookingAdapter:{authorized:true,live:false,capabilities:{cancel:true}},flightStatusProvider:{license:{statusAllowed:true}},groundProvider:{transport:{},contract:{usInventoryGranted:true,documentationVersion:'fixture-1',operations:{book:false}}}});assert.equal(ready.transactionsEnabled,true);assert.equal(ready.providers[0].capabilities.book,false);assert.equal(ready.providers[0].capabilities.cancel,true);assert.equal(ready.providers[0].bookingEnvironment,'supplier-test');assert.equal(ready.providers[1].capabilities.search,true);assert.equal(ready.providers[2].capabilities.getStatus,true);});
