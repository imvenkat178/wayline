// Liveness and readiness probes (ROADMAP G2.4): liveness answers while the process runs; readiness
// fails when SQLite, the schema migrations or the background job lanes are not healthy.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { createApplication } from "../server/server.mjs";
import { startJobWorkers } from "../server/jobWorkers.mjs";

function temporaryStore(t) {
  const directory = mkdtempSync(join(tmpdir(), "wayline-health-"));
  const store = new Store({ directory, key: "34".repeat(32), production: false });
  t.after(() => {
    try {
      store.close();
    } catch {
      // Some tests close the database on purpose.
    }
    rmSync(directory, { recursive: true, force: true });
  });
  return store;
}

async function startApp(t, store) {
  const travel = { status: { name: "Travel MCP", status: "not checked", lastSuccess: null }, close: async () => {}, probe: async () => [] };
  const app = createApplication({ store, travel, production: false, quiet: true, drainIntervalMs: 60000, immediateJobs: false });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    await app.stopBackgroundJobs();
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const probe = async (path) => {
    const response = await fetch(base + path);
    return { status: response.status, body: await response.json() };
  };
  return { app, probe };
}

test("liveness and readiness both succeed for a healthy application", async (t) => {
  const { probe } = await startApp(t, temporaryStore(t));
  const live = await probe("/api/health/live");
  assert.equal(live.status, 200);
  assert.equal(live.body.status, "live");
  const ready = await probe("/api/health/ready");
  assert.equal(ready.status, 200);
  assert.equal(ready.body.status, "ready");
  assert.deepEqual(ready.body.checks.database, { ok: true });
  assert.deepEqual(ready.body.checks.migrations, { ok: true, version: 1, missing: [] });
  assert.equal(ready.body.checks.jobWorkers.ok, true);
  assert.deepEqual(ready.body.checks.jobWorkers.lanes.map((lane) => lane.name), ["conversation", "shopping", "transaction", "maintenance"]);
});

test("readiness fails when SQLite is unavailable while liveness still answers", async (t) => {
  const store = temporaryStore(t);
  const { probe } = await startApp(t, store);
  store.close();
  const ready = await probe("/api/health/ready");
  assert.equal(ready.status, 503);
  assert.equal(ready.body.status, "not ready");
  assert.deepEqual(ready.body.checks.database, { ok: false });
  assert.equal(ready.body.checks.migrations.ok, false);
  assert.equal((await probe("/api/health/live")).status, 200);
});

test("readiness fails when the schema version is missing", async (t) => {
  const store = temporaryStore(t);
  const { probe } = await startApp(t, store);
  store.db.exec("DELETE FROM schema_version");
  const ready = await probe("/api/health/ready");
  assert.equal(ready.status, 503);
  assert.deepEqual(ready.body.checks.migrations, { ok: false, version: null, missing: [] });
  assert.equal(ready.body.checks.database.ok, true);
});

test("readiness fails once the background job workers have stopped", async (t) => {
  const { app, probe } = await startApp(t, temporaryStore(t));
  await app.stopBackgroundJobs();
  const ready = await probe("/api/health/ready");
  assert.equal(ready.status, 503);
  assert.equal(ready.body.checks.jobWorkers.ok, false);
  assert.equal(ready.body.checks.jobWorkers.stopped, true);
});

test("a job lane heartbeat goes stale after three poll intervals without draining", async (t) => {
  const store = temporaryStore(t);
  const workers = startJobWorkers(store, {}, { pollMs: 60000, immediate: false });
  t.after(() => workers.stop());
  assert.equal(workers.status().ok, true);
  const stale = workers.status(Date.now() + 180001);
  assert.equal(stale.ok, false);
  assert.ok(stale.lanes.every((lane) => !lane.busy && !lane.ok && lane.lastDrainAt === null));
});
