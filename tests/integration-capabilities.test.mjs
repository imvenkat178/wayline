import test from "node:test";
import assert from "node:assert/strict";
import { commercialCapabilities } from "../server/adapters/providers.mjs";

test("commercial capabilities are no longer a single uniform status", () => {
  const statuses = new Set(commercialCapabilities.map((c) => c.status));
  assert.ok(statuses.size > 1, "expected more than one distinct status among capabilities");
  for (const status of statuses)
    assert.ok(
      ["provider required", "unsupported"].includes(status),
      `unexpected capability status: ${status}`,
    );
});

test("remote-push is not misclassified as needing a commercial contract", () => {
  const push = commercialCapabilities.find((c) => c.id === "remote-push");
  assert.ok(push);
  assert.equal(push.status, "unsupported");
  assert.match(push.reason, /no commercial contract/i);
});

test("capabilities that genuinely need a paid/contracted provider are marked provider required", () => {
  for (const id of ["unified-checkout", "ticket-issuance", "payment-tokenization", "sms-email"]) {
    const c = commercialCapabilities.find((x) => x.id === id);
    assert.ok(c, `missing capability ${id}`);
    assert.equal(c.status, "provider required");
  }
});

test("no capability claims to be healthy, authorized or connected -- none of them are", () => {
  for (const c of commercialCapabilities) {
    assert.ok(
      !["healthy", "authorized", "connected"].includes(c.status),
      `capability ${c.id} falsely claims status ${c.status}`,
    );
    assert.equal(c.enabled, false);
  }
});

test("every capability carries a specific, non-generic reason", () => {
  const reasons = commercialCapabilities.map((c) => c.reason);
  // Previously every entry shared the exact same string; now each is specific to that capability.
  assert.equal(new Set(reasons).size, reasons.length);
});

test("all twelve original capability ids are still reported", () => {
  const ids = commercialCapabilities.map((c) => c.id).sort();
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
