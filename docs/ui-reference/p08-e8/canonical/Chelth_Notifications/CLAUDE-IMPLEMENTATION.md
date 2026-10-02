# Claude Implementation — Chelth Notifications / Activity

## Primary instruction
**DO NOT REDESIGN.**

Use `index.html` as the locked interaction reference.

## Implement
- KPI filters
- type/facility/professional/status/time filters
- search
- activity-view tabs
- mark all as read
- notification row selection
- Activity Details drawer
- drawer close/expand behavior
- contextual linked-record actions

## Reuse existing modules
Do not recreate source records inside Notifications. Link to existing:
- Credentials
- Shifts
- Staffing Requests
- Facilities
- Workforce / Worker Profile
- Attendance / Timesheets where applicable

## QA
- [ ] canonical shell unchanged
- [ ] filters/tabs work
- [ ] read/archive state behaves correctly
- [ ] unresolved issues are not hidden merely because read
- [ ] linked actions preserve record context
- [ ] permission checks are authoritative
- [ ] tenant isolation preserved
- [ ] accessibility works

## Completion report
Save `docs/reports/CHELTH-notifications-activity-implementation.txt`.
