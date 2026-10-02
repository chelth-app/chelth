# Chelth Payroll + Invoices — Interaction Specification

## Status

**P0-E8-S11 Payroll + Invoices: LOCKED**

Do not redesign the canonical Chelth app shell, page composition, tabs, tables, cards, or detail drawer.

---

## 1. Purpose

Payroll + Invoices is the financial execution layer downstream of:

- Attendance
- Timesheets
- Rates + Pricing

The intended chain is:

`Attendance → Approved Timesheet → Applied Rate → Payroll / Invoice`

The module should not replace the source modules.

---

## 2. Payroll / Invoices toggle

The page contains two first-class modes:

- `Payroll`
- `Invoices`

Switching modes should retain relevant context where practical:
- selected period
- selected facility
- search
- status filter

Do not navigate into a different design system.

### Payroll
Worker-level payment preparation and review.

### Invoices
Facility-level billing preparation, sending, payment status, and related records.

The supplied locked screenshot shows the Payroll mode.

The Invoices mode must inherit the exact same canonical shell, control styling, table styling, and drawer behavior.

---

## 3. KPI cards

The four cards act as operational shortcuts:

### Payroll Ready
Worker payroll records ready for processing.

### Payroll Exceptions
Payroll records requiring review or correction.

### Invoices Draft
Facility invoices currently in draft/review state.

### Outstanding Invoices
Issued invoices not yet fully paid.

No decorative sparkline charts should be added.

---

## 4. Pay period / filters / search

Preserve:
- period
- facility
- status
- search

These should update the active Payroll or Invoices table without full-page reload.

State should survive detail drawer open/close.

---

## 5. Payroll table

Each row represents a worker payroll record for the selected period.

Relevant concepts include:
- worker
- facility
- period
- approved hours
- gross pay
- status

Clicking a row:
1. selects the payroll record;
2. opens Payroll Details;
3. populates the drawer from live data.

Do not hard-code screenshot values.

---

## 6. Payroll Details drawer

Payroll Details should be built from:
- approved timesheets
- the applied pricing/pay-rate rules
- permitted adjustments

Relevant sections may include:
- worker / role
- facility
- period
- payroll summary
- approved hours
- regular hours
- overtime hours
- shift differentials
- other adjustments
- gross pay
- applied rate information
- audit history

Only display financial fields supported by the actual Chelth product scope.

---

## 7. Detail drawer behavior

When open:
- preserve the locked right-side drawer;
- main workspace occupies remaining width.

When closed:
- remove the reserved drawer column;
- expand the main work surface into the freed width;
- reflow the table naturally;
- do not leave a blank gutter;
- do not reload the page.

Selecting another row should reopen/update the drawer.

Desktop:
- Escape closes the drawer.

---

## 8. Review Payroll

`Review Payroll` should expose the components contributing to the calculation.

It should allow the authorized reviewer to understand:
- which timesheets are included;
- which rate/rate version was applied;
- regular vs overtime hours;
- differentials;
- adjustments.

Review must not silently mutate source data.

---

## 9. Approve Payroll

`Approve Payroll` is a privileged action.

Approval should:
- require correct permission;
- record approver;
- record timestamp;
- preserve applied rate/rate version;
- preserve included timesheet references;
- create an auditable event;
- transition the record according to the actual payroll state machine.

Approval must not overwrite Attendance or Timesheet history.

---

## 10. Process Payroll

`Process Payroll` begins the canonical payroll-processing flow for eligible records in the selected period.

Do not interpret this automatically as transmitting money unless the product has a connected payroll/payment provider and the user has explicitly reached that authorized action.

At minimum it should:
- identify eligible records;
- surface blocking exceptions;
- require review/confirmation;
- preserve an auditable batch/process record if architecture supports it.

---

## 11. View Timesheets

`View Timesheets` opens the Timesheets module scoped to the worker/pay period represented by the selected payroll record.

Preserve worker, facility, and period context where practical.

---

## 12. View Rate

`View Rate` opens Rates + Pricing with the exact applied rate/rate version selected where supported.

Historical payroll must not simply reference the newest current rate.

---

## 13. Invoices mode

Invoices should use the same canonical layout family.

Expected invoice concepts:
- facility
- billing period
- approved/billable hours
- applied bill-rate version
- subtotal
- adjustments
- total
- invoice status
- issue/sent date
- due date
- payment status

### Invoice actions may include
- Create Invoice
- Review Invoice
- Send Invoice
- View Timesheets
- View Applied Rate
- Record Payment

Only implement actions supported by the actual product architecture.

---

## 14. Historical rate integrity

Payroll and invoices must preserve the rate/version actually applied at the time of calculation.

A later rate-card edit must not silently recalculate historical payroll or invoices.

Where existing architecture supports snapshots or versioned rate references, use it.

If it does not, surface the limitation in the implementation report rather than inventing a destructive workaround.

---

## 15. Billing activity

Recent Billing Activity may include:
- invoice created
- invoice sent
- payment received
- invoice adjusted
- invoice overdue

Activity entries should open linked records where possible.

---

## 16. Export

Export should reflect:
- current mode
- selected period
- facility
- filters
- permissions

Do not export cross-tenant financial data.

---

## 17. Permissions and tenant isolation

Financial data is sensitive.

Actions including:
- payroll approval
- payroll processing
- invoice creation
- invoice sending
- payment recording
- exports

must respect Chelth's real authorization model.

Enforce tenant isolation at the data/API/database layer, not only in the UI.

---

## 18. Auditability

Financial workflow actions must be auditable.

Preserve:
- actor
- timestamp
- state change
- source timesheets
- applied rates
- adjustments
- payment/invoice events where applicable

---

## 19. Accessibility

Implement:
- keyboard-selectable rows
- accessible tabs
- semantic controls
- visible focus states
- status text beyond color
- accessible drawer
- reduced-motion support

---

## 20. No redesign

Do not change:
- canonical Chelth sidebar
- header
- typography
- backdrop
- spacing
- KPI cards
- filter system
- table styling
- status-chip language
- drawer treatment
- action hierarchy
- established teal / mint / navy visual system
