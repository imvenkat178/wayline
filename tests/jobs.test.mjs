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

test("enqueueJob: a second push-deliver enqueue for the same (alertId,subscriptionId) pair returns the existing job instead of duplicating it (R06)", () => {
  const store = temporaryStore(test);
  const user = store.createGuest();
  const payload = { userId: user.id, alertId: "alert-1", subscriptionId: "sub-1" };
  const first = enqueueJob(store, "push-deliver", payload, { userId: user.id });
  const second = enqueueJob(store, "push-deliver", { ...payload }, { userId: user.id });
  assert.equal(second, first, "the pre-existing job's id should be returned, not a fresh one");
  const rows = store.db.prepare("SELECT * FROM jobs WHERE kind='push-deliver'").all();
  assert.equal(rows.length, 1);
});

test("enqueueJob: the push-deliver dedup constraint is scoped to (alertId,subscriptionId) -- a different pair still gets its own job (R06)", () => {
  const store = temporaryStore(test);
  const user = store.createGuest();
  const first = enqueueJob(
    store,
    "push-deliver",
    { userId: user.id, alertId: "alert-1", subscriptionId: "sub-1" },
    { userId: user.id },
  );
  const second = enqueueJob(
    store,
    "push-deliver",
    { userId: user.id, alertId: "alert-1", subscriptionId: "sub-2" },
    { userId: user.id },
  );
  assert.notEqual(second, first);
  const rows = store.db.prepare("SELECT * FROM jobs WHERE kind='push-deliver'").all();
  assert.equal(rows.length, 2);
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
  // Passing the same `now` into ensureRecurringJob as the seeded run_at is what makes this
  // deterministic: it used to call Date.now() internally, a moment after this test's own `now`
  // was captured, so under load the seeded row's run_at could land a millisecond later than
  // `now` -- making it not yet "due" by claimDueJobs's run_at<=now check, claiming nothing
  // (`job` destructures to undefined, and completeJob throws). One shared `now` for both calls
  // removes the race instead of just outrunning it.
  const now = Date.now();
  ensureRecurringJob(store, "sweep", {}, 30000, now);
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
  let now = Date.now();
  ensureRecurringJob(store, "sweep", {}, 30000, now);
  for (let i = 0; i < 20; i++) {
    // Re-claim before each failure (rather than reusing one claim's lease_token across the whole
    // loop) -- R05 ties completeJob/failJob to the lease_token they were claimed under, and a
    // real worker always re-claims between attempts too, since failJob itself clears the lease
    // and reschedules run_at into the future.
    const [job] = claimDueJobs(store, { now });
    assert.ok(job, `iteration ${i} should have a due job to claim`);
    failJob(store, job, new Error(`attempt ${i}`), now);
    const row = jobRow(store, job.id);
    assert.notEqual(row.status, "dead");
    now = row.run_at; // advance the clock to exactly when backoff makes it due again
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

test("completeJob is a no-op if the job's lease has since been reclaimed by a newer claim (R05)", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const id = enqueueJob(store, "test-kind", {}, { runAt: now });
  const staleClaim = claimDueJobs(store, { now, workerId: "worker-a" })[0];
  // Simulate worker-a's handler stalling well past its own lease -- a later drain reclaims the
  // job under a fresh lease_token, exactly like claimDueJobs's existing "abandoned lease" path.
  // (claimDueJobs's return value carries the pre-claim status/leased_until snapshot from its own
  // SELECT, not what it just wrote -- read the real row back to get the lease it actually set.)
  const reclaimAt = jobRow(store, id).leased_until + 1;
  const freshClaim = claimDueJobs(store, { now: reclaimAt, workerId: "worker-b" })[0];
  assert.notEqual(freshClaim.lease_token, staleClaim.lease_token);
  // worker-a's handler finally finishes and tries to complete the job it originally claimed --
  // this must NOT succeed (the job now belongs to worker-b's claim), and must not disturb it.
  assert.equal(completeJob(store, staleClaim, reclaimAt + 1), false);
  const row = jobRow(store, id);
  assert.equal(row.status, "leased");
  assert.equal(row.leased_by, "worker-b");
  // worker-b completes it for real -- this succeeds, using its own valid lease_token.
  assert.equal(completeJob(store, freshClaim, reclaimAt + 2), true);
  assert.equal(jobRow(store, id).status, "done");
});

test("failJob is also a no-op on a stale (superseded) lease_token, leaving the newer claim's state untouched (R05)", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const id = enqueueJob(store, "test-kind", {}, { runAt: now, maxAttempts: 5 });
  const staleClaim = claimDueJobs(store, { now, workerId: "worker-a" })[0];
  const reclaimAt = jobRow(store, id).leased_until + 1;
  claimDueJobs(store, { now: reclaimAt, workerId: "worker-b" });
  assert.equal(
    failJob(store, staleClaim, new Error("worker-a finally gave up"), reclaimAt + 1),
    false,
  );
  const row = jobRow(store, id);
  assert.equal(row.attempts, 0); // untouched by the stale failure report
  assert.equal(row.status, "leased");
  assert.equal(row.leased_by, "worker-b");
});

test("processJobs treats a handler that outlives its deadline as a failure, not an indefinite hang (R05)", async () => {
  const store = temporaryStore(test);
  const now = Date.now();
  enqueueJob(store, "stuck", {}, { runAt: now });
  const results = await processJobs(
    store,
    { stuck: () => new Promise(() => {}) }, // never resolves
    { now, handlerDeadlineMs: 20 },
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /exceeded its lease/);
  const row = store.db.prepare("SELECT * FROM jobs WHERE kind='stuck'").get();
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 1);
});

test("guardian-sweep still produces real alerts when run through the durable job queue", async () => {
  const store = temporaryStore(test);
  const now = Date.now();
  ensureRecurringJob(store, "guardian-sweep", {}, 30000, now);
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
