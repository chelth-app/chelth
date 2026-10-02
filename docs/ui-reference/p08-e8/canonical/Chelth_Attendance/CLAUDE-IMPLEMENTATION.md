# Claude Implementation — Chelth Attendance

## Primary instruction

**DO NOT REDESIGN.**

Visual reference:
`assets/chelth-attendance-locked.png`

Interaction references:
- `ATTENDANCE-INTERACTIONS.md`
- `ATTENDANCE-GEOFENCE-INTEGRATION.md`

## Scope

Implement P0-E8-S8 Attendance using the canonical Chelth app shell.

## Preserve

- existing sidebar/navigation system
- top global header
- Chelth typography
- colors
- spacing
- KPI card design
- Attendance table
- exception panel
- verification summary
- recent activity
- Attendance Details drawer
- action hierarchy

## Real data

Use live application records.

Do not hard-code the screenshot workers, facilities, times, counts, coordinates, or percentages.

## Moving parts

Implement:
- date filter
- status filter
- KPI quick filters
- attendance-record selection
- exception selection
- detail drawer open/close
- workspace expansion on drawer close
- geofence verification summary
- reporting-period control
- Approve Override
- Message Worker
- View Shift
- Mark Resolved
- attendance activity navigation

## Geofence behavior

Use geofence results from the actual worker attendance event.

Do not implement continuous background tracking by default.

Overrides must preserve original location evidence and be auditable.

## Timesheet integration

Attendance should provide verified time information to the Timesheets module.

Avoid duplicated truth/calculations.

## Canonical typography

Use:
`docs/brand/CHELTH-PRODUCT-TYPOGRAPHY.md`

Do not choose page-specific typography values.

## QA gate

- [ ] visual matches locked Attendance screen
- [ ] canonical shell unchanged
- [ ] date/status filters work
- [ ] KPI shortcuts work
- [ ] each attendance row opens correct record
- [ ] each exception opens correct record
- [ ] drawer close expands workspace
- [ ] geofence data uses real attendance event
- [ ] override is permission-controlled and auditable
- [ ] original location evidence is never erased
- [ ] Message Worker reuses communications
- [ ] View Shift opens exact linked shift
- [ ] Mark Resolved preserves audit history
- [ ] Timesheets can consume verified attendance
- [ ] accessibility works
- [ ] no brand drift

## Completion report

Save:
`docs/reports/CHELTH-P0-E8-S8-attendance-implementation.txt`
