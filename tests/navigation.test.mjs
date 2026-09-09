import test from "node:test";
import assert from "node:assert/strict";
import { nav, resolveHash } from "../src/routes.ts";

test("resolveHash recognizes every known nav page and the special watch route", () => {
  for (const [page] of nav) {
    assert.deepEqual(resolveHash(page), { page, offline: false, recognized: true });
  }
  assert.deepEqual(resolveHash("watch"), { page: "watch", offline: false, recognized: true });
});

test("resolveHash recognizes #offline as its own route, separate from any nav page", () => {
  assert.deepEqual(resolveHash("offline"), { page: "plan", offline: true, recognized: true });
});

test("resolveHash falls back to plan for an unrecognized hash and reports it as unrecognized (regression)", () => {
  // Previously an unknown hash left the fallback page displayed (correct) but never corrected
  // the address bar, so a direct link/refresh to a bad or stale hash showed one route in the
  // URL and a different one on screen. `recognized: false` is what App.tsx now uses to decide
  // whether to call history.replaceState and fix that mismatch.
  for (const bad of ["nonsense", "", "plann", "OFFLINE", "watch2"]) {
    const match = resolveHash(bad);
    assert.equal(match.page, "plan");
    assert.equal(match.offline, false);
    assert.equal(match.recognized, false);
  }
});

test("resolveHash never confuses a nav page for the offline route or vice versa", () => {
  assert.equal(resolveHash("offline").offline, true);
  for (const [page] of nav) assert.equal(resolveHash(page).offline, false);
});
