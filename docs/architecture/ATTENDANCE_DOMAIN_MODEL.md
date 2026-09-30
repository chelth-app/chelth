# Attendance Domain Model

Status: P0-E6-S1. Builds on [ASSIGNMENT_DOMAIN_MODEL.md](ASSIGNMENT_DOMAIN_MODEL.md)
and [SHIFT_TIME_MODEL.md](SHIFT_TIME_MODEL.md). Events:
[ATTENDANCE_EVENT_MODEL.md](ATTENDANCE_EVENT_MODEL.md). Location:
[GEOFENCE_MODEL.md](GEOFENCE_MODEL.md),
[../security/ATTENDANCE_LOCATION_PRIVACY.md](../security/ATTENDANCE_LOCATION_PRIVACY.md).
Corrections: [ATTENDANCE_CORRECTIONS.md](ATTENDANCE_CORRECTIONS.md).

Attendance must be operationally trustworthy without becoming worker
surveillance. It records **when** an accepted worker started and finished a
shift, using the **database clock**, and optionally checks at the moment of a
clock action that the worker is at the site. It is not a timesheet, payroll,
overtime or billing record; those are later stages built on approved records.

## 1. Entities

| Table                                 | Role                                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `public.assignment_attendance`        | One row per assignment (created lazily). **Projection** of the events: state, effective times, open count.     |
| `public.attendance_events`            | Append-only source of truth: `clock_in`, `clock_out`, `corrected_clock_in`, `corrected_clock_out`.             |
| `public.attendance_location_evidence` | Append-only coordinates for one event, only where a geofence applies. Restricted (`attendance.location.view`). |
| `public.attendance_exceptions`        | Operational attention: late, early, missed, outside site, imprecise location, correction requested, …          |
| `public.attendance_corrections`       | Worker requests to fix a time; reviewed by the agency; approval appends a corrected event.                     |
| `public.agency_attendance_settings`   | Per-agency timing rules (absent row ⇒ documented defaults).                                                    |
| `public.location_geofences`           | Optional geofence per facility location (see GEOFENCE_MODEL.md).                                               |

`assignment_attendance` carries the assignment's full identity
`(assignment, agency, shift, worker, person)` and the shift's
`(shift, agency, facility, location)` via composite foreign keys, so a row can
never point at another tenant's shift, worker or facility. Every child table
binds `(attendance_id, agency_organisation_id)` the same way.

## 2. Attendance is tied to an accepted assignment

Only the assigned worker (live membership, `authz.is_own_active_worker`) can
clock, and only on an assignment whose status is `accepted` on a shift that is
`open`. Proposed, declined, cancelled or removed assignments cannot start work.
Clock-in also re-runs the canonical eligibility gate
(`internal.assignment_eligibility`): a worker who became inactive or
non-compliant since assignment is refused, and the refusal is recorded as an
`assignment_not_ready` exception for the agency.

## 3. State model

Stored clock state (projection, recomputed by `internal.refresh_attendance`,
the only writer):

```
not_started ──clock_in──► clocked_in ──clock_out──► clocked_out
     │                         ▲                         ▲
     └── corrected_clock_in ───┘  corrected_clock_out ───┘
```

Displayed state adds **Needs review** whenever `open_exception_count > 0`
(`deriveAttendanceState`). Check constraints tie state to times:
`not_started ⇔ clock_in_at is null`, `clocked_out ⇔ clock_out_at is not null`,
`clock_out_at ≥ clock_in_at`.

Effective times: the latest `corrected_*` event wins, else the device event.

## 4. Timing rules (defaults, per agency configurable)

| Rule                       | Default | Bounds  | Effect                                                              |
| -------------------------- | ------: | ------- | ------------------------------------------------------------------- |
| `early_clock_in_minutes`   |      30 | 0–240   | Earliest clock-in = start − N; earlier ⇒ `CHT07`                    |
| `late_clock_in_minutes`    |       5 | 0–120   | Clock-in after start + N ⇒ `late_clock_in` exception (recorded)     |
| `early_clock_out_minutes`  |      15 | 0–240   | Clock-out before end − N ⇒ `early_clock_out` exception              |
| `late_clock_out_minutes`   |      30 | 0–240   | Clock-out after end + N ⇒ `late_clock_out` exception                |
| `missed_clock_in_minutes`  |      15 | 5–240   | Scan flags `missed_clock_in` after start + N                        |
| `missed_clock_out_minutes` |      60 | 15–720  | Scan flags `missed_clock_out` after end + N                         |
| `clock_out_cutoff_minutes` |     240 | 60–1440 | Clock-out after end + N ⇒ `CHT18`; the worker requests a correction |

Clock-in at or after the shift end is refused (`CHT08`). Rules are changed by
`set_agency_attendance_settings` (`attendance.manage_settings`, AAL2, audited
as `attendance.settings_updated` with no metadata).

## 5. Clock-in (order of checks)

1. Own assignment (relationship `FOR SHARE` → assignment `FOR UPDATE`).
2. Shift cancelled ⇒ `CHT06`; shift not open ⇒ `CHS09`; assignment not accepted ⇒ `CHT05`.
3. Relationship active (`CHS10`).
4. Timing window (`CHT07` / `CHT08`).
5. Already clocked in / out (`CHT09` / `CHT11`).
6. Geofence (server-side). Blocking policy: no location ⇒ `CHT12`, imprecise ⇒ `CHT14`.
7. Eligibility, then blocking-outside: **refusal is committed** — outcome
   `refused`, refusal code (`WORKER_NOT_ELIGIBLE`/`WORKER_NOT_ACTIVE`/
   `OUTSIDE_GEOFENCE`), an urgent exception, one agency notification, audit.
8. Otherwise append `clock_in` (occurred = recorded = `now()`), evidence if a
   geofence applies, late / location exceptions, resolve `missed_clock_in`.

## 6. Clock-out

Requires `clocked_in`, within the cut-off. **Never blocked by location, by
assignment status or by relationship state**: a worker must always be able to
record leaving. Location problems and early/late timing become exceptions.

## 7. Exceptions

Types: `late_clock_in`, `early_clock_out`, `late_clock_out`,
`missed_clock_in`, `missed_clock_out`, `outside_geofence`,
`poor_location_accuracy`, `location_unavailable`, `assignment_not_ready`,
`manual_correction_requested`. Statuses: `open → under_review →
resolved | dismissed` (terminal; trigger-enforced). At most one open row per
(attendance, type) — detection is idempotent. Resolutions: system
(`clocked_in`, `clocked_out`, `correction_approved`, `correction_rejected`,
`assignment_closed`) or reviewer (`acknowledged`, `not_applicable`). Exceptions
are never deleted. Reviewers (`attendance.review`) cannot review their own
attendance.

## 8. Missed-clock detection

`internal.run_attendance_scan()` runs every 15 minutes (pg_cron
`chelth-attendance-scan`), recorded in `internal.scheduled_job_runs`:

- accepted assignment, shift started + grace, no effective clock-in ⇒ `missed_clock_in` (agency notified);
- clocked in, shift ended + grace ⇒ `missed_clock_out` (agency and worker notified);
- auto-resolves missed exceptions whose facts changed (clocked, corrected, assignment closed, shift cancelled).

It only opens rows that do not already exist, so reruns are no-ops. Lookback
is 7 days; each pass is bounded to 5000 rows.

## 9. Projections

| Function                                       | Who                                                 | Returns                                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_agency_attendance(org, from, to, shift)` | `attendance.view`                                   | Per assignment: worker, facility, times, state, location **result**, open exception types, pending corrections. ≤ 7 local days or one shift. |
| `list_my_attendance(org)`                      | the worker (identity)                               | Own assignments −7 d … +2 d: state, times, `can_clock_in/out`, whether location is required, own exceptions and corrections.                 |
| `list_facility_shift_attendance(shift)`        | linked facility, `attendance.view` via relationship | Worker display name, state, times, location result, `has_open_exception`. **No coordinates, no exception detail.** Audited.                  |
| `list_attendance_location_evidence(att)`       | `attendance.location.view` (AAL2)                   | Raw coordinates; every read audited.                                                                                                         |

## 10. UI

- Agency `/attendance`: date-bounded table (needs attention first),
  pending corrections with approve/reject, open exceptions with
  acknowledge/dismiss, timing rules form (`attendance.manage_settings`).
- Agency shift detail: attendance table and pending corrections for that shift.
- Facility staffing request detail: "Attendance for this request" once the shift has started.
- Facility page (agency): geofence form per location.
- Worker `/my-shifts`: large clock in/out buttons, times in the shift's
  timezone, attendance notes, correction requests.

## 11. Out of scope

Payroll, invoicing, rates, overtime, exports, billing, timesheet approval,
continuous or background location, route tracking, live maps, biometrics,
facial recognition. Multiple work segments per assignment are schema-ready
(`segment`) but only segment 1 is used.

## 12. Hardening (P0-E6-S2)

- **Breaks**: clock state `on_break`; `start_break_assignment` /
  `end_break_assignment` (server time, no location); clock-out is refused
  while on a break (`CHT21`). See
  [ATTENDANCE_SEGMENTS_AND_BREAKS.md](ATTENDANCE_SEGMENTS_AND_BREAKS.md).
- **One calculation**: `internal.effective_time` computes effective times,
  breaks, worked minutes, completeness and reasons; the projection refresh,
  My Shifts and timesheets all use it
  ([TIMESHEET_CALCULATION.md](TIMESHEET_CALCULATION.md)). Every refresh also
  re-derives the assignment's timesheet entry.
- **Not worked**: a reviewer can close a missed clock-in as `not_worked`
  (only when there is no effective clock-in). The entry becomes a complete
  zero-minute entry; no time is invented.
- **Refused clock-in rate limit** (closes S1 F6): at most 10 committed
  refusals per worker + assignment per 10-minute window. Beyond that the
  attempt fails with `CH429` and writes nothing (no exception, no audit row,
  no notification). Successful clock-ins never count.
- **Facility view audit** (S1 F7): `attendance.viewed_by_facility` is written
  once per viewer and shift per 15 minutes (`internal.record_audit_event_once`);
  every distinct viewer is still recorded.
- **Review UI**: `/attendance/[attendanceId]` shows the full history
  (original events → requests → decisions → corrected events → exception
  lifecycle, with reviewer names for the agency), open exceptions, the
  reviewer-adjustment form and, for `attendance.location.view`, the raw
  evidence viewer behind MFA step-up.
- **Timesheets**: attendance feeds weekly timesheets
  ([TIMESHEET_DOMAIN_MODEL.md](TIMESHEET_DOMAIN_MODEL.md)); a change to
  attendance on an approved timesheet creates a new timesheet revision.
