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
