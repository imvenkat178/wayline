# Wayline AI

Wayline is a transportation planner and AI trip assistant built with React, TypeScript, Vite, Node.js and SQLite. Its product direction is a conversational workspace where travelers compare and customize complete trips through chat and interactive itinerary cards.

**Current implementation:** a Boston/MBTA transit pilot with reviewed trip changes, journey monitoring, recovery alternatives, itinerary PDFs, encrypted offline packs and encrypted database backups.

**Main product feature:** plan, compare, customize and manage an entire bus, train or flight trip in a continuing LLM conversation. Show cheapest, fastest, more reliable and recommended options in that workspace; let travelers edit individual legs, preserve preferences, compare scenarios and prepare recovery options. Persistent trip drafts, rich follow-up editing, flight shopping, complete live multimodal fares and carrier ticket issuance remain planned work.

## Start here

- [Conversational trip workspace — clarified direction and next steps](docs/CONVERSATIONAL_TRIP_WORKSPACE.md)
- [Current review and verified results — 12 September 2026](docs/REVIEW_2026-09-12.md)
- [Supporting multimodal pricing, flight and recovery implementation plan](docs/CHEAPEST_MULTIMODAL_TRAVEL_PLAN.md)
- [Boston core launch, live evidence and restore procedures](docs/CORE_LAUNCH.md)
- [Feature status and the original 105-feature register](docs/FEATURE_STATUS.md)
- [Original requirements](docs/ORIGINAL_REQUIREMENTS.md) and [original supplied documents](docs/original/)
- [Architecture decisions](docs/adr/README.md)
- [Archived README and earlier implementation history](README_HISTORY.md)

The archived README is preserved in full. Its dated validation counts, provider limitations, license statements and implementation claims may have been superseded. Use the current review and capability descriptions below for the present state.

## Current capabilities and limits

| Area | Implemented foundation | Remaining boundary |
| --- | --- | --- |
| Local transit | Boston station lookup, OTP routes and geometry, MBTA predictions/vehicles/disruptions, NWS weather | Boston coverage; live route fares remain unknown; no carrier tickets issued |
| AI and trip actions | Full Assistant page with chat/cards/map, LangGraph, optional Ollama, private travel MCP tools, reviewed add/change/cancel/recovery and idempotent confirmation | No conversation-owned persistent draft, reliable follow-up reference resolution or per-leg draft editing/undo; local plan changes are not carrier booking changes; legacy reply composition needs stronger factual constraints |
| Monitoring and recovery | Durable jobs, separate live observations, disruption matching, prepared alternatives and service revalidation | No held backup inventory; recovery cash calculation needs correction before purchase recommendations |
| Tickets and documents | Manual/photo/barcode imports, itinerary PDFs, encrypted offline packs | Imported documents do not establish ticket validity; no new airline ticket is created |
| Accounts and privacy | Owner-scoped encrypted storage, sessions, TOTP/recovery codes, export/deletion and notification preferences | Real recovery-email delivery is not configured; external trace privacy and operating procedures need completion |
| Notifications | Web Push subscriptions, outbox, policy and device controls | Real OS notification delivery remains unverified in the recorded checkpoint |
| Operations | Encrypted periodic/pre-migration backups, restore checks and build/test CI | Local backups do not cover whole-disk loss; routing setup is Windows-specific; deployment validation remains required |
| Commerce | Synthetic quote/order/payment scaffolding | No live airline, bus, rail, payment, exchange or refund integration |

Sample mode has illustrative routes, prices and scoring. Provider failures do not silently turn live Boston search into a sample search. The national agency catalog is discovery data, not nationwide live routing or inventory coverage.

## Run the compiled application locally

Requires Node.js 24 or newer. The tracked `standalone/` directory is a compiled checkpoint; rebuild after frontend changes.

```sh
npm ci
npm run build
npm start
```

The API serves the compiled frontend at `http://127.0.0.1:4173` by default. Copy `.env.example` to `.env` with your operating system's file tools if configuration is needed. The start command reads `.env` when present. Sample routes can run without a flight, payment or local-model account.

## Run the Boston provider path

Use [CORE_LAUNCH.md](docs/CORE_LAUNCH.md) for the current detailed setup. The supplied download/extraction script currently targets **Windows x64**, downloads Java/OTP/GTFS/OSM assets and requires several GB of resources. It is not a portable Linux/macOS installer. Other hosts need a compatible Java installation and correct `.runtime/transit-runtime.json` paths; cross-platform setup is scheduled work.

On a supported configured host:

```sh
npm run transit:setup
npm run transit:build
npm run transit:start
```

Keep the router running, and configure:

```dotenv
OTP_GRAPHQL_URL=http://127.0.0.1:8080/otp/gtfs/v1
WAYLINE_BOSTON_PILOT=true
ENABLE_EXTERNAL_FEEDS=true
```

For optional local model interpretation, run an Ollama instance with the chosen model and set `OLLAMA_BASE_URL` and `OLLAMA_MODEL`. The normal controls and explicit trip commands remain available without a model. A configured URL alone does not prove a service is working; check the application service-status panel.

The graph has a bounded service window. Follow the documented refresh/rebuild/restart procedure before schedules or the window expire. The local app/router processes must remain running for provider access and background work; the scripts do not install an operating-system service.

## Frontend development

The current Vite proxy targets `http://127.0.0.1:4174`, while the default API port is 4173. For the two-terminal development workflow set `PORT=4174` in `.env`, run `npm start`, and run `npm run dev` in a second terminal. Open `http://127.0.0.1:5173` so the origin matches the default development allowance. If using another frontend origin, configure `DEV_CLIENT_ORIGIN` accordingly. Production uses only `PUBLIC_ORIGIN`.

Harmonizing the proxy/API defaults is a documented follow-up. `npm run preview` previews frontend assets; use the Node application for the complete API-backed product.

## Configuration

The executable values and defaults live in `.env.example` and the server modules. Keep credentials out of source control.

| Configuration | Purpose |
| --- | --- |
| `HOST`, `PORT`, `NODE_ENV` | Listener and environment |
| `PUBLIC_ORIGIN`, `DEV_CLIENT_ORIGIN` | Production origin and development-only frontend allowance |
| `DATA_DIR`, `DATA_ENCRYPTION_KEY`, `SESSION_DAYS` | Persistence, production encryption key and sessions |
| `ENABLE_EXTERNAL_FEEDS`, `WAYLINE_BOSTON_PILOT`, `OTP_GRAPHQL_URL`, `MBTA_API_KEY` | Boston/provider operation |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_NUM_CTX`, `OLLAMA_TIMEOUT_MS` | Optional local-model endpoint, model and resource/time limits |
| `VAPID_SUBJECT` | Operator contact for Web Push identity |
| `BACKUP_DIR`, `BACKUP_RECOVERY_KEY_FILE` | Backup destination and separately protected recovery key |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY` | Optional external traces; keep disabled for personal payloads until redaction/retention work is complete |

Existing optional GBFS, geocoder, Valhalla and generic transit-source settings are separate integration seams. They do not enable flight tickets or complete multimodal fares. The [new plan](docs/CHEAPEST_MULTIMODAL_TRAVEL_PLAN.md) describes proposed supplier capabilities; it does not introduce working flight-provider environment variables.

For public deployment, use HTTPS, an explicit production origin, a managed encryption key and persistent storage. Retain the documented single-process SQLite constraint until concurrency and deployment design are changed deliberately.

## Backup and restore

The application creates encrypted database archives while running. Protect a recovery-key copy separately from the archive disk. See [CORE_LAUNCH.md](docs/CORE_LAUNCH.md) for retention, deletion and off-device-copy limits.

Stop the application using the target data directory before operator-only restore:

```sh
node scripts/restore-backup.mjs <archive.wlbackup> <recovery-key-file> <target-data-directory>
```

Restore validates the archive/database and revokes restored sessions, pending authentication/actions and push subscriptions. Follow the documented recovery procedure; do not remove a restore lock without inspecting interrupted restore state.

## Repository structure

| Path | Responsibility |
| --- | --- |
| `src/` | Application pages, shared UI, maps, account state and offline client |
| `server/travel/` | Private MCP travel process, schemas, regional providers and OTP routing |
| `server/domain/` | Journey rules, agent orchestration/tools, trip reviews and notification policy |
| `server/recovery.mjs`, `guardian.mjs`, `jobs.mjs` | Monitoring, alternatives, scheduling and delivery |
| `server/store.mjs`, `backups.mjs` | Encrypted persistence and backup/restore |
| `server/adapters/` | Existing external-provider, model, tracing and synthetic-commerce interfaces |
| `tests/` | Automated regression checks |
| `scripts/`, `infra/` | Build, packaging and runtime setup |
| `public/`, `standalone/` | Static assets and compiled application |
| `docs/`, `output/core-launch/` | Plans, decisions and dated verification evidence |

## Validation and packaging

```sh
npm run lint
npm run check
npm run build
npm run package
```

`check` runs TypeScript and the regression suite. Packaging requires Python 3 and produces the project ZIP under `artifacts/`. Review archive contents before distribution; provider accounts, data directories and credentials are not part of the application deliverable.

Fresh verification on 12 September 2026 at `0f02d7a`: **394 tests passed**, typecheck/build passed, full lint **0 errors and 14 warnings**, and rebuilding produced no tracked differences. See the [review](docs/REVIEW_2026-09-12.md) for scope and two additional reproduced problems. Previous live browser/OTP/Ollama/restore runs are recorded separately; they were not rerun during this review. Passing tests do not establish complete pricing, airline issuance or production readiness.

## Implementation priority

Follow S01–S08 in the [conversational workspace plan](docs/CONVERSATIONAL_TRIP_WORKSPACE.md): correctness and state contracts; persistent follow-up planning; editable chat workspace; flight/ground offers; multimodal comparison and recommendations; recovery in the same conversation; existing-feature and commerce integration; release evidence. C01–C12 in the [supporting travel plan](docs/CHEAPEST_MULTIMODAL_TRAVEL_PLAN.md) remain the technical inventory, with this clarified execution order taking precedence.

First user-facing milestone: start a trip in chat, compare routes, revise an unsaved itinerary across several turns, inspect changes, undo, save, and reload the same conversation. Use the existing transit provider while commercial integrations are added. The clarification review reran 55 agent/core tests successfully and reproduced missing unsaved-draft follow-up context; see the workspace plan for scope.

Keep normal user controls and clear provider limitations throughout. A review or saved itinerary must never be presented as a purchased ticket. A prepared backup is an option to revalidate, not a reserved seat.

## License and original materials

The application is licensed under [MIT](LICENSE). Dependencies, fonts, maps and provider datasets retain their respective licenses and terms. Original supplied materials remain under `docs/original/`; the earlier README is preserved in [README_HISTORY.md](README_HISTORY.md).
