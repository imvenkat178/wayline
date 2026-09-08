import {digitalTwin,preferences} from './domain/journeys.mjs';
/** Restart-safe, per-recipient deduplication. It never buys, rebooks, or sends external messages. */
export function runGuardian(store,onlyUser,now=Date.now()){
 const owners=onlyUser?[{id:onlyUser}]:store.db.prepare('SELECT id FROM users LIMIT 1000').all();
 for(const {id:userId} of owners){const user=store.user(userId);if(!user)continue;const p=preferences(user.preferences);const prior=new Set(store.list(userId,'alert').map(a=>a.dedupeKey));
  const add=(key,alert)=>{if(prior.has(key))return;store.put(userId,'alert',{...alert,read:false,dedupeKey:key,delivery:'in-app',at:new Date(now).toISOString()},{expiresAt:now+7*86400000});prior.add(key);};
  for(const j of store.list(userId,'journey')){
   if(['ARRIVED','CANCELLED'].includes(j.state))continue;const twin=digitalTwin(j,{preferences:p});
   for(const alert of twin.alerts)if(alert.severity==='critical'||p.notifyInfo)add(`${j.id}:${alert.id}`,{...alert,journeyId:j.id,dataMode:j.dataMode});
   const leave=(Date.parse(twin.leave.leaveAt)-now)/60000;if(leave>=-5&&leave<=15)add(`${j.id}:leave`,{journeyId:j.id,severity:'warning',title:leave<=0?'Time to leave':'Your departure is coming up',body:`Allow ${twin.leave.walkMinutes} minutes to walk and ${twin.leave.boardingBuffer} minutes at the station. Check the operator's current departure.`,kind:'leave',dataMode:j.dataMode});
   if(now>Date.parse(j.arrival)+p.emergencyMinutes*60000&&store.list(userId,'contact').some(c=>c.consent))add(`${j.id}:checkin`,{journeyId:j.id,severity:'critical',title:'Check in with your contact',body:'Your recorded arrival time has passed. No emergency message has been sent; contact your chosen person directly.',kind:'check-in',dataMode:j.dataMode});
  }
  for(const commute of store.list(userId,'commute')){if(!commute.enabled)continue;const date=new Intl.DateTimeFormat('en-US',{timeZone:commute.timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now);const parts=Object.fromEntries(date.map(x=>[x.type,x.value]));const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday);const [h,m]=commute.time.split(':').map(Number);const minutes=h*60+m-(Number(parts.hour)%24*60+Number(parts.minute));if(commute.days.includes(day)&&minutes>=0&&minutes<=30){const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:commute.timezone}).format(now);add(`${commute.id}:${localDate}`,{severity:'info',title:`Check ${commute.name}`,body:'Your usual commute is coming up. Search current options before you leave.',kind:'commute',commuteId:commute.id});}}
  for(const pass of store.list(userId,'pass'))if(Date.parse(pass.renewal)-now<3*86400000&&Date.parse(pass.renewal)>now)add(`${pass.id}:renewal:${pass.renewal}`,{severity:'info',title:`${pass.name} renewal reminder`,body:'Review this self-reported pass with the operator. Wayline does not manage its billing.',kind:'renewal'});
 }
}
