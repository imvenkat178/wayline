# Conversational trip workspace — transit and flight milestones

## Conversational local-Llama release — 13 September 2026

Persistent chat now uses a shared 39-action registry and validated local-Llama planning, protected traveler and transaction forms, stable references, clarification continuity, replayable progress, cancellation and grounded evidence. US flight scope supports returns, flexible dates, alternate airports and multi-city requests; quotes, supplier operations, monitoring/recovery and exports have separate durable records and provider gates.

See [the current acceptance report](LOCAL_LLAMA_REPORT.md), [workflow matrix](TRAVELER_WORKFLOW_COVERAGE.md) and [provider readiness](PROVIDER_READINESS.md). These supersede older implementation limits below. Supplier sandbox and authorized live-provider validation have not run. Distribusion network access still requires partner documentation and granted US inventory.


Implemented 12 September 2026 from the conversational workspace brief in [PR #1](https://github.com/imvenkat178/wayline/pull/1).

## Delivered

The production Assistant is now the default entry point. It supports a conversation-owned draft, stable result cards, comparison, unsaved itinerary selection, editable requirements, exact service locks, constrained leg replacement, scenarios, undo, reviewed saving, and reload continuity. Chat and controls call the same domain operations. The existing Planner can supply an itinerary through “Bring current route into chat.” Journey Inbox can open the affected trip's conversation.

The verified flow is: start in chat → compare routes → select → change an unsaved trip over several messages → inspect changes → undo → review/save → reload and continue.

## State and contracts

- `conversation`: title, owner, active draft and saved journey, committed turn IDs, execution lease, retention deadline.
- `conversation-turn`: client message ID, request hash, base version, execution status, typed retry command and grounded response.
- `trip-draft`: constraints, resolved places/timezone, travelers, bags, selected option, comparison references, locks, revision and scenario references.
- `candidate-set`: query snapshot, immutable option IDs and display order, source/time/expiry, constraint exclusions, incomplete-pricing notices and labels.
- `draft-revision`: validated operation, before/after state, parent version and change summary.
- `draft-scenario`: separate planning snapshot; creating one keeps the current selection intact.

All records use the existing encrypted, owner-scoped store. No separate database is introduced. Export, account deletion, history deletion and backup/restore use those same records. Retention follows the account history policy at creation; disabled history and private journeys use a one-day workspace expiry. The UI retains the last 100 turns, 30 undo steps and 20 scenario references; structured constraints survive transcript truncation.

`GET/POST /api/conversations`, `GET /api/conversations/:id`, and `POST /api/conversations/:id/turns` provide the workspace API. Turns require `clientTurnId` and `expectedVersion`. Positional references include the visible result set; card actions send exact set/option/leg IDs. Domain validation rejects foreign references and ambiguous legs. Repeated client IDs cannot execute different input. Atomic commits include the draft, revision, result references and response; expired or superseded executions cannot replace the current draft. A 90-second execution lease permits recovery after interruption. Reopening a pending conversation polls for its completed snapshot.

The interpreter accepts a bounded set of typed commands, with a deterministic fallback when the local model is unavailable. Replies are rendered from validated records. No model-generated carrier, fare, gate or refund facts are accepted. Existing recovery cash accounting remains separate from historical spending and prospective refunds. Recovery requests use the saved journey's recorded reachable position and filter explicit extra-cash/deadline requirements; a user's report does not become an official delay observation.

## Comparison and edits

Known hard-constraint violations are excluded before ranking. Unknown fares or unverified required baggage keep an option incomplete, with no complete-price recommendation. The versioned comparison policy uses complete party totals for price, door-to-door duration for fastest, and fewer transfers followed by spare connection time for the balanced recommendation. It does not claim a historical reliability percentage.

Leg replacement uses the current transit provider's whole-itinerary search. It requires the replacement mode between the same stops, preserves every other transit service, and checks the complete connection chain. It does not splice offers or invent a train connection. Locks preserve a service selection; they do not reserve seats. Changes of requirements keep the locks and request a new selection. Old result sets remain comparable but cannot be selected against different current requirements. Expired results require refresh before selecting or saving.

Saved-plan changes still require an action review. Reviews bind to the draft version and selected search option. Confirmation rechecks the live itinerary, disruptions, fare and ticket conditions, and remains idempotent. Undo only changes the planning draft.

## Validation

Transit milestone checks: **565/565 regression tests passed**, 78 focused tests passed, TypeScript and production build passed. Full lint reported zero errors and 15 pre-existing warnings. Flight milestone validation is recorded below.

- Focused tests cover multi-turn continuity, exact comparisons, owner/conversation isolation, retries, stale tabs, expired execution leases, provider failures, scenarios, undo, locks, replacement, unknown fares, stale reviews/prices, history deletion and HTTP CSRF/reconnect behavior.
- A real browser flow used the configured Boston OTP/MBTA integration: five South Station–Harvard routes, first/third comparison, third-option selection, a later departure retaining the $75 budget and one bag, undo, live confirmation, reload, and a direct date edit.
- Desktop and 390px mobile layouts were inspected. Mobile content width was 375px, with no horizontal overflow. No browser console errors were observed during that flow.
- Build and regression details are recorded in `tmp/conversation-build.log`, `tmp/conversation-focused.log` and `tmp/conversation-regression-elevated.log`.

## Flight milestone

Flight shopping now runs inside the same persistent conversation, draft, scenarios and immutable result cards. Select “Flight offers” in Trip requirements, or say “Find flights from BOS to JFK tomorrow at 9 am under $500 with one cabin bag.” A flight search queues the existing durable shopping job. Progress survives reloads; “Load offers” takes a stable snapshot when queries finish. Repeated loads preserve option IDs and ordering. Search cancellation and later edits suppress superseded jobs; blocked supplier access saves requirements without creating sample fares.

This milestone supports one-way domestic economy searches between explicitly selected BOS, JFK, LGA, EWR, PHL and DCA airports. It uses a configurable 1–24-hour departure window, party budget, arrival deadline, transfer/walking limits, overnight preference and verified accessibility requirements. Searches compare up to 50 supplier-returned offers per queried date. A departure window that crosses midnight queries both origin-local dates and waits for completion before creating result cards. Airport transport, hotels, return trips and alternate-airport shopping remain in the separate comparison workflow or later roadmap.

The draft stores up to nine travelers, child ages, personal items, cabin bags and checked bags per traveler. Natural-language bag edits retain multiple requested bag types in one message and require a bag type and an explicit per-traveler scope for multiple travelers. Controls expose each traveler separately. Party fares, included baggage and unknown required costs use the existing supplier contracts and component accounting. Unknown prices, supplier test inventory and unverified connections cannot receive complete-price recommendations. All flight times display the service endpoint’s timezone.

Selecting an offer changes the unsaved itinerary. Keeping any flight locks all services in its indivisible supplier ticket group. Subsequent offers must preserve those exact service instances and times and reprice the full party. Locks can be removed even after an edit clears the selection. Flight replacement searches complete supplier offers; replacing a flight with a train/bus remains unavailable until an authorized shopping provider can price that alternative. Scenarios retain their own pending-search reference while leaving the active plan intact.

Flight reviews and confirmation reuse the existing supplier refresh implementation. Reviews bind to conversation, draft version, result set and selected offer, including when requested through the standalone shopping endpoints. A concurrent draft edit, expired offer, changed locked service or changed fare/conditions prevents saving stale details. Confirmation stores an idempotent travel-comparison planning record and links it back to the conversation. It does not create a purchased ticket, reserve inventory or imply flight monitoring. Historical saved comparisons remain separate from later draft edits.

### Flight validation

- **580/580 regression tests passed**, including 15 new flight-workspace tests covering the complete lifecycle, durable queues, immutable references, explicit baggage, child ages, locks, scenarios, cancellation, owner isolation, expiry, supplier changes and edits during confirmation.
- TypeScript and production build passed. Changed-file lint passed with no warnings or errors; the existing repository-wide warnings are unchanged.
- An isolated browser session used clearly labeled supplier test inventory: chat search → queued progress → load → compare first/third → select third → lock → later departure → undo → refresh/review → confirm → reload. A direct edit added a checked bag and a 10-year-old child and repriced the whole party while keeping the selected service lock.
- Desktop and 390px mobile layouts were inspected. Loaded mobile content width was 375px, with no horizontal overflow; browser console contained no errors or warnings.
- Logs: `tmp/flight-regression.log`, `tmp/workspace-flights-tests.log`, `tmp/flight-build.log`. Browser fares were injected fixtures, not a live Duffel validation. Real shopping requires approved supplier access and respects the existing live/test capability settings.

## Remaining roadmap

The conversational workspace now includes both transit and the scoped flight workflow above. Door-to-door flight/ground composition in these cards, return/multi-city planning, broader authorized rail/bus inventory, calibrated historical reliability, imported-ticket servicing, and actual purchases/exchanges/refunds remain future work. The Planner remains a standalone fallback with explicit transit import. There is no streaming event API or user-facing stop control for an active interpretation turn yet; queued flight searches can be cancelled. Expired options are refreshed explicitly, and the displayed conversation history remains bounded as described above.
