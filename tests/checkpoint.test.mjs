import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/store.mjs';
import {createApplication} from '../server/server.mjs';
import {freshness, transition, priceBreakdown} from '../server/domain/journeys.mjs';

function temporaryStore(t) {
  const directory = mkdtempSync(join(tmpdir(), 'wayline-test-'));
  const store = new Store({directory, key: '12'.repeat(32), production: false});
  t.after(() => { store.close(); rmSync(directory, {recursive:true, force:true}); });
  return store;
}

test('stale GPS loses its live label without asserting cancellation', () => {
  const now = Date.now();
  const signal = freshness({source:'live-gps', observedAt:new Date(now-120000).toISOString()}, now);
  assert.equal(signal.source, 'predicted');
  assert.equal(signal.ghost, true);
  assert.equal(freshness({source:'sample'}, now).confidence, null);
});

test('total price includes group fares and fees using integer cents', () => {
  assert.equal(priceBreakdown(1000, {travelers:2,bags:1,bookingFeeCents:100,parkingCents:500,lastMileCents:200}).totalCents, 3400);
  assert.throws(() => priceBreakdown(1.5));
});

test('booking needs a provider ticket and state changes must follow the graph', () => {
  assert.throws(() => transition({state:'PLANNED',bookingConfirmed:false}, 'BOOKED'), {code:'PROVIDER_REQUIRED'});
  assert.throws(() => transition({state:'ARRIVED'}, 'IN_TRANSIT'), {code:'INVALID_TRANSITION'});
});

test('record isolation, optimistic concurrency, share revocation and history deletion', t => {
  const store=temporaryStore(t), a=store.createGuest(), b=store.createGuest();
  const j=store.put(a.id,'journey',{from:'A',to:'B',legs:[],state:'PLANNED',dataMode:'illustrative'});
  assert.throws(() => store.get(b.id,j.id), {status:404});
  store.put(a.id,'journey',{...j,state:'WAITING'},{id:j.id,expectedVersion:j.version});
  assert.throws(() => store.put(a.id,'journey',j,{id:j.id,expectedVersion:j.version}), {code:'VERSION_CONFLICT'});
  const share=store.share(a.id,j.id);
  assert.equal(store.shared(share.token).from,'A');
  assert.equal(store.shared(share.token).location,undefined);
  store.revokeShare(a.id,share.id);
  assert.throws(() => store.shared(share.token), {status:404});
  for(const kind of ['search','recovery','idempotency'])store.put(a.id,kind,{journeyId:j.id});
  store.deleteHistory(a.id);
  assert.deepEqual(store.export(a.id).records, []);
});

test('HTTP session, CSRF, registration preferences and role boundaries', async t => {
  const store=temporaryStore(t);
  const {server}=createApplication({store,production:false,quiet:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base=`http://127.0.0.1:${server.address().port}`;
    const response=await fetch(base+'/api/bootstrap');
    const boot=await response.json(), cookie=response.headers.get('set-cookie').split(';')[0];
    const headers={'content-type':'application/json',cookie};
    assert.equal((await fetch(base+'/api/auth/register',{method:'POST',headers,body:'{}'})).status,403);
    const registration=await fetch(base+'/api/auth/register',{method:'POST',headers:{...headers,'x-csrf-token':boot.csrf},body:JSON.stringify({name:'Test',email:'test@example.com',password:'a-strong-test-password'})});
    assert.equal(registration.status,201);
    const registered=await registration.json();
    assert.equal(registered.user.role,'traveler');
    assert.equal(registered.user.preferences.language,'en');
    const nextCookie=registration.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base+'/api/operator',{headers:{cookie:nextCookie}})).status,403);
    assert.equal((await fetch(base+'/api/journeys',{headers:{cookie}})).status,401);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
