// After the submission boundary, workers reconcile by supplier reference only.
// Passenger identity and temporary card/authentication tokens are no longer needed.
export function reconciliationReview(review) {
 if(!review)return review;
 const keys=['conversationId','draftId','draftVersion','selectionHash','detailsId','detailsVersion','orderId','orderVersion','request','recovery'];
 const source=Object.fromEntries(keys.filter(k=>review.source[k]!==undefined).map(k=>[k,review.source[k]]));
 if(review.source.order)source.order={supplierReference:review.source.order.supplierReference};
 const payload=review.quote.supplierPayload??{};
 const supplierPayload=Object.fromEntries(['offerId','orderId','cancellationId'].filter(k=>payload[k]!==undefined).map(k=>[k,payload[k]]));
 return {...review,source,quote:{...review.quote,supplierPayload},privateInputsClearedAt:review.privateInputsClearedAt??new Date().toISOString()};
}
export function clearSubmittedInputs(store,userId,operation) {
 if(!operation.submittedAt)return operation;
 const review=reconciliationReview(operation.reviewSnapshot),detailsId=operation.reviewSnapshot?.source.detailsId;
 for(const r of store.list(userId,'booking-review').filter(r=>r.id===operation.reviewId||(detailsId&&r.source?.detailsId===detailsId))) {
  const value=reconciliationReview(r);
  store.put(userId,'booking-review',{...value,state:r.id===operation.reviewId?r.state:'superseded'},{id:r.id,expectedVersion:r.version});
 }
 if(detailsId){try{store.get(userId,detailsId,'booking-details');store.remove(userId,detailsId);}catch(e){if(e.status!==404)throw e;}}
 return {...operation,reviewSnapshot:review,paymentSessionId:null,privateInputsClearedAt:operation.privateInputsClearedAt??new Date().toISOString()};
}

export function transactionRetentionPolicy(env) {
 const days=Number(env.DUFFEL_TRANSACTION_RETENTION_DAYS),id=env.DUFFEL_RETENTION_POLICY_ID;
 return Number.isInteger(days)&&days>=1&&days<=3650&&typeof id==='string'&&id.trim()?{days,id:id.slice(0,160)}:null;
}
export function orderRetention(old,adapter,submittedAt) {
 if(!adapter.live||!adapter.retentionPolicy)return old?.retention??null;
 return {policyId:adapter.retentionPolicy.id,retainUntil:Math.max(old?.retention?.retainUntil??0,Date.parse(submittedAt)+adapter.retentionPolicy.days*86400000)};
}
export function archiveContractualTransactions(store,userId,now=Date.now()) {
 const orders=store.db.prepare("SELECT * FROM records WHERE user_id=? AND kind='supplier-order'").all(userId).map(r=>store.decode(r));
 for(const order of orders){
  const expiresAt=order.retention?.retainUntil;if(!order.live||!Number.isFinite(expiresAt)||expiresAt<=now)continue;
  const value={schemaVersion:1,supplier:order.supplier,supplierReference:order.supplierReference,live:true,paymentState:order.paymentState,ticketState:order.ticketState,charge:order.charge,refund:order.refund,observedAt:order.observedAt,retention:order.retention,paymentHistory:(order.paymentHistory??[]).map(p=>({kind:p.kind,charge:p.charge,refund:p.refund,state:p.state,observedAt:p.observedAt}))};
  store.db.prepare('INSERT INTO retained_transactions(id,payload,expires_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at').run(order.id,store.encrypt(value),expiresAt);
 }
}
