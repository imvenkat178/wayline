# 7. A real relationship graph over catalog data, not a user-record schema split

Status: Accepted (Phase 11)

## Context

The original plan for "Phase 11" (written before this ADR existed, in the session's own planning
notes) described splitting the generic `records` table's remaining journey/commute/pass usage
into dedicated indexed SQL tables, loosely citing the roadmap's "shared architecture" guidance.
Revisiting that plan before starting the work surfaced a scoping mismatch: the actual roadmap
item behind it, feature 44 ("Transport Knowledge Graph"), asks for real entities and
relationships among _catalog_ data -- City, Agency, Route, Station, Stop, and so on -- "so
Wayline can reason across operators." It says nothing about how a user's own journey/commute/
pass records are stored.

Doing the originally-planned records-table split would also have forced a real, user-visible
privacy tradeoff that the roadmap item doesn't actually ask for: every record's `payload` is
stored as one AES-256-GCM-encrypted blob (see the "Security and privacy" section of README.md).
A SQL index on any field inside it -- departure city, date, whatever a "dedicated indexed table"
would want to query on -- requires storing that field in plaintext outside the encrypted blob.
That is a real change to this app's privacy posture, not a mechanical refactor, and not
something to decide unilaterally on behalf of a transit app that stores where people are
travelling.

## Decision

Build what feature 44 actually asks for, scoped to what this catalog can back with real
(if illustrative/unverified, like everything else in `server/catalog.mjs`) data: real ID-based
relationships between the existing catalog entities, replacing string/name matching where a real
edge now exists.

- `agencies` gained a `modes` field (train/bus/ferry) for the specific agencies this catalog can
  actually name with any confidence -- not invented for the rest of the 50-state seed.
- `corridors` gained real `agencyIds` edges to specific agencies (e.g. `sf-oak` -> BART,
  `sea-bai` -> Washington State Ferries, `la-lax` -> LA Metro), resolved by name once at module
  load rather than hardcoded ids that would silently drift if the seed list is reordered.
  `agenciesForCorridor()` and `operatorForCorridor()` are the real graph-traversal functions
  this enables; `operatorForCorridor` returns `null` rather than guessing when the graph has no
  agency for a given corridor+mode.
- `stations` became their own entities (id, `cityId`, name, coordinates, `agencyIds`) instead of
  a single string field embedded in `City`, linked to the agencies known to serve that city.
- `discoverAgencies()` now prefers the real corridor graph edges when one exists, and only falls
  back to the original name-substring match for the ~44 states that have no sample corridor at
  all (the seed's 50-state discovery breadth was never meant to have a real corridor edge for
  every one of them).
- `Washington State Ferries` -- referenced by name in `operatorLinks` and hardcoded directly in
  `journeys.mjs`'s sample search before this pass -- is now an actual seeded agency with a real
  `modes: ["ferry"]`, closing a real gap where the name existed nowhere in the agency catalog
  itself.
- `sampleSearch()`'s main-leg operator now comes from `operatorForCorridor()` when the graph has
  an answer, falling back to the original generic guess (Amtrak for long-distance rail,
  Greyhound/FlixBus alternating for bus) when it doesn't -- e.g. a train-mode San Francisco-
  Oakland sample journey now genuinely says "BART" instead of "Amtrak".

## Consequences

- This is entirely over static, non-personal reference data. No encryption, schema, or privacy
  posture changed; `records`, `shares`, and every per-user table are untouched.
- The graph currently only has real edges for the six sample corridors and the dozen agencies
  named above -- it does not (and does not claim to) cover cross-operator reasoning for the
  other ~50 seeded agencies with no corridor, or for any route/stop/platform-level detail the
  roadmap's entity list also names. See ADR 2 for the parallel, still-open question of whether
  `records`' remaining generic usage (journeys/commutes/passes) should eventually get dedicated
  tables -- that is now explicitly a separate question from this one, not conflated with it.
- `operatorForCorridor` returning `null` rather than a guess is deliberate: a caller that wants a
  fallback has to say so explicitly (as `sampleSearch` now does), so a future consumer can't
  silently inherit an unverified default without noticing.
