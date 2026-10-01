# Financial Reconciliation

Status: P0-E7-S2. `financial_reconciliation(agency, 'pay' | 'bill')` shows
where every relevant priced line stands, with counts, minutes and amounts per
currency.

| State                 | Pay side                                                        | Bill side                         |
| --------------------- | --------------------------------------------------------------- | --------------------------------- |
| `unprepared`          | current, locked, priced; in no batch                            | same; in no draft                 |
| `adjustment_required` | current, but an earlier revision of the timesheet is in a batch | same, for the same relationship   |
| `drafted`             | in a `draft` / `reviewed` batch                                 | in a `draft` / `reviewed` draft   |
| `approved`            | in an `approved` / `locked` batch                               | in an `approved` / `locked` draft |
| `exported`            | in an `exported` batch                                          | in an `exported` draft            |

Lines in a document are counted at the revision they were prepared with (the
document is the record). Superseded lines that are in no document are not
counted. Cancelled batches and voided drafts release their lines back to
`unprepared`.

## Revisions after preparation

A timesheet can be reopened and approved again after its work was prepared.
That creates revision N+1, and pricing creates a **new** priced record.

- **Nothing earlier is mutated.** The batch or draft keeps its lines, totals,
  history and exports byte for byte (pgTAP S, integration, E2E 7).
- **Open document** (draft, reviewed or approved): it is flagged
  `SOURCE_SUPERSEDED`, and approve and lock fail closed (`CHY02`). Cancel or
  void it, then prepare again from the new revision.
- **Locked or exported document**: it is flagged **Adjustment required**. The
  newer revision is held back from ordinary preparation, so it cannot be paid
  or billed twice. The needs-attention queue lists it, referencing the
  earlier documents (for example `PAY-2026-000002 (exported)`) and whether
  the new revision has been priced yet.
- **Recording the difference** (a supplementary or adjustment document) is
  deferred. Today the agency handles it outside Chelth, with the references
  shown.

The UI queues are `/payroll` → "Needs attention" and `/invoices` → "Blocked
and needs attention".
