import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const swPath = fileURLToPath(new URL("../public/sw.js", import.meta.url));
const sw = readFileSync(swPath, "utf8");

test("public/sw.js is syntactically valid JavaScript", () => {
  // node --check only parses the file; it does not execute it, so ServiceWorker-only globals
  // (self, caches, addEventListener) are never referenced at runtime here -- this just catches
  // a typo that would otherwise only surface as a silent registration failure in a real browser.
  assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", swPath]));
});

test("public/sw.js never intercepts /api/ requests", () => {
  // The most important safety property of this file: private, per-account API responses must
  // never be written into CacheStorage. Assert the guard exists and precedes any caches.put/
  // cache.put call, rather than just hoping no one removes it later.
  const guardIndex = sw.indexOf('pathname.startsWith("/api/")');
  assert.notEqual(guardIndex, -1, "expected an explicit /api/ exclusion guard");
  const firstCachePut = sw.search(/cache\.put|caches\.put/);
  assert.ok(
    firstCachePut === -1 || guardIndex < firstCachePut,
    "the /api/ guard must run before any response is cached",
  );
});

test("public/sw.js registers install, activate and fetch handlers with a versioned cache", () => {
  assert.match(sw, /addEventListener\(\s*"install"/);
  assert.match(sw, /addEventListener\(\s*"activate"/);
  assert.match(sw, /addEventListener\(\s*"fetch"/);
  assert.match(sw, /const CACHE_VERSION\s*=\s*"[^"]+"/);
  // activate must clean up caches from a previous CACHE_VERSION, or an old strategy's cached
  // responses (and quota) would accumulate forever across deploys.
  assert.match(sw, /caches\.delete/);
});

test("public/sw.js falls back to the cached shell for navigations, not a network-only request", () => {
  assert.match(sw, /request\.mode === "navigate"/);
  assert.match(sw, /caches\.match\(\s*"\/index\.html"\s*\)/);
});

test("public/sw.js treats .wasm as a cacheable static asset, so the bundled OCR core works offline", () => {
  assert.match(sw, /wasm/);
});

test("main.tsx only registers the service worker outside vite dev mode", () => {
  const main = readFileSync(fileURLToPath(new URL("../src/main.tsx", import.meta.url)), "utf8");
  assert.match(main, /serviceWorker/);
  assert.match(main, /!import\.meta\.env\.DEV/);
  assert.match(main, /register\("\/sw\.js"\)/);
});

test("public/sw.js registers push and notificationclick handlers at the top level, not nested inside fetch's handler", () => {
  // Regression guard: these two listeners were briefly (mid-edit) registered as statements
  // inside the fetch handler's own callback body -- syntactically valid, since it's just a
  // function call, but semantically wrong: self.addEventListener("push", ...) would then only
  // run the first time a fetch event fired, not once at worker startup. The fetch handler's own
  // isStaticAsset branch is the last thing inside its body, so both new listeners must be
  // registered textually after it.
  const fetchBodyMarker = sw.indexOf("if (isStaticAsset(url))");
  const pushIndex = sw.indexOf('addEventListener("push"');
  const clickIndex = sw.indexOf('addEventListener("notificationclick"');
  assert.notEqual(fetchBodyMarker, -1);
  assert.notEqual(pushIndex, -1);
  assert.notEqual(clickIndex, -1);
  assert.ok(pushIndex > fetchBodyMarker, "push listener must be registered after fetch's body");
  assert.ok(
    clickIndex > fetchBodyMarker,
    "notificationclick listener must be registered after fetch's body",
  );
});

test("public/sw.js's push handler shows a notification and its click handler focuses or opens the app", () => {
  assert.match(sw, /addEventListener\(\s*"push"/);
  assert.match(sw, /registration\.showNotification/);
  assert.match(sw, /addEventListener\(\s*"notificationclick"/);
  assert.match(sw, /notification\.close\(\)/);
  assert.match(sw, /clients\.openWindow/);
});
