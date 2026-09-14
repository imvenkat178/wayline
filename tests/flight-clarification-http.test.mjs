import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {supplierFixture} from './helpers/supplierFixture.mjs';
import {submitConversationExecution,runConversationExecution} from '../server/domain/conversationExecution.mjs';
import {workspaceSnapshot} from '../server/domain/tripWorkspace.mjs';
test('missing return date survives reload and resumes the full original request',async t=>{
 const f=await supplierFixture(t),id=f.w.conversation.id;
 let w=workspaceSnapshot(f.store,f.user.id,id);
 const turn=async(input,op)=>{const e=submitConversationExecution(f.store,f.user.id,id,{input,clientTurnId:randomUUID(),expectedVersion:w.draft.version},{enqueue:false});await runConversationExecution(f.store,f.user.id,e.id,{}, {available:true,chat:async()=>JSON.stringify({commands:[{op,text:input}]})});w=(await f.call('/api/conversations/'+id)).value;return w;};
 const date=new Date(Date.now()+30*86400000).toISOString().slice(0,10),returnDate=new Date(Date.now()+35*86400000).toISOString().slice(0,10);
 await turn('Find round-trip flights from BOS to JFK on '+date+' at 9 am','search_options');
 assert.equal(w.execution.needsInput,true);assert.equal(w.conversation.clarification.field,'returnDate');
 assert.equal(w.conversation.clarification.draftVersion,w.draft.version);
 await turn(returnDate,'clarify');
 assert.equal(w.execution.state,'completed',JSON.stringify(w.execution));assert.equal(w.draft.constraints.returnDate,returnDate);assert.equal(w.draft.constraints.from,'BOS');assert.equal(w.draft.constraints.to,'JFK');assert.equal(w.draft.constraints.mode,'flights');
 assert.equal(w.conversation.clarification,null);assert.equal(f.state.submitted,0);
});
