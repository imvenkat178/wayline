import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.mjs';
import { createConversation, runWorkspaceTurn, workspaceSnapshot } from '../server/domain/tripWorkspace.mjs';
import { interpretRules } from '../server/domain/workspaceInterpreter.mjs';
import { normalizeDuffelOffer } from '../server/shopping/duffel.mjs';
import { runShoppingQuery, reviewOffer, confirmComparison } from '../server/shopping/service.mjs';
import { normalizeFlightConstraints, flightRequest } from '../server/domain/workspaceFlights.mjs';

const departure = new Date(Date.now() + 7 * 86400000).toISOString();
const passenger = { id: 'adult-1', type: 'adult', personal: 0, cabin: 1, checked: 0 };
const initial = { from: 'BOS', to: 'JFK', mode: 'flights', departure, travelers: 1, passengers: [passenger], preferences: { budgetCents: 50000, maxTransfers: 4, minConnectionMinutes: 0 } };
function fixture(t) {
  mkdirSync(resolve('tmp'), { recursive: true });
  const directory = mkdtempSync(join(resolve('tmp'), 'workspace-flights-'));
  const store = new Store({ directory, production: false }), user = store.createGuest(), other = store.createGuest();
  const env = { token: process.env.DUFFEL_ACCESS_TOKEN, external: process.env.ENABLE_EXTERNAL_FEEDS };
  process.env.DUFFEL_ACCESS_TOKEN = 'test-fixture-only'; process.env.ENABLE_EXTERNAL_FEEDS = 'true';
  t.after(() => {
    for (const [key, value] of [['DUFFEL_ACCESS_TOKEN', env.token], ['ENABLE_EXTERNAL_FEEDS', env.external]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    store.close(); assert.ok(resolve(directory).startsWith(resolve('tmp') + '\\')); rmSync(directory, { recursive: true, force: true });
  });
  const state = { refresh: null, connecting: false, missingBags: false, testInventory: false, calls: [] };
  function offers(request) {
    const airport = code => ({ id: 'arp_' + code, name: code, iata_code: code, iata_country_code: 'US', latitude: 42, longitude: -71, time_zone: 'America/New_York' });
    return [0, 1, 2].map(i => {
      const start = Date.parse(request.departure) + (2 + i) * 3600000;
      const segment = (from, to, index, offset) => ({ id: `seg_${i}_${index}`, origin: airport(from), destination: airport(to),
        departing_at: new Date(start + offset * 3600000).toISOString(), arriving_at: new Date(start + (offset + 1) * 3600000).toISOString(),
        operating_carrier: { name: 'Fixture Air' }, marketing_carrier: { name: 'Fixture Air' }, operating_carrier_flight_number: `${100 + i * 2 + index}`,
        passengers: request.passengers.map((p, index) => ({ passenger_id: 'pas_' + index, baggages: [{ type: 'carry_on', quantity: state.missingBags ? 0 : 2 }, { type: 'checked', quantity: 1 }] })) });
      const raw = { id: 'off_fixture' + i, owner: { name: 'Fixture seller' }, live_mode: !state.testInventory, expires_at: new Date(Date.now() + 1800000).toISOString(), total_amount: String((80 + i * 20) * request.passengers.length), total_currency: 'USD',
        slices: [{ segments: state.connecting ? [segment('BOS', 'PHL', 0, 0), segment('PHL', 'JFK', 1, 2)] : [segment('BOS', 'JFK', 0, 0)] }] };
      return normalizeDuffelOffer(raw, request, Object.fromEntries(request.passengers.map((p, index) => ['pas_' + index, p.id])));
    });
  }
  const travel = { async call(tool, args) {
    state.calls.push(tool);
    if (tool === 'flight_search') return { offers: offers(args.request), fetchedAt: new Date().toISOString() };
    assert.equal(tool, 'flight_refresh');
    if (state.refresh) return state.refresh(args);
    return { offer: args.offer, fetchedAt: new Date().toISOString() };
  } };
  let w = createConversation(store, user.id);
  const turn = async (input, command, overrides = {}) => { w = await runWorkspaceTurn(store, user.id, w.conversation.id, { clientTurnId: randomUUID(), expectedVersion: w.draft.version, input, command, visibleSetId: w.draft.activeSetId ?? undefined, ...overrides }, travel, { available: false }); return w; };
  const finish = async () => { for (const query of store.get(user.id, w.draft.activeShoppingId, "shopping-search").queries) await runShoppingQuery(store, travel, { userId: user.id, searchId: w.draft.activeShoppingId, index: query.index }); return turn('Load flight offers', { op: 'collect_options' }); };
  const search = async (patch = initial) => { await turn('Search flights', { op: 'search_options', patch }); await finish(); return w.sets.find(s => s.id === w.draft.activeSetId); };
  const select = async (set, index = 0) => turn('Select this flight', { op: 'select_option', setId: set.id, optionIds: [set.options[index].id] });
  return { store, user, other, travel, state, turn, finish, search, select, get w() { return w; }, set w(value) { w = value; } };
}

test('flight conversation: queue, reload, immutable cards, compare, select, review, save, reload', async t => {
  const f = fixture(t);
  await f.turn('Search flights', { op: 'search_options', patch: initial });
  assert.equal(f.w.draft.constraints.mode, 'flights'); assert.equal(f.w.shoppingSearches[0].state, 'queued');
  assert.equal(f.w.sets.length, 0); assert.equal(f.w.draft.selected, null);
  const resumed = workspaceSnapshot(f.store, f.user.id, f.w.conversation.id); assert.equal(resumed.draft.activeShoppingId, f.w.draft.activeShoppingId);
  await f.finish(); const set = f.w.sets[0]; assert.equal(set.options.length, 3); assert.ok(set.options[0].labels.includes('Lowest complete price found'));
  const version = f.w.draft.version; await f.turn('Load offers', { op: 'collect_options' }); assert.equal(f.w.draft.version, version); assert.equal(f.w.sets.length, 1);
  await f.turn('Compare the first and third'); assert.deepEqual(f.w.draft.comparison.map(o => o.optionId), [set.options[0].id, set.options[2].id]);
  await f.select(set, 2); await f.turn('Save this trip');
  const review = f.w.messages.at(-1).flightReview; assert.equal(review.draftVersion, f.w.draft.version);
  const saved = await confirmComparison(f.store, f.user.id, review.id, f.travel); assert.equal(saved.bookingConfirmed, false);
  assert.equal((await confirmComparison(f.store, f.user.id, review.id, f.travel)).id, saved.id);
  const final = workspaceSnapshot(f.store, f.user.id, f.w.conversation.id); assert.equal(final.savedComparison.id, saved.id); assert.equal(final.messages.at(-1).flightReview.state, 'confirmed');
  assert.equal(f.store.list(f.user.id, 'journey').length, 0);
});

test('natural flight edits preserve airport, whole-party budget and typed baggage; undo restores selection', async t => {
  const f = fixture(t);
  await f.turn('Find flights from BOS to JFK tomorrow at 9 am under $500 with one cabin bag');
  assert.equal(f.w.draft.constraints.passengers[0].cabin, 1); assert.equal(f.w.draft.constraints.timezone, 'America/New_York');
  await f.finish(); const set = f.w.sets[0]; await f.select(set);
  const before = structuredClone(f.w.draft);
  await f.turn('Find a later trip');
  assert.equal(f.w.draft.constraints.from, 'BOS'); assert.equal(f.w.draft.constraints.to, 'JFK'); assert.equal(f.w.draft.constraints.preferences.budgetCents, 50000);
  assert.deepEqual(f.w.draft.constraints.passengers, before.constraints.passengers);
  assert.equal(Date.parse(f.w.draft.constraints.departure) - Date.parse(before.constraints.departure), 3600000); assert.equal(f.w.draft.selected, null);
  await f.turn('Undo that'); assert.equal(f.w.draft.selected.optionId, before.selected.optionId);
  await f.turn('two travelers with one checked bag each'); assert.equal(f.w.draft.constraints.passengers.length, 2); assert.equal(f.w.draft.constraints.passengers[1].checked, 1);
  await assert.rejects(f.turn('with two bags'), /per traveler|cabin or checked/);
});

test('blocked supplier access persists flight requirements without fabricating offers', async t => {
  const f = fixture(t); delete process.env.DUFFEL_ACCESS_TOKEN;
  await f.turn('Search flights', { op: 'search_options', patch: initial });
  assert.equal(f.w.shoppingSearches[0].state, 'blocked'); assert.equal(f.w.draft.constraints.passengers[0].cabin, 1);
  assert.equal(f.w.sets.length, 0); assert.equal(f.state.calls.length, 0); assert.match(f.w.messages.at(-1).reply, /no fares/);
});

test('incomplete baggage and test offers cannot receive complete-price recommendations', async t => {
  const f = fixture(t); f.state.missingBags = true;
  let set = await f.search(); assert.ok(set.options.every(o => !o.complete && !o.labels.length && o.unknowns.length));
  f.state.missingBags = false; f.state.testInventory = true;
  set = await f.search(); assert.ok(set.options.every(o => !o.complete && !o.labels.length));
  assert.ok(set.options.every(o => o.unknowns.includes('Supplier test inventory')));
});

test('ticket-group locks preserve every connecting service; replacement never splices a fare', async t => {
  const f = fixture(t); f.state.connecting = true; const set = await f.search(); await f.select(set);
  const legId = f.w.draft.selected.journey.legs[0].id;
  await f.turn('Keep this flight', { op: 'lock_leg', legId }); assert.equal(f.w.draft.locks.length, 2);
  await assert.rejects(f.turn('Replace', { op: 'replace_leg', legId, replacementMode: 'flight' }), /Unlock the whole ticket/);
  await f.turn('Search again', { op: 'search_options' }); await f.finish();
  assert.equal(f.w.sets.find(s => s.id === f.w.draft.activeSetId).options.length, 1);
  await f.turn('Find a later trip'); await f.finish(); assert.equal(f.w.sets.find(s => s.id === f.w.draft.activeSetId).options.length, 0);
  await f.turn('Unlock kept group', { op: 'lock_leg', legId, locked: false }); assert.equal(f.w.draft.locks.length, 0);
  await f.turn('Undo that'); assert.equal(f.w.draft.locks.length, 2);
  await f.turn('Undo that'); // Undo collecting the excluded set.
  await f.turn('Undo that'); // Undo changing the departure.
  await f.turn('Unlock group', { op: 'lock_leg', legId, locked: false });
  await f.select(set);
  await assert.rejects(f.turn('Replace flight with train', { op: 'replace_leg', legId, replacementMode: 'train' }), /authorized rail or bus/);
});

test('scenarios keep current flight selection and restore their own pending search', async t => {
  const f = fixture(t), set = await f.search(); await f.select(set);
  const selected = f.w.draft.selected.optionId, active = f.w.draft.activeShoppingId;
  await f.turn('What if I leave later?'); assert.equal(f.w.draft.selected.optionId, selected); assert.equal(f.w.draft.activeShoppingId, active);
  const scenario = f.w.scenarios[0]; await f.turn('Restore scenario', { op: 'restore_scenario', scenarioId: scenario.id });
  assert.notEqual(f.w.draft.activeShoppingId, active); await f.finish(); assert.equal(f.w.sets.find(s => s.id === f.w.draft.activeSetId).options.length, 3);
});

test('stale reviews cannot save after a baggage edit, including through direct shopping endpoints', async t => {
  const f = fixture(t), set = await f.search(); await f.select(set); await f.turn('Save this trip');
  const review = f.w.messages.at(-1).flightReview;
  await f.turn('two checked bags');
  await assert.rejects(confirmComparison(f.store, f.user.id, review.id, f.travel), /Select this offer|draft changed/);
  await assert.rejects(reviewOffer(f.store, f.user.id, set.searchId, set.options[0].flight.id, f.travel), /Select this offer/);
  assert.equal(f.store.list(f.user.id, 'travel-comparison').length, 0);
});

test('draft changes during supplier confirmation fail the second version check', async t => {
  const f = fixture(t), set = await f.search(); await f.select(set); await f.turn('Save this trip');
  const review = f.w.messages.at(-1).flightReview;
  let release; f.state.refresh = args => new Promise(resolve => { release = () => resolve({ offer: args.offer }); });
  const confirmation = confirmComparison(f.store, f.user.id, review.id, f.travel);
  await f.turn('Find a later trip'); release();
  await assert.rejects(confirmation, /Select this offer|draft changed/); assert.equal(f.store.list(f.user.id, 'travel-comparison').length, 0);
});

test('changed locked service is rejected on review; changed price must be reviewed again', async t => {
  const f = fixture(t), set = await f.search(); await f.select(set);
  await f.turn('Keep flight', { op: 'lock_leg', legId: f.w.draft.selected.journey.legs[0].id });
  f.state.refresh = async args => { const o = structuredClone(args.offer); o.services[0].serviceNumber = '999'; return { offer: o }; };
  await assert.rejects(f.turn('Save this trip'), /locked ticket group/);
  f.state.refresh = null; await f.turn('Save this trip'); const review = f.w.messages.at(-1).flightReview;
  f.state.refresh = async args => { const o = structuredClone(args.offer); o.components[0].money.amount += 100; return { offer: o }; };
  await assert.rejects(confirmComparison(f.store, f.user.id, review.id, f.travel), /price or connection changed|offer changed/);
});

test('foreign references, stale selections and expired supplier fares cannot be loaded or saved', async t => {
  const f = fixture(t), set = await f.search();
  const foreign = createConversation(f.store, f.user.id);
  await assert.rejects(runWorkspaceTurn(f.store, f.user.id, foreign.conversation.id, { clientTurnId: randomUUID(), expectedVersion: 1, input: 'Load', command: { op: 'collect_options', searchId: set.searchId } }, f.travel), /different conversation/);
  await assert.rejects(reviewOffer(f.store, f.other.id, set.searchId, set.options[0].flight.id, f.travel), /not found/i);
  await f.turn('Find a later trip'); await assert.rejects(f.select(set), /different trip requirements/);
  await f.turn('Undo that');
  const record = f.store.get(f.user.id, set.id, 'candidate-set'); record.options[0].flight.expiresAt = new Date(Date.now() - 1).toISOString();
  f.store.put(f.user.id, 'candidate-set', record, { id: record.id, expectedVersion: record.version });
  await assert.rejects(f.select(record), /expired/);
});

test('cancel and superseded searches ignore late job results; request retries do not enqueue twice', async t => {
  const f = fixture(t), id = randomUUID(), version = f.w.draft.version;
  await f.turn('Search', { op: 'search_options', patch: initial }, { clientTurnId: id, expectedVersion: version });
  const searchId = f.w.draft.activeShoppingId;
  await f.turn('Search', { op: 'search_options', patch: initial }, { clientTurnId: id, expectedVersion: version });
  assert.equal(f.store.list(f.user.id, 'shopping-search').length, 1);
  await f.turn('Find a later trip'); assert.equal(f.store.get(f.user.id, searchId, 'shopping-search').state, 'cancelled');
  await runShoppingQuery(f.store, f.travel, { userId: f.user.id, searchId, index: 0 }); assert.equal(f.state.calls.length, 0);
  await f.turn('Cancel search'); assert.equal(f.w.shoppingSearches.find(s => s.id === f.w.draft.activeShoppingId).state, 'cancelled');
});

test('flight passenger constraints preserve children and reject ambiguous airports and unsupported bags', async t => {
  const f = fixture(t), c = normalizeFlightConstraints({ ...f.w.draft.constraints, ...initial }, initial);
  assert.throws(() => flightRequest({ ...c, from: 'New York' }), /exact departure/);
  assert.throws(() => normalizeFlightConstraints({ ...c, travelers: 2, passengers: [{ ...passenger, type: 'child', age: 8 }] }, { travelers: 2 }), /child/);
  assert.throws(() => flightRequest({ ...c, passengers: [{ ...passenger, checked: 4 }] }));
  const command = interpretRules('two travelers with one cabin bag each', { constraints: c }); assert.equal(command.patch.passengers.length, 2);
  assert.throws(() => interpretRules('two travelers with one cabin bag', { constraints: c }), /per traveler/);
});

test('flight questions stay grounded in selected offer and never use transit fare or status assumptions', async t => {
  const f = fixture(t), set = await f.search(); await f.select(set);
  await f.turn('What is included in this fare?');
  assert.match(f.w.messages.at(-1).reply, /airport-to-airport/);
  assert.deepEqual(f.w.messages.at(-1).comparison, [{ setId: set.id, optionId: set.options[0].id }]);
  const before = f.w.draft.version; await f.turn('What gate do I use?');
  assert.match(f.w.messages.at(-1).reply, /licensed status provider/); assert.equal(f.w.draft.version, before);
  await f.turn('My flight is delayed');
  assert.equal(f.w.messages.at(-1).protectedPanel,'prepare_recovery');assert.match(f.w.messages.at(-1).reply,/licensed status/);assert.equal(f.w.draft.version,before);
  assert.ok(f.state.calls.every(c => ['flight_search', 'flight_refresh'].includes(c)));
});

test('cross-midnight flight windows query both origin-local dates', async t => {
  const f = fixture(t);
  const firstDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const lastDate = new Date(Date.parse(firstDate + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
  const c = normalizeFlightConstraints({ ...f.w.draft.constraints, ...initial, departure: firstDate + 'T22:00:00Z', flightWindowHours: 10 }, initial);
  const request = flightRequest(c);
  assert.deepEqual(request.flexibleDates, [lastDate]);
  await f.turn('Search flights', { op: 'search_options', patch: { ...initial, departure: c.departure, flightWindowHours: 10 } });
  assert.deepEqual(f.w.shoppingSearches[0].queries.map(q => q.date), [firstDate, lastDate]);
  await runShoppingQuery(f.store, f.travel, { userId: f.user.id, searchId: f.w.draft.activeShoppingId, index: 0 });
  await assert.rejects(f.turn('Load offers', { op: 'collect_options' }), /Wait for this search/);
  await f.finish(); assert.equal(f.w.shoppingSearches[0].state, 'complete');
});

test('a single flight message retains personal, cabin and checked bags for the whole party', async t => {
  const f = fixture(t);
  await f.turn('Find flights from BOS to JFK tomorrow at 9 am under $500 with two travelers and one personal item, one cabin bag and two checked bags each');
  assert.equal(f.w.draft.constraints.travelers, 2);
  for (const passenger of f.w.draft.constraints.passengers) assert.deepEqual([passenger.personal, passenger.cabin, passenger.checked], [1, 1, 2]);
  assert.equal(f.w.draft.constraints.bags, 6);
});
