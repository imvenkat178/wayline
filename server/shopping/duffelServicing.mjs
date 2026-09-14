import {z} from 'zod';
import {DomainError} from '../domain/journeys.mjs';
import {localInstant} from './duffel.mjs';
import {moneyFromDecimal,serviceInstance} from './contracts.mjs';
const resource=(x,p)=>z.string().regex(new RegExp('^'+p+'_[a-zA-Z0-9_-]+$')).parse(x);
const fail=message=>{throw new DomainError(message,409,'SERVICING_REVIEW_REQUIRED');};
const endpoint=p=>({id:p.id,name:p.name,kind:'airport',lat:Number(p.latitude),lon:Number(p.longitude),country:p.iata_country_code,timezone:p.time_zone,iata:p.iata_code});
export function supplierSlices(slices,now=Date.now()) {
 const source={provider:'duffel',providerVersion:'v2',observedAt:new Date(now).toISOString(),receivedAt:new Date(now).toISOString()};
 return z.array(z.object({id:z.string(),segments:z.array(z.unknown()).min(1)})).min(1).max(6).parse(slices).map(slice=>({id:slice.id,services:slice.segments.map(s=>serviceInstance.parse({id:s.id,provider:'duffel',mode:'air',operator:s.operating_carrier.name,marketingOperator:s.marketing_carrier.name,serviceNumber:s.operating_carrier_flight_number,...(s.operating_carrier.iata_code?{operatingCarrierCode:s.operating_carrier.iata_code}:{}),serviceDate:s.departing_at.slice(0,10),origin:endpoint(s.origin),destination:endpoint(s.destination),departure:localInstant(s.departing_at,s.origin.time_zone),arrival:localInstant(s.arriving_at,s.destination.time_zone),source}))}));
}
export async function getChangeOptions(adapter,order,input) {
 if(!adapter.capabilities.exchange)throw new DomainError('Approved exchange access is unavailable.',501);
 const current=await adapter.call('air/orders/'+resource(order.supplierReference,'ord'));
 if(current.id!==order.supplierReference||current.live_mode!==adapter.live||!current.available_actions?.includes('change'))fail('Supplier does not permit changes to this order.');
 const requested=z.object({sliceId:z.string(),departureDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).strict().parse(input);
 const slices=supplierSlices(current.slices),slice=slices.find(s=>s.id===requested.sliceId);
 if(!slice||Date.parse(slice.services[0].departure)<=Date.now())fail('Choose an unstarted flight section owned by this order.');
 if(!Number.isFinite(Date.parse(requested.departureDate+'T12:00:00Z'))||new Date(requested.departureDate+'T12:00:00Z').toISOString().slice(0,10)!==requested.departureDate||requested.departureDate<new Date().toISOString().slice(0,10))fail('Choose a future replacement date.');
 const response=await adapter.call('air/order_change_requests','POST',{order_id:current.id,slices:{remove:[{slice_id:slice.id}],add:[{origin:slice.services[0].origin.iata,destination:slice.services.at(-1).destination.iata,departure_date:requested.departureDate,cabin_class:'economy'}]}});
 if(response.order_id!==current.id||response.live_mode!==adapter.live)fail('Supplier returned a different order or environment.');
 const result=response.order_change_offers?response:await adapter.call('air/order_change_requests/'+resource(response.id,'ocr'));
 if(result.order_id!==current.id||result.live_mode!==adapter.live)fail('Supplier returned an unrelated change request.');
 return {requestId:response.id,removedSliceId:slice.id,slices,offers:(result.order_change_offers??[]).filter(o=>o.live_mode===adapter.live&&Date.parse(o.expires_at)>Date.now()).slice(0,50).map(o=>({id:resource(o.id,'oco'),expiresAt:Date.parse(o.expires_at),changeAmount:o.change_total_amount,currency:o.change_total_currency,slices:supplierSlices(o.slices.add),conditions:o.conditions??null}))};
}
export function changeQuote(adapter,c,source) {
 if(c.order_id!==source.order.supplierReference||c.live_mode!==adapter.live||c.confirmed_at)fail('Change quote is unrelated, confirmed or in another environment.');
 if(!/^-?\d+(?:\.\d{1,2})?$/.test(c.change_total_amount))fail('Supplier change price is invalid.');
 const cost=moneyFromDecimal(c.change_total_amount.replace(/^-/,''),c.change_total_currency),negative=c.change_total_amount.startsWith('-');
 const added=supplierSlices(c.slices.add),removed=c.slices.remove.map(s=>s.id??s.slice_id);
 if(removed.length!==1||removed[0]!==source.changeSearch.removedSliceId)fail('Supplier changed a different flight section.');
 const slices=source.changeSearch.slices.flatMap(s=>removed.includes(s.id)?added:[s]);
 const services=slices.flatMap(s=>s.services).map(s=>Object.fromEntries(Object.entries(s).filter(([k])=>k!=='source')));
 for(const slice of slices)for(let i=1;i<slice.services.length;i++){const a=slice.services[i-1],b=slice.services[i];if(a.destination.iata!==b.origin.iata||Date.parse(b.departure)-Date.parse(a.arrival)<(Number.isFinite(source.order.connectionMinimumMinutes)&&source.order.connectionMinimumMinutes>0?source.order.connectionMinimumMinutes:Infinity)*60000)fail('Replacement connections need a fresh verified minimum connection time.');}
 for(let i=1;i<slices.length;i++)if(Date.parse(slices[i].services[0].departure)<=Date.parse(slices[i-1].services.at(-1).arrival))fail('Replacement overlaps another flight section.');
 if(services.some(s=>s.origin.country!=='US'||s.destination.country!=='US'))fail('Only US flight sections are supported.');
 const charge={...cost,amount:negative?0:cost.amount};
 if(charge.amount>0 && !source.changeCardId)fail('Prepare a temporary card for this exchange before requesting its exact review.');
 return {id:resource(c.id,'oce'),expiresAt:Date.parse(c.expires_at),charge,refund:negative?cost:null,terms:JSON.stringify({operation:'Exchange the selected flight section',conditions:source.changeOffer.conditions,penalty:moneyFromDecimal(c.penalty_total_amount,c.penalty_total_currency),refundTo:c.refund_to,newTotal:moneyFromDecimal(c.new_total_amount,c.new_total_currency)}),itinerary:{services,slices:slices.map(s=>({id:s.id,serviceIds:s.services.map(s=>s.id)})),ticketGroups:source.order.itinerary.ticketGroups},complete:true,supplier:adapter.name,live:adapter.live,paymentAuthenticationRequired:charge.amount>0,supplierPayload:{changeId:c.id,orderId:c.order_id,cardId:source.changeCardId}};
}
export async function createChangeQuote(adapter,source) {
 const pending=await adapter.call('air/order_changes','POST',{selected_order_change_offer:resource(source.changeOffer.id,'oco')});
 return changeQuote(adapter,pending,source);
}
export async function refreshChangeQuote(adapter,review) {
 return changeQuote(adapter,await adapter.call('air/order_changes/'+resource(review.quote.id,'oce')),review.source);
}
export function changedOutcome(adapter,c,op) {
 const q=op.reviewSnapshot.quote;
 return {authoritative:c.order_id===q.supplierPayload.orderId&&!!c.confirmed_at,supplier:adapter.name,live:c.live_mode,reference:c.order_id,paymentState:q.refund?'refund-pending':q.charge.amount>0?'captured':'not-required',ticketState:c.confirmed_at?'exchanged':'not-issued',documents:[]};
}
