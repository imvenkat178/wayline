import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { createApplication } from "../server/server.mjs";
import { cities } from "../server/catalog.mjs";
import { transitionOrder } from "../server/domain/commerce.mjs";
import { signWebhookPayload } from "../server/adapters/payments.mjs";

// Phase 5 (roadmap features 34, 39-41 groundwork, explicitly not live): exercises the sandbox
// order/quote/hold/confirm/exchange/reconcile state machine end-to-end over real HTTP, the same
// way tests/auth-router.test.mjs exercises the MFA/session/recovery endpoints. Nothing here
// talks to a real carrier or payment processor -- see server/adapters/payments.mjs's own
// header comment for what "sandbox" means.

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

function headers({ cookie, csrf }, extra = {}) {
  return { "content-type": "application/json", cookie, "x-csrf-token": csrf, ...extra };
}

const [cityA, cityB] = cities;

async function getQuote(base, session, fareCents = 4200) {
  const res = await fetch(base + "/api/commerce/quotes", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ from: cityA.id, to: cityB.id, fareCents }),
  });
  assert.equal(res.status, 201);
  return res.json();
}

async function placeOrder(base, session, quote, idemKey = crypto.randomUUID()) {
  const res = await fetch(base + "/api/commerce/orders", {
    method: "POST",
    headers: headers(session, { "idempotency-key": idemKey }),
    body: JSON.stringify({ quoteId: quote.id, passenger: "Alex Traveler" }),
  });
  return res;
}

test("a sandbox quote is a synthetic, clearly-labeled price breakdown, never a real fare", async (t) => {
  const { base } = await withServer(t);
  const session = await freshSession(base);
  const quote = await getQuote(base, session, 5000);
  assert.equal(quote.sandbox, true);
  assert.equal(quote.fareCents, 5000);
  assert.equal(quote.totalCents, quote.fareCents + quote.feeCents);
  assert.ok(quote.id);
  assert.ok(Date.parse(quote.expiresAt) > Date.now());
});

test("a quote requires two different, supported endpoints", async (t) => {
  const { base } = await withServer(t);
  const session = await freshSession(base);
  const res = await fetch(base + "/api/commerce/quotes", {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ from: cityA.id, to: cityA.id, fareCents: 1000 }),
  });
  assert.equal(res.status, 400);
});

test("placing an order authorizes a sandbox payment and starts in HELD", async (t) => {
  const { base } = await withServer(t);
  const session = await freshSession(base);
  const quote = await getQuote(base, session);
  const res = await placeOrder(base, session, quote);
  assert.equal(res.status, 201);
  const order = await res.json();
  assert.equal(order.state, "HELD");
  assert.equal(order.authorization.sandbox, true);
  assert.equal(order.passenger, "Alex Traveler");
});

test("order creation is idempotent: same key + same request replays the same order", async (t) => {
  const { base } = await withServer(t);
  const session = await freshSession(base);
  const quote = await getQuote(base, session);
  const key = crypto.randomUUID();
  const first = await (await placeOrder(base, session, quote, key)).json();
  const second = await (await placeOrder(base, session, quote, key)).json();
  assert.equal(first.id, second.id);
  assert.equal(first.authorization.id, second.authorization.id); // not re-authorized
});

test("reusing an idempotency key with a different request is rejected", async (t) => {
  const { base } = await withServer(t);
  const session = await freshSession(base);
  const key = crypto.randomUUID();
  const quoteOne = await getQuote(base, session, 3000);
  const quoteTwo = await getQuote(base, session, 9000);
  const first = await placeOrder(base, session, quoteOne, key);
  assert.equal(first.status, 201);
  const res = await fetch(base + "/api/commerce/orders", {
    method: "POST",
    headers: headers(session, { "idempotency-key": key }),
    body: JSON.stringify({ quoteId: quoteTwo.id, passenger: "Someone Else" }),
  });
  assert.equal(res.status, 409);
});

test("confirming an order captures a sandbox payment and moves it to CONFIRMED", async (t) => {
  const { base } = await withServer(t);
  const session = await freshSession(base);
  const quote = await getQuote(base, session);
  const order = await (await placeOrder(base, session, quote)).json();
  const res = await fetch(base + `/api/commerce/orders/${order.id}/confirm`, {
    method: "POST",
    headers: headers(session),
  });
  assert.equal(res.status, 200);
  const confirmed = await res.json();
  assert.equal(confirmed.state, "CONFIRMED");
  assert.equal(confirmed.capture.sandbox, true);
});

test("confirming twice is rejected as an invalid transition (CONFIRMED has no CONFIRMED edge)", async (t) => {
  const { base } = await withServer(t);
  const session = await freshSession(base);
  const quote = await getQuote(base, session);
  const order = await (await placeOrder(base, session, quote)).json();
  await fetch(base + `/api/commerce/orders/${order.id}/confirm`, {
    method: "POST",
    headers: headers(session),
  });
  const res = await fetch(base + `/api/commerce/orders/${order.id}/confirm`, {
    method: "POST",
    headers: headers(session),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.code, "INVALID_TRANSITION");
});

test("cancelling a held (unconfirmed) order issues no refund; cancelling a confirmed one does", async (t) => {
  const { base } = await withServer(t);
  const session = await freshSession(base);

  const heldQuote = await getQuote(base, session);
  const held = await (await placeOrder(base, session, heldQuote)).json();
  const cancelledHeld = await (
    await fetch(base + `/api/commerce/orders/${held.id}/cancel`, {
      method: "POST",
      headers: headers(session),
    })
  ).json();
  assert.equal(cancelledHeld.state, "CANCELLED");
  assert.equal(cancelledHeld.refund, null);

  const confirmedQuote = await getQuote(base, session);
  const confirmedOrder = await (await placeOrder(base, session, confirmedQuote)).json();
  await fetch(base + `/api/commerce/orders/${confirmedOrder.id}/confirm`, {
    method: "POST",
    headers: headers(session),
  });
  const cancelledConfirmed = await (
    await fetch(base + `/api/commerce/orders/${confirmedOrder.id}/cancel`, {
      method: "POST",
      headers: headers(session),
    })
  ).json();
  assert.equal(cancelledConfirmed.state, "CANCELLED");
  assert.equal(cancelledConfirmed.refund.sandbox, true);
});

test("exchanging a confirmed order attaches a new quote and moves it to EXCHANGED", async (t) => {
  const { base } = await withServer(t);
  const session = await freshSession(base);
  const quote = await getQuote(base, session);
  const order = await (await placeOrder(base, session, quote)).json();
  await fetch(base + `/api/commerce/orders/${order.id}/confirm`, {
    method: "POST",
    headers: headers(session),
  });
  const newQuote = await getQuote(base, session, 7500);
  const res = await fetch(base + `/api/commerce/orders/${order.id}/exchange`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ quoteId: newQuote.id }),
  });
  assert.equal(res.status, 200);
  const exchanged = await res.json();
  assert.equal(exchanged.state, "EXCHANGED");
  assert.equal(exchanged.quote.id, newQuote.id);
});

test("one account cannot see or act on another account's order", async (t) => {
  const { base } = await withServer(t);
  const alice = await freshSession(base);
  const bob = await freshSession(base);
  const quote = await getQuote(base, alice);
  const order = await (await placeOrder(base, alice, quote)).json();

  const getRes = await fetch(base + "/api/commerce/orders", { headers: headers(bob) });
  const bobOrders = await getRes.json();
  assert.equal(
    bobOrders.find((o) => o.id === order.id),
    undefined,
  );

  const confirmRes = await fetch(base + `/api/commerce/orders/${order.id}/confirm`, {
    method: "POST",
    headers: headers(bob),
  });
  assert.equal(confirmRes.status, 404);
});

test("the domain-level state machine refuses CONFIRMED without an authorization and RECONCILED without a settlement", () => {
  const held = { state: "HELD" };
  assert.throws(() => transitionOrder(held, "CONFIRMED"), {
    status: 409,
    code: "PAYMENT_REQUIRED",
  });
  const confirmed = transitionOrder({ ...held, authorization: { id: "x" } }, "CONFIRMED");
  assert.equal(confirmed.state, "CONFIRMED");
  assert.throws(() => transitionOrder(confirmed, "RECONCILED"), {
    status: 409,
    code: "SETTLEMENT_REQUIRED",
  });
});

test("a correctly signed webhook reconciles the order it references, with no session or CSRF at all", async (t) => {
  const { base } = await withServer(t);
  const session = await freshSession(base);
  const quote = await getQuote(base, session);
  const order = await (await placeOrder(base, session, quote)).json();
  await fetch(base + `/api/commerce/orders/${order.id}/confirm`, {
    method: "POST",
    headers: headers(session),
  });

  const event = { orderId: order.id, settlementId: "sandbox_settle_1", status: "settled" };
  const raw = JSON.stringify(event);
  const res = await fetch(base + "/api/commerce/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-sandbox-signature": signWebhookPayload(raw) },
    body: raw,
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.state, "RECONCILED");

  const fetched = await (
    await fetch(base + "/api/commerce/orders", { headers: headers(session) })
  ).json();
  assert.equal(fetched.find((o) => o.id === order.id).state, "RECONCILED");
});

test("a webhook with a bad signature is rejected and never reconciles anything", async (t) => {
  const { base } = await withServer(t);
  const session = await freshSession(base);
  const quote = await getQuote(base, session);
  const order = await (await placeOrder(base, session, quote)).json();
  await fetch(base + `/api/commerce/orders/${order.id}/confirm`, {
    method: "POST",
    headers: headers(session),
  });

  const raw = JSON.stringify({ orderId: order.id, settlementId: "s1" });
  const res = await fetch(base + "/api/commerce/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-sandbox-signature": "0".repeat(64) },
    body: raw,
  });
  assert.equal(res.status, 401);

  const fetched = await (
    await fetch(base + "/api/commerce/orders", { headers: headers(session) })
  ).json();
  assert.equal(fetched.find((o) => o.id === order.id).state, "CONFIRMED");
});

test("a well-signed webhook for a malformed event (no orderId) is rejected before touching any order", async (t) => {
  const { base } = await withServer(t);
  const raw = JSON.stringify({ settlementId: "s1" });
  const res = await fetch(base + "/api/commerce/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-sandbox-signature": signWebhookPayload(raw) },
    body: raw,
  });
  assert.equal(res.status, 400);
});

test("deleteHistory purges sandbox orders and quotes along with the rest of a user's history", async (t) => {
  const { base, store } = await withServer(t);
  const session = await freshSession(base);
  const quote = await getQuote(base, session);
  const order = await (await placeOrder(base, session, quote)).json();
  const userId = session.boot.user.id;

  assert.ok(store.db.prepare("SELECT id FROM records WHERE id=?").get(order.id));
  store.deleteHistory(userId);
  assert.equal(store.db.prepare("SELECT id FROM records WHERE id=?").get(order.id), undefined);
  assert.equal(store.db.prepare("SELECT id FROM records WHERE id=?").get(quote.id), undefined);
});
