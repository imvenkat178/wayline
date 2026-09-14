import { z } from "zod";
const minutes=z.number().min(0).max(1440);
const policySchema=z.object({kind:z.enum(["ground","ground-air","air-ground","through-air","self-transfer"]),
  availableMinutes:minutes,supplierMinimum:minutes.nullable().default(null),
  components:z.array(z.object({name:z.string().min(1).max(80),minutes:minutes.nullable(),evidence:z.enum(["verified","assumption","unknown"])})),
  separateTicketsOptIn:z.boolean().default(false),protectedBySupplier:z.boolean().default(false)}).strict();
export function connectionPolicy(input) {
  const p=policySchema.parse(input);
  if(p.kind==="self-transfer"&&!p.separateTicketsOptIn)
    return {...p,status:"infeasible",reason:"Separate tickets require explicit consent",requiredMinutes:null,slackMinutes:null};
  const missing=p.components.some(c=>c.minutes===null||c.evidence!=="verified")||
    (p.kind==="through-air"&&p.supplierMinimum===null);
  // Supplier minima overlap procedural components: take the maximum, never add both.
  const requiredMinutes=Math.max(p.supplierMinimum??0,p.components.reduce((n,c)=>n+(c.minutes??0),0));
  const slackMinutes=p.availableMinutes-requiredMinutes;
  return {...p,requiredMinutes,slackMinutes,status:slackMinutes<0?"infeasible":missing?"unverified":"verified",
    reason:slackMinutes<0?"Insufficient connection time":missing?"Confirm procedure times with the operator":"Within verified connection policy"};
}
export function serviceIdentity(s) {
  return [s.provider,s.operator,s.serviceNumber??s.id,s.serviceDate,s.origin.id,s.destination.id].join("|");
}
export function acceptObservation(service, previous, incoming, now=Date.now()) {
  if(incoming.serviceKey!==serviceIdentity(service))return {accepted:false,reason:"Different service instance"};
  const observed=Date.parse(incoming.observedAt),received=Date.parse(incoming.receivedAt);
  if(!Number.isFinite(observed)||!Number.isFinite(received)||observed>received+60000||received>now+60000)
    return {accepted:false,reason:"Invalid observation time"};
  if(previous&&observed<=Date.parse(previous.observedAt))return {accepted:false,reason:"Duplicate or out-of-order observation"};
  if(now-observed>120000)return {accepted:false,reason:"Stale observation"};
  if(!["on-time","delayed","cancelled","unknown"].includes(incoming.status))return {accepted:false,reason:"Invalid status"};
  return {accepted:true,value:{...incoming,status:incoming.status}};
}
export function recoveryOrigin(progress) {
  if(!progress?.confirmedPlace||!progress?.confirmedAt) return {status:"location-required",message:"Confirm your current location before finding a reachable replacement."};
  if(Date.now()-Date.parse(progress.confirmedAt)>15*60000)return {status:"location-required",message:"Your location needs an update."};
  return {status:"ready",place:progress.confirmedPlace,earliestDeparture:progress.earliestDeparture};
}
