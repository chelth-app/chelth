# Shift Offer Model

Status: P0-E5-S2. Builds on [ASSIGNMENT_DOMAIN_MODEL.md](ASSIGNMENT_DOMAIN_MODEL.md)
and [ASSIGNMENT_ELIGIBILITY.md](ASSIGNMENT_ELIGIBILITY.md).

## 1. What an offer is

An agency asks specific workers to take a shift. An offer is **not** an
assignment and **reserves no headcount**. It is not a marketplace: offers go
only to workers the scheduler chooses, from the agency's own eligible
candidates, listed alphabetically (no ranking or recommendation).

`public.shift_offers`: shift, agency, worker, person, status, `offered_at`,
`expires_at`, `responded_at`, `closed_at` + `close_reason`, `assignment_id`
(when accepted), `created_by_membership_id`.

## 2. Lifecycle

```
offered ──► accepted   (worker; full gate passed → assignment created, status accepted)
        ├─► declined   (worker)
        ├─► expired    (expires_at passed; scheduled tidy-up)
        └─► cancelled  shift_filled | shift_cancelled | shift_closed | withdrawn |
                       relationship_not_active | assigned_directly
```

Terminal states are immutable (`CHO09`). One live offer per (shift, worker).

## 3. Creating (broadcast)

`offer_shift_to_workers(shift, workers[1..50], expires_in_minutes 15..10080)`
(`assignment.manage`): shift open and not started; relationship active; shift
not full; every worker id must belong to the agency (a foreign id rejects the
whole batch — no partial effects). Each worker is checked with the canonical
eligibility function; blocked or already-offered workers are skipped with a
reason. Expiry is capped at the shift start. Each offer notifies the worker
(`shift_offered`) and is audited (`shift.offer_created`).

## 4. Acceptance = the full live gate

`accept_shift_offer` (own offer only, `CHO04` otherwise): relationship share
lock → shift row lock → offer lock; `CHO09` if not open, `CHO10` if expired
(deterministic even before the expiry job runs); then
`internal.perform_assignment` — the same core as direct assignment —
re-runs compliance, schedule (person-level, cross-agency) and capacity, records
an append-only decision (actor: the worker), and creates the assignment only if
everything passes. The resulting assignment is **accepted** (the worker has
consented). Refusals are returned with safe reasons; a compliance refusal
leaves the offer open until expiry so the worker can fix the gap; a full shift
closes the offer as `shift_filled`.

## 5. Filling and closing

When an assignment (by offer or direct) makes active assignments reach the
headcount, all remaining live offers close as `shift_filled`. Direct assignment
of a worker closes that worker's live offer (`assigned_directly`). Cancelling
or completing the shift, reducing headcount to the active count, or suspending
/ending the relationship close live offers too. Concurrent acceptances
serialise on the shift row: exactly one wins the last place (integration test).

## 6. Visibility

| Party                           | Sees                                                        |
| ------------------------------- | ----------------------------------------------------------- |
| Agency (`assignment.view`)      | offers of its shifts with worker names and status           |
| Worker                          | own offers only (`list_my_shift_offers`, RLS)               |
| Facility                        | **nothing** — no table path, not in any facility projection |
| Other agencies, platform admins | nothing                                                     |

## 7. Expiry

`expires_at` is a timestamptz; acceptance compares with `now()` server-side.
`internal.expire_shift_offers` (pg_cron every 5 min, idempotent) marks stale
offers expired and audits `shift.offer_expired`.
