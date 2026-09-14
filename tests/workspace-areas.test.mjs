import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { createApplication } from "../server/server.mjs";
import { nextCommuteDeparture } from "../server/domain/commutes.mjs";

const stations = [
  { id: "place-sstat", name: "South Station", lat: 42.352, lon: -71.055, timezone: "America/New_York" },
  { id: "place-harsq", name: "Harvard", lat: 42.374, lon: -71.119, timezone: "America/New_York" },
];
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "wayline-areas-"));
  const store = new Store({ directory, production: false });
  const travel = { calls: [], offline: false, async close() {}, async call(name, args) {
    this.calls.push(name);
    if (this.offline) throw new Error("Provider unavailable");
    if (name !== "places") throw new Error("Unexpected tool");
    return { places: stations.filter(p => p.id === args.q || p.name === args.q), source: "MBTA fixture", fetchedAt: new Date().toISOString(), cache: "fresh" };
  } };
  const app = createApplication({ store, travel, production: false, quiet: true });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const session = async () => {
    const r = await fetch(base + "/api/bootstrap"), boot = await r.json();
    return { userId: boot.user.id, cookie: r.headers.get("set-cookie").split(";")[0], csrf: boot.csrf };
  };
  const owner = await session(), other = await session();
  const request = async (path, method = "GET", data, user = owner) => {
    const r = await fetch(base + "/api" + path, { method,
      headers: { cookie: user.cookie, "x-csrf-token": user.csrf, "content-type": "application/json" },
      ...(method === "GET" ? {} : { body: JSON.stringify(data ?? {}) }) });
    return { status: r.status, data: await r.json() };
  };
  t.after(async () => { app.stopBackgroundJobs(); await new Promise(resolve => app.server.close(resolve)); store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { store, owner, other, request, travel };
}
const route = { name: "Office", mode: "provider", from: stations[0].id, to: stations[1].id };

test("live shortcuts persist canonical stations; legacy routes stay sample; ambiguous endpoints fail", async t => {
  const f = await fixture(t);
  const a = await f.request("/records/favorite", "POST", { ...route, fromPlace: { ...stations[0], lat: 0 } });
  assert.equal(a.status, 201); assert.equal(a.data.fromPlace.lat, stations[0].lat);
  assert.equal((await f.request("/records/favorite", "POST", { name: "Legacy", from: "la", to: "sj" })).data.mode, "sample");
  assert.equal((await f.request("/records/favorite", "POST", { ...route, from: "unknown" })).status, 400);
  assert.equal((await f.request("/records/favorite", "POST", { ...route, to: route.from })).status, 400);
});
test("commutes can be edited and paused during provider outages; ownership and version guard writes", async t => {
  const f = await fixture(t);
  const created = await f.request("/records/commute", "POST", { ...route, days: [1,2,3,4,5], time: "08:00", timezone: "America/New_York" });
  assert.equal(created.status, 201);
  const c = created.data, path = `/records/commute/${c.id}`;
  const next = await f.request(`/commutes/${c.id}/next`);
  assert.equal(next.status, 200); assert.equal(next.data.fromPlace.name, "South Station");
  assert.equal(typeof next.data.preferences.budgetCents, "number");
  assert.equal(typeof next.data.preferences.maxWalkMinutes, "number");
  assert.equal(new Intl.DateTimeFormat("en", {timeZone:"America/New_York", hour:"2-digit", hourCycle:"h23"}).format(new Date(next.data.departure)), "08");
  f.travel.offline = true;
  const paused = await f.request(path, "PATCH", { version: c.version, enabled: false });
  assert.equal(paused.status, 200); assert.equal(paused.data.id, c.id);
  assert.equal((await f.request(`/commutes/${c.id}/next`)).status, 409);
  assert.equal((await f.request(path, "PATCH", { version: c.version, name: "Stale" })).status, 409);
  assert.equal((await f.request(path, "PATCH", { version: paused.data.version, name: "Foreign" }, f.other)).status, 404);
  assert.equal((await f.request(path, "GET")).data.name, "Office");
});
test("commute calendar respects weekdays, midnight, paused schedules and both DST transitions", () => {
  const c = { enabled: true, days: [1,2,3,4,5], time: "08:00", timezone: "America/New_York" };
  const next = (v, now) => nextCommuteDeparture({ ...c, ...v }, Date.parse(now));
  assert.equal(next({}, "2026-09-11T13:00:00Z"), "2026-09-14T12:00:00.000Z");
  assert.equal(next({ time: "00:10", days:[0] }, "2026-09-13T03:59:00Z"), "2026-09-13T04:10:00.000Z");
  assert.equal(next({ time: "02:30", days:[0] }, "2026-03-08T06:00:00Z"), "2026-03-15T06:30:00.000Z");
  assert.equal(next({ time: "01:30", days:[0] }, "2026-11-01T04:00:00Z"), "2026-11-01T05:30:00.000Z");
  assert.equal(next({ time: "01:30", days:[0] }, "2026-11-01T05:31:00Z"), "2026-11-08T06:30:00.000Z");
  assert.equal(next({ enabled:false }, "2026-09-11T11:00:00Z"), null);
});
test("bulk inbox reading is atomic, owner scoped and repeatable", async t => {
  const f = await fixture(t), a = f.store.put(f.owner.userId, "alert", { read: false, title: "Mine" }), b = f.store.put(f.other.userId, "alert", { read: false, title: "Other" });
  assert.equal((await f.request("/alerts/read", "POST", { ids: [a.id,b.id] })).status, 404);
  assert.equal(f.store.get(f.owner.userId,a.id).read, false);
  assert.equal((await f.request("/alerts/read", "POST", { ids: [a.id,a.id] })).status, 200);
  const version = f.store.get(f.owner.userId,a.id).version;
  await f.request("/alerts/read", "POST", { ids:[a.id] });
  assert.equal(f.store.get(f.owner.userId,a.id).version,version);
  assert.equal(f.store.get(f.other.userId,b.id).read,false);
});
test("ticket edits preserve documents and amount paid, reject foreign journey linkage and stale versions", async t => {
  const f = await fixture(t);
  const ticket = (await f.request("/records/ticket", "POST", { operator:"MBTA", service:"Red Line", passenger:"Test traveler", confirmation:"TEST-ONLY", departure:"2026-10-01T12:00:00Z", origin:"South Station", destination:"Harvard", document:{name:"test.png",type:"image/png",base64:Buffer.alloc(1_100_000).toString("base64")} })).data;
  const path = `/records/ticket/${ticket.id}`;
  const updated = await f.request(path,"PATCH",{version:ticket.version,seat:"A2",paidCents:250});
  assert.equal(updated.status,200); assert.equal(updated.data.document.base64,ticket.document.base64); assert.equal(updated.data.paidCents,250);
  const again = await f.request(path,"PATCH",{...updated.data,seat:"A3"});
  assert.equal(again.status,200); // full form with a large retained photo has the same body limit as creation
  const foreign = f.store.put(f.other.userId,"journey",{name:"Not mine"});
  assert.equal((await f.request(path,"PATCH",{version:again.data.version,journeyId:foreign.id})).status,404);
  assert.equal((await f.request(path,"PATCH",{version:ticket.version,seat:"B2"})).status,409);
  assert.equal((await f.request(path)).data.seat,"A3");
});
test("Boston station guides use measured place data and leave unverified facilities unknown", async t => {
  const f = await fixture(t), guide = await f.request("/stations/place-sstat");
  assert.equal(guide.status,200); assert.equal(guide.data.lat,stations[0].lat);
  assert.match(guide.data.source,/not verified/); assert.ok(guide.data.directions.length);
});
