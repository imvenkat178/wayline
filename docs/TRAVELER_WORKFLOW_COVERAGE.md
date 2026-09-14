# Traveler workflow coverage

Status: local acceptance passed; provider capabilities gated.

The full deterministic run passed 699 of 699 tests, including the preserved 580-test baseline. Model intent/argument accuracy and complete critical journeys are separate acceptance gates. See the [local-Llama report](LOCAL_LLAMA_REPORT.md) and [provider readiness](PROVIDER_READINESS.md).

All actions below are available from the persistent conversation. Direct controls use the same validated registry. Protected forms remain inside the conversation for passenger, account and transaction details.

| Chat action | UI controls | Deterministic evidence | Llama passing / attempted | Readiness |
|---|---|---|---:|---|
| search_options | TripWorkspace | traveler-workflows.test.mjs, trip-workspace.test.mjs, workspace-flights.test.mjs, shopping.test.mjs, flight-conversation-scope.test.mjs, flight-clarification-http.test.mjs | 22 / 22 | Available inventory and retrieved evidence determine results |
| update_constraints | TripWorkspace | traveler-workflows.test.mjs, trip-workspace.test.mjs, workspace-flights.test.mjs, shopping.test.mjs, flight-conversation-scope.test.mjs, flight-clarification-http.test.mjs | 20 / 20 | Available inventory and retrieved evidence determine results |
| compare_options | TripWorkspace | traveler-workflows.test.mjs, trip-workspace.test.mjs, workspace-flights.test.mjs, shopping.test.mjs, flight-conversation-scope.test.mjs, flight-clarification-http.test.mjs | 16 / 16 | Available inventory and retrieved evidence determine results |
| select_option | TripWorkspace | traveler-workflows.test.mjs, trip-workspace.test.mjs, workspace-flights.test.mjs, shopping.test.mjs, flight-conversation-scope.test.mjs, flight-clarification-http.test.mjs | 14 / 14 | Available inventory and retrieved evidence determine results |
| replace_leg | TripWorkspace | traveler-workflows.test.mjs, trip-workspace.test.mjs, workspace-flights.test.mjs, shopping.test.mjs, flight-conversation-scope.test.mjs, flight-clarification-http.test.mjs | 12 / 12 | Available inventory and retrieved evidence determine results |
| lock_leg | TripWorkspace | traveler-workflows.test.mjs, trip-workspace.test.mjs, workspace-flights.test.mjs, shopping.test.mjs, flight-conversation-scope.test.mjs, flight-clarification-http.test.mjs | 12 / 12 | Available inventory and retrieved evidence determine results |
| branch_scenario | TripWorkspace | traveler-workflows.test.mjs, trip-workspace.test.mjs, workspace-flights.test.mjs, shopping.test.mjs, flight-conversation-scope.test.mjs, flight-clarification-http.test.mjs | 18 / 18 | Available inventory and retrieved evidence determine results |
| restore_scenario | TripWorkspace | traveler-workflows.test.mjs, trip-workspace.test.mjs, workspace-flights.test.mjs, shopping.test.mjs, flight-conversation-scope.test.mjs, flight-clarification-http.test.mjs | 12 / 12 | Available inventory and retrieved evidence determine results |
| undo_draft_edit | TripWorkspace | traveler-workflows.test.mjs, trip-workspace.test.mjs, workspace-flights.test.mjs, shopping.test.mjs, flight-conversation-scope.test.mjs, flight-clarification-http.test.mjs | 12 / 12 | Available inventory and retrieved evidence determine results |
| prepare_review | TripWorkspace | traveler-workflows.test.mjs, trip-workspace.test.mjs, workspace-flights.test.mjs, shopping.test.mjs, flight-conversation-scope.test.mjs, flight-clarification-http.test.mjs | 12 / 12 | Available inventory and retrieved evidence determine results |
| collect_options | TripWorkspace | traveler-workflows.test.mjs, trip-workspace.test.mjs, workspace-flights.test.mjs, shopping.test.mjs, flight-conversation-scope.test.mjs, flight-clarification-http.test.mjs | 10 / 12 | Available inventory and retrieved evidence determine results |
| cancel_search | TripWorkspace | traveler-workflows.test.mjs, trip-workspace.test.mjs, workspace-flights.test.mjs, shopping.test.mjs, flight-conversation-scope.test.mjs, flight-clarification-http.test.mjs | 12 / 12 | Available inventory and retrieved evidence determine results |
| prepare_recovery | SupplierRecoveryForm | traveler-workflows.test.mjs, recovery-origin.test.mjs, recovery-economics.test.mjs, supplier-recovery.test.mjs, supplier-monitoring.test.mjs, shopping.test.mjs, notifications.test.mjs | 12 / 12 | Available inventory and retrieved evidence determine results |
| explain_option | TripWorkspace | traveler-workflows.test.mjs, agent.test.mjs, workspace-flights.test.mjs | 12 / 12 | Available inventory and retrieved evidence determine results |
| advice | TripWorkspace | traveler-workflows.test.mjs, agent.test.mjs, workspace-flights.test.mjs | 14 / 14 | Available inventory and retrieved evidence determine results |
| manage_travelers | ConversationTools | traveler-workflows.test.mjs, workspace-areas.test.mjs, auth-router.test.mjs, notifications.test.mjs | 14 / 14 | Protected controls; provider prerequisites apply where indicated |
| manage_contacts | ConversationTools | traveler-workflows.test.mjs, workspace-areas.test.mjs, auth-router.test.mjs, notifications.test.mjs | 14 / 14 | Protected controls; provider prerequisites apply where indicated |
| manage_preferences | ConversationTools | traveler-workflows.test.mjs, workspace-areas.test.mjs, auth-router.test.mjs, notifications.test.mjs | 12 / 12 | Protected controls; provider prerequisites apply where indicated |
| manage_favorites | ConversationTools | traveler-workflows.test.mjs, workspace-areas.test.mjs, auth-router.test.mjs, notifications.test.mjs | 12 / 12 | Protected controls; provider prerequisites apply where indicated |
| manage_commutes | ConversationTools | traveler-workflows.test.mjs, workspace-areas.test.mjs, auth-router.test.mjs, notifications.test.mjs | 12 / 12 | Protected controls; provider prerequisites apply where indicated |
| manage_passes | ConversationTools | traveler-workflows.test.mjs, workspace-areas.test.mjs, auth-router.test.mjs, notifications.test.mjs | 12 / 12 | Protected controls; provider prerequisites apply where indicated |
| manage_tickets | SupplierTickets + Wallet | traveler-workflows.test.mjs, ticket-import.test.mjs, workspace-areas.test.mjs, supplier-adapters.test.mjs, provider-checkout.test.mjs | 14 / 14 | Protected controls; provider prerequisites apply where indicated |
| manage_watches | ConversationTools | traveler-workflows.test.mjs, recovery-origin.test.mjs, recovery-economics.test.mjs, supplier-recovery.test.mjs, supplier-monitoring.test.mjs, shopping.test.mjs, notifications.test.mjs | 12 / 12 | Protected controls; provider prerequisites apply where indicated |
| manage_notifications | SupplierMonitorForm + Profile | traveler-workflows.test.mjs, recovery-origin.test.mjs, recovery-economics.test.mjs, supplier-recovery.test.mjs, supplier-monitoring.test.mjs, shopping.test.mjs, notifications.test.mjs | 12 / 12 | Protected controls; provider prerequisites apply where indicated |
| trip_status | SupplierMonitorForm | traveler-workflows.test.mjs, recovery-origin.test.mjs, recovery-economics.test.mjs, supplier-recovery.test.mjs, supplier-monitoring.test.mjs, shopping.test.mjs, notifications.test.mjs | 16 / 16 | Available inventory and retrieved evidence determine results |
| travel_weather | TripWorkspace | traveler-workflows.test.mjs, agent.test.mjs, workspace-flights.test.mjs | 18 / 18 | Available inventory and retrieved evidence determine results |
| station_guidance | TripWorkspace | traveler-workflows.test.mjs, agent.test.mjs, workspace-flights.test.mjs | 12 / 12 | Available inventory and retrieved evidence determine results |
| share_trip | ConversationTools | traveler-workflows.test.mjs, core-launch.test.mjs, offline-boot.test.mjs, service-worker.test.mjs, flight-utilities.test.mjs, supplier-adapters.test.mjs | 12 / 12 | Protected controls; provider prerequisites apply where indicated |
| revoke_share | ConversationTools | traveler-workflows.test.mjs, core-launch.test.mjs, offline-boot.test.mjs, service-worker.test.mjs, flight-utilities.test.mjs, supplier-adapters.test.mjs | 12 / 12 | Protected controls; provider prerequisites apply where indicated |
| export_calendar | TripWorkspace | traveler-workflows.test.mjs, core-launch.test.mjs, offline-boot.test.mjs, service-worker.test.mjs, flight-utilities.test.mjs, supplier-adapters.test.mjs | 12 / 14 | Available inventory and retrieved evidence determine results |
| export_pdf | TripWorkspace | traveler-workflows.test.mjs, core-launch.test.mjs, offline-boot.test.mjs, service-worker.test.mjs, flight-utilities.test.mjs, supplier-adapters.test.mjs | 12 / 14 | Available inventory and retrieved evidence determine results |
| offline_pack | ConversationTools + OfflinePacks | traveler-workflows.test.mjs, core-launch.test.mjs, offline-boot.test.mjs, service-worker.test.mjs, flight-utilities.test.mjs, supplier-adapters.test.mjs | 12 / 12 | Protected controls; provider prerequisites apply where indicated |
| ticket_receipt | TripWorkspace | traveler-workflows.test.mjs, ticket-import.test.mjs, workspace-areas.test.mjs, supplier-adapters.test.mjs, provider-checkout.test.mjs | 12 / 12 | Available inventory and retrieved evidence determine results |
| book_ticket | BookingConversationForm | traveler-workflows.test.mjs, booking-workflows.test.mjs, provider-checkout.test.mjs, supplier-adapters.test.mjs, transaction-retention.test.mjs | 10 / 12 | Implemented; supplier approval/certification required |
| order_status | TripWorkspace | traveler-workflows.test.mjs, booking-workflows.test.mjs, provider-checkout.test.mjs, supplier-adapters.test.mjs, transaction-retention.test.mjs | 14 / 14 | Available inventory and retrieved evidence determine results |
| cancel_ticket | BookingConversationForm | traveler-workflows.test.mjs, booking-workflows.test.mjs, supplier-adapters.test.mjs, transaction-retention.test.mjs | 14 / 14 | Implemented; supplier approval/certification required |
| exchange_ticket | BookingConversationForm | traveler-workflows.test.mjs, booking-workflows.test.mjs, supplier-adapters.test.mjs, transaction-retention.test.mjs | 12 / 12 | Implemented; supplier approval/certification required |
| refund_ticket | BookingConversationForm | traveler-workflows.test.mjs, booking-workflows.test.mjs, supplier-adapters.test.mjs, transaction-retention.test.mjs | 14 / 14 | Implemented; supplier approval/certification required |
| clarify | TripWorkspace | traveler-workflows.test.mjs, flight-clarification-http.test.mjs | 16 / 16 | Available inventory and retrieved evidence determine results |

## Provider readiness and limits

- No supplier sandbox or authorized live-provider validation was run. Financial integration tests use injected fixture transports.
- Distribusion network implementation requires partner documentation and contracted US inventory; the fail-closed integration contract is implemented.
- Duffel Cards collection and authentication require provider approval and sandbox/live certification. External checkout requires an approved contract transport and exact destination allowlist.
- FlightAware observations and background alerts require approved Standard access, a license ID and an explicit permitted retention period.
- Imported tickets do not grant servicing authority. Supplier e-ticket identifiers are downloadable; the current order response does not supply boarding-pass or ticket-PDF files.
- Recovery preserves completed travel and original ticket records. Coupon reuse remains unknown until authoritative supplier evidence exists.
- Cheapest means the lowest complete known cost within disclosed coverage. Unknown mandatory baggage, connection or card fees prevent a complete-price claim.
- Protected forms handle sensitive inputs and financial reviews. Conversational intent recognition does not itself submit a supplier transaction.

Machine-readable matrix: [feature-matrix.json](evaluations/feature-matrix.json). Regenerate with node scripts/report-workflow-coverage.mjs.
