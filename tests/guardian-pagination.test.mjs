import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { runGuardian, GUARDIAN_SCAN_BATCH_SIZE } from "../server/guardian.mjs";

function temporaryStore(t) {
  const directory = mkdtempSync(join(tmpdir(), "wayline-test-"));
  const store = new Store({ directory, key: "34".repeat(32), production: false });
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return store;
}

test("guardian's default batch size matches the exported constant", () => {
  assert.equal(GUARDIAN_SCAN_BATCH_SIZE, 500);
});

test("a full sweep reaches every account with something to evaluate, not just the first page", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const userCount = 7;
  const users = [];
  for (let i = 0; i < userCount; i++) {
    const user = store.createGuest();
    store.put(user.id, "pass", {
      name: `Pass ${i}`,
      renewal: new Date(now + 86400000).toISOString(),
    });
    users.push(user.id);
  }

  // A batch size smaller than the account count stands in for the production bug: the old
  // code used a single fixed-size, un-paginated `LIMIT 1000` query, so any account past the
  // limit was silently never evaluated by the periodic sweep. Passing a small batchSize here
  // exercises the same "more accounts than one page" shape without needing 1000+ fixture rows.
  runGuardian(store, undefined, now, 2);

  for (const userId of users) {
    const alerts = store.list(userId, "alert");
    assert.equal(
      alerts.length,
      1,
      `user ${userId} should have received its renewal alert regardless of which page it fell on`,
    );
    assert.equal(alerts[0].kind, "renewal");
  }
});

test("accounts with no journey, commute, or pass records are skipped without affecting others", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const idle = store.createGuest();
  const active = store.createGuest();
  store.put(active.id, "pass", {
    name: "Active pass",
    renewal: new Date(now + 86400000).toISOString(),
  });

  runGuardian(store, undefined, now, 500);

  assert.equal(store.list(idle.id, "alert").length, 0);
  assert.equal(store.list(active.id, "alert").length, 1);
});

test("onlyUser still evaluates a single account directly, bypassing the scan entirely", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const user = store.createGuest();
  store.put(user.id, "pass", {
    name: "Direct pass",
    renewal: new Date(now + 86400000).toISOString(),
  });

  runGuardian(store, user.id, now);

  assert.equal(store.list(user.id, "alert").length, 1);
});

test("re-running a sweep does not duplicate alerts (dedupeKey survives pagination)", () => {
  const store = temporaryStore(test);
  const now = Date.now();
  const users = [];
  for (let i = 0; i < 5; i++) {
    const user = store.createGuest();
    store.put(user.id, "pass", {
      name: `Pass ${i}`,
      renewal: new Date(now + 86400000).toISOString(),
    });
    users.push(user.id);
  }

  runGuardian(store, undefined, now, 2);
  runGuardian(store, undefined, now, 2);

  for (const userId of users) {
    assert.equal(store.list(userId, "alert").length, 1);
  }
});
