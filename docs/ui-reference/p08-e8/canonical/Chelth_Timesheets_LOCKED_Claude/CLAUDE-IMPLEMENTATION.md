# Claude Implementation — Chelth Timesheets

## Primary instruction

**DO NOT REDESIGN.**

Visual source:
`assets/chelth-timesheets-locked.png`

Interaction source:
`TIMESHEETS-INTERACTIONS.md`

Data relationship source:
`TIMESHEETS-DATA-INTEGRATION.md`

## Scope

Implement P0-E8-S9 Timesheets using the canonical Chelth shell.

## Preserve

- sidebar/navigation
- top search/user bar
- Chelth typography
- spacing
- colors
- KPI cards
- filter row
- Current Timesheets table
- Recent Timesheet Activity
- Timesheet Details drawer
- action placement/hierarchy

## Real data

Use actual application data.

Do not hard-code screenshot workers, counts, facilities, dates, hours, or statuses.

## Moving parts

Implement:
- date/pay-period controls
- KPI quick filters
- worker filter
- facility filter
- status filter
- search
- Export
- timesheet-row selection
- detail drawer open/close
- table expansion when drawer closes
- attendance verification link
- audit history
- Approve Timesheet
- Request Correction
- View Attendance
- View Shift
- recent activity navigation

## Attendance source

Use canonical Attendance records for attendance-derived time.

Do not duplicate or recreate attendance evidence inside Timesheets.

## Approval / correction

Approval and correction flows must:
- be permission-controlled
- preserve prior submitted data
- write audit history
- preserve original Attendance data

## Tenant isolation

Follow existing Chelth tenancy and database authorization rules.

Never use client-side-only authorization for sensitive timesheet actions.

## Typography

Use:
`docs/brand/CHELTH-PRODUCT-TYPOGRAPHY.md`

No page-specific typography invention.

## QA gate

- [ ] visual matches locked Timesheets screen
- [ ] canonical shell unchanged
- [ ] period controls work
- [ ] KPI quick filters work
- [ ] worker/facility/status filters work
- [ ] search works
- [ ] each row opens correct timesheet
- [ ] drawer close expands table
- [ ] attendance verification links correct record
- [ ] Approve is permission-controlled and auditable
- [ ] Request Correction preserves history
- [ ] View Attendance preserves context
- [ ] View Shift opens exact shift
- [ ] export respects current filters and permissions
- [ ] no attendance evidence is overwritten
- [ ] accessibility works
- [ ] no brand drift

## Completion report

Save:
`docs/reports/CHELTH-P0-E8-S9-timesheets-implementation.txt`
