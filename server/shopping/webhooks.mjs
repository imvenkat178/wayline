import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { DomainError } from '../domain/journeys.mjs';
import { enqueueJob } from '../jobs.mjs';
export function verifyDuffelWebhook(raw,header,secret,now=Date.now()) {
  if(!secret)throw new DomainError('Supplier webhook is not configured.',503);
  const parts=String(header??'').split(',').map(p=>p.trim().split('='));
  const stamps=parts.filter(([k])=>k==='t'),signatures=parts.filter(([k])=>k==='v1');
  if(stamps.length!==1||!/^\d+$/.test(stamps[0][1])||Math.abs(now/1000-Number(stamps[0][1]))>300)throw new DomainError('Invalid webhook timestamp.',401);
  const expected=createHmac('sha256',secret).update(stamps[0][1]+'.').update(raw).digest();
  if(!signatures.some(([,sig])=>/^[a-f0-9]{64}$/.test(sig??'')&&timingSafeEqual(expected,Buffer.from(sig,'hex'))))throw new DomainError('Invalid supplier webhook signature.',401);
}
export function receiveDuffelWebhook(store,raw,header,adapter,{secret=process.env.DUFFEL_WEBHOOK_SECRET,now=Date.now()}={}) {
  verifyDuffelWebhook(raw,header,secret,now);
  let event;try{event=JSON.parse(raw.toString());}catch{throw new DomainError('Invalid supplier event.');}
  if(typeof event.id!=='string'||!/^wev_[a-zA-Z0-9_-]+$/.test(event.id)||typeof event.type!=='string'||typeof event.live_mode!=='boolean')throw new DomainError('Invalid supplier event.');
  if(event.live_mode!==adapter.live)throw new DomainError('Supplier webhook environment mismatch.',409);
  const object=event.data?.object;
  // The signed event only wakes reconciliation. It never directly marks tickets
  // issued or payments captured, so delivery ordering cannot roll back state.
  const rows=store.db.prepare("SELECT * FROM records WHERE kind='booking-operation'").all();
  const matching=rows.filter(row=>{const op=store.decode(row);return op.supplier===adapter.name&&op.live===event.live_mode&&(object?.metadata?.wayline_operation===op.supplierKey||object?.id===op.supplierReference||object?.order_id===op.supplierReference);});
  // Order metadata identifies the original purchase, even after servicing.
  // Reconcile the latest operation for each matched order, never replay its purchase.
  const matches=[...new Map(matching.map(row=>{const op=store.decode(row);if(!op.orderId)return [row.id,row];const order=store.get(row.user_id,op.orderId,'supplier-order');const latest=rows.find(r=>r.user_id===row.user_id&&r.id===order.operationId);return [row.user_id+':'+op.orderId,latest??row];})).values()];
  if(matches.length!==1)return {accepted:true,matched:false};
  const row=matches[0],op=store.decode(row),userId=row.user_id;
  return store.transaction(()=>{
    const dedupe=event.idempotency_key??event.id;
    const id=createHash('sha256').update(adapter.name+':'+event.type+':'+dedupe).digest('hex');
    const prior=store.list(userId,'booking-event').find(e=>e.id===id);if(prior)return {accepted:true,duplicate:true};
    store.put(userId,'booking-event',{supplier:adapter.name,eventId:event.id,type:event.type,operationId:op.id,receivedAt:new Date(now).toISOString(),payloadHash:createHash('sha256').update(raw).digest('hex')},{id});
    enqueueJob(store,'booking-operation',{userId,operationId:op.id,refresh:true},{userId});
    return {accepted:true,matched:true};
  });
}
export async function handleDuffelWebhook({req,res,store,send,bookingAdapter}) {
  let length=0;const chunks=[];
  for await(const chunk of req){length+=chunk.length;if(length>1000000)throw new DomainError('Webhook too large.',413);chunks.push(chunk);}
  return send(res,200,receiveDuffelWebhook(store,Buffer.concat(chunks),req.headers['x-duffel-signature'],bookingAdapter));
}
