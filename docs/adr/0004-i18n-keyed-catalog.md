# 4. A keyed i18n resource catalog, deliberately partial coverage

Status: Accepted

## Context

Before Phase 7, the only localization was one hardcoded positional array of navigation labels
(index-matched to a locale list, easy to silently misalign) with no locale-aware date, number,
or currency formatting anywhere else, and no way to add a translated string without touching
component code directly.

## Decision

Move to a conventional keyed resource-table approach: `src/i18n.ts` exports flat,
dot-namespaced resource tables per locale (`nav.*`, `app.*`, `phrasebook.*`, `planner.*`), a
`t(locale, key, vars)` lookup function with a three-tier fallback (requested locale -> English
-> the bare key itself, so a missing translation degrades to something visible rather than
throwing or rendering blank), and `Intl`-backed `formatDate`/`formatNumber`/
`formatCurrencyCents` bound to a `localeTags` map. `src/useT.ts` wraps this in a hook reading the
signed-in user's `preferences.language`.

Deliberately do NOT attempt full coverage in one pass. `FULL_UI_LOCALES` explicitly lists which
locales have complete coverage for the namespaces that have been migrated (English and Spanish,
as of Phase 7); Hindi covers only navigation and the phrasebook. Every non-English string is
labeled "AI-translated, unreviewed" in the UI itself, not just in documentation, matching the
roadmap's own acknowledgment that translation quality review is a human task.

## Consequences

- Adding a new locale or a new namespace is additive (new keys/tables), not a rewrite of the
  lookup mechanism.
- A component migrated to `useT()` degrades gracefully for a locale/key combination that isn't
  translated yet, rather than crashing.
- Pages not yet migrated (Wallet, Journey, Profile besides its language selector, Trips,
  Commute, Inbox, Lab, Offline, Agent, as of this checkpoint) remain English-only regardless of
  the selected language -- this is visible and documented (README's "Known gaps" item 16), not
  hidden behind an illusion of full localization.
