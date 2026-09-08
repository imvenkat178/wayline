# Wayline AI — Journey Assurance

A standalone consumer transportation product prototype focused on the gap between route search, live tracking, ticketing and disruption recovery.

## Run the complete zero-install build

Node.js 18+ is the only runtime requirement:

```bash
node server/server.mjs
```

Then open:

```text
http://localhost:4173
```

Windows users can run `start.bat`; macOS/Linux users can run `./start.sh`.

## Major product features

- AI natural-language journey planning
- Optional local Ollama LLM integration with deterministic fallback
- Multimodal journey ranking
- Door-to-door real price
- Reliability and arrival-confidence scoring
- Transfer-risk scoring
- Tracking provenance: Live GPS / crowdsourced / predicted / schedule-only
- Journey Guardian connection protection
- Prepared recovery alternatives
- Exact boarding / gate / curb guidance
- Vehicle identity certainty
- Live journey map
- Universal ticket wallet UI with offline-state representation
- Unified disruption inbox
- AI disruption impact summary
- Live journey sharing UI
- Crowding and accessibility signals
- Automated refund eligibility/evidence workflow
- Journey Receipt evidence timeline
- Personal routing preferences
- Responsive desktop/mobile interface
- Open Transit Lab with live feed adapter and data provenance

## Free/open integrations

The package deliberately starts with a low-cost/open architecture:

- **MapLibre GL JS** — open-source web map renderer.
- **OpenTripPlanner** — recommended self-hosted multimodal transit router using OSM + GTFS + GTFS-Realtime + GBFS.
- **GTFS / GTFS-Realtime** — schedule, trip update, alert and vehicle-position standards.
- **MobilityDatabase** — discovery source for official mobility feeds.
- **MBTA V3 API** — included zero-key experimentation adapter for a real live-data demo.
- **Valhalla** — included fair-use public-demo adapter for pedestrian/bike/drive routing; self-host for production.
- **Nominatim** — explicit-submit, cached, rate-limited prototype geocoder adapter. Self-host/swap before large-scale production.
- **Ollama** — optional local LLM path with no per-token API charge for locally installed models.

See `docs/FREE_STACK.md` for architecture and production caveats.

## Honest integration boundary

A website cannot obtain universal live ticket inventory, issue Amtrak/Greyhound/FlixBus tickets, process payments, submit every refund, or rebook passengers across companies without provider credentials, contracts and payment/compliance infrastructure. Those experiences are built as interactive adapter-backed flows, but are labeled as demo/provider actions until a real integration is connected.

The open-data parts—routing, GTFS ingestion, GTFS-Realtime vehicle positions, service alerts, map rendering and local AI—can be developed largely with open standards and open-source software.

## Project layout

```text
wayline-ai/
├── START_HERE.md
├── README.md
├── server/
│   └── server.mjs             # zero-dependency local API + static server
├── standalone/
│   ├── index.html             # complete zero-install UI
│   ├── app.js
│   └── styles.css
├── docs/
│   └── FREE_STACK.md
├── infra/otp/
│   ├── build-config.json
│   └── router-config.json
├── src/                       # React/TypeScript source from the component build
├── package.json
├── start.sh
└── start.bat
```

## Local AI behavior

`server/server.mjs` checks Ollama at `http://127.0.0.1:11434/api/tags`. If it finds a locally installed model, the journey planner uses that model. Otherwise it uses the deterministic journey agent, so the app never becomes unusable just because an LLM is absent.

Optional environment variables:

```bash
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=<an installed model name>
PORT=4173
```

## Production next steps

1. Build an OTP graph for an initial launch region with agency GTFS and OSM extracts.
2. Add GTFS-RT updaters for vehicle positions, trip updates and service alerts.
3. Normalize agency/operator identifiers and provenance in Postgres/PostGIS.
4. Persist historical arrival performance to train/calibrate reliability scoring.
5. Add a booking orchestration layer only for carriers with approved APIs/contracts.
6. Add payment processing and PCI-compliant tokenization through a payment provider.
7. Add notification infrastructure for push/SMS/email disruption alerts.
8. Add authentication, encrypted journey state, audit logs and privacy controls.
9. Replace fair-use/demo map/geocoding/routing endpoints with self-hosted or SLA-backed services before public scale.
