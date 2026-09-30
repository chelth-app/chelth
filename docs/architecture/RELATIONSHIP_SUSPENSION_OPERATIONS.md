# Relationship Suspension Operations

Status: P0-E5-S2. Extends [AGENCY_FACILITY_RELATIONSHIPS.md](AGENCY_FACILITY_RELATIONSHIPS.md).

`set_facility_relationship_status` (owner, `relationship.manage`, AAL2) applies
the status change **and** its operational effects in ONE transaction.

## 1. Effects

| Change                       | Immediately                                                                     | Upcoming work (not ended)                                                                                                                                           | History |
| ---------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| active → **suspended**       | no new shifts, requests, openings, offers, assignments or acceptances (`CHS10`) | live offers cancelled (`relationship_not_active`); active assignments flagged (`relationship_not_active` issues); shifts listed on `/operations`                    | kept    |
| active/suspended → **ended** | as suspended; facility loses all visibility                                     | **not-yet-started** shifts cancelled (reason `relationship_ended`) with their assignments (workers notified `shift_cancelled`); in-progress shifts kept and flagged | kept    |
| suspended → **active**       | new work allowed again                                                          | relationship issues resolved (`relationship_restored`)                                                                                                              | kept    |

Nothing is deleted. Agency operations users are notified
(`relationship_suspended` / `relationship_ended`, the acting admin excluded).
Audit: `relationship.status_changed` (both organisations) and
`relationship.operations_applied` with counts only (upcoming shifts,
cancelled shifts, cancelled offers, flagged assignments, resolved issues) — no
names or addresses.

## 2. Facility access

Suspended: the facility still sees its shifts and who is coming (read-only)
but cannot submit or withdraw requests. Ended: no facility access at all
(`has_relationship_capability` requires a non-ended relationship).

## 3. Concurrency

The status change locks the relationship row `FOR UPDATE`. Every operation
that creates work (assign, accept, offer, open, create, submit) first takes a
`FOR SHARE` lock on the relationship via `internal.require_active_relationship`,
then the shift row. So an assignment either completes before the suspension
(and is then flagged by it) or waits and is refused with `CHS10` — never
slips through unflagged. Lock order everywhere: relationship → shift → person
→ offers (no deadlock cycle).
