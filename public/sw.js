// Wayline app-shell service worker.
//
// Scope, deliberately: this caches the STATIC app shell (index.html, the manifest, the icon,
// and the hashed JS/CSS Vite emits) so the app can boot without a network connection after it
// has been opened online at least once. It never caches anything under /api/ -- all real
// journey/ticket/profile data already has its own purpose-built, encrypted, user-passphrase-
// protected store (see src/offline.ts and IndexedDB "wayline-offline-v2"), and CacheStorage is
// a much weaker place to put private per-user responses: it is unauthenticated, shared by any
// script on this origin, and not encrypted at rest the way an offline pack is. When the network
// is unreachable, the shell still loads from cache, React still boots, and the app's own
// existing "can't connect" screen (see api.ts's ApiError and App.tsx's error state) takes over
// and offers to open a saved offline pack -- this file's only job is making sure that screen is
// reachable at all without a connection, not reimplementing it.
//
// R08: CACHE_VERSION is rewritten by scripts/build-sw.mjs (run automatically after `vite build`
// -- see package.json's "build" script) to a hash of the actual build output, so every real
// deploy gets a genuinely new cache name and `activate`'s cleanup below actually has something
// to clean up. The literal value here only ever ships if that step is skipped -- it's never
// registered under `vite dev` (see main.tsx), so this default is effectively unreachable in
// practice, not a silent fallback to worry about.
const CACHE_VERSION = "wayline-shell-v1";

// Entry points whose URL does NOT change between builds -- always safe to precache regardless
// of build content.
const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/theme-init.js"];

// R08: the actual hashed entry JS/CSS (and their direct static dependencies) this build's
// index.html references, rewritten by scripts/build-sw.mjs from the real build output. Before
// this fix, install() precached only SHELL_URLS above and relied on the fetch handler's
// cache-first branch to opportunistically catch these files on some LATER request -- which a
// first visit that closes its only tab before making one never gets, so "open once online, close
// every tab, go offline" could fail to boot even though install() reported success. Left empty
// in this source template (also what `vite dev` would serve unbuilt, though the SW is never
// registered there); an empty list here just means install() falls back to SHELL_URLS alone,
// same as this file's behavior always was before this fix -- not a crash, and not silently
// wrong, since the fetch handler's cache-first branch below still opportunistically fills in
// whatever a page actually requests.
const BUILD_ASSETS = [];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // cache.addAll is atomic: if any single URL fails, NOTHING from this call is written to
      // the cache -- so a partially-precached, internally inconsistent shell can never exist.
      // The catch() below only stops that failure from making install() itself reject (which
      // would abort activation and leave the PREVIOUS service worker, if any, still in control
      // -- itself a reasonable outcome for e.g. a first install attempted while offline); it
      // does not paper over a partial cache, because there isn't one to paper over.
      .then((cache) => cache.addAll([...SHELL_URLS, ...BUILD_ASSETS]))
      .catch(() => {}),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return /\.(?:js|css|svg|png|jpg|jpeg|webp|woff2?|ttf|ico|webmanifest|wasm)$/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only ever handle same-origin GETs. Cross-origin requests (map tiles, provider APIs called
  // directly from the browser, etc.) and non-GET requests pass straight through, untouched.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Never intercept the API. Every response here can carry private, per-account data (journeys,
  // tickets, profile, alerts) that must not be written into the shared CacheStorage.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // Network-first for page navigations, so a normal online load always gets the current
    // shell (and any server-side redirect/behavior) rather than a possibly-stale cached copy.
    // Only fall back to the cached shell -- which boots the SPA and lets its own offline/error
    // screen take over -- when the network is genuinely unreachable.
    //
    // R08: a successful response is also written back into the cache under "/index.html" --
    // before this fix, the cached copy was whatever install() precached at CACHE_VERSION's
    // last bump and was never refreshed by an ordinary successful visit, so the offline
    // fallback path could serve stale markup (referencing since-evicted hashed asset URLs from
    // an old build) between deploys that didn't happen to bump CACHE_VERSION. This keeps it
    // current on every online visit, independent of that version bump.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put("/index.html", copy));
          }
          return response;
        })
        .catch(() => caches.match("/index.html").then((cached) => cached ?? caches.match("/"))),
    );
    return;
  }

  if (isStaticAsset(url)) {
    // Cache-first: Vite's hashed filenames are content-addressed and immutable, so a cache hit
    // is always correct and a miss is cached for next time (including offline-after-first-use).
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

// R08: lets the page ask "has this build's app shell actually finished precaching," not just
// "is a service worker registered/active" -- those are different moments (install() is
// asynchronous and can still be running, or can have failed and fallen back to SHELL_URLS
// alone -- see install() above). src/serviceWorker.ts's shellReady() sends this and waits for
// the reply; Journey.tsx's offline-pack save flow uses it to avoid telling someone their trip
// is safe to open offline when the shell that boots the app in the first place isn't actually
// cached yet.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "SHELL_STATUS") return;
  const port = event.ports[0];
  if (!port) return;
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then(async (cache) => {
        const required = [...SHELL_URLS, ...BUILD_ASSETS];
        const matches = await Promise.all(required.map((u) => cache.match(u)));
        port.postMessage({ type: "SHELL_STATUS", ready: matches.every(Boolean) });
      })
      .catch(() => port.postMessage({ type: "SHELL_STATUS", ready: false })),
  );
});

// Push notifications (feature 89; see server/push.mjs). The payload arrives as plain JSON at
// this layer -- Web Push's own transport encryption (RFC 8291) already protects it in transit,
// and by design the server sends only a generic phrase unless the account has opted into
// pushDetails (see push.mjs's GENERIC_BODY), so there is little left to protect at rest even in
// a notification the OS itself is about to display on screen.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not JSON, or no payload at all -- fall through to the generic defaults below instead of
    // showing nothing, which some browsers penalize a subscription for repeatedly doing.
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Wayline alert";
  const body = typeof data.body === "string" && data.body ? data.body : "Open Wayline for details.";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon.svg",
      badge: "/icon.svg",
      // Collapses repeat pushes about the same alert into one notification instead of stacking
      // duplicates (e.g. a retried delivery after a transient failure).
      tag: typeof data.alertId === "string" ? data.alertId : undefined,
      data,
    }),
  );
});

// The app is a single-page, hash-routed SPA (see src/routes.ts) with no per-alert deep link, so
// a click always focuses (or opens) the app at its inbox, where the alert that triggered this
// notification is listed -- not a URL parsed from the notification payload.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = "/#inbox";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          if ("navigate" in client) client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
