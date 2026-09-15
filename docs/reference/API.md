# API reference

Every HTTP endpoint the Wayline server handles, taken from the route handlers in `server/`. `tests/docs-reference.test.mjs` fails when the server gains an `/api/` path that this page does not name.

For the conversation and protected-booking sequences in more depth, see [WORKFLOW_API.md](../WORKFLOW_API.md). Configuration that switches endpoints on or off is in [CONFIGURATION.md](CONFIGURATION.md).

## Conventions

**Sessions.** Call `GET /api/bootstrap` first. Without a session it creates a guest account, sets the `wayline_session` cookie (HttpOnly, SameSite Strict, and Secure in production) and returns a `csrf` token. Every other `/api/` endpoint needs that session unless it is listed under [Public endpoints](#public-endpoints). An expired or missing session returns `401 SESSION_EXPIRED`.

**Changes.** Every `POST`, `PUT`, `PATCH` and `DELETE` request must:

- send the `x-csrf-token` header with the session's token (`403 CSRF` otherwise)
- come from the configured `PUBLIC_ORIGIN`, or in development from `DEV_CLIENT_ORIGIN` (`403` otherwise)
- not be a cross-site request according to `Sec-Fetch-Site` (`403`)
- send a JSON body of at most 1 MB, or 8 MB for `/api/records/ticket` and `/api/records/ticket/:id` (`413 BODY_TOO_LARGE`)

**Versions and idempotency.** Records carry a `version`. Updates that send a stale version return `409 VERSION_CONFLICT`. `POST /api/journeys` and `POST /api/commerce/orders` require an `Idempotency-Key` header; repeating a key with the same request returns the first result, and reusing it for a different request returns `409`.

**Rate limits.** Every client address is limited to 360 requests per minute. Endpoints below list any tighter limit. A limited request returns `429 RATE_LIMIT` with `Retry-After: 60`. Limits are per server process and key on the connection address (see ROADMAP G3.5 for proxies).

**Errors.** Failures return `{ "error": "message", "code": "CODE", "requestId": "uuid" }`, and every response carries an `x-request-id` header. Validation failures without a specific code use `400 INVALID_INPUT`. Unexpected failures return `500 INTERNAL_ERROR` with a generic message; details go only to the server log with the same request ID.

**Downloads.** PDF, calendar (`.ics`) and JSON exports are sent with `Content-Disposition: attachment` and `Cache-Control: no-store`.

## Public endpoints

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| GET | `/api/health` | Service status: version, uptime, assistant mode and provider status | No session |
| GET | `/api/bootstrap` | Session, CSRF token, signed-in user, cities, states, capabilities, journey transitions, operator links, pilot flag, configured map style URL, Web Push public key and MFA status | Creates a guest session when none exists; 20 guest sessions per address per hour |
| GET | `/api/shared/:token` | Read a journey or comparison someone shared | No session; 60 per address per minute |
| POST | `/api/shopping/webhooks/duffel` | Duffel webhook events that wake booking reconciliation | No session or CSRF. `X-Duffel-Signature: t=…,v1=…` is an HMAC-SHA256 of `t.` plus the raw body with `DUFFEL_WEBHOOK_SECRET`, within 300 seconds; body at most 1 MB; 120 per address per minute; `503` when the secret is unset |
| POST | `/api/commerce/webhook` | Sandbox settlement events that reconcile a sandbox order | No session or CSRF. `X-Sandbox-Signature` HMAC-SHA256 over the raw body with `SANDBOX_WEBHOOK_SECRET`; body at most 100 KB; 120 per address per minute; `401 INVALID_SIGNATURE` on a bad signature |

## Accounts, sessions and privacy

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | Turn the guest account into a registered account and start a new session | Registration details are validated by `store.register`; always creates a traveler role; 10 per address per 15 minutes |
| POST | `/api/auth/login` | Sign in with `email` and `password` | Returns `{user, csrf}`, or `{mfaRequired: true, pendingToken}` when MFA is on; 10 per address per 15 minutes |
| POST | `/api/auth/mfa-verify` | Finish an MFA sign-in with `pendingToken` and `code` | A wrong code keeps the 5-minute challenge usable; 10 per address per 15 minutes |
| POST | `/api/auth/logout` | End the session and detach its push subscriptions | |
| POST | `/api/auth/recovery/request` | Request a password reset link for `email` | Same response whether or not the address has an account; returns `ok: false` while only the log-only email provider is configured; 5 per address per 15 minutes |
| POST | `/api/auth/recovery/reset` | Set a new `password` with a reset `token` | Single-use, short-lived token; 10 per address per 15 minutes |
| GET | `/api/sessions` | List this account's signed-in devices | |
| POST | `/api/sessions/revoke-others` | Sign out every other device | |
| DELETE | `/api/sessions/:id` | Sign out one device | |
| POST | `/api/mfa/setup` | Start TOTP enrollment; returns the secret URL and a QR code | Replacing an active factor requires `replaceCode` from it; 10 per user per 15 minutes |
| POST | `/api/mfa/confirm` | Confirm enrollment with `code`; returns one-time recovery codes | 10 per user per 15 minutes |
| POST | `/api/mfa/disable` | Turn MFA off with a current `code` | 10 per user per 15 minutes |
| PUT | `/api/profile` | Update `name` (up to 100 characters) and `preferences` | |
| GET | `/api/privacy/export` | Download every record, session, MFA status and share for this account as JSON | Attachment `wayline-data.json` |
| DELETE | `/api/privacy/history` | Delete trip history | Body `{"confirm": "DELETE"}` |
| DELETE | `/api/privacy/account` | Delete the account and sign out | Body `{"confirm": "DELETE"}`; `409 RECONCILIATION_PENDING` while submitted supplier transactions are unresolved |
| GET | `/api/audit` | This account's audit events | |
| GET | `/api/shares` | List share links this account created | |
| DELETE | `/api/shares/:id` | Revoke a share link | |

## Trip planning and saved journeys

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| GET | `/api/places?q=` | Search Boston stations and places through the travel service | 60 per user per minute |
| POST | `/api/search` | Search for trips and store an owned search snapshot | 30 per user per minute; Boston routing errors include `ROUTING_TIMEOUT`, `ROUTING_UNAVAILABLE`, `OTP_SCHEMA_ERROR` and `PROVIDER_REQUIRED` |
| GET | `/api/journeys` | List saved journeys with tracking freshness recomputed now | |
| POST | `/api/journeys` | Save a journey from an owned, unexpired search snapshot | Requires `Idempotency-Key` |
| GET | `/api/journeys/:id` | One saved journey | |
| DELETE | `/api/journeys/:id` | Delete a journey and its tickets, claims, alerts, assistant messages, recoveries and pending actions | One transaction |
| POST | `/api/journeys/:id/state` | Move a journey to another `state`, sending its current `version` | Only allowed transitions; see `transitions` in bootstrap |
| POST | `/api/journeys/:id/twin` | What-if snapshot for `delayMinutes` (0–480), `weather` (`clear`, `rain`, `snow`, `heat`) and `accessibilityOutage` | Does not change the journey |
| GET | `/api/journeys/:id/receipt` | Journey estimate receipt as JSON | Not proof of purchase |
| GET | `/api/journeys/:id/calendar` | Calendar file for the journey | Sample journeys are prefixed `SAMPLE:` |
| GET | `/api/journeys/:id/itinerary.pdf` | Branded itinerary PDF including linked tickets | 20 per user per minute |
| POST | `/api/journeys/:id/share` | Create an expiring, revocable share link | |
| POST | `/api/journeys/:id/claim` | Draft a refund or reimbursement request with `reason` and `expensesCents` (0–1,000,000) | Draft only; never submitted |
| POST | `/api/journeys/:id/recovery` | Save an alternative from `searchId` and `journeyId` for review, with incremental cost | No seat held or money moved; expires at departure or after 15 minutes |
| GET | `/api/journeys/:id/recoveries` | Prepared and applied recovery options for the journey | |
| POST | `/api/journeys/:id/prepare-recovery` | Search fresh alternatives after a disruption | 12 per user per minute; `503 DISRUPTIONS_UNAVAILABLE`, `409 ROUTE_DISRUPTED` |
| POST | `/api/journeys/:id/change` | Create a pending change action to review and confirm | |
| POST | `/api/journeys/:id/tracking` | Match live MBTA vehicles to the journey's exact trips | Provider journeys only; `409` for sample journeys |
| GET | `/api/journeys/:id/weather` | Departure weather for a journey with resolved coordinates | 20 per user per minute; `409` without a resolved location |
| GET | `/api/commutes/:id/next` | Search parameters for a commute's next departure | `409` when paused or unscheduled |
| POST | `/api/agent/actions` | Create a reviewable trip action | 30 per user per minute |
| POST | `/api/agent/actions/:id/confirm` | Confirm a reviewed action | 30 per user per minute; `409 ACTION_EXPIRED`, `PRICE_CHANGED`, `VERSION_CONFLICT` |

## Saved records, alerts and Guardian

`/api/records/:kind` stores owner-scoped, encrypted records. `:kind` is one of `favorite`, `traveler`, `contact`, `commute`, `pass`, `ticket`, `report`, `claim`, `recovery`, `alert` or `push-subscription`.

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| GET | `/api/records/:kind` | List records of a kind | Commutes include `nextDeparture` |
| GET | `/api/records/:kind/:id` | One record | `404 NOT_FOUND` when it is not yours |
| POST | `/api/records/:kind` | Create a record, validated by `server/records.mjs` | Favorites and commutes resolve their route; reports expire after 7 days and gain `confirmations` and `confidence`; push subscriptions are tied to this session, upserted by endpoint and capped at 20 per account |
| PATCH | `/api/records/:kind/:id` | Update a favorite, commute, pass, ticket, traveler or contact with its current `version`, or mark an alert read | `409 VERSION_CONFLICT` on a stale version |
| DELETE | `/api/records/:kind/:id` | Delete a record | |
| POST | `/api/alerts/read` | Mark up to 1,000 alert `ids` read in one transaction | |
| POST | `/api/guardian/check` | Run Guardian for this account now and return its alerts | |

## Assistant and conversations

Conversation input must not contain passenger, contact, account, password, authentication or payment details; those requests return `400 PROTECTED_INPUT_REQUIRED` and belong in the protected booking forms.

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| POST | `/api/agent` | Ask the grounded journey assistant; optional `journeyId`, or `searchId` with `candidateId` | `input` up to 2,000 characters; 20 per user per minute |
| GET | `/api/agent/history` | Last 30 assistant messages with pending action status | |
| GET | `/api/conversation-actions` | The shared registry of traveler actions | From `shared/travelerActions.mjs` |
| GET | `/api/conversations` | List trip conversations | |
| POST | `/api/conversations` | Create a trip conversation | 20 per user per minute |
| GET | `/api/conversations/:id` | Draft, turns, results, clarification and execution state | |
| POST | `/api/conversations/:id/turns` | Send `input` with `clientTurnId` and `expectedVersion`, or a validated direct `command` | 40 per user per minute; `async: true` returns `202`; `409 TURN_PENDING`, `IDEMPOTENCY_CONFLICT`, `VERSION_CONFLICT` |
| GET | `/api/conversations/:id/executions/:executionId?after=` | Replay execution events after a sequence number | |
| POST | `/api/conversations/:id/executions/:executionId/cancel` | Stop planning work | Does not cancel a submitted supplier operation |
| POST | `/api/conversations/:id/executions/:executionId/retry` | Retry planning work | |

## Flights and supplier shopping

These endpoints depend on supplier configuration. Without approved access they return `503 SUPPLIER_REQUIRED`, `FLIGHT_STATUS_UNAVAILABLE` or `CHECKOUT_UNAVAILABLE`, or `501 SUPPLIER_OPERATION_DISABLED`.

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| GET | `/api/shopping/capabilities` | Which shopping features this deployment allows | |
| GET | `/api/shopping/airports?q=` | Airport suggestions from the supplier directory | 30 per user per minute |
| POST | `/api/shopping/searches` | Start a queued comparison with `request` and `key` | `202`; 6 per user per minute |
| GET | `/api/shopping/searches/:id` | Search progress and results | |
| POST | `/api/shopping/searches/:id/cancel` | Cancel a search with its `version` | |
| POST | `/api/shopping/searches/:id/review` | Revalidate one `offerId` for review | `201`; 10 per user per minute |
| POST | `/api/shopping/reviews/:id/confirm` | Save a reviewed comparison | `409 OFFER_CHANGED` or `CONNECTION_CHANGED` when it moved; never issues a ticket |
| GET | `/api/shopping/saved` | Saved comparisons | |
| GET | `/api/shopping/saved/:id/itinerary` | Itinerary projection of a saved comparison | |
| GET | `/api/shopping/saved/:id/calendar` | Calendar file | 20 exports per user per minute |
| GET | `/api/shopping/saved/:id/itinerary.pdf` | Itinerary PDF | 20 exports per user per minute |
| POST | `/api/shopping/saved/:id/share` | Share a saved comparison | Revoke through `/api/shares/:id` |
| GET | `/api/shopping/watches` | Price watches | |
| POST | `/api/shopping/watches` | Create a price watch | `409 WATCH_NOT_PERMITTED` unless the supplier allows background shopping |
| POST | `/api/shopping/watches/:id/cancel` | Cancel a watch with its `version` | |
| GET | `/api/shopping/monitors` | Flight monitors and whether licensed status is available | |
| POST | `/api/shopping/monitors` | Turn monitoring on or off with `orderId`, `orderVersion`, `enabled` and consent | |
| POST | `/api/shopping/checkouts` | Prepare a provider checkout handoff | 10 per user per minute |
| GET | `/api/shopping/checkouts/:id/open` | Revalidate and redirect to the approved provider checkout | `303` redirect; never confirms a purchase |

## Protected booking and servicing

Booking runs only when Duffel booking is approved (see [CONFIGURATION.md](CONFIGURATION.md#flights-and-suppliers)). The model never receives passenger or card details.

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| GET | `/api/shopping/booking/capabilities` | Authorized operations, live mode and checkout availability | |
| GET | `/api/shopping/booking/services?conversationId=` | Available extras for the selected offer | `409` before an offer is selected |
| POST | `/api/shopping/booking/card-key` | Provider card component key | 10 per user per minute; `501` unless card booking is approved |
| POST | `/api/shopping/booking/details` | Store encrypted passenger details and card references for a conversation | |
| POST | `/api/shopping/booking/reviews` | Fresh quote for book, cancel, exchange or refund | 10 per user per minute |
| GET | `/api/shopping/booking/reviews/:id` | One booking review | |
| GET | `/api/shopping/booking/current?conversationId=` | Active reviews and operations for a conversation | |
| GET | `/api/shopping/booking/order-sections?orderId=` | Order sections that can be changed | |
| POST | `/api/shopping/booking/change-options` | Exchange options for `orderId` and `change` | `201`; expires after 5 minutes; 10 per user per minute |
| POST | `/api/shopping/operations` | Submit a confirmed review | `202`; 10 per user per minute; `501` unless booking is authorized |
| GET | `/api/shopping/operations` | Booking operations | |
| GET | `/api/shopping/operations/:id` | Durable progress of one operation | |
| GET | `/api/shopping/orders` | Supplier orders | |
| GET | `/api/shopping/orders/:id` | One supplier order | |
| GET | `/api/shopping/orders/:id/documents` | Supplier ticket identifiers | JSON attachment; not boarding passes |
| GET | `/api/shopping/orders/:id/receipt` | Wayline payment record | JSON attachment; not a supplier receipt |
| POST | `/api/shopping/orders/:id/recovery` | Prepare flight recovery options | 6 per user per minute; needs licensed flight status |
| GET | `/api/shopping/recoveries/:id` | Recovery options with spending separated | |
| POST | `/api/shopping/recoveries/:id/draft` | Start a planning conversation from `candidateId` | Does not change the original booking |

## Transit data and calculators

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| GET | `/api/travel/health` | Travel service connections, last check and backup status | |
| POST | `/api/travel/check` | Start a connection check and return current status | `202`; 6 per user per minute |
| GET | `/api/stations/:id` | Station guide from the catalog or the travel service | Facilities are not verified |
| GET | `/api/registry?q=&state=` | Curated agency registry with provider health | Not a complete national inventory |
| GET | `/api/discovery?from=&to=` | Agencies serving a pair of places | |
| GET | `/api/mbta/vehicles` | Live MBTA vehicle positions | `503 FEED_DISABLED` when external feeds are off |
| GET | `/api/mbta/alerts` | MBTA service alerts | |
| GET | `/api/gbfs` | Bike and scooter availability from `GBFS_URL` | |
| GET | `/api/gtfs-rt/:sourceId` | Decoded GTFS-Realtime feed from `TRANSIT_SOURCES_FILE` | `404` for an unknown source |
| GET | `/api/weather?lat=&lon=` | Weather for a location | |
| GET | `/api/geocode?q=` | Geocode an address of up to 180 characters | Needs `GEOCODER_USER_AGENT` |
| POST | `/api/route` | Street route from `VALHALLA_URL` | |
| POST | `/api/fares/compare` | Compare entered single, weekly and monthly fares | Calculator only |
| POST | `/api/airport/deadline` | Latest departure to reach an airport in time | Calculator only |
| GET | `/api/analytics` | Planned and completed trip totals, estimated budget and sample carbon | No spending or on-time data |
| GET | `/api/community?station=` | Rider reports for a station in the last hour | Hidden until enough distinct riders report |

## Operator tools

All operator endpoints return `403` unless the signed-in account has the operator role. There is no self-service way to get that role yet (ROADMAP G3.4).

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| GET | `/api/operator` | Data-quality reports by type, withheld below the minimum rider count | No identities or precise locations |
| GET | `/api/operator/reports` | Open and reviewing reports to moderate | |
| PATCH | `/api/operator/reports/:id` | Change a report's status and resolution note | |

## Sandbox commerce

A state machine for quotes and orders that uses synthetic payments only. It moves no money and issues no tickets.

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| POST | `/api/commerce/quotes` | Create a sandbox quote | |
| GET | `/api/commerce/orders` | Sandbox orders | |
| POST | `/api/commerce/orders` | Place a sandbox hold on a quote | Requires `Idempotency-Key` |
| POST | `/api/commerce/orders/:id/confirm` | Capture a held order | `409 INVALID_TRANSITION` from the wrong state |
| POST | `/api/commerce/orders/:id/exchange` | Exchange to another `quoteId` | |
| POST | `/api/commerce/orders/:id/cancel` | Cancel, refunding a captured payment | |

## Retired paths

| Path | Behaviour |
| --- | --- |
| `/api/booking` and `/api/payments` (any method, any subpath) | `409 PROVIDER_REQUIRED`: ticketing and payments go through the supplier endpoints above |
| Any other unknown `/api/` path | `404 NOT_FOUND` |

## Error codes

| Code | Status | Meaning |
| --- | --- | --- |
| `INVALID_INPUT` | 400 | A field failed validation |
| `PROTECTED_INPUT_REQUIRED` | 400 | Sensitive details were sent to the assistant instead of a protected form |
| `PLACE_REQUIRED`, `AIRPORT_REQUIRED` | 400, 409 | Choose an exact place, station or airport |
| `INVALID_SHOPPING_REQUEST`, `INVALID_EVENT` | 400 | A comparison request or webhook event is malformed |
| `SESSION_EXPIRED` | 401 | Reload to get a new session |
| `INVALID_SIGNATURE` | 401 | A webhook signature is missing or wrong |
| `CSRF` | 403 | The `x-csrf-token` header is missing or stale |
| `NOT_FOUND` | 404 | The endpoint or record does not exist for this account |
| `VERSION_CONFLICT` | 409 | The record changed; reload it and retry |
| `IDEMPOTENCY_CONFLICT`, `TURN_PENDING` | 409 | A conversation message ID was reused, or another turn is still running |
| `ACTION_EXPIRED`, `PRICE_CHANGED`, `OFFER_CHANGED`, `CONNECTION_CHANGED`, `DRAFT_CHANGED` | 409 | A review is out of date; prepare a new one |
| `ROUTE_DISRUPTED` | 409 | A confirmed closure or cancellation affects the route |
| `INVALID_TRANSITION` | 409 | A sandbox order cannot move to that state |
| `RECONCILIATION_PENDING` | 409 | Supplier transactions must settle before account deletion |
| `WATCH_NOT_PERMITTED`, `BACKGROUND_NOT_PERMITTED` | 409 | The supplier does not allow background shopping |
| `FLIGHT_IDENTITY_REQUIRED`, `FLIGHT_OBSERVATION_UNAVAILABLE`, `SERVICING_REVIEW_REQUIRED` | 409 | Flight status or servicing needs more exact information |
| `PROVIDER_REQUIRED` | 409, 503 | The feature needs a provider that is not connected |
| `BODY_TOO_LARGE` | 413 | The request body exceeds its limit |
| `RATE_LIMIT`, `SUPPLIER_BUSY` | 429 | Too many requests; retry after the stated delay |
| `INTERNAL_ERROR` | 500 | Unexpected failure; quote the `requestId` |
| `SUPPLIER_OPERATION_DISABLED` | 501 | Supplier booking, exchange, refund or payment is not authorized |
| `UPSTREAM_ERROR`, `OTP_SCHEMA_ERROR`, `INVALID_FLIGHT_RESULT` | 502 | A provider returned an error or unreadable data |
| `FEED_DISABLED`, `MCP_UNAVAILABLE`, `ROUTING_TIMEOUT`, `ROUTING_UNAVAILABLE`, `DISRUPTIONS_UNAVAILABLE` | 503 | A data source or the travel service is off or unreachable |
| `SUPPLIER_REQUIRED`, `FLIGHT_STATUS_UNAVAILABLE`, `AIRPORT_LOOKUP_UNAVAILABLE`, `CHECKOUT_UNAVAILABLE`, `GROUND_PROVIDER_UNAVAILABLE` | 503 | Supplier access is not configured or approved |
