import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Store} from '../server/store.mjs';
import {createApplication} from '../server/server.mjs';
mkdirSync('tmp',{recursive:true});
const store=new Store({directory:mkdtempSync(join(resolve('tmp'),'export-bench-')),production:false});
const app=createApplication({store,travel:{close:async()=>{}},quiet:true,immediateJobs:false,drainIntervalMs:600000});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+app.server.address().port;
try {
 const bootstrap=await fetch(base+'/api/bootstrap'),boot=await bootstrap.json(),cookie=bootstrap.headers.get('set-cookie').split(';')[0];
 const headers={cookie,'content-type':'application/json','x-csrf-token':boot.csrf};
 const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;};
 const search=await post('/api/search',{from:'bos',to:'nyc',mode:'sample',departure:new Date(Date.now()+7*86400000).toISOString(),preferences:{budgetCents:100000,maxTransfers:8,maxWalkMinutes:120}});
 const review=await post('/api/agent/actions',{kind:'add',searchId:search.searchId,candidateId:search.journeys[0].id});
 const saved=await post('/api/agent/actions/'+review.id+'/confirm',{});
 const rows=[];
 for(const [path,magic] of [['itinerary.pdf','%PDF-'],['calendar','BEGIN:VCALENDAR']]) {
  const start=Date.now(),response=await fetch(base+'/api/journeys/'+saved.journey.id+'/'+path,{headers:{cookie}}),body=Buffer.from(await response.arrayBuffer());
  assert.equal(response.status,200);assert.ok(body.toString().includes(magic));
  rows.push({path,status:response.status,bytes:body.length,contentType:response.headers.get('content-type'),durationMs:Date.now()-start,pass:true});
 }
 const report={at:new Date().toISOString(),validationClass:'isolated HTTP application with fixture inventory',rows};
 writeFileSync('docs/evaluations/export-performance.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await app.stopBackgroundJobs();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));store.close();}
