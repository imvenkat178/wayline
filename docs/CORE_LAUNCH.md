# Boston core launch — 11 September 2026

Subsequent review: [12 September findings](REVIEW_2026-09-12.md). Next product scope: [cheapest flight, bus and train journeys with AI recovery](CHEAPEST_MULTIMODAL_TRAVEL_PLAN.md). The dated evidence below describes this checkpoint; it does not establish complete live fares or airline ticket issuance.

This checkpoint implements the approved coastal application with real Boston transit planning, a local AI tool path, reviewed trip changes, recovery, PDFs, encrypted offline packs and encrypted database backups. The separate 105-feature roadmap in FEATURE_STATUS.md remains a historical inventory; this checkpoint does not claim national coverage or carrier commerce.

## Run locally

Requirements: Node 24+, Ollama with llama3.2, and several GB of disk/RAM for the local transit graph. The supplied transit setup downloads a Windows x64 Java 25 runtime, OTP 2.10.0, MBTA GTFS and Massachusetts OpenStreetMap data. No paid account is required.

1. Run npm ci, then npm run transit:setup and npm run transit:build. These large downloads/builds are needed once.
2. Start the router with npm run transit:start. It listens only on 127.0.0.1:8080 and loads the saved graph. Keep this terminal running.
3. In .env, set OTP_GRAPHQL_URL=http://127.0.0.1:8080/otp/gtfs/v1, WAYLINE_BOSTON_PILOT=true, ENABLE_EXTERNAL_FEEDS=true, OLLAMA_BASE_URL=http://127.0.0.1:11434 and OLLAMA_MODEL=llama3.2. Keep Ollama running.
4. Run npm run build, then npm start. This workspace is configured for http://127.0.0.1:4174; .env.example defaults to 4173. The build enforces production assets even when the local API's NODE_ENV is development, so offline support is present.
5. Open the service connections panel on Plan a journey. It reports measured connection state, last success, data age and coverage. A configured endpoint alone does not imply availability.

Refresh transit data with npm run transit:setup -- --refresh, then rebuild and restart OTP while Wayline is idle. The graph uses a bounded service window (yesterday through two months after its build date). Rebuild before that window expires or schedules change. Download manifests record sources, checksums and dates in .runtime. The Java download is pinned and checksum-verified. The setup script currently targets Windows; other hosts need a compatible Java installation and corresponding transit-runtime.json paths.

## User flows

- Search Boston stations by name, or enter latitude, longitude. Existing city-based sample journeys remain available in explicit sample mode.
- Use the separate Assistant workspace to find/list trips, change a selected trip's destination, departure or preferences, prepare alternatives, check weather/status, and download a PDF. Examples: “Find a trip from South Station to Harvard tomorrow at 9 am”, “Change my trip to 10 am”, “Cancel my trip”. Select a saved journey for actions on an existing plan.
- Add, change, cancellation and alternative selection produce server-owned review cards. Confirm applies once; repeated confirmation returns the applied result. A changed journey version or expired/departed route requires a refreshed review. A trip change preserves identity and revision/event history. Cancelling stops monitoring and preserves the record.
- Add trip, Change trip, Cancel trip, Alternatives and Download PDF remain visible, with explanations when unavailable.
- The interactive map draws OTP leg geometry, walking links, stop markers and matched MBTA vehicles. Map and leg selection are linked. Unavailable/approximate/stale data are labeled. Missing GPS never means cancelled.
- PDFs are branded Wayline itineraries with all legs, dates/timezones, operators, boarding notes, recorded fares, imported ticket references, source timestamps and disruption notes. Unknown fares stay unknown. PDFs never invent barcodes, tickets or purchase confirmations.
- Save an offline pack with a passphrase of at least 12 characters. Full itinerary, geometry and attached ticket details are encrypted locally. Unlocking derives an in-memory key; enabled packs refresh while unlocked and lock after five minutes or identity changes. A cold offline visit to /#offline can open the saved pack. Map tiles are not downloaded; the route remains visible as geometry.

## Backend and recovery

The Node backend starts one private stdio MCP process using @modelcontextprotocol/sdk 1.30.0. Its only tools are health, places, search, predictions, vehicles, disruptions and weather. Zod validates requests and results; the process command and provider endpoints come from server configuration, never chat input. Connections/calls have bounded timeouts and reconnect attempts. Provider responses are shared and cached across users. Failures never silently return sample routes.

LangGraph routes validated intentions to those tools. Ollama output must pass a schema and its place/time arguments must remain grounded in the request. Explicit commands and regular UI controls continue to work if the model is unavailable or invalid. The model cannot directly commit a trip mutation.

The durable queue schedules active journey refreshes every 60 seconds, with separate leased jobs for journeys and a five-second queue drain. The pilot monitors six hours before departure until one hour after arrival. Under load or provider outages this is a target cadence, not a hard real-time guarantee. Provider observations live separately from the versioned saved itinerary, so polling cannot invalidate an otherwise valid review. Restarted workers reclaim expired leases; abandoned handlers cannot commit.

Alerts match MBTA agency, route/trip, stop/parent stop, direction, service date when supplied, and affected time. Confirmed disruptions and connection risks prepare up to three feasible routes from the next reachable point. Alternatives persist with freshness, walking, transfers, arrival differences and known incremental costs. They are revalidated before application. Notifications use the existing deduplicated inbox and subscribed Web Push outbox. Automatic recovery defaults on for new preferences; an explicit saved opt-out is respected. No automatic purchase or carrier cancellation occurs.

New authenticated endpoints:

| Endpoint | Purpose |
| --- | --- |
| GET /api/places?q= | Boston station lookup |
| GET /api/travel/health | Measured provider and backup state |
| POST /api/agent | Existing reply/history plus results, evidence and pendingActions |
| POST /api/agent/actions | Persist an add/change/cancel/recovery review |
| POST /api/agent/actions/:id/confirm | Idempotent owner/version-bound apply |
| POST /api/journeys/:id/change | Prepare a change review |
| POST /api/journeys/:id/prepare-recovery | Prepare alternatives |
| GET /api/journeys/:id/recoveries | Persistent alternative records |
| GET /api/journeys/:id/itinerary.pdf | Complete itinerary PDF |

Existing session ownership, CSRF, optimistic concurrency, encrypted records and privacy retention remain in force. Migrations are additive. Pending reviews and recovery records use encrypted records; live observations have a separate encrypted table.

## Backup operations

The normal application creates a consistent SQLite VACUUM INTO snapshot before migrations and schedules encrypted hourly backups. Archives use gzip plus AES-256-GCM, contain a database SHA-256 digest and include the application encryption key and VAPID keypair inside the encrypted archive. The recovery key is separate: data/.backup-recovery-key by default, restricted to the Windows account and SYSTEM (0600 on POSIX). Keep a protected recovery-key copy separately from the backup disk. Do not lose it.

Default destination: data/backups. Set BACKUP_DIR to an external-drive directory, and optionally BACKUP_RECOVERY_KEY_FILE to a separately protected key file. Retention keeps 24 hourly snapshots and the newest snapshot from each of seven days, plus the latest checkpoint when needed. These are snapshots from times the app was running, not copies invented for missed hours. Local copies alone cannot recover from loss of the entire disk. The application does not install a system service or copy archives to a cloud account.

Restore is operator-only and has no HTTP endpoint:

    node scripts/restore-backup.mjs <archive.wlbackup> <recovery-key-file> <target-data-directory>

Stop the Wayline process for the target directory first. Restore refuses a live PID, takes an exclusive restore lock (startup refuses that lock), authenticates/decompresses the archive, checks SQLite integrity and decrypts stored records. It stages the replacement database/key set, preserves the existing set with the same .before-restore timestamp, and rolls back installation on failure. Restored sessions, pending logins/recovery tokens, pending trip actions and push subscriptions are revoked; stale live observations are discarded; leased jobs become pending. Sign in again and resubscribe to push. Production DATA_ENCRYPTION_KEY must match the restored key.

After a machine crash during restore, inspect the staged and preserved files before removing a leftover .restore-lock; do not start against a mixed database/key set. A restore into an isolated directory is the recommended recovery rehearsal.

Account/history deletion purges retained archives in the configured destination and local preserved pre-restore sets, then creates a fresh encrypted privacy snapshot. An operator who manually copies archives elsewhere must also remove those copies when deleting the corresponding data; the app cannot discover disconnected historical destinations.

## Verification evidence

- Real local OTP search South Station → Harvard returned five MBTA alternatives with trip/stop identifiers and geometry. Java 25 / OTP 2.10.0 graph built successfully from MBTA GTFS and Massachusetts OSM. Correct realtime feed ID mbta-ma-us produced 100% matching trip updates in the observed batch.
- Places, MBTA vehicles/predictions/alerts and NWS forecast/alerts passed live MCP checks. A future departure may have no prediction yet; this is shown as unavailable, not on-time.
- A real llama3.2 interpretation of “I need to reach Harvard starting in South Station tomorrow” reached MCP and returned five real routes. Evidence: ../output/core-launch/ai-live-check.json.
- Browser add → review → confirmation → persisted journey, departure change with retained history, and chat cancellation passed on the real local services. Chrome cold startup with the isolated API stopped loaded the shell, requested the passphrase again, decrypted the pack and displayed route geometry.
- Desktop (1440px) and mobile (390px) layouts were inspected. Mobile planner/assistant had no horizontal overflow; the composer remains usable below the persistent trip options. Older chat evidence remains readable.
- The actual encrypted application backup restored into an isolated temporary directory: 22 records decrypted, SQLite integrity OK, sessions and pending actions both zero. The temporary restored copy was removed after verification. Evidence: ../output/core-launch/restore-check.json.
- The two-page PDF was rendered and both pages visually inspected: ../output/core-launch/wayline-itinerary.pdf.
- Core tests cover owner isolation, CSRF, double confirmation, stale/expired review, invalid model commands, outages, live observation concurrency, disrupted-route alternatives, deduplication, missing GPS, lease expiry, encrypted restore/decryption, running-server refusal, tamper detection, retention and privacy deletion. Full regression/build/browser results are recorded in the feature-status checkpoint.

Live browser push delivery has not been verified against a user-approved OS subscription in this session; the subscription/outbox path and policy are regression-tested. Real carrier issuance, refunds/cancellation, payment, nationwide routing and guaranteed real-time fares remain unavailable. Boston station accessibility and fare availability are only as complete as the connected provider data; unknown fields are explicit.

## Continuation verification — 11 September 2026, 13:04 EDT

The application and OTP processes were restarted after the live check found routing stopped. The isolated HTTP chat → local llama3.2 → MCP → real OTP/MBTA → review → confirmation → SQLite → cancellation flow passed again. The application is available on port 4174 and routing on 8080; these local processes must remain running for monitoring and scheduled backups.

Disruption matching now uses the affected leg’s actual/predicted time window. Preparation excludes confirmed closures and recently cancelled trips, rejects stale alert feeds and infeasible connections, and invalidates prepared options when a new closure affects them. Confirmation rechecks route availability, current MBTA alerts and same-service-day cancellation predictions before writing the reviewed action. New tests exercise changes introduced after review without mutating the saved trip.

A deliberately unavailable page bundle on an isolated server displayed the recovery screen instead of a blank app; navigation and offline-pack access remained usable and the section reopened after recovery. Notification setup now has bounded service-worker readiness and visible device/permission status. The current in-app browser reports notifications blocked; no notification permission was changed. An isolated mobile check (390px viewport, 375px content/client width) showed the readiness failure clearly without horizontal overflow.

394 regression tests passed, the production build passed, and targeted lint had zero errors with six existing hook/fast-refresh warnings. Updated evidence: [verification.json](../output/core-launch/verification.json).

## Primary references

- MCP TypeScript SDK: https://ts.sdk.modelcontextprotocol.io/index.html
- OTP GTFS GraphQL: https://docs.opentripplanner.org/en/latest/apis/GTFS-GraphQL-API/
- OTP 2.10.0 release: https://github.com/opentripplanner/OpenTripPlanner/releases/tag/v2.10.0
- MBTA V3: https://api-v3.mbta.com/docs/swagger/index.html
- NWS API: https://www.weather.gov/documentation/services-web-api

- Vite dynamic import failures after updates: https://vite.dev/guide/build#load-error-handling
