import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { otpPlan } from "../server/travel/routing.mjs";
import { TravelClient } from "../server/travel/client.mjs";
import { Store } from "../server/store.mjs";
import { createApplication } from "../server/server.mjs";

const input = {
  from: { id: "place-sstat", name: "South Station", lat: 42.352271, lon: -71.055242 },
  to: { id: "place-harsq", name: "Harvard", lat: 42.373362, lon: -71.118956 },
  departure: "2026-09-13T13:00:00Z", travelers: 1, bags: 0,
};
const emptyPlan = { data: { planConnection: { edges: [] } } };
function configure(t, url = "http://127.0.0.1:8080/otp/gtfs/v1") {
  const previous = process.env.OTP_GRAPHQL_URL;
  process.env.OTP_GRAPHQL_URL = url;
  t.after(() => previous === undefined ? delete process.env.OTP_GRAPHQL_URL : process.env.OTP_GRAPHQL_URL = previous);
}

test("routing retries one dropped connection and returns provider results", async t => {
  configure(t);
  let attempts = 0;
  const mock = t.mock.method(globalThis, "fetch", async () => {
    if (++attempts === 1) throw new TypeError("fetch failed");
    return Response.json(emptyPlan);
  });
  const result = await otpPlan(input);
  assert.equal(mock.mock.callCount(), 2);
  assert.equal(result.dataMode, "provider");
  assert.deepEqual(result.journeys, []); // Never replace a failure/empty response with sample trips.
});

test("persistent outages expose a useful error and stop after two attempts", async t => {
  configure(t);
  const mock = t.mock.method(globalThis, "fetch", async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(otpPlan(input), e => e.code === "ROUTING_UNAVAILABLE" && /Check connections/.test(e.message) && !/fetch failed|127\.0\.0\.1/.test(e.message));
  assert.equal(mock.mock.callCount(), 2);
});

test("routing timeouts and invalid replies are classified without retry storms", async t => {
  configure(t);
  const mock = t.mock.method(globalThis, "fetch", async () => { throw new DOMException("Timed out", "TimeoutError"); });
  await assert.rejects(otpPlan(input), { code: "ROUTING_TIMEOUT" });
  assert.equal(mock.mock.callCount(), 1);
  mock.mock.mockImplementation(async () => new Response("Bad gateway", { status: 503 }));
  await assert.rejects(otpPlan(input), { code: "ROUTING_UNAVAILABLE" });
  assert.equal(mock.mock.callCount(), 2);
  mock.mock.mockImplementation(async () => new Response("<html>Not JSON</html>"));
  await assert.rejects(otpPlan(input), { code: "OTP_SCHEMA_ERROR" });
  assert.equal(mock.mock.callCount(), 3);
});

test("real stdio MCP reports router outage, then recovers on the same connection", async t => {
  const upstream = createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(emptyPlan)); });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const port = upstream.address().port;
  await new Promise(resolve => upstream.close(resolve));
  configure(t, `http://127.0.0.1:${port}/otp/gtfs/v1`);
  const travel = new TravelClient();
  t.after(async () => { await travel.close(); await new Promise(resolve => upstream.close(resolve)); });
  await assert.rejects(travel.call("search", input), { code: "ROUTING_UNAVAILABLE" });
  const disconnected = (await travel.call("health")).services.find(s => s.name === "Boston routing");
  assert.equal(disconnected.status, "unavailable");
  assert.equal(disconnected.reason, "ROUTING_UNAVAILABLE");
  assert.equal(disconnected.lastSuccess, null);
  const sameClient = travel.client;
  await new Promise(resolve => upstream.listen(port, "127.0.0.1", resolve));
  const result = await travel.call("search", input);
  assert.equal(travel.client, sameClient);
  assert.equal(result.source, "Boston routing");
  assert.deepEqual(result.journeys, []);
  const connected = (await travel.call("health")).services.find(s => s.name === "Boston routing");
  assert.equal(connected.status, "connected");
  assert.ok(connected.lastSuccess);
  assert.equal(connected.reason, undefined);
});

test("connection probes share in-flight work and bound repeated requests", async () => {
  const travel = new TravelClient();
  let finish, calls = 0;
  const gate = new Promise(resolve => { finish = resolve; });
  travel.call = async () => { calls++; await gate; return { vehicles: [], journeys: [] }; };
  const a = travel.probe(), b = travel.probe();
  assert.equal(a, b);
  assert.equal(calls, 5);
  assert.ok(travel.probing);
  finish();
  await a;
  assert.equal(travel.probing, null);
  assert.ok(travel.lastChecked);
  await travel.probe();
  assert.equal(calls, 5);
  await travel.close();
});

test("connection check API is authenticated, CSRF protected, asynchronous and keeps backup status on MCP failure", async t => {
  const directory = mkdtempSync(join(tmpdir(), "wayline-connections-"));
  const store = new Store({ directory, production: false });
  store.backupStatus = { status: "ready", lastSuccess: "2026-09-12T05:00:00Z" };
  let finish, offline = false;
  const travel = new TravelClient();
  travel.status = { name: "Travel MCP", status: "connected", lastSuccess: new Date().toISOString() };
  travel.performProbe = () => new Promise(resolve => { finish = () => resolve([]); });
  travel.call = async () => {
    if (offline) throw Error("MCP unreachable");
    return { services: [{ name: "Boston routing", status: "connected", lastSuccess: new Date().toISOString() }] };
  };
  const app = createApplication({ store, travel, production: false, quiet: true, drainIntervalMs: 60000 });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  t.after(async () => { finish?.(); await app.stopBackgroundJobs(); await new Promise(resolve => app.server.close(resolve)); store.close(); rmSync(directory, { recursive: true, force: true }); });
  assert.equal((await fetch(base + "/travel/check", { method: "POST" })).status, 401);
  const bootResponse = await fetch(base + "/bootstrap"), boot = await bootResponse.json();
  const cookie = bootResponse.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(base + "/travel/check", { method: "POST", headers: { cookie } })).status, 403);
  const response = await fetch(base + "/travel/check", { method: "POST", headers: { cookie, "x-csrf-token": boot.csrf, "content-type": "application/json" }, body: "{}" });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).checking, true);
  finish(); await travel.probing;
  const state = await (await fetch(base + "/travel/health", { headers: { cookie } })).json();
  assert.equal(state.checking, false);
  assert.ok(state.lastChecked);
  offline = true;
  travel.status = { ...travel.status, status: "disconnected" };
  const failed = await (await fetch(base + "/travel/health", { headers: { cookie } })).json();
  assert.equal(failed.services[0].status, "disconnected");
  assert.equal(failed.backup.status, "ready");
});
