import {scopeClarificationJourney} from './criticalScopeJourney.mjs';
import {progressCancellationJourney} from './criticalAsyncJourney.mjs';
import {fixtureFlightStatus,recoveryAndCancellationJourney} from './criticalRecoveryJourney.mjs';
import {personalMonitoringJourney} from './criticalTravelerJourneys.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {supplierFixture} from '../tests/helpers/supplierFixture.mjs';
import {runBookingOperation} from '../server/shopping/booking.mjs';
const model=process.env.EVAL_MODEL??'llama3.1:8b-instruct-q4_K_M';
process.env.OLLAMA_BASE_URL='http://127.0.0.1:11434';process.env.OLLAMA_MODEL=model;process.env.OLLAMA_NUM_CTX='8192';
if(process.env.AFTER_MODEL_REPORT) {
 const deadline=Date.now()+3*3600000;
 while(!existsSync(process.env.AFTER_MODEL_REPORT)||!JSON.parse(readFileSync(process.env.AFTER_MODEL_REPORT)).finishedAt){if(Date.now()>deadline)throw Error('Preceding model evaluation did not complete');await new Promise(r=>setTimeout(r,10000));}
}
mkdirSync('docs/evaluations',{recursive:true});
const tags=await fetch(process.env.OLLAMA_BASE_URL+'/api/tags').then(r=>r.json()),installed=tags.models.find(m=>m.name===model);
assert.ok(installed,'The requested local model must be installed');
const output=process.env.JOURNEY_OUTPUT??'docs/evaluations/local-llama-final-journeys.json';
const report={schemaVersion:1,validationClass:'real Llama with fixture inventory',model,digest:installed.digest,numCtx:8192,temperature:0,startedAt:new Date().toISOString(),journeys:[],supplierSandbox:'not run',authorizedLiveProvider:'not run'};
const persist=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
report.codeHashes=Object.fromEntries(['server/jobWorkers.mjs','server/jobs.mjs','server/server.mjs','server/domain/intentVerifier.mjs','server/domain/conversationPrivacy.mjs','server/domain/conversationPlanner.mjs','server/domain/resolveSurfaceCommand.mjs','server/domain/conversationExecution.mjs','server/domain/flightScopeLanguage.mjs','server/domain/resolveFlightCommand.mjs','server/domain/clarificationAnswer.mjs','server/domain/workspaceInterpreter.mjs','server/adapters/llm.mjs','server/shopping/booking.mjs','server/shopping/duffelBooking.mjs','server/shopping/supplierMonitoring.mjs','server/shopping/transactionRetention.mjs','server/domain/travelerActions.mjs','server/shopping/providerContracts.mjs','server/shopping/aeroapi.mjs'].map(p=>[p,hash(p)]));
async function chat(f,id,input,op,journey) {
 const before=(await f.call('/api/conversations/'+id)).value,started=Date.now();
 const response=await f.call('/api/conversations/'+id+'/turns',{input,clientTurnId:randomUUID(),expectedVersion:before.draft.version,visibleSetId:before.draft.activeSetId??undefined});
 const value=response.value,e=value.execution;
 const row={input,expected:op,actual:e?.plan?.map(p=>p.op),httpStatus:response.status,source:e?.inference?.source,modelCalls:e?.inference?.modelCalls??0,latencyMs:Date.now()-started,state:e?.state};
 journey.steps.push(row);persist();
 assert.equal(response.status,200,JSON.stringify(value));assert.equal(e?.inference?.source,'llama','Fallback is not model validation');assert.ok(e.inference.modelCalls>=1);assert.equal(e.state,'completed');assert.deepEqual(row.actual,[op]);
 return value;
}
async function story(name,repeat,fn) {
 const journey={name,repeat,steps:[],pass:false};report.journeys.push(journey);const cleanup=[];
 try {const f=await supplierFixture({after:fn=>cleanup.push(fn),flightStatusProvider:fixtureFlightStatus});await fn(f,journey);journey.pass=true;}
 catch(error){journey.error=error.message;process.exitCode=1;}
 finally{for(const fn of cleanup.reverse())await fn();persist();console.log(JSON.stringify({name,repeat,pass:journey.pass,error:journey.error}));}
}
for(let repeat=1;repeat<=2;repeat++){
 await story('purchase, reload, exchange, refund request and payment record',repeat,async(f,j)=>{
  const id=f.w.conversation.id;
  let state=await chat(f,id,'I want to book the selected flight','book_ticket',j);assert.equal(state.messages.at(-1).protectedPanel,'book_ticket');assert.equal(f.state.submitted,0);
  const review=await f.review(),operation=await f.submit(review);assert.equal((await f.submit(review)).id,operation.id);
  const booked=await runBookingOperation(f.store,f.user.id,operation.id,f.adapter);assert.equal(booked.state,'completed');assert.equal(f.state.submitted,1);
  const references=await f.call('orders/'+booked.orderId+'/documents');assert.equal(references.value.documents[0].reference,'TEST-001');assert.equal(references.value.supplierFilesAvailable,false);
  state=await chat(f,id,'Show my booking payment and ticket issuance status','order_status',j);assert.ok(state.messages.at(-1).workflowEvidence.some(e=>e.value.includes('issued')));
  state=await chat(f,id,'I want to change my booked flight','exchange_ticket',j);assert.equal(state.messages.at(-1).protectedPanel,'exchange_ticket');
  const change=await f.call('booking/change-options',{orderId:booked.orderId,change:{sliceId:'sli_original',departureDate:new Date(Date.now()+8*86400000).toISOString().slice(0,10)}});assert.equal(change.status,201);
  const exchange=await f.review({kind:'exchange',orderId:booked.orderId,changeSearchId:change.value.id,changeOfferId:'oco_fixture',changeCardId:'tcd_fixture'});
  assert.equal((await runBookingOperation(f.store,f.user.id,(await f.submit(exchange)).id,f.adapter)).ticketState,'exchanged');
  await chat(f,id,'Get a refund quote for my booking','refund_ticket',j);
  const refund=await f.review({kind:'refund',orderId:booked.orderId}),refunded=await runBookingOperation(f.store,f.user.id,(await f.submit(refund)).id,f.adapter);assert.equal(refunded.ticketState,'cancelled');assert.equal(refunded.paymentState,'refund-pending');
  state=await chat(f,id,'Retrieve my booking receipt','ticket_receipt',j);assert.ok(state.messages.at(-1).documents.length);
  const receipt=await f.call('orders/'+booked.orderId+'/receipt');assert.equal(receipt.status,200);assert.equal(receipt.value.economics[0].previousSpending.amount,11215);assert.equal(receipt.value.economics[0].refundsPending.amount,8000);assert.equal(f.state.submitted,1);
 });
 await story('planning, comparison, hypothetical change, reload and imported ticket',repeat,async(f,j)=>{
  const created=await f.call('/api/conversations',{}),id=created.value.conversation.id;let state=created.value;
  const direct=await f.call('/api/conversations/'+id+'/turns',{input:'Set up fixture search controls',command:{op:'update_constraints',patch:{from:'bos',to:'nyc',mode:'sample',departure:new Date(Date.now()+7*86400000).toISOString(),preferences:{budgetCents:100000,maxWalkMinutes:120,maxTransfers:4}}},clientTurnId:randomUUID(),expectedVersion:state.draft.version});assert.equal(direct.status,200);
  await chat(f,id,'Search for routes using these trip requirements','search_options',j);
  await chat(f,id,'Compare these options by price and travel time','compare_options',j);
  state=await chat(f,id,'Select the cheapest option','select_option',j);const selected=state.draft.selected;assert.ok(selected);
  const departure=state.draft.constraints.departure;state=await chat(f,id,'What if I leave two hours later?','branch_scenario',j);assert.equal(state.draft.constraints.departure,departure);assert.equal(state.draft.selected.optionId,selected.optionId);
  const reloaded=(await f.call('/api/conversations/'+id)).value;assert.equal(reloaded.draft.selected.optionId,selected.optionId);assert.ok(reloaded.scenarios.length);
  state=await chat(f,id,'Import a ticket into my wallet','manage_tickets',j);assert.equal(state.messages.at(-1).protectedPanel,'manage_tickets');
  const ticket=await f.call('/api/records/ticket',{operator:'Fixture Rail',service:'Fixture Regional',confirmation:'FIXTURE-ONLY',passenger:'Fixture Traveler',departure:new Date(Date.now()+7*86400000).toISOString(),origin:'Boston',destination:'New York',barcodeFormat:'QR_CODE',barcodeText:'FIXTURE-DOCUMENT'});
  assert.equal(ticket.status,201);assert.match(ticket.value.source,/not verified|import/);assert.equal((await f.call('booking/reviews',{kind:'cancel',orderId:ticket.value.id})).status,404);
  await chat(f,id,'Show my traveler profiles','manage_travelers',j);
  const traveler=await f.call('/api/records/traveler',{name:'Private Fixture Traveler',fareClass:'adult',assistance:false});assert.equal(traveler.status,201);
  const records=(await f.call('/api/records/traveler')).value;assert.ok(records.some(r=>r.id===traveler.value.id));
 });
 await story('commutes, passes, price watches, sharing and flight exports',repeat,(f,j)=>personalMonitoringJourney(f,j,chat));
 await story('supplier recovery, completed travel, reload and cancellation review',repeat,(f,j)=>recoveryAndCancellationJourney(f,j,chat));
 await story('asynchronous progress, reconnect, replay and cancellation',repeat,(f,j)=>progressCancellationJourney(f,j));
 await story('return-date clarification, reload, flexible airports and multi-city',repeat,(f,j)=>scopeClarificationJourney(f,j));
}
report.finishedAt=new Date().toISOString();report.pass=report.journeys.length===12&&report.journeys.every(j=>j.pass);report.codeUnchanged=Object.entries(report.codeHashes).every(([p,h])=>hash(p)===h);report.pass&&=report.codeUnchanged;persist();if(!report.pass)process.exitCode=1;
