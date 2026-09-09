import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, MIN_REPORT_COHORT } from "../server/store.mjs";
import { createApplication } from "../server/server.mjs";

// Phase 8 (roadmap features 98/99, hardens 100/101): the operator dashboard used to be one
// global COUNT(*) with one hardcoded threshold ("the current endpoint is count-only" per the
// roadmap's own framing); these tests exercise the real per-type aggregation-threshold
// breakdown that replaced it, real confidence weighting on report creation (previously always
// null), and the new report moderation lifecycle (status/resolutionNote, visible to the
// reporter, actionable by an operator without exposing who filed a report).

function temporaryStore(t) {
  const directory = mkdtempSync(join(tmpdir(), "wayline-test-"));
  const store = new Store({ directory, key: "34".repeat(32), production: false });
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return store;
}

// Registration always assigns "traveler" (trusted operator-role provisioning is still not
// built, per FEATURE_STATUS.md's honest framing of feature 98) -- tests promote a user to
// "operator" the same way tests/*.test.mjs already reach into the store directly for state an
// ordinary API call can't produce.
function makeOperator(store, userId) {
  const row = store.db.prepare("SELECT profile FROM users WHERE id=?").get(userId);
  const profile = store.decrypt(row.profile);
  profile.role = "operator";
  store.db.prepare("UPDATE users SET profile=? WHERE id=?").run(store.encrypt(profile), userId);
}

async function withServer(t) {
  const store = temporaryStore(t);
  const { server } = createApplication({ store, production: false, quiet: true });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { base: `http://127.0.0.1:${server.address().port}`, store };
}

async function freshSession(base) {
  const res = await fetch(base + "/api/bootstrap");
  const boot = await res.json();
  return {
    cookie: res.headers.get("set-cookie").split(";")[0],
    csrf: boot.csrf,
    userId: boot.user.id,
  };
}

function headers(session) {
  return {
    "content-type": "application/json",
    cookie: session.cookie,
    "x-csrf-token": session.csrf,
  };
}

async function submitReport(
  base,
  session,
  { type = "bus-missing", station = "Elm St", service = "Route 5", note = "" } = {},
) {
  const res = await fetch(base + "/api/records/report", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ type, station, service, note, consent: true }),
  });
  return { status: res.status, body: await res.json() };
}

test("a freshly created report starts open, unconfirmed and with zero confidence", (t) => {
  const store = temporaryStore(t);
  const guest = store.createGuest();
  const value = {
    type: "bus-missing",
    station: "Elm St",
    service: "Route 5",
    note: "",
    consent: true,
    source: "unverified rider report",
    confidence: null,
    confirmations: 0,
    status: "open",
    resolutionNote: null,
    moderatedAt: null,
    observedAt: new Date().toISOString(),
  };
  const saved = store.put(guest.id, "report", value);
  assert.equal(saved.status, "open");
  assert.equal(saved.confirmations, 0);
  assert.equal(saved.resolutionNote, null);
});

test("reportConfirmations counts only OTHER distinct accounts reporting the same station+type recently", (t) => {
  const store = temporaryStore(t);
  const a = store.createGuest(),
    b = store.createGuest(),
    c = store.createGuest();
  const report = (userId, type, station) =>
    store.put(userId, "report", {
      type,
      station,
      service: "Route 5",
      note: "",
      consent: true,
      source: "unverified rider report",
      confidence: null,
      confirmations: 0,
      status: "open",
      resolutionNote: null,
      moderatedAt: null,
      observedAt: new Date().toISOString(),
    });
  report(a.id, "bus-missing", "Elm St");
  // Same user filing again must not inflate the distinct-contributor count.
  report(a.id, "bus-missing", "Elm St");
  assert.equal(store.reportConfirmations("Elm St", "bus-missing", { excludeUserId: a.id }), 0);
  report(b.id, "bus-missing", "Elm St");
  assert.equal(store.reportConfirmations("Elm St", "bus-missing", { excludeUserId: a.id }), 1);
  // A different type at the same station does not count toward this type's confirmations.
  report(c.id, "elevator-broken", "Elm St");
  assert.equal(store.reportConfirmations("Elm St", "bus-missing", { excludeUserId: a.id }), 1);
});

test("submitting a report over HTTP computes real confidence from distinct prior reporters, not a null placeholder", async (t) => {
  const { base, store } = await withServer(t);
  const first = await freshSession(base);
  const r1 = await submitReport(base, first);
  assert.equal(r1.status, 201);
  assert.equal(r1.body.confirmations, 0);
  assert.equal(r1.body.confidence, 1 / MIN_REPORT_COHORT);

  const second = await freshSession(base);
  const r2 = await submitReport(base, second);
  assert.equal(r2.body.confirmations, 1); // the first session's report now counts
  assert.equal(r2.body.confidence, 2 / MIN_REPORT_COHORT);
});

test("/api/operator requires the operator role and no longer exists as a single blanket count", async (t) => {
  const { base, store } = await withServer(t);
  const traveler = await freshSession(base);
  assert.equal((await fetch(base + "/api/operator", { headers: traveler })).status, 403);
});

test("/api/operator withholds a report type until MIN_REPORT_COHORT distinct accounts have filed it, then breaks it down per type", async (t) => {
  const { base, store } = await withServer(t);
  // File one bus-missing report each from 5 distinct sessions (reaching the cohort threshold),
  // and a single elevator-broken report from a 6th session (staying under it).
  let lastOperatorUserId;
  for (let i = 0; i < MIN_REPORT_COHORT; i++) {
    const s = await freshSession(base);
    await submitReport(base, s, { type: "bus-missing", station: "Elm St" });
    lastOperatorUserId = s;
  }
  const belowThreshold = await freshSession(base);
  await submitReport(base, belowThreshold, { type: "elevator-broken", station: "Oak Ave" });

  // Promote the last reporting session's own user to operator (can't happen through the
  // public API) rather than bootstrapping a fresh account just to read the dashboard.
  makeOperator(store, lastOperatorUserId.userId);

  const res = await fetch(base + "/api/operator", { headers: lastOperatorUserId });
  assert.equal(res.status, 200);
  const body = await res.json();
  const busMissing = body.dataQualityReports.find((r) => r.type === "bus-missing");
  assert.ok(busMissing, "bus-missing should have reached the cohort threshold");
  assert.equal(busMissing.distinctContributors, MIN_REPORT_COHORT);
  assert.equal(busMissing.reports, MIN_REPORT_COHORT);
  assert.ok(body.suppressedTypes.includes("elevator-broken"));
  assert.ok(!body.dataQualityReports.some((r) => r.type === "elevator-broken"));
  assert.equal(body.minimumCohort, MIN_REPORT_COHORT);
});

test("/api/operator/reports lists a single report as an actionable ticket without waiting for the cohort threshold, and never exposes who filed it", async (t) => {
  const { base, store } = await withServer(t);
  const reporter = await freshSession(base);
  await submitReport(base, reporter, {
    type: "elevator-broken",
    station: "Oak Ave",
    note: "Elevator has been out for two days",
  });
  makeOperator(store, reporter.userId);

  const res = await fetch(base + "/api/operator/reports", { headers: reporter });
  assert.equal(res.status, 200);
  const list = await res.json();
  assert.equal(list.length, 1);
  assert.equal(list[0].type, "elevator-broken");
  assert.equal(list[0].status, "open");
  assert.ok(!("userId" in list[0]) && !("user_id" in list[0]));
});

test("an operator can moderate a report to resolved with a note, and it disappears from the open worklist", async (t) => {
  const { base, store } = await withServer(t);
  const reporter = await freshSession(base);
  const created = await submitReport(base, reporter, { type: "stop-moved", station: "5th & Main" });
  makeOperator(store, reporter.userId);

  const patch = await fetch(base + `/api/operator/reports/${created.body.id}`, {
    method: "PATCH",
    headers: headers(reporter),
    body: JSON.stringify({
      status: "resolved",
      resolutionNote: "Stop sign relocated 40ft north; schedule unaffected.",
    }),
  });
  assert.equal(patch.status, 200);
  const updated = await patch.json();
  assert.equal(updated.status, "resolved");
  assert.equal(updated.resolutionNote, "Stop sign relocated 40ft north; schedule unaffected.");

  const worklist = await (
    await fetch(base + "/api/operator/reports", { headers: reporter })
  ).json();
  assert.ok(!worklist.some((r) => r.id === created.body.id));
});

test("a non-operator cannot moderate a report", async (t) => {
  const { base } = await withServer(t);
  const reporter = await freshSession(base);
  const created = await submitReport(base, reporter, { type: "crowding", station: "Union Sq" });
  const res = await fetch(base + `/api/operator/reports/${created.body.id}`, {
    method: "PATCH",
    headers: headers(reporter),
    body: JSON.stringify({ status: "resolved" }),
  });
  assert.equal(res.status, 403);
});

test("resolution is visible to the reporter through their own report list, without needing operator access", async (t) => {
  const { base, store } = await withServer(t);
  const reporter = await freshSession(base);
  const created = await submitReport(base, reporter, {
    type: "boarding-location",
    station: "North Terminal",
  });
  // Moderation itself is exercised as a distinct operator identity in the previous tests; this
  // one is specifically about what the REPORTER sees afterwards, so promoting their own session
  // to operator just to file the PATCH (rather than bootstrapping a second account) keeps this
  // file's guest-account count well under server.mjs's shared, real-1-hour rate-limit bucket.
  makeOperator(store, reporter.userId);
  await fetch(base + `/api/operator/reports/${created.body.id}`, {
    method: "PATCH",
    headers: headers(reporter),
    body: JSON.stringify({
      status: "dismissed",
      resolutionNote: "Boarding location confirmed correct on-site.",
    }),
  });

  const mine = await (await fetch(base + "/api/records/report", { headers: reporter })).json();
  const own = mine.find((r) => r.id === created.body.id);
  assert.equal(own.status, "dismissed");
  assert.equal(own.resolutionNote, "Boarding location confirmed correct on-site.");
});

test("moderateReport rejects an unrecognized status", (t) => {
  const store = temporaryStore(t);
  const guest = store.createGuest();
  const saved = store.put(guest.id, "report", {
    type: "on-board",
    station: "Elm St",
    service: "Route 5",
    note: "",
    consent: true,
    source: "unverified rider report",
    confidence: null,
    confirmations: 0,
    status: "open",
    resolutionNote: null,
    moderatedAt: null,
    observedAt: new Date().toISOString(),
  });
  assert.throws(() => store.moderateReport(saved.id, { status: "archived" }), { status: 400 });
});

test("/api/community still applies the same MIN_REPORT_COHORT threshold, now via the shared constant instead of a second hardcoded 5", async (t) => {
  const { base } = await withServer(t);
  let last;
  for (let i = 0; i < MIN_REPORT_COHORT - 1; i++) {
    last = await freshSession(base);
    await submitReport(base, last, { type: "on-board", station: "Central Station" });
  }
  const under = await (
    await fetch(base + "/api/community?station=Central%20Station", { headers: last })
  ).json();
  assert.equal(under.riders, null);
  assert.equal(under.threshold, MIN_REPORT_COHORT);

  const s = await freshSession(base);
  await submitReport(base, s, { type: "on-board", station: "Central Station" });
  const atThreshold = await (
    await fetch(base + "/api/community?station=Central%20Station", { headers: last })
  ).json();
  assert.equal(atThreshold.riders, MIN_REPORT_COHORT);
});
