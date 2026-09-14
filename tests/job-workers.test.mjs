import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {Store} from '../server/store.mjs';
import {enqueueJob,claimDueJobs,processJobs,ensureRecurringJob} from '../server/jobs.mjs';
import {startJobWorkers} from '../server/jobWorkers.mjs';
const until=async predicate=>{const end=Date.now()+5000;while(!predicate()){if(Date.now()>end)throw Error('Expected job transition did not occur');await new Promise(r=>setTimeout(r,10));}};
function fixture(t){mkdirSync('tmp',{recursive:true});const directory=mkdtempSync(join(resolve('tmp'),'worker-lanes-')),store=new Store({directory,production:false}),gates=[];let worker;const f={store,gate(){let release;const promise=new Promise(r=>release=r);gates.push(release);return {promise,release};},start(handlers,options){worker=startJobWorkers(store,handlers,{pollMs:60000,...options});return worker;}};t.after(async()=>{gates.forEach(r=>r());await worker?.stop();store.close();assert.ok(directory.startsWith(resolve('tmp')+sep));rmSync(directory,{recursive:true,force:true});});return f;}

test('queued chat wakes immediately while maintenance remains blocked',async t=>{
 const f=fixture(t),gate=f.gate();let maintenance=false,chat=false;
 f.start({'slow-maintenance':async()=>{maintenance=true;await gate.promise;},'conversation-execution':()=>{chat=true;}});
 enqueueJob(f.store,'slow-maintenance');await until(()=>maintenance);
 const id=enqueueJob(f.store,'conversation-execution');await until(()=>chat);
 assert.equal(f.store.db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status,'done');
 assert.equal(f.store.db.prepare("SELECT status FROM jobs WHERE kind='slow-maintenance'").get().status,'leased');
});
test('conversation work is serialized and transaction reconciliation cannot block it',async t=>{
 const f=fixture(t),chatGate=f.gate(),moneyGate=f.gate();let calls=0,transaction=false;
 f.start({'booking-operation':async()=>{transaction=true;await moneyGate.promise;},'conversation-execution':async()=>{calls++;if(calls===1)await chatGate.promise;}});
 enqueueJob(f.store,'booking-operation');enqueueJob(f.store,'conversation-execution');await until(()=>transaction&&calls===1);
 enqueueJob(f.store,'conversation-execution');await new Promise(r=>setTimeout(r,40));assert.equal(calls,1);
 chatGate.release();await until(()=>calls===2);assert.equal(transaction,true);
});
test('a rolled-back outbox insert never executes even when it signals a wakeup',async t=>{
 const f=fixture(t);let calls=0;f.start({'conversation-execution':()=>{calls++;}});
 assert.throws(()=>f.store.transaction(()=>{enqueueJob(f.store,'conversation-execution');throw Error('rollback');}),/rollback/);
 await new Promise(r=>setTimeout(r,40));assert.equal(calls,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM jobs').get().n,0);
});
test('shutdown awaits in-flight work and leaves newly queued jobs durable',async t=>{
 const f=fixture(t),gate=f.gate();let started=false,stopped=false;
 const worker=f.start({'conversation-execution':async()=>{started=true;await gate.promise;}});
 enqueueJob(f.store,'conversation-execution');await until(()=>started);
 const stop=worker.stop().then(()=>stopped=true);const queued=enqueueJob(f.store,'conversation-execution');
 await new Promise(r=>setTimeout(r,30));assert.equal(stopped,false);gate.release();await stop;
 assert.equal(f.store.db.prepare('SELECT status FROM jobs WHERE id=?').get(queued).status,'pending');
});
test('lane filters apply to both pending and expired leases',t=>{
 const f=fixture(t);const a=enqueueJob(f.store,'conversation-execution'),b=enqueueJob(f.store,'booking-operation');
 const claim=claimDueJobs(f.store,{kinds:['conversation-execution']});assert.deepEqual(claim.map(j=>j.id),[a]);
 f.store.db.prepare('UPDATE jobs SET leased_until=0 WHERE id=?').run(a);
 assert.deepEqual(claimDueJobs(f.store,{excludeKinds:['conversation-execution']}).map(j=>j.id),[b]);
 assert.equal(f.store.db.prepare('SELECT status FROM jobs WHERE id=?').get(a).status,'leased');
});
test('recurring jobs schedule from completion so long work does not trigger a catch-up loop',async t=>{
 const f=fixture(t),id=ensureRecurringJob(f.store,'slow-recurring',{},100);
 await processJobs(f.store,{'slow-recurring':()=>new Promise(r=>setTimeout(r,130))});
 assert.ok(f.store.db.prepare('SELECT run_at FROM jobs WHERE id=?').get(id).run_at>Date.now()+50);
});
