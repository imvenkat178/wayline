import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Store} from '../server/store.mjs';
import {createApplication} from '../server/server.mjs';
import {createConversation,runWorkspaceTurn} from '../server/domain/tripWorkspace.mjs';
process.env.OLLAMA_BASE_URL='http://127.0.0.1:11434';
process.env.OLLAMA_MODEL=process.env.BENCH_MODEL??'llama3.1:8b-instruct-q4_K_M';
process.env.OLLAMA_NUM_CTX='8192';process.env.ENABLE_EXTERNAL_FEEDS='false';
mkdirSync('tmp',{recursive:true});mkdirSync('docs/evaluations',{recursive:true});
const store=new Store({directory:mkdtempSync(join(resolve('tmp'),'latency-bench-')),production:false});
const app=createApplication({store,travel:{close:async()=>{},call:async()=>{throw Error('No external provider in latency fixture');}},quiet:true});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+app.server.address().port;
const repeats=Number(process.env.BENCH_REPEATS??1);
if(!Number.isInteger(repeats)||repeats<1||repeats>5)throw Error('BENCH_REPEATS must be 1 to 5');
const cases=[['Show my traveler profiles','manage_travelers'],['Set the trip budget to $120','update_constraints'],['What if I leave two hours later?','branch_scenario'],['Which existing option is cheapest?','compare_options'],['Download my itinerary PDF','export_pdf'],['I need to cancel the supplier order','cancel_ticket'],['Import my train ticket','manage_tickets'],['Show my emergency contacts','manage_contacts']];
const file=process.env.BENCH_OUTPUT??'docs/evaluations/latency-benchmark.json';
const report={startedAt:new Date().toISOString(),model:process.env.OLLAMA_MODEL,validationClass:'real local Llama; isolated HTTP application with fixture inventory',pollMs:100,rows:[],codeHashes:Object.fromEntries(['server/domain/conversationExecution.mjs','server/domain/resolveSurfaceCommand.mjs','server/jobWorkers.mjs','server/server.mjs','server/jobs.mjs','server/domain/conversationPlanner.mjs','server/domain/intentVerifier.mjs','server/adapters/llm.mjs'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))};
const save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');save();
try {
 for(let repeat=1;repeat<=repeats;repeat++)for(const [input,expected] of cases){
  const u=store.createGuest(),s=store.session(u.id);let w=createConversation(store,u.id);
  const direct=async command=>w=await runWorkspaceTurn(store,u.id,w.conversation.id,{input:'Fixture setup',command,clientTurnId:randomUUID(),expectedVersion:w.draft.version,visibleSetId:w.draft.activeSetId??undefined},{},{available:false});
  await direct({op:'search_options',patch:{from:'bos',to:'nyc',mode:'sample',departure:new Date(Date.now()+7*86400000).toISOString(),preferences:{budgetCents:100000,maxWalkMinutes:120,maxTransfers:8}}});
  const set=w.sets.at(-1);await direct({op:'select_option',setId:set.id,optionIds:[set.options[0].id]});
  const headers={'content-type':'application/json',cookie:'wayline_session='+s.token,'x-csrf-token':s.csrf},started=Date.now();
  const sent=await fetch(base+'/api/conversations/'+w.conversation.id+'/turns',{method:'POST',headers,body:JSON.stringify({input,async:true,clientTurnId:randomUUID(),expectedVersion:w.draft.version,visibleSetId:set.id})});
  let value=await sent.json(),e=value.execution;if(sent.status!==202)throw Error(JSON.stringify(value));
  const path=base+'/api/conversations/'+w.conversation.id+'/executions/'+e.id;
  while(!['completed','failed','cancelled'].includes(e.state)){if(Date.now()-started>240000)throw Error('Execution timeout: '+input);await new Promise(r=>setTimeout(r,100));e=await fetch(path,{headers}).then(r=>r.json());}
  const queued=Date.parse(e.events.find(x=>x.type==='queued').at),interpreting=Date.parse(e.events.find(x=>x.type==='interpreting')?.at);
  const row={repeat,input,expected,actual:e.plan?.map(x=>x.op),pass:e.state==='completed'&&e.inference?.source==='llama'&&e.inference.modelCalls>0&&e.plan.length===1&&e.plan[0].op===expected,wallMs:Date.now()-started,queueMs:interpreting-queued,modelMs:e.inference?.latencyMs,inference:e.inference};report.rows.push(row);save();console.log(JSON.stringify(row));
 }
 report.finishedAt=new Date().toISOString();report.summary={passed:report.rows.filter(r=>r.pass).length,total:report.rows.length,modelCalls:report.rows.reduce((s,r)=>s+r.inference.modelCalls,0),promptTokens:report.rows.reduce((s,r)=>s+(r.inference.promptTokens??0),0),outputTokens:report.rows.reduce((s,r)=>s+(r.inference.outputTokens??0),0)};
 report.codeUnchanged=Object.entries(report.codeHashes).every(([p,h])=>createHash('sha256').update(readFileSync(p)).digest('hex')===h);
 report.pass=report.codeUnchanged&&report.summary.passed===report.summary.total;if(!report.pass)process.exitCode=1;save();
}finally{await app.stopBackgroundJobs();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));store.close();}
