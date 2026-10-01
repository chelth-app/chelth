# Claude Implementation — Chelth Worker Mobile Flow

## Primary rule

**DO NOT REDESIGN.**

Visual source:
`assets/chelth-worker-mobile-flow-locked.png`

Interaction references:
- `WORKER-MOBILE-INTERACTIONS.md`
- `ATTENDANCE-GEOFENCE-FLOW.md`

## Scope

Implement the worker-mobile flow for:
- My Shifts
- Shift Details
- Check-In / Check-Out
- Timesheet Handoff

## Preserve exactly

- Chelth brand language
- logo treatment
- backdrop / background feel
- typography tone
- rounded mobile cards
- button hierarchy
- step order and interaction logic

## Data / routing principles

Use real application data and existing product rules.

Do not hard-code screenshot values in production.

Integrate with:
- shifts
- attendance
- timesheets
- worker profile
- notifications
- facility contact/directions flows if present

## Attendance

Use geofenced verification at attendance events.

Do not implement continuous background tracking by default.

Support:
- permission prompt
- in-radius success
- weak GPS
- outside geofence
- optional supervisor override path if enabled

## QA gate

- [ ] visual matched
- [ ] My Shifts tabs work
- [ ] Next shift opens details
- [ ] upcoming shift rows open details
- [ ] facility contact flow works
- [ ] directions/map behavior works
- [ ] check-in flow works
- [ ] geofence exceptions handled
- [ ] check-out flow works
- [ ] attendance prefills timesheet
- [ ] timesheet submission works
- [ ] mobile accessibility works
- [ ] no brand drift

## Completion report

Save:
`docs/reports/CHELTH-P0-E8-S7-worker-mobile-flow-implementation.txt`
