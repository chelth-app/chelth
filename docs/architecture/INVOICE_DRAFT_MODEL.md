# Invoice Draft Model

Status: P0-E7-S2. Chelth **drafts** internal invoices from bill-side
pricing. It does not issue legal invoices, send them, calculate tax, collect
payment, take cards, create payment links, track paid/overdue status, post
to a ledger or integrate with accounting systems.

## 1. Scope of a draft

`invoice_drafts` is one per agency, facility relationship, week and
currency.

- The week is the **priced timesheet's period**. A composite FK on every
  line, `(priced_timesheet_id, agency, period_start, period_end, currency)`,
  proves that each line's week is the draft's week.
- Totals: line count, priced minutes, `total_bill_minor`. A deferred check
  proves they equal the lines.
- Display snapshots: agency name and facility name.
- Reference: `INV-DRAFT-YYYY-NNNNNN`. This is an **internal draft
  reference**. Legal invoice numbering is deferred to the system that issues
  real invoices.

## 2. Bill side only

`invoice_draft_lines` copies priced minutes, bill regular and overtime
minutes, bill rate, bill amount, revision and calculation version. A
composite FK binds them to the priced line's bill-side columns.

The invoice tables have **no pay-side or margin column**, and pgTAP K checks
this through `information_schema`. Pay data therefore cannot be stored on a
draft, returned by its projections or written to its exports.

## 3. Lifecycle

```
draft → reviewed → approved → locked → exported
   └───────┴──────────┴─────────┴────────┴──→ voided
```

- Review needs `invoice.prepare`.
- Approve and lock need `invoice.approve` (AAL2), and fail closed while any
  source is superseded (`CHY02`).
- Export needs `invoice.export` (AAL2).
- Voiding needs `invoice.prepare` before approval and `invoice.approve`
  after it. It requires a reason.
  - It never changes the draft's lines or totals.
  - It releases the claims, so the work can be drafted again (for example
    after a correction).
- There is no sent, paid, overdue or collected state.

## 4. Duplicate prevention

The primary key of `invoice_line_claims` (the priced line id) means a bill
line can sit in at most one non-voided draft. Preparation runs under a
per-agency advisory lock. A concurrent integration test shows one winner.

## 5. Draft documents

Two formats are produced: CSV, and a PDF titled **DRAFT INVOICE** on every
page. See [FINANCIAL_EXPORT_MODEL.md](FINANCIAL_EXPORT_MODEL.md).

- Both state "Not a tax invoice. Not a request for payment. No tax has been
  calculated."
- The file names end in `-DRAFT-INVOICE.csv` / `.pdf`.

## 6. Adjustments (P0-E7-S3)

Bill-side revisions made after lock are resolved as **invoice adjustment
drafts**. There is one per (timesheet, relationship) transition, each an
**additional charge** or a **credit**.

- **Naming.** They are internal drafts, never legal credit notes.
- **No pay data.** They have no pay or margin column.
- **Original drafts.** An original draft that roots an adjustment chain
  cannot be voided (`CHY21`).
- **Approval outcome.** `approve_invoice_draft` returns
  `(outcome, reason_code)`; refusals are audited.

See [FINANCIAL_ADJUSTMENT_MODEL.md](FINANCIAL_ADJUSTMENT_MODEL.md).
