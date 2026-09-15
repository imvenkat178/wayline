import {processJobs} from './jobs.mjs';
const foregroundKinds=['conversation-execution','shopping-query','shopping-connection','booking-operation'];
const definitions=[
 {name:'conversation',kinds:['conversation-execution']},
 {name:'shopping',kinds:['shopping-query','shopping-connection']},
 {name:'transaction',kinds:['booking-operation']},
 {name:'maintenance',excludeKinds:foregroundKinds}
];
// Separate bounded lanes prevent a slow provider or backup from blocking local
// chat. Each lane claims only one job when ready, and never overlaps itself.
export function startJobWorkers(store,handlers,{pollMs=5000,immediate=true,onError=()=>{},cleanupEveryMs=60000}={}) {
 let stopped=false,nextCleanup=0;
 const startedAt=Date.now();
 const lanes=definitions.map(d=>({...d,timer:null,running:null,runningSince:null,lastDrainAt:null}));
 function schedule(lane,delay){if(stopped||lane.running)return;if(lane.timer)clearTimeout(lane.timer);lane.timer=setTimeout(()=>drain(lane),delay);lane.timer.unref();}
 function drain(lane){
  if(stopped||lane.running)return;lane.timer=null;let count=0;lane.runningSince=Date.now();
  lane.running=(async()=>{
   if(lane.name==='maintenance'&&Date.now()>=nextCleanup){nextCleanup=Date.now()+cleanupEveryMs;try{store.cleanup();}catch(error){onError(error,'cleanup');}}
   const results=await processJobs(store,handlers,{limit:1,...(lane.kinds?{kinds:lane.kinds}:{excludeKinds:lane.excludeKinds})});count=results.length;
  })().catch(error=>onError(error,lane.name)).finally(()=>{lane.running=null;lane.runningSince=null;lane.lastDrainAt=Date.now();schedule(lane,count?0:pollMs);});
 }
 const previous=store.notifyJobQueued;
 const notify=kind=>{
  previous?.(kind);if(!immediate||stopped)return;
  const lane=lanes.find(l=>l.kinds?.includes(kind))??lanes.at(-1);schedule(lane,0);
 };
 store.notifyJobQueued=notify;
 for(const lane of lanes)schedule(lane,pollMs);
 // Heartbeat for the readiness probe (ROADMAP G2.4). An idle lane must have drained within three
 // poll intervals (at least 30s); a busy lane may run one job for up to 10 minutes.
 function status(now=Date.now()){
  const staleAfterMs=Math.max(pollMs*3,30000),stuckAfterMs=Math.max(staleAfterMs,600000);
  const view=lanes.map(l=>{const busy=l.runningSince!==null,since=busy?l.runningSince:(l.lastDrainAt??startedAt);return {name:l.name,busy,lastDrainAt:l.lastDrainAt?new Date(l.lastDrainAt).toISOString():null,ok:!stopped&&now-since<=(busy?stuckAfterMs:staleAfterMs)};});
  return {ok:!stopped&&view.every(l=>l.ok),stopped,lanes:view};
 }
 return {status,async stop(){stopped=true;for(const lane of lanes)if(lane.timer)clearTimeout(lane.timer);if(store.notifyJobQueued===notify)store.notifyJobQueued=previous;await Promise.all(lanes.map(l=>l.running));}};
}
