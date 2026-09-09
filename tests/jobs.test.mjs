import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { createApplication } from "../server/server.mjs";
import {
  enqueueJob,
  ensureRecurringJob,
  claimDueJobs,
  completeJob,
  failJob,
  processJobs,
} from "../server/jobs.mjs";
import { runGuardian } from "../server/guardian.mjs";

function temporaryStore(t) {
  const directory = mkdtempSync(join(tmpdir(), "wayline-test-"));
  const store = new Store({ directory, key: "56".repeat(32), production: false });
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return store;
}

function jobRow(store, id) {
  return store.db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
}

test("enqueueJob: creates a due, pending one-shot job by default", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const id = enqueueJob(store, "test-kind", { a: 1 }, {});
  const row = jobRow(store, id);
  assert.equal(row.status, "pending");
  assert.equal(row.interval_ms, null);
  assert.ok(row.run_at <= now + 1);
  assert.deepEqual(JSON.parse(row.payload), { a: 1 });
});

test("enqueueJob: a future runAt is not claimed until due", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  enqueueJob(store, "future", {}, { runAt: now + 60000 });
  assert.equal(claimDueJobs(store, { now }).length, 0);
  assert.equal(claimDueJobs(store, { now: now + 60000 }).length, 1);
});

test("claimDueJobs: leases claimed jobs so a concurrent claim can't take them twice", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  enqueueJob(store, "test-kind", {}, { runAt: now });
  const first = claimDueJobs(store, { now });
  assert.equal(first.length, 1);
  const second = claimDueJobs(store, { now });
  assert.equal(second.length, 0);
});

test("claimDueJobs: reclaims a job whose lease expired (an interrupted run)", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const id = enqueueJob(store, "test-kind", {}, { runAt: now });
  claimDueJobs(store, { now, workerId: "worker-a" });
  // Simulate that worker-a died mid-run: its lease is still in the future relative to `now`,
  // so nothing should be reclaimable yet...
  assert.equal(claimDueJobs(store, { now: now + 1000 }).length, 0);
  // ...but once the lease itself has expired, the abandoned job becomes claimable again.
  const row = jobRow(store, id);
  const reclaimed = claimDueJobs(store, { now: row.leased_until + 1 });
  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0].id, id);
});

test("ensureRecurringJob: seeds exactly one row per kind, even if called twice", () => {
  const store = temporaryStore(test);
  const id1 = ensureRecurringJob(store, "sweep", { x: 1 }, 30000);
  const id2 = ensureRecurringJob(store, "sweep", { x: 1 }, 30000);
  assert.equal(id1, id2);
  const count = store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind='sweep'").get().n;
  assert.equal(count, 1);
});

test("completeJob: a recurring job reschedules itself instead of finishing", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  ensureRecurringJob(store, "sweep", {}, 30000);
  const [job] = claimDueJobs(store, { now });
  completeJob(store, job, now);
  const row = jobRow(store, job.id);
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 0);
  assert.equal(row.run_at, now + 30000);
});

test("completeJob: a one-shot job finishes as done", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const id = enqueueJob(store, "one-shot", {}, { runAt: now });
  const [job] = claimDueJobs(store, { now });
  completeJob(store, job, now);
  assert.equal(jobRow(store, id).status, "done");
});

test("failJob: a one-shot job retries with backoff until max_attempts, then dead-letters", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const id = enqueueJob(store, "flaky", {}, { runAt: now, maxAttempts: 2 });
  let job = claimDueJobs(store, { now })[0];
  failJob(store, job, new Error("boom 1"), now);
  let row = jobRow(store, id);
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 1);
  assert.ok(row.run_at > now, "backoff should push run_at into the future");
  assert.match(row.last_error, /boom 1/);

  job = claimDueJobs(store, { now: row.run_at })[0];
  failJob(store, job, new Error("boom 2"), row.run_at);
  row = jobRow(store, id);
  assert.equal(row.status, "dead");
  assert.equal(row.attempts, 2);
});

test("failJob: a recurring job never dead-letters, no matter how many times it fails", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  ensureRecurringJob(store, "sweep", {}, 30000);
  let job = claimDueJobs(store, { now })[0];
  for (let i = 0; i < 20; i++) {
    failJob(store, job, new Error(`attempt ${i}`), now);
    const row = jobRow(store, job.id);
    assert.notEqual(row.status, "dead");
    job = { ...job, attempts: row.attempts };
  }
});

test("processJobs: runs the registered handler and marks the job complete", async () => {
  const store = temporaryStore(test);
  const now = Date.now();
  enqueueJob(store, "greet", { name: "Ada" }, { runAt: now });
  const seen = [];
  const results = await processJobs(
    store,
    { greet: (_store, payload) => seen.push(payload.name) },
    { now },
  );
  assert.deepEqual(seen, ["Ada"]);
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
});

test("processJobs: a job with no registered handler fails without aborting the rest of the batch", async () => {
  const store = temporaryStore(test);
  const now = Date.now();
  enqueueJob(store, "unknown-kind", {}, { runAt: now, id: "job-a" });
  enqueueJob(store, "known-kind", {}, { runAt: now, id: "job-b" });
  const ran = [];
  const results = await processJobs(store, { "known-kind": () => ran.push("b") }, { now });
  assert.deepEqual(ran, ["b"]);
  assert.equal(results.length, 2);
  const a = results.find((r) => r.id === "job-a");
  const b = results.find((r) => r.id === "job-b");
  assert.equal(a.ok, false);
  assert.equal(b.ok, true);
  assert.equal(jobRow(store, "job-a").status, "pending"); // retrying, well under max_attempts
});

test("processJobs: an async handler failure is caught the same as a sync one", async () => {
  const store = temporaryStore(test);
  const now = Date.now();
  enqueueJob(store, "explodes", {}, { runAt: now, maxAttempts: 1 });
  const results = await processJobs(
    store,
    {
      explodes: async () => {
        throw new Error("async boom");
      },
    },
    { now },
  );
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /async boom/);
});

test("createApplication seeds the guardian-sweep recurring job on startup", () => {
  const store = temporaryStore(test);
  const { server } = createApplication({ store, production: false, quiet: true });
  server.close();
  const row = store.db
    .prepare("SELECT * FROM jobs WHERE kind='guardian-sweep' AND interval_ms IS NOT NULL")
    .get();
  assert.ok(row, "guardian-sweep should be seeded as a recurring job");
  assert.equal(row.interval_ms, 30000);
  assert.equal(row.status, "pending");
});

test("guardian-sweep still produces real alerts when run through the durable job queue", async () => {
  const store = temporaryStore(test);
  const now = Date.now();
  ensureRecurringJob(store, "guardian-sweep", {}, 30000);
  const user = store.createGuest();
  store.put(user.id, "pass", {
    name: "Regression pass",
    renewal: new Date(now + 86400000).toISOString(),
  });

  const results = await processJobs(
    store,
    { "guardian-sweep": (jobStore) => runGuardian(jobStore, undefined, now) },
    { now },
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(store.list(user.id, "alert").length, 1);

  // And the recurring job rescheduled itself rather than finishing.
  const row = store.db.prepare("SELECT * FROM jobs WHERE kind='guardian-sweep'").get();
  assert.equal(row.status, "pending");
  assert.equal(row.run_at, now + 30000);
});
