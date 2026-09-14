export const actionInputs = Object.freeze({"search_options":["patch"],"update_constraints":["patch"],"branch_scenario":["patch","name"],"restore_scenario":["scenarioId"],"compare_options":["setId","optionIds","positions"],"select_option":["setId","optionIds","positions"],"explain_option":["setId","optionIds","positions"],"replace_leg":["setId","optionIds","positions","legId","legMode","replacementMode"],"lock_leg":["legId","legMode","locked"],"prepare_review":["setId","optionIds"],"collect_options":["searchId"],"cancel_search":["searchId"],"prepare_recovery":["maxExtraCents","arrivalDeadline"]});
// Single public registry used by the UI, model schema and server command validation.
export const travelerActions = Object.freeze([
  {
    "id": "search_options",
    "family": "planning",
    "description": "Search routes using trip requirements",
    "capability": "planning",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "update_constraints",
    "family": "planning",
    "description": "Edit an unbooked trip draft: dates, budget, passengers, bags or accessibility. Already booked flights use exchange_ticket.",
    "capability": "planning",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "compare_options",
    "family": "planning",
    "description": "Compare or recommend existing options by price, speed or resilience",
    "capability": "planning",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "select_option",
    "family": "planning",
    "description": "Choose, pick or go with an existing option by number or label (cheapest, fastest, recommended)",
    "capability": "planning",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "replace_leg",
    "family": "planning",
    "description": "Swap/change one transport mode for another, or replace a whole flight ticket group",
    "capability": "planning",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "lock_leg",
    "family": "planning",
    "description": "Keep, lock or unlock a service",
    "capability": "planning",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "branch_scenario",
    "family": "planning",
    "description": "Explore hypothetical changes without editing the active trip",
    "capability": "planning",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "restore_scenario",
    "family": "planning",
    "description": "Activate an EXISTING explicitly named what-if scenario. Never use for disruption recovery or replacement routes.",
    "capability": "planning",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "undo_draft_edit",
    "family": "planning",
    "description": "Undo the last draft edit",
    "capability": "planning",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "prepare_review",
    "family": "planning",
    "description": "Save or keep this itinerary in My journeys as a plan. Not a PDF, not a purchase.",
    "capability": "planning",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "collect_options",
    "family": "planning",
    "description": "Load finished flight search offers",
    "capability": "planning",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "cancel_search",
    "family": "planning",
    "description": "Stop searching for options",
    "capability": "planning",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "prepare_recovery",
    "family": "monitoring",
    "description": "Recover disrupted travel, get back on track, find a replacement route within extra-cash and arrival constraints.",
    "capability": "planning",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "explain_option",
    "family": "information",
    "description": "Explain costs, baggage or conditions of a SPECIFIC selected or numbered option",
    "capability": "planning",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "advice",
    "family": "information",
    "description": "Explain general travel concepts, guarantees, price evidence and capabilities; no changes",
    "capability": "evidence",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "manage_travelers",
    "family": "personal",
    "description": "Add, edit or inspect traveler profiles using a protected form",
    "capability": "form",
    "confirmation": "protected-form",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "manage_contacts",
    "family": "personal",
    "description": "Add, edit or inspect emergency contacts",
    "capability": "form",
    "confirmation": "protected-form",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "manage_preferences",
    "family": "personal",
    "description": "Change or inspect saved travel preferences",
    "capability": "form",
    "confirmation": "protected-form",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "manage_favorites",
    "family": "personal",
    "description": "Save, edit or inspect favorite routes",
    "capability": "form",
    "confirmation": "protected-form",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "manage_commutes",
    "family": "personal",
    "description": "Create, schedule, pause or inspect recurring commutes",
    "capability": "form",
    "confirmation": "protected-form",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "manage_passes",
    "family": "personal",
    "description": "Add or inspect transit passes and renewal reminders",
    "capability": "form",
    "confirmation": "protected-form",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "manage_tickets",
    "family": "tickets",
    "description": "Import, inspect, link or retrieve ticket documents",
    "capability": "form",
    "confirmation": "protected-form",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "manage_watches",
    "family": "monitoring",
    "description": "Watch fares, set a price alert or pause a price watch",
    "capability": "form",
    "confirmation": "protected-form",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "manage_notifications",
    "family": "monitoring",
    "description": "Change notification settings or inspect alerts",
    "capability": "form",
    "confirmation": "protected-form",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "trip_status",
    "family": "monitoring",
    "description": "Check live trip status, delays, gates or alerts",
    "capability": "evidence",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "travel_weather",
    "family": "information",
    "description": "Weather forecasts: will it rain, temperature, conditions at origin or destination",
    "capability": "evidence",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "station_guidance",
    "family": "information",
    "description": "Find station, airport or boarding guidance",
    "capability": "evidence",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "share_trip",
    "family": "utilities",
    "description": "Create a revocable trip sharing link",
    "capability": "form",
    "confirmation": "protected-form",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "revoke_share",
    "family": "utilities",
    "description": "Revoke a previously shared link",
    "capability": "form",
    "confirmation": "protected-form",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "export_calendar",
    "family": "utilities",
    "description": "Export the saved journey to a calendar",
    "capability": "evidence",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "export_pdf",
    "family": "utilities",
    "description": "Download the saved itinerary PDF",
    "capability": "evidence",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "offline_pack",
    "family": "utilities",
    "description": "Prepare or inspect an offline travel pack",
    "capability": "form",
    "confirmation": "protected-form",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "ticket_receipt",
    "family": "tickets",
    "description": "Retrieve a receipt, proof of payment or accounting record for a saved journey or supplier order",
    "capability": "evidence",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "book_ticket",
    "family": "booking",
    "description": "Purchase or reserve tickets; requires exact transaction review",
    "capability": "transaction",
    "confirmation": "exact-review",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "order_status",
    "family": "booking",
    "description": "Check whether a booking went through, a card was charged, or tickets were issued. Booking and payment status, not vehicle delays.",
    "capability": "evidence",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "cancel_ticket",
    "family": "servicing",
    "description": "Request cancellation, inspect eligibility or get a fresh cancellation quote for an actual booking",
    "capability": "transaction",
    "confirmation": "exact-review",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "exchange_ticket",
    "family": "servicing",
    "description": "Reschedule, move, change dates or exchange an already booked, purchased or issued flight/ticket; open a protected form and fresh supplier review",
    "capability": "transaction",
    "confirmation": "exact-review",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "refund_ticket",
    "family": "servicing",
    "description": "Refund eligibility, getting money back, refund quotes and requests for purchased tickets. Opens a fresh review.",
    "capability": "transaction",
    "confirmation": "exact-review",
    "testFile": "tests/traveler-workflows.test.mjs"
  },
  {
    "id": "clarify",
    "family": "clarification",
    "description": "Ask which action or reference was intended; ambiguous yes never confirms",
    "capability": "clarification",
    "confirmation": "none",
    "testFile": "tests/traveler-workflows.test.mjs"
  }
].map(a=>Object.freeze({...a,inputs:actionInputs[a.id]??[],validation:"workspaceCommand plus owner-scoped domain validation",readiness:a.capability==="transaction"?"supplier-approval-required":a.capability==="form"?"protected-form":"evidence-dependent"})));
export const actionIds = Object.freeze(travelerActions.map(a => a.id));
export const actionById = Object.freeze(Object.fromEntries(travelerActions.map(a => [a.id, a])));
export const modelPlanSchema = { type: 'object', additionalProperties: false, properties: { commands: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', additionalProperties: false, properties: { op: { type: 'string', enum: actionIds }, text: { type: 'string', description: 'Exact substring of the user message for this instruction' } }, required: ['op','text'] } } }, required: ['commands'] };
