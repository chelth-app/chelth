# Timesheet Approval Flow

Status: P0-E6-S2. See [TIMESHEET_DOMAIN_MODEL.md](TIMESHEET_DOMAIN_MODEL.md).

```
open ──submit (worker)──► submitted ──approve (agency)──► agency_approved ──all facility sign-offs──► locked
  ▲                          │                                 │                                   │
  │                          └──return (agency)──► rejected ───┘ (worker resubmits)                  │
  └──────────── reopen (agency, reason) ◄───────────── agency_approved / locked ─────────────────────┘
                 attendance change after approval ⇒ new revision, status submitted (re-approval)
```

Transitions are enforced by a trigger; leaving `agency_approved`/`locked`
always increments the revision.

## 1. Worker submission — `submit_timesheet`

Own timesheet only (live membership). Allowed from `open` or `rejected`
after a rebuild, when there are no blocking reasons:

| Code                 | Meaning                                           |
| -------------------- | ------------------------------------------------- |
| `PERIOD_NOT_ENDED`   | The week's last local date has not ended.         |
| `NO_WORK`            | No included entries.                              |
| `MISSING_CLOCK_IN`   | No effective clock-in (and not "not worked").     |
| `MISSING_CLOCK_OUT`  | No effective clock-out. An end is never invented. |
| `BREAK_NOT_ENDED`    | A break has no end.                               |
| `TIMES_INCONSISTENT` | Effective times are out of order.                 |
| `PENDING_CORRECTION` | A correction request awaits review.               |

A blocked submission returns `outcome = 'blocked'` with the codes; nothing is
written. A successful submission notifies agency approvers.

## 2. Agency approval — `approve_timesheet(timesheet, expected_revision)`

`timesheet.approve`; never the worker themself (`CH403`). The caller names the
revision they reviewed (`CHP14` if it changed). Approval rebuilds, then
requires the reasons above **and** no unreviewed attendance exception
(`UNREVIEWED_EXCEPTION`): late clock-ins, location results and the like must
be acknowledged or dismissed first — that is the explicit acknowledgment.

Approval writes an immutable snapshot and marks each included entry at a
linked facility (relationship not ended) as awaiting sign-off. If none needs
sign-off, the timesheet locks immediately. One notice per facility
organisation.

Reviewers never edit hours. If a time is wrong they use the correction
workflow ([ATTENDANCE_CORRECTIONS.md](ATTENDANCE_CORRECTIONS.md)).

`reject_timesheet(reason, note)` returns a submitted timesheet to the worker
(reason required, note visible to the worker, worker notified).

## 3. Facility sign-off — `facility_decide_timesheet_entry`

Per entry, never per timesheet: a worker's week can span facilities, and
each facility decides only for entries at its own facility
(`authz.has_relationship_capability(entry.relationship, 'timesheet.facility_signoff')`
and the entry's linked facility organisation). The facility sees worker
name, date, scheduled shift, effective start/end, breaks, worked minutes and
whether the agency reviewed an exception — never coordinates, notes,
credentials, other facilities or other agencies' work.

- **Sign off** — records a decision with a snapshot. The last sign-off locks
  the timesheet.
- **Raise a discrepancy** — reason (`worker_not_present`, `time_incorrect`,
  `break_incorrect`, `assignment_not_worked`, `other`) and an optional note
  (≤ 500). Times are untouched; the agency is notified.

The agency answers a discrepancy either by confirming the times stand
(`resolve_timesheet_dispute`, entry returns to the facility) or by correcting
attendance, which creates a new revision.

## 4. Revisions and locking

A locked or approved timesheet never changes silently:

- A correction/adjustment affecting it requires the reviewer to confirm a
  revision **and** hold `timesheet.approve` (`CHT22` otherwise).
- When a derived time changes after approval, the approval and live facility
  decisions are superseded, open discrepancies resolve as `timesheet_revised`,
  the revision increments and the timesheet returns to `submitted` for
  agency re-approval and new facility sign-off.
- `reopen_timesheet(reason, note)` explicitly returns an approved or locked
  timesheet to the worker as a new revision.

Every step is in `timesheet_history` and the audit log (codes only).

## 5. Relationship ended while sign-off is pending (P0-E7-S1, closes S2 S7)

When a relationship becomes `ended` (any path), a trigger on
`agency_facility_relationships` runs `internal.release_facility_signoffs`:

- for each `agency_approved` timesheet with entries of that relationship still
  `pending` (locked `FOR UPDATE`, after the relationship row the status
  change already holds): those entries become `not_required`;
- each release is recorded in `timesheet_history`
  (`facility_signoff_not_required`, reason `relationship_ended`) and audited
  (`timesheet.signoff_not_required` with counts);
- if nothing is left `pending` or `disputed`, the timesheet locks
  (history + audit) — no manual reopen or re-approval;
- earlier facility decisions stay as they were; nothing is deleted.

Facility decisions now take the relationship lock (`FOR SHARE`) before the
timesheet lock and are refused once the relationship has ended (`CHP12`), so
a sign-off and an ending cannot interleave. An open discrepancy on an ended
relationship is answered by the agency ("times confirmed"): the entry then
becomes `not_required` instead of returning to the facility, and the
timesheet locks if complete. Approval already treats ended relationships as
`not_required`.
