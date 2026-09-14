# Local-Llama implementation and acceptance report

Generated: 2026-09-13T19:42:03.350Z. Status: **local acceptance passed; provider capabilities gated**.

## Acceptance results

| Gate | Result |
|---|---|
| Deterministic and transaction-safety suite | 699/699 passed; TypeScript included |
| Intent/argument corpus | 512/518 (98.84%); 259 cases repeated twice |
| Critical journeys | 12/12 passed; six journeys repeated twice |
| Required actual model inference | Every model-required corpus/critical turn checks Llama provenance and positive model-call count; fallback fails acceptance |
| Execution failures in corpus | 0 |
| Source stability | Corpus hash and evaluated code hashes persisted; corpus code unchanged: true; journey code unchanged: true |
| Production build | Passed; existing large-chunk warning remains |
| Lint | 0 errors; 15 existing warnings |

Acceptance thresholds are at least 95% overall, at least 90% per family, all deterministic safety tests passing, and every critical journey passing twice. The corpus tests intent/argument routing through the real conversation HTTP executor. Critical journeys separately perform protected-form API operations and assert persisted outcomes. Financial supplier responses are fixtures.

## Tested local model

- Model: llama3.1:8b-instruct-q4_K_M. Ollama 0.34.0.
- Digest: 46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e.
- Configuration: temperature zero, actual JSON-schema output, 8192-token context; bounded action planner with conditional intent verification. No cloud model substitution.
- Hardware: 13th Gen Intel(R) Core(TM) i7-13620H; 34.03 GB system RAM.
- Ollama loaded model size: 6.25 GB; VRAM 0 bytes.
- OS runner working-set snapshot during validation: 6.48 GB; process-lifetime peak 6.74 GB. This is not an isolated peak benchmark.
- HTTP corpus latency: median 3678 ms, p95 13365 ms, maximum 4708853 ms. Includes application validation and conditional second model calls; local regression/build work ran concurrently.

The installed llama3.2:latest (3B) failed its diagnostic: 10/13 completed cases passed before the run was stopped for critical routing mistakes. Its diagnostic median was 26,914 ms. The 8B configuration is the tested configuration that passed acceptance and is selected in the local environment. These different-stage diagnostics are not a controlled speed comparison. Restart the application to load the updated model setting. Failed/interrupted historical reports are preserved.

## Accuracy by workflow family

| Family | Correct / attempted | Accuracy |
|---|---:|---:|
| planning | 166 / 168 | 98.81% |
| monitoring | 50 / 50 | 100.00% |
| information | 56 / 56 | 100.00% |
| personal | 74 / 74 | 100.00% |
| tickets | 26 / 26 | 100.00% |
| utilities | 60 / 62 | 96.77% |
| booking | 24 / 26 | 92.31% |
| servicing | 40 / 40 | 100.00% |
| clarification | 16 / 16 | 100.00% |

## Critical conversations

- purchase, reload, exchange, refund request and payment record; repeat 1: PASS
- planning, comparison, hypothetical change, reload and imported ticket; repeat 1: PASS
- commutes, passes, price watches, sharing and flight exports; repeat 1: PASS
- supplier recovery, completed travel, reload and cancellation review; repeat 1: PASS
- asynchronous progress, reconnect, replay and cancellation; repeat 1: PASS
- return-date clarification, reload, flexible airports and multi-city; repeat 1: PASS
- purchase, reload, exchange, refund request and payment record; repeat 2: PASS
- planning, comparison, hypothetical change, reload and imported ticket; repeat 2: PASS
- commutes, passes, price watches, sharing and flight exports; repeat 2: PASS
- supplier recovery, completed travel, reload and cancellation review; repeat 2: PASS
- asynchronous progress, reconnect, replay and cancellation; repeat 2: PASS
- return-date clarification, reload, flexible airports and multi-city; repeat 2: PASS

## Remaining recognition errors

"Book this flight" routed to select_option instead of book_ticket. See the machine-readable report for the exact repeat and result.
"Export my itinerary PDF and download the calendar file" routed to export_pdf instead of export_pdf, export_calendar. See the machine-readable report for the exact repeat and result.
"Load the flight offers" routed to clarify instead of collect_options. See the machine-readable report for the exact repeat and result.
"Collect the current offers" routed to clarify instead of collect_options. See the machine-readable report for the exact repeat and result.

These errors remain in the denominator. Neither grants transaction authority; exact protected review is still required. Direct controls remain available.

## Validation boundaries

- Real Llama with fixture inventory: completed acceptance above.
- Supplier sandbox: **not run**.
- Authorized live provider: **not run**.
- Browser: representative desktop/mobile, keyboard, reload during progress, protected traveler controls, gated booking access, PDF download, calendar links, offline controls, and public Boston routing/weather. Shared primitives and offline behavior also have automated coverage. This is not a comprehensive screen-reader or assistive-technology certification.

See [provider readiness and remaining permissions](PROVIDER_READINESS.md) for contracted inventory, Cards/3DS certification, licensed status and retention, external checkout transport, ticket-file availability and coupon usability.

## Reproduce and inspect

Run npm run check, npm run build and npm run lint. With Ollama running and the selected model installed, run npm run test:llama and npm run test:llama:journeys sequentially, then npm run report:workflows. The runners default to the acceptance report paths below. EVAL_OUTPUT and JOURNEY_OUTPUT can preserve additional benchmark runs; COVERAGE_MODEL_REPORT and COVERAGE_JOURNEY_REPORT select them for reporting.

- [Full evaluated corpus](evaluations/llama-8b-optimized-final.json)
- [Critical journeys](evaluations/local-llama-optimized-journeys.json)
- [Browser verification](evaluations/browser-optimization-verification.json)
- [Model memory snapshot](evaluations/optimized-runtime-memory.json)
- [Workflow matrix](evaluations/feature-matrix.json)
- [3B diagnostic](evaluations/llama-3b-system-prompt-diagnostic.json)
