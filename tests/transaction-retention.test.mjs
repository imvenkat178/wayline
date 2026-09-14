import test from 'node:test';
import assert from 'node:assert/strict';
import {supplierFixture} from './helpers/supplierFixture.mjs';
import {DuffelBookingAdapter} from '../server/shopping/duffelBooking.mjs';
import {orderRetention} from '../server/shopping/transactionRetention.mjs';
test('live approval also requires an explicit contractual retention policy',()=>{
 const env={DUFFEL_ACCESS_TOKEN:'fixture',DUFFEL_BOOKING_APPROVED:'true',DUFFEL_LIVE_ENABLED:'true',DUFFEL_LIVE_CERTIFIED:'true'};
 assert.equal(new DuffelBookingAdapter({env}).authorized,false);
 assert.equal(new DuffelBookingAdapter({env:{...env,DUFFEL_TRANSACTION_RETENTION_DAYS:'365',DUFFEL_RETENTION_POLICY_ID:'fixture-policy'}}).authorized,true);
 const adapter={live:true,retentionPolicy:{days:30,id:'fixture-policy'}},submitted=new Date().toISOString();
 const old={retention:{retainUntil:Date.now()+90*86400000}};
 assert.ok(orderRetention(old,adapter,submitted).retainUntil>=old.retention.retainUntil);
});
test('account deletion removes identity while retaining only required encrypted transaction metadata',async t=>{
 const f=await supplierFixture(t),booked=await f.book(),old=f.store.get(f.user.id,booked.orderId,'supplier-order'),retainUntil=Date.now()+86400000;
 f.store.put(f.user.id,'supplier-order',{...old,live:true,retention:{policyId:'fixture-policy',retainUntil},passengers:[{name:'Private Name',email:'private@example.invalid'}]},{id:old.id,expectedVersion:old.version});
 f.store.deleteAccount(f.user.id);
 assert.equal(!!f.store.user(f.user.id),false);
 const row=f.store.db.prepare('SELECT * FROM retained_transactions WHERE id=?').get(old.id);
 assert.ok(row);assert.equal(row.payload.includes('ord_fixture'),false);
 const value=f.store.decrypt(row.payload),serialized=JSON.stringify(value);
 assert.equal(value.supplierReference,'ord_fixture');assert.equal(value.charge.amount,10215);
 for(const privateValue of ['Private Name','private@example.invalid',f.user.id,'tcd_fixture','3ds_fixture','passengers','itinerary'])assert.equal(serialized.includes(privateValue),false);
 f.store.cleanup(retainUntil+1);assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM retained_transactions').get().n,0);
});
test('pending refunds keep required reconciliation records when account deletion is requested',async t=>{
 const f=await supplierFixture(t),booked=await f.book(),order=f.store.get(f.user.id,booked.orderId,'supplier-order');
 f.store.put(f.user.id,'supplier-order',{...order,paymentState:'refund-pending'},{id:order.id,expectedVersion:order.version});
 assert.throws(()=>f.store.deleteAccount(f.user.id),{status:409,code:'RECONCILIATION_PENDING'});
 f.store.deleteHistory(f.user.id);assert.ok(f.store.get(f.user.id,order.id,'supplier-order'));
});
