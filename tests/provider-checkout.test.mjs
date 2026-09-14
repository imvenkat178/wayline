import test from 'node:test';
import assert from 'node:assert/strict';
import {supplierFixture} from './helpers/supplierFixture.mjs';
import {providerCheckoutDestination} from '../server/shopping/providerCheckout.mjs';
test('provider checkout is bound to owner, exact draft, environment, approved destination and expiry',async t=>{
 let url='https://checkout.example.invalid/checkout/fixture';
 const provider={name:'Contracted fixture',authorized:true,documentationVersion:'fixture-v1',approvedHosts:['checkout.example.invalid'],live:false,createCheckout:async request=>({url,expiresAt:new Date(Date.now()+300000).toISOString(),offerIds:request.offerIds,requiresFinalReview:true,live:false})};
 const f=await supplierFixture({after:fn=>t.after(fn),checkoutProvider:provider});
 const d=f.store.get(f.user.id,f.w.draft.id,'trip-draft'),body={conversationId:f.w.conversation.id,draftVersion:d.version};
 assert.equal((await f.call('checkouts',body,f.otherSession)).status,404);
 assert.equal((await f.call('checkouts',{...body,url:'https://evil.invalid'})).status,400);
 const checkout=await f.call('checkouts',body);assert.equal(checkout.status,201,JSON.stringify(checkout.value));
 assert.equal(checkout.value.bookingConfirmed,false);assert.match(checkout.value.notice,/before purchasing/);
 assert.equal(providerCheckoutDestination(f.store,f.user.id,checkout.value.id,provider),url);
 assert.equal(f.store.list(f.user.id,'supplier-order').length,0);assert.equal(f.store.list(f.user.id,'ticket').length,0);
 assert.equal(f.state.submitted,0);
 url='https://checkout.example.invalid.evil.invalid/pay';assert.equal((await f.call('checkouts',body)).status,409);
 f.store.put(f.user.id,'trip-draft',{...d,constraints:{...d.constraints,travelers:2}},{id:d.id,expectedVersion:d.version});
 assert.throws(()=>providerCheckoutDestination(f.store,f.user.id,checkout.value.id,provider),{status:409});
});
test('provider checkout is explicitly unavailable without an approved transport',async t=>{
 const f=await supplierFixture(t),d=f.store.get(f.user.id,f.w.draft.id,'trip-draft');
 assert.equal((await f.call('checkouts',{conversationId:f.w.conversation.id,draftVersion:d.version})).status,503);
 assert.equal((await f.call('booking/capabilities')).value.checkout,false);
 assert.equal(f.store.list(f.user.id,'provider-checkout').length,0);
});

test('issued ticket references are owner scoped and never become a fabricated boarding pass',async t=>{const f=await supplierFixture(t),booked=await f.book();const r=await f.call('orders/'+booked.orderId+'/documents');assert.equal(r.status,200);assert.equal(r.value.documents[0].reference,'TEST-001');assert.equal(r.value.supplierFilesAvailable,false);assert.match(r.value.notice,/not boarding passes/);assert.equal((await f.call('orders/'+booked.orderId+'/documents',undefined,f.otherSession)).status,404);});
