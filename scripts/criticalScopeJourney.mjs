import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function scopeClarificationJourney(f,j) {
 const id=f.w.conversation.id,path='/api/conversations/'+id;
 const day=new Date(Date.now()+30*86400000).toISOString().slice(0,10),end=new Date(Date.now()+35*86400000).toISOString().slice(0,10),alternate=new Date(Date.now()+31*86400000).toISOString().slice(0,10);
 async function turn(input,expectedAction,{clarification=false}={}) {
  const before=(await f.call(path)).value,started=Date.now();
  const response=await f.call(path+'/turns',{input,expectedVersion:before.draft.version,clientTurnId:randomUUID()});
  const w=response.value,e=w.execution;
  j.steps.push({input,planned:e?.plan?.map(p=>p.op),actual:e?.steps?.map(s=>s.request.command.op),modelCalls:e?.inference?.modelCalls,source:e?.inference?.source,latencyMs:Date.now()-started,state:e?.state});
  assert.equal(response.status,200);assert.equal(e.state,'completed',JSON.stringify(e));assert.equal(e.inference.source,'llama');assert.ok(e.inference.modelCalls>=1);
  if(clarification){assert.equal(e.needsInput,true);assert.equal(w.draft.version,before.draft.version);}else assert.ok(e.steps.some(s=>s.request.command.op===expectedAction),JSON.stringify(e.plan));
  return w;
 }
 let w=await turn('Find round-trip flights from BOS to JFK on '+day+' at 9 am','search_options',{clarification:true});
 assert.equal(w.conversation.clarification.field,'returnDate');
 const reloaded=(await f.call(path)).value;assert.equal(reloaded.conversation.clarification.id,w.conversation.clarification.id);
 w=await turn(end,'search_options');assert.equal(w.draft.constraints.returnDate,end);assert.equal(w.draft.constraints.from,'BOS');assert.equal(w.draft.constraints.to,'JFK');
 w=await turn('Also check '+alternate,'update_constraints');assert.deepEqual(w.draft.constraints.flexibleDates,[alternate]);
 w=await turn('Also arrive at LGA','update_constraints');assert.deepEqual(w.draft.constraints.destinationAirports,['LGA']);
 // A complete new multi-city scope is a single itinerary with ordered sections.
 w=await turn('Search multi-city: BOS to JFK on '+day+' at 9 am; JFK to BOS on '+end+' at 9 am','search_options');
 assert.equal(w.draft.constraints.additionalFlights[0].to,'BOS');assert.equal(w.draft.constraints.returnDate,null);
 const before=JSON.stringify(w.draft.constraints);
 w=await turn('What if I return on '+end+'?','branch_scenario');assert.equal(JSON.stringify(w.draft.constraints),before);
 assert.equal(f.state.submitted,0);
}
