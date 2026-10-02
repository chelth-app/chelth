# Chelth Operations Overview — Interaction Specification

## Status

**B3.4.1 Operations Overview: LOCKED**

Do not redesign the canonical Chelth app shell or dashboard.

## 1. KPI cards

### Open Shifts
Clicking should open the Shifts page filtered to open/uncovered shifts.

### Pending Confirmations
Clicking should open the Shifts page filtered to records awaiting confirmation.

### Credential Issues
Clicking should open Credentials filtered to workers/credentials that need attention.

### Facility Requests
Clicking should open Staffing Requests filtered to active/current facility requests.

## 2. Today's Schedule

Each row should be clickable.

Clicking a schedule row should:
- open the relevant shift detail context;
- preserve return context to Operations Overview where practical.

`View All Shifts` opens the canonical Shifts page.

## 3. Workforce Readiness

`View Details` opens the canonical Workforce page with readiness context.

The donut chart is informative; it should not introduce extra drill-down behavior unless supported by the existing product.

## 4. Credential Expirations

Each listed credential type should be clickable.

Clicking should open Credentials with the relevant credential type/status filter applied.

## 5. Recent Staffing Requests

Each request row should be clickable.

Clicking should open Staffing Requests with that exact request selected.

`View All Requests` opens the canonical Staffing Requests page.

## 6. Coverage Activity

The date-range control should change the reporting period.

Do not add auto-animation or decorative motion.

The chart should use real operations data.

## 7. State preservation

Where possible, navigation from Operations Overview should preserve:
- active date
- facility context
- selected record
- return path

## 8. Accessibility

Implement:
- keyboard-accessible cards/rows/actions
- visible focus states
- semantic links/buttons
- reduced-motion support
- accessible chart labels/summary

## 9. No redesign

Do not change:
- sidebar
- top header
- typography
- colors
- spacing
- KPI card structure
- table structure
- chart placement
- card hierarchy
- status-chip styling

Do not reintroduce decorative mini sparkline/progress graphics into the top KPI cards.
