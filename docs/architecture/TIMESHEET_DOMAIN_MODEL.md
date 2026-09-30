# Timesheet Domain Model

Status: P0-E6-S2. Builds on [ATTENDANCE_DOMAIN_MODEL.md](ATTENDANCE_DOMAIN_MODEL.md).
Flow: [TIMESHEET_APPROVAL_FLOW.md](TIMESHEET_APPROVAL_FLOW.md). Maths:
[TIMESHEET_CALCULATION.md](TIMESHEET_CALCULATION.md).

**Timesheets are not a second clock.** Attendance events (device events and
approved corrections) are the only source of worked time. A timesheet
summarises that evidence for one worker and one week, is reviewed by the
agency and signed off by each client facility, and is then locked as an
immutable snapshot for later payroll and billing stages. No pay, bill, rate,
overtime or currency value exists in this stage.

## 1. Entities

| Table                         | Purpose                                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agency_timesheet_settings`   | Weekly periods; `week_starts_on` (ISO 1 = Monday … 7 = Sunday, default Monday). Fixed once timesheets exist.                                                                 |
| `timesheets`                  | Agency + worker + period (`period_end = period_start + 6`). Status, revision, submission/approval/lock fields. Unique per (worker, period).                                  |
| `timesheet_entries`           | One per assignment. Scheduled times plus **derived** effective start/end, breaks, break and worked minutes, completeness, blocking reasons, exception state, facility state. |
| `timesheet_approvals`         | Immutable approval snapshot per revision (derived times, reason codes, correction ids, totals, calculation version). Superseded, never edited.                               |
| `timesheet_facility_signoffs` | Per-entry facility decision (signed off / disputed + reason + bounded note) with a snapshot. Resolved or superseded, never edited.                                           |
| `timesheet_history`           | Append-only lifecycle log (submitted, returned, approved, signed off, disputed, resolved, locked, reopened, revised).                                                        |

## 2. Periods

Weekly only (the minimum safe configuration). An entry belongs to the period
containing its shift's **local start date** in the facility timezone, so an
overnight shift stays in the week it started. `internal.period_start_for` is
deterministic; the week start cannot change once an agency has timesheets.
Timesheets are created lazily when an assignment is accepted — there is no
period-creation job.

A period can be submitted once its last local date has ended everywhere
(`period_end + 1 day, 12:00 UTC`, i.e. after midnight in UTC−12). Payroll
calendars (biweekly, semi-monthly) are deferred.

## 3. Entries are derived

`internal.sync_timesheet_entry(assignment)` is the only writer of entry
values. It runs:

- after every attendance projection refresh (clock, break, correction,
  adjustment, exception change, scan);
- after every assignment status change (trigger);
- on demand via `internal.rebuild_timesheet` (idempotent, never destructive).

It calls the one calculation, `internal.effective_time`. Entries are never
deleted: a cancelled assignment with no attendance becomes `included = false`.
A no-show closed as "not worked" becomes a complete zero-minute entry.

Structural protection (tested even as the table owner):

- `authenticated` has SELECT only; no API writes entries;
- a trigger refuses any insert/update outside the trusted calculation
  (transaction-local flag set only by internal functions);
- time columns cannot change while the timesheet is approved or locked
  (`CHP09`); a change must go through a revision.

## 4. Integrity

Composite foreign keys bind:

- timesheet → worker (agency, worker, person);
- entry → timesheet (agency, worker, person), assignment (agency, shift, worker, person),
  shift (agency, relationship, facility, location), attendance (id, assignment),
  facility link `(agency_facility, facility organisation)`;
- sign-off → entry (timesheet, relationship, facility, facility organisation),
  relationship (agency, facility), deciding membership in the facility organisation,
  resolving membership in the agency;
- approval → timesheet and approving membership in the agency;
- history → timesheet and entry.

## 5. Visibility

| Audience                                     | Access                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Agency `timesheet.view`                      | All of its timesheets, entries, approvals, sign-offs, history.                                          |
| Worker (identity)                            | Own timesheets and entries; history actions without staff names or facility notes.                      |
| Linked facility `timesheet.facility_signoff` | `list_facility_timesheet_entries` only: entries at its facility after agency approval. No table access. |
| Platform admin, anon                         | Nothing.                                                                                                |

## 6. Foundation for payroll and billing

Later stages consume **locked** timesheets and their approval snapshots
(immutable, per revision, with calculation version). Rounding, overtime,
rates and exports are explicitly out of scope here.
