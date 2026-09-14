import {knowledgeAnswer,flightEvidence,stationEvidence} from './travelEvidence.mjs';
import { actionById } from '../../shared/travelerActions.mjs';
import { createToolRunner } from './agentTools.mjs';
import { shoppingCapabilities } from '../shopping/service.mjs';
export async function travelerActionResult(store,userId,c,draft,command,travel,input = '') {
  if(command.op==='advice' && /status|delay|gate|cancelled|canceled/i.test(input))command={op:'trip_status'};
  const action=actionById[command.op];
  const response={reply:action.description,mode:'Trip workspace',intent:command.op,actions:[],results:[],setIds:[],pendingActions:[],workflowEvidence:[]};
  if(action.capability==='form') {
    response.protectedPanel=command.op;
    response.reply='Use the controls below to '+action.description.charAt(0).toLowerCase()+action.description.slice(1)+'. Form values stay outside the language model.';
    return response;
  }
  if(action.capability==='transaction') {
    response.protectedPanel=command.op;
    response.reply='A fresh supplier quote and your confirmation of its exact review are required. The protected form checks supplier access and eligibility. No purchase, cancellation, exchange or refund has been submitted.';
    response.providerReadiness=shoppingCapabilities(travel);
    return response;
  }
  if(command.op==='clarify') {
    response.reply='Please specify the action or option you mean. To purchase, cancel, exchange or request a refund, open and confirm the exact transaction review.';
    response.clarification={version:1,kind:'action-or-reference',question:response.reply};
    return response;
  }
  if(command.op==='ticket_receipt'){
    const orders=store.list(userId,'supplier-order').filter(o=>o.conversationId===c.id);
    if(orders.length){response.documents=orders.map(o=>({label:(o.live?'':'Test environment - ')+'Download booking payment record '+(o.bookingReference??o.supplierReference),url:'/api/shopping/orders/'+encodeURIComponent(o.id)+'/receipt'}));response.workflowEvidence=orders.map(o=>({label:o.bookingReference??o.supplierReference,value:'Payment: '+o.paymentState+'; tickets: '+o.ticketState,source:o.supplier+' operation records'+(o.live?'':' (test inventory)'),observedAt:o.observedAt??o.updatedAt}));response.reply='Your booking payment records include confirmed charges and separately tracked refund requests. They are Wayline records of supplier responses, not original supplier-issued receipts.';return response;}
  }
  if(['export_calendar','export_pdf'].includes(command.op)&&c.comparisonId){
    const plan=store.get(userId,c.comparisonId,'travel-comparison');
    response.documents=[{label:action.description,url:'/api/shopping/saved/'+encodeURIComponent(plan.id)+'/'+(command.op==='export_pdf'?'itinerary.pdf':'calendar')}];
    response.reply='Your saved flight comparison is ready to download. It is an itinerary snapshot, not a purchase or issued ticket.';return response;
  }
  if(['export_calendar','export_pdf','ticket_receipt'].includes(command.op)) {
    if(!c.journeyId) {response.reply='Save and link a journey first, then request this document. A saved itinerary receipt does not prove a supplier purchase.';return response;}
    const j=store.get(userId,c.journeyId,'journey');
    const file={export_calendar:'calendar',export_pdf:'itinerary.pdf',ticket_receipt:'receipt'}[command.op];
    response.documents=[{label:action.description,url:`/api/journeys/${encodeURIComponent(j.id)}/${file}`}];
    response.reply='Your saved journey document is ready. Supplier-issued tickets and payment receipts are separately identified in your bookings.';
    return response;
  }
  if(command.op==='order_status') {
    const orders=store.list(userId,'supplier-order'), operations=store.list(userId,'booking-operation');
    response.workflowEvidence=[...orders,...operations].map(o=>({label:o.supplierReference ?? o.id,value:`${o.state}; payment: ${o.paymentState ?? 'unknown'}; tickets: ${o.ticketState ?? 'unknown'}`,source:'Supplier operation records'+(o.live===false?' (test inventory - no real ticket)':o.live===true?'':' (environment unverified)'),observedAt:o.observedAt??o.lastObservedAt??o.updatedAt}));
    response.reply=response.workflowEvidence.length?'Here are the recorded booking outcomes. Pending payments or submissions are not ticket issuance.':'No supplier orders are recorded. Saved plans, comparisons and imported tickets are separate from supplier bookings.';
    return response;
  }
  if(command.op==='station_guidance'){const answer=await stationEvidence(draft,travel,input);return {...response,reply:answer.reply,workflowEvidence:answer.evidence};}
  if(command.op==='trip_status'&&draft.constraints.mode==='flights'){const answer=await flightEvidence(store,userId,draft,travel);return {...response,reply:answer.reply,workflowEvidence:answer.evidence,protectedPanel:'trip_status'};}
  if(command.op==='travel_weather'&&draft.constraints.mode==='flights'&&draft.selected?.flight){const services=draft.selected.flight.services,point=/destination|arrival/i.test(input)?services.at(-1).destination:services[0].origin;const data=await travel.call('weather',{lat:point.lat,lon:point.lon});return {...response,reply:'Latest available forecast at '+point.name+'. A forecast does not establish a service disruption.',results:[{type:'weather',...data}],workflowEvidence:[{label:'Forecast location',value:point.name,source:data.source,observedAt:data.fetchedAt}]};}
  if(command.op==='advice' && !(/fare|included|this option/i.test(input)&&draft.selected)){const answer=knowledgeAnswer(input);return {...response,reply:answer.reply,workflowEvidence:answer.evidence};}
  if(['trip_status','travel_weather'].includes(command.op)) {
    if(c.journeyId && draft.constraints.mode!=='flights') {
      const result=await createToolRunner({store,userId,travel,context:{journeyId:c.journeyId}})({input:command.op==='travel_weather'?'Check weather':'Check live status',provider:null});
      if(result)return {...response,...result};
    }
    response.reply=command.op==='trip_status'?'Flight status, gate changes and historical reliability require a licensed status provider and observations. No operational status is inferred from shopping offers.':'Weather needs a saved journey with a resolved location and a current weather response.';
    return response;
  }
  const set=draft.selected?.setId?store.get(userId,draft.selected.setId,'candidate-set'):draft.activeSetId?store.get(userId,draft.activeSetId,'candidate-set'):null;
  if(set) {
    response.setIds=[set.id];
    if(draft.selected)response.comparison=[{setId:set.id,optionId:draft.selected.optionId}];
    response.workflowEvidence=[{label:'Search coverage',value:set.source,source:set.source,observedAt:set.fetchedAt},{label:'Reliability',value:set.reliabilityNotice,source:'Connection checks; no historical observation dataset',observedAt:set.fetchedAt}];
    response.reply='The cards below contain the recorded '+(draft.constraints.mode==='flights'?'airport-to-airport ':'')+'fares, baggage, conditions and connection checks. Unknown costs and unavailable operational facts remain marked as unknown. Ask for a scenario to evaluate a possible change.';
  } else response.reply='Tell me your route and departure to find options, or use the traveler tools below. Current fares, status, weather and boarding details require retrieved provider evidence.';
  if(command.op==='station_guidance') response.reply='Station and airport guidance must match the exact facility and current source. Select a journey or specify the station; no gate or accessibility details are inferred.';
  return response;
}
