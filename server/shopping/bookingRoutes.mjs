import {checkoutCapability} from './providerCheckout.mjs';
import {availableBookingServices} from './ancillaries.mjs';
import { saveBookingDetails, createBookingReview, submitBookingOperation } from './booking.mjs';
import { DomainError } from '../domain/journeys.mjs';
const publicOperation=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['reviewSnapshot','paymentSessionId'].includes(key)));
export async function bookingRoutes({url,req,b,store,session,send,res,rateLimit,bookingAdapter,travel}) {
 const path=url.pathname,userId=session.userId;
 if(!path.startsWith('/api/shopping/booking')&&!path.startsWith('/api/shopping/operations')&&!path.startsWith('/api/shopping/orders'))return false;
 if(path==='/api/shopping/booking/services'&&req.method==='GET'){const c=store.get(userId,url.searchParams.get('conversationId'),'conversation'),d=store.get(userId,c.draftId,'trip-draft');if(!d.selected?.flight)throw new DomainError('Select a supplier offer first.',409);send(res,200,await availableBookingServices(bookingAdapter,d.selected.flight.id));}
 else if(path==='/api/shopping/booking/change-options'&&req.method==='POST'){rateLimit('change-options:'+userId,10);const order=store.get(userId,b.orderId,'supplier-order');if(order.supplier!==bookingAdapter.name||order.live!==bookingAdapter.live)throw new DomainError('Order supplier environment mismatch.',409);if(!order.servicingAuthority)throw new DomainError('This order has no servicing authority.',409);const result=await bookingAdapter.changeOptions(order,b.change);const current=store.get(userId,order.id,'supplier-order');if(current.version!==order.version)throw new DomainError('Order changed during search.',409);send(res,201,store.put(userId,'booking-change-search',{...result,schemaVersion:1,orderId:order.id,orderVersion:order.version,expiresAt:Date.now()+300000},{expiresAt:Date.now()+300000}));}
 else if(path==='/api/shopping/booking/order-sections'&&req.method==='GET'){const order=store.get(userId,url.searchParams.get('orderId'),'supplier-order');if(order.supplier!==bookingAdapter.name||order.live!==bookingAdapter.live||!order.servicingAuthority)throw new DomainError('Order supplier environment mismatch.',409);send(res,200,await bookingAdapter.orderSections(order));}
 else if(path==='/api/shopping/booking/capabilities'&&req.method==='GET')send(res,200,{provider:bookingAdapter.name,authorized:bookingAdapter.authorized,live:bookingAdapter.live,capabilities:bookingAdapter.capabilities,checkout:checkoutCapability(travel.checkoutProvider)});
 else if(path==='/api/shopping/booking/details'&&req.method==='POST')send(res,201,saveBookingDetails(store,userId,b.conversationId,b));
 else if(path==='/api/shopping/booking/card-key'&&req.method==='POST') {
   rateLimit('card-key:'+userId,10);
   const c=store.get(userId,b.conversationId,'conversation');const d=store.get(userId,c.draftId,'trip-draft');
   const order=b.orderId?store.get(userId,b.orderId,'supplier-order'):null;
   if(order&&(order.supplier!==bookingAdapter.name||order.live!==bookingAdapter.live))throw new DomainError('Order supplier environment mismatch.',409);
   if((!d.selected?.flight&&!order?.servicingAuthority)||!bookingAdapter.capabilities.book)throw new DomainError('Approved card and booking access is required.',501,'SUPPLIER_OPERATION_DISABLED');
   send(res,201,await bookingAdapter.call('identity/component_client_keys','POST',{}));
 } else if(path==='/api/shopping/booking/reviews'&&req.method==='POST') {
   rateLimit('booking-review:'+userId,10);send(res,201,await createBookingReview(store,userId,b,bookingAdapter));
 } else if(path==='/api/shopping/operations'&&req.method==='POST') {
   if(!bookingAdapter.authorized)throw new DomainError('Supplier booking, exchange, refunds and payment are not enabled.',501,'SUPPLIER_OPERATION_DISABLED');
   rateLimit('booking-submit:'+userId,10);send(res,202,publicOperation(submitBookingOperation(store,userId,b,bookingAdapter)));
 } else if(path==='/api/shopping/booking/current'&&req.method==='GET'){
   const c=store.get(userId,url.searchParams.get('conversationId'),'conversation'),d=store.get(userId,c.draftId,'trip-draft');
   const orders=store.list(userId,'supplier-order').filter(o=>o.conversationId===c.id),orderIds=new Set(orders.map(o=>o.id));
   const belongs=source=>source?.conversationId===c.id||orderIds.has(source?.orderId);
   send(res,200,{operations:store.list(userId,'booking-operation').filter(o=>belongs(o.reviewSnapshot?.source)||orderIds.has(o.orderId)).map(publicOperation),reviews:store.list(userId,'booking-review').filter(r=>r.state==='review'&&r.expiresAt>Date.now()&&belongs(r.source)&&(r.kind!=='book'||r.source.draftVersion===d.version)&&(!r.source.orderId||orders.find(o=>o.id===r.source.orderId)?.version===r.source.orderVersion))});
 }
 else if(/^\/api\/shopping\/orders\/[a-zA-Z0-9-]+\/documents$/.test(path)&&req.method==='GET'){const order=store.get(userId,path.split('/')[4],'supplier-order');send(res,200,{documentType:'Supplier ticket reference record',supplier:order.supplier,live:order.live,supplierReference:order.supplierReference,bookingReference:order.bookingReference,ticketState:order.ticketState,observedAt:order.observedAt,documents:(order.documents??[]).map(d=>({type:d.type,reference:d.reference})),supplierFilesAvailable:false,notice:'These are recorded supplier document identifiers, not boarding passes. A ticket file or barcode must come from the carrier.'},{'content-disposition':'attachment; filename=ticket-references.json'});}
 else if(path==='/api/shopping/orders'&&req.method==='GET')send(res,200,store.list(userId,'supplier-order'));
 else if(path==='/api/shopping/operations'&&req.method==='GET')send(res,200,store.list(userId,'booking-operation').map(publicOperation));
 else if(/^\/api\/shopping\/orders\/[a-zA-Z0-9-]+\/receipt$/.test(path)&&req.method==='GET'){const order=store.get(userId,path.split('/')[4],'supplier-order');send(res,200,{documentType:'Wayline booking payment record',supplierIssuedReceipt:false,supplier:order.supplier,live:order.live,supplierReference:order.supplierReference,bookingReference:order.bookingReference,paymentState:order.paymentState,ticketState:order.ticketState,paymentHistory:order.paymentHistory??[],economics:order.economics??[],observedAt:order.observedAt},{'content-disposition':'attachment; filename=booking-payment-record.json'});}
 else {
   const match=path.match(/^\/api\/shopping\/(operations|orders|booking\/reviews)\/([a-zA-Z0-9-]+)$/);
   if(!match||req.method!=='GET')throw new DomainError('Booking route not found.',404);
   const value=store.get(userId,match[2],match[1]==='operations'?'booking-operation':match[1]==='orders'?'supplier-order':'booking-review');
   send(res,200,publicOperation(value));
 }
 return true;
}
