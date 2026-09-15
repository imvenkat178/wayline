# Configuration reference

Every environment variable Wayline reads, taken from the code that reads it. `tests/docs-reference.test.mjs` fails when `server/`, `shared/` or `scripts/` reads a variable that this page does not name.

Set variables in `.env` (copied from `.env.example`); `npm start` loads it with `--env-file-if-exists`. Never commit `.env`, keys or data directories.

Values are strings. A flag described as "`true` to enable" is on only for the exact text `true`; a flag described as "on unless `false`" is off only for the exact text `false`.

## Server and security

| Variable | Default | Effect | Read in |
| --- | --- | --- | --- |
| `NODE_ENV` | unset (development) | `production` requires `PUBLIC_ORIGIN`, adds HSTS and Secure cookies, ignores `DEV_CLIENT_ORIGIN`, and removes the development webhook secret fallback | `server/server.mjs`, `server/store.mjs`, `server/adapters/payments.mjs` |
| `HOST` | `127.0.0.1` | Address the server listens on | `server/server.mjs` |
| `PORT` | `4174` | Port the server listens on; `npm run pilot` uses it too | `server/server.mjs`, `scripts/start-local.mjs` |
| `PUBLIC_ORIGIN` | request host | Exact public HTTPS origin. Required in production: startup fails without it. Mutating requests from any other origin are rejected, and password reset links use it | `server/server.mjs`, `server/router.mjs` |
| `DEV_CLIENT_ORIGIN` | `http://127.0.0.1:5173` | One extra origin allowed outside production, for Vite on a separate port | `server/server.mjs` |

## Data, sessions and backups

| Variable | Default | Effect | Read in |
| --- | --- | --- | --- |
| `DATA_DIR` | `data/` | Directory for the SQLite database, generated keys, the VAPID key pair and the server PID file | `server/store.mjs`, `server/server.mjs` |
| `DATA_ENCRYPTION_KEY` | generated in `DATA_DIR` outside production | 64 hexadecimal characters (32 bytes) encrypting stored records. README requires it in production. A restore refuses a backup made with a different key while this is set | `server/store.mjs`, `server/backups.mjs` |
| `SESSION_DAYS` | `14` | Server-side session lifetime in days, clamped to 1–30 | `server/store.mjs` |
| `BACKUP_DIR` | `DATA_DIR/backups` | Where hourly encrypted backups are written. The server always schedules the hourly backup job | `server/backups.mjs` |
| `BACKUP_RECOVERY_KEY_FILE` | `DATA_DIR/.backup-recovery-key` | Protected recovery key for backups; keep it apart from the backups | `server/backups.mjs` |

## Boston pilot and transit data

| Variable | Default | Effect | Read in |
| --- | --- | --- | --- |
| `WAYLINE_BOSTON_PILOT` | off | `true` sets `pilot` in `GET /api/bootstrap`; the web app then defaults new saved routes to the Boston provider route from South Station to Harvard Square | `server/router.mjs` |
| `ENABLE_EXTERNAL_FEEDS` | on unless `false` | `false` blocks every external feed and supplier call (`503 FEED_DISABLED`) | `server/adapters/providers.mjs`, `server/travel/providers.mjs`, `server/shopping/` |
| `OTP_GRAPHQL_URL` | unset | OpenTripPlanner GraphQL endpoint for Boston routing. Unset, trip search returns `503 PROVIDER_REQUIRED`. Set, the server also schedules live journey refresh every 60 seconds and a travel connection probe every 5 minutes | `server/travel/routing.mjs`, `server/server.mjs`, `server/adapters/providers.mjs`, `scripts/start-local.mjs` |
| `MBTA_API_KEY` | unset | Sent as `x-api-key` to the MBTA V3 API for higher rate limits | `server/travel/providers.mjs`, `server/adapters/providers.mjs` |
| `MBTA_REALTIME_SOURCE` | `v3-api` | `gtfs-rt` reads MBTA vehicles, predictions and alerts from the GTFS-Realtime protobuf feeds at `cdn.mbta.com/realtime/` instead of the V3 JSON API; any other value keeps the V3 API | `server/adapters/gtfsRealtime.mjs` |
| `TRANSIT_SOURCES_FILE` | unset | Path to a JSON array of at most 200 GTFS-Realtime sources, each `{id, name, url, kind}` with `kind` one of `vehicles`, `updates`, `alerts`, an HTTPS `url` without credentials, and optional `apiKeyEnv` naming another variable that holds a bearer token | `server/adapters/providers.mjs` |
| `GBFS_URL` | unset | GBFS discovery endpoint for bike and scooter availability | `server/adapters/providers.mjs` |
| `GBFS_ALLOWED_HOSTS` | unset | Comma-separated extra hosts that GBFS feeds may be fetched from | `server/adapters/providers.mjs` |
| `GEOCODER_URL` | `https://nominatim.openstreetmap.org/search` | Geocoding endpoint | `server/adapters/providers.mjs` |
| `GEOCODER_USER_AGENT` | unset | Identifying user agent with a contact address. Geocoding is unavailable until it is set | `server/adapters/providers.mjs` |
| `VALHALLA_URL` | unset | Valhalla street routing endpoint for `POST /api/route` | `server/adapters/providers.mjs` |

The private travel service (an MCP child process) receives only `ENABLE_EXTERNAL_FEEDS`, `OTP_GRAPHQL_URL`, `MBTA_API_KEY`, `MBTA_REALTIME_SOURCE`, `DUFFEL_ACCESS_TOKEN`, `DUFFEL_LIVE_ENABLED`, `DUFFEL_BACKGROUND_SHOPPING_ALLOWED` and `DUFFEL_PRICE_HISTORY_ALLOWED` from the parent environment (`server/travel/client.mjs`).

## Maps

| Variable | Default | Effect | Read in |
| --- | --- | --- | --- |
| `MAP_STYLE_URL` | unset | HTTPS URL of a MapLibre style (for example a vector tile provider's style). The web app loads it instead of the OpenStreetMap raster style, and its origin is added to the Content Security Policy. Non-HTTPS values are ignored | `server/securityPolicy.mjs` |
| `MAP_TILE_ORIGINS` | unset | Comma-separated HTTPS origins the style loads tiles, glyphs or sprites from, added to the Content Security Policy's `img-src` and `connect-src`. Invalid or non-HTTPS entries are ignored | `server/securityPolicy.mjs` |

## AI assistant

| Variable | Default | Effect | Read in |
| --- | --- | --- | --- |
| `OLLAMA_BASE_URL` | unset | Ollama server URL. The model is used only when this and `OLLAMA_MODEL` are both set; otherwise the assistant reports rules-based fallback | `server/adapters/llm.mjs` |
| `OLLAMA_MODEL` | unset | Model name; the accepted configuration is `llama3.1:8b-instruct-q4_K_M` ([report](../LOCAL_LLAMA_REPORT.md)) | `server/adapters/llm.mjs`, `server/server.mjs` |
| `OLLAMA_NUM_CTX` | `8192` | Context window in tokens | `server/adapters/llm.mjs` |
| `OLLAMA_TIMEOUT_MS` | `180000` | Timeout for one model request in milliseconds | `server/adapters/llm.mjs` |
| `LANGSMITH_TRACING` | off | `true` with `LANGSMITH_API_KEY` sends LangGraph traces to LangSmith, a third party | `server/adapters/tracing.mjs` |
| `LANGSMITH_API_KEY` | unset | LangSmith credential | `server/adapters/tracing.mjs` |

Private conversation executions delete `LANGSMITH_TRACING`, `LANGCHAIN_TRACING`, `LANGCHAIN_TRACING_V2` and `LANGCHAIN_VERBOSE` from the process environment so their content is never traced, which also turns tracing off for the rest of that process (`server/adapters/tracing.mjs`).

## Notifications

| Variable | Default | Effect | Read in |
| --- | --- | --- | --- |
| `VAPID_SUBJECT` | placeholder | `mailto:` or `https:` contact for the Web Push identity. The key pair is generated once and stored as `DATA_DIR/.vapid-keys.json` | `server/push.mjs` |

## Flights and suppliers

Leave approval flags `false` until the provider has granted that access. See [PROVIDER_READINESS.md](../PROVIDER_READINESS.md) for each provider's requirements.

| Variable | Default | Effect | Read in |
| --- | --- | --- | --- |
| `DUFFEL_ACCESS_TOKEN` | unset | Duffel API token. Flight shopping and airport lookup are configured only when it is set and external feeds are on | `server/shopping/duffel.mjs`, `server/shopping/duffelBooking.mjs`, `server/shopping/airports.mjs` |
| `DUFFEL_LIVE_ENABLED` | `false` | `true` allows live-mode offers and orders; must match the token's environment | `server/shopping/duffel.mjs`, `server/shopping/duffelBooking.mjs` |
| `DUFFEL_BACKGROUND_SHOPPING_ALLOWED` | `false` | `true` allows queued background searches | `server/shopping/duffel.mjs` |
| `DUFFEL_PRICE_HISTORY_ALLOWED` | `false` | `true` allows price history and price watches | `server/shopping/duffel.mjs` |
| `DUFFEL_BOOKING_APPROVED` | `false` | `true` authorizes order operations (cancel and refund; booking and exchange also need Cards approval) | `server/shopping/duffelBooking.mjs` |
| `DUFFEL_CARDS_APPROVED` | `false` | `true` enables card-funded booking and exchanges | `server/shopping/duffelBooking.mjs` |
| `DUFFEL_LIVE_CERTIFIED` | `false` | Required, with a retention policy, before booking is authorized in live mode | `server/shopping/duffelBooking.mjs` |
| `DUFFEL_WEBHOOK_SECRET` | unset | Signing secret for `POST /api/shopping/webhooks/duffel`; the endpoint returns `503` without it | `server/shopping/webhooks.mjs` |
| `DUFFEL_TRANSACTION_RETENTION_DAYS` | unset | Contractual retention period for live transaction records | `server/shopping/transactionRetention.mjs` |
| `DUFFEL_RETENTION_POLICY_ID` | unset | Identifier of the approved retention policy; required with the retention days for live transactions | `server/shopping/transactionRetention.mjs` |
| `FLIGHTAWARE_API_KEY` | unset | FlightAware AeroAPI key | `server/shopping/aeroapi.mjs` |
| `FLIGHTAWARE_STANDARD_APPROVED` | `false` | `true` confirms AeroAPI Standard access | `server/shopping/aeroapi.mjs` |
| `FLIGHTAWARE_LICENSE_ID` | unset | License identifier | `server/shopping/aeroapi.mjs` |
| `FLIGHTAWARE_RETENTION_DAYS` | unset | Licensed retention for flight status data, above 0 and at most 30 days. Flight status, monitoring and recovery stay off unless the key, approval, license ID and a valid retention period are all set and feeds are on | `server/shopping/aeroapi.mjs` |

## Sandbox commerce

| Variable | Default | Effect | Read in |
| --- | --- | --- | --- |
| `SANDBOX_WEBHOOK_SECRET` | development fallback | HMAC secret for `POST /api/commerce/webhook`. Required in production, where a missing secret makes that endpoint fail with `500`; development uses a fixed non-secret value | `server/adapters/payments.mjs` |

## Build and evaluation scripts

These variables affect scripts only, never the running server.

| Variable | Default | Effect | Read in |
| --- | --- | --- | --- |
| `WAYLINE_BUILD_OUT_DIR` | `standalone` | Output directory for the service worker build step | `scripts/build-sw.mjs` |
| `EVAL_MODEL` | `llama3.1:8b-instruct-q4_K_M` | Model for `npm run test:llama` and `npm run test:llama:journeys` | `scripts/evaluate-local-llama.mjs`, `scripts/evaluate-local-journeys.mjs` |
| `EVAL_CORPUS` | `acceptance` | Corpus to evaluate when no `--combined` or `--heldout` flag is given | `scripts/evaluate-local-llama.mjs` |
| `EVAL_FILTER` | unset | Regular expression selecting corpus case IDs | `scripts/evaluate-local-llama.mjs` |
| `EVAL_LIMIT` | all selected cases | Maximum number of cases | `scripts/evaluate-local-llama.mjs` |
| `EVAL_REPEATS` | `2` | Repeats per case | `scripts/evaluate-local-llama.mjs` |
| `EVAL_OUTPUT` | `docs/evaluations/llama-8b-scope-acceptance.json` | Corpus report path | `scripts/evaluate-local-llama.mjs` |
| `JOURNEY_OUTPUT` | `docs/evaluations/local-llama-final-journeys.json` | Critical journey report path | `scripts/evaluate-local-journeys.mjs` |
| `AFTER_MODEL_REPORT` | unset | Wait until this corpus report records `finishedAt` before starting journeys | `scripts/evaluate-local-journeys.mjs` |
| `BENCH_MODEL` | `llama3.1:8b-instruct-q4_K_M` | Model for `npm run benchmark:chat` | `scripts/benchmark-conversation-latency.mjs` |
| `BENCH_REPEATS` | `1` | Benchmark repeats | `scripts/benchmark-conversation-latency.mjs` |
| `BENCH_OUTPUT` | `docs/evaluations/latency-benchmark.json` | Benchmark report path | `scripts/benchmark-conversation-latency.mjs` |
| `COVERAGE_MODEL_REPORT` | `docs/evaluations/llama-8b-scope-acceptance.json` | Model report used by `npm run report:workflows` | `scripts/report-workflow-coverage.mjs` |
| `COVERAGE_JOURNEY_REPORT` | `docs/evaluations/local-llama-final-journeys.json` | Journey report used by the coverage report | `scripts/report-workflow-coverage.mjs` |
| `COVERAGE_BROWSER_REPORT` | `docs/evaluations/browser-verification.json` | Browser verification report | `scripts/report-workflow-coverage.mjs` |
| `COVERAGE_CHECK_LOG` | `tmp/check-final-acceptance.log` | Test log summarized in the coverage report | `scripts/report-workflow-coverage.mjs` |
| `COVERAGE_MEMORY_REPORT` | `docs/evaluations/local-runtime-memory.json` | Model memory report | `scripts/report-workflow-coverage.mjs` |
| `OTP_DATA_DIR` | `.runtime/boston` | Directory that receives the MBTA GTFS, Massachusetts OpenStreetMap data and OTP configuration; the container stack sets `/var/opentripplanner` | `scripts/otp-data.mjs` |
| `OTP_CONFIG_DIR` | `infra/otp` | Directory holding `build-config.json` and `router-config.json` to copy into the data directory | `scripts/otp-data.mjs` |

The container stack (`docker-compose.yml`) also reads `WAYLINE_PORT` (host port, default `4174`) and `OTP_MEMORY` (Java heap for OTP, default `6g`) from your shell or a `.env` file when interpolating the compose file, and passes `.env.container` to the application. See "Run with containers" in README.md.

The evaluation and benchmark scripts set `OLLAMA_BASE_URL` to `http://127.0.0.1:11434`, `OLLAMA_NUM_CTX` to `8192` and `ENABLE_EXTERNAL_FEEDS` to `false` for their own process.
