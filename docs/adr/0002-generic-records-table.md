# 2. One generic `records` table for user-owned data (for now)

Status: Accepted, planned for partial revisit (see "Revisit when")

## Context

Journeys, commutes, passes, tickets, alerts, shares, push subscriptions, and reports all needed
the same basic shape early on: owned by exactly one user, encrypted at rest, versioned for
optimistic concurrency, and soft/hard-deletable. Building a dedicated SQL table with its own
migration for each kind, before knowing which kinds would need dedicated indexes or queries,
risked guessing wrong and migrating twice.

## Decision

Store all of these kinds in one `records` table (`id, user_id, kind, version, payload
(encrypted), created_at, updated_at`), with `kind` as a discriminator, and let `server/store.mjs`
provide kind-scoped helpers (`list(userId, kind)`, `put`, `patch`, etc.) on top of it. Give a
kind its own dedicated table only when it earns one -- `jobs`, `sessions`, `mfa`,
`pending_logins`, `recovery_tokens`, and `shares` already did, each added in the phase that
needed real relational structure (foreign keys, dedicated indexes, or a lease/claim model) that
the generic table couldn't provide.

## Consequences

- Fast to add a new kind of user-owned data (no migration needed) -- used repeatedly across
  Phases 4-9 (alerts, reports, tickets, push subscriptions).
- Querying across kinds, or by a field inside the encrypted `payload`, requires decrypting rows
  in application code rather than a SQL `WHERE` clause -- acceptable at this pilot's data
  volumes, not at a much larger scale.
- The roadmap's own "Transport Knowledge Graph" / shared-architecture section calls for
  dedicated indexed tables per kind. This ADR is the record of _why_ that hasn't happened yet for
  journeys/commutes/passes specifically: doing it once, after the kinds that need their own
  table have already revealed themselves through real feature work, was judged better than
  guessing a schema up front and migrating it twice.

## Revisit when

Phase 11 (data-model modernization, roadmap-planned but not yet executed as of this checkpoint):
once the dedicated-table kinds added through Phase 9 stop growing, split `records`' remaining
generic usage (journeys, commutes, passes) into their own indexed tables in one consolidation
pass, informed by the query patterns those phases actually needed rather than a premature guess.
