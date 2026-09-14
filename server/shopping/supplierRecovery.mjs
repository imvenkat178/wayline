import {z} from 'zod';
import {DomainError} from '../domain/journeys.mjs';
import {createShoppingSearch,shoppingSearchView} from './service.mjs';
import {serviceIdentity} from './connections.mjs';
import {storeFlightObservation} from './providerContracts.mjs';
import {moneySchema,searchRequest,totalPrice} from './contracts.mjs';
import {orderEconomics} from './paymentHistory.mjs';
const inputSchema=z.object({orderVersion:z.number().int(),completedCount:z.number().int().min(0),destinationIndex:z.number().int().min(0),readyAt:z.string().datetime({offset:true}),confirmedPosition:z.literal(true),cashCap:moneySchema.nullable().default(null),arrivalDeadline:z.string().datetime({offset:true}).optional()}).strict();
export async function prepareSupplierRecovery(store,userId,orderId,input,travel,{now=Date.now()}={}) {
 const order=store.get(userId,orderId,'supplier-order'),value=inputSchema.parse(input),services=(order.itinerary?.services??[]).filter(s=>s.mode==='air');
 if(order.version!==value.orderVersion)throw new DomainError('The order changed. Refresh before preparing recovery.',409);
 if(!order.servicingAuthority||!order.supplierReference||!services.length||!order.searchRequest)throw new DomainError('Recovery requires a supplier-backed itinerary and its original passenger requirements.',409);
 if(value.completedCount>=services.length||value.destinationIndex<value.completedCount||value.destinationIndex>=services.length)throw new DomainError('Choose the reached airport and a remaining destination.');
 if(!travel.flightStatusProvider?.license?.statusAllowed)throw new DomainError('Recovery needs approved FlightAware status access. No disruption or completed travel is inferred from schedules.',503,'FLIGHT_STATUS_UNAVAILABLE');
 if(Date.parse(value.readyAt)<now||Date.parse(value.readyAt)>now+3*86400000)throw new DomainError('Choose your earliest boarding-ready time within the next three days.');
 if(value.cashCap&&value.cashCap.currency!==order.searchRequest.currency)throw new DomainError('The extra-cash limit must use the booking currency.');
 const completed=services.slice(0,value.completedCount),observations=[];
 for(const service of services.slice(0,value.destinationIndex+1)){
  const observation=await travel.flightStatusProvider.status(service);
  if(observation.serviceIdentity!==serviceIdentity(service)||observation.origin!==service.origin.iata||observation.destination!==service.destination.iata||Date.parse(observation.scheduledDeparture)!==Date.parse(service.departure))throw new DomainError('A status response does not match the exact booked service.',409);
  storeFlightObservation(store,userId,serviceIdentity(service),observation,{license:travel.flightStatusProvider.license,now});
  if(now-Date.parse(observation.observedAt)>5*60000)throw new DomainError('Fresh observations are required for recovery.',409);
  observations.push(observation);
 }
 if(completed.some((s,i)=>observations[i].status!=='arrived'||!observations[i].actualArrival||Date.parse(observations[i].actualArrival)>now))throw new DomainError('A claimed completed flight has no verified arrival. Refresh your reached-airport choice.',409);
 const origin=completed.at(-1)?.destination??services[0].origin,destination=services[value.destinationIndex].destination;
 if(origin.id===destination.id)throw new DomainError('Choose a different remaining destination.');
 const old=order.searchRequest;
 const request=searchRequest.parse({...old,origin,destination,departure:value.readyAt,latestDeparture:new Date(Date.parse(value.readyAt)+23*3600000).toISOString(),returnDate:undefined,additionalSlices:[],originAirports:[],destinationAirports:[],flexibleDates:[],budget:value.cashCap,emergencyCashCap:value.cashCap,deadline:value.arrivalDeadline,modes:['air']});
 if(store.get(userId,orderId,'supplier-order').version!==order.version)throw new DomainError('The order changed while checking status.',409);
 const search=createShoppingSearch(store,userId,request,{capabilities:travel.flightShoppingCapabilities});
 return store.put(userId,'supplier-recovery',{schemaVersion:1,orderId,orderVersion:order.version,conversationId:order.conversationId,searchId:search.id,confirmedPosition:{place:origin,readyAt:value.readyAt,confirmedAt:new Date(now).toISOString(),source:'Traveler confirmation'},completedServices:completed,observations,originalTicketGroups:order.itinerary.ticketGroups??[],originalDocuments:order.documents??[],verifiedUsableTicketIds:[],economics:orderEconomics(order),destination,createdAt:new Date(now).toISOString(),expiresAt:now+15*60000,state:'planning',notice:'This searches a separate replacement ticket. Completed travel and the original order are preserved. Original ticket usability and airport procedures are not inferred; boarding readiness is your confirmation. Refunds and credits do not reduce the new charge unless explicitly applied by a fresh supplier quote.'},{expiresAt:now+15*60000});
}
export function recoveryDraftEligible(candidate) {
 if(!candidate||candidate.connections.some(c=>c.status!=='verified'))return false;
 const travel=totalPrice(candidate.components.filter(c=>!(c.id.endsWith(':payment-fee')&&c.label==='Card payment surcharge (requires a protected card quote)'&&c.money===null)));
 return travel.total!==null&&(travel.complete||candidate.live===false);
}
export function supplierRecoveryView(store,userId,id) {
 const recovery=store.get(userId,id,'supplier-recovery'),order=store.get(userId,recovery.orderId,'supplier-order');
 if(order.version!==recovery.orderVersion)throw new DomainError('The original order changed. Prepare recovery again.',409);
 const search=shoppingSearchView(store,userId,recovery.searchId);
 return {...recovery,search:{id:search.id,state:search.state,reason:search.reason,scope:search.scope},options:[...search.results.complete,...search.results.incomplete].map(candidate=>({candidate,planningEligible:recoveryDraftEligible(candidate),cashRequiredNow:candidate.pricing.total,previousSpending:recovery.economics.find(e=>e.currency===(candidate.pricing.total?.currency??search.request.currency))?.previousSpending??null,refundsReceived:recovery.economics.find(e=>e.currency===(candidate.pricing.total?.currency??search.request.currency))?.refundsReceived??null,refundsPending:recovery.economics.find(e=>e.currency===(candidate.pricing.total?.currency??search.request.currency))?.refundsPending??null,creditsApplied:null}))};
}

export async function createRecoveryDraft(store,userId,recoveryId,candidateId) {
 const {createConversation,workspaceSnapshot}=await import('../domain/tripWorkspace.mjs');
 const {putFlightSet}=await import('../domain/workspaceFlights.mjs');
 return store.transaction(()=>{
  const view=supplierRecoveryView(store,userId,recoveryId),candidate=view.options.find(o=>o.candidate.id===candidateId)?.candidate;
  if(!recoveryDraftEligible(candidate))throw new DomainError('Choose a replacement with priced travel and verified connections. Any card surcharge will be quoted before purchase review.',409);
  if(view.draftConversationId&&view.draftCandidateId===candidateId)return workspaceSnapshot(store,userId,view.draftConversationId);
  const source=store.get(userId,view.searchId,'shopping-search'),r=source.request,w=createConversation(store,userId);
  const airports=[...new Map(candidate.services.flatMap(s=>[s.origin,s.destination]).map(p=>[p.id,p])).values()];
  for(const airport of airports)store.put(userId,'airport-reference',{airport,source:'Verified supplier itinerary',observedAt:new Date().toISOString()},{expiresAt:Date.now()+86400000});
  const constraints={...w.draft.constraints,mode:'flights',from:r.origin.iata,to:r.destination.iata,departure:r.departure,deadline:r.deadline??null,timezone:r.origin.timezone,flightWindowHours:23,passengers:r.passengers,travelers:r.passengers.length,bags:r.passengers.reduce((n,p)=>n+p.cabin+p.checked,0),resolvedAirports:airports,avoidOvernight:!r.allowOvernight,preferences:{...w.draft.constraints.preferences,budgetCents:r.budget?.amount??0,maxTransfers:r.maxTransfers,maxWalkMinutes:r.maxWalkMinutes,wheelchair:r.wheelchair,stepFree:r.wheelchair}};
  const search=store.put(userId,'shopping-search',{...source,conversationId:w.conversation.id,workspaceConstraints:constraints,key:'recovery:'+recoveryId+':'+w.conversation.id},{expiresAt:view.expiresAt});
  const set=putFlightSet(store,userId,w.conversation,{...search,results:source.results},constraints,[],w.draft.version);
  const option=set.options.find(o=>o.flight.id===candidateId);if(!option)throw new DomainError('The replacement no longer meets the draft constraints.',409);
  store.put(userId,'trip-draft',{...w.draft,constraints,activeShoppingId:search.id,activeSetId:set.id,selected:{setId:set.id,optionId:option.id,flight:option.flight,journey:option.journey}},{id:w.draft.id,expectedVersion:w.draft.version});
  store.put(userId,'conversation',{...w.conversation,title:'Recovery: '+r.origin.iata+' to '+r.destination.iata,recoveryId},{id:w.conversation.id,expectedVersion:w.conversation.version});
  const recovery=store.get(userId,recoveryId,'supplier-recovery');
  store.put(userId,'supplier-recovery',{...recovery,draftConversationId:w.conversation.id,draftCandidateId:candidateId},{id:recoveryId,expectedVersion:recovery.version,expiresAt:recovery.expiresAt});
  return workspaceSnapshot(store,userId,w.conversation.id);
 });
}
export function recoveryBookingBinding(store,userId,conversation,candidate) {
 if(!conversation.recoveryId)return null;
 const view=supplierRecoveryView(store,userId,conversation.recoveryId);
 if(view.draftConversationId!==conversation.id||view.draftCandidateId!==candidate.id)throw new DomainError('Prepare a fresh recovery draft for this replacement.',409);
 return {recoveryId:view.id,originalOrderId:view.orderId,originalOrderVersion:view.orderVersion,completedServices:view.completedServices,economics:view.economics,originalTicketGroups:view.originalTicketGroups,verifiedUsableTicketIds:view.verifiedUsableTicketIds,boardingReadiness:view.confirmedPosition,notice:view.notice};
}
