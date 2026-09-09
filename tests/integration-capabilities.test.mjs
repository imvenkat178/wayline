import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commercialCapabilities } from "../server/adapters/providers.mjs";
import { configureWebPush } from "../server/push.mjs";

// remote-push's status depends on whether configureWebPush() has run in this process (see
// push.mjs and server.mjs) -- unlike the other eleven capabilities, it is not a fixed string.
// This file exercises both states deliberately, in this order, so later assertions about the
// other eleven capabilities are not accidentally affected by push's own module-level state.

test("before configureWebPush runs, remote-push reports not configured, not unsupported", () => {
  const push = commercialCapabilities().find((c) => c.id === "remote-push");
  assert.ok(push);
  assert.equal(push.status, "not configured");
  assert.equal(push.enabled, false);
  assert.doesNotMatch(push.reason, /provider|contract/i);
});

test("after configureWebPush runs, remote-push is reported configured and enabled", () => {
  const directory = mkdtempSync(join(tmpdir(), "wayline-test-"));
  try {
    configureWebPush(directory);
    const push = commercialCapabilities().find((c) => c.id === "remote-push");
    assert.equal(push.status, "configured, not checked");
    assert.equal(push.enabled, true);
    assert.doesNotMatch(push.reason, /provider|contract/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("commercial capabilities are no longer a single uniform status", () => {
  const statuses = new Set(commercialCapabilities().map((c) => c.status));
  assert.ok(statuses.size > 1, "expected more than one distinct status among capabilities");
  for (const status of statuses)
    assert.ok(
      ["provider required", "unsupported", "configured, not checked", "not configured"].includes(
        status,
      ),
      `unexpected capability status: ${status}`,
    );
});

test("capabilities that genuinely need a paid/contracted provider are marked provider required", () => {
  for (const id of ["unified-checkout", "ticket-issuance", "payment-tokenization", "sms-email"]) {
    const c = commercialCapabilities().find((x) => x.id === id);
    assert.ok(c, `missing capability ${id}`);
    assert.equal(c.status, "provider required");
    assert.equal(c.enabled, false);
  }
});

test("no capability claims to be healthy, authorized or connected -- none of them are", () => {
  for (const c of commercialCapabilities()) {
    assert.ok(
      !["healthy", "authorized", "connected"].includes(c.status),
      `capability ${c.id} falsely claims status ${c.status}`,
    );
    // remote-push is the one capability whose `enabled` can legitimately be true (it is now
    // genuinely implemented) -- every other capability must still honestly report false.
    if (c.id !== "remote-push") assert.equal(c.enabled, false);
  }
});

test("every capability carries a specific, non-generic reason", () => {
  const reasons = commercialCapabilities().map((c) => c.reason);
  // Previously every entry shared the exact same string; now each is specific to that capability.
  assert.equal(new Set(reasons).size, reasons.length);
});

test("all twelve original capability ids are still reported", () => {
  const ids = commercialCapabilities()
    .map((c) => c.id)
    .sort();
  assert.deepEqual(
    ids,
    [
      "automatic-rebooking",
      "ev-live-availability",
      "flight-inventory",
      "indoor-ar",
      "native-watch",
      "payment-tokenization",
      "refund-submission",
      "remote-push",
      "seat-inventory",
      "sms-email",
      "ticket-issuance",
      "unified-checkout",
    ].sort(),
  );
});
