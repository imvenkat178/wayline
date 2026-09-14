import {spawn} from 'node:child_process';
import {writeFileSync,createWriteStream} from 'node:fs';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:4174',paths=['/','/assets/Profile-W6QNQdIv.js'];
const report={startedAt:new Date().toISOString(),base,scope:'HTTP availability of an already-open app while npm build stages and publishes',checks:0,failures:[],maxResponseMs:0};
for(const path of paths){const response=await fetch(base+path);assert.equal(response.status,200,'Application must be ready before the build');await response.arrayBuffer();}
const log=createWriteStream('tmp/staged-build.log');
const child=spawn(process.execPath,['scripts/build.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:process.env});
child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
let running=true,code;
const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',value=>{code=value;running=false;resolve();});});
try {
 while(running) {
  for(const path of paths) {
   const start=Date.now();
   try {const response=await fetch(base+path,{signal:AbortSignal.timeout(10000)}),body=await response.text();assert.equal(response.status,200);assert.ok(body.length>100);if(path.endsWith('.js'))assert.match(response.headers.get('content-type'),/javascript/);}
   catch(error){report.failures.push({path,error:error.message});}
   report.checks++;report.maxResponseMs=Math.max(report.maxResponseMs,Date.now()-start);
  }
  if(running)await new Promise(r=>setTimeout(r,200));
 }
 await done;report.buildExitCode=code;report.pass=code===0&&report.failures.length===0&&report.checks>0;
 report.finishedAt=new Date().toISOString();writeFileSync('docs/evaluations/build-availability.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1;
}finally{log.end();}
