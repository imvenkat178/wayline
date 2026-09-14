# Multimodal travel implementation — 12 September 2026

This is an implementation checkpoint for [the reviewed C01–C12 plan](https://github.com/imvenkat178/wayline/pull/1), not a declaration that all commercial travel services are connected. The Boston pilot remains operational. No paid account, public deployment, supplier booking or payment has been enabled.

## What works

- Recovery shows replacement cash separately from historical payments, projected spend and confirmed adjustments. A $100 original payment plus an $80 replacement means $80 cash now and $180 spent. Matching a leg never proves ticket reuse. Linked payments are aggregated; explicitly group-scoped payments are deduplicated. Imported payments remain traveler-reported.
- Operational AI replies render validated evidence deterministically. Models select intents/tools; free-form factual rewriting is removed. Operational graph execution disables automatic LangSmith/LangChain payload tracing, including global tracing flags.
- Shared schemas cover currency scales, passenger ages and individual bags, places, service instances, ticket groups, observations, constraints and price components. Unknown, expired, estimated and mixed-currency prices cannot win a complete-price badge.
- Private MCP Duffel search/refresh tools validate domestic US economy offers. Fixed supplier host, bounded response size/time/concurrency, entire-party totals and intact round-trip boundaries are enforced. Unpriced baggage stays unknown.
- The coastal flight-comparison panel supports airports, one-way/return dates, optional Boston origin station, adult/child travelers, individual bags, budget, deadline, explicit date flexibility and overnight preference. It shows progress/cancellation, separates incomplete offers, refreshes before review and refreshes again before idempotent comparison saving.
- Encrypted search records and durable per-query jobs support six selected date/airport combinations and up to fifty returned offers per query. Cancellation and history deletion suppress late results.
- Standard adult single-ride Red/Orange/Blue/Green fares come from the installed MBTA GTFS snapshot, with source, hash, version, observation time and validity dates. Unsupported transfers, discounts, buses, Silver Line and commuter rail remain unpriced. Known live fares are sorted and checked against the whole-party budget.
- Boston airport connections are routed at flight-specific times during review/confirmation. The 120-minute access and 90-minute egress search windows are assumptions. Terminal access, security, bag drop and reclaim procedures remain unverified; these cannot receive a verified-complete badge.
- Price watches require traveler consent plus separate supplier rights for background shopping and price history. They support expiry, cancellation, bounded cadence and deduplicated preference-aware inbox/push alerts. They remain disabled in the current configuration.
- History deletion covers all new records/jobs. Restore revokes shopping reviews/searches/watches as well as sessions and previous pending actions. Carrier transactions remain disabled.

## C01–C12 status

| Package | Current implementation | Remaining acceptance / integration |
| --- | --- | --- |
| C01 correctness | Cash accounting, factual AI, unknown-fare controls, tracing privacy and port 4174 defaults implemented/tested | Imported spending is not independently verified |
| C02 models | Core contracts, money, offer/group and observation validation implemented | Supplier-specific ticket/service extensions with each adapter |
| C03 flights | Duffel adapter, MCP tools, bounded jobs, expiry, review and revalidation implemented | Approved credentials, supplier certification and live coverage checks |
| C04 ground prices | Versioned MBTA fare subset and timed Boston connections implemented | Remaining MBTA rules; authorized intercity provider and non-Boston access/egress |
| C05 composition | Intact offers, party totals, missing-cost separation, constraints, scoped ranking, asynchronous UI and comparison saving implemented | Broad multi-provider door-to-door search, nearby-airport discovery UI, supplier handoff/booking. Saved comparisons are not monitored journeys or carrier tickets |
| C06 connections | Mode-specific policy, overlapping minima and unknown procedures implemented | Verified airport/terminal/check-in rules. Airport changes/self-transfers are not promoted as verified |
| C07 monitoring | Exact identity and stale/out-of-order reducer implemented; Boston monitoring retained | Licensed flight/intercity status adapters and durable refresh integration |
| C08 recovery | Boston financial correction, original saved-search deadline/preferences preservation, generalized location/choice helpers | Full multimodal recovery state machine, progress integration, ticket-usability reconciliation and flight recovery |
| C09 AI | Existing shared trip tools retained; flight comparison/readiness results added; unsupported factual rewriting prevented | Broader wallet/watch/recovery agent workflows require service integrations |
| C10 savings | Explicit date families and gated price-watch backend/UI implemented | Live permission verification, nearby-airport discovery and permitted historical-price evidence |
| C11 transactions | Disabled HTTP endpoint and tested durable intent/idempotency/reconciliation seam; payment capture differs from issuance | Real supplier/payment adapters, signed webhooks, reconciliation/compensation and commercial approval |
| C12 release | Regression, build, lint, live Boston fares/budgets and responsive browser checks | 30 live corridor validations and a human-reviewed production AI corpus are not complete; supplier testing, OS push delivery and multimodal recovery remain outstanding |

The entire commercial roadmap is **not complete**. Unsupported capabilities stay visible and gated. No sample fares substitute for unavailable inventory; no carrier barcode or reservation is invented.

## Verification

- Full regression: **546 passed**, no failures/skips/cancellations. Log: tmp/multimodal-regression.log.
- New shopping suite: **133 passed**, including 100 deterministic adversarial evidence-boundary cases. These are injected fixtures, not observed airline/model incidents or human-reviewed live travel cases.
- Production build passed; the existing large MapLibre chunk warning remains.
- Full lint: **0 errors, 15 existing warnings**. The new comparison component has no lint warning.
- Live OTP/MBTA: five South Station → Harvard routes, **$4.80 total for two standard-fare adults**. A $1 whole-party budget returned zero routes with explicit over-budget exclusions. [Machine-readable evidence](../output/multimodal/live-check.json).
- Desktop and 390px mobile: supplier-unavailable response, children, individual bags and price-watch gates checked; no horizontal overflow, browser console errors empty. Existing map and priced Boston cards remained available.
- Existing PDF/offline/backup regression suites passed; real-flight artifacts have not been separately certified.

## Operator setup

Run npm run pilot for the app and installed Boston router, or npm start for the app alone. App and Vite proxy defaults agree on port 4174.

Configure DUFFEL_ACCESS_TOKEN only in the local environment after supplier access is approved. Never put secrets in source, chat, URLs or screenshots. Test offers are visibly labeled. DUFFEL_LIVE_ENABLED defaults to false; enable it only after commercial approval and successful live checks.

DUFFEL_BACKGROUND_SHOPPING_ALLOWED and DUFFEL_PRICE_HISTORY_ALLOWED separately default to false. A working search token does not authorize unattended shopping or historical-price storage.

No Skyscanner background search, real payment, ticket issuance, cancellation, exchange or refund adapter is enabled. No supplier webhook route accepts financial events.

The fare snapshot in server/shopping/mbta-tariff.json expires with its feed calendar on 12 December 2026. Unsupported dates return unknown fares. Refresh the GTFS data and revalidate rules before replacing it.

## Sources

- [Duffel offer requests](https://duffel.com/docs/api/v2/offer-requests)
- [Duffel offers, refresh, totals and baggage](https://duffel.com/docs/api/v2/offers)
- [Official MBTA GTFS source](https://cdn.mbta.com/MBTA_GTFS.zip)
- [Review and staged implementation plan](https://github.com/imvenkat178/wayline/pull/1)
