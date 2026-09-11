# Wayline design prototype

This is an isolated design preview. The current application entrypoint, routes, server and data are unchanged.

Open `http://127.0.0.1:5181/prototype.html` while the local preview is running.

## Try the prototype

- **Journeys:** add a trip, change its date/time/stations, cancel it, or open its itinerary. The Cancelled tab keeps cancelled sample trips available.
- **Assistant:** use the separate conversation screen. Try `Add a trip from Boston to Washington on 2026-10-03` or `Change my trip to 2026-09-20 at 11:00`. Actions open review dialogs. Select another journey from the journey picker.
- **Journey protection:** compare three alternatives. Simulate a disruption with automatic recovery on or off. Restore a snapshot to try the original journey again.
- **Tickets:** download a two-page PDF with the current itinerary, fare summary, station guidance and alternatives. All documents are marked as samples, not valid travel tickets.
- **Map explorer:** pan, zoom, tilt, fit the route, use fullscreen, and select station markers for directions. The real OpenStreetMap basemap shows an indicative connection, not railway geometry or live vehicle positions.

Trip records, recovery settings and the last 15 snapshots are saved only in this browser, using the distinct `wayline-design-prototype-v1` storage key. Chat is a guided local intent demo, not a connected language model. Schedules, fares, availability, recovery and booking actions are illustrative. No operator bookings or payments occur. Device loss/cloud backups and unattended real-world disruption detection are outside this preview.

## Run and build

Run the existing `npm run dev -- --host 127.0.0.1 --port 5181 --strictPort` command, then open `/prototype.html`.

Typecheck with `node node_modules/typescript/bin/tsc -b`.

Build the prototype alone with `node node_modules/vite/bin/vite.js build --config vite.prototype.config.ts`. Its output is `artifacts/wayline-prototype/`; the current website's `standalone/` output is not overwritten.

The initial sample PDF is in `output/pdf/Wayline-sample-itinerary.pdf`. Fresh PDFs are generated in-browser from each selected trip.

## Review notes

The direction uses forest-black navigation, editorial serif headings, precise sans-serif controls, a real destination photograph, and a paper-inspired travel document. Four main screens share consistent navigation; journey protection is accessible from overview cards, the assistant and the map screen. Mobile uses bottom navigation and stacked views.

Destination photograph: [Washington Capitol via Unsplash](https://unsplash.com/photos/united-states-capitol-building-on-a-sunny-day-4Tx6uWl9YJM). The font stylesheets and map tiles require a network connection. The map displays an explicit fallback if it cannot load.
