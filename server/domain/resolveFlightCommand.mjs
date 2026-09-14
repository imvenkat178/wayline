import {airportSuggestions} from '../shopping/airports.mjs';
import {workspaceAirport} from './workspaceFlights.mjs';
import {DomainError} from './journeys.mjs';
export async function resolveFlightCommand(store,userId,command,instruction,snapshot,recompile) {
 if(!command.patch||(command.patch.mode??snapshot.draft.constraints.mode)!=='flights')return command;
 const prior=snapshot.conversation.clarification,resuming=prior?.draftVersion===snapshot.draft.version&&prior.choices?.some(c=>[c.value,c.label].some(v=>v.toLowerCase()===instruction.text.trim().toLowerCase()));
 const patch=command.patch,refs=[...(patch.resolvedAirports??snapshot.draft.constraints.resolvedAirports??[])];
 const targets=[];
 for(const key of ['from','to'])if(patch[key])targets.push({field:key,get:()=>patch[key],set:v=>patch[key]=v});
 for(const key of ['originAirports','destinationAirports'])for(let i=0;i<(patch[key]?.length??0);i++)targets.push({field:key+'.'+i,get:()=>patch[key][i],set:v=>patch[key][i]=v});
 for(let i=0;i<(patch.additionalFlights?.length??0);i++)for(const key of ['from','to'])targets.push({field:'additionalFlights.'+i+'.'+key,get:()=>patch.additionalFlights[i][key],set:v=>patch.additionalFlights[i][key]=v});
 for(const target of targets){
  const known=workspaceAirport(target.get(),refs);if(known){target.set(known.iata);continue;}
  const value=String(target.get()),{airports}=await airportSuggestions(store,userId,value);
  const exact=airports.filter(a=>a.iata.toLowerCase()===value.toLowerCase());
  if(exact.length!==1){const error=new DomainError(airports.length?'Choose an exact airport: '+airports.map(a=>a.iata+' '+a.name).join('; '):'No exact US airport was found. Choose an airport code in Trip requirements.',400,'AIRPORT_AMBIGUOUS');error.clarification={kind:'missing-endpoint',field:target.field,choices:airports.map(a=>({label:a.iata+' '+a.name,value:a.iata})),pendingCommand:structuredClone(command),pendingInput:resuming?prior.pendingInput:instruction.text};throw error;}
  refs.push(exact[0]);target.set(exact[0].iata);
 }
 patch.resolvedAirports=refs;
 const origin=workspaceAirport(patch.from??snapshot.draft.constraints.from,refs);
 const input=resuming&&prior.pendingCommand?prior.pendingInput:instruction.text;
 const reparsed=recompile({...instruction,op:resuming?prior.pendingCommand.op:instruction.op,text:input},{...snapshot.draft,constraints:{...snapshot.draft.constraints,timezone:origin?.timezone??snapshot.draft.constraints.timezone,resolvedAirports:refs}},{clarification:resuming?null:prior});
 if(patch.departure&&reparsed.patch?.departure)patch.departure=reparsed.patch.departure;
 if(patch.additionalFlights&&reparsed.patch?.additionalFlights?.length===patch.additionalFlights.length)patch.additionalFlights.forEach((s,i)=>s.departure=reparsed.patch.additionalFlights[i].departure);
 return command;
}
