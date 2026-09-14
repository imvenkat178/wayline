# Provider readiness

Wayline's local implementation is validated with fixture inventory and fixture supplier transports. **Supplier sandbox: not run. Authorized live-provider: not run.** Approval flags are operator assertions, not evidence that a provider granted access.

## Duffel flights and Cards

The implemented adapter covers offer search, fresh price and ancillary quotes, protected customer-card collection/authentication, order creation, order retrieval/reconciliation, cancellation and refund requests, and exchanges supported by the order. Review records bind the owner, draft version, exact itinerary, passenger input fingerprint, selected services, money, terms and expiry. Only confirmation of that exact review can enqueue a transaction.

Configure DUFFEL_ACCESS_TOKEN and enable external feeds only for an approved environment. DUFFEL_BOOKING_APPROVED enables documented order operations; DUFFEL_CARDS_APPROVED additionally enables card-funded purchases and exchanges. DUFFEL_LIVE_ENABLED must match the provider environment. Live operations additionally require DUFFEL_LIVE_CERTIFIED and an approved DUFFEL_TRANSACTION_RETENTION_DAYS / DUFFEL_RETENTION_POLICY_ID pair. Leave these gates false until permissions and certification are supplied. No saved cards or Wayline markup are implemented.

Use a provider-registered signing secret in DUFFEL_WEBHOOK_SECRET for POST /api/shopping/webhooks/duffel. Verify signatures against the raw request body. The implementation deduplicates events, reconciles delayed/uncertain outcomes through durable jobs, and never blindly resubmits an uncertain charge or order. Payment and issuance remain separate states. A refund request remains pending until settlement evidence exists.

Search coverage discloses requested airports and dates. Card surcharges and other mandatory unknown costs prevent an offer from being advertised as a complete cheapest fare. The protected pricing step obtains the card-specific surcharge before an exact purchase review.

Supplier ticket identifiers and payment records can be retrieved privately from the wallet or conversation. Current Duffel order responses used here supply e-ticket identifiers, not boarding-pass or ticket-PDF files. Imported documents remain accessible but do not grant authority to change or refund their tickets.

Official contracts: [Cards workflow](https://duffel.com/docs/guides/paying-with-customer-cards), [accurate pricing](https://duffel.com/docs/guides/getting-an-accurate-price-before-booking), [orders](https://duffel.com/docs/api/orders), [changes](https://duffel.com/docs/guides/changing-an-order), [webhooks](https://duffel.com/docs/guides/receiving-webhooks).

## FlightAware AeroAPI Standard

The implemented network adapter matches operating flight, airports and scheduled departure exactly. Configure FLIGHTAWARE_API_KEY, FLIGHTAWARE_STANDARD_APPROVED, FLIGHTAWARE_LICENSE_ID and FLIGHTAWARE_RETENTION_DAYS from the granted account terms. Retention must be explicitly positive and at most Wayline's 30-day storage ceiling; this ceiling is not a claim of contractual permission. Shorter fractional-day limits are supported. Missing or invalid retention disables the adapter.

Status and historical observations retain source and timestamp. Historical reliability requires a comparable cohort and reports sample counts and period; connection resilience is a separate measure. Monitoring requires opt-in consent and checks within 24 hours of travel. Stopping a monitor prevents late checks from committing alerts. Recovery verifies completed flights and the traveler's reached airport, then separates new cash, prior spending and pending refunds. Existing coupon usability is unknown unless the supplier verifies it.

Validate licensed uses, observation retention, alert delivery and account quotas before enabling network access. See [AeroAPI capabilities](https://www.flightaware.com/commercial/aeroapi/).

## Distribusion rail and bus

A validated integration contract exists, gated by granted US inventory and a partner documentation version. **The network implementation is deferred until those partner documents and contracted permissions are supplied.** Unsupported rail/bus offers or ticket operations are not fabricated. See [Distribusion rail integration](https://www.distribusion.com/rail-solutions).

## External provider checkout

The application accepts an explicitly injected checkout provider contract with approved HTTPS destinations, an environment, a documentation version and a createCheckout transport. This path binds owner, offer, draft version and expiry and rechecks them before redirecting. No external checkout transport is configured by default. Opening checkout never changes an order to purchased; the provider performs its final review and payment.

## Storage and rollout

Conversation deletion removes planning content, clarifications, monitoring consent and ephemeral protected inputs while retaining metadata needed to reconcile submitted transactions. Account deletion is blocked by unresolved transactions. Once reconciled, live transaction metadata is retained only under the configured contractual policy in an encrypted minimal archive; expired archives are cleaned up. Protected passenger/card inputs are removed after submission and are never supplied to the model.

Before enabling live gates, complete the provider's sandbox and certification requirements, register the webhook destination, verify collection/3DS/decline handling, payment-without-ticket recovery, duplicate and delayed events, cancellation/exchange/refund quotes, currency and card fees, and the actual permitted inventory. Fixture test success does not authorize live transactions.
