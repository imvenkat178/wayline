# Wayline AI — free/open stack

## What is wired now
- **Map UI:** MapLibre GL JS loaded from its CDN in the zero-install client. The demo style is used for prototype rendering.
- **Live transit demo:** MBTA V3 JSON API through `/api/mbta/vehicles` and `/api/mbta/alerts`. MBTA permits experimentation without an API key; get a free key before sustained usage.
- **Geocoding:** OpenStreetMap Nominatim behind the local server, only on explicit user submit, cached, rate-limited to <=1 request/sec, and sent with an identifying User-Agent. Do not treat the public endpoint as a production SLA.
- **Walking/bike/drive routing demo:** Valhalla public demo behind `/api/route`, with an identifying X-Client-Id. Self-host for production.
- **AI:** Ollama auto-detection. If a local Ollama model is available, `/api/ai/plan` uses it. Otherwise the deterministic journey agent remains fully usable.

## Recommended production $0-license stack
1. OpenTripPlanner for transit + multimodal routing from OSM + GTFS + GTFS-Realtime + GBFS.
2. MobilityDatabase to discover official GTFS/GTFS-RT feeds, then ingest feeds directly from agencies where possible.
3. MapLibre GL JS for client map rendering.
4. Self-hosted OpenStreetMap-derived tiles (or a compliant provider) rather than relying on community demo tiles at scale.
5. Self-hosted Nominatim / Pelias / Photon for geocoding at scale.
6. PostgreSQL + PostGIS for feed normalization, journey state, reliability history and geospatial queries.
7. Ollama for no-per-token local AI during development; swap in any model provider later via the same adapter.

## What cannot be genuinely free/universal
Carrier ticket issuing, seat inventory, refunds, payment processing, Amtrak/Greyhound/FlixBus commercial booking, and guaranteed cross-carrier rebooking require contracts/API access. Wayline keeps these behind provider adapters and never labels a simulated action as a real carrier transaction.
