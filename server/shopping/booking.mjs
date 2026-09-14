import {recoveryBookingBinding} from './supplierRecovery.mjs';
import {clearSubmittedInputs,orderRetention} from './transactionRetention.mjs';
import {paymentHistory,orderEconomics} from './paymentHistory.mjs';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { DomainError } from '../domain/journeys.mjs';
import { moneySchema } from './contracts.mjs';
import { enqueueJob } from '../jobs.mjs';
export const transactionKinds=['book','cancel','exchange','refund'];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id=z.string().min(1).max(160);
export const bookingPassenger=z.object({id,givenName:z.string().min(1).max(80),familyName:z.string().min(1).max(80),bornOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),title:z.enum(['mr','ms','mrs','miss','dr']),gender:z.enum(['m','f']),email:z.string().email(),phone:z.string().regex(/^\+[1-9]\d{6,14}$/)}).strict();
const selectionSchema=z.object({passengers:z.array(bookingPassenger).min(1).max(9),services:z.array(z.object({id,quantity:z.number().int().min(1).max(9)}).strict()).max(30).default([]),paymentMethod:z.literal('card'),cardId:z.string().regex(/^tcd_[a-zA-Z0-9_-]+$/)}).strict();
const quoteSchema=z.object({id,expiresAt:z.number().finite(),charge:moneySchema,refund:moneySchema.nullable(),terms:z.string().min(1).max(15000),itinerary:z.unknown(),complete:z.literal(true),supplier:z.string().min(1),live:z.boolean(),paymentAuthenticationRequired:z.boolean().default(true),supplierPayload:z.unknown()}).strict();
const fail=(message,code='BOOKING_REVIEW_REQUIRED',status=409)=>{throw new DomainError(message,status,code);};
function requireCapability(adapter,kind) {
  if(!adapter?.authorized || adapter.capabilities?.[kind]!==true)fail('Approved supplier access for this operation is not configured.','SUPPLIER_OPERATION_DISABLED',501);
}
export function saveBookingDetails(store,userId,conversationId,input) {
  const c=store.get(userId,conversationId,'conversation'), draft=store.get(userId,c.draftId,'trip-draft'), details=selectionSchema.parse(input.details);
  if(draft.version!==input.draftVersion)fail('The draft changed. Refresh the traveler form.');
  if(!draft.selected?.flight)fail('Select a current supplier offer first.');
  const ids=draft.constraints.passengers?.map(p=>p.id) ?? [];
  if(new Set(details.passengers.map(p=>p.id)).size!==ids.length||ids.some(id=>!details.passengers.some(p=>p.id===id)))fail('Passenger details must match every traveler in the selected search.');
  for(const p of details.passengers){const date=new Date(p.bornOn+'T12:00:00Z');if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==p.bornOn||+date>Date.now())fail('Enter a valid birth date.');const ageDate=new Date(draft.constraints.departure);const age=ageDate.getUTCFullYear()-date.getUTCFullYear()-((ageDate.getUTCMonth()<date.getUTCMonth()||(ageDate.getUTCMonth()===date.getUTCMonth()&&ageDate.getUTCDate()<date.getUTCDate()))?1:0);const requested=draft.constraints.passengers.find(x=>x.id===p.id);if(age<2||age>120||(requested.type==='child'?age!==requested.age:age<18))fail('The traveler birth date does not match the searched passenger type or age.');}
  return store.put(userId,'booking-details',{schemaVersion:1,conversationId,draftId:draft.id,draftVersion:draft.version,selectionHash:hash(draft.selected),details},{expiresAt:Date.now()+3600000});
}
function sourceFor(store,userId,input) {
  if(input.kind==='book') {
    const details=store.get(userId,input.detailsId,'booking-details'),c=store.get(userId,details.conversationId,'conversation'),draft=store.get(userId,c.draftId,'trip-draft');
    if(draft.version!==details.draftVersion||hash(draft.selected)!==details.selectionHash)fail('The selected itinerary or passengers changed.');
    const set=store.get(userId,draft.selected.setId,'candidate-set'),search=store.get(userId,set.searchId,'shopping-search');
    if(search.state==='cancelled')fail('The selected search was cancelled. Search again before purchasing.');
    const originalOffer=search.offers.find(o=>o.id===draft.selected.flight.id);if(!originalOffer)fail('Supplier offer is missing from this account’s search.');
    return {recovery:recoveryBookingBinding(store,userId,c,draft.selected.flight),request:search.request,originalOffer,conversationId:c.id,draftId:draft.id,draftVersion:draft.version,selectionHash:hash(draft.selected),detailsId:details.id,detailsVersion:details.version,offer:draft.selected.flight,details:details.details};
  }
  const order=store.get(userId,input.orderId,'supplier-order');
  if(order.servicingAuthority!==true||!order.supplierReference)fail('Imported tickets do not establish servicing authority.');
  if(input.kind==='exchange'){const changeSearch=store.get(userId,input.changeSearchId,'booking-change-search');if(changeSearch.orderId!==order.id||changeSearch.orderVersion!==order.version||changeSearch.expiresAt<=Date.now())fail('Change offers belong to another or an earlier order.');const changeOffer=changeSearch.offers.find(o=>o.id===input.changeOfferId);if(!changeOffer||changeOffer.expiresAt<=Date.now())fail('Select an unexpired change offer.');if(input.changeCardId&&!/^tcd_[a-zA-Z0-9_-]+$/.test(input.changeCardId))fail('Prepare a valid temporary card.');return {orderId:order.id,orderVersion:order.version,order,changeSearchId:changeSearch.id,changeOfferId:changeOffer.id,changeCardId:input.changeCardId??null,changeSearch,changeOffer};}
  return {orderId:order.id,orderVersion:order.version,order};
}
const quoteBinding=q=>hash({charge:q.charge,refund:q.refund,terms:q.terms,itinerary:q.itinerary,supplier:q.supplier,live:q.live,paymentAuthenticationRequired:q.paymentAuthenticationRequired});
export async function createBookingReview(store,userId,input,adapter) {
  if(!transactionKinds.includes(input.kind))fail('Choose a supported transaction.');requireCapability(adapter,input.kind);
  const source=sourceFor(store,userId,input);
  if(source.order&&(source.order.supplier!==adapter.name||source.order.live!==adapter.live))fail('This order belongs to a different supplier or environment.');
  const quote=quoteSchema.parse(await adapter.quote({kind:input.kind,...source,change:input.change}));
  if(quote.expiresAt<=Date.now())fail('Supplier quote expired.');
  if(quote.supplier!==adapter.name||quote.live!==adapter.live)fail('Supplier environment mismatch.');
  // Repeat owner/version checks after the network boundary.
  if(hash(sourceFor(store,userId,input))!==hash(source))fail('The trip or order changed while preparing the quote.');
  return store.put(userId,'booking-review',{schemaVersion:1,kind:input.kind,state:'review',source,quote,quoteBinding:quoteBinding(quote),confirmationToken:randomUUID(),expiresAt:Math.min(quote.expiresAt,Date.now()+5*60000),change:input.change ?? null},{expiresAt:Date.now()+86400000});
}
function validateCurrent(store,userId,review) {
  if(review.expiresAt<=Date.now())fail('This exact review expired. Request a fresh review.');
  const source=sourceFor(store,userId,{kind:review.kind,detailsId:review.source.detailsId,orderId:review.source.orderId,changeSearchId:review.source.changeSearchId,changeOfferId:review.source.changeOfferId,changeCardId:review.source.changeCardId});
  if(hash(source)!==hash(review.source))fail('The itinerary, traveler details or order changed. Request a new review.');
}
export function submitBookingOperation(store,userId,input,adapter) {
  if(typeof input.key!=='string'||!input.key||input.key.length>100)fail('An idempotency key is required.');
  return store.transaction(()=>{
    const review=store.get(userId,input.reviewId,'booking-review');requireCapability(adapter,review.kind);
    if(input.confirmationToken!==review.confirmationToken||input.confirmed!==true)fail('Confirm this specific review using its review control.');
    const requestHash=hash({reviewId:review.id,confirmationToken:input.confirmationToken,paymentSessionId:input.paymentSessionId ?? null});
    const previous=store.list(userId,'booking-operation').find(o=>o.key===input.key);
    if(previous){if(previous.requestHash!==requestHash)fail('Idempotency key conflict.','IDEMPOTENCY_CONFLICT');return previous;}
    if(review.operationId)return store.get(userId,review.operationId,'booking-operation');
    validateCurrent(store,userId,review);
    if(review.quote.supplier!==adapter.name||review.quote.live!==adapter.live)fail('Review supplier environment changed.');
    const competing=store.list(userId,'booking-operation').find(o=>o.id!==review.operationId&&((review.kind==='book'&&o.kind==='book'&&o.reviewSnapshot?.source.conversationId===review.source.conversationId&&o.reviewSnapshot?.source.selectionHash===review.source.selectionHash&&['queued','submitting','reconciling','completed'].includes(o.state))||(review.kind!=='book'&&o.reviewSnapshot?.source.orderId===review.source.orderId&&['queued','submitting','reconciling'].includes(o.state))));
    if(competing)fail('An operation already exists for this selection or is still pending for this order. Check its status before preparing another transaction.','OPERATION_IN_PROGRESS');
    if(review.quote.paymentAuthenticationRequired&&(!/^3ds_[a-zA-Z0-9_-]+$/.test(input.paymentSessionId??'')))fail('Authenticate payment with the protected supplier card form first.');
    const op=store.put(userId,'booking-operation',{schemaVersion:1,kind:review.kind,reviewId:review.id,reviewSnapshot:review,key:input.key,requestHash,paymentSessionId:input.paymentSessionId??null,state:'queued',paymentState:'not-started',ticketState:'not-issued',supplierKey:randomUUID(),supplier:adapter.name,live:adapter.live,submittedAt:null,reconciliationAttempts:0});
    store.put(userId,'booking-review',{...review,state:'submitted',operationId:op.id},{id:review.id,expectedVersion:review.version});
    enqueueJob(store,'booking-operation',{userId,operationId:op.id},{userId,maxAttempts:5});
    return op;
  });
}
function saveOutcome(store,userId,id,result,adapter) {
  return store.transaction(()=>{
    const op=clearSubmittedInputs(store,userId,store.get(userId,id,'booking-operation'));
    if(result?.authoritative!==true)return store.put(userId,'booking-operation',{...op,state:'reconciling'},{id,expectedVersion:op.version});
    if(result.live!==op.live||result.supplier!==op.supplier)fail('Supplier outcome environment mismatch.');
    const paymentState=['captured','declined','refunded','refund-pending','not-required'].includes(result.paymentState)?result.paymentState:op.paymentState;
    const ticketState=['issued','cancelled','exchanged','not-issued'].includes(result.ticketState)?result.ticketState:op.ticketState;
    const success=op.kind==='book'?ticketState==='issued'&&['captured','not-required'].includes(paymentState):op.kind==='exchange'?ticketState==='exchanged':op.kind==='cancel'?ticketState==='cancelled':['refunded','refund-pending'].includes(paymentState)&&ticketState==='cancelled';
    const state=success?'completed':paymentState==='declined'?'declined':'reconciling';
    let orderId=op.orderId ?? op.reviewSnapshot.source.orderId ?? null;
    if(result.reference) {
      const old=orderId?store.get(userId,orderId,'supplier-order'):store.list(userId,'supplier-order').find(o=>o.supplier===adapter.name&&o.supplierReference===result.reference);
      const history=paymentHistory(store,userId,old,op,paymentState);
      const order=store.put(userId,'supplier-order',{...old,schemaVersion:1,supplier:adapter.name,supplierReference:result.reference,bookingReference:result.bookingReference??old?.bookingReference??null,conversationId:op.reviewSnapshot.source.conversationId??old?.conversationId??null,live:op.live,retention:orderRetention(old,adapter,op.submittedAt),servicingAuthority:true,state,paymentState,ticketState,charge:history.find(p=>p.kind==='book')?.charge??old?.charge??op.reviewSnapshot.quote.charge,latestCharge:op.reviewSnapshot.quote.charge,refund:op.reviewSnapshot.quote.refund,paymentHistory:history,economics:orderEconomics({paymentHistory:history}),searchRequest:op.reviewSnapshot.source.request??old?.searchRequest??null,documents:Array.isArray(result.documents)&&result.documents.length?result.documents:old?.documents??[],itinerary:op.reviewSnapshot.quote.itinerary,operationId:op.id,observedAt:new Date().toISOString()},old?{id:old.id,expectedVersion:old.version}:{});orderId=order.id;
    }
    return store.put(userId,'booking-operation',{...op,state,paymentState,ticketState,orderId,supplierReference:result.reference??op.supplierReference??null,lastObservedAt:new Date().toISOString()}, {id,expectedVersion:op.version});
  });
}
export async function runBookingOperation(store,userId,id,adapter,{refresh=false}={}) {
  let op=store.get(userId,id,'booking-operation');requireCapability(adapter,op.kind);
  if(op.supplier!==adapter.name||op.live!==adapter.live)fail('Operation belongs to a different supplier or environment.');
  if(['declined','review-required'].includes(op.state)||(op.state==='completed'&&!refresh))return op;
  if(op.orderId){const order=store.get(userId,op.orderId,'supplier-order');if(order.operationId!==op.id)return op;}
  if(op.submittedAt) {
    const result=await adapter.reconcile(op).catch(()=>null);
    op=saveOutcome(store,userId,id,result,adapter);
  } else {
    try {
      validateCurrent(store,userId,op.reviewSnapshot);
      const fresh=quoteSchema.parse(await adapter.refreshQuote(op.reviewSnapshot));
      if(fresh.expiresAt<=Date.now()||quoteBinding(fresh)!==op.reviewSnapshot.quoteBinding)fail('Supplier prices or terms changed. A new review is required.');
      validateCurrent(store,userId,op.reviewSnapshot);
    } catch {return store.put(userId,'booking-operation',{...op,state:'review-required'}, {id,expectedVersion:op.version});}
    // Persist the submission boundary before any supplier call. A worker restart
    // after this point reconciles even if it cannot know whether bytes were sent.
    op=store.put(userId,'booking-operation',{...op,state:'submitting',submittedAt:new Date().toISOString()}, {id,expectedVersion:op.version});
    let result;try {result=await adapter.submit(op);}catch{result=null;}
    op=saveOutcome(store,userId,id,result,adapter);
  }
  if(op.state==='reconciling') {
    const current=store.get(userId,id,'booking-operation');
    op=store.put(userId,'booking-operation',{...current,reconciliationAttempts:current.reconciliationAttempts+1,manualHelpRequired:current.reconciliationAttempts>=5},{id,expectedVersion:current.version});
    enqueueJob(store,'booking-operation',{userId,operationId:id},{userId,runAt:Date.now()+Math.min(300000,15000*2**Math.min(op.reconciliationAttempts,5)),maxAttempts:5});
  }
  return op;
}
export function approvedCheckoutUrl(raw,approvedHosts=[]) {
  const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password||url.port||!approvedHosts.includes(url.hostname))fail('Checkout destination is not approved.','CHECKOUT_DESTINATION_BLOCKED');return url.href;
}
