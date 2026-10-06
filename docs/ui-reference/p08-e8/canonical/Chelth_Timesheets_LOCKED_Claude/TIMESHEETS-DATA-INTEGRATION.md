# Chelth Timesheets — Data Integration Rules

## Core relationship

Timesheet time may be derived from Attendance.

Recommended relationship:
- worker
- shift
- facility
- attendance record(s)
- timesheet record
- approval state
- audit history

## Preserve source truth

If a timesheet is created from Attendance:
- keep the source attendance record linked;
- do not overwrite attendance evidence when timesheet adjustments occur.

## Suggested timesheet fields

Use the actual schema where it exists.

Typical concepts:
- timesheet_id
- tenant/workspace id
- worker_id
- shift_id
- facility_id
- period_start
- period_end
- check_in_time
- check_out_time
- break_minutes
- total_minutes
- worked_minutes
- source_type
- submission_status
- submitted_at
- approved_at
- approved_by
- correction_requested_at
- correction_requested_by
- correction_reason
- manual_adjustment
- notes
- created_at
- updated_at

## Status concepts

Use the actual schema names, but the product language should support:
- Pending Submission
- Pending / Needs Review
- Approved
- Needs Correction

## Auditability

Never erase historical:
- submitted version
- approval
- correction request
- attendance-derived source
- manual adjustment

Store changes as auditable events/history according to the existing architecture.
