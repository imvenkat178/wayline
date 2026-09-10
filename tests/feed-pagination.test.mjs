import test from "node:test";
import assert from "node:assert/strict";
import { mbtaPaginated } from "../server/adapters/providers.mjs";

// Builds a minimal fetch Response stand-in that fetchBounded() can consume: `.ok`, a
// `.headers.get()` that reports no content-length (so the size guard is skipped), and `.body`
// as an async-iterable of Buffer chunks, matching what `for await (const b of r.body)` expects.
function jsonResponse(payload) {
  const bytes = Buffer.from(JSON.stringify(payload));
  return {
    ok: true,
    headers: { get: () => null },
    body: {
      async *[Symbol.asyncIterator]() {
        yield bytes;
      },
    },
  };
}

function mockPages(t, pages) {
  let call = 0;
  t.mock.method(globalThis, "fetch", async () => {
    const page = pages[call] ?? { data: [] };
    call++;
    return jsonResponse(page);
  });
  return () => call;
}

test("mbtaPaginated: a single short page is not marked coverage-limited", async (t) => {
  const callCount = mockPages(t, [{ data: [{ id: "1" }, { id: "2" }] }]);
  const { rows, coverageLimited } = await mbtaPaginated("/vehicles", { limit: 5, maxPages: 3 });
  assert.deepEqual(
    rows.map((r) => r.id),
    ["1", "2"],
  );
  assert.equal(coverageLimited, false);
  assert.equal(callCount(), 1);
});

test("mbtaPaginated: follows a full page with a partial one and collects both, in order", async (t) => {
  const callCount = mockPages(t, [{ data: [{ id: "1" }, { id: "2" }] }, { data: [{ id: "3" }] }]);
  const { rows, coverageLimited } = await mbtaPaginated("/vehicles", { limit: 2, maxPages: 5 });
  assert.deepEqual(
    rows.map((r) => r.id),
    ["1", "2", "3"],
  );
  assert.equal(coverageLimited, false);
  assert.equal(callCount(), 2);
});

test("mbtaPaginated: reports coverageLimited when every page up to the cap is full", async (t) => {
  const callCount = mockPages(t, [
    { data: [{ id: "1" }, { id: "2" }] },
    { data: [{ id: "3" }, { id: "4" }] },
    { data: [{ id: "5" }, { id: "6" }] },
  ]);
  const { rows, coverageLimited } = await mbtaPaginated("/vehicles", { limit: 2, maxPages: 3 });
  assert.equal(rows.length, 6);
  assert.equal(coverageLimited, true);
  // Never fetches a page beyond the cap, even though the feed clearly has more.
  assert.equal(callCount(), 3);
});

test("mbtaPaginated: an empty first page yields no rows and is not coverage-limited", async (t) => {
  mockPages(t, [{ data: [] }]);
  const { rows, coverageLimited } = await mbtaPaginated("/vehicles", { limit: 5, maxPages: 3 });
  assert.deepEqual(rows, []);
  assert.equal(coverageLimited, false);
});
