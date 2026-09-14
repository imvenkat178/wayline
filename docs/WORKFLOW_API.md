# Conversational workflow API

All application endpoints use the existing owner-scoped session. Mutating calls require the existing CSRF header. Supplier webhooks use their own raw-body signature verification. Do not send passenger identities, passwords, card numbers or authentication codes to the conversation endpoints.

## Conversations and migration compatibility

GET /api/conversation-actions exposes the shared action definitions. The server schema and generated TypeScript controls originate in shared/travelerActions.mjs.

POST /api/conversations creates a persistent conversation; GET /api/conversations/:id returns the current draft, retained turns, exact result references, pending clarification and execution state. Existing draft versions and histories continue to load with migration defaults.

POST /api/conversations/:id/turns accepts input, a unique clientTurnId, expectedVersion and optional visibleSetId. Direct controls may supply a validated command. Language turns use Llama. Without async, existing callers receive the completed synchronous response. With async: true, the response is HTTP 202 and background execution continues independently of the browser request.

GET /api/conversations/:id/executions/:executionId?after=N replays events after a sequence cursor. POST to that execution's /cancel or /retry endpoint controls planning work. A repeated clientTurnId replays the same execution only when the request hash matches. Version conflicts and mismatched option/result identities are rejected. Pending clarification answers are bound to the draft version.

Stopping planning discards late cancellable results. It does not cancel a submitted supplier operation; those jobs keep reconciling until an authoritative outcome is known.

## Protected booking and servicing

1. GET /api/shopping/booking/capabilities checks authorized operations and environment.
2. GET /api/shopping/booking/services?conversationId=... retrieves available ancillary choices. POST /api/shopping/booking/card-key obtains a provider component key only when card collection is authorized.
3. POST /api/shopping/booking/details stores validated, encrypted passenger details and provider card references outside model context. It is bound to conversationId and draftVersion.
4. POST /api/shopping/booking/reviews obtains a fresh quote for book, cancel, exchange or refund. Exchange selection comes from /booking/order-sections and POST /booking/change-options. Imported ticket records are not supplier orders.
5. Review the returned exact itinerary, passengers, selected services, amount, currency, terms, expiry and review identifier. POST /api/shopping/operations requires reviewId, an idempotency key, confirmed: true, the review's confirmationToken, and the provider authentication session when required. This returns HTTP 202. A changed or expired quote requires a new review.
6. GET /api/shopping/operations/:id retrieves durable progress. GET /api/shopping/orders/:id retrieves the authoritative recorded outcome. GET /api/shopping/booking/current?conversationId=... resumes active reviews and operations after reload.

GET /api/shopping/orders/:id/documents returns supplier ticket identifiers, explicitly distinguishing these from boarding passes. GET /api/shopping/orders/:id/receipt returns the Wayline payment record with charges, pending refunds and credits separately identified. Neither route invents supplier-issued files.

POST /api/shopping/webhooks/duffel accepts signed provider events. Financial submissions persist intent before network calls and are never retried blindly after uncertain outcomes.

## Recovery, monitoring and utilities

POST /api/shopping/orders/:id/recovery validates the order version, completed service prefix, confirmed reached airport, boarding-ready time, destination and cash cap. It requires licensed exact-service observations. GET /api/shopping/recoveries/:id returns options with prior spending and cash required now separated. POST /api/shopping/recoveries/:id/draft creates a new planning conversation; it does not purchase or alter the original booking.

GET/POST /api/shopping/monitors lists or changes consented supplier-flight monitoring. Input includes orderId, orderVersion, enabled and explicit consent when enabling. Pausing prevents late status checks from committing alerts. Provider readiness remains mandatory.

Saved flight comparisons support GET /api/shopping/saved/:id/itinerary, /calendar and /itinerary.pdf, plus POST /share. Sharing is revocable through the existing shares endpoint. Encrypted offline packs are produced in the browser from the owner-scoped itinerary projection and require their passphrase to unlock.

POST /api/shopping/checkouts prepares an owner/version/expiry-bound provider handoff. Its returned /open endpoint validates the current selection and approved HTTPS destination before redirecting. Opening a link never confirms a purchase.

See [workflow coverage](TRAVELER_WORKFLOW_COVERAGE.md) for each action's automated tests, and [provider readiness](PROVIDER_READINESS.md) for gates and integration prerequisites.
