# Attendance Corrections

Status: P0-E6-S1. See [ATTENDANCE_EVENT_MODEL.md](ATTENDANCE_EVENT_MODEL.md).

## 1. Request (worker)

`request_attendance_correction(assignment, event_type, requested_time, reason, note)`

- Only the assigned worker, on an accepted assignment.
- `event_type` is `clock_in` or `clock_out`. Reason is one of: forgot to
  clock, device or app problem, location problem, recorded wrong time, other.
  Optional note ≤ 500 characters.
- The time is entered in the **shift's timezone** and converted DST-safely
  (`zonedLocalToInstant`: non-existent spring-forward times rejected; the
  repeated fall-back hour resolves to the later instant, like the database).
- The time must be in the past and within the shift ± 12 hours.
- A clock-out correction needs a clock-in (recorded or pending request) and
  must be after it; a clock-in correction must be before a recorded clock-out.
- One pending request per event type; 20 requests per person per day (`CH429`).
- Opens a `manual_correction_requested` exception, notifies
  `attendance.review` holders, audits (no note text, no times).

Errors: `CHT16 CORRECTION_NOT_ALLOWED`, `CHT05`, `CH400`, `CH429`.

## 2. Review (agency)

`review_attendance_correction(correction, approve, resolution)` —
`attendance.review`.

- **No self-approval**: a reviewer cannot review a request they made or any
  correction on their own attendance (`CH403`).
- Pending only (`CHT17` otherwise); the resolution must match the decision
  (`approved_as_requested` ⇔ approve).
- Approval re-checks ordering against current effective times, then appends a
  `corrected_*` event (source `approved_correction`) and resolves the matching
  missed and correction exceptions.
- Rejection appends nothing; the correction exception resolves when no other
  request is pending.
- The worker is notified of the outcome; the decision is audited.

Transitions are enforced by a trigger: `pending → approved | rejected`, both
terminal; corrections are never deleted.

## 3. What a correction is not

It is not a timesheet approval, pay adjustment or overtime decision. Those are
later stages and will consume the effective (corrected) times.

## 4. Hardening (P0-E6-S2)

### Break times

Requests and adjustments accept `break_start` / `break_end` with a break
number (`p_segment`). A break time must fall between clock-in and clock-out;
breaks are numbered in order; a break end needs a start (recorded or
requested). Final consistency is checked by recalculating at approval
(`CHT16`, nothing appended if out of order).

### Reviewer-adjusted approval

`review_attendance_correction(…, p_approved_time, p_adjustment_reason,
p_note, p_confirm_revision)`:

- `approved_as_requested` — the requested time is appended;
- `approved_with_adjustment` — a **different** time, a required structured
  reason (`facility_reported_time`, `supervisor_observation`,
  `device_or_app_problem`, `worker_statement`, `break_not_recorded`, `other`)
  and an optional note (≤ 500) shown to the worker. The worker is notified
  (`attendance_time_adjusted`). No worker acknowledgment is required in this
  stage; the worker sees the original, the request, the decision, the note and
  the corrected time.

### Reviewer-originated adjustment

`adjust_attendance_time(attendance, event_type, time, reason, note, segment,
confirm_revision)` (`attendance.review`, not own attendance) records an
approved correction with origin `reviewer_adjustment` and appends the
corrected event. Used for facility discrepancies and missing breaks.

### Approved or locked timesheets

If the attendance is on an `agency_approved` or `locked` timesheet, approval
or adjustment is refused (`CHT22`) unless the reviewer confirms a revision
and also holds `timesheet.approve`. The timesheet then gets a new revision
awaiting re-approval ([TIMESHEET_APPROVAL_FLOW.md](TIMESHEET_APPROVAL_FLOW.md)).

### History

`list_attendance_history(attendance)` returns original events, requests,
decisions (with approved time, adjustment reason, notes), corrected events
and exceptions in order. The agency sees staff names; the worker sees their
own history without staff names. Never coordinates.
