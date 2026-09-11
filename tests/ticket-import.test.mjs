import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Store } from "../server/store.mjs";
import { createApplication } from "../server/server.mjs";
import { validateRecord } from "../server/records.mjs";

// Phase 6 (roadmap features 18/19): a ticket can now optionally carry a barcode decoded
// client-side from an attached photo (open standards -- QR/PDF417/Aztec/etc, see
// src/barcode.ts) plus the photo itself, still explicitly labeled an unverified import, never
// checked against any issuer or carrier system. These tests exercise both the records.mjs
// validation directly and the real HTTP path, including the specifically raised (but still
// bounded) request-body cap server.mjs grants only this endpoint.

function cookieOf(res) {
  const set = res.headers.get("set-cookie");
  return set ? set.split(";")[0] : null;
}
async function withServer(t) {
  const directory = mkdtempSync(join(tmpdir(), "wayline-test-"));
  const store = new Store({ directory, key: "78".repeat(32), production: false });
  const { server } = createApplication({ store, production: false, quiet: true });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { base, store };
}
async function freshSession(base) {
  const res = await fetch(base + "/api/bootstrap");
  const boot = await res.json();
  return { cookie: cookieOf(res), csrf: boot.csrf, boot };
}
function headers({ cookie, csrf }) {
  return { "content-type": "application/json", cookie, "x-csrf-token": csrf };
}
function ticketFields(extra = {}) {
  return {
    operator: "Amtrak",
    service: "Northeast Regional",
    confirmation: "ABC123",
    passenger: "Alex Traveler",
    departure: new Date(Date.now() + 3600000).toISOString(),
    origin: "Boston",
    destination: "New York",
    ...extra,
  };
}
function base64Of(bytes) {
  return Buffer.from(bytes).toString("base64");
}

test("validateRecord('ticket', ...) accepts no document at all, unchanged from before Phase 6", () => {
  const v = validateRecord("ticket", ticketFields());
  assert.equal(v.document, null);
  assert.equal(v.barcodeFormat, null);
  assert.equal(v.barcodeText, null);
  assert.equal(v.source, "manual import; not verified by operator");
});

test("validateRecord('ticket', ...) accepts a small valid document plus a decoded barcode", () => {
  const document = { name: "ticket.jpg", type: "image/jpeg", base64: base64Of(randomBytes(100)) };
  const v = validateRecord(
    "ticket",
    ticketFields({ document, barcodeFormat: "QR_CODE", barcodeText: "some-decoded-payload" }),
  );
  assert.deepEqual(v.document, document);
  assert.equal(v.barcodeFormat, "QR_CODE");
  assert.equal(v.barcodeText, "some-decoded-payload");
  assert.match(v.source, /document import/);
});

test("validateRecord('ticket', ...) rejects a document with no base64 data", () => {
  assert.throws(() =>
    validateRecord("ticket", ticketFields({ document: { name: "x.jpg", type: "image/jpeg" } })),
  );
});

test("validateRecord('ticket', ...) rejects a document larger than the cap", () => {
  const document = { name: "big.jpg", type: "image/jpeg", base64: "A".repeat(7_000_001) };
  assert.throws(() => validateRecord("ticket", ticketFields({ document })));
});

test("validateRecord('ticket', ...) rejects non-base64 document data", () => {
  const document = { name: "x.jpg", type: "image/jpeg", base64: "not base64 at all!!" };
  assert.throws(() => validateRecord("ticket", ticketFields({ document })));
});

test("posting a ticket with a ~2 MB attached document succeeds over real HTTP (raised cap)", async (t) => {
  const { base } = await withServer(t);
  const session = await freshSession(base);
  const document = {
    name: "ticket.jpg",
    type: "image/jpeg",
    base64: base64Of(randomBytes(1_500_000)), // ~2 MB once base64-encoded
  };
  const res = await fetch(base + "/api/records/ticket", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify(
      ticketFields({ document, barcodeFormat: "PDF_417", barcodeText: "1234567890" }),
    ),
  });
  assert.equal(res.status, 201);
  const saved = await res.json();
  assert.equal(saved.document.name, "ticket.jpg");
  assert.equal(saved.barcodeFormat, "PDF_417");

  const fetched = await (
    await fetch(base + "/api/records/ticket", { headers: headers(session) })
  ).json();
  assert.equal(fetched.find((x) => x.id === saved.id).document.base64, document.base64);
});

test("a ticket document over the 8 MB request-body cap is rejected, not silently truncated", async (t) => {
  const { base } = await withServer(t);
  const session = await freshSession(base);
  const document = {
    name: "huge.jpg",
    type: "image/jpeg",
    base64: "A".repeat(8_500_000), // comfortably past the 8 MB body cap once wrapped in JSON
  };
  const res = await fetch(base + "/api/records/ticket", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify(ticketFields({ document })),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(res.status, 413);
});

test("a request body over 1 MB for an unrelated endpoint is still rejected (the raised cap is scoped to ticket imports only)", async (t) => {
  const { base } = await withServer(t);
  const session = await freshSession(base);
  const res = await fetch(base + "/api/records/favorite", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ name: "A".repeat(1_500_000), from: "boston", to: "nyc" }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(res.status, 413);
});

test("deleteHistory removes a ticket even when it carries an attached document and decoded barcode", async (t) => {
  const { base, store } = await withServer(t);
  const session = await freshSession(base);
  const document = { name: "t.jpg", type: "image/jpeg", base64: base64Of(randomBytes(1000)) };
  const res = await fetch(base + "/api/records/ticket", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify(ticketFields({ document, barcodeFormat: "AZTEC", barcodeText: "xyz" })),
  });
  const saved = await res.json();
  const userId = session.boot.user.id;
  assert.ok(store.db.prepare("SELECT id FROM records WHERE id=?").get(saved.id));
  store.deleteHistory(userId);
  assert.equal(store.db.prepare("SELECT id FROM records WHERE id=?").get(saved.id), undefined);
});
