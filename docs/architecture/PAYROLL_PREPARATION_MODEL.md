# Payroll Preparation Model

Status: P0-E7-S2. Chelth **prepares** payroll data from immutable pricing.
It does not run payroll, pay anyone, calculate tax, withholding, benefits,
deductions or garnishments, produce payslips, or create bank or ACH files.

## 1. Sources

The only input is the pay side of `priced_timesheet_lines` (P0-E7-S1). A
priced line is **eligible** when:

- its revision is the timesheet's **current** revision and the timesheet is
  `locked` (a superseded pricing is never current);
- it is not claimed by a non-cancelled batch (`payroll_line_claims`);
- no **other** revision of the same timesheet is claimed. Otherwise the line
  is held back as **Adjustment required** (see
  [FINANCIAL_RECONCILIATION.md](FINANCIAL_RECONCILIATION.md)).

Live rates are never read. Minutes, rates and amounts are never recomputed.

## 2. Payroll periods

Agency settings (`agency_financial_settings`), calendar DATES only, with no
timezone:

| Setting                    | Meaning                                                         |
| -------------------------- | --------------------------------------------------------------- |
| `payroll_period_type`      | `weekly` or `biweekly`                                          |
| `payroll_week_starts_on`   | ISO weekday periods start on (derived from the anchor; checked) |
| `payroll_anchor_date`      | any date that starts a period; fixes biweekly alignment         |
| `payroll_reference_prefix` | default `PAY`                                                   |
| `invoice_reference_prefix` | default `INV-DRAFT`                                             |

Without settings, the default is weekly, starting on the agency's timesheet
week start (default Monday). A line belongs to the period containing its
facility-local work date:
`start = d − (((d − anchor) mod L) + L) mod L`, where L is 7 or 14.

`payroll_periods` rows are created when first used. An exclusion constraint
(btree_gist) forbids two overlapping periods for one agency, so changing the
settings can never create overlapping payroll history (`CHY05`).

## 3. Batches

`payroll_batches` is one per agency, period and currency (several are
allowed for late work). It holds:

- the human reference `PAY-YYYY-NNNNNN`: per-agency monotonic counter per
  (kind, year of period start), with a configurable prefix;
- status, line and worker counts;
- regular and overtime minutes;
- `total_pay_minor` (bigint);
- lifecycle stamps (who and when), cancellation reason.

A deferred constraint trigger proves at commit that the totals equal the sum
of the lines.

`payroll_batch_lines` holds one row per included priced line. It copies the
source ids, revision, work date, minutes, pay rate, pay amount and
calculation version. It also stores display snapshots (worker reference and
name, facility, discipline) taken at preparation.

A single composite FK binds all copied values to
`priced_timesheet_lines (…, pay_regular_minutes, pay_overtime_minutes,
pay_rate_minor, pay_amount_minor, calculation_version)`. A line therefore
cannot carry a value its source does not have, even when written as the
database owner. Lines are append-only and can be inserted only while their
batch is being created.

Worker totals are derived from the immutable lines
(`list_payroll_batch_workers`).

## 4. Lifecycle

```
draft → reviewed → approved → locked → exported
  │        │          │
  └────────┴──────────┴──→ cancelled   (before lock only; releases the lines)
```

| Step    | RPC                     | Capability                                         |
| ------- | ----------------------- | -------------------------------------------------- |
| Prepare | `create_payroll_batch`  | `payroll.prepare`                                  |
| Review  | `review_payroll_batch`  | `payroll.prepare`                                  |
| Approve | `approve_payroll_batch` | `payroll.approve` (AAL2)                           |
| Lock    | `lock_payroll_batch`    | `payroll.approve` (AAL2)                           |
| Export  | `create_payroll_export` | `payroll.export` (AAL2)                            |
| Cancel  | `cancel_payroll_batch`  | `payroll.prepare`; `payroll.approve` once approved |

- **Approve and lock fail closed** (`CHY02`) while any line's source is no
  longer the current locked revision.
- **Lock makes the batch immutable.** A trigger allows only `locked →
exported`, and every stamp is written once. Lines and totals never change,
  claims cannot be released, and batches are never deleted.
- **There is no "paid" state.**
- Every step appends to `payroll_batch_history` and is audited.

## 5. Concurrency

Preparation takes a per-agency transaction advisory lock, so two finance
users preparing the same period serialise. The second finds nothing left
(`CHY01`). The primary key of `payroll_line_claims` (the priced line id) is
the structural backstop: a duplicate claim fails (`23505` → `CHY10`).

Integration test: two users run `Promise.all`, exactly one wins, and 3
claims belong to one batch.

## 6. Legal and product boundaries

- **Preparation, not payroll.** Chelth produces reviewed, approved, locked
  pay data and a CSV. The agency's payroll provider runs payroll.
- **Drafting, not invoicing.** Invoice drafts are internal documents. Chelth
  does not issue, send or collect on invoices.
- **No tax.** Chelth does no tax calculation, withholding, filing or VAT/GST.
  Amounts are gross pay and pre-tax bill amounts as priced.
- **No compliance guarantee.** Correctness for wage-and-hour, overtime or
  invoicing law depends on the agency's configured rates and policies and
  remains the agency's responsibility.
- **Generic exports.** The CSV and PDF formats are documented and generic,
  not certified integrations with any payroll, accounting or banking system.
- **Retention.** Financial records and exports are retained indefinitely
  (append-only). A legal retention review per jurisdiction is required before
  production.
