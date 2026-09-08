# Open-data stack and integration boundaries

Core local operation uses React, TypeScript, Vite, Node.js 24 and built-in SQLite. The rules assistant needs no model service. Optional Ollama classifies intents; application rules produce grounded responses.

MapLibre renders maps. OpenStreetMap raster tiles require network access and compliance with service policy. Sample route diagrams are not verified geographic paths.

Optional server adapters include MBTA vehicles/alerts, configured GTFS-Realtime, GBFS stations/availability, Open-Meteo weather, Nominatim, Valhalla and a legacy OpenTripPlanner GraphQL query. They have not been certified against production deployments in this checkpoint. Agency entries do not imply nationwide routing coverage.

Use administrator-approved endpoints. Inspect `server/adapters/providers.mjs` for configuration shapes, timeouts, cache behavior and host checks. Provide an identifiable geocoder contact and follow provider limits. Missing data and provider failures must remain visible.

The repository does not include national GTFS archives, an OTP graph, an Ollama model, commercial credentials, OCR runtime assets or mobile apps. Open data does not grant ticketing, payment or refund authority.

Production requires capacity planning, persistent storage, backups, HTTPS, managed keys, observability and release review. Free software does not guarantee free hosting or unlimited upstream service. Original documentation is preserved at [original/FREE_STACK.md](original/FREE_STACK.md).
