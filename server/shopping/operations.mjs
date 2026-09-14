import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { DomainError } from "../domain/journeys.mjs";
import { moneySchema, sumMoney } from "./contracts.mjs";
const entrySchema=z.object({id:z.string().min(1),ticketGroupId:z.string().min(1),passengerIds:z.array(z.string()).min(1),
  type:z.enum(["paid","refund-received","refund-pending","credit-applied"]),amount:moneySchema,
  supplierReference:z.string().min(1),relatedPaymentId:z.string().optional()}).strict();
export function financialLedger(entries) {
  const unique=new Map();
  for(const input of entries) {
    const entry=entrySchema.parse(input),prior=unique.get(entry.id);
    if(prior&&JSON.stringify(prior)!==JSON.stringify(entry))throw new DomainError("Conflicting financial event.",409);
    unique.set(entry.id,entry);
  }
  const rows=[...unique.values()];
  if(new Set(rows.map(e=>e.type+":"+e.supplierReference)).size!==rows.length)throw new DomainError("Duplicate supplier financial reference.");
  const paid=rows.filter(e=>e.type==="paid");
  for(const adjustment of rows.filter(e=>e.type.startsWith("refund"))) {
    const payment=unique.get(adjustment.relatedPaymentId);
    if(!payment||payment.type!=="paid"||payment.ticketGroupId!==adjustment.ticketGroupId||
      payment.amount.currency!==adjustment.amount.currency||!adjustment.passengerIds.every(id=>payment.passengerIds.includes(id)))
      throw new DomainError("Refund must reference its original payment and passenger group.");
  }
  for(const payment of paid) {
    const refunds=rows.filter(e=>e.relatedPaymentId===payment.id&&e.type.startsWith("refund"));
    const refs=new Set(refunds.map(e=>e.supplierReference));
    if(refs.size!==refunds.length)throw new DomainError("A refund cannot be pending and received at the same time.");
    if(refunds.reduce((n,e)=>n+e.amount.amount,0)>payment.amount.amount)throw new DomainError("Refunds exceed their original payment.");
  }
  return Object.fromEntries(["paid","refund-received","refund-pending","credit-applied"].map(type=>{
    const amounts=rows.filter(e=>e.type===type).map(e=>e.amount);
    return [type,amounts.length?sumMoney(amounts):null];
  }));
}
// This seam has no production supplier/payment binding. The HTTP endpoint stays disabled.
// Persist intent BEFORE contacting any supplier; ambiguous outcomes may only be reconciled.
export async function executeSupplierOperation(store,userId,input,adapter) {
  if(!["book","cancel","exchange","refund"].includes(input.kind)||!adapter?.capabilities?.[input.kind])
    throw new DomainError("Supplier operation is not authorized or implemented.",501,"SUPPLIER_OPERATION_DISABLED");
  const review=store.get(userId,input.reviewId,"shopping-review");
  if(review.expiresAt<=Date.now())throw new DomainError("Review expired.",409);
  if(typeof input.key!=="string"||!input.key||input.key.length>100)throw new DomainError("An idempotency key is required.");
  const digest=createHash("sha256").update(JSON.stringify({kind:input.kind,reviewId:input.reviewId})).digest("hex");
  const op=store.transaction(()=>{
    const old=store.list(userId,"supplier-operation").find(o=>o.key===input.key);
    if(old) {if(old.digest!==digest)throw new DomainError("Idempotency key conflict.",409);return old;}
    return store.put(userId,"supplier-operation",{key:input.key,digest,kind:input.kind,reviewId:review.id,
      supplierKey:randomUUID(),state:"intended",paymentState:"not-started",ticketState:"not-issued"},{expiresAt:Date.now()+90*86400000});
  });
  if(op.state!=="intended")return op;
  const pending=store.put(userId,"supplier-operation",{...op,state:"supplier-pending"},{id:op.id,expectedVersion:op.version});
  try {
    const result=await adapter.execute({kind:op.kind,offer:review.offer,idempotencyKey:op.supplierKey});
    return store.put(userId,"supplier-operation",{...pending,state:result.ticketIssued?"ticketed":"reconcile-required",
      paymentState:result.paymentCaptured?"captured":"not-confirmed",ticketState:result.ticketIssued?"issued":"not-issued",
      supplierReference:typeof result.reference==="string"?result.reference.slice(0,160):null},
      {id:op.id,expectedVersion:pending.version});
  } catch {
    return store.put(userId,"supplier-operation",{...pending,state:"reconcile-required"},
      {id:op.id,expectedVersion:pending.version});
  }
}
export async function reconcileSupplierOperation(store,userId,id,adapter) {
  const op=store.get(userId,id,"supplier-operation");
  if(!["supplier-pending","reconcile-required"].includes(op.state))return op;
  if(!adapter?.reconcile)return {...op,manualHelpRequired:true};
  const result=await adapter.reconcile(op.supplierKey);
  if(result?.confirmed!==true)return {...op,manualHelpRequired:true};
  return store.put(userId,"supplier-operation",{...op,state:result.ticketIssued?"ticketed":"manual-help",
    ticketState:result.ticketIssued?"issued":"not-issued",paymentState:result.paymentCaptured?"captured":"not-confirmed"},
    {id,expectedVersion:op.version});
}
