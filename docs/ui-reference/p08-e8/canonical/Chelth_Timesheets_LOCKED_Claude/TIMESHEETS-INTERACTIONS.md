# Chelth Timesheets — Interaction Specification

## Status

**P0-E8-S9 Timesheets: LOCKED**

Do not redesign the canonical Chelth app shell, Timesheets table, or Timesheet Details drawer.

---

## 1. Purpose

Timesheets convert attendance-derived work records into reviewable and approvable work records.

Timesheets should connect directly to:
- Attendance
- Shifts
- Workers
- Facilities
- Payroll / Invoices where applicable later

Attendance remains the source for verified presence/time evidence.

---

## 2. KPI cards

The top summary cards act as operational shortcuts.

### Pending Submission
Timesheets not yet submitted by the worker.

### Needs Review
Submitted timesheets waiting for authorized review.

### Approved
Approved timesheets for the selected period.

### Needs Correction
Timesheets returned for correction or requiring worker/admin action.

Do not add decorative sparklines or mini charts.

---

## 3. Pay-period controls

The top period selector and table period filter should control the active date/pay period.

Period state should persist across:
- filters
- drawer open/close
- pagination if later added
- linked record navigation where practical

---

## 4. Filters / search

Support the locked filters:
- date/pay period
- worker
- facility
- status
- search

Filtering should update the table without a full page reload.

---

## 5. Current Timesheets table

Every row is selectable.

Clicking a row should:
1. set the active timesheet record;
2. open Timesheet Details;
3. populate the drawer from live data.

Relevant row data:
- worker
- facility
- shift date
- check-in
- check-out
- break
- worked hours
- source
- status

Do not hard-code screenshot values.

---

## 6. Source column

Timesheet time should clearly communicate where the time came from.

Examples:
- Attendance
- Manual
- Adjusted

Use labels consistent with the actual data model.

### Attendance
Time derived from verified attendance.

### Manual
Worker/admin entered time manually.

### Adjusted
An existing record was corrected according to the approved correction process.

Do not hide the source of time.

---

## 7. Timesheet Details drawer

The selected record should show:
- worker
- role
- facility
- shift date/time
- check-in
- check-out
- break deduction
- worked hours
- source
- manual adjustment if any
- approval status
- attendance verification
- audit history
- available actions

---

## 8. Drawer open / close behavior

When open:
- preserve the locked right-side drawer;
- main Timesheets workspace uses remaining width.

When closed:
- remove reserved drawer width;
- expand the main table into freed space;
- reflow columns naturally;
- do not leave a blank gutter;
- do not reload.

Selecting a different record reopens/updates the drawer.

Desktop:
- Escape closes the drawer.

---

## 9. Attendance Verification

If the timesheet is attendance-derived, show the linked verification state.

The timesheet must not invent its own separate attendance evidence.

Use the canonical Attendance records.

If time was manually adjusted, preserve:
- original attendance time
- adjusted time
- reason
- actor
- timestamp

---

## 10. Approve Timesheet

`Approve Timesheet` should:
- require appropriate permission;
- set approval state;
- record approver;
- record timestamp;
- write audit history;
- lock or constrain further edits according to product rules.

Approval must not silently rewrite attendance history.

---

## 11. Request Correction

`Request Correction` returns the timesheet for correction.

Capture where supported:
- correction reason
- requested by
- requested at
- target worker/admin
- status

Do not delete the submitted version.

Maintain auditability.

---

## 12. View Attendance

`View Attendance` opens the linked Attendance record.

Preserve:
- worker
- shift
- facility
- date context

---

## 13. View Shift

`View Shift` opens the canonical Shifts workflow with the exact linked shift selected.

---

## 14. Export

`Export` should export the current filtered/period view according to the product's export capability.

Exports should reflect current:
- period
- filters
- statuses

Respect permissions and tenant isolation.

---

## 15. Recent Timesheet Activity

Activity rows represent significant events such as:
- submitted for review
- correction requested
- approved
- adjusted
- generated from attendance

Clicking an activity row should open the linked timesheet/context when available.

---

## 16. Relationship to Payroll

Timesheets may later become inputs to Payroll / Invoices.

Do not calculate payroll-specific financial outcomes in Timesheets unless the product architecture already defines that behavior.

Timesheets should remain the approved time record.

---

## 17. Permissions / audit

Sensitive actions must be permission-controlled:
- approve
- request correction
- manual adjustment
- export

Important changes must be auditable.

---

## 18. Accessibility

Implement:
- keyboard-selectable rows
- visible focus states
- semantic controls
- status text beyond color alone
- accessible drawer
- reduced-motion support

---

## 19. No redesign

Do not change:
- app shell
- typography
- colors
- spacing
- KPI cards
- table structure
- status-chip styling
- drawer hierarchy
- action hierarchy
