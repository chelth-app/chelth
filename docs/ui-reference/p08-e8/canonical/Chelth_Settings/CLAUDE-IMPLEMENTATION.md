# Claude Implementation — Chelth Settings

## Primary instruction

**DO NOT REDESIGN.**

Visual source:
`assets/chelth-settings-locked.png`

Interactive reference:
`index.html`

Supporting specifications:
- `SETTINGS-INTERACTIONS.md`
- `SETTINGS-DATA-RULES.md`
- `SETTINGS-SECTIONS.md`

## Scope

Implement the Settings page inside the canonical Chelth application shell.

## Locked global shell

Preserve:
- approved Chelth logo
- dark-teal sidebar
- existing top search bar
- notifications control
- Sarah Mitchell/profile treatment or real signed-in user equivalent
- mint/off-white background treatment
- Manrope/Inter typography
- canonical cards/forms/buttons/toggles
- spacing and border radius
- current responsive language

## Settings navigation

Implement:
- Organization
- Team & Permissions
- Notifications
- Attendance & Geofencing
- Shifts & Scheduling
- Timesheets & Payroll
- Rates & Billing
- Integrations
- Security
- Workspace

This is a secondary navigation within Settings.

Do not replace the main Chelth sidebar.

## Organization visual

The supplied Settings screenshot is the locked visual source of truth for the Organization section.

Match it closely.

## Other sections

Other Settings sections must reuse the same:
- content width
- card construction
- typography
- forms
- toggles
- save/cancel pattern
- icon treatment
- spacing

Do not invent separate UI styles per section.

## Save behavior

Implement:
- dirty state tracking
- field validation
- Save Changes
- Cancel
- canonical success toast
- error state
- unsaved-change protection

## Security / authorization

Settings writes must be authorized server-side.

Do not implement client-only access control.

Financial, security, permission, and lifecycle settings require appropriate roles.

## Historical integrity

Changing Settings must not silently mutate historical:
- attendance
- approved timesheets
- applied rate versions
- payroll
- invoices

## Geofence

Preserve original attendance location evidence.

Admin overrides must remain separate and auditable.

## Integrations

Only implement integrations actually present in the repository/product.

If a provider is not implemented:
- do not fake a connected state;
- do not build a dummy production connector;
- document the missing integration in the completion report.

## QA gate

- [ ] canonical Chelth shell unchanged
- [ ] Organization matches locked visual
- [ ] all Settings sections exist
- [ ] section switching works
- [ ] typography matches product system
- [ ] inputs/toggles/buttons follow canonical components
- [ ] save/cancel behavior works
- [ ] unsaved-change warning works
- [ ] permissions enforced server-side
- [ ] geofence rules feed Attendance
- [ ] scheduling rules feed Shifts
- [ ] timesheet rules feed Timesheets
- [ ] billing defaults feed financial workflows where supported
- [ ] history is not destructively rewritten
- [ ] audit-sensitive settings changes are logged
- [ ] destructive workspace actions require confirmation
- [ ] accessibility works
- [ ] no design drift

## Completion report

Save:
`docs/reports/CHELTH-settings-implementation.txt`
