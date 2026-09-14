import {cities} from '../catalog.mjs';
import {DomainError} from './journeys.mjs';

// Interpret local dates only after resolving the departure place. UI commands
// already contain absolute instants and do not enter this conversational path.
export async function resolveSurfaceCommand(command,instruction,snapshot,travel,recompile) {
 const mode=command.patch?.mode??snapshot.draft.constraints.mode;
 if(!command.patch?.from||mode==='flights')return command;
 const prior=snapshot.conversation.clarification;
 const choice=prior?.draftVersion===snapshot.draft.version&&prior.choices?.find(c=>[c.value,c.label].some(v=>v.toLowerCase()===instruction.text.trim().toLowerCase()));
 const resuming=!!choice&&!!prior.pendingCommand;
 let origin=resuming&&choice.place?choice.place:command.patch.from;
 if(typeof origin==='string') {
  const value=origin.toLowerCase();
  const places=mode==='sample'?cities:(await travel.call('places',{q:origin})).places;
  const exact=places.filter(p=>p.id.toLowerCase()===value||p.name.toLowerCase()===value);
  origin=exact.length===1?exact[0]:places.length===1?places[0]:null;
  if(!origin) {
   const error=new DomainError('Choose an exact origin so I can use its local departure time.',400,'PLACE_REQUIRED');
   error.clarification={kind:'missing-endpoint',field:'from',choices:places.slice(0,10).map(p=>({value:p.id,label:p.name+' ('+p.id+')',place:p})),pendingCommand:structuredClone(command),pendingInput:resuming?prior.pendingInput:instruction.text};
   throw error;
  }
 }
 if(!origin.timezone)throw new DomainError('The origin has no verified timezone. Choose another departure place.',400,'PLACE_REQUIRED');
 const localized=recompile({...instruction,op:command.op,text:resuming?prior.pendingInput:instruction.text},{...snapshot.draft,constraints:{...snapshot.draft.constraints,timezone:origin.timezone}},{clarification:resuming?null:prior});
 for(const field of ['departure','deadline'])if(command.patch[field]&&localized.patch?.[field])command.patch[field]=localized.patch[field];
 command.patch.from=mode==='sample'?origin.id:origin;
 return command;
}
