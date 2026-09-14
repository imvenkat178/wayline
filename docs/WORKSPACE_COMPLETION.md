# Workspace functionality pass — 11 September 2026

This pass connects the surrounding application areas to the Boston core launch. It preserves the coastal theme and the journey-summary spacing fix. It does **not** claim completion of every item in the national 105-feature roadmap.

## Implemented across the workspace

| Area | Working behavior |
| --- | --- |
| Planner | Save and reuse Boston station/coordinate shortcuts with their schedule source. Station suggestions support arrow keys, Enter and Escape. Existing city shortcuts remain sample routes. |
| My Journeys | Add, change, cancel, prepare alternatives and download the itinerary directly from each saved trip. Changes and cancellations use the shared server review/confirmation flow. Finished plans retain history and explain disabled actions. |
| Assistant | Existing grounded Ollama/LangGraph/MCP search and reviewed mutations remain shared with regular UI controls; deterministic fallback remains available. |
| Journey Guardian | Resolved Boston station guides, departure-date NWS forecasts and weather alerts, current provider geometry, and recovery from the next reachable boarding point between connections. Delayed predicted arrivals remain reachable only at their predicted time. |
| Tickets | Edit imported details, preserve attached documents and decoded barcode information, record self-reported amount paid, view the original photo, open the linked journey and download its complete itinerary PDF. Large retained photos have the same request limit on edit as on import. Photo loading cannot overwrite a later editor session. |
| Inbox | Atomic, idempotent bulk read action; owner isolation; freshly retrieved journey links; links to commutes and pass management. Polling errors are visible. Background Web Push is described accurately. |
| Commute | Boston stations and coordinate endpoints, create/edit/pause/resume, time-zone-aware next scheduled departure, one-click search, and editable pass renewal reminders. DST gaps are skipped and repeated fall times are scheduled once. Pausing or editing a reminder does not depend on provider availability. |
| Profile | Edit traveler fare classes, assistance requests, trusted contact details and consent, and shortcut names. Open live or sample shortcuts in Planner with the right endpoint types. Existing security, privacy, notification and offline controls remain available. |
| Open Transit Lab | The measured MCP/provider/backup connection panel is available alongside existing agency, vehicle, alert, weather, micromobility and moderated-report tools. |
| Offline / recovery | Existing encrypted offline packs and hourly encrypted database backups remain in place. The new local launcher supervises the application and installed Boston routing processes, with bounded exponential restarts. |

All editable records are validated on the server, scoped to their owner, and protected by explicit version checks. Station shortcuts use provider coordinates; entered coordinates are validated against pilot coverage. Ticket edits validate ownership of linked journeys.

## Run locally

Stop any existing Wayline app instance, then run:

```powershell
npm run build
npm run pilot
```

The launcher uses the installed runtime in `.runtime/transit-runtime.json`, starts the app using `.env`, and starts local OTP when its configured port is free. Each managed process receives at most three restarts within ten minutes. If the retry budget is exhausted, inspect the log and restart the launcher after correcting the cause. An OTP process that was already running remains externally managed.

This is a local process supervisor, not a Windows startup service. Ollama remains separately managed. Routing needs time to load its graph; provider failures stay visible and never produce an automatic sample fallback. Local database snapshots still require an external destination to survive loss of the entire disk.

## Verification

- Full regression: **403/403 passing**, including account isolation, stale versions, retained ticket photos, atomic bulk inbox updates, DST schedules, transfer recovery and bounded process restarts. Log: `tmp/areas-regression.log`.
- Production build and generated offline shell passed. Log: `tmp/areas-build.log`.
- Browser verification used a separate temporary database: created and edited a Boston commute, paused/resumed it, searched five real South Station–Harvard OTP itineraries for the next travel day, saved a shortcut, reviewed/confirmed a trip, changed its departure by 27 minutes while preserving its identity, and cancelled the saved plan without deleting it.
- The saved journey displayed an NWS forecast for its departure date and a measured MBTA station guide. Wallet import/edit retained a self-reported fare and the itinerary-PDF link.
- At a 390px mobile viewport, wallet and trip-management controls fit; the cancellation review remained readable and usable. Content width was 375px with no horizontal page overflow.
- Lint on changed modules: no errors; existing hook-dependency warnings and one Fast Refresh helper-export warning remain.

## Remaining limitations

Real carrier-issued tickets, payment capture, inventory, refunds, automatic purchases/rebooking and live flight/rideshare dispatch require authorized provider agreements or accounts. No such actions have been enabled.

The broader roadmap still includes national routing coverage, verified indoor navigation/AR, native watch apps, calibrated reliability/prediction models, complete language coverage and validated fare/accessibility datasets. These are not represented as completed by this workspace pass. Web Push is wired, but end-to-end OS notification delivery still depends on a subscribed browser with permission; the previously tested browser blocked notifications.

See [CORE_LAUNCH.md](CORE_LAUNCH.md) for the core architecture and backup/restore operations, and [FEATURE_STATUS.md](FEATURE_STATUS.md) for the historical 105-feature inventory and external dependencies.
