# 1. SQLite, single-process, for this pilot

Status: Accepted (checkpoint, 8-9 September 2026)

## Context

The whole backend (`server/`) needed a real, persistent datastore from the first working
version onward: encrypted user records, sessions, MFA, jobs, and (starting Phase 1) a durable
job queue for Guardian's sweep and web push delivery. This is a single-deployment pilot with no
existing infrastructure, hosting budget, or ops team to run and operate a separate database
server.

## Decision

Use Node's built-in `node:sqlite` against one file (`data/wayline.sqlite`), accessed through a
single `Store` class (`server/store.mjs`) that owns schema/migrations, encryption, and all
queries. The durable job queue (`server/jobs.mjs`, Phase 1) uses the same database with a
leased-row claim/backoff/dead-letter model instead of a separate queue technology (Redis,
SQS, etc).

## Consequences

- No extra service to deploy, configure, or keep patched -- appropriate for this pilot's scale
  and team size.
- Single-process only: multiple server instances cannot safely share one SQLite file for
  write-heavy tables like `jobs` without a real distributed lease protocol, which this does not
  implement. Guardian's sweep and job processing assume exactly one running server process.
- All the durability properties the project has actually tested (restart-safety, lease/backoff,
  crash recovery) are real and unit/integration-tested against this file, not against a
  simulated multi-node deployment.

## Revisit when

Traffic or reliability requirements need more than one server process, or a managed/ops team
becomes available to run Postgres (or similar) instead. At that point the job queue's
lease/claim logic is the piece that would need a real distributed-lock rework; the record
storage itself is a more mechanical migration.
