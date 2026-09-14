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
 const lanes=definitions.map(d=>({...d,timer:null,running:null}));
 function schedule(lane,delay){if(stopped||lane.running)return;if(lane.timer)clearTimeout(lane.timer);lane.timer=setTimeout(()=>drain(lane),delay);lane.timer.unref();}
 function drain(lane){
  if(stopped||lane.running)return;lane.timer=null;let count=0;
  lane.running=(async()=>{
   if(lane.name==='maintenance'&&Date.now()>=nextCleanup){nextCleanup=Date.now()+cleanupEveryMs;try{store.cleanup();}catch(error){onError(error,'cleanup');}}
   const results=await processJobs(store,handlers,{limit:1,...(lane.kinds?{kinds:lane.kinds}:{excludeKinds:lane.excludeKinds})});count=results.length;
  })().catch(error=>onError(error,lane.name)).finally(()=>{lane.running=null;schedule(lane,count?0:pollMs);});
 }
 const previous=store.notifyJobQueued;
 const notify=kind=>{
  previous?.(kind);if(!immediate||stopped)return;
  const lane=lanes.find(l=>l.kinds?.includes(kind))??lanes.at(-1);schedule(lane,0);
 };
 store.notifyJobQueued=notify;
 for(const lane of lanes)schedule(lane,pollMs);
 return {async stop(){stopped=true;for(const lane of lanes)if(lane.timer)clearTimeout(lane.timer);if(store.notifyJobQueued===notify)store.notifyJobQueued=previous;await Promise.all(lanes.map(l=>l.running));}};
}
