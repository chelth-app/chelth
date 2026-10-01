# Chelth Payroll + Invoices — Data Rules

## Core product relationship

Payroll and invoices are downstream records.

Source chain:

`Shift`
→ `Attendance`
→ `Timesheet`
→ `Applied Rate`
→ `Payroll / Invoice`

Use the actual Chelth schema if it already defines these relationships.

---

## Payroll concepts

Typical concepts may include:
- payroll_record_id
- workspace / tenant id
- worker_id
- facility_id
- period_start
- period_end
- approved_timesheet_ids
- regular_hours
- overtime_hours
- differentials
- adjustments
- gross_pay
- currency
- applied_rate_id / applied_rate_version
- status
- reviewed_by / reviewed_at
- approved_by / approved_at
- created_at / updated_at

Do not invent fields if existing architecture differs.

---

## Invoice concepts

Typical concepts may include:
- invoice_id
- workspace / tenant id
- facility_id
- billing_period_start
- billing_period_end
- timesheet / shift references
- billable_hours
- applied_bill_rate references
- subtotal
- adjustments
- total
- currency
- invoice_status
- issued_at
- due_at
- paid_at / payment status
- external reference if integrated with billing provider

Use actual architecture.

---

## Historical integrity

When calculating payroll/invoices:
- retain the exact timesheet records used;
- retain the rate/rate version used;
- retain adjustment history.

Do not derive historical totals later from the latest rate card.

---

## Source immutability

Payroll adjustments must not silently mutate:
- Attendance events
- approved Timesheets
- original rate-card history

Corrections should follow explicit correction/versioning workflows.

---

## Currency

Use tenant/workspace currency configuration if supported.

Do not hard-code USD because the visual reference displays `$`.

---

## Tenant isolation

Financial records require strict tenant isolation.

Enforce authorization in:
- database queries/policies
- server/API layer
- background processing

Never depend on front-end filtering alone.

---

## Audit log

Important events should be recorded, including:
- payroll prepared
- exception created/resolved
- payroll reviewed
- payroll approved
- invoice created
- invoice sent
- invoice adjusted
- payment recorded
- record voided/cancelled if supported

Preserve actor, timestamp, and material change details.
