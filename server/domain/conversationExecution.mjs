import {resolveSurfaceCommand} from './resolveSurfaceCommand.mjs';
import {resolveFlightCommand} from './resolveFlightCommand.mjs';
import { cities } from '../catalog.mjs';
import { createHash } from 'node:crypto';
import { enqueueJob } from '../jobs.mjs';
import { DomainError } from './journeys.mjs';
import { defaultChatProvider } from '../adapters/llm.mjs';
import { planConversation, compileInstruction, protectChatInput } from './conversationPlanner.mjs';
import { runWorkspaceTurn, workspaceSnapshot } from './tripWorkspace.mjs';
import { actionById } from '../../shared/travelerActions.mjs';
const controllers=new Map();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminal=e=>['completed','failed','cancelled'].includes(e.state);
const get=(store,userId,id)=>store.get(userId,id,'conversation-execution');
function update(store,userId,id,patch,event) {
  const old=get(store,userId,id);
  if(old.state==='cancelled')return old;
  return store.put(userId,'conversation-execution',{...old,...patch,events:[...old.events,{sequence:(old.events.at(-1)?.sequence??0)+1,at:new Date().toISOString(),...event}].slice(-100)}, {id,expectedVersion:old.version});
}
export function submitConversationExecution(store,userId,conversationId,request,{enqueue=true}={}) {
  protectChatInput(request.input);
  if(typeof request.clientTurnId!=='string'||!request.clientTurnId||request.clientTurnId.length>100)throw new DomainError('A client turn ID is required.');
  const id=digest([userId,conversationId,request.clientTurnId]), requestHash=digest({input:request.input,expectedVersion:request.expectedVersion,visibleSetId:request.visibleSetId});
  return store.transaction(()=>{
    const c=store.get(userId,conversationId,'conversation'),draft=store.get(userId,c.draftId,'trip-draft');
    const old=store.list(userId,'conversation-execution').find(x=>x.id===id);
    if(old){if(old.requestHash!==requestHash)throw new DomainError('This message ID was already used for different input.',409,'IDEMPOTENCY_CONFLICT');return old;}
    if(c.executionId){const active=store.list(userId,'conversation-execution').find(x=>x.id===c.executionId);if(active&&!terminal(active))throw new DomainError('Another conversation turn is running.',409,'TURN_PENDING');}
    if(draft.version!==request.expectedVersion)throw new DomainError('This trip changed. Refresh before continuing.',409,'VERSION_CONFLICT');
    if(request.visibleSetId && store.get(userId,request.visibleSetId,'candidate-set').conversationId!==c.id)throw new DomainError('Results belong to another conversation.',404);
    const execution=store.put(userId,'conversation-execution',{schemaVersion:1,conversationId,requestHash,input:request.input,clientTurnId:request.clientTurnId,expectedVersion:request.expectedVersion,visibleSetId:request.visibleSetId ?? null,state:'queued',steps:[],events:[{sequence:1,at:new Date().toISOString(),type:'queued',message:'Waiting for local Llama'}]}, {id,expiresAt:c.expiresAt});
    store.put(userId,'conversation',{...c,executionId:id},{id:c.id,expectedVersion:c.version});
    if(enqueue)enqueueJob(store,'conversation-execution',{userId,executionId:id},{userId,maxAttempts:3});
    return execution;
  });
}
export function executionView(store,userId,id,after=0) {
  const e=get(store,userId,id);
  return {...e,resetRequired:after>0&&after<(e.events[0]?.sequence??1)-1,events:e.events.filter(event=>event.sequence>after)};
}
export function cancelConversationExecution(store,userId,id) {
  return store.transaction(()=>{
    const e=get(store,userId,id);if(terminal(e))return e;
    controllers.get(id)?.abort();
    const c=store.get(userId,e.conversationId,'conversation');
    if(c.pending) {
      const t=store.get(userId,c.pending.turnId,'conversation-turn');
      store.put(userId,'conversation-turn',{...t,status:'failed',error:'Planning was cancelled.'},{id:t.id,expectedVersion:t.version});
      store.put(userId,'conversation',{...c,pending:null},{id:c.id,expectedVersion:c.version});
    }
    return update(store,userId,id,{state:'cancelled'},{type:'cancelled',message:'Stopped planning. Already completed steps are retained; submitted supplier transactions reconcile separately.'});
  });
}
export async function runConversationExecution(store,userId,id,travel,provider=defaultChatProvider()) {
  let e=get(store,userId,id);if(terminal(e))return e;
  const controller=new AbortController();controllers.set(id,controller);
  try {
    let snapshot=workspaceSnapshot(store,userId,e.conversationId);
    if(!e.plan) {
      e=update(store,userId,id,{state:'interpreting'},{type:'interpreting',message:'Understanding your request with local Llama'});
      const plan=await planConversation(e.input,snapshot.draft,{hasOptions:!!snapshot.draft.activeSetId,clarification:snapshot.conversation.clarification,scenarios:snapshot.scenarios.map(s=>s.name)},provider,{signal:controller.signal});
      if(get(store,userId,id).state==='cancelled')return get(store,userId,id);
      e=update(store,userId,id,{plan:plan.commands,inference:plan.inference,state:'executing'},{type:'planned',message:plan.inference.source==='llama'?`${plan.commands.length} validated instruction(s)`:'Visible fallback: '+plan.inference.reason});
    }
    for(let index=0;index<e.plan.length;index++) {
      e=get(store,userId,id);if(e.state==='cancelled')return e;
      if(e.steps[index]?.state==='completed')continue;
      snapshot=workspaceSnapshot(store,userId,e.conversationId);
      let step=e.steps[index];
      if(!step) {
        let command=compileInstruction(e.plan[index],snapshot.draft,{clarification:snapshot.conversation.clarification});
        command=await resolveFlightCommand(store,userId,command,e.plan[index],snapshot,compileInstruction);
        command=await resolveSurfaceCommand(command,e.plan[index],snapshot,travel,compileInstruction);
        if(controller.signal.aborted)return get(store,userId,id);
        if(command.patch && (command.patch.mode ?? snapshot.draft.constraints.mode)==='sample') {
          for(const endpoint of ['from','to'])if(typeof command.patch[endpoint]==='string') {
            const value=command.patch[endpoint].toLowerCase();const match=cities.find(c=>c.id.toLowerCase()===value||c.name.toLowerCase()===value);
            if(match)command.patch[endpoint]=match.id;
          }
        }
        if(command.selectionLabel) {
          const set=snapshot.sets.find(s=>s.id===(e.visibleSetId ?? snapshot.draft.activeSetId));
          const matches=set?.options.filter(o=>o.labels.some(l=>command.selectionLabel==='price'?/lowest|cheapest/i.test(l):new RegExp(command.selectionLabel,'i').test(l))) ?? [];
          command=matches.length===1?{op:'select_option',setId:set.id,optionIds:[matches[0].id]}:{op:'clarify'};
        }
        if(command.op==='restore_scenario') {
          const matches=snapshot.scenarios.filter(s=>e.plan[index].text.toLowerCase().includes(s.name.toLowerCase()));
          command=matches.length===1?{op:'restore_scenario',scenarioId:matches[0].id}:{op:'clarify'};
        }
        step={state:'running',request:{input:e.plan[index].text,command,clientTurnId:`${e.id.slice(0,50)}:${index}`,expectedVersion:snapshot.draft.version,visibleSetId:e.visibleSetId ?? snapshot.draft.activeSetId ?? undefined,executionId:e.id}};
        const steps=[...e.steps];steps[index]=step;
        e=update(store,userId,id,{steps},{type:'step-started',index,action:command.op,message:actionById[command.op].description});
      }
      snapshot=await runWorkspaceTurn(store,userId,e.conversationId,step.request,travel,{available:false});
      if(get(store,userId,id).state==='cancelled')return get(store,userId,id);
      e=get(store,userId,id);const steps=[...e.steps];steps[index]={...step,state:'completed',draftVersion:snapshot.draft.version};
      e=update(store,userId,id,{steps},{type:'step-completed',index,action:step.request.command.op,message:'Completed'});
      const c=store.get(userId,e.conversationId,'conversation');
      store.put(userId,'conversation',{...c,schemaVersion:2,clarification:snapshot.messages.at(-1)?.clarification ?? null,summary:{version:1,lastActions:steps.map(s=>s.request.command.op),selected:snapshot.draft.selected?{setId:snapshot.draft.selected.setId,optionId:snapshot.draft.selected.optionId}:null}}, {id:c.id,expectedVersion:c.version});
      if(step.request.command.op==='clarify')break;
    }
    return update(store,userId,id,{state:'completed'},{type:'completed',message:'Conversation updated'});
  } catch(error) {
    if(get(store,userId,id).state==='cancelled')return get(store,userId,id);
    if(error instanceof DomainError && error.status===400) {
      const c=store.get(userId,e.conversationId,'conversation');
      const clarification=store.put(userId,'conversation-clarification',{schemaVersion:1,conversationId:c.id,executionId:id,kind:'prerequisite',question:error.message,...error.clarification,draftVersion:store.get(userId,c.draftId,'trip-draft').version,pendingOp:e.plan?.[e.steps.length]?.op},{expiresAt:c.expiresAt});
      const latest=c.turnIds.at(-1);
      if(latest){const turn=store.get(userId,latest,'conversation-turn');if(turn.status==='failed')store.put(userId,'conversation-turn',{...turn,status:'completed',response:{reply:error.message,intent:'clarify',actions:[],results:[],setIds:[],clarification}}, {id:turn.id,expectedVersion:turn.version});}
      store.put(userId,'conversation',{...c,clarification},{id:c.id,expectedVersion:c.version});
      return update(store,userId,id,{state:'completed',needsInput:true,clarification},{type:'clarification',message:error.message});
    }
    return update(store,userId,id,{state:'failed',error:error instanceof DomainError?error.message:'The local model or provider could not complete this turn. Retry or use direct controls.'},{type:'failed',message:error instanceof DomainError?error.message:'Execution interrupted'});
  } finally {if(controllers.get(id)===controller)controllers.delete(id);}
}

export function retryConversationExecution(store,userId,id) {
 const e=get(store,userId,id);if(e.state!=='failed')throw new DomainError('Only a failed execution can be retried.',409);
 const c=store.get(userId,e.conversationId,'conversation');
 if(c.executionId!==id)throw new DomainError('A newer turn owns this conversation. Send a new message against its current draft.',409,'VERSION_CONFLICT');
 const draft=store.get(userId,c.draftId,'trip-draft');
 const expected=e.steps.at(-1)?.draftVersion ?? e.steps.at(-1)?.request.expectedVersion ?? e.expectedVersion;
 if(draft.version!==expected)throw new DomainError('The draft changed after this execution. Refresh and send a new message.',409,'VERSION_CONFLICT');
 const next=update(store,userId,id,{state:'queued',error:null,...(e.inference?.source==='fallback'?{plan:null,inference:null,steps:[]}: {})},{type:'retry',message:'Retry queued; completed steps will be replayed without repeating them.'});
 enqueueJob(store,'conversation-execution',{userId,executionId:id},{userId,maxAttempts:3});return next;
}
