# Cheapest complete trips with flights and AI recovery

Status: implementation instructions approved in scope by the user on 12 September 2026; proposed capabilities below are not implemented by this documentation change.

Baseline: main at `0f02d7a0f146ea07fb3999fdf66e3a725ef50727`. Read the [current code review](REVIEW_2026-09-12.md) before starting. The Boston implementation in [CORE_LAUNCH.md](CORE_LAUNCH.md) is the foundation. Keep the original [105 requirements](ORIGINAL_REQUIREMENTS.md); this plan changes implementation priority and expands flight coverage.

## 1 Product objective

Wayline should find the lowest complete-trip cost among the valid offers it can actually search, explain the tradeoffs, and help the traveler recover if a flight, bus or train is late, cancelled or missed.

The primary search runs from the traveler's actual starting point to the final destination. Compare ground-only travel, flights with airport access, and mixed itineraries in the same results. A flight price alone is insufficient when the airport transfers cost more than the apparent saving.

Use the result label **Lowest complete price found** with search time, searched providers, dates and coverage. Do not promise the universally cheapest ticket: inventory, provider coverage, freshness and the bounded search all limit that statement. While providers are still responding, identify the result as provisional.

Initial commercial scope: domestic US travel, economy, one-way and round-trip, with adults/children, explicit baggage requirements, and a small set of supported corridors. International, open-jaw and complex multi-city requests should return an honest unsupported result until their entry, transit, fare and servicing requirements are implemented. The data model must support them without treating them as already available.

## 2 Search and result experience

### Required inputs

- Exact origin and final destination, with optional nearby airport/station radius.
- Departure window and optional final arrival deadline, each with an explicit timezone.
- One-way or round-trip; return date/window when applicable.
- Passenger types and ages when required by the supplier. Show group total prominently and per-person amounts secondarily.
- Personal item, cabin bag and checked bag requirements, including quantity per passenger.
- Hard total budget; optional separate maximum extra cash for disruption recovery.
- Allowed modes, maximum duration/transfers/walking, accessibility requirements and overnight preferences.
- Whether separate tickets and airport changes are acceptable. Default to through-ticket air connections and simple ground access; require explicit opt-in for air self-transfers.
- Flexibility in dates, airports and arrival time. Do not silently relax a hard constraint.

Offer normal controls and chat over the same request object. Example: “Find the cheapest way from downtown LA to San Jose, leaving tonight, arriving before noon, one cabin bag, total under $100. Show a backup if I miss a connection.” This is a product example, not a live fare claim.

### Results

Each card shows total group cost; price completeness and last checked time; door-to-door duration; every paid and walking leg; baggage; layovers; seller; ticket groups; separate-ticket warnings; arrival date/timezone; and backup availability. Expand the card for itemized costs and the connection calculation.

Use separate views for **Lowest complete price**, **Fastest**, and **More resilient**. Price sorting must remain actual money ordering after feasibility filters. Do not hide reliability penalties inside the price or change rankings based on affiliate commission. Unknown/indicative totals belong in a visibly separate group and cannot win the cheapest badge.

For incomplete coverage say which part could not be priced, such as the destination shuttle. Offer manual verification or another complete itinerary. If nothing meets the budget, show the minimum verified overage and ask whether to change a constraint; never widen the budget automatically.

## 3 Complete pricing and recovery economics

### New-trip price

Compute the whole party's required outlay using integer minor units and explicit currency:

`required total = ticket-group totals + required extras not already included + access/egress transport + required connection transport + unavoidable overnight accommodation + applicable checkout charges`

Ticket-group totals may already include multiple passengers, taxes, bags, or segments. Record inclusion metadata and charge scope so these amounts are never multiplied or added twice. Optional seats/meals/insurance are excluded until selected. If the itinerary requires a hotel and no price exists, the complete total is unknown. If parking or driving access is selected, include its stated cost assumptions.

Store money as `amountMinor`, `currency` and the currency's minor-unit scale; do not assume every currency has two decimal places. Preserve the supplier's settlement amount. Any display conversion needs an exchange-rate source, timestamp, rounding rule and explicit distinction from the amount charged.

Every cost component needs `source`, `observedAt`, `expiresAt` where applicable, `status` (live offer / published tariff / estimate / unknown), passenger/segment scope and inclusion references. An unknown is never zero. Published local transit fares can be calculated with versioned rules and eligibility, but do not imply a reserved seat.

The existing sample `priceBreakdown()` adds fixed fees and bag allowances. Retain it only for labeled examples. Implement a new fare component model for live search.

### Additional cash during recovery

Replace the current `alternative - original paid - retained legs` calculation. Money already spent is not automatically available to buy a replacement.

Keep these separate:

1. **Cash required now:** new purchases and exchange charges less credits the supplier can actually apply to this transaction now.
2. **Refund expected later:** only a supplier-confirmed refundable amount, with status and timing; an unapproved claim is not a refund.
3. **Final trip spend:** original money spent plus new spending minus refunds actually received, with any pending refund shown separately.
4. **Change in estimated plan price:** an optional comparison metric, clearly distinct from extra cash.

Example: a traveler already paid $100, with no refund/credit available, and needs an $80 replacement. Cash needed now is **$80**, and total spend becomes **$180**. It is not a $20 saving. If a $50 cash refund is confirmed for later, immediate cash is still $80; the projected net spend is $130 after that refund arrives. Prevent double counting a credit as both reduced payment and a later refund.

Allocate paid tickets, usable segments, exchanges, credits and refunds by ticket group/passenger. The present code selects only the first paid ticket for a journey; that cannot model a bus plus flight plus train purchase. Preserve flown/completed segments and the original financial ledger when the remaining route changes.

## 4 Data and provider contracts

Keep React/TypeScript, Node, the existing LangGraph flow and the private travel MCP process. Separate domain responsibilities before considering new services or databases. The current single-process SQLite deployment can support a bounded pilot if queue and capacity evidence remain acceptable.

### Domain objects to add

| Object | Required information |
| --- | --- |
| SearchRequest | Locations, departure/arrival windows, passenger mix, bags, budget, preferences, allowed modes, flexibility, policy version |
| Place | Stable ID, airport/station/address type, IATA/ICAO or provider IDs, coordinates, IANA timezone, parent terminal/station |
| ServiceInstance | Operator, operating and marketing carrier, flight/trip identifier, service date, endpoints, scheduled times and observed times |
| Offer | Supplier and seller IDs, passenger scope, complete set of purchasable segments, amount/currency, fare conditions, inventory status, expiry |
| TicketGroup | Segments sold together, seller, order/PNR/ticket references when issued, separate-ticket boundary and documented protection |
| Connection | Arrival/departure service instances, physical transfer path, required time components, slack, baggage handling and protection evidence |
| Itinerary | Ordered legs, attached offers, cost components, constraints, excluded/unknown facts and overall search coverage |
| Observation | Provider event ID/version, observation and receipt times, scope, freshness and supersession |
| RecoveryPlan | Trigger, current reachable location, retained segments, alternatives, immediate cost, deadline impact, expiry and action state |
| PriceWatch | Canonical query, bag/passenger assumptions, threshold, permitted supplier, schedule, expiry, consent and dedupe state |
| BookingOperation | Owner, reviewed offer version, idempotency key, intended effect, provider reference, payment/issuance/refund states and audit events |

Model an airline through-fare as an indivisible purchasable offer. Do not extract its cheap segments and assume each can be bought independently. Round-trip fares also need their original offer boundaries. A displayed route and a purchasable ticket are different entities.

### Provider selection

Choose access after a small coverage/price-completeness evaluation on the actual launch routes. A vendor's public network claims do not establish the inventory enabled for Wayline's account.

| Layer | Candidate and rationale | Integration condition |
| --- | --- | --- |
| Flight shopping and later orders | Evaluate Duffel first because its documented offer/order lifecycle includes expiry and extra services | Validate carriers, bags, changes, live access, commercials and permitted background usage for the account |
| Additional flight comparison | Skyscanner partner integration can add user-initiated live search and seller handoff | Access and display rules apply; this is not an unrestricted background pricing feed |
| Intercity bus and rail | Evaluate Distribusion or individual authorized carrier integrations | Confirm US route, fare, refund and booking coverage in the actual agreement |
| Local airport/station access | Existing OTP/GTFS/MBTA path, then other region adapters | Add supported local fare rules and time-specific access/egress searches |
| Flight disruption/status | Airline/order notifications and, if needed, a commercial flight-status provider such as FlightAware AeroAPI | Status coverage and commercial usage rights must be checked separately from ticket shopping |

Duffel offers contain expiry and passenger-wide pricing, and a refreshed offer may still change or become unavailable before booking. Additional services must be priced from the current response. Implement explicit refresh/review behavior. [Duffel Offers](https://duffel.com/docs/api/v2/offers)

Skyscanner live results use create/poll and may initially be incomplete. Its indicative prices are cached exploratory values, unsuitable as confirmed checkout totals. [Live search](https://developers.skyscanner.net/docs/flights-live-prices/overview), [indicative search](https://developers.skyscanner.net/docs/flights-indicative-prices/overview)

Skyscanner's published guidelines require user-generated live requests and prohibit automated live calls without user action. Therefore a recurring price-watch or unattended recovery search must use another supplier whose agreement permits it, or a specifically approved arrangement. An opted-in watch must not be assumed to override those API rules. [Usage guidelines](https://developers.skyscanner.net/docs/getting-started/usage-guidelines)

Distribusion documents rail search, ticketing and post-booking operations. Treat it as a candidate requiring coverage verification, not an implemented Amtrak/bus booking channel. [Rail solutions](https://www.distribusion.com/rail-solutions)

FlightAware documents flight status and alerts, with usage/storage distinctions between personal and commercial tiers. It fills a status role; it does not replace a fare/booking adapter. [AeroAPI](https://www.flightaware.com/commercial/aeroapi/)

References checked 12 September 2026. No vendor account, price quote, contract or purchase was created in this review. Do not assume comprehensive live flight/intercity shopping is free because local routing and local models can run without paid API accounts.

### Adapter interface

Expose capabilities separately: `search`, `refreshOffer`, `getStatus`, `getFareConditions`, `hold`, `book`, `cancel`, `exchange`, `refund`, `backgroundShoppingAllowed`, and `priceHistoryAllowed`. Unsupported capabilities must fail explicitly.

Track account-specific coverage, required inputs, data/retention terms, timeouts, rate limits and currency. Use a canonical cache key including dates, passenger ages/types, bags, cabin, market, currency and fare eligibility. Do not share passenger-specific/private fares through a generic public cache. Bound concurrency, response bytes, retries and spend per search/watch.

## 5 Multimodal search implementation

The current OTP query requests five transit itineraries with no fares. Sorting those five cannot establish a cheapest flight/bus/train result.

Implement an orchestration layer above mode providers:

1. Resolve exact locations and timezones. Generate a bounded set of nearby airports/stations using actual reachability and transfer cost, not distance alone.
2. Generate direct ground, direct/through-ticket air, and mixed candidate families. Search both ends of the flight so an inexpensive destination airport does not hide an expensive late-night transfer.
3. Use regional routing to reach departure hubs by their required check-in times and leave arrival hubs after applicable airport procedures. Evaluate service calendars and last departures.
4. Fetch intact purchasable intercity offers for the requested party and baggage. Use supplier-supported flexible-date methods or permitted candidate queries within a call budget.
5. Join time-compatible offers and local legs. Reject impossible transfers, excluded modes, excessive duration/walking and violated arrival deadlines before ranking.
6. Retain useful alternatives across cost, duration and connection slack. A cheap arrival at a hub may be useless after the next departure has left, so pruning must retain time and ticket-state compatibility.
7. Calculate complete totals. Rank fully priced feasible itineraries by actual total; use duration and transfers as deterministic tie-breakers. Keep uncertain prices separately visible.
8. Return incremental results with provider progress, unavailable sources and a `partial` / `complete-within-scope` / `failed` status. Support cancellation and ignore responses from superseded searches.
9. Refresh all selected paid offers and recalculate the complete itinerary before booking or handoff. If price/conditions change, show the difference and require a fresh review.

Do not run unrestricted combinations of every airport, every date and every provider. Start with explicit product bounds, measure recall against a larger offline fixture set, and expose that scope. Store the query, provider coverage and pruning policy with the search so ranking can be replayed. “Complete within scope” does not mean all market inventory was searched.

## 6 Connection validity

Replace the generic few-minute recovery buffer with connection-type rules.

- Ground to air: verified arrival location, terminal travel, check-in/bag-drop cutoff when applicable, security allowance and boarding cutoff.
- Air to ground: actual arrival, deplaning, bag collection when applicable, border procedures when applicable, and travel to the ground departure point.
- Air to air on one ticket: supplier-provided connection and itinerary conditions, terminal changes and updated arrival information.
- Air self-transfer: explicitly separate tickets, bag reclaim/recheck where applicable, security/border steps and additional transfer time. Do not call it protected without a specific applicable contract.
- Ground to ground: actual platforms/stops, walking accessibility, station operating hours and next-service calendar.

Use the larger applicable requirement when a provider minimum and an operational time calculation overlap; avoid double-counting the same procedure. Store each assumption and policy version. Missing critical transfer information prevents a “verified feasible” label. Time policies are contextual defaults until validated, not universal promises such as “all airport connections need two hours.”

## 7 Delay monitoring and backup recovery

Reuse the durable queue, separate live observations, disruption matching and reviewed actions. Generalize the MBTA-only refresh into provider-specific service-instance subscriptions.

Monitor flight delays/cancellations/diversions, ground delays/cancellations, gate/terminal changes, reduced connection slack, missed departures and the last usable service. Match a flight by operator, flight number, date, origin and destination, including codeshare relationships. Track source observation time separately from receipt time; a new fetch does not make an old event fresh.

Define recovery states: `monitoring`, `at_risk`, `alternatives_ready`, `awaiting_review`, `revalidating`, `applying`, `recovered`, `needs_manual_help`, `expired`. Journey state, ticket state and payment state remain separate.

For each event:

1. Confirm that the event affects a remaining segment. Suppress duplicates and older updates.
2. Determine where the traveler can actually start an alternative. A delay does not prove they are still at the origin or already aboard. Use verified trip progress, optional consented location, or a quick “Are you on board?” question.
3. Preserve completed segments and usable tickets. Recalculate downstream connections and the original arrival deadline.
4. Search from that location/time using providers permitted for automatic shopping. Ask the user to launch a search when supplier terms require user action.
5. Produce the cheapest feasible recovery, earliest arrival and a more resilient alternative when distinct valid options exist. Consider another flight, a different airport plus ground travel, a train, bus or necessary overnight stay. Do not fabricate three options when only one exists.
6. Show additional cash now, confirmed later refunds/credits, arrival change, baggage consequences, seller/protection and expiry. Identify backups sharing the same disruption exposure; two routes using the same cancelled train are not independent backups.
7. Notify through the existing preference-aware outbox. Re-check opt-outs, quiet hours, active account/device, relevance and expiry at delivery.
8. Refresh inventory, fare and transfer validity immediately before applying a reviewed action. A saved backup is not a reservation. A hold needs a supplier reference and expiry.

If no feasible alternative exists, say so and offer supplier contact details and the current itinerary. Never turn missing GPS into cancellation. Avoid repeated auto-search loops for an unchanged disruption by deduping the event/itinerary/policy version.

## 8 AI agents throughout the existing product

Use logical agents with typed inputs, bounded tools and durable state. They can run in the existing process; a separate model call or microservice for every arithmetic task is unnecessary.

| Agent responsibility | Existing system to extend | Authority |
| --- | --- | --- |
| Intent and preference | `agentTools.mjs`, chat, Planner controls | Extract dates/budget/bags/modes; clarify missing data; update preferences after explicit consent |
| Search coordinator | Travel MCP client and schemas | Dispatch permitted searches, deduplicate requests, enforce budgets and publish progress |
| Fare comparison | New offer/cost model and journey results | Deterministic totals/ranking; explain source-backed savings in plain language |
| Connection evaluator | `connectionGraph`, airport mode, maps | Validate transfers and explain missing assumptions; no invented minimums or probabilities |
| Journey monitor | Guardian, `recovery.mjs`, job queue | Match observations, detect risk, schedule permitted recovery work |
| Recovery planner | Existing prepared alternatives and action reviews | Propose valid replacements; preserve original ticket and spending context |
| Booking coordinator | Future production commerce boundary | Execute only the exact reviewed purchase/exchange/cancel operation with current authorization |
| Ticket assistant | Wallet, OCR/barcodes, PDF and offline packs | Extract imported details with confidence; ask for corrections; distinguish imports from supplier-issued tickets |
| Commute and watch assistant | Favorites, commute records, notifications | Suggest repeated-trip savings and schedule only supplier-permitted watches |
| Support and privacy assistant | Inbox, claims, export/delete, operator feedback | Explain status, draft claims and diagnostic reports; preview sensitive sharing/deletion and preserve existing account scope |

Operational facts must be structured evidence, rendered directly: price, airline, flight number, time, terminal, baggage, cancellation/protection status and refund amount. A language model can explain those fields but must not edit or invent them. The current text rewrite guard remains insufficient even after numeric checks; see the review reproduction.

Extend the present plan/review/confirm architecture. A chat message requesting options authorizes search, not spending. Exact purchase/rebooking authority must include traveler, itinerary/offer version, currency, maximum charge, expiry and allowed operation. If future users enable bounded automatic rebooking, implement a revocable mandate and the same supplier/price checks; changing an allowed bound requires renewed approval.

Treat carrier text, imported tickets and external tool output as untrusted data. They cannot change tool permissions. Pass IDs rather than arbitrary URLs or code to tools. A validator should use schemas, arithmetic and provider evidence, not just a second LLM's opinion. Keep a deterministic UI/fallback when the model times out.

Record prompt/model version, evidence IDs, tool outcome, duration and action audit metadata. Redact passenger documents, payment details, reset tokens and raw journey history from external traces by default. Extend the current deletion/export rules to watches, offers, booking records and traces under a documented retention policy.

## 9 Booking and payment sequence

Deliver live comparison and clear supplier handoff first where authorized. Keep direct Wayline issuance as an explicit follow-on, not a dropped requirement.

Saving, changing or cancelling a Wayline itinerary currently changes its planning/monitoring record. It must not be described as issuing, exchanging or cancelling a carrier ticket. Give each ticket group its own purchase state and seller link. One journey can require several purchases.

For direct booking implement durable operation records, supplier idempotency, payment authorization/capture, ticket issuance, webhook event deduplication, refund/exchange states and reconciliation. Persist intended work before external effects. On an ambiguous timeout query supplier state before retrying. Payment success alone cannot mean ticket issuance.

For separate ticket groups, refresh all offers, obtain holds where supported and disclose partial-booking risk. When holds are unavailable, require acknowledgment and define compensation/manual recovery if a later purchase fails. Do not claim cross-supplier atomic checkout. Supplier webhook signatures, timestamps and event IDs must be verified; duplicates and out-of-order events need stable handling.

## 10 Ordered implementation packages

Every package includes code, meaningful failure tests, updated capability docs and review evidence. Responsibilities below are roles to assign, not people already committed. Provider onboarding can proceed while the first packages are implemented.

| Order | Deliverable | Responsibility | Acceptance |
| --- | --- | --- | --- |
| C01 | Correct recovery economics and remove model control of operational facts; clarify unsupported live price controls | Backend + AI | $100 spent/$80 replacement yields $80 required now; name/negation injections cannot alter rendered facts; unknown fare never wins ranking |
| C02 | Money, offers, passengers, places, service instances, ticket groups and connection schemas | Backend | Multi-passenger/tax/bag inclusions correct; currencies and timezones preserved; through-fares cannot be split illegally |
| C03 | One authorized flight-shopping adapter with refresh and capability reporting | Integration | Real enabled-account searches on launch corridors; expiry/price-change/no-inventory/partial-response cases handled |
| C04 | Priced ground access and one intercity bus/rail source | Transit + integration | Complete fare provenance for covered routes; unknown transfers clearly excluded from fully priced ranking |
| C05 | Bounded multimodal composer and cheapest-total results | Backend + frontend | Compare ground-only and air+ground on the same inputs; hard constraints enforced; fixture oracle agrees with lowest complete total |
| C06 | Airport and separate-ticket connection policies | Transit + product | Bag recheck, airport change, last service, accessibility, midnight/DST and impossible connection cases accepted/rejected correctly |
| C07 | Flight status and generalized monitoring | Integration + operations | Exact service identity; delayed/diverted/cancelled and stale/conflicting events; downstream impacts; bounded job cadence |
| C08 | Multimodal recovery agent and accurate cost cards | Backend + frontend | Missed bus before flight, late flight before train, sold-out backup, no alternatives, cash cap and same-disruption alternatives covered |
| C09 | Agent tools across Planner, Wallet, trips, Inbox, commute and offline | AI + frontend | Shared structured inputs/evidence, review-before-mutation, no permission bypass, usable no-model path |
| C10 | Flexible dates, nearby hubs and permitted price watches | Product + backend | Full-trip savings recomputed; no unattended calls to user-action-only APIs; bag/party settings remain consistent; opt-out works |
| C11 | Supplier booking/exchange/refund and payment operations | Commerce + operations | No duplicate charge/issuance under timeout/replay; partial purchase recovery; confirmed seller support and servicing |
| C12 | Release validation and operating readiness | QA + operations | Browser workflows, real push delivery, portable setup, restore drill, source freshness and search cost dashboards |

For C02 onward create focused modules such as `server/domain/offers.mjs`, `pricing.mjs`, `multimodalSearch.mjs`, `connectionPolicy.mjs` and provider adapters under `server/travel/`. These paths are proposals, not existing features. Extend `src/types.ts`, `Planner.tsx`, `JourneyCard.tsx`, `TripActions.tsx`, Wallet, Inbox and `Agent.tsx` around the same contracts. Avoid maintaining a second competing search model in the prototype.

Proposed API contracts: versioned search create/status/cancel; itinerary reprice; watch create/update/delete; recovery prepare/list/review; booking operation create/status. Reuse existing `/api/search` and reviewed action routes through compatibility adapters or an explicit versioned migration. Use async search IDs for long-running supplier work so the present single-request timeout does not truncate the market search.

## 11 Release evidence and metrics

Preserve the existing 394-test baseline and add fixtures that test business invariants, not source text alone:

- Group totals, tax/bag inclusion, fare caps, unavailable ancillary prices, different currency scales and FX rounding.
- Ground fare beating a lower base flight price once bags/transfers are counted; unknown cost never treated as free.
- Through-ticket vs two one-way offers; seat availability for the entire party; no invalid fare-segment combinations.
- Cheaper nearby airport losing once final transfer/overnight cost is included.
- Missed/late/cancelled/diverted legs; current-location ambiguity; expiry during confirmation; last bus already departed.
- Budget, date, accessibility and arrival-deadline persistence through AI and recovery.
- Repeated/out-of-order events, provider outages, cancelled searches and account changes during async work.
- Prompt injection, invented carrier/terminal/fare, unsupported instructions, model timeout and deterministic fallback.
- Booking timeout with an already-created supplier order, duplicate webhooks, partial group purchase and pending refund.
- Mobile/desktop complete-trip search, handoff, ticket import, offline pack, push click, opt-out and deletion.

Use a curated 30-scenario corridor set as an initial proposed pilot evaluation, plus at least 100 reviewed AI requests covering the supported tasks and adversarial inputs. These are starting evaluation sizes, not reliability guarantees. Capture current supplier results against the exact passenger/bag inputs and compare displayed versus refreshed checkout totals. Record the denominator and differences, not only successful examples.

Track complete-price coverage, price-refresh mismatch rate, supplier coverage, invalid-connection rate in review, recovery feasibility, extra-cash accuracy, duplicate action/charge rate, stale-notification rate, search p50/p95 latency and API/model cost per completed search. A “cheapest” metric must say which providers and candidates were compared. Measure model extraction correctness separately from JSON validity and actual route quality.

Public search requires complete source labeling, enforced constraints and reproducible browser evidence. Automatic monitoring requires permitted feeds and tested notification delivery. Direct purchases require C11 and supplier acceptance. Keep unsupported modes visible as unavailable rather than silently substituting sample inventory.

## 12 Additional product improvements

Prioritize transparent bag-inclusive price comparison, “leave one hour later to save” explanations, nearby airport/station comparisons, a last-connection warning, price watches where permitted, and a visible backup cash budget. Preserve user-chosen cheapest sorting even when suggesting a more resilient alternative.

Later add round-trip airport combinations, verified student/senior fares, companion-aware baggage allocation, transit-pass eligibility, refundable-versus-cheaper fare comparisons and voluntary journey sharing. Predictive “buy now/wait” advice needs licensed history and calibration before it is presented as more than descriptive price history.

Keep AR boarding, nationwide coverage claims and complex international self-transfers behind separate validated plans. The next milestone is a small set of complete, correctly priced, recoverable journeys that people can actually use.
