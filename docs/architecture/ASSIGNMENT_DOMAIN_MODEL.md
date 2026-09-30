# Assignment Domain Model

Status: P0-E5-S1. See [ASSIGNMENT_ELIGIBILITY.md](ASSIGNMENT_ELIGIBILITY.md) for the decision itself.

## 1. Entity

`public.shift_assignments`: one worker record on one shift.

| Column                                                   | Guarantee                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `(agency_worker_id, agency_organisation_id, profile_id)` | → `agency_workers`: the worker belongs to the shift's agency AND is that person |
| `(shift_id, agency_organisation_id, start_at, end_at)`   | → `shifts`: same agency; the period is the shift's period                       |
| `(assigned_by_membership_id, agency_organisation_id)`    | the actor is a member of the same agency                                        |
| `period` (generated `tstzrange [start, end)`)            | used for conflict detection                                                     |

No attendance, timesheet or pay fields.

## 2. Lifecycle

```
assigned ──► accepted ──► cancelled
    ├──────► declined          (worker)
    └──────► cancelled         (agency, or shift cancellation)
```

- Agency assigns → `assigned`. The worker must explicitly **accept** or
  **decline** (a later broadcast/offer workflow can build on this).
- Active = `assigned | accepted`: consumes headcount and blocks the person's
  time. `declined | cancelled` do neither and are terminal.
- No `completed` state: completion is a shift fact; attendance is a later stage.
- Assignment state is never conflated with shift state.

Cancellation reasons: `shift_cancelled` (system, when the shift is
cancelled), `worker_unavailable`, `compliance_change`, `entered_in_error`,
`relationship_suspended`, `other`.

## 3. Structural invariants (tested as DB owner)

| Invariant                                                                   | Mechanism                                                             |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| one active assignment per (shift, worker)                                   | unique partial index                                                  |
| no person holds two overlapping active assignments, **across all agencies** | `EXCLUDE USING gist (profile_id WITH =, period WITH &&) WHERE active` |
| active assignments ≤ requested headcount                                    | capacity trigger locks the shift row (`FOR UPDATE`) then counts       |
| new assignments only on open shifts                                         | capacity trigger (`CHS09`)                                            |
| legal transitions only                                                      | transition trigger (`CHA09`)                                          |
| person, shift, period, actor immutable                                      | `enforce_immutable_columns`                                           |

## 4. Worker actions

`accept_shift_assignment` / `decline_shift_assignment` act only on the
caller's OWN assignment (`authz.is_own_active_worker`: same person, active
membership). Another worker's or a scheduler's attempt returns
`ASSIGNMENT_NOT_FOUND` (`CHA04`). Acceptance re-checks eligibility live
(`CHS12–CHS15`) and requires an open, not-ended shift under an active
relationship. A worker cannot alter the shift, the worker record, compliance,
or assign themselves (they cannot see agency shifts; an agency member cannot
assign their own worker record).

## 5. Concurrency

`assign_worker_to_shift` takes, in this fixed order:

1. `SELECT … FOR UPDATE` on the shift row — serialises capacity per shift;
2. `pg_advisory_xact_lock(hash('chelth.schedule:' || profile_id))` —
   serialises schedule checks per person across agencies.

Then evaluates, records the decision and inserts. The capacity trigger and the
exclusion constraint are backstops for any other writer. Integration tests race
two schedulers for the last slot and two submissions of the same worker; exactly
one wins each race.

## 6. Decisions and audit

Every attempt records an append-only `assignment_eligibility_decisions` row
(allowed or refused), and audit events `assignment.created`,
`assignment.rejected_by_compliance`, `assignment.rejected_by_conflict`,
`assignment.rejected_by_capacity`, `assignment.accepted/declined/cancelled`.

## 7. Notification hooks

`internal.notification_outbox` (transactional outbox, no API access) receives
`worker_assigned`, `assignment_cancelled`, `assignment_declined`,
`facility_request_submitted`, `facility_request_opened`, `shift_cancelled`,
`assignment_non_compliant` (from `internal.scan_assignment_readiness`, one
pending row per assignment). Delivery (email/push) is a later stage.

## 8. Operations (P0-E5-S2)

- **One assignment core**: `internal.perform_assignment` is used by direct
  assignment and offer acceptance (relationship share lock → shift row lock →
  person advisory lock → canonical eligibility → decision → assignment).
  An assignment created by accepting an offer is `accepted` immediately and
  attributed to the scheduler who made the offer.
- **Offers**: [SHIFT_OFFER_MODEL.md](SHIFT_OFFER_MODEL.md).
- **Issues**: operational attention is a separate table, never an assignment
  status ([ASSIGNMENT_READINESS_MONITORING.md](ASSIGNMENT_READINESS_MONITORING.md)).
- **Notification hooks are delivered**: the outbox is now a per-recipient
  delivery queue consumed by the dispatcher
  ([NOTIFICATION_DELIVERY.md](NOTIFICATION_DELIVERY.md)).
- `accept_shift_assignment` follows the relationship → assignment lock order.

## 9. Attendance (P0-E6-S1)

- Only an `accepted` assignment can clock in (`CHT05` otherwise), and clock-in
  re-runs the canonical eligibility gate: a worker no longer eligible is
  refused with a committed `assignment_not_ready` exception.
- `shift_assignments` gains a unique key `(id, agency_organisation_id,
shift_id, agency_worker_id, profile_id)`; `assignment_attendance`
  references it so attendance can never move between assignments, people or
  tenants.
- Attendance never changes assignment status. Cancelling or removing an
  accepted assignment closes its missed-clock exceptions
  (`assignment_closed`); an already clocked-in worker can still clock out.
- Lock order: relationship (share) → assignment (update) → attendance.
- See [ATTENDANCE_DOMAIN_MODEL.md](ATTENDANCE_DOMAIN_MODEL.md),
  [ATTENDANCE_CORRECTIONS.md](ATTENDANCE_CORRECTIONS.md).
