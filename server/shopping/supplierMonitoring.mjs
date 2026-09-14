import {createHash} from 'node:crypto';
import {DomainError} from '../domain/journeys.mjs';
import {enqueueJob} from '../jobs.mjs';
import {storeFlightObservation} from './providerContracts.mjs';
import {serviceIdentity} from './connections.mjs';
import {fanOutPush} from '../push.mjs';
import {isNotificationAllowed} from '../domain/notificationPolicy.mjs';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function setSupplierMonitor(store,userId,input,provider,now=Date.now()) {
 const order=store.get(userId,input.orderId,'supplier-order');
 if(order.version!==input.orderVersion)throw new DomainError('The booking changed. Refresh before changing monitoring.',409);
 const prior=store.list(userId,'supplier-monitor').find(m=>m.orderId===order.id);
 if(input.enabled!==true&&input.enabled!==false)throw new DomainError('Choose whether to enable status monitoring.');
 if(input.enabled&&(!provider?.license?.statusAllowed||input.consent!==true))throw new DomainError('Licensed flight status access and your consent are required for background monitoring.',503,'FLIGHT_STATUS_UNAVAILABLE');
 if(input.enabled&&(!order.servicingAuthority||!['issued','exchanged'].includes(order.ticketState)))throw new DomainError('Choose an issued supplier booking.',409);
 const services=order.itinerary?.services?.filter(s=>s.mode==='air')??[];
 const expiresAt=Math.max(...services.map(s=>Date.parse(s.arrival)))+12*3600000;
 if(!services.length||!Number.isFinite(expiresAt)||expiresAt<=now)throw new DomainError('This booking has no remaining flight-monitoring period.',409);
 return store.transaction(()=>store.put(userId,'supplier-monitor',{...prior,schemaVersion:1,orderId:order.id,conversationId:order.conversationId,state:input.enabled?'active':'paused',consentedAt:input.enabled?new Date(now).toISOString():prior?.consentedAt??null,nextCheckAt:now,expiresAt,signatures:prior?.signatures??{},notice:'Licensed checks every ten minutes within 24 hours of travel. Status changes never cancel, exchange or purchase tickets.'},prior?{id:prior.id,expectedVersion:prior.version,expiresAt}:{expiresAt}));
}
export function sweepSupplierMonitors(store,now=Date.now()) {
 let cursor='';
 for(;;){const rows=store.db.prepare("SELECT * FROM records WHERE kind='supplier-monitor' AND expires_at>? AND id>? ORDER BY id LIMIT 200").all(now,cursor);for(const row of rows){const m=store.decode(row);if(m.state!=='active'||m.nextCheckAt>now)continue;store.transaction(()=>{if(!store.db.prepare("SELECT id FROM jobs WHERE kind='supplier-monitor-check' AND status IN ('pending','leased') AND json_extract(payload,'$.monitorId')=?").get(m.id))enqueueJob(store,'supplier-monitor-check',{userId:row.user_id,monitorId:m.id},{userId:row.user_id,maxAttempts:3});});}if(rows.length<200)break;cursor=rows.at(-1).id;}
}
export async function checkSupplierMonitor(store,{userId,monitorId},provider,isCurrent=()=>true,now=Date.now()) {
 let monitor;try{monitor=store.get(userId,monitorId,'supplier-monitor');}catch(e){if(e.status===404)return;throw e;}
 if(monitor.state!=='active'||monitor.nextCheckAt>now)return;
 const order=store.get(userId,monitor.orderId,'supplier-order'),observations=[];let error=null;
 try{
  if(!provider?.license?.statusAllowed)throw new DomainError('Licensed status access is unavailable.',503);
  if(!['issued','exchanged'].includes(order.ticketState))return store.put(userId,'supplier-monitor',{...monitor,state:'paused',lastError:'The order no longer has issued flights.'},{id:monitorId,expectedVersion:monitor.version,expiresAt:monitor.expiresAt});
  const services=(order.itinerary?.services??[]).filter(s=>s.mode==='air'&&Date.parse(s.departure)<=now+86400000&&Date.parse(s.arrival)>=now-12*3600000).slice(0,8);
  for(const service of services){const observation=await provider.status(service);if(observation.serviceIdentity!==serviceIdentity(service)||observation.origin!==service.origin.iata||observation.destination!==service.destination.iata||Date.parse(observation.scheduledDeparture)!==Date.parse(service.departure)||now-Date.parse(observation.observedAt)>300000)throw new DomainError('A fresh observation matching the exact service is unavailable.',409);observations.push({service,observation});}
 }catch(e){error=e instanceof DomainError?e.message:'The licensed provider could not complete this check.';}
 if(!isCurrent())return;
 return store.transaction(()=>{
  const current=store.get(userId,monitorId,'supplier-monitor'),latest=store.get(userId,order.id,'supplier-order');
  if(current.state!=='active'||current.version!==monitor.version||latest.version!==order.version)return;
  const retentionMs=Math.min(30,provider?.license?.rawRetentionDays??30)*86400000;
  const signatures=Object.fromEntries(Object.entries(current.signatures??{}).filter(([,v])=>now-v.at<retentionMs));
  for(const {service,observation:o} of observations){
   storeFlightObservation(store,userId,serviceIdentity(service),o,{license:provider.license,now});
   const key=serviceIdentity(service),signature=digest([o.status,o.gate,o.actualDeparture,o.actualArrival]),prior=signatures[key];
   const changed=prior?prior.signature!==signature:['delayed','cancelled'].includes(o.status);
   if(changed){const dedupeKey=digest([userId,monitorId,key,signature]);const alert=store.put(userId,'alert',{kind:'supplier-status',severity:o.status==='cancelled'?'critical':'info',title:service.operator+' '+service.serviceNumber+': '+o.status,body:(o.gate?'Reported departure gate: '+o.gate+'. ':'')+'Open this booking conversation to inspect status or prepare recovery. Your tickets are unchanged.',orderId:order.id,conversationId:order.conversationId,sourceUrl:o.sourceUrl,observedAt:o.observedAt,read:false,delivery:'in-app',dataMode:order.live?'provider':'illustrative',dedupeKey,at:new Date(now).toISOString()},{dedupeHash:dedupeKey,expiresAt:now+Math.min(retentionMs,7*86400000)});if(isNotificationAllowed(alert,store.user(userId).preferences,now))fanOutPush(store,userId,alert.id);}
   signatures[key]={signature,at:now};
  }
  return store.put(userId,'supplier-monitor',{...current,signatures,nextCheckAt:now+600000,lastCheckedAt:new Date(now).toISOString(),lastError:error},{id:monitorId,expectedVersion:current.version,expiresAt:current.expiresAt});
 });
}
export async function supplierMonitorRoutes(ctx){
 const {url,req,b,store,session,travel,send,res}=ctx;
 if(url.pathname!=='/api/shopping/monitors')return false;
 if(req.method==='GET')send(res,200,{available:travel.flightStatusProvider?.license?.statusAllowed===true,monitors:store.list(session.userId,'supplier-monitor').map(m=>Object.fromEntries(Object.entries(m).filter(([key])=>key!=='signatures')))});
 else if(req.method==='POST')send(res,200,setSupplierMonitor(store,session.userId,b,travel.flightStatusProvider));
 else throw new DomainError('Method not allowed.',405);
 return true;
}
