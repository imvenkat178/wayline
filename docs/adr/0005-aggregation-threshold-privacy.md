# 5. Distinct-contributor aggregation thresholds for community/operator reporting

Status: Accepted

## Context

Crowdsourced station/vehicle reports (roadmap features 98-101) are useful in aggregate but
identifying on their own: a low-ridership stop with one filed report could otherwise let an
operator (or anyone who can see the dashboard) infer who filed it, just from "1 report of this
type here" being visible. The original `/api/community` endpoint already had a single hardcoded
threshold of 5 raw reports; Phase 8 needed a per-type breakdown for the operator dashboard
without reintroducing that identifiability risk at finer granularity.

## Decision

Never disclose a count for a (station, type) unless at least `MIN_REPORT_COHORT` (currently 5)
_distinct contributing accounts_ -- not raw row count, so one account filing many reports can't
inflate the count -- have reported it recently. Below that threshold, name the type without a
number (`server/store.mjs`'s `operatorReportBreakdown`), so the dashboard can still convey "there
is some signal here" without revealing exactly how much. Export the threshold as a single shared
constant (`MIN_REPORT_COHORT`) used by both `/api/community` and the new
`/api/operator/reports` breakdown, instead of two independently hardcoded literals -- a real bug
class (the two copies drifting apart) that Phase 8's own tests caught and fixed.

Individual report moderation (the `/api/operator/reports` worklist, `PATCH .../reports/:id`) is
deliberately NOT threshold-gated: resolving "the elevator here is broken" is an operational
ticket about one thing, not a demographic signal about who reported it, and the reporter's
identity is never included in what an operator sees there (`decode()` omits `user_id`).

## Consequences

- A single shared constant makes the threshold auditable and impossible to silently drift
  between endpoints.
- The moderation worklist and the aggregate dashboard have deliberately different privacy
  postures for a principled reason (operational ticket vs. demographic signal), documented here
  so a future change doesn't accidentally threshold-gate the worklist "for consistency" without
  realizing why it currently isn't.
