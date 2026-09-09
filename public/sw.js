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
// Bump CACHE_VERSION on any change to this file's caching strategy (not on every app deploy --
// hashed asset URLs already change per build, so stale JS/CSS is naturally never served under
// the wrong content; this version exists to let `activate` drop a previous strategy's cache).
const CACHE_VERSION = "wayline-shell-v1";

// Entry points whose URL does NOT change between builds -- these are what `install` can
// actually precache ahead of time. The hashed JS/CSS/asset files Vite emits change name every
// build and are picked up opportunistically by the fetch handler below the first time each is
// requested (safe: a given hashed filename's content is immutable for its lifetime).
const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => {
        // A precache failure (e.g. first install while already offline) must not block
        // installation entirely -- the fetch handler will still opportunistically cache
        // whatever does succeed once the app is used online.
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return /\.(?:js|css|svg|png|jpg|jpeg|webp|woff2?|ttf|ico|webmanifest)$/.test(url.pathname);
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
    event.respondWith(
      fetch(request).catch(
        () => caches.match("/index.html").then((cached) => cached ?? caches.match("/")),
      ),
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
