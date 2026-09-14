import { workspaceReviewBinding, assertWorkspaceReview } from "./workspaceBinding.mjs";
import { flightGroundConnections } from "./groundConnections.mjs";
import { randomUUID } from "node:crypto";
import { DomainError } from "../domain/journeys.mjs";
import { enqueueJob } from "../jobs.mjs";
import { searchRequest, capabilitySet, rankCandidates } from "./contracts.mjs";
import { duffelCapabilities, localDate } from "./duffel.mjs";
import { compareOffers, offerFingerprint, composeOffer } from "./composer.mjs";

export function shoppingCapabilities({bookingAdapter,flightStatusProvider,groundProvider,flightShoppingCapabilities}={}) {
 const flight=flightShoppingCapabilities??duffelCapabilities(),bookingAllowed=bookingAdapter?.authorized===true;
 const booking=Object.fromEntries(['book','cancel','exchange','refund'].map(k=>[k,bookingAllowed&&bookingAdapter.capabilities?.[k]===true]));
 const groundAllowed=!!groundProvider?.transport&&groundProvider.contract?.usInventoryGranted===true&&!!groundProvider.contract?.documentationVersion;
 const statusAllowed=flightStatusProvider?.license?.statusAllowed===true;
 return {providers:[{...flight,capabilities:{...flight.capabilities,...booking},bookingEnvironment:bookingAllowed?(bookingAdapter.live?'authorized-live':'supplier-test'):null},
 {provider:'intercity-ground',configured:groundAllowed,reason:groundAllowed?null:'Distribusion partner documentation and contracted US inventory are required.',capabilities:capabilitySet({search:groundAllowed,...(groundAllowed?groundProvider.contract.operations:{})})},
 {provider:'flight-status',configured:statusAllowed,reason:statusAllowed?null:'A licensed flight status provider is required.',capabilities:capabilitySet({getStatus:statusAllowed})}],
 transactionsEnabled:Object.values(booking).some(Boolean),scope:'Domestic US economy. Mandatory transport and baggage costs must be known for a complete-price comparison.',
 comparisonClaim:'Lowest complete price found within the selected providers, endpoints, dates and returned offers.'};
}
export function searchFamilies(request) {
  const from=request.origin.kind==="airport"?[request.origin.iata,...request.originAirports]:request.originAirports;
  const to=request.destination.kind==="airport"?[request.destination.iata,...request.destinationAirports]:request.destinationAirports;
  const dates=[...new Set([localDate(request.departure,request.origin.timezone),...request.flexibleDates])];
  const all=[...new Set(from)].flatMap(origin=>[...new Set(to)].flatMap(destination=>dates.map(date=>({origin,destination,date}))));
  return {families:all.slice(0,6),omitted:Math.max(0,all.length-6)};
}
export function createShoppingSearch(store,userId,input,{key=randomUUID(),background=false,capabilities=duffelCapabilities()}={}) {
  const parsed=searchRequest.safeParse(input);
  if(!parsed.success)throw new DomainError(parsed.error.issues[0]?.message??"Invalid comparison request",400,"INVALID_SHOPPING_REQUEST");
  const request=parsed.data;
  if(Date.parse(request.departure)<=Date.now())throw new DomainError("Choose a future departure.");
  if(!request.modes.includes("air"))throw new DomainError("Use the Boston planner for a ground-only search.");
  if(background&&!capabilities.capabilities.backgroundShoppingAllowed)throw new DomainError("This supplier does not permit background shopping.",409,"BACKGROUND_NOT_PERMITTED");
  if(typeof key!=="string"||key.length>100)throw new DomainError("Invalid request key");
  const {families,omitted}=searchFamilies(request);
  if(!families.length)throw new DomainError("Choose airports explicitly for both ends.");
  return store.transaction(()=>{
    const existing=store.list(userId,"shopping-search").find(s=>s.key===key);
    if(existing) {
      if(JSON.stringify(existing.request)!==JSON.stringify(request))throw new DomainError("Request key already used for another search.",409);
      return existing;
    }
    if(store.list(userId,"shopping-search").filter(s=>s.state==="queued"||s.state==="partial").length>=3)
      throw new DomainError("Finish or cancel an active comparison first.",429);
    const search=store.put(userId,"shopping-search",{key,request,background,state:capabilities.configured?"queued":"blocked",
      reason:capabilities.configured?null:capabilities.reason,scope:{provider:"duffel",families,omitted,offerLimitPerQuery:50},
      queries:families.map((f,i)=>({...f,index:i,state:"queued"})),offers:[],results:{complete:[],incomplete:[],excluded:[]}},
      {expiresAt:Date.now()+3600000});
    if(capabilities.configured)for(let index=0;index<families.length;index++)
      enqueueJob(store,"shopping-query",{userId,searchId:search.id,index},{userId,maxAttempts:2,runAt:Date.now()+index*15000});
    return search;
  });
}
export function shoppingSearchView(store,userId,id) {
  const search=store.get(userId,id,"shopping-search");
  return {...search,results:compareOffers(search.offers,search.request,Date.now(),search.connectors??{})};
}
export function cancelShoppingSearch(store,userId,id,version) {
  return store.transaction(()=>{
    const s=store.get(userId,id,"shopping-search");
    if(s.state==="cancelled")return s;
    if(s.version!==version)throw new DomainError("Search changed. Refresh first.",409);
    const next=store.put(userId,"shopping-search",{...s,state:"cancelled"},{id,expectedVersion:version});
    store.db.prepare("UPDATE jobs SET status='cancelled' WHERE kind IN ('shopping-query','shopping-connection') AND user_id=? AND json_extract(payload,'$.searchId')=? AND status='pending'").run(userId,id);
    return next;
  });
}
export async function runShoppingQuery(store,travel,{userId,searchId,index},canCommit=()=>true) {
  let search;
  try {search=store.get(userId,searchId,"shopping-search");} catch {return;}
  if(["cancelled","blocked","failed","complete"].includes(search.state)||search.queries[index]?.state!=="queued")return;
  const query=search.queries[index];
  let result,error;
  try {
    result=await travel.call("flight_search",{request:search.request,origin:query.origin,destination:query.destination,date:query.date});
  } catch(e) {error={code:e.code??"FLIGHT_PROVIDER_UNAVAILABLE",message:"Flight search could not complete. Retry this comparison."};}
  if(!canCommit())return;
  store.transaction(()=>{
    let current;try{current=store.get(userId,searchId,"shopping-search");}catch{return;}
    if(current.state==="cancelled"||current.queries[index]?.state!=="queued")return;
    const queries=current.queries.map((q,i)=>i===index?{...q,state:error?"failed":"complete",error,observedAt:result?.fetchedAt}:q);
    const offers=[...new Map([...current.offers,...(result?.offers??[])].map(o=>[o.id,o])).values()];
    const remaining=queries.some(q=>q.state==="queued"),failures=queries.filter(q=>q.state==="failed").length;
    const needsConnections=[current.request.origin,current.request.destination,...(current.request.additionalSlices??[]).flatMap(s=>[s.origin,s.destination])].some(p=>p.kind!=='airport');
    const connectionQueries=needsConnections?offers.map(o=>{const fingerprint=offerFingerprint(o),old=current.connectionQueries?.find(q=>q.offerId===o.id&&q.fingerprint===fingerprint);return old??{offerId:o.id,state:'queued',fingerprint};}):[];
    for(const q of connectionQueries.filter(q=>q.state==='queued'&&!(current.connectionQueries??[]).some(old=>old.offerId===q.offerId&&old.fingerprint===q.fingerprint)))enqueueJob(store,'shopping-connection',{userId,searchId,offerId:q.offerId},{userId,maxAttempts:2});
    const state=remaining||connectionQueries.some(q=>q.state==='queued')?"partial":failures===queries.length?"failed":failures?"partial-failure":"complete";
    store.put(userId,"shopping-search",{...current,queries,offers,state,connectionQueries,results:compareOffers(offers,current.request,Date.now(),current.connectors??{}),
      completedAt:remaining?null:new Date().toISOString(),reason:failures?"Some selected searches could not complete.":null},
      {id:searchId,expectedVersion:current.version});
  });
}
export async function reviewOffer(store,userId,searchId,offerId,travel) {
  const search=store.get(userId,searchId,"shopping-search");
  if(search.state==="cancelled")throw new DomainError("Search was cancelled.",409);
  const original=search.offers.find(o=>o.id===offerId);
  if(!original)throw new DomainError("Offer not found in this account's search.",404);
  if(Date.parse(original.expiresAt)<=Date.now())throw new DomainError("Offer expired. Search again.",409);
  const binding=workspaceReviewBinding(store,userId,search,offerId);
  const data=await travel.call("flight_refresh",{offer:original,request:search.request});
  const connectors=await flightGroundConnections(data.offer,search.request,travel);
  return store.transaction(()=>{
    const current=store.get(userId,searchId,"shopping-search");
    if(current.state==="cancelled")throw new DomainError("Search was cancelled.",409);
    const next=data.offer;
    const comparison=rankCandidates([composeOffer(next,current.request,connectors)],current.request);
    const changed=offerFingerprint(next)!==offerFingerprint(original);
    const candidate=comparison.complete[0]??comparison.incomplete[0]??null;
    assertWorkspaceReview(store,userId,{...binding,searchId,offer:next,candidate});
    const review=store.put(userId,"shopping-review",{...binding,searchId,offer:next,request:current.request,changed,
      candidate:comparison.complete[0]??comparison.incomplete[0]??null,excluded:comparison.excluded,
      state:"review",expiresAt:Math.min(Date.parse(next.expiresAt),Date.now()+300000),
      notice:changed?"Price, conditions or itinerary changed. Review the refreshed details.":"Supplier offer refreshed. Review the itinerary and all required costs.",
      inventoryHeld:false,ticketIssued:false},{expiresAt:Date.now()+86400000});
    return review;
  });
}
export async function confirmComparison(store,userId,id,travel) {
  const review=store.get(userId,id,"shopping-review");
  if(review.state==="confirmed")return store.get(userId,review.planId,"travel-comparison");
  assertWorkspaceReview(store,userId,review);
  if(review.expiresAt<=Date.now())throw new DomainError("Review expired. Refresh the offer.",409);
  if(!review.candidate)throw new DomainError("This offer no longer meets your constraints.",409);
  const search=store.get(userId,review.searchId,"shopping-search");
  if(search.state==="cancelled")throw new DomainError("Search was cancelled.",409);
  const data=await travel.call("flight_refresh",{offer:review.offer,request:review.request});
  const connectors=await flightGroundConnections(data.offer,review.request,travel);
  const candidate=composeOffer(data.offer,review.request,connectors);
  const checked=rankCandidates([candidate],review.request);
  const reviewedCandidate=checked.complete[0]??checked.incomplete[0];
  if(!reviewedCandidate || offerFingerprint(reviewedCandidate)!==offerFingerprint(review.candidate))throw new DomainError("A price or connection changed. Request a new review.",409,"CONNECTION_CHANGED");
  if(offerFingerprint(data.offer)!==offerFingerprint(review.offer))throw new DomainError("The offer changed again. Request a new review.",409,"OFFER_CHANGED");
  return store.transaction(()=>{
    const latest=store.get(userId,id,"shopping-review");
    if(latest.state==="confirmed")return store.get(userId,latest.planId,"travel-comparison");
    if(latest.expiresAt<=Date.now()||store.get(userId,latest.searchId,"shopping-search").state==="cancelled")
      throw new DomainError("Review or search expired.",409);
    assertWorkspaceReview(store,userId,latest,reviewedCandidate);
    const plan=store.put(userId,"travel-comparison",{...(latest.conversationId?{conversationId:latest.conversationId}:{}),request:latest.request,offer:data.offer,
      candidate:reviewedCandidate,state:"saved",bookingConfirmed:false,inventoryHeld:false,priceValidUntil:data.offer.expiresAt},
      {expiresAt:Date.now()+(store.user(userId).preferences.saveHistory===false ? 3600000 : Math.max(1,Math.min(7,store.user(userId).preferences.historyDays??7))*86400000)});
    store.put(userId,"shopping-review",{...latest,state:"confirmed",planId:plan.id},{id,expectedVersion:latest.version});
    if(latest.conversationId) {
      const conversation=store.get(userId,latest.conversationId,"conversation");
      store.put(userId,"conversation",{...conversation,comparisonId:plan.id},{id:conversation.id,expectedVersion:conversation.version});
    }
    return plan;
  });
}

export async function runShoppingConnections(store,travel,{userId,searchId,offerId},canCommit=()=>true) {
 let search;try{search=store.get(userId,searchId,'shopping-search');}catch{return;}
 if(search.state==='cancelled'||!search.connectionQueries?.some(q=>q.offerId===offerId&&q.state==='queued'))return;
 const offer=search.offers.find(o=>o.id===offerId);if(!offer)return;
 const connectors=await flightGroundConnections(offer,search.request,travel);
 if(!canCommit())return;
 return store.transaction(()=>{
  let current;try{current=store.get(userId,searchId,'shopping-search');}catch{return;}
  if(current.state==='cancelled'||!current.connectionQueries?.some(q=>q.offerId===offerId&&q.state==='queued'&&q.fingerprint===offerFingerprint(offer)))return;
  const next=current.connectionQueries.map(q=>q.offerId===offerId?{...q,state:'complete'}:q),all={...current.connectors,[offerId]:connectors};
  const remaining=current.queries.some(q=>q.state==='queued')||next.some(q=>q.state==='queued'),failed=current.queries.some(q=>q.state==='failed');
  return store.put(userId,'shopping-search',{...current,connectors:all,connectionQueries:next,state:remaining?'partial':failed?'partial-failure':'complete',results:compareOffers(current.offers,current.request,Date.now(),all),completedAt:remaining?null:new Date().toISOString()},{id:searchId,expectedVersion:current.version});
 });
}
