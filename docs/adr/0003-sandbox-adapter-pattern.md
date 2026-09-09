# 3. Sandbox/no-op adapters for anything that needs a commercial contract

Status: Accepted

## Context

Several roadmap features (real ticketing/payment, carrier booking, email delivery, several data
providers) are explicitly blocked on something only the user or a real deployment can supply: a
signed carrier reseller agreement, a payment processor merchant account, an email-sending
provider account, and so on. Writing code that pretends one of these is connected --
fabricating a "successful" charge or a "sent" email -- would misrepresent what the system
actually does, which conflicts with this project's own checkpoint-honesty standard
(`docs/FEATURE_STATUS.md`'s status legend).

## Decision

Wherever a feature needs an external, contracted provider, build the real business logic (state
machine, validation, idempotency, signed-webhook handling) against a small adapter interface,
and ship a synthetic/no-op/log-only implementation of that interface by default, labeled as such
directly in the UI and in the API response, not just in documentation:

- `server/adapters/payments.mjs` (Phase 5): a sandbox payment adapter that authorizes, captures
  and refunds only synthetic amounts, never touching a real network. The commerce state machine
  (`server/domain/commerce.mjs`) is real and fully tested against it.
- `server/email.mjs` (Phase 3): a `LogEmailProvider` that writes the message (recovery link,
  etc.) to the server log instead of sending it, until a real provider account is configured.
- The existing integration-capability reporting (Stage A, `server/adapters/providers.mjs`)
  already distinguished "provider required" from "unsupported" from "configured" for exactly
  this reason, before this pattern had a name.

## Consequences

- The real logic (ordering, idempotency, retries, signature verification) is exercised by real
  tests over real HTTP, so swapping in a genuine provider later is "implement one adapter", not
  a redesign or a rewrite of the state machine.
- Every sandbox/no-op surface is visibly labeled where a person would encounter it (a "Sandbox
  checkout" tab, an API field, a log line), not silently indistinguishable from the real thing.
- This intentionally does not attempt to guess what a real provider's exact API/webhook payload
  shape will be; the adapter interface may need to grow when a real one is actually integrated.
