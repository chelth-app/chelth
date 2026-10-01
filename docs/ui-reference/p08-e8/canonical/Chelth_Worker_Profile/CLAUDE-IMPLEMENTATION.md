# Claude Implementation — Chelth Worker Profile

## Primary rule

**DO NOT REDESIGN.**

Visual reference:
`assets/chelth-worker-profile-locked.png`

Interaction reference:
`WORKER-PROFILE-INTERACTIONS.md`

## Canonical app shell

Preserve the already locked Chelth shell:
- sidebar
- global search/header
- typography
- spacing
- colors
- cards
- status chips
- buttons
- tabs

## Typography

Use the canonical Chelth typography file:
`docs/brand/CHELTH-PRODUCT-TYPOGRAPHY.md`

Do not choose new typography values for this screen.

## Data

Use real worker data.

Do not hard-code:
- Aisha Patel
- sample phone/email
- sample credentials
- sample shifts
- sample activity
- sample metrics

The screenshot is a visual reference only.

## Reuse existing modules

Do not duplicate business logic.

Worker Profile should reuse/route into:
- Workforce
- Credentials
- Shifts
- Attendance
- Timesheets
- Notifications/activity
- messaging

## QA gate

- [ ] canonical shell unchanged
- [ ] profile visual matched
- [ ] tabs work
- [ ] Message uses existing communications
- [ ] Assign to Shift preserves worker context
- [ ] Update Availability works
- [ ] professional-info edit works
- [ ] skills/preferences edit works
- [ ] next shift opens exact shift
- [ ] Credentials preserve worker context
- [ ] Timesheets preserve worker context
- [ ] activity links open correct records
- [ ] permissions respected
- [ ] responsive behavior works
- [ ] no brand drift

## Completion report

Save:
`docs/reports/CHELTH-P0-E8-S4-worker-profile-implementation.txt`
