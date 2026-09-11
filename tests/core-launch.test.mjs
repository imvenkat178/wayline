import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { Store } from "../server/store.mjs";
import {
  searchTrips,
  createAction,
  confirmAction,
  saveTrip,
} from "../server/domain/tripActions.mjs";
import { preferences, sampleSearch } from "../server/domain/journeys.mjs";
import {
  alertAffectsJourney,
  refreshActiveJourneys,
  prepareRecovery,
  scheduleLiveRefresh,
} from "../server/recovery.mjs";
import { createBackup, decodeBackup, restoreBackup } from "../server/backups.mjs";
import { createToolRunner, parseDeparture } from "../server/domain/agentTools.mjs";
import { runAgentGraph } from "../server/domain/agentGraph.mjs";
import { TravelClient } from "../server/travel/client.mjs";
import { itineraryPdf } from "../server/itineraryPdf.mjs";
import { createApplication } from "../server/server.mjs";
import { ensureRecurringJob, claimDueJobs } from "../server/jobs.mjs";
const root = resolve("tmp");
mkdirSync(root, { recursive: true });
function fixture(t) {
  const directory = mkdtempSync(join(root, "core-test-"));
  const store = new Store({ directory, production: false });
  t.after(() => {
    store.close();
    assert.ok(resolve(directory).startsWith(root));
    rmSync(directory, { recursive: true, force: true });
  });
  const user = store.createGuest(),
    other = store.createGuest();
  const input = {
    from: "bos",
    to: "nyc",
    departure: new Date(Date.now() + 86400000).toISOString(),
    travelers: 1,
    bags: 0,
    mode: "sample",
    preferences: preferences({}),
  };
  return { store, user, other, input, directory };
}
async function saved(f) {
  const s = await searchTrips(f.store, f.user.id, f.input);
  return {
    search: s,
    journey: saveTrip(
      f.store,
      f.user.id,
      { searchId: s.searchId, journeyId: s.journeys[0].id },
      "first",
    ),
  };
}
test("review has no mutation; double confirmation creates one journey and owner isolation holds", async (t) => {
  const f = fixture(t),
    s = await searchTrips(f.store, f.user.id, f.input);
  const action = createAction(f.store, f.user.id, {
    kind: "add",
    searchId: s.searchId,
    candidateId: s.journeys[0].id,
  });
  assert.equal(f.store.list(f.user.id, "journey").length, 0);
  await assert.rejects(confirmAction(f.store, f.other.id, action.id));
  const a = await confirmAction(f.store, f.user.id, action.id),
    b = await confirmAction(f.store, f.user.id, action.id);
  assert.equal(a.journey.id, b.journey.id);
  assert.equal(f.store.list(f.user.id, "journey").length, 1);
});
test("expired and conflicting reviews cannot mutate a journey", async (t) => {
  const f = fixture(t),
    { journey: j } = await saved(f);
  let a = createAction(f.store, f.user.id, { kind: "cancel", journeyId: j.id });
  f.store.put(
    f.user.id,
    "journey",
    { ...j, name: "Updated by another tab" },
    { id: j.id, expectedVersion: j.version },
  );
  await assert.rejects(
    confirmAction(f.store, f.user.id, a.id),
    (e) => e.code === "VERSION_CONFLICT",
  );
  a = createAction(f.store, f.user.id, { kind: "cancel", journeyId: j.id });
  f.store.put(
    f.user.id,
    "pending-action",
    { ...a, expiresAt: Date.now() - 1 },
    { id: a.id, expectedVersion: a.version },
  );
  await assert.rejects(confirmAction(f.store, f.user.id, a.id), (e) => e.code === "ACTION_EXPIRED");
  assert.equal(f.store.get(f.user.id, j.id).state, "PLANNED");
});
test("change retains identity, revisions and events; cancel retains the record", async (t) => {
  const f = fixture(t),
    { journey: j } = await saved(f);
  const s = await searchTrips(f.store, f.user.id, {
    ...f.input,
    departure: new Date(Date.now() + 2 * 86400000).toISOString(),
  });
  const a = createAction(f.store, f.user.id, {
    kind: "change",
    journeyId: j.id,
    searchId: s.searchId,
    candidateId: s.journeys[0].id,
  });
  const changed = (await confirmAction(f.store, f.user.id, a.id)).journey;
  assert.equal(changed.id, j.id);
  assert.equal(changed.revisions.length, 1);
  assert.equal(changed.events.at(-1).type, "ITINERARY_CHANGED");
  const cancel = createAction(f.store, f.user.id, { kind: "cancel", journeyId: j.id });
  const cancelled = await confirmAction(f.store, f.user.id, cancel.id);
  assert.equal(cancelled.journey.state, "CANCELLED");
  assert.equal(f.store.list(f.user.id, "journey").length, 1);
});
test("provider outage prevents confirmation instead of using a sample", async (t) => {
  const f = fixture(t),
    r = sampleSearch(f.input);
  r.journeys = r.journeys.map((j) => ({ ...j, dataMode: "provider" }));
  const travel = { call: async () => ({ ...r, cache: "fresh" }) };
  const s = await searchTrips(f.store, f.user.id, { ...f.input, mode: "provider" }, travel);
  const a = createAction(f.store, f.user.id, {
    kind: "add",
    searchId: s.searchId,
    candidateId: s.journeys[0].id,
  });
  await assert.rejects(
    confirmAction(f.store, f.user.id, a.id, {
      call: async () => {
        throw Error("provider down");
      },
    }),
  );
  assert.equal(f.store.list(f.user.id, "journey").length, 0);
  await assert.rejects(searchTrips(f.store, f.user.id, { ...f.input, mode: "unknown" }, travel));
});
test("model tool choice is validated, tool arguments do not execute commands, and deterministic controls survive model failure", async (t) => {
  const f = fixture(t);
  const runner = createToolRunner({ store: f.store, userId: f.user.id, travel: {}, context: {} });
  const result = await runAgentGraph({
    input: "List my trips",
    preferences: preferences({}),
    provider: { available: false },
    toolRunner: runner,
  });
  assert.equal(result.results[0].type, "journeys");
  const invalid = await runner({
    input: "Something ambiguous",
    provider: { available: true, chat: async () => '{"intent":"shell","command":"erase files"}' },
  });
  assert.equal(invalid, null);
  const client = new TravelClient();
  await assert.rejects(client.call("constructor"));
  await assert.rejects(
    client.call("search", { from: { url: "https://evil.invalid" }, to: "Harvard" }),
  );
  await client.close();
});
test("Boston natural language times use the journey timezone and ambiguity is explicit", () => {
  const now = Date.parse("2026-09-11T12:00:00Z");
  assert.equal(
    parseDeparture("tomorrow at 9 am", { now, relativeDay: 1 }).departure,
    "2026-09-12T13:00:00.000Z",
  );
  assert.equal(parseDeparture("at 17:30", { now }).departure, "2026-09-11T21:30:00.000Z");
  assert.ok(parseDeparture("at 9", { now }).error);
  assert.ok(parseDeparture("at 25:30", { now }).error);
});
function liveJourney(f) {
  const j = sampleSearch(f.input).journeys[0];
  return {
    ...j,
    dataMode: "provider",
    state: "PLANNED",
    departure: new Date(Date.now() + 3600000).toISOString(),
    arrival: new Date(Date.now() + 7200000).toISOString(),
    legs: j.legs.map((l) => ({
      ...l,
      departure: new Date(Date.now() + 3600000).toISOString(),
      arrival: new Date(Date.now() + 7200000).toISOString(),
      agency: "mbta",
      routeId: "Red",
      tripId: "test-trip",
      fromStopId: "70080",
      toStopId: "70068",
      directionId: "0",
      serviceDate: "2026-09-11",
    })),
  };
}
test("disruption matching requires applicable entities, direction, date and time", (t) => {
  const f = fixture(t),
    j = liveJourney(f),
    alert = {
      activePeriods: [{ start: j.departure, end: j.arrival }],
      informed: [{ route: "Red", direction_id: 0, service_date: "2026-09-11" }],
    };
  assert.equal(alertAffectsJourney(alert, j), true);
  for (const entity of [
    { route: "Green" },
    { route: "Red", direction_id: 1 },
    { route: "Red", service_date: "2026-09-12" },
    { agency: "other", route: "Red" },
    {},
  ])
    assert.equal(alertAffectsJourney({ ...alert, informed: [entity] }, j), false);
  assert.equal(
    alertAffectsJourney({ ...alert, activePeriods: [{ end: "2000-01-01T00:00:00Z" }] }, j),
    false,
  );
});
test("missing GPS never cancels a journey and durable refresh scheduling deduplicates", async (t) => {
  const f = fixture(t),
    j = f.store.put(f.user.id, "journey", liveJourney(f));
  const travel = {
    call: async (name) => ({
      cache: "fresh",
      fetchedAt: new Date().toISOString(),
      vehicles: [],
      alerts: [],
      predictions: [],
    }),
  };
  await refreshActiveJourneys(f.store, travel);
  const updated = f.store.get(f.user.id, j.id);
  assert.equal(updated.state, "PLANNED");
  assert.equal(
    updated.legs.some((l) => l.cancelled),
    false,
  );
  scheduleLiveRefresh(f.store);
  scheduleLiveRefresh(f.store);
  assert.equal(
    f.store.db.prepare("SELECT count(*) n FROM jobs WHERE kind='journey-refresh'").get().n,
    1,
  );
});
test("automatic alternatives are feasible, deduplicated, and never authorize spending", async (t) => {
  const f = fixture(t),
    { journey: j } = await saved(f);
  const a = await prepareRecovery(f.store, f.user.id, j, null, { automatic: true });
  assert.ok(a.length > 0 && a.length <= 3);
  assert.ok(
    a.every(
      (x) => !x.booked && !x.authorizedSpend && Date.parse(x.alternative.departure) > Date.now(),
    ),
  );
  await prepareRecovery(f.store, f.user.id, j, null, { automatic: true });
  assert.equal(f.store.list(f.user.id, "alert").filter((x) => x.kind === "recovery").length, 1);
  assert.equal(f.store.get(f.user.id, j.id).version, j.version);
});
test("encrypted backups restore records and key material, revoke sessions and pending actions, and reject tampering", async (t) => {
  const f = fixture(t),
    { journey: j } = await saved(f);
  createAction(f.store, f.user.id, { kind: "cancel", journeyId: j.id });
  f.store.session(f.user.id);
  ensureRecurringJob(f.store, "guardian-sweep", {}, 30000);
  claimDueJobs(f.store);
  const file = createBackup(f.store);
  const key = join(f.directory, ".backup-recovery-key");
  assert.ok(!readFileSync(file).includes(Buffer.from(j.from)));
  assert.equal(decodeBackup(file, key).encryptionKey, f.store.key.toString("hex"));
  const target = join(f.directory, "restored");
  const out = restoreBackup({ file, keyFile: key, directory: target });
  assert.equal(out.sessionsRevoked, true);
  const restored = new Store({ directory: target, production: false });
  try {
    assert.equal(restored.get(f.user.id, j.id).from, j.from);
    assert.equal(restored.list(f.user.id, "pending-action").length, 0);
    assert.equal(restored.db.prepare("SELECT count(*) n FROM sessions").get().n, 0);
    assert.equal(
      restored.db.prepare("SELECT count(*) n FROM jobs WHERE status='leased'").get().n,
      0,
    );
  } finally {
    restored.close();
  }
  const broken = join(f.directory, "corrupt.wlbackup");
  const bytes = readFileSync(file);
  bytes[40] ^= 1;
  writeFileSync(broken, bytes);
  assert.throws(() => restoreBackup({ file: broken, keyFile: key, directory: target }));
  assert.ok(existsSync(out.restored));
});
test("restore refuses a running server and privacy deletion purges every retained snapshot", async (t) => {
  const f = fixture(t);
  await saved(f);
  const file = createBackup(f.store),
    keyFile = join(f.directory, ".backup-recovery-key");
  writeFileSync(join(f.directory, ".server-pid"), String(process.pid));
  assert.throws(() => restoreBackup({ file, keyFile, directory: f.directory }), /Stop/);
  f.store.backupsEnabled = true;
  f.store.deleteHistory(f.user.id);
  assert.ok(!existsSync(file));
  const files = readdirSync(join(f.directory, "backups"));
  assert.equal(files.length, 1);
  const data = decodeBackup(join(f.directory, "backups", files[0]), keyFile);
  assert.equal(data.reason, "privacy");
});
test("backup retention keeps 24 recent hourly snapshots and seven daily recovery points", (t) => {
  const f = fixture(t);
  for (let day = 7; day >= 1; day--) createBackup(f.store, { now: Date.now() - day * 86400000 });
  for (let hour = 26; hour >= 0; hour--)
    createBackup(f.store, { now: Date.now() - hour * 3600000 });
  const files = readdirSync(join(f.directory, "backups"));
  assert.ok(files.length >= 24 && files.length <= 31);
  assert.equal(new Set(files.map((x) => x.slice(8, 18))).size, 7);
});
test("complete itinerary PDF generation uses a real PDF document", async (t) => {
  const f = fixture(t),
    { journey: j } = await saved(f);
  const pdf = await itineraryPdf(j, [
    {
      operator: "Imported operator",
      service: "Imported service",
      passenger: "Test traveler",
      confirmation: "IMPORTED-REFERENCE",
      source: "User import",
    },
  ]);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 10000);
});
test("HTTP review/confirm flow enforces CSRF and cross-account isolation", async (t) => {
  const f = fixture(t);
  const travel = { close: async () => {} };
  const app = createApplication({ store: f.store, travel, quiet: true });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  try {
    const base = "http://127.0.0.1:" + app.server.address().port;
    const bootstrap = await fetch(base + "/api/bootstrap"),
      boot = await bootstrap.json(),
      cookie = bootstrap.headers.get("set-cookie").split(";")[0];
    const post = async (path, data, csrf = boot.csrf) => {
      const r = await fetch(base + "/api" + path, {
        method: "POST",
        headers: { cookie, "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify(data),
      });
      return { status: r.status, data: await r.json() };
    };
    const search = await post("/search", f.input);
    assert.equal(search.status, 200);
    const a = await post("/agent/actions", {
      kind: "add",
      searchId: search.data.searchId,
      candidateId: search.data.journeys[0].id,
    });
    assert.equal(a.status, 201);
    assert.equal(
      (await post("/agent/actions/" + a.data.id + "/confirm", {}, "invalid")).status,
      403,
    );
    const ok = await post("/agent/actions/" + a.data.id + "/confirm", {});
    assert.equal(ok.status, 200);
    assert.equal(
      (await post("/agent/actions/" + a.data.id + "/confirm", {})).data.journey.id,
      ok.data.journey.id,
    );
    const otherBoot = await fetch(base + "/api/bootstrap"),
      ob = await otherBoot.json();
    const attack = await fetch(base + "/api/journeys/" + ok.data.journey.id + "/itinerary.pdf", {
      headers: { cookie: otherBoot.headers.get("set-cookie").split(";")[0] },
    });
    assert.equal(attack.status, 404);
  } finally {
    await new Promise((r) => app.server.close(r));
    await app.stopBackgroundJobs();
  }
});

test("a model cannot embellish an endpoint or invent a departure time", async (t) => {
  const f = fixture(t);
  let observed;
  const runner = createToolRunner({
    store: f.store,
    userId: f.user.id,
    travel: {
      call: async (name, args) => {
        observed = args;
        return {
          journeys: [],
          excluded: [],
          dataMode: "provider",
          source: "test",
          fetchedAt: new Date().toISOString(),
        };
      },
    },
    context: {},
  });
  await runner({
    input: "I need to reach Harvard starting in South Station tomorrow",
    provider: {
      available: true,
      chat: async () =>
        JSON.stringify({
          intent: "search",
          from: "South Station",
          to: "Harvard University",
          departure: "tomorrow",
        }),
    },
  });
  assert.equal(observed.from, "South Station");
  assert.equal(observed.to, "Harvard");
  assert.ok(Number.isFinite(Date.parse(observed.departure)));
});
test("confirmed live disruption prepares alternatives but leaves the saved route untouched", async (t) => {
  const f = fixture(t),
    j = f.store.put(f.user.id, "journey", liveJourney(f));
  f.store.updateUser(f.user.id, { preferences: preferences({ autoRecovery: true }) });
  let searches = 0;
  const travel = {
    call: async (name, args) => {
      if (name === "search") {
        searches++;
        return {
          ...sampleSearch({ ...f.input, ...args, mode: "sample" }),
          dataMode: "provider",
          cache: "fresh",
          fetchedAt: new Date().toISOString(),
        };
      }
      return {
        cache: "fresh",
        fetchedAt: new Date().toISOString(),
        vehicles: [],
        predictions: [],
        alerts: [
          {
            id: "confirmed-outage",
            header: "Service suspended",
            description: "A simulated provider disruption for verification",
            effect: "NO_SERVICE",
            updatedAt: new Date().toISOString(),
            activePeriods: [{ start: j.departure, end: j.arrival }],
            informed: [{ route: "Red" }],
          },
        ],
      };
    },
  };
  await refreshActiveJourneys(f.store, travel);
  assert.equal(searches, 1);
  assert.ok(f.store.list(f.user.id, "recovery").length > 0);
  const after = f.store.get(f.user.id, j.id);
  assert.equal(after.state, "PLANNED");
  assert.equal(after.departure, j.departure);
  assert.ok(f.store.list(f.user.id, "recovery").every((r) => r.authorizedSpend === false));
  await refreshActiveJourneys(f.store, travel);
  assert.equal(searches, 1);
});
test("failed provider reads are explicitly unavailable and expired workers cannot commit", async (t) => {
  const f = fixture(t),
    j = f.store.put(f.user.id, "journey", liveJourney(f)),
    travel = {
      call: async () => {
        throw Error("Outage");
      },
    };
  await refreshActiveJourneys(f.store, travel, { canCommit: () => false });
  assert.equal(f.store.get(f.user.id, j.id).version, j.version);
  await refreshActiveJourneys(f.store, travel);
  assert.equal(f.store.get(f.user.id, j.id).liveSources.disruptions, "unavailable");
  assert.equal(f.store.get(f.user.id, j.id).state, "PLANNED");
});

test("live observations preserve the itinerary version and do not invalidate a pending review", async (t) => {
  const f = fixture(t),
    j = f.store.put(f.user.id, "journey", liveJourney(f));
  const a = createAction(f.store, f.user.id, { kind: "cancel", journeyId: j.id });
  await refreshActiveJourneys(f.store, {
    call: async () => ({
      cache: "fresh",
      fetchedAt: new Date().toISOString(),
      vehicles: [],
      alerts: [],
      predictions: [],
    }),
  });
  assert.equal(f.store.get(f.user.id, j.id).version, j.version);
  assert.ok(f.store.get(f.user.id, j.id).liveUpdatedAt);
  assert.equal((await confirmAction(f.store, f.user.id, a.id)).journey.state, "CANCELLED");
  f.store.deleteHistory(f.user.id);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM journey_observations").get().n, 0);
});

test("restore replaces an existing database and key as a set, preserving the old set", async (t) => {
  const f = fixture(t),
    { journey } = await saved(f);
  const file = createBackup(f.store);
  const target = join(f.directory, "existing");
  const old = new Store({ directory: target, production: false });
  const oldUser = old.createGuest();
  const oldKey = readFileSync(join(target, ".encryption-key"), "utf8");
  old.close();
  const result = restoreBackup({
    file,
    keyFile: join(f.directory, ".backup-recovery-key"),
    directory: target,
  });
  assert.ok(existsSync(result.preserved));
  assert.equal(
    readFileSync(
      join(target, ".encryption-key") + result.preserved.slice(result.restored.length),
      "utf8",
    ),
    oldKey,
  );
  const restored = new Store({ directory: target, production: false });
  try {
    assert.equal(restored.get(f.user.id, journey.id).id, journey.id);
    assert.equal(restored.user(oldUser.id), null);
  } finally {
    restored.close();
  }
  assert.equal(existsSync(join(target, ".restore-lock")), false);
  writeFileSync(join(target, ".restore-lock"), "operator");
  assert.throws(() => new Store({ directory: target, production: false }), /restor/i);
});

test("a private changed itinerary keeps protection through its revised arrival", async (t) => {
  const f = fixture(t),
    s = await searchTrips(f.store, f.user.id, f.input);
  const j = saveTrip(
    f.store,
    f.user.id,
    { searchId: s.searchId, journeyId: s.journeys[0].id, private: true },
    "private",
  );
  const next = await searchTrips(f.store, f.user.id, {
    ...f.input,
    departure: new Date(Date.now() + 5 * 86400000).toISOString(),
  });
  const action = createAction(f.store, f.user.id, {
    kind: "change",
    journeyId: j.id,
    searchId: next.searchId,
    candidateId: next.journeys[0].id,
  });
  const changed = (await confirmAction(f.store, f.user.id, action.id)).journey;
  assert.equal(changed.privateTrip, true);
  const row = f.store.db.prepare("SELECT expires_at FROM records WHERE id=?").get(j.id);
  assert.equal(row.expires_at, Date.parse(changed.arrival) + 86400000);
});

test("private stdio MCP reconnects after a real transport shutdown with bounded restarts", async (t) => {
  const client = new TravelClient();
  t.after(() => client.close());
  for (let n = 0; n < 3; n++) {
    const health = await client.call("health");
    assert.ok(Array.isArray(health.services));
    await client.transport.close();
  }
  await assert.rejects(client.call("health"), (e) => e.code === "MCP_UNAVAILABLE");
});


test("an alert must overlap the affected leg, not a later unrelated connection", (t) => {
  const f = fixture(t), j = liveJourney(f);
  const start = Date.now() + 3600000;
  j.departure = new Date(start).toISOString();
  j.arrival = new Date(start + 7200000).toISOString();
  j.legs = [
    { ...j.legs[0], departure: j.departure, arrival: new Date(start + 1800000).toISOString() },
    { ...j.legs[0], routeId: "Green", departure: new Date(start + 3600000).toISOString(), arrival: j.arrival },
  ];
  const alert = { informed: [{ route: "Red" }], activePeriods: [{ start: j.legs[1].departure, end: j.arrival }] };
  assert.equal(alertAffectsJourney(alert, j), false);
  j.legs[0].predictedDeparture = j.legs[1].departure;
  j.legs[0].predictedArrival = j.arrival;
  assert.equal(alertAffectsJourney(alert, j), true);
  assert.equal(alertAffectsJourney({ ...alert, activePeriods: [{ end: j.departure }] }, j), false);
});

function recoveryFixture(f) {
  const original = liveJourney(f);
  const serviceDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  original.legs = [{ ...original.legs[0], routeId: "Green", tripId: "cancelled-trip", serviceDate,
    cancelled: true, predictionStatus: "available", predictionObservedAt: new Date().toISOString() }];
  const j = f.store.put(f.user.id, "journey", original);
  const departure = new Date(Date.now() + 2 * 3600000).toISOString();
  const arrival = new Date(Date.now() + 3 * 3600000).toISOString();
  const candidate = { ...original, id: "candidate", departure, arrival,
    legs: [{ ...original.legs[0], tripId: "safe-trip", routeId: "Blue", departure, arrival, cancelled: false }] };
  return { j, candidate, closure: { id: "closure", effect: "NO_SERVICE", informed: [{ route: "Red" }],
    activePeriods: [{ start: j.departure, end: candidate.arrival }] } };
}

test("prepared alternatives exclude suspended service and a recently cancelled trip", async (t) => {
  const f = fixture(t), { j, candidate, closure } = recoveryFixture(f);
  const blocked = { ...candidate, id: "blocked", legs: [{ ...candidate.legs[0], routeId: "Red" }] };
  const cancelled = { ...candidate, id: "cancelled", legs: [{ ...candidate.legs[0], routeId: "Green", tripId: "cancelled-trip" }] };
  const travel = { call: async (name) => ({ cache: "fresh", fetchedAt: new Date().toISOString(),
    ...(name === "search" ? { journeys: [blocked, cancelled, candidate], dataMode: "provider" } : { alerts: [closure] }) }) };
  const items = await prepareRecovery(f.store, f.user.id, j, travel, { automatic: true });
  assert.deepEqual(items.map((r) => r.alternative.id), [candidate.id]);
  assert.equal(f.store.get(f.user.id, j.id).legs[0].tripId, "cancelled-trip");
});

test("confirmation rejects a closure or cancelled departure introduced after review, then applies once when clear", async (t) => {
  const f = fixture(t), { j, candidate, closure } = recoveryFixture(f);
  let mode = "clear";
  const travel = { call: async (name) => ({ cache: mode === "stale" ? "stale" : "fresh", fetchedAt: new Date().toISOString(),
    ...(name === "search" ? { journeys: [candidate], dataMode: "provider" } : name === "predictions" ? {
      predictions: mode === "cancelled" ? [{ tripId: candidate.legs[0].tripId, stopId: candidate.legs[0].fromStopId, cancelled: true }] : [],
    } : { alerts: mode === "closure" ? [{ ...closure, informed: [{ route: "Blue" }] }] : [] }) }) };
  const s = await searchTrips(f.store, f.user.id, { ...f.input, mode: "provider" }, travel);
  const a = createAction(f.store, f.user.id, { kind: "recovery", journeyId: j.id, searchId: s.searchId, candidateId: candidate.id });
  for (const state of ["closure", "stale", "cancelled"]) {
    mode = state;
    await assert.rejects(confirmAction(f.store, f.user.id, a.id, travel), (e) =>
      state === "stale" ? e.code === "DISRUPTIONS_UNAVAILABLE" || e.code === "ROUTE_CHANGED" : e.code === "ROUTE_DISRUPTED");
    assert.equal(f.store.get(f.user.id, j.id).version, j.version);
    assert.equal(f.store.get(f.user.id, a.id).status, "pending");
  }
  mode = "clear";
  const applied = await confirmAction(f.store, f.user.id, a.id, travel);
  const repeated = await confirmAction(f.store, f.user.id, a.id, travel);
  assert.equal(applied.journey.id, j.id);
  assert.equal(applied.journey.version, repeated.journey.version);
  assert.equal(applied.journey.legs[0].tripId, "safe-trip");
});

test("stale disruption feeds never produce supposedly feasible recovery routes", async (t) => {
  const f = fixture(t), { j, candidate } = recoveryFixture(f);
  const travel = { call: async (name) => ({ fetchedAt: new Date().toISOString(), cache: name === "search" ? "fresh" : "stale",
    journeys: [candidate], alerts: [] }) };
  await assert.rejects(prepareRecovery(f.store, f.user.id, j, travel), (e) => e.code === "DISRUPTIONS_UNAVAILABLE");
  assert.equal(f.store.list(f.user.id, "recovery").length, 0);
});
