# Project handoff

> Shared working memory for everyone (human or AI) who works on this repository.
> The protocol for using this file is in [AGENTS.md](AGENTS.md).
> Validate your edits with `python scripts/check_handoff.py --strict`.
>
> Sections 1 to 7 describe the **current** truth and are rewritten in place.
> Section 8 is an **append-only** log, newest entry first.

## 1. Last step (read this first)

- **When:** 2026-09-13
- **Who:** Claude Code (Claude Opus 5)
- **What happened:** Installed the agent memory kit and turned the launch-gap review into `ROADMAP.md`: 9 goals and 52 sub-goals, each with evidence checked against the code, docs, git or a test run. Then stored the current kit in `docs/agent-memory-kit/`, updated `scripts/check_handoff.py` to the kit version that adds `--base`, and added two generated pages, `docs/roadmap/index.html` and `docs/agent-memory-kit/index.html` (`npm run docs:memory`), published as private claude.ai artifacts. No application code changed.
- **State left behind:** At the owner's request, the memory kit and both pages are committed on branch `chore/agent-memory-kit` (created from `main` at 0f02d7a, not pushed). That commit holds `AGENTS.md`, `CLAUDE.md`, `HANDOFF.md`, `ROADMAP.md`, `.agent-memory.json`, `scripts/roadmap.py`, `scripts/check_handoff.py`, `scripts/render-memory-pages.mjs`, `tests/agent-memory.test.mjs`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/workflows/ci.yml`, `.gitignore`, `docs/roadmap/`, `docs/agent-memory-kit/` and only the `docs:memory` line of `package.json`. The earlier local-Llama product work stays uncommitted in the working tree (G1.2), including its other `package.json` changes.
- **Resume by:**
  1. `git status --short` and compare it with section 2.
  2. `python scripts/roadmap.py next` to see actionable work and pending decisions.
  3. Ask the owner the P0 decisions first: G1.2 (commit the work), G6.1 (Launch 1 scope), G2.1 (hosting) and G2.10 (model hosting). While waiting, start G2.2 (container image) or G3.5 (proxy-aware rate limiting), neither of which depends on a decision.

## 2. Repository state

| Item | Current value |
| --- | --- |
| Branch | `chore/agent-memory-kit`, created from `main`; not pushed. `main` and `origin/main` are still at `0f02d7a` (https://github.com/imvenkat178/wayline, public) |
| Last commit | The memory kit commit on `chore/agent-memory-kit` (2026-09-13), whose parent is `0f02d7a` 2026-09-11 "Boston core launch: real transit planning, AI trip agent, recovery, PDFs, encrypted offline/backups" |
| Uncommitted | The local-Llama product work only: 176 entries counted before this session (69 tracked files modified or deleted, including 11 `standalone/assets` files and the non-memory `package.json` changes, plus untracked server modules, scripts, docs and `docs/evaluations/`). |
| Toolchain verified here | Windows 11; Node v24.19.0; npm 11.17.0; Python 3.12.10 (`python`; `python3` is only the Microsoft Store alias); git 2.55.0 |
| Last full test run | 2026-09-13 `npm test` in Git Bash: 699 tests, 695 passed, 4 failed (backup cases broken by Git Bash's `whoami.exe`, G7.7); `tests/core-launch.test.mjs` under PowerShell: 25/25 passed; `npx tsc -b` passed; `npm run lint` 0 errors, 15 warnings; `npm run build` not run this session |
| CI | `.github/workflows/ci.yml`; last main run 34629463576 on 2026-09-11 succeeded. The new validator steps have not run on GitHub yet (G7.1). Open PR 1 (docs only) passed CI on 2026-09-12. |

## 3. Done (capability ledger)

Working and covered by tests unless noted. Git history and `docs/FEATURE_STATUS.md` hold the details.

- **Boston transit planning:** OTP 2.10 graph from MBTA GTFS and Massachusetts OSM, live MBTA predictions, vehicles and alerts, NWS weather, and MapLibre maps with route geometry. Live checks are recorded in `docs/CORE_LAUNCH.md` and `docs/FEATURE_STATUS.md`.
- **AI trip assistant (G8.1):** 39-action registry planned by local llama3.1:8b with validated actions, protected forms, clarification and cancellation. `docs/LOCAL_LLAMA_REPORT.md`: 699/699 deterministic, 512/518 corpus, 12/12 critical journeys.
- **Trip safety and recovery:** versioned owner-scoped trips, durable 60-second recovery scheduling with revalidation, deduplicated inbox and Web Push outbox (push not verified on a real browser, G7.3).
- **Exports and offline:** branded itinerary PDF, calendar export, and encrypted offline packs verified in a cold-started Chrome.
- **Encrypted local backups:** hourly and daily retention, separate recovery key, tamper checks and restore tests (off-site copy missing, G2.7).
- **Account security (G3.1):** scrypt passwords, hashed sessions, CSRF, AES-256-GCM records, TOTP MFA, device revocation, enumeration-resistant recovery, and export and deletion that propagate to jobs.
- **Booking foundations (G5.7):** Duffel adapter with review binding, signed webhooks and reconciliation, fixture-tested only; every provider gate is off.
- **CI (G7.1):** typecheck, lint, tests and build on pushes and pull requests to main.
- **Shared agent memory (G1.1):** this file, `ROADMAP.md`, `AGENTS.md`, both validators inside `npm test` and CI, the stored kit in `docs/agent-memory-kit/`, and browsable pages regenerated by `npm run docs:memory`.

## 4. Next (current focus)

The complete goal tree lives in [ROADMAP.md](ROADMAP.md): goals, sub-goals and tasks with horizon, priority, status and dependencies. Run `python scripts/roadmap.py next` for actionable work and pending decisions. Every roadmap ID below must exist and still be open; `scripts/check_handoff.py` enforces this.

Current focus, chosen by the last session:

1. `G1.2` The unreleased work exists only on one laptop; ask the owner how to commit it before anything else.
2. `G6.1` The Launch 1 scope decides which hardening work matters; ask the owner to approve it.
3. `G2.2` A container image unblocks deployment, OTP hosting and load testing, and needs no decision.
4. `G3.5` IP rate limits break behind any reverse proxy; this is a code-only P0 fix.
5. `G2.7` Off-site backups are the largest data-loss risk once G2.1 picks a host.

## 5. Improvement areas (ideas, not commitments)

Record new ideas in the "Ideas not yet goals" section of `ROADMAP.md`.

## 6. Known limits and risks (do not re-discover)

- Not approved for production passenger data, according to README; no independent security review has been done (G3.7).
- Every supplier integration is fixture-tested only: Duffel sandbox, FlightAware licence and Distribusion access have not happened (G5.1, G5.3, G5.4). Keep every provider gate off.
- The accepted model runs CPU-only on the laptop: p95 13365 ms, maximum 4708853 ms (`docs/LOCAL_LLAMA_REPORT.md`) (G2.10, G8.2).
- Backups are local only and do not survive disk loss (G2.7). The data key has no rotation path (G2.8).
- Password recovery email is log-only and addresses are never verified (G3.2, G3.3).
- IP rate limits use the socket address, so they are wrong behind a proxy. Inferred from `server/server.mjs:191`, not reproduced (G3.5).
- No Dockerfile, deployment pipeline, readiness probe, request logging or error tracking exists (G2.2 to G2.6).
- The map uses the public OSM tile server, which is not for heavy production traffic (G2.11).
- Many roadmap features display Sample or heuristic values (G6.2).
- Web Push, cross-browser offline, OCR and barcode import are unverified on real devices (G7.3). There are no browser end-to-end tests in CI (G7.2).
- In Git Bash on Windows, 4 backup tests fail because `whoami.exe` resolves to the GNU binary. Run tests in PowerShell or cmd until G7.7 is fixed.
- Until G1.2 lands, `python scripts/check_handoff.py --strict` fails locally whenever `HANDOFF.md` is unmodified, because the uncommitted product work counts as code changes. Update `HANDOFF.md` during the session as the protocol requires and it passes.
- The committed `AGENTS.md` and `HANDOFF.md` cite `docs/LOCAL_LLAMA_REPORT.md`, `docs/PROVIDER_READINESS.md` and other documents that exist only in the uncommitted product work (G1.2).
- On this machine `python3` is the Microsoft Store alias; use `python`. `tests/agent-memory.test.mjs` tries `python3`, then `python`.

## 7. Decisions (do not re-litigate without a reason)

| Date | Decision | Why |
| --- | --- | --- |
| 2026-09-13 | Session memory lives in `HANDOFF.md` and the goal tree in `ROADMAP.md`, both checked by scripts | One source of truth for every person and agent |
| 2026-09-13 | The kit's pytest files are replaced by `tests/agent-memory.test.mjs`; the Python scripts stay unmodified | This repository tests with `node --test`, so validators must run where agents already run tests |
| 2026-09-13 | Horizons map to releases: short-term is Launch 1 (hosted Boston pilot, no booking), mid-term is Launch 2 (contracted booking and operational maturity), long-term is growth | Matches the two-release plan from the 2026-09-13 gap review; still subject to the owner's G6.1 answer |
| 2026-09-13 | `docs/`, `standalone/` and `output/` do not count as code for `--strict` (`.agent-memory.json`) | They are documentation or generated output, so they should not force a handoff entry on their own |
| 2026-09-13 | The kit's `agent-memory.yml` workflow is stored in `docs/agent-memory-kit/templates/` but not installed; `ci.yml` runs the validators instead | Avoids duplicate CI jobs, and adding a workflow file needs a GitHub token with the `workflow` scope |
| 2026-09-13 | The roadmap and kit pages are generated from `ROADMAP.md` and the kit README, never edited by hand | A hand-edited snapshot would drift from the validated source |

## 8. Session log (append newest first)

<!--
Template. Copy it and keep the heading format exactly: date | agent | one-line title.

### YYYY-MM-DD | <agent or person> | <short title>
- **Goal:** what was asked.
- **Changed:** files or areas touched, in one or two lines each.
- **Verified:** commands run and their real results. Say "not run" when not run.
- **Not done / left broken:** anything incomplete, failing, or skipped, and why.
- **Next agent should:** the first concrete thing to do.
-->

### 2026-09-13 | Claude Code (Claude Opus 5) | Committed the memory kit and pages on a branch
- **Goal:** Commit the two pages and implement the agent memory kit in the repository.
- **Changed:** Created branch `chore/agent-memory-kit` and committed the memory kit, validators, Node memory test, CI steps, PR template, `.gitignore` entries, `docs/roadmap/`, `docs/agent-memory-kit/` and the `docs:memory` script line. The other `package.json` changes were staged out through a blob built from `HEAD`. Added G1.1.6 and two known limits.
- **Verified:** Recorded in the commit's pre-commit run: `python scripts/roadmap.py write` and `check` OK, `npm run docs:memory` regenerated both pages, `python scripts/check_handoff.py --strict` OK, and `node --test tests/agent-memory.test.mjs` 3/3 passed.
- **Not done / left broken:** Not pushed. The product work stays uncommitted pending G1.2. CI has not run on this branch.
- **Next agent should:** Ask the owner whether to push `chore/agent-memory-kit` and open a pull request, then answer G1.2.

### 2026-09-13 | Claude Code (Claude Opus 5) | Stored the kit and published roadmap and kit pages
- **Goal:** Build browsable pages like the FinPilot roadmap preview for Wayline's goals and for the agent memory kit, and store both as docs.
- **Changed:** Added `docs/roadmap/index.html`, `docs/agent-memory-kit/index.html`, `docs/agent-memory-kit/README.md` and `docs/agent-memory-kit/templates/`, copied from the current finpilot kit. Added `scripts/render-memory-pages.mjs` and the `docs:memory` npm script. Replaced `scripts/check_handoff.py` with the kit version that adds `--base`. Added G1.1.4, G1.1.5 and G7.1.3 to `ROADMAP.md`, plus two decisions and a documentation-map entry.
- **Verified:** `cmp` confirmed `scripts/check_handoff.py` matches the kit; `python scripts/roadmap.py check` OK; `python scripts/check_handoff.py --strict` OK; `python scripts/check_handoff.py --base origin/main` OK; `node --test tests/agent-memory.test.mjs` 3/3 passed; `npx eslint` on the two new scripts passed. Both pages were published as private claude.ai artifacts.
- **Not done / left broken:** Nothing committed. A headless Chrome screenshot of each page produced no file, so the pages were not visually checked before publishing. CI has not run the new steps.
- **Next agent should:** Rerun `npm run docs:memory` after any `ROADMAP.md` edit, then follow section 1.

### 2026-09-13 | Claude Code (Claude Opus 5) | Adopted the agent memory kit and classified launch gaps
- **Goal:** Install the Agent memory kit (claude.ai artifact 15174448) and classify the "what is missing for a complete product" review, plus an outside audit, into a goal tree.
- **Changed:** Added `AGENTS.md`, `CLAUDE.md`, `HANDOFF.md`, `ROADMAP.md` and `.agent-memory.json`. Copied `scripts/roadmap.py` and `scripts/check_handoff.py` unmodified from the finpilot kit templates, plus `.github/PULL_REQUEST_TEMPLATE.md`, whose validation-document line now names Wayline's reports. Added `tests/agent-memory.test.mjs` instead of the pytest files. Added both validators to `.github/workflows/ci.yml` and `__pycache__/` and `.pytest_cache/` to `.gitignore`.
- **Verified:** `cmp` confirmed both scripts match the kit. Baseline before these changes: `npx tsc -b` passed; `npm test` in Git Bash 695/699 with 4 backup failures, and `tests/core-launch.test.mjs` 25/25 under PowerShell; `npm run lint` 0 errors, 15 warnings. After these changes: `python scripts/roadmap.py write` wrote the summary (82 tasks, 52 sub-goals); `python scripts/roadmap.py check` OK; `python scripts/check_handoff.py --strict` OK; `node --experimental-strip-types --test tests/agent-memory.test.mjs` 3/3 passed. The full `npm test` was not re-run after adding the memory test.
- **Not done / left broken:** Nothing committed or pushed (G1.2 is a decision). The CI validator steps have not run on GitHub (G7.1). `npm run build` was not run. No product gaps were fixed; they are classified only.
- **Next agent should:** Ask the owner the G1.2 and G6.1 decisions, then start G2.2 or G3.5.
