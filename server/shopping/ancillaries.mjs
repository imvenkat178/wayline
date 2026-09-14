import {z} from 'zod';
import {DomainError} from '../domain/journeys.mjs';
import {moneyFromDecimal} from './contracts.mjs';
const schema=z.object({id:z.string().regex(/^ase_[a-zA-Z0-9_-]+$/),type:z.string(),maximum_quantity:z.number().int().min(1).max(9),total_amount:z.string(),total_currency:z.string(),passenger_ids:z.array(z.string()).min(1),segment_ids:z.array(z.string()).min(1),metadata:z.record(z.unknown()).optional()});
export async function availableBookingServices(adapter,offerId){
 const raw=await adapter.call('air/offers/'+encodeURIComponent(offerId)+'?return_available_services=true');
 if(raw.id!==offerId||raw.live_mode!==adapter.live)throw new DomainError('Supplier service list belongs to a different offer.',409);
 return (raw.available_services??[]).map(s=>schema.parse(s)).map(s=>({...s,price:moneyFromDecimal(s.total_amount,s.total_currency)}));
}
export function applyPurchasedBaggage(raw,selected,available){
 if(new Set(selected.map(s=>s.id)).size!==selected.length)throw new DomainError('Select each ancillary once.',409);
 const copy=structuredClone(raw);
 for(const chosen of selected){
  const service=available.find(s=>s.id===chosen.id);
  if(!service||chosen.quantity>service.maximum_quantity)throw new DomainError('Ancillary selection is unavailable or exceeds its quantity limit.',409);
  if(service.type!=='baggage'||!['checked','carry_on'].includes(service.metadata?.type))continue;
  for(const segment of copy.slices.flatMap(s=>s.segments)){
   if(!service.segment_ids.includes(segment.id))continue;
   for(const passenger of segment.passengers){
    if(!service.passenger_ids.includes(passenger.passenger_id))continue;
    passenger.baggages??=[];const baggage=passenger.baggages.find(b=>b.type===service.metadata.type);
    if(baggage)baggage.quantity+=chosen.quantity;else passenger.baggages.push({type:service.metadata.type,quantity:chosen.quantity});
   }
  }
 }
 return copy;
}
