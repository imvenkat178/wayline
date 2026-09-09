# Architectural decision records

Short records of the non-obvious engineering choices made across this project's checkpoint
phases -- what was decided, why, and what would need to change to revisit it. These are written
after the fact, documenting decisions already made in code (not a design process happening
here), as part of Phase 10's "CI and dev workflow" pass.

1. [SQLite, single-process, for this pilot](0001-sqlite-single-process.md)
2. [One generic `records` table for user-owned data (for now)](0002-generic-records-table.md)
3. [Sandbox/no-op adapters for anything that needs a commercial contract](0003-sandbox-adapter-pattern.md)
4. [A keyed i18n resource catalog, deliberately partial coverage](0004-i18n-keyed-catalog.md)
5. [Distinct-contributor aggregation thresholds for community/operator reporting](0005-aggregation-threshold-privacy.md)
6. [ESLint scope, and pinning TypeScript to 6.x for tooling compatibility](0006-eslint-scope-and-ts7-compat.md)
7. [A real relationship graph over catalog data, not a user-record schema split](0007-catalog-knowledge-graph.md)
