import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runConversationExecution} from '../server/domain/conversationExecution.mjs';
import {defaultChatProvider} from '../server/adapters/llm.mjs';
export async function progressCancellationJourney(f,j) {
 const id=f.w.conversation.id,endpoint='/api/conversations/'+id;
 let w=(await f.call(endpoint)).value;
 const request={input:'Show my traveler profiles',async:true,expectedVersion:w.draft.version,clientTurnId:randomUUID()};
 let response=await f.call(endpoint+'/turns',request);assert.equal(response.status,202);
 let execution=response.value.execution;
 const path=endpoint+'/executions/'+execution.id;
 assert.equal((await f.call(path,undefined,f.otherSession)).status,404);
 const started=Date.now();
 await runConversationExecution(f.store,f.user.id,execution.id,{});
 execution=(await f.call(path)).value;
 assert.equal(execution.state,'completed');assert.equal(execution.inference.source,'llama');assert.ok(execution.inference.modelCalls>=1);
 assert.deepEqual(execution.plan.map(p=>p.op),['manage_travelers']);
 j.steps.push({input:request.input,actual:['manage_travelers'],source:'llama',modelCalls:execution.inference.modelCalls,latencyMs:Date.now()-started,state:execution.state});
 const replay=(await f.call(path+'?after=1')).value;
 assert.ok(replay.events.length);assert.ok(replay.events.every(e=>e.sequence>1));
 assert.equal((await f.call(path+'?after='+execution.events.at(-1).sequence)).value.events.length,0);
 w=(await f.call(endpoint)).value;assert.equal(w.execution.id,execution.id);assert.equal(w.messages.at(-1).protectedPanel,'manage_travelers');
 assert.equal((await f.call(endpoint+'/turns',request)).value.execution.id,execution.id);
 const beforeMessages=w.messages.length;
 response=await f.call(endpoint+'/turns',{input:'Show my saved transit passes',async:true,expectedVersion:w.draft.version,clientTurnId:randomUUID()});
 assert.equal(response.status,202);execution=response.value.execution;
 const provider=defaultChatProvider();let ready,release;const modelDone=new Promise(r=>ready=r),gate=new Promise(r=>release=r);let actualCalls=0;
 const wrapped={available:true,chat:async(...args)=>{actualCalls++;const result=await provider.chat(...args);ready();await gate;return result;}};
 const running=runConversationExecution(f.store,f.user.id,execution.id,{},wrapped);
 try {
  await Promise.race([modelDone,running.then(()=>{throw Error('Model failed before cancellation gate');})]);
  const cancelled=await f.call(endpoint+'/executions/'+execution.id+'/cancel',{});
  assert.equal(cancelled.value.state,'cancelled');
 } finally {release();}
 assert.equal((await running).state,'cancelled');assert.ok(actualCalls>=1);
 w=(await f.call(endpoint)).value;assert.equal(w.messages.length,beforeMessages);assert.equal(w.execution.state,'cancelled');
 j.steps.push({input:'Show my saved transit passes',source:'llama',modelCalls:actualCalls,state:'cancelled',assertion:'Real model response discarded after HTTP cancellation; no actions or messages committed'});
}
