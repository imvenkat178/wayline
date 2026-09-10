import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// R08: this codebase has no React-component-rendering or Service-Worker-runtime test harness
// (see tests/service-worker.test.mjs's own note), so -- matching that file's established
// approach -- the parts of R08 that aren't pure functions (public/sw.js's new message handler
// and write-through cache, src/main.tsx's registration timing, Journey.tsx's confirmation
// gating) are covered here as direct source-text assertions. These can't prove the runtime
// behavior in a real browser, but they do prove the wiring exists and catch it being silently
// removed or pointed elsewhere.

const swSource = readFileSync(fileURLToPath(new URL("../public/sw.js", import.meta.url)), "utf8");
const mainSource = readFileSync(fileURLToPath(new URL("../src/main.tsx", import.meta.url)), "utf8");
const journeySource = readFileSync(
  fileURLToPath(new URL("../src/pages/Journey.tsx", import.meta.url)),
  "utf8",
);
const serviceWorkerSource = readFileSync(
  fileURLToPath(new URL("../src/serviceWorker.ts", import.meta.url)),
  "utf8",
);

test("public/sw.js declares a BUILD_ASSETS template slot for scripts/build-sw.mjs to fill in", () => {
  assert.match(swSource, /const BUILD_ASSETS = \[\];/);
  assert.match(swSource, /cache\.addAll\(\[\.\.\.SHELL_URLS, \.\.\.BUILD_ASSETS\]\)/);
});

test("public/sw.js refreshes the cached /index.html on every successful online navigation (write-through), not only at install", () => {
  const navigateBranch = swSource.slice(
    swSource.indexOf('request.mode === "navigate"'),
    swSource.indexOf("if (isStaticAsset(url))"),
  );
  assert.match(navigateBranch, /response\.ok/);
  assert.match(navigateBranch, /cache\.put\("\/index\.html", copy\)/);
});

test("public/sw.js answers a SHELL_STATUS message by checking every required URL is actually cached", () => {
  const listenerIndex = swSource.indexOf('addEventListener("message"');
  assert.notEqual(listenerIndex, -1, "expected a message event listener");
  const listenerBody = swSource.slice(listenerIndex, swSource.indexOf('addEventListener("push"'));
  assert.match(listenerBody, /event\.data\?\.type !== "SHELL_STATUS"/);
  assert.match(listenerBody, /\[\.\.\.SHELL_URLS, \.\.\.BUILD_ASSETS\]/);
  assert.match(listenerBody, /matches\.every\(Boolean\)/);
  assert.match(
    listenerBody,
    /port\.postMessage\(\{ type: "SHELL_STATUS", ready: (?:false|matches\.every\(Boolean\))/,
  );
});

test("public/sw.js's message listener is registered before the push/notificationclick handlers (ordering the existing service-worker test suite also checks)", () => {
  const messageIndex = swSource.indexOf('addEventListener("message"');
  const pushIndex = swSource.indexOf('addEventListener("push"');
  const clickIndex = swSource.indexOf('addEventListener("notificationclick"');
  assert.ok(messageIndex > 0);
  assert.ok(messageIndex < pushIndex);
  assert.ok(pushIndex < clickIndex);
});

test("src/serviceWorker.ts's shellReady() asks the ACTIVE worker via a real MessageChannel, with a timeout so a stuck worker can't hang the caller forever", () => {
  assert.match(serviceWorkerSource, /navigator\.serviceWorker\.ready/);
  assert.match(serviceWorkerSource, /registration\?\.active/);
  assert.match(serviceWorkerSource, /new MessageChannel\(\)/);
  assert.match(
    serviceWorkerSource,
    /worker\.postMessage\(\{ type: "SHELL_STATUS" \}, \[channel\.port2\]\)/,
  );
  assert.match(serviceWorkerSource, /setTimeout\(\(\) => resolve\(false\)/);
});

test("src/main.tsx registers the service worker immediately, not deferred to the window load event", () => {
  assert.match(mainSource, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.doesNotMatch(mainSource, /addEventListener\("load"/);
  assert.match(mainSource, /!import\.meta\.env\.DEV/);
});

test("Journey.tsx's offline-save confirmation is gated on shellReady(), so it never promises offline-readiness the cache doesn't back up yet", () => {
  const offlineModalIndex = journeySource.indexOf("function OfflineModal");
  assert.notEqual(offlineModalIndex, -1, "expected an OfflineModal component");
  const modalBody = journeySource.slice(offlineModalIndex);
  assert.match(
    modalBody,
    /import\s*\{\s*shellReady\s*\}\s*from\s*"\.\.\/serviceWorker"|shellReady/,
  );
  assert.match(modalBody, /await saveOffline\(/);
  // shellReady() must be awaited AFTER saveOffline() succeeds, and the two branches of its
  // result must produce genuinely different messages -- a single shared message would defeat
  // the point of checking at all.
  const saveIndex = modalBody.indexOf("await saveOffline(");
  const shellReadyCallIndex = modalBody.indexOf("await shellReady()");
  assert.ok(shellReadyCallIndex > saveIndex);
  assert.match(modalBody, /Encrypted offline pack saved\. Remember your passphrase\./);
  assert.match(modalBody, /hasn't finished preparing the app for offline use/);
});

test("src/main.tsx imports shellReady only where it's used (Journey.tsx), keeping the offline-readiness check out of the app-boot path itself", () => {
  assert.doesNotMatch(mainSource, /shellReady/);
  assert.match(journeySource, /import \{ shellReady \} from "\.\.\/serviceWorker"/);
});
