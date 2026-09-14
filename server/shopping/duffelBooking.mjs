import {transactionRetentionPolicy} from './transactionRetention.mjs';
import {getChangeOptions,createChangeQuote,refreshChangeQuote,changedOutcome,supplierSlices} from './duffelServicing.mjs';
import {availableBookingServices,applyPurchasedBaggage} from './ancillaries.mjs';
import { z } from 'zod';
import { fetchBounded } from '../adapters/providers.mjs';
import { DomainError } from '../domain/journeys.mjs';
import { moneyFromDecimal, sumMoney } from './contracts.mjs';
import { normalizeDuffelOffer } from './duffel.mjs';
import { composeOffer } from './composer.mjs';
import { rankCandidates } from './contracts.mjs';
const resource=(value,prefix)=>z.string().regex(new RegExp('^'+prefix+'_[a-zA-Z0-9_-]+$')).parse(value);
const unavailable=message=>{throw new DomainError(message,501,'SUPPLIER_OPERATION_DISABLED');};
const decimal=m=>(m.amount/10**m.scale).toFixed(m.scale);
export class DuffelBookingAdapter {
  name='duffel';
  constructor({env=process.env,transport=fetchBounded}={}) {
    this.env=env;this.transport=transport;
    this.live=env.DUFFEL_LIVE_ENABLED==='true';
    this.retentionPolicy=transactionRetentionPolicy(env);
    this.authorized=!!env.DUFFEL_ACCESS_TOKEN && env.ENABLE_EXTERNAL_FEEDS!=='false' && env.DUFFEL_BOOKING_APPROVED==='true' && (!this.live||env.DUFFEL_LIVE_CERTIFIED==='true'&&!!this.retentionPolicy);
    this.capabilities={book:this.authorized&&env.DUFFEL_CARDS_APPROVED==='true',cancel:this.authorized,exchange:this.authorized&&env.DUFFEL_CARDS_APPROVED==='true',refund:this.authorized};
  }
  async call(path,method='GET',data,{transaction=false}={}) {
    if(!this.authorized)unavailable('Approved Duffel booking access is not configured.');
    // Financial submissions are never retried by this transport. The durable job
    // records uncertainty and switches to read-only reconciliation.
    const bytes=await this.transport('https://api.duffel.com/'+path,{method,timeoutMs:transaction?135000:20000,headers:{'Content-Type':'application/json','Duffel-Version':'v2',Authorization:'Bearer '+this.env.DUFFEL_ACCESS_TOKEN},...(data?{body:JSON.stringify({data})}:{})},6000000);
    const result=JSON.parse(bytes.toString());return result.data;
  }
  async quote(source) {
    const {kind,offer,details,request,originalOffer,order}=source;
    if(kind==='exchange')return createChangeQuote(this,source);
    if(kind==='book') {
      if(!this.capabilities.book)unavailable('Duffel Cards approval is required.');
      resource(details.cardId,'tcd');
      const offerId=resource(offer.id,'off');
      const available=details.services.length?await availableBookingServices(this,offerId):[];
      const raw=await this.call(`air/offers/${offerId}/actions/price`,'POST',{intended_payment_methods:[{type:'card',card_id:details.cardId}],intended_services:details.services});
      if(raw.id!==offerId||raw.live_mode!==this.live)throw new DomainError('Supplier returned a different offer or environment.',409);
      if(JSON.stringify(raw.intended_services??[])!==JSON.stringify(details.services))throw new DomainError('Supplier priced different ancillary selections.',409);
      const normalized=normalizeDuffelOffer(applyPurchasedBaggage(raw,details.services,available),request,originalOffer.passengerMap);
      const ranked=rankCandidates([composeOffer(normalized,request)],request);
      const eligible=ranked.complete[0]??(!this.live?ranked.incomplete.find(c=>!c.pricing.unknownComponents.length&&c.connections.every(x=>x.status==='verified')):null);
      if(!eligible)throw new DomainError('The whole itinerary, required baggage and all connections must have complete verified prices before booking.',409);
      const methods=raw.intended_payment_methods;
      if(!Array.isArray(methods)||methods.length!==1||methods[0].card_id!==details.cardId||methods[0].type!=='card')throw new DomainError('Supplier card pricing is not bound to this card.',409);
      const surcharge=moneyFromDecimal(methods[0].surcharge_amount,methods[0].surcharge_currency);
      const fare=moneyFromDecimal(raw.total_amount,raw.total_currency),charge=sumMoney([fare,surcharge]);
      if(!charge || (request.budget && (charge.currency!==request.budget.currency||charge.amount>request.budget.amount)))throw new DomainError('The complete card charge exceeds the budget or uses a different currency.',409);
      const candidate=eligible;
      return {id:offerId,expiresAt:Date.parse(raw.expires_at),charge,refund:null,terms:JSON.stringify({conditions:raw.conditions??null,paymentRequirements:raw.payment_requirements??null,fare,surcharge,services:details.services.map(s=>({...s,description:available.find(a=>a.id===s.id)}))}),itinerary:{services:candidate.services.map(s=>Object.fromEntries(Object.entries(s).filter(([k])=>k!=='source'))),ticketGroups:candidate.ticketGroups,passengerIds:normalized.passengerIds},complete:true,supplier:this.name,live:this.live,paymentAuthenticationRequired:true,supplierPayload:{offerId,passengerMap:originalOffer.passengerMap,services:details.services}};
    }
    if(kind==='cancel'||kind==='refund') {
      const current=await this.call('air/orders/'+resource(order.supplierReference,'ord'));
      if(current.id!==order.supplierReference||current.live_mode!==this.live||!current.available_actions?.includes('cancel'))throw new DomainError('Supplier does not permit cancellation of this order.',409);
      const cancellation=await this.call('air/order_cancellations','POST',{order_id:order.supplierReference});
      if(cancellation.order_id!==order.supplierReference||cancellation.live_mode!==this.live||!cancellation.expires_at)throw new DomainError('Supplier cancellation quote is incomplete.',409);
      return this.cancellationQuote(cancellation,order.itinerary);
    }
    unavailable('This servicing operation requires an approved and certified supplier workflow.');
  }
  cancellationQuote(c,itinerary) {
    const refund=c.refund_amount===null?null:moneyFromDecimal(c.refund_amount,c.refund_currency);
    if(!refund)throw new DomainError('Refund amount is not verified. Contact the supplier for cancellation review.',409);
    return {id:c.id,expiresAt:Date.parse(c.expires_at),charge:{...refund,amount:0},refund,terms:JSON.stringify({refundTo:c.refund_to,airlineCredits:c.airline_credits??[],cancellationId:c.id}),itinerary,complete:true,supplier:this.name,live:this.live,paymentAuthenticationRequired:false,supplierPayload:{cancellationId:c.id,orderId:c.order_id}};
  }
  async refreshQuote(review) {
    if(review.kind==='book')return this.quote({kind:'book',...review.source});
    if(review.kind==='exchange')return refreshChangeQuote(this,review);
    if(review.kind==='cancel'||review.kind==='refund'){const c=await this.call('air/order_cancellations/'+resource(review.quote.id,'ore'));if(c.id!==review.quote.id||c.order_id!==review.source.order.supplierReference||c.live_mode!==this.live||c.confirmed_at)throw new DomainError('Cancellation quote no longer matches the review.',409);return this.cancellationQuote(c,review.quote.itinerary);}
    unavailable('Servicing quote refresh is unavailable.');
  }
  async submit(op) {
    const review=op.reviewSnapshot;
    if(op.kind==='book') {
      const payload=review.quote.supplierPayload;
      const passengers=review.source.details.passengers.map(p=>({id:Object.keys(payload.passengerMap).find(id=>payload.passengerMap[id]===p.id),given_name:p.givenName,family_name:p.familyName,born_on:p.bornOn,title:p.title,gender:p.gender,email:p.email,phone_number:p.phone}));
      if(passengers.some(p=>!p.id))throw new DomainError('Supplier passenger references do not match.',409);
      const data=await this.call('air/orders','POST',{type:'instant',selected_offers:[payload.offerId],services:payload.services,passengers,metadata:{wayline_operation:op.supplierKey},payments:[{type:'card',amount:decimal(review.quote.charge),currency:review.quote.charge.currency,three_d_secure_session_id:op.paymentSessionId}]},{transaction:true});
      return this.orderOutcome(data,op);
    }
    if(op.kind==='exchange'){const q=review.quote;const data=await this.call(`air/order_changes/${resource(q.id,'oce')}/actions/confirm`,'POST',q.charge.amount>0?{payment:{type:'card',amount:decimal(q.charge),currency:q.charge.currency,three_d_secure_session_id:op.paymentSessionId}}:{},{transaction:true});return this.changedOrderOutcome(data,op);}
    if(op.kind==='cancel'||op.kind==='refund') {
      const data=await this.call(`air/order_cancellations/${resource(review.quote.id,'ore')}/actions/confirm`,'POST',undefined,{transaction:true});
      return {authoritative:!!data.confirmed_at&&data.id===review.quote.id&&data.order_id===review.source.order.supplierReference,supplier:this.name,live:data.live_mode,reference:data.order_id,paymentState:'refund-pending',ticketState:data.confirmed_at?'cancelled':'not-issued',documents:[]};
    }
    unavailable('Unsupported financial operation.');
  }
  orderOutcome(data,op) {
    if(!data?.id)return null;
    if(data.metadata?.wayline_operation!==op.supplierKey)return null;
    return {authoritative:true,supplier:this.name,live:data.live_mode,reference:data.id,paymentState:data.payment_status?.awaiting_payment===false?'captured':'not-confirmed',ticketState:data.documents?.some(d=>d.type==='electronic_ticket'&&d.unique_identifier)?'issued':'not-issued',documents:(data.documents??[]).map(d=>({type:d.type,reference:d.unique_identifier})),bookingReference:data.booking_reference};
  }
  async changedOrderOutcome(change,op) {
    const outcome=changedOutcome(this,change,op);if(!outcome.authoritative)return outcome;
    const order=await this.call('air/orders/'+resource(change.order_id,'ord'));
    if(order.id!==change.order_id||order.live_mode!==this.live)return null;
    const actual=supplierSlices(order.slices).flatMap(s=>s.services);
    const key=s=>[s.origin.iata,s.destination.iata,s.departure,s.arrival].join('|');
    const matches=JSON.stringify(actual.map(key))===JSON.stringify(op.reviewSnapshot.quote.itinerary.services.map(key));
    const documents=(order.documents??[]).filter(d=>d.type==='electronic_ticket'&&d.unique_identifier).map(d=>({type:d.type,reference:d.unique_identifier}));
    return {...outcome,ticketState:matches&&documents.length&&order.payment_status?.awaiting_payment===false?'exchanged':'not-issued',documents:matches?documents:[],bookingReference:order.booking_reference};
  }
  async changeOptions(order,input){return getChangeOptions(this,order,input);}
  async orderSections(order){const raw=await this.call('air/orders/'+resource(order.supplierReference,'ord'));if(raw.id!==order.supplierReference||raw.live_mode!==this.live)throw new DomainError('Different supplier order.',409);return supplierSlices(raw.slices);}
  async reconcile(op) {
    if(op.kind==='exchange')return this.changedOrderOutcome(await this.call('air/order_changes/'+resource(op.reviewSnapshot.quote.id,'oce')),op);
    if(op.kind==='cancel'||op.kind==='refund') {
      const c=await this.call('air/order_cancellations/'+resource(op.reviewSnapshot.quote.id,'ore'));
      return {authoritative:!!c.confirmed_at&&c.id===op.reviewSnapshot.quote.id&&c.order_id===op.reviewSnapshot.source.order.supplierReference,supplier:this.name,live:c.live_mode,reference:c.order_id,paymentState:'refund-pending',ticketState:c.confirmed_at?'cancelled':'not-issued',documents:[]};
    }
    if(op.supplierReference)return this.orderOutcome(await this.call('air/orders/'+resource(op.supplierReference,'ord')),op);
    const rows=await this.call('air/orders?offer_id='+encodeURIComponent(op.reviewSnapshot.quote.supplierPayload.offerId)+'&limit=200');
    const matches=Array.isArray(rows)?rows.filter(o=>o.metadata?.wayline_operation===op.supplierKey):[];
    return matches.length===1?this.orderOutcome(matches[0],op):null;
  }
}
