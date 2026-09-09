# Wayline AI

Transportation planning, journey monitoring, and a grounded travel assistant, built with React, TypeScript, Vite, and Node.js/SQLite.

**Work-in-progress checkpoint — 8 September 2026, with a Stage A stabilization pass and a Stage B durable-jobs/web-push pass applied 9 September 2026.** This is the implementation so far, not a finished production release. All 105 requested features are accounted for in [FEATURE_STATUS.md](docs/FEATURE_STATUS.md). Sample routes, prices, crowding, reliability, and connection probabilities are illustrative, not verified schedules, quotes, or predictions.

The 9 September stabilization pass addressed every row in the roadmap's "Immediate code work before expanding scope" table: account-switch state leaks, hash routing consistency, an offline app-shell service worker, bundled OCR assets, local-timezone night-walking scoring, tracking-agency/provider separation, freshness recomputed per response instead of cached, Guardian's account scan no longer capped at 1,000, recovery alternatives checked against where the traveler can actually reach, recovery cost calculated incrementally instead of by whole-itinerary subtraction, honest per-capability integration-status reporting, and paginated MBTA feed fetches.

A follow-on pass the same day went further than stabilization: Guardian's periodic sweep is now a durable, leased, SQLite-backed job (`server/jobs.mjs`) that survives a process restart and backs off on repeated failure, instead of a bare `setInterval`; and push notifications (roadmap feature 89) are now genuinely implemented with real Web Push (RFC 8030/8291) -- a self-issued VAPID identity, a subscribe/unsubscribe control in Profile using the actual `PushManager` API, and delivery routed through that same durable job queue with per-subscription cleanup when a push service reports a subscription gone. Push defaults to a generic, non-identifying notification body; a `pushDetails` preference opts into the real alert text. All of this is code-level and unit/integration-tested (105 focused Node tests); none of it has been exercised against a real browser, a live push service, a live MBTA/OTP/GBFS feed, or real user accounts at scale -- see "Known gaps and remaining work" below for what that leaves outstanding.

## Quick start

Requires **Node.js 24 or newer** and npm. Python 3 is needed only for ZIP packaging. From this directory:

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4173`. A guest session is created automatically; registration is available in Profile. No default credentials or provider tickets are included. The included `standalone/` is a compiled checkpoint; rebuild after frontend changes. `start.sh` and `start.bat` also start the server. Opening the HTML file directly will not provide the required API.

### Development

Vite proxies `/api` to port 4174. Run in separate terminals:

```sh
# Terminal 1, POSIX shell
PORT=4174 npm start
# Terminal 2
npm run dev
```

On PowerShell use `$env:PORT="4174"; npm start` in terminal 1. Open the URL printed by Vite. `npm run preview` alone does not provide the API; use `npm start` to inspect the complete built app.

## Current features

| Area | Implemented behavior and limits |
| --- | --- |
| Planner | Sample multimodal corridors, comparison, group costs, budget/walking/transfer/accessibility filters, arrival deadlines, importance and risk preferences |
| Journey | Persisted plans, state transitions, timeline, leave-time estimates, connection graph, delay/accessibility/weather scenarios |
| Guardian | Periodic server evaluation paginated across every account with a journey/commute/pass (no longer capped at 1,000), running as a durable SQLite-backed job that survives a restart; persisted/deduplicated alerts fan out real web push deliveries to subscribed devices; prepared recovery alternatives checked against where the traveler can currently reach; in-app check-in reminders |
| Assistant | Grounded rules and preference extraction; optional Ollama intent classification with deterministic fallback |
| Wallet | Manually entered ticket details (including an optional self-reported paid amount used for recovery cost), passes, receipt exports, refund drafts; no issuance or money movement |
| Profile | Guest/registered accounts, travelers, contacts, preferences, favorites, data export and deletion |
| Sharing | Expiring, revocable journey links with explicit location scope; no rider background GPS collection |
| Commute | Recurring schedules, entered-fare comparisons, fare-cap calculations and renewal reminders |
| Transit Lab | Curated agency seed, optional MBTA, GTFS-RT, GBFS, weather, geocoder and routing adapters; MBTA vehicle/alert fetches now paginate with an explicit coverage-limited flag; integration-capability status distinguishes provider-required from unimplemented instead of one blanket "not connected" |
| Local data | Passphrase-encrypted journey packs in IndexedDB; an app-shell service worker (`public/sw.js`) now caches the shell for cold-start offline access, not yet verified in a real browser |
| Maps/boarding | MapLibre endpoint map, schematic sample routes, manual sign comparison, camera checklist and bundled OCR scanning (tesseract.js worker/WASM assets under `/ocr/`) |
| Analytics | Trip summaries, estimated budgets and carbon; no verified on-time dataset or actual purchased spend |

The six bidirectional sample corridors are Los Angeles–San Jose, Boston–New York, Indianapolis–Chicago, San Francisco–Oakland, Seattle–Bainbridge, and Los Angeles–LAX. Agency seed entries span 50 states and DC; this does not mean complete national routing or live feed coverage.

## Configuration

Copy `.env.example` to `.env` to override defaults. Never commit `.env`, `data/`, encryption keys, or passenger records.

| Variable | Purpose |
| --- | --- |
| `HOST`, `PORT` | Defaults to `127.0.0.1:4173` |
| `NODE_ENV` | Production mode requires the configuration below |
| `PUBLIC_ORIGIN` | Exact public HTTPS origin; required in production |
| `DATA_DIR` | Persistent SQLite directory; defaults to `data/` |
| `DATA_ENCRYPTION_KEY` | 64 hexadecimal characters (32 bytes); required in production |
| `SESSION_DAYS` | Server lifetime clamped to 1–30 days; cookie currently lasts 14 days |
| `ENABLE_EXTERNAL_FEEDS` | Enables optional external-feed access |
| `MBTA_API_KEY` | Optional MBTA credential |
| `OTP_GRAPHQL_URL` | Your OTP endpoint; legacy query needs validation against your deployed schema |
| `TRANSIT_SOURCES_FILE` | Approved GTFS-RT JSON configuration; accepted shape is in the adapter source |
| `GBFS_URL`, `GBFS_ALLOWED_HOSTS` | Approved discovery endpoint and allowed feed hosts |
| `GEOCODER_URL`, `GEOCODER_USER_AGENT` | Geocoder endpoint and identifiable contact string |
| `VALHALLA_URL` | Your street-routing endpoint |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Optional model server and model; configure both |
| `VAPID_SUBJECT` | Optional `mailto:`/`https:` contact URI for the Web Push VAPID identity; a placeholder is used if unset. The keypair itself is generated once and persisted under `DATA_DIR` (`.vapid-keys.json`), not configured via environment. |

Configured integrations are not certified operational. The checkpoint has not been verified with production provider accounts or routing graphs. See [FREE_STACK.md](docs/FREE_STACK.md).

## Architecture

| Path | Responsibility |
| --- | --- |
| `src/pages/` | Planner, Journey, Wallet, Trips, Inbox, Commute, Profile, Lab and Offline |
| `src/components/` | Journey cards/map, assistant, scanner and shared UI |
| `src/App.tsx`, `src/context.tsx`, `src/api.ts` | App shell, state and API client |
| `src/offline.ts` | Encrypted IndexedDB snapshots |
| `server/server.mjs` | HTTP, sessions, CSRF, request limits, security headers and static serving |
| `server/router.mjs`, `server/journey-routes.mjs` | API and journey operations |
| `server/domain/` | Search, risk, state and assistant rules |
| `server/store.mjs` | SQLite schema, encryption, ownership, versions, shares and retention |
| `server/guardian.mjs`, `server/records.mjs` | Periodic evaluation and validation |
| `server/jobs.mjs` | Durable, leased, retried job/outbox queue backing Guardian's sweep and push delivery |
| `server/push.mjs` | Web Push: VAPID identity, subscription delivery, privacy-conscious notification text |
| `server/adapters/providers.mjs`, `server/catalog.mjs` | Optional integrations and sample/curated data |
| `public/`, `standalone/` | Public assets and compiled frontend (`public/sw.js` also handles push display/click) |
| `infra/otp/` | Original OTP examples; validate before use |
| `tests/`, `scripts/` | Checkpoint tests and packaging |
| `docs/original/` | Unchanged original README, START_HERE and FREE_STACK |
| `docs/ORIGINAL_REQUIREMENTS.md` | Complete supplied feature document |

React is the maintained UI source. Vite regenerates `standalone/`; do not maintain a second UI there. SQLite holds users, sessions, versioned records, shares and audit events. Deployment currently assumes one application instance with persistent disk.

## API overview

Call `GET /api/bootstrap` first for a session cookie and CSRF token. Mutations require JSON and `x-csrf-token`. Cookies are HttpOnly and SameSite Strict, plus Secure in production.

| Group | Purpose |
| --- | --- |
| `/api/auth/*`, `/api/profile` | Registration, login, logout and profile |
| `/api/search`, `/api/journeys/*` | Search snapshots, owned saved journeys, scenarios, recovery and receipts |
| `/api/records/*` | Travelers, contacts, favorites, tickets, passes, commutes, reports and alerts |
| `/api/agent`, `/api/agent/history` | Assistant and conversation history |
| `/api/guardian/check` | Evaluate reminders and heuristics |
| `/api/fares/compare`, `/api/airport/deadline` | Explicit-input calculators |
| `/api/registry`, `/api/discovery`, `/api/stations/*` | Curated discovery and station guidance |
| `/api/mbta/*`, `/api/gtfs-rt/*`, `/api/gbfs`, `/api/weather` | Optional provider data |
| `/api/privacy/*`, `/api/shares`, `/api/audit` | Export, deletion, revocation and audit |
| `/api/analytics`, `/api/community`, `/api/operator` | Limited analytics and gated aggregates |
| `/api/health` | Service status |

Saving a journey requires an owned, unexpired search snapshot and an idempotency key. Versioned updates require the current version and return 409 on conflict. Booking/payment endpoints return a provider-required error; they do not simulate purchases.

## Security and privacy

Implemented controls include scrypt password hashing, hashed session/share tokens, AES-256-GCM record encryption, owner-scoped access, CSRF checks, request limits, validation, optimistic concurrency and expiring shares. Registration always grants the traveler role. Operator provisioning is unfinished; an unverified email never grants elevated access.

Development generates a local encryption key in `data/`. Securely back up the database and key; losing the key prevents decryption. SQLite metadata is not whole-disk encrypted. Key rotation, restore testing, SSO/MFA, email verification, password recovery, proxy-aware abuse controls and formal security review remain release work. This checkpoint is not approved for production passenger data.

Offline passphrases remain in the browser. Share links are bearer credentials. Contacts do not trigger SMS, email or emergency messages. Browser speech recognition may use browser-vendor services.

## Known gaps and remaining work

1. Validate routing/provider feeds against real, live traffic. This environment has no network path to MBTA/OTP/GBFS, so vehicle-to-journey matching (now keyed on canonical agency rather than routing provider) and MBTA's now-paginated vehicle/alert fetches (with an explicit `coverageLimited` flag instead of a silent one-page truncation) are unit-tested against mocked responses only, not exercised against a live feed. Fares, platforms and accessibility evidence remain unverified.
2. The offline app shell now has a service worker (`public/sw.js`) that caches the static shell and lets the SPA boot without a connection; it has not been tested with real browser interaction (install/activate lifecycle across browsers, storage limits, multi-tab behavior). Local encrypted IndexedDB packs are unaffected by this and were already present.
3. OCR assets are bundled under `/ocr/` (tesseract.js worker plus standard and SIMD WASM cores, with their licenses), and scan cancellation is reliable across unmount/navigation. First-use and failure-path behavior have not been tested in a real browser.
4. Account switching now clears user-scoped app state and in-flight requests on identity change; hash routing is consistent for the logo, offline view, and unknown routes; night-walking scoring uses each journey's own timezone instead of `getUTCHours`. Full localization and an accessibility (screen reader/keyboard) review remain outstanding.
5. Integrate authorized ticketing, seats, payments, holds, rebooking, claim submission and refunds.
6. Add observed reliability data and calibrated prediction models; current probabilities and sample crowding are heuristics.
7. Integration-capability reporting distinguishes features that need a commercial/contracted provider ("provider required": checkout, ticketing, seat inventory, payment tokenization, rebooking, refunds, flight inventory, SMS/email) from features with no implementation in this codebase ("unsupported": native watch clients, indoor maps/AR, EV live availability) from features that are now genuinely implemented and locally configured ("configured, not checked": remote push -- see item 11 below). Eleven of the twelve remain not built; actual family tracking is separately still deferred.
8. Guardian's periodic sweep paginates through every account with a journey, commute, or pass on file instead of capping at the first 1,000 accounts, and now runs as a durable, leased, SQLite-backed job (`server/jobs.mjs`) that survives a process restart and backs off on repeated failure, instead of a bare `setInterval`. It remains single-process, not distributed across multiple workers sharing one database -- multi-worker coordination is later-stage architectural work per the roadmap's "Durable background processing" guidance, and would need a different database engine than a single SQLite file.
9. Prepared trip recovery now checks that an alternative actually departs from a stop and time the traveler could reach (not just that it shares the destination and arrives in the future), and calculates an incremental cost — netting out legs retained from the original itinerary and using a self-reported paid ticket amount when one is on file — instead of subtracting two whole-itinerary estimates. There is still no provider transaction, no real exchange/refund-rule data, and no nonrefundable-amount data anywhere in this codebase; both remain draft-only, for-review calculations.
10. Add broader integration, end-to-end, migration, load, recovery and security checks. Browser interaction testing has not been performed for this checkpoint.
11. Web push (roadmap feature 89) is now genuinely implemented -- a self-issued VAPID identity, a subscribe/unsubscribe control in Profile using the real `PushManager` API, and delivery through the durable job queue with per-subscription cleanup on a 404/410 "gone" response -- but has only been unit/integration-tested against a mocked push service (`web-push`'s `sendNotification` mocked in `tests/push.test.mjs`). It has not been exercised end-to-end against a live browser and a real push service (Chrome/Firefox/etc.'s actual push infrastructure), and the service worker's `push`/`notificationclick` handlers (`public/sw.js`) have not been tested in a real browser either.

See [FEATURE_STATUS.md](docs/FEATURE_STATUS.md) for all 105 items. No organization-specific engineering or release standards were attached; these must be supplied before production approval.

## Checks and packaging

```sh
npm run check
npm run build
npm run package
```

`check` runs TypeScript and focused regression tests. `build` compiles the frontend. `package` creates `artifacts/wayline-ai-complete.zip`. [CHECKPOINT.md](docs/CHECKPOINT.md) records the actual results.

105 focused Node tests (`node --test tests/*.test.mjs`) cover stale signal labeling, integer-cent pricing, guarded state changes, record ownership, optimistic concurrency, share revocation, history deletion, CSRF, session rotation, traveler-only registration, local-timezone night-walking scoring, tracking-agency/provider matching, freshness recomputation, account-switch/navigation state, the offline service worker's caching logic (including that its push/notificationclick handlers are registered at the top level, not nested inside another listener), bundled OCR assets, the durable job queue's claim/lease/reclaim/backoff/dead-letter semantics, Guardian's paginated account scan running through that queue, real web push delivery with a mocked push service (subscription upsert, generic-vs-detailed notification text, 404/410 subscription cleanup), recovery-alternative reachability, recovery incremental cost, honest integration-capability statuses, and mocked MBTA feed pagination. They do not verify every feature or live integration -- see "Known gaps and remaining work" above.

The ZIP includes all source, lockfile, compiled frontend, public assets, tests, scripts, infrastructure examples, configuration template and current/original documentation. Dependencies, databases, secrets, Git metadata and caches are excluded. Restore dependencies with `npm ci`.

## Original materials and ownership

Original documents are unchanged under `docs/original/`. Their historical claims may not describe this checkpoint; this README and current status documents describe the new work. No application open-source license has been selected. Dependencies retain their own licenses; select a project license before public redistribution.
