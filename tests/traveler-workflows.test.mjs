import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.mjs';
import {travelerActions,modelPlanSchema} from '../shared/travelerActions.mjs';
import {workspaceCommand} from '../server/domain/workspaceInterpreter.mjs';
import {createConversation,runWorkspaceTurn,workspaceSnapshot} from '../server/domain/tripWorkspace.mjs';
import {submitConversationExecution,runConversationExecution,cancelConversationExecution,executionView} from '../server/domain/conversationExecution.mjs';
import {planConversation,compileInstruction,protectChatInput} from '../server/domain/conversationPlanner.mjs';
import {airportSuggestions,validateAirportReferences} from '../server/shopping/airports.mjs';
import {historicalReliability,DistribusionProvider} from '../server/shopping/providerContracts.mjs';
function fixture(t){mkdirSync('tmp',{recursive:true});const dir=mkdtempSync(join(resolve('tmp'),'traveler-test-')),store=new Store({directory:dir,production:false});t.after(()=>{store.close();assert.ok(resolve(dir).startsWith(resolve('tmp')+sep));rmSync(dir,{recursive:true,force:true});});const user=store.createGuest(),other=store.createGuest();return {store,user,other,w:createConversation(store,user.id),travel:{call:async()=>{throw Error('No external test transport');}}};}
const direct=async(f,command)=>{f.w=await runWorkspaceTurn(f.store,f.user.id,f.w.conversation.id,{input:'Test controls',command,clientTurnId:randomUUID(),expectedVersion:f.w.draft.version,visibleSetId:f.w.draft.activeSetId??undefined},f.travel,{available:false});return f.w;};
const seed=async f=>{await direct(f,{op:'search_options',patch:{from:'bos',to:'nyc',mode:'sample',departure:new Date(Date.now()+86400000*5).toISOString(),preferences:{budgetCents:100000,maxWalkMinutes:120,maxTransfers:8}}});return f.w.sets.at(-1);};
for(const action of travelerActions)test(`shared action ${action.id} has command validation, UI metadata and schema coverage`,()=>{assert.equal(workspaceCommand.parse({op:action.id}).op,action.id);assert.ok(action.description);assert.ok(action.confirmation);assert.ok(modelPlanSchema.properties.commands.items.properties.op.enum.includes(action.id));assert.ok(readFileSync('src/travelerActions.ts','utf8').includes('"'+action.id+'"'));});
test('Llama receives actual schema; fallback cannot claim real inference',async t=>{const f=fixture(t);let calls=0;const provider={available:true,model:'fixture-llama-contract',chat:async input=>{calls++;assert.equal(input.jsonSchema.additionalProperties,false);assert.ok((input.jsonSchema.properties.commands?.items.properties.op??input.jsonSchema.properties.op).enum.includes("manage_travelers"));assert.equal(input.temperature,0);assert.equal(input.messages.some(m=>m.content.includes('fixture@example.invalid')),false);return JSON.stringify(input.jsonSchema.properties.op?{op:'manage_travelers'}:{commands:[{op:'manage_travelers',text:'Show travelers'}]});}};const plan=await planConversation('Show travelers',f.w.draft,{},provider);assert.equal(calls,2);assert.equal(plan.inference.modelCalls,2);assert.equal(plan.inference.source,'llama');const failed=await planConversation('Show travelers',f.w.draft,{}, {...provider,chat:async()=>'{"commands":[{"op":"charge_card","text":"Show travelers"}]}' });assert.equal(failed.inference.source,'fallback');assert.equal(failed.commands[0].op,'clarify');});
test('numeric offsets are resolved in application code',async t=>{const f=fixture(t);const c=compileInstruction({op:'update_constraints',text:'Shift departure forward by ninety minutes'},f.w.draft);assert.equal(Date.parse(c.patch.departure)-Date.parse(f.w.draft.constraints.departure),90*60000);const two=compileInstruction({op:'update_constraints',text:'Leave two hours later'},f.w.draft);assert.equal(Date.parse(two.patch.departure)-Date.parse(f.w.draft.constraints.departure),120*60000);});
test('hypothetical questions cannot silently modify active trip',async t=>{const f=fixture(t);await seed(f);const before=f.w.draft.constraints;const e=submitConversationExecution(f.store,f.user.id,f.w.conversation.id,{input:'How much would two travelers cost?',clientTurnId:'what-if',expectedVersion:f.w.draft.version},{enqueue:false});await runConversationExecution(f.store,f.user.id,e.id,f.travel,{available:true,chat:async({jsonSchema})=>JSON.stringify(jsonSchema.properties.op?{op:'update_constraints'}:{commands:[{op:'update_constraints',text:'How much would two travelers cost?'}]})});const after=workspaceSnapshot(f.store,f.user.id,f.w.conversation.id);assert.deepEqual(after.draft.constraints,before);assert.equal(after.scenarios.length,1);});
test('multi-command execution preserves exact option references and replay',async t=>{const f=fixture(t),set=await seed(f);let modelCalls=0;const request={input:'Compare the first and third, then choose the third',clientTurnId:'multi',expectedVersion:f.w.draft.version,visibleSetId:set.id};const e=submitConversationExecution(f.store,f.user.id,f.w.conversation.id,request,{enqueue:false});const provider={available:true,chat:async()=>{modelCalls++;return JSON.stringify({commands:[{op:'compare_options',text:'Compare the first and third'},{op:'select_option',text:'choose the third'}]});}};const done=await runConversationExecution(f.store,f.user.id,e.id,f.travel,provider);assert.equal(done.state,'completed');const after=workspaceSnapshot(f.store,f.user.id,f.w.conversation.id);assert.equal(after.draft.selected.optionId,set.options[2].id);await runConversationExecution(f.store,f.user.id,e.id,f.travel,provider);assert.equal(modelCalls,1);assert.equal(submitConversationExecution(f.store,f.user.id,f.w.conversation.id,request,{enqueue:false}).id,e.id);assert.ok(executionView(f.store,f.user.id,e.id,3).events.every(e=>e.sequence>3));});
test('owner isolation, stale drafts and conflicting request IDs are enforced',t=>{const f=fixture(t);const body={input:'Show travelers',clientTurnId:'owner',expectedVersion:f.w.draft.version};const e=submitConversationExecution(f.store,f.user.id,f.w.conversation.id,body,{enqueue:false});assert.throws(()=>executionView(f.store,f.other.id,e.id),/not found/);assert.throws(()=>submitConversationExecution(f.store,f.user.id,f.w.conversation.id,{...body,input:'Changed input'},{enqueue:false}),/different input/);assert.throws(()=>cancelConversationExecution(f.store,f.other.id,e.id),/not found/);});
test('cancellation prevents late inference from committing actions',async t=>{const f=fixture(t);let finish,started;const running=new Promise(r=>{started=r;});const provider={available:true,chat:async()=>{started();return new Promise(r=>{finish=r;});}};const e=submitConversationExecution(f.store,f.user.id,f.w.conversation.id,{input:'Show travelers',clientTurnId:'cancel',expectedVersion:f.w.draft.version},{enqueue:false});const task=runConversationExecution(f.store,f.user.id,e.id,f.travel,provider);await running;cancelConversationExecution(f.store,f.user.id,e.id);finish(JSON.stringify({commands:[{op:'manage_travelers',text:'Show travelers'}]}));assert.equal((await task).state,'cancelled');assert.equal(workspaceSnapshot(f.store,f.user.id,f.w.conversation.id).messages.length,0);});
test('sensitive authentication and card input is rejected before model or persistence',t=>{const f=fixture(t);for(const input of ['My password is secret','card number: 4242424242424242','verification code is 123456']){assert.throws(()=>protectChatInput(input),/protected form/);assert.throws(()=>submitConversationExecution(f.store,f.user.id,f.w.conversation.id,{input,clientTurnId:randomUUID(),expectedVersion:f.w.draft.version}),/protected form/);}assert.equal(f.store.list(f.user.id,'conversation-execution').length,0);});
test('US airport directory expands cities without guessing airports and rejects forged references',async t=>{const f=fixture(t);const a=(iata)=>({id:'arp_'+iata,iata_code:iata,iata_country_code:'US',name:iata,latitude:40,longitude:-74,time_zone:'America/New_York'});const result=await airportSuggestions(f.store,f.user.id,'New York',{env:{DUFFEL_ACCESS_TOKEN:'fixture'},transport:async(url)=>{assert.match(url,/places\/suggestions\?query=New%20York/);return Buffer.from(JSON.stringify({data:[{type:'city',airports:[a('JFK'),a('LGA')]}]}));}});assert.equal(result.requiresSelection,true);assert.equal(result.airports.length,2);assert.doesNotThrow(()=>validateAirportReferences(f.store,f.user.id,result.airports));assert.throws(()=>validateAirportReferences(f.store,f.user.id,[{...result.airports[0],timezone:'America/Los_Angeles'}]),/directory/);});
test('historical reliability requires comparable observations with sample periods',()=>{const rows=Array.from({length:12},(_,i)=>({provider:'flightaware-aeroapi',flightId:'flight'+i,operatingCarrierCode:'B6',serviceNumber:'123',origin:'BOS',destination:'JFK',status:i===0?'cancelled':'arrived',scheduledDeparture:`2026-09-${String(i+1).padStart(2,'0')}T10:00:00Z`,scheduledArrival:`2026-09-${String(i+1).padStart(2,'0')}T11:00:00Z`,actualArrival:`2026-09-${String(i+1).padStart(2,'0')}T11:10:00Z`}));const result=historicalReliability(rows,{origin:'BOS',destination:'JFK',operatingCarrierCode:'B6',serviceNumber:'123',departureHour:10,timeZone:'UTC'});assert.equal(result.sampleCount,12);assert.equal(result.onTimeCount,11);assert.ok(result.periodStart);assert.equal(historicalReliability(rows,{origin:'LAX',destination:'JFK',departureHour:10,timeZone:'UTC'}).available,false);});
test('ground provider cannot invent a network API without a granted partner contract',async()=>{await assert.rejects(new DistribusionProvider().search({}),/partner documentation/);});
test('history deletion removes execution and protected input but preserves reconciliation metadata',t=>{const f=fixture(t);submitConversationExecution(f.store,f.user.id,f.w.conversation.id,{input:'Show travelers',clientTurnId:'erase',expectedVersion:f.w.draft.version});f.store.put(f.user.id,'booking-details',{private:'fixture'});const op=f.store.put(f.user.id,'booking-operation',{state:'reconciling'});f.store.deleteHistory(f.user.id);assert.equal(f.store.list(f.user.id,'conversation-execution').length,0);assert.equal(f.store.list(f.user.id,'booking-details').length,0);assert.equal(f.store.get(f.user.id,op.id,'booking-operation').state,'reconciling');assert.throws(()=>f.store.deleteAccount(f.user.id),/reconciled/);});

test('chat HTTP routes reject sensitive values before creating conversation or model history',async t=>{
 const f=fixture(t),{createApplication}=await import('../server/server.mjs'),session=f.store.session(f.user.id);
 const app=createApplication({store:f.store,travel:{...f.travel,close:async()=>{}},quiet:true,drainIntervalMs:600000,immediateJobs:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 try{for(const path of ['/api/conversations/'+f.w.conversation.id+'/turns','/api/agent'])for(const input of ['My password hunter2','OTP 123456','Email fixture@example.invalid','My date of birth is 1990-01-01','Phone +1 202 555 0123']){
 const response=await fetch('http://127.0.0.1:'+app.server.address().port+path,{method:'POST',headers:{'content-type':'application/json',cookie:'wayline_session='+session.token,'x-csrf-token':session.csrf},body:JSON.stringify({input,clientTurnId:randomUUID(),expectedVersion:f.w.draft.version,async:true})});assert.equal(response.status,400);assert.equal((await response.json()).code,'PROTECTED_INPUT_REQUIRED');}
 assert.equal(f.store.list(f.user.id,'conversation-execution').length,0);assert.equal(f.store.list(f.user.id,'agent').length,0);assert.equal(f.store.list(f.user.id,'conversation-turn').length,0);
 }finally{await app.stopBackgroundJobs();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
});
test('expired result records do not prevent opening retained conversation history',async t=>{
 const f=fixture(t),set=await seed(f);f.store.db.prepare('DELETE FROM records WHERE id=?').run(set.id);
 const snapshot=workspaceSnapshot(f.store,f.user.id,f.w.conversation.id);assert.equal(snapshot.sets.length,0);assert.ok(snapshot.messages.length>0);
});

test('booking status evidence clearly identifies test inventory and its supplier observation time',async t=>{const f=fixture(t),observedAt='2026-09-13T00:00:00.000Z';f.store.put(f.user.id,'supplier-order',{live:false,supplierReference:'ord_fixture',state:'completed',paymentState:'captured',ticketState:'issued',observedAt});const {travelerActionResult}=await import('../server/domain/travelerActions.mjs');const r=await travelerActionResult(f.store,f.user.id,f.w.conversation,f.w.draft,{op:'order_status'},f.travel);assert.match(r.workflowEvidence[0].source,/test inventory - no real ticket/);assert.equal(r.workflowEvidence[0].observedAt,observedAt);});

test('explicit destinations avoid redundant classification while still requiring the primary model',async t=>{
 const f=fixture(t);for(const [input,op] of [['Download the saved PDF','export_pdf'],['Open traveler profiles','manage_travelers'],['What if we leave later?','branch_scenario']]){
 let calls=0;const provider={available:true,model:'fixture',chat:async()=>{calls++;return JSON.stringify({commands:[{op,text:input}]});}};
 const plan=await planConversation(input,f.w.draft,{},provider);assert.equal(calls,1);assert.equal(plan.inference.modelCalls,1);assert.equal(plan.inference.verificationSkipped,1);assert.equal(plan.inference.source,'llama');assert.equal(plan.commands[0].op,op);
 }
});
test('ambiguous primary classification still uses verification and accounts for both calls',async t=>{
 const f=fixture(t);let calls=0;const provider={available:true,chat:async()=>{calls++;provider.lastInference={promptTokens:100,outputTokens:10,totalDurationNs:20,loadDurationNs:2,promptEvalDurationNs:8,generationDurationNs:10,cachedPromptTokens:40};return JSON.stringify(calls===1?{commands:[{op:'update_constraints',text:'Open my personal profile'}]}:{op:'manage_travelers'});}};
 const p=await planConversation('Open my personal profile',f.w.draft,{},provider);assert.equal(calls,2);assert.equal(p.commands[0].op,'manage_travelers');assert.equal(p.inference.promptTokens,200);assert.equal(p.inference.promptEvalDurationNs,16);assert.equal(p.inference.cachedPromptTokens,80);
});
test('multiple named destinations and weather hypotheticals retain intent verification',async()=>{
 const {needsIntentVerification}=await import('../server/domain/intentVerifier.mjs');
 assert.equal(needsIntentVerification({op:'export_pdf',text:'Save the PDF and calendar'}),true);
 assert.equal(needsIntentVerification({op:'branch_scenario',text:'What if it rains?'}),true);
 assert.equal(needsIntentVerification({op:'branch_scenario',text:'Leave two hours later'}),true);
});

test('conversation executor resolves origin before local time and preserves absolute UI times',async t=>{
 const f=fixture(t);
 const origin={id:'sstat',name:'South Station',lat:42.352,lon:-71.055,timezone:'America/New_York'};
 const destination={id:'harvard',name:'Harvard',lat:42.374,lon:-71.119,timezone:'America/New_York'};
 const {sampleSearch,preferences}=await import('../server/domain/journeys.mjs');
 const requests=[];
 f.travel={call:async(tool,input)=>{
  if(tool==='places')return {places:[/harvard/i.test(input.q)?destination:origin]};
  assert.equal(tool,'search');requests.push(input);
  return sampleSearch({...input,from:'bos',to:'nyc',preferences:preferences({...input.preferences,budgetCents:100000,maxWalkMinutes:120,maxTransfers:8})});
 }};
 const input='Find a trip from South Station to Harvard tomorrow at 9 am';
 const e=submitConversationExecution(f.store,f.user.id,f.w.conversation.id,{input,clientTurnId:randomUUID(),expectedVersion:f.w.draft.version},{enqueue:false});
 const done=await runConversationExecution(f.store,f.user.id,e.id,f.travel,{available:true,chat:async()=>JSON.stringify({commands:[{op:'search_options',text:input}]})});
 assert.equal(done.state,'completed');assert.equal(done.needsInput,undefined);
 assert.equal(new Intl.DateTimeFormat('en-US',{hour:'2-digit',hourCycle:'h23',timeZone:origin.timezone}).format(new Date(requests[0].departure)),'09');
 assert.equal(done.steps[0].request.command.patch.from.id,origin.id);
 f.w=workspaceSnapshot(f.store,f.user.id,f.w.conversation.id);
 const absolute=new Date(Date.now()+3*86400000).toISOString();
 await direct(f,{op:'update_constraints',patch:{from:origin,departure:absolute}});
 assert.equal(requests.at(-1).departure,absolute);
});
test('ambiguous departure places clarify without edits and resume the original local time',async t=>{
 const f=fixture(t),{resolveSurfaceCommand}=await import('../server/domain/resolveSurfaceCommand.mjs');
 const places=[{id:'station-east',name:'Union Station',lat:40,lon:-74,timezone:'America/New_York'},{id:'station-west',name:'Union Station',lat:34,lon:-118,timezone:'America/Los_Angeles'}];
 const input='Find a trip from Union Station to Harvard tomorrow at 9 am',instruction={op:'search_options',text:input};
 const e=submitConversationExecution(f.store,f.user.id,f.w.conversation.id,{input,clientTurnId:randomUUID(),expectedVersion:f.w.draft.version},{enqueue:false});
 const done=await runConversationExecution(f.store,f.user.id,e.id,{call:async()=>({places})},{available:true,chat:async()=>JSON.stringify({commands:[instruction]})});
 assert.equal(done.needsInput,true);assert.equal(done.clarification.choices.length,2);
 const state=workspaceSnapshot(f.store,f.user.id,f.w.conversation.id);
 assert.equal(state.draft.version,f.w.draft.version);
 const reply={op:'update_constraints',text:'station-east'};
 const command=compileInstruction(reply,state.draft,{clarification:state.conversation.clarification});
 const resumed=await resolveSurfaceCommand(command,reply,state,{call:async()=>{throw Error('The retained authoritative choice should be reused');}},compileInstruction);
 assert.equal(resumed.op,'search_options');
 assert.equal(new Intl.DateTimeFormat('en-US',{hour:'2-digit',hourCycle:'h23',timeZone:places[0].timezone}).format(new Date(resumed.patch.departure)),'09');
});
test('cancellation during origin resolution prevents late draft mutation',async t=>{
 const f=fixture(t);let release,started;const waiting=new Promise(r=>started=r);
 const input='Find a trip from South Station to Harvard tomorrow at 9 am';
 const e=submitConversationExecution(f.store,f.user.id,f.w.conversation.id,{input,clientTurnId:randomUUID(),expectedVersion:f.w.draft.version},{enqueue:false});
 const task=runConversationExecution(f.store,f.user.id,e.id,{call:async()=>{started();return new Promise(r=>release=r);}},{available:true,chat:async()=>JSON.stringify({commands:[{op:'search_options',text:input}]})});
 await waiting;cancelConversationExecution(f.store,f.user.id,e.id);
 release({places:[{id:'sstat',name:'South Station',lat:42,lon:-71,timezone:'America/New_York'}]});
 assert.equal((await task).state,'cancelled');assert.equal(workspaceSnapshot(f.store,f.user.id,f.w.conversation.id).draft.version,f.w.draft.version);
});

test("hypothetical information requests preserve the model-selected evidence action",()=>{const draft={constraints:{timezone:"America/New_York"}};for(const [op,text] of [["travel_weather","What if it rains?"],["trip_status","What would the flight status show?"],["order_status","Could it mean my payment was declined?"]])assert.deepEqual(compileInstruction({op,text},draft),{op});});

test("ambiguous recommendations are verified without silently selecting a journey",async t=>{const f=fixture(t),set=await seed(f);await direct(f,{op:"select_option",setId:set.id,optionIds:[set.options[1].id]});const selected=f.w.draft.selected;const input="Recommend one of these routes",e=submitConversationExecution(f.store,f.user.id,f.w.conversation.id,{input,clientTurnId:randomUUID(),expectedVersion:f.w.draft.version},{enqueue:false});const done=await runConversationExecution(f.store,f.user.id,e.id,f.travel,{available:true,chat:async({jsonSchema})=>JSON.stringify(jsonSchema.properties.op?{op:"compare_options"}:{commands:[{op:"select_option",text:input}]})});assert.equal(done.state,"completed");assert.equal(done.inference.modelCalls,2);assert.equal(done.plan[0].op,"compare_options");assert.deepEqual(workspaceSnapshot(f.store,f.user.id,f.w.conversation.id).draft.selected,selected);});
