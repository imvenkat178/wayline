// Continue only an exact answer to a pending, version-bound clarification.
export function clarificationAnswer(instruction,draft,context,validate) {
 const pending=context.clarification,text=instruction.text.trim();
 if(!pending||pending.draftVersion!==draft.version)return null;
 if(pending.kind==='missing-endpoint'&&pending.pendingCommand){
  const choice=pending.choices?.find(c=>[c.value,c.label].some(v=>v.toLowerCase()===text.toLowerCase()));
  if(!choice||!['search_options','update_constraints','branch_scenario'].includes(pending.pendingCommand.op))return null;
  const command=structuredClone(pending.pendingCommand),path=pending.field?.split('.');
  if(!path||!['from','to','originAirports','destinationAirports','additionalFlights'].includes(path[0]))return null;
  let target=command.patch;for(const part of path.slice(0,-1)){if(target?.[part]===undefined)return null;target=target[part];}
  if(!target)return null;target[path.at(-1)]=choice.value;
  return {command:validate(command)};
 }
 if(pending.kind==='flight-date'&&['search_options','update_constraints','branch_scenario'].includes(pending.pendingOp)&&/^\d{4}-\d{2}-\d{2}(?:(?:\s*,\s*|\s+and\s+)\d{4}-\d{2}-\d{2})*$/.test(text)){
  const base=pending.field==='flexibleDates'?pending.pendingInput.replace(/\bflexible dates?\b/gi,''):pending.pendingInput.replace(/\breturn(?:ing)?(?: on)?\s*$/i,'');
  return {instruction:{op:pending.pendingOp,text:base+' '+(pending.field==='returnDate'?'returning on ':'flexible dates: ')+text}};
 }
 return null;
}
