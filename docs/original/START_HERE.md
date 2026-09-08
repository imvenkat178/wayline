# Start Wayline AI

## Fastest: zero-install full app
Requires Node.js 18+ only.

```bash
node server/server.mjs
```

Open `http://localhost:4173`.

This is the recommended build in this package. It includes the complete interactive consumer UI, local AI fallback, optional Ollama integration, MapLibre map rendering, a live open-transit lab, MBTA live-feed adapter, Nominatim geocoding adapter, Valhalla demo routing adapter, journey protection flows, ticket wallet, disruptions, sharing, refund evidence, and travel preferences.

If you simply double-click `standalone/index.html`, most UI flows still work, but same-origin API features (live transit, Ollama detection, geocoding/routing proxy) are intentionally unavailable.

## Optional local LLM
Install Ollama separately and have any local chat model available. The server automatically checks `http://localhost:11434/api/tags`. Set `OLLAMA_MODEL` to force a specific installed model.

## Optional React/Vite source
The original componentized React/TypeScript source remains under `src/` for continued product development. It requires npm dependencies. The zero-install app is the most complete runnable build in this ZIP.

## Important production boundary
Open-data routing/tracking can be built on free/open standards and software. Universal ticket issuance, payment, seat inventory, carrier refunds and cross-carrier rebooking require commercial carrier/payment integrations. The UI marks those actions as demo/provider-adapter flows instead of pretending they are live transactions.
