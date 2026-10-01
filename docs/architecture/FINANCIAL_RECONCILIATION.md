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

## P0-E7-S3: adjustment states

`financial_reconciliation` now reports seven states:

| State                    | Rows                                                                     | Amount                  |
| ------------------------ | ------------------------------------------------------------------------ | ----------------------- |
| `unprepared`             | current lines in no document                                             | line amounts            |
| `drafted`                | lines in draft/reviewed documents                                        | line amounts            |
| `approved`               | lines in approved/locked documents                                       | line amounts            |
| `exported`               | lines in exported documents                                              | line amounts            |
| `adjustment_required`    | changed lines of unresolved revisions                                    | **signed** net estimate |
| `adjustment_in_progress` | lines of open adjustments                                                | **signed** deltas       |
| `adjusted`               | lines of locked/exported adjustments, plus no-change revisions (0 lines) | **signed** deltas       |

- **Resolved revisions.** A revision is no longer unresolved once its chain
  is complete (adjusted) or once it is shown to be financially identical
  (no_change). Neither case is offered for preparation again.
- **The "Needs attention" queue** lists only unresolved revisions, with the
  last accounted document's reference.
- **The adjustment queues** list each item with its original document, the
  revision change, its priced status and a signed delta estimate. On
  `/payroll` this is "Payroll adjustments required"; on `/invoices` it is
  "Invoice adjustments required for <facility>". The delta estimate comes
  from immutable pricing and is shown only when the item can be prepared.
