# Financial Adjustment Chain

Status: P0-E7-S3.

```
revision 1 ── PAY-2026-000002 (original batch, locked/exported, never changes)
revision 2 ── PAY-ADJ-2026-000001   1 → 2   +$11.32    previous: —
revision 3 ── PAY-ADJ-2026-000002   2 → 3   −$50.20    previous: PAY-ADJ-2026-000001
revision 4 ── (no document)         financially identical to 3 → resolved
revision 5 ── PAY-ADJ-2026-000003   3 → 5   …          previous: PAY-ADJ-2026-000002
```

## Last financially accounted revision

`internal.payroll_adjustment_status(timesheet)` and
`internal.invoice_adjustment_status(timesheet, relationship)` determine the
base:

1. The latest **non-cancelled/non-voided adjustment**: its `to_revision`.
2. Otherwise, the revision of the lines claimed in the original document.

Each new adjustment compares against that base and never back to revision 1.
History is never collapsed: each step is its own document, linked to the
previous one by FK (`previous.to_revision = from_revision`) and always to
the root original.

## States

| State                    | Meaning                                                   | Ordinary preparation |
| ------------------------ | --------------------------------------------------------- | -------------------- |
| `none`                   | nothing accounted yet                                     | offered              |
| `accounted`              | the original holds the current revision                   | (in document)        |
| `required`               | the current revision differs financially; can be prepared | held                 |
| `awaiting_lock`          | newer revision not locked                                 | held                 |
| `awaiting_pricing`       | newer revision not priced                                 | held                 |
| `currency_mismatch`      | different currency — cannot be adjusted                   | held                 |
| `split`                  | accounted lines span several original documents           | held                 |
| `original_open`          | original not locked (S2: cancel/void and prepare again)   | held                 |
| `in_progress`            | an open adjustment targets the current revision           | accounted            |
| `in_progress_superseded` | an open adjustment targets an older revision — cancel it  | held                 |
| `adjusted`               | a locked/exported adjustment covers the current revision  | accounted            |
| `no_change`              | revised but financially identical to the base             | accounted            |

"Held" work is never offered for an ordinary batch or draft, so it cannot be
paid or billed twice.

## Duplicate prevention and concurrency

- **Claims:** `payroll_adjustment_claims` has PK `(timesheet, from_revision)`;
  `invoice_adjustment_claims` has PK `(timesheet, relationship,
from_revision)`. A transition sits in at most one active/final adjustment.
- **Claim lifetime:** claims are inserted only while the adjustment is being
  prepared. They are deleted only when it is cancelled or voided, which is
  before lock.
- **Serialised preparation:** it takes the same per-agency advisory lock as
  ordinary preparation, plus a share lock on the timesheet row.
- **Concurrency test:** two finance users preparing the same adjustment
  produce exactly one document. The other user gets `CHY13`.

## Attention on documents

Original batches and drafts, and locked adjustments, show:

- `ADJUSTMENT_REQUIRED`: unresolved;
- `ADJUSTMENT_IN_PROGRESS`;
- `REVISION_RESOLVED`: adjusted or no financial change.

Open documents with revised sources show `SOURCE_SUPERSEDED`, and their
approval fails closed.
