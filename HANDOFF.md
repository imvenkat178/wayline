# Project handoff

> Shared working memory for everyone (human or AI) who works on this repository.
> The protocol for using this file is in [AGENTS.md](AGENTS.md).
> Validate your edits with `python scripts/check_handoff.py --strict`.
>
> Sections 1 to 7 describe the **current** truth and are rewritten in place.
> Section 8 is an **append-only** log, newest entry first.

## 1. Last step (read this first)

- **When:** 2026-09-14
- **Who:** Claude Code (Claude Opus 5)
- **What happened:** Last, on 2026-09-14, PR #2 was merged into `main` as merge commit `2484230` after CI passed (run 34880174148 on its head `70e68a0`, then run 34880513668 on `main`, 704/704 tests), and the merged branch `chore/agent-memory-kit` was deleted locally and on GitHub. Before that, PR 1 was closed without merging, with its three plans kept in `docs/history/` (commit `917cb7d`), and PR #2 was opened from `chore/agent-memory-kit` into `main` (https://github.com/imvenkat178/wayline/pull/2). Its first CI run (34879457353) failed in `npm test` because 15 flight workspace tests asserted a Windows-only path separator; the test was fixed and pushed. Before that, a push of `chore/agent-memory-kit` was first rejected for a missing `workflow` scope; after the owner granted it, the branch was pushed using the GitHub CLI credential. Open PR 1 was also compared with the branch for G1.3 (conflicts in `README.md` and `docs/FEATURE_STATUS.md`; the owner's decision is pending). Earlier on 2026-09-14 added goal G10 (Documentation, 11 sub-goals) to `ROADMAP.md` and delivered its first references: `docs/README.md` (index), `docs/reference/API.md` (every endpoint), `docs/reference/CONFIGURATION.md` (all 59 environment variables), and `tests/docs-reference.test.mjs`, which fails when a server API path or environment variable is undocumented. Fixed out-of-date statements in `START_HERE.md` and `README.md`, completed `.env.example`, and added the references to the `AGENTS.md` documentation map. Then, at the owner's request, committed all remaining work, the local-Llama product release and this documentation, as one commit on `chore/agent-memory-kit` (G1.2, G10.1).
  Earlier sessions (2026-09-13, see section 8): installed the agent memory kit and turned the launch-gap review into `ROADMAP.md`: 9 goals and 52 sub-goals, each with evidence checked against the code, docs, git or a test run. Then stored the current kit in `docs/agent-memory-kit/`, updated `scripts/check_handoff.py` to the kit version that adds `--base`, and added two generated pages, `docs/roadmap/index.html` and `docs/agent-memory-kit/index.html` (`npm run docs:memory`), published as private claude.ai artifacts. No application code changed.
- **State left behind:** All work is on `main` through merge commit `2484230` (PR #2): `6b97a3d` (memory kit), `6529424` (local-Llama release and documentation), `917cb7d` (PR 1 plans kept as history), `c4fc03d` (Linux CI test fix) and `70e68a0` (CI record). This handoff update is committed on short branch `chore/record-pr2-merge` and merged through its own pull request. `chore/agent-memory-kit` no longer exists. `main` and `origin/main` are unchanged.
- **Resume by:**
  1. `git status --short` and compare it with section 2.
  2. `python scripts/roadmap.py next` to see actionable work and pending decisions.
  3. Ask the P0 decisions: G6.1 (Launch 1 scope), G2.1 (hosting) and G2.10 (model hosting). While waiting, continue documentation with G10.3.3 (request and response bodies) or G10.5 (data model), or start G2.2 (container image) or G3.5 (proxy-aware rate limiting); none of these depends on a decision.

## 2. Repository state

| Item | Current value |
| --- | --- |
| Branch | `main` at merge commit `2484230` (PR #2), matching `origin/main` (https://github.com/imvenkat178/wayline, public). This record is on short branch `chore/record-pr2-merge`; `chore/agent-memory-kit` was deleted after the merge |
| Last commit | `2484230` 2026-09-14 "Merge pull request #2 from imvenkat178/chore/agent-memory-kit" on `main`, containing `70e68a0` (CI record), `c4fc03d` (CI test fix), `917cb7d` (PR 1 history), `6529424` (product release and documentation), `6b97a3d` (memory kit, 2026-09-13) and `0f02d7a` 2026-09-11 "Boston core launch: real transit planning, AI trip agent, recovery, PDFs, encrypted offline/backups" |
| Uncommitted | None (ignored paths such as `data/`, `tmp/`, `models/` and `.env` excluded). |
| Toolchain verified here | Windows 11; Node v24.19.0; npm 11.17.0; Python 3.12.10 (`python`; `python3` is only the Microsoft Store alias); git 2.55.0 |
| Last full test run | 2026-09-14 GitHub Actions run 34879908288 on Linux (commit `c4fc03d`): `npm test` 704/704 passed. Earlier, 2026-09-14 `npm test` under PowerShell: 704 tests, 702 passed; the 2 failures were the memory validator tests, run while the roadmap summary was stale before `roadmap.py write` (re-run afterwards below). Earlier, 2026-09-13 `npm test` in Git Bash: 699 tests, 695 passed, 4 failed (backup cases broken by Git Bash's `whoami.exe`, G7.7); `tests/core-launch.test.mjs` under PowerShell: 25/25 passed; `npx tsc -b` passed; `npm run lint` 0 errors, 15 warnings; `npm run build` not run this session |
| CI | `.github/workflows/ci.yml`; last main run 34629463576 on 2026-09-11 succeeded. PR #2's first run 34879457353 (2026-09-14, head `917cb7d`) failed in `npm test`: 689 of 704 tests passed, and all 15 failures in `tests/workspace-flights.test.mjs` came from a cleanup assertion that hard-coded the Windows `\` separator; the build and memory validator steps were skipped. Run 34879908288 on the fix commit `c4fc03d` succeeded: `tsc -b`, lint, `npm test` (704/704), `npm run build`, `roadmap.py check` and `check_handoff.py --strict` all passed. After the merge, run 34880513668 on `main` at `2484230` passed with 704/704 tests. The workflow triggers only on pushes to `main` and pull requests into `main`. |

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
- **Technical references (G10.3, G10.4, G10.11):** `docs/README.md` indexes every document; `docs/reference/API.md` and `docs/reference/CONFIGURATION.md` cover every API path and environment variable, enforced by `tests/docs-reference.test.mjs`. Request and response bodies are not yet specified (G10.3.3).
- **Shared agent memory (G1.1):** this file, `ROADMAP.md`, `AGENTS.md`, both validators inside `npm test` and CI, the stored kit in `docs/agent-memory-kit/`, and browsable pages regenerated by `npm run docs:memory`.

## 4. Next (current focus)

The complete goal tree lives in [ROADMAP.md](ROADMAP.md): goals, sub-goals and tasks with horizon, priority, status and dependencies. Run `python scripts/roadmap.py next` for actionable work and pending decisions. Every roadmap ID below must exist and still be open; `scripts/check_handoff.py` enforces this.

Current focus, chosen by the last session:

1. `G7.1` CI passes on `main`; add the `check_handoff.py --base origin/main` pull-request step (G7.1.3) to finish it.
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
- CI run 34879908288 built these commits successfully, but CI does not commit build output back, so the committed `standalone/` bundle still comes from the local-Llama release session (G1.4).
- Since 2026-09-14 this repository authenticates to GitHub with a repository-scoped credential the owner supplied, stored in Windows Credential Manager for `https://github.com/imvenkat178/wayline.git`. `.git/config` resets `credential.helper` to `manager` and sets `credential.useHttpPath=true`; global git settings and other repositories are unchanged. An authenticated `git ls-remote` succeeded with it; pushing workflow changes with it is untested until the next push that touches `.github/workflows/`. Never write the credential into files, logs or chat.
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
| 2026-09-14 | Merge PR #2 into `main` with a merge commit, delete `chore/agent-memory-kit`, and record the merge through a short pull request | The owner asked to merge after CI passed and approved recording it; a merge commit keeps the five reviewed commits, the branch was fully contained in `main`, and the default branch is not committed to directly |
| 2026-09-14 | Close PR 1 without merging and keep its three planning documents in `docs/history/` (G1.3) | Its plan was largely implemented on `chore/agent-memory-kit`; merging it would conflict in `README.md` and `docs/FEATURE_STATUS.md` and reintroduce out-of-date status statements. Its README restructure feeds G10.2.3; its branch is kept |
| 2026-09-14 | Commit all remaining work (G1.2) as one commit on `chore/agent-memory-kit`, without pushing | The owner asked to commit all the work; the product release and the documentation edits overlap in `README.md`, `.env.example` and `package.json`, so separate commits would not be clean |

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

### 2026-09-14 | Claude Code (Claude Opus 5) | Merged PR 2 and deleted its branch
- **Goal:** Merge PR #2 as the owner asked, then record the merge and remove the merged branch.
- **Changed:** Merged PR #2 with a merge commit; fast-forwarded local `main`; deleted `chore/agent-memory-kit` locally and on GitHub; created `chore/record-pr2-merge` from `origin/main` for this update to sections 1, 2, 4, 7 and 8.
- **Verified:** Before merging, `gh pr view 2` showed OPEN, MERGEABLE, head `70e68a0`, and the latest branch CI run 34880174148 on `70e68a0` was a success. `gh pr merge 2 --merge` succeeded; `gh pr view 2` then showed MERGED at 2026-09-14T18:23:34Z with merge commit `2484230`, and `git merge-base --is-ancestor 70e68a0 origin/main` succeeded. CI run 34880513668 (push to `main`, head `2484230`) concluded success with 704 tests, 704 passed. Before deletion, both the local and remote branch tips (`70e68a0`) were confirmed ancestors of `origin/main`; `git branch -d` and `git push origin --delete` succeeded and `git ls-remote` then returned no `chore/agent-memory-kit` ref.
- **Not done / left broken:** This record's own pull request and its CI run are not described here. G7.1.3 is still open.
- **Next agent should:** Take G7.1.3 or the next item from `python scripts/roadmap.py next`, and ask the owner the pending P0 decisions.

### 2026-09-14 | Claude Code (Claude Opus 5) | CI passed on PR 2
- **Goal:** Confirm CI on PR #2 after the portability fix and record the result.
- **Changed:** Checked G7.1.2 and updated G7.1's evidence in `ROADMAP.md`; updated sections 1, 2, 4 and 6 of this file; regenerated `docs/roadmap/index.html`.
- **Verified:** `gh run watch 34879908288` exited 0; `gh run view` reported conclusion success for job build-and-test, with checkout, `npm ci`, `npx tsc -b`, `npm run lint`, `npm test`, `npm run build`, `python3 scripts/roadmap.py check` and `python3 scripts/check_handoff.py --strict` all successful. The run log showed 704 tests, 704 passed, 0 failed, "roadmap: ROADMAP.md OK" and "check_handoff: HANDOFF.md OK with ROADMAP.md (strict)".
- **Not done / left broken:** PR #2 is not merged; merging is the owner's decision. G7.1.3 (branch check on pull requests) is open. The CI run for the commit carrying this entry is not recorded here.
- **Next agent should:** Ask the owner whether to merge PR #2, then take G7.1.3 or the next item from `python scripts/roadmap.py next`.

### 2026-09-14 | Claude Code (Claude Opus 5) | Opened PR 2, closed PR 1 and fixed a Linux-only test failure
- **Goal:** Open the pull request into `main`, close PR 1 as agreed, and get CI passing.
- **Changed:** Opened PR #2 (`chore/agent-memory-kit` into `main`) and closed PR 1 with a comment linking PR #2 and `docs/history/`. Fixed `tests/workspace-flights.test.mjs` to use `path.sep` instead of a hard-coded Windows separator. Marked G1.3 done, added G7.1.4, recorded the PR 1 decision in section 7, and updated sections 1, 2 and 4.
- **Verified:** `gh pr create` returned https://github.com/imvenkat178/wayline/pull/2; `gh pr view 1` showed CLOSED at 2026-09-14T18:13:06Z. CI run 34879457353 on head `917cb7d` failed: checkout, `npm ci`, `tsc -b` and lint passed; `npm test` reported 704 tests, 689 passed, 15 failed, all at `tests/workspace-flights.test.mjs:24`; build and memory validators were skipped. Before the fix that file passed 15/15 locally in Eastern and UTC time zones, which ruled out time zones. After the fix it passed 15/15 locally and `npx eslint` passed.
- **Not done / left broken:** The CI run for the fix commit had not finished when this was written; G7.1.2 stays open until a passing run is confirmed. `npm run build` has still not run anywhere for these commits.
- **Next agent should:** Check PR #2's latest CI run and record the result under G7.1.

### 2026-09-14 | Claude Code (Claude Opus 5) | Preserved pull request 1's plans as history
- **Goal:** Apply the owner's choice for PR 1 (close it and keep its planning documents), and commit and push the pending memory updates.
- **Changed:** Added `docs/history/CONVERSATIONAL_TRIP_WORKSPACE.md`, `docs/history/CHEAPEST_MULTIMODAL_TRAVEL_PLAN.md` and `docs/history/REVIEW_2026-09-12.md`, copied from PR 1 commit `083ea53` with a historical note under each title and relative links adjusted for the new folder. Added a History section to `docs/README.md` and linked the preserved C01–C12 plan from `docs/MULTIMODAL_IMPLEMENTATION.md`.
- **Verified:** All 41 relative links in the three copies resolve to existing files (checked 2026-09-14). The commit command compares each copy with PR 1's original and stops unless the only differences are the added note and adjusted links.
- **Not done / left broken:** PR 1 is closed and the pull request into `main` is opened after this commit is pushed; G1.3 is marked done in a follow-up commit once those actions have real results.
- **Next agent should:** Confirm the follow-up commit recorded the pull request numbers and the CI result.

### 2026-09-14 | Claude Code (Claude Opus 5) | Configured a repository-scoped GitHub credential
- **Goal:** Store the owner's GitHub credential for this repository only, not globally.
- **Changed:** In `.git/config`, replaced the `!gh auth git-credential` helper with an empty reset followed by `manager`, and set `credential.useHttpPath=true`. Saved the credential in Windows Credential Manager for `https://github.com/imvenkat178/wayline.git` with `git credential approve`. Updated section 6 of this file. No commit made.
- **Verified:** `git config --global --get-regexp ^credential` returned nothing before and after. `git credential fill` for this repository's path returned username `imvenkat178` with a password (value not printed). `git ls-remote origin refs/heads/chore/agent-memory-kit` succeeded non-interactively and returned `6529424`. In a scratch repository with the same settings, `git credential fill` for `imvenkat178/some-other-repo.git` returned no credential ("could not read Username ... terminal prompts disabled"), confirming the entry is scoped to this repository path.
- **Not done / left broken:** Pushing workflow file changes with this credential is untested. The owner was advised to revoke this credential later because it was shared in chat; the older global `git:https://github.com` entry is unchanged.
- **Next agent should:** Ask the owner whether to open a pull request into `main` and which PR 1 option to apply.

### 2026-09-14 | Claude Code (Claude Opus 5) | Pushed the branch with the workflow scope
- **Goal:** Retry the push after the owner added the `workflow` scope.
- **Changed:** Pushed `chore/agent-memory-kit` to origin. Updated sections 1, 2, 4 and 6 of this file and regenerated `docs/roadmap/index.html`. No commit made.
- **Verified:** `gh auth status` listed `'workflow'`, but a plain `git push` was still rejected for the missing scope. `git config --show-origin` showed `credential.helper=manager` in the system gitconfig and `!gh auth git-credential` in `.git/config`. `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push -u origin chore/agent-memory-kit` succeeded; `git ls-remote` returned `6529424874fb76ad62b98ab9e68c1da9c65705a5`, equal to local HEAD, with `6b97a3d` and `6529424` ahead of `origin/main`. `gh run list --branch chore/agent-memory-kit` listed no runs.
- **Not done / left broken:** No pull request opened, so CI has not run (G7.1). PR 1 still awaits the owner's choice (G1.3.2). The stored Git Credential Manager token is unchanged. These memory edits are uncommitted.
- **Next agent should:** Ask the owner whether to open a pull request into `main`, and which PR 1 option to apply.

### 2026-09-14 | Claude Code (Claude Opus 5) | Push rejected and pull request 1 compared
- **Goal:** Push the committed work, then resolve open pull request 1 (G1.3).
- **Changed:** Checked G1.3.1 and added G1.3.2 in `ROADMAP.md`; added a known limit for the push; regenerated `docs/roadmap/index.html`. Fetched `origin/docs/cheapest-multimodal-flight-plan`. No commit made.
- **Verified:** `git push -u origin chore/agent-memory-kit` was rejected: GitHub refused to update `.github/workflows/ci.yml` without the `workflow` scope; `gh auth status` showed scopes `gist`, `read:org`, `repo` on two later checks, so no retry was made. `gh pr view 1`: open, 2 commits (30fb62b, 083ea53), 7 documentation files, reported mergeable into main. `git merge-tree --write-tree` merged PR 1 into `origin/main` cleanly and into `chore/agent-memory-kit` with conflicts in `README.md` and `docs/FEATURE_STATUS.md`. `docs/MULTIMODAL_IMPLEMENTATION.md` on the branch describes itself as the implementation checkpoint for PR 1's C01–C12 plan and reports C01 (cash accounting, factual AI) as implemented; this was read from the document, not re-tested.
- **Not done / left broken:** Not pushed. PR 1 is still open pending the owner's choice (G1.3.2). These memory edits are uncommitted.
- **Next agent should:** Ask the owner to grant the `workflow` scope and choose what to do with PR 1, then apply both.

### 2026-09-14 | Claude Code (Claude Opus 5) | Committed the product release and documentation
- **Goal:** Commit all the work, as the owner asked.
- **Changed:** Marked G1.2 and G10.1 done; refreshed sections 1, 2, 4, 6 and 7; regenerated `docs/roadmap/index.html`; committed every pending change (the local-Llama product release: server, shopping, domain, source, tests, scripts, standalone build, docs and `docs/evaluations/`; plus the documentation work) on `chore/agent-memory-kit`.
- **Verified:** Before staging, scanned all 239 pending files for credential patterns (Duffel, OpenAI-style, LangSmith, GitHub and AWS keys, private keys, long secret assignments) and personal email addresses with no matches, and found no file over 2 MB and no `.env`, key or database files. The commit command ran only after `python scripts/roadmap.py check`, `python scripts/check_handoff.py --strict`, `python scripts/check_handoff.py --base origin/main` and `node --test tests/agent-memory.test.mjs tests/docs-reference.test.mjs` all succeeded in the same chained command. The full suite on this code earlier today: 704 tests, 702 passed, 2 memory tests failing only because the summary was stale at the time.
- **Not done / left broken:** Not pushed. `npm run build` not re-run. CI has not run this branch.
- **Next agent should:** Ask the owner whether to push and open a pull request, then confirm the CI run (G7.1).

### 2026-09-14 | Claude Code (Claude Opus 5) | Added the documentation goal, API and configuration references
- **Goal:** Close the documentation gaps found in the 2026-09-14 review: add a documentation goal, fix out-of-date statements, and write API and configuration references.
- **Changed:** Added G10 (11 sub-goals) to `ROADMAP.md`. Wrote `docs/README.md`, `docs/reference/API.md` from every route handler and `docs/reference/CONFIGURATION.md` from every `env.` read. Added `tests/docs-reference.test.mjs`. Fixed the port and pilot steps in `START_HERE.md`; in `README.md` fixed the test count, Planner row and architecture table and linked the references; added seven runtime variables to `.env.example`; added three rows to the `AGENTS.md` documentation map; regenerated `docs/roadmap/index.html`.
- **Verified:** Before the handoff update: `node --test tests/docs-reference.test.mjs` 2/2 passed; `npx eslint tests/docs-reference.test.mjs` passed; a scan found all 42 runtime variables in `.env.example`; `npm test` under PowerShell 704 tests, 702 passed, with only the two memory validator tests failing because the roadmap summary was not yet regenerated; `python scripts/roadmap.py write` then `check` OK. After this entry: `python scripts/check_handoff.py --strict` first failed because section 1 had renamed its **What happened** field, which was fixed; the post-fix results are the next command run, and `roadmap.py check`, the API and configuration reference tests and the agent entry-point test passed.
- **Not done / left broken:** Nothing committed. Request and response bodies are not specified (G10.3.3). README still opens with the dated checkpoint narrative (G10.2.3). Data model, feature pages, architecture, operations and contributor documents are open (G10.5 to G10.9), and SECURITY.md waits on the owner (G10.10).
- **Next agent should:** Ask the owner whether to commit the documentation work, then continue with G10.3.3 or G10.5.

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
