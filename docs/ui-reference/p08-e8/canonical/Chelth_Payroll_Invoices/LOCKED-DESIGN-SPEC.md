# Chelth Payroll + Invoices — Locked Design Specification

## Screen

P0-E8-S11 — Payroll + Invoices

## Page title

`Payroll + Invoices`

Supporting copy:
`Review approved work records, apply rate rules, and manage payroll and facility billing from one operational view.`

## Modes

- Payroll
- Invoices

The supplied locked visual shows Payroll.

Invoices must inherit the exact same canonical visual system.

## Summary cards

- Payroll Ready
- Payroll Exceptions
- Invoices Draft
- Outstanding Invoices

## Payroll main surface

`Current Payroll Run`

Core columns:
- Worker
- Facility
- Period
- Approved Hours
- Gross Pay
- Status
- Action

## Secondary surface

`Recent Billing Activity`

## Payroll drawer

`Payroll Details`

Core content:
- worker / role
- facility / period
- payroll summary
- rate information
- audit history

Primary action:
`Approve Payroll`

Secondary actions:
- Review Payroll
- View Timesheets
- View Rate

## Product boundary

Payroll + Invoices executes downstream financial workflows.

It consumes:
- approved Timesheets
- applied Rates + Pricing

It must not rewrite source Attendance or Timesheet history.

## Canonical visual system

Preserve the locked Chelth:
- dark teal sidebar
- approved logo
- mint/off-white backdrop
- navy headings
- teal/mint states
- restrained warning colors
- Manrope / Inter typography
- rounded operational cards
- clean tables
- contextual right-side drawer
- premium healthcare-native tone
