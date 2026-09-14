import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.mjs';
import { createConversation, runWorkspaceTurn, workspaceSnapshot, evaluateOption } from '../server/domain/tripWorkspace.mjs';
import { interpretRules } from '../server/domain/workspaceInterpreter.mjs';
import { sampleSearch, preferences } from '../server/domain/journeys.mjs';
import { confirmAction } from '../server/domain/tripActions.mjs';

function fixture(t) {
  const root = resolve('tmp'); mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'conversation-test-'));
  const store = new Store({ directory, production: false });
  t.after(() => { store.close(); assert.ok(resolve(directory).startsWith(root)); rmSync(directory, { recursive: true, force: true }); });
  const user = store.createGuest(), other = store.createGuest();
  const calls = [];
  const travel = { async call(tool, input) {
    calls.push({ tool, input });
    if (tool === 'places') return { places: [{ id: 'bos', name: input.q, lat: 42.36, lon: -71.06, timezone: 'America/New_York' }] };
    assert.equal(tool, 'search');
    // Deliberately injected schedules, never shown as live inventory outside tests.
    const raw = sampleSearch({ ...input, from: 'bos', to: 'nyc', preferences: preferences({ ...input.preferences, budgetCents: 100000, maxWalkMinutes: 120, maxTransfers: 8 }) });
    return { ...raw, source: 'Injected test provider', cache: 'fresh', fetchedAt: new Date().toISOString(), journeys: raw.journeys.map(j => ({ ...j, dataMode: 'provider', accessible: true, reliability: null, price: { ...j.price, totalCents: null, unknown: true } })) };
  } };
  let w = createConversation(store, user.id);
  async function turn(input, command, extra = {}) {
    w = await runWorkspaceTurn(store, user.id, w.conversation.id, { clientTurnId: randomUUID(), expectedVersion: w.draft.version, input, command, visibleSetId: w.draft.activeSetId ?? undefined, ...extra }, travel, { available: false });
    return w;
  }
  return { store, user, other, travel, calls, directory, turn, get w() { return w; }, set w(next) { w = next; } };
}
const samplePatch = { from: 'bos', to: 'nyc', mode: 'sample', departure: new Date(Date.now() + 2 * 86400000).toISOString(), preferences: { budgetCents: 100000, maxWalkMinutes: 120, maxTransfers: 8 } };
async function search(f) { await f.turn('Find sample routes', { op: 'search_options', patch: samplePatch }); return f.w.sets.find(s => s.id === f.w.draft.activeSetId); }
async function select(f, set, position = 0) { assert.ok(set.options.length > position, 'Fixture must have selectable options'); return f.turn('Select this route', { op: 'select_option', setId: set.id, optionIds: [set.options[position].id] }); }

test('multi-turn unsaved trip preserves endpoints, budget, travelers and bags through later departure', async t => {
  const f = fixture(t);
  await f.turn('Find a trip from South Station to Harvard tomorrow at 9 am under $75 with one cabin bag');
  const before = f.w.draft.constraints;
  assert.equal(before.preferences.budgetCents, 7500); assert.equal(before.bags, 1);
  await f.turn('Find a later trip');
  assert.equal(f.calls.filter(x => x.tool === 'search').length, 2);
  const after = f.w.draft.constraints;
  assert.deepEqual(after.from, before.from); assert.deepEqual(after.to, before.to);
  assert.equal(after.preferences.budgetCents, 7500); assert.equal(after.bags, 1);
  assert.equal(Date.parse(after.departure) - Date.parse(before.departure), 3600000);
});

test('search → compare → select → edit → undo → review → save → reload continues same draft', async t => {
  const f = fixture(t), set = await search(f);
  assert.ok(set.options.length >= 3);
  await f.turn('Compare the first and third');
  assert.deepEqual(f.w.draft.comparison.map(r => r.optionId), [set.options[0].id, set.options[2].id]);
  await select(f, set, 2);
  const selected = f.w.draft.selected.optionId, constraints = f.w.draft.constraints;
  await f.turn('Find a later trip'); assert.equal(f.w.draft.selected, null);
  await f.turn('Undo that');
  assert.equal(f.w.draft.selected.optionId, selected); assert.deepEqual(f.w.draft.constraints, constraints);
  await f.turn('Save this trip');
  const action = f.w.messages.at(-1).pendingActions[0]; assert.ok(action);
  const saved = await confirmAction(f.store, f.user.id, action.id, f.travel);
  assert.equal(f.store.list(f.user.id, 'journey').length, 1);
  const again = await confirmAction(f.store, f.user.id, action.id, f.travel); assert.equal(again.journey.id, saved.journey.id);
  f.w = workspaceSnapshot(f.store, f.user.id, f.w.conversation.id);
  assert.equal(f.w.journey.id, saved.journey.id); assert.equal(f.w.draft.selected.optionId, selected);
  assert.equal(f.w.messages.at(-1).pendingActions[0].status, 'applied');
  await f.turn('Find a later trip'); assert.equal(f.w.draft.constraints.preferences.budgetCents, 100000);
});

test('conversation and owner isolation include candidate sets and history', async t => {
  const f = fixture(t), set = await search(f), a = f.w;
  const b = createConversation(f.store, f.user.id);
  assert.equal(b.messages.length, 0); assert.equal(b.draft.constraints.from, '');
  await assert.rejects(runWorkspaceTurn(f.store, f.user.id, b.conversation.id, { input: 'Select', clientTurnId: 'cross-set', expectedVersion: b.draft.version, command: { op: 'select_option', setId: set.id, optionIds: [set.options[0].id] } }, f.travel), /different conversation/);
  assert.throws(() => workspaceSnapshot(f.store, f.other.id, a.conversation.id), /not found/);
  assert.deepEqual(workspaceSnapshot(f.store, f.user.id, a.conversation.id).draft, a.draft);
});

test('stable old result references survive new searches; stale candidates cannot replace current requirements', async t => {
  const f = fixture(t), old = await search(f);
  await f.turn('Find a later trip');
  await f.turn('Compare old cards', { op: 'compare_options', setId: old.id, optionIds: [old.options[0].id, old.options[2].id] });
  assert.deepEqual(f.w.draft.comparison.map(r => r.optionId), [old.options[0].id, old.options[2].id]);
  await assert.rejects(select(f, old), /different trip requirements/);
});

test('idempotent retry does not search or revise twice, reused ID and stale tabs are rejected', async t => {
  const f = fixture(t), initial = f.w;
  const request = { clientTurnId: 'same-message', expectedVersion: initial.draft.version, input: 'Find sample', command: { op: 'search_options', patch: samplePatch } };
  const first = await runWorkspaceTurn(f.store, f.user.id, initial.conversation.id, request, f.travel);
  const again = await runWorkspaceTurn(f.store, f.user.id, initial.conversation.id, request, f.travel);
  assert.equal(again.draft.version, first.draft.version); assert.equal(again.messages.length, 1);
  await assert.rejects(runWorkspaceTurn(f.store, f.user.id, initial.conversation.id, { ...request, input: 'Different' }, f.travel), /already used/);
  await assert.rejects(runWorkspaceTurn(f.store, f.user.id, initial.conversation.id, { ...request, clientTurnId: 'stale-tab' }, f.travel), /another tab/);
});

test('failed provider call preserves selected draft and exposes retryable failure', async t => {
  const f = fixture(t), set = await search(f); await select(f, set);
  const before = f.w.draft;
  f.travel.call = async () => { throw new Error('provider outage'); };
  await assert.rejects(f.turn('Switch provider', { op: 'search_options', patch: { mode: 'provider' } }), /outage/);
  const after = workspaceSnapshot(f.store, f.user.id, f.w.conversation.id);
  assert.deepEqual(after.draft, before); assert.equal(after.messages.at(-1).status, 'failed'); assert.equal(after.conversation.pending, null);
});

test('concurrent edits and an expired execution lease cannot overwrite a draft', async t => {
  const f = fixture(t); let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const oldCall = f.travel.call;
  f.travel.call = async (...args) => { entered(); await wait; return oldCall(...args); };
  const pending = f.turn('Find a trip from South Station to Harvard tomorrow at 9 am');
  await started;
  await assert.rejects(f.turn('Find a later trip'), /still running/);
  const c = f.store.get(f.user.id, f.w.conversation.id, 'conversation');
  f.store.put(f.user.id, 'conversation', { ...c, pending: { ...c.pending, until: 0 } }, { id: c.id, expectedVersion: c.version });
  release(); await assert.rejects(pending, /superseded/);
  assert.equal(workspaceSnapshot(f.store, f.user.id, c.id).draft.version, 1);
});

test('scenario keeps selected plan and undo restores branch changes', async t => {
  const f = fixture(t), set = await search(f); await select(f, set);
  const before = f.w.draft;
  await f.turn('What if I leave Friday?');
  assert.deepEqual(f.w.draft.selected, before.selected); assert.deepEqual(f.w.draft.constraints, before.constraints);
  assert.equal(f.w.scenarios.length, 1);
  const scenario = f.w.scenarios[0];
  await f.turn('Restore scenario', { op: 'restore_scenario', scenarioId: scenario.id });
  assert.equal(f.w.draft.constraints.departure, scenario.departure);
  await f.turn('Undo that'); assert.deepEqual(f.w.draft.selected, before.selected);
});

test('service locks reject replacement and ambiguous legs require an exact reference', async t => {
  const f = fixture(t), set = await search(f); await select(f, set);
  const leg = f.w.draft.selected.journey.legs.find(l => l.mode !== 'walk');
  await f.turn('Keep service', { op: 'lock_leg', legId: leg.id });
  await assert.rejects(f.turn('Replace service', { op: 'replace_leg', legId: leg.id, replacementMode: 'train' }), /Unlock/);
  await assert.rejects(f.turn('Keep flight', { op: 'lock_leg', legMode: 'flight' }), /exact leg/);
  await f.turn('Find a later trip');
  const next = f.w.sets.find(s => s.id === f.w.draft.activeSetId);
  assert.equal(next.options.length, 0); assert.equal(f.w.draft.locks.length, 1);
});

test('unknown fares and baggage stay incomplete; hard constraints apply before labels', async t => {
  const f = fixture(t);
  await f.turn('Find a trip from South Station to Harvard tomorrow at 9 am under $75 with one cabin bag');
  const set = f.w.sets.find(s => s.id === f.w.draft.activeSetId);
  assert.ok(set.options.length);
  for (const o of set.options) { assert.equal(o.complete, false); assert.deepEqual(o.labels, []); assert.match(o.unknowns.join(' '), /budget cannot be verified/); }
  const j = set.options[0].journey;
  const over = evaluateOption({ ...j, price: { totalCents: 8000 } }, f.w.draft.constraints);
  assert.ok(over.reasons.includes('Over the total budget'));
});

test('editing after a save review invalidates confirmation and expired sets cannot be selected', async t => {
  const f = fixture(t), set = await search(f); await select(f, set); await f.turn('Save this trip');
  const action = f.w.messages.at(-1).pendingActions[0];
  await f.turn('Find a later trip');
  await assert.rejects(confirmAction(f.store, f.user.id, action.id, f.travel), /draft changed/);
  assert.equal(f.store.list(f.user.id, 'journey').length, 0);
  const stored = f.store.get(f.user.id, f.w.draft.activeSetId, 'candidate-set');
  f.store.put(f.user.id, 'candidate-set', { ...stored, expiresAt: 0 }, { id: stored.id, expectedVersion: stored.version });
  const next = workspaceSnapshot(f.store, f.user.id, f.w.conversation.id).sets.find(s => s.id === stored.id);
  await assert.rejects(select(f, next), /expired/);
});

test('model cannot invent operational facts or cross-conversation IDs', async t => {
  const f = fixture(t), set = await search(f);
  const provider = { available: true, async chat() { return JSON.stringify({ op: 'advice', airline: 'Invented Air', fare: 5 }); } };
  const next = await runWorkspaceTurn(f.store, f.user.id, f.w.conversation.id, { clientTurnId: randomUUID(), expectedVersion: f.w.draft.version, input: 'Which gate?', visibleSetId: set.id }, f.travel, provider);
  assert.doesNotMatch(next.messages.at(-1).reply, /Invented Air|\$5/);
});

test('private retention and history deletion include all workspace records', async t => {
  const f = fixture(t);
  f.store.updateUser(f.user.id, { preferences: preferences({ saveHistory: false }) });
  f.w = createConversation(f.store, f.user.id); await search(f);
  assert.ok(f.w.conversation.expiresAt <= Date.now() + 86400000);
  const exported = f.store.export(f.user.id);
  assert.ok(exported.records.some(r => r.kind === 'trip-draft'));
  f.store.deleteHistory(f.user.id);
  for (const kind of ['conversation', 'trip-draft', 'conversation-turn', 'candidate-set', 'draft-revision', 'draft-scenario']) assert.equal(f.store.list(f.user.id, kind).length, 0, kind);
});

test('weekday and relative-time parsing use the draft timezone and preserve requirements', t => {
  const f = fixture(t);
  const d = { ...f.w.draft, constraints: { ...f.w.draft.constraints, timezone: 'America/New_York' } };
  const cmd = interpretRules('What if I leave Friday?', d, Date.parse('2026-09-12T12:00:00Z'));
  assert.equal(cmd.patch.departure, '2026-09-18T13:00:00.000Z');
});

test('replacement revalidates the whole itinerary and preserves every other service', async t => {
  const f = fixture(t);
  await f.turn('Find a trip from South Station to Harvard tomorrow at 9 am under $75');
  const set = f.w.sets.find(s => s.id === f.w.draft.activeSetId); await select(f, set);
  const original = f.w.draft.selected.journey;
  const leg = original.legs.find(l => l.mode !== 'walk');
  const candidate = structuredClone(original);
  candidate.legs.find(l => l.id === leg.id).mode = 'bus';
  candidate.price = { totalCents: 1234, currency: 'USD', items: [] };
  f.travel.call = async () => ({ journeys: [candidate], excluded: [], source: 'Replacement test provider', cache: 'fresh', fetchedAt: new Date().toISOString() });
  await f.turn('Replace selected leg', { op: 'replace_leg', legId: leg.id, replacementMode: 'bus' });
  const replacements = f.w.sets.find(s => s.id === f.w.draft.activeSetId);
  assert.equal(replacements.options.length, 1);
  const changed = replacements.options[0].journey;
  assert.deepEqual(changed.legs.filter(l => l.id !== leg.id), original.legs.filter(l => l.id !== leg.id));
  await select(f, replacements);
  assert.equal(f.w.draft.selected.journey.price.totalCents, 1234);
  assert.equal(f.w.draft.selected.journey.legs.find(l => l.id === leg.id).mode, 'bus');
});

test('HTTP conversation routes enforce CSRF, owner scoping and resume after reconnect', async t => {
  const { createApplication } = await import('../server/server.mjs');
  const f = fixture(t); f.travel.close = async () => {};
  const app = createApplication({ store: f.store, travel: f.travel, quiet: true });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${app.server.address().port}/api`;
    const bootResponse = await fetch(base + '/bootstrap');
    const boot = await bootResponse.json(), cookie = bootResponse.headers.get('set-cookie').split(';')[0];
    const post = async (path, data, csrf = boot.csrf) => {
      const r = await fetch(base + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(data) });
      return { status: r.status, data: await r.json() };
    };
    assert.equal((await post('/conversations', {}, 'wrong')).status, 403);
    const created = await post('/conversations', {}); assert.equal(created.status, 201);
    const path = '/conversations/' + created.data.conversation.id;
    const result = await post(path + '/turns', { clientTurnId: 'http-search', expectedVersion: 1, input: 'Search samples', command: { op: 'search_options', patch: samplePatch } });
    assert.equal(result.status, 200); assert.ok(result.data.sets[0].options.length);
    const resumed = await fetch(base + path, { headers: { cookie } });
    assert.deepEqual((await resumed.json()).draft, result.data.draft);
    const unauthenticated = await fetch(base + path); assert.equal(unauthenticated.status, 401);
    const otherBoot = await fetch(base + '/bootstrap');
    const otherCookie = otherBoot.headers.get('set-cookie').split(';')[0];
    const foreign = await fetch(base + path, { headers: { cookie: otherCookie } }); assert.equal(foreign.status, 404);
    assert.equal((await post(path + '/turns', { clientTurnId: 'stale', expectedVersion: 1, input: 'Find later' })).status, 409);
  } finally { await app.stopBackgroundJobs(); await new Promise(resolve => app.server.close(resolve)); }
});


test('a changed fare at confirmation requires a fresh review', async t => {
  const f = fixture(t);
  await f.turn('Find a trip from South Station to Harvard tomorrow at 9 am');
  const set = f.w.sets.find(s => s.id === f.w.draft.activeSetId); await select(f, set); await f.turn('Save this trip');
  const action = f.w.messages.at(-1).pendingActions[0], j = f.w.draft.selected.journey;
  f.travel.call = async tool => tool === 'search' ? { cache: 'fresh', journeys: [{ ...j, price: { ...j.price, totalCents: 240, unknown: false } }] } : { cache: 'fresh', fetchedAt: new Date().toISOString(), alerts: [], disruptions: [] };
  await assert.rejects(confirmAction(f.store, f.user.id, action.id, f.travel), e => e.code === 'PRICE_CHANGED');
  assert.equal(f.store.list(f.user.id, 'journey').length, 0);
});

test('disruption requests do not rewrite ordinary draft budget or departure', t => {
  const f = fixture(t);
  const cmd = interpretRules('My flight is delayed. Get me there tonight for at most $40 extra.', f.w.draft);
  assert.equal(cmd.op, 'prepare_recovery'); assert.equal(cmd.maxExtraCents, 4000); assert.ok(cmd.arrivalDeadline);
  assert.equal(cmd.patch, undefined);
});
