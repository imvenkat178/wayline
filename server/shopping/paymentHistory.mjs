import {sumMoney} from './contracts.mjs';
export function paymentHistory(store,userId,old,op,paymentState) {
 const existing=old?.paymentHistory??store.list(userId,'booking-operation').filter(o=>o.orderId===old?.id&&o.reviewSnapshot&&o.id!==op.id&&o.submittedAt).map(o=>({operationId:o.id,kind:o.kind,charge:o.reviewSnapshot.quote.charge,refund:o.reviewSnapshot.quote.refund,state:o.paymentState,observedAt:o.lastObservedAt}));
 const entry={operationId:op.id,kind:op.kind,charge:op.reviewSnapshot.quote.charge,refund:op.reviewSnapshot.quote.refund,state:paymentState,observedAt:new Date().toISOString()};
 return [...existing.filter(p=>p.operationId!==op.id),entry];
}
export function orderEconomics(order) {
 const rows=order.paymentHistory??[];
 const currencies=[...new Set(rows.flatMap(r=>[r.charge?.currency,r.refund?.currency]).filter(Boolean))];
 return currencies.map(currency=>{
  const group=rows.filter(r=>r.charge?.currency===currency||r.refund?.currency===currency),zero={amount:0,currency,scale:group[0]?.charge?.scale??group[0]?.refund?.scale??2};
  const sum=values=>values.length?sumMoney(values):zero;
  return {currency,previousSpending:sum(group.filter(r=>['captured','refund-pending','refunded'].includes(r.state)&&r.charge?.amount>0).map(r=>r.charge)),refundsReceived:sum(group.filter(r=>r.state==='refunded'&&r.refund).map(r=>r.refund)),refundsPending:sum(group.filter(r=>r.state==='refund-pending'&&r.refund).map(r=>r.refund))};
 });
}
