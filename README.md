# Wayline AI

Transportation planning, journey monitoring, and a grounded travel assistant, built with React, TypeScript, Vite, and Node.js/SQLite.

**Work-in-progress checkpoint — 8 September 2026.** This is the implementation so far, not a finished production release. All 105 requested features are accounted for in [FEATURE_STATUS.md](docs/FEATURE_STATUS.md). Sample routes, prices, crowding, reliability, and connection probabilities are illustrative, not verified schedules, quotes, or predictions.

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
| Guardian | Periodic server evaluation, persisted/deduplicated alerts, prepared recovery alternatives, in-app check-in reminders |
| Assistant | Grounded rules and preference extraction; optional Ollama intent classification with deterministic fallback |
| Wallet | Manually entered ticket details, passes, receipt exports, refund drafts; no issuance or money movement |
| Profile | Guest/registered accounts, travelers, contacts, preferences, favorites, data export and deletion |
| Sharing | Expiring, revocable journey links with explicit location scope; no rider background GPS collection |
| Commute | Recurring schedules, entered-fare comparisons, fare-cap calculations and renewal reminders |
| Transit Lab | Curated agency seed, optional MBTA, GTFS-RT, GBFS, weather, geocoder and routing adapters |
| Local data | Passphrase-encrypted journey packs in IndexedDB; cold-start offline shell remains unfinished |
| Maps/boarding | MapLibre endpoint map, schematic sample routes, manual sign comparison and camera checklist |
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
| `server/adapters/providers.mjs`, `server/catalog.mjs` | Optional integrations and sample/curated data |
| `public/`, `standalone/` | Public assets and compiled frontend |
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

1. Validate routing/provider feeds, vehicle-to-journey matching, cached timestamps, fares, platforms and accessibility evidence.
2. Complete the service worker and offline app shell. Local encrypted packs alone do not provide cold-start offline access.
3. Bundle OCR worker/WASM assets under `/ocr/`. Manual entry works; packaged photo OCR is unfinished.
4. Complete account-switch UI cleanup, navigation details, local-time night-walking scoring, full localization and accessibility review.
5. Integrate authorized ticketing, seats, payments, holds, rebooking, claim submission and refunds.
6. Add observed reliability data and calibrated prediction models; current probabilities and sample crowding are heuristics.
7. Complete remote push, native watch clients, indoor maps/AR, actual family tracking, flight and EV integrations.
8. Add broader integration, end-to-end, migration, load, recovery and security checks. Browser interaction testing has not been performed for this checkpoint.

See [FEATURE_STATUS.md](docs/FEATURE_STATUS.md) for all 105 items. No organization-specific engineering or release standards were attached; these must be supplied before production approval.

## Checks and packaging

```sh
npm run check
npm run build
npm run package
```

`check` runs TypeScript and focused regression tests. `build` compiles the frontend. `package` creates `artifacts/wayline-ai-complete.zip`. [CHECKPOINT.md](docs/CHECKPOINT.md) records the actual results.

Tests cover stale signal labeling, integer-cent pricing, guarded state changes, record ownership, optimistic concurrency, share revocation, history deletion, CSRF, session rotation and traveler-only registration. They do not verify every feature or live integration.

The ZIP includes all source, lockfile, compiled frontend, public assets, tests, scripts, infrastructure examples, configuration template and current/original documentation. Dependencies, databases, secrets, Git metadata and caches are excluded. Restore dependencies with `npm ci`.

## Original materials and ownership

Original documents are unchanged under `docs/original/`. Their historical claims may not describe this checkpoint; this README and current status documents describe the new work. No application open-source license has been selected. Dependencies retain their own licenses; select a project license before public redistribution.
