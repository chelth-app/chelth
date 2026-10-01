# Financial Adjustment Model

Status: P0-E7-S3. Post-lock source revisions are resolved inside Chelth as
**separate, delta-only, immutable adjustment documents**. Original locked
batches and drafts, their lines, totals, history and export bytes never
change.

An adjustment is **not** a payment, legal invoice or credit note. There is no
tax, ledger entry or accounting posting.

## 1. Entities

| Payroll (pay side)           | Invoice (bill side)          | Role                                            |
| ---------------------------- | ---------------------------- | ----------------------------------------------- |
| `payroll_adjustments`        | `invoice_adjustments`        | header: lineage, signed totals, lifecycle       |
| `payroll_adjustment_lines`   | `invoice_adjustment_lines`   | changed entries only, old/new/delta (immutable) |
| `payroll_adjustment_claims`  | `invoice_adjustment_claims`  | one active/final adjustment per transition      |
| `payroll_adjustment_history` | `invoice_adjustment_history` | append-only lifecycle                           |

The unit of adjustment is:

- **Payroll:** one timesheet revision transition.
- **Invoice:** one (timesheet, facility relationship) revision transition.

## 2. Lineage (all composite-FK proven)

Every header records:

- `from_revision` → `to_revision` (`to > from`);
- both priced revisions, each FK-bound to `(id, agency, timesheet, revision)`
  and `(id, currency)`;
- the **root original document**:
  - payroll: `(id, agency, currency)` of the batch;
  - invoice: `(id, agency, relationship, facility, week, currency)` of the
    draft;
- `previous_adjustment_id`. Its FK requires the previous adjustment's
  `to_revision` to equal this adjustment's `from_revision`, with the same
  timesheet (and relationship) and the same root.

## 3. Delta calculation

Both sides come only from immutable priced lines; nothing is recomputed from
rates or attendance.

- **Old side:** the lines last financially accounted. These are the original
  document's claimed lines (rows are copies of priced lines), or, after an
  adjustment, its whole `to_revision`.
- **New side:** the current priced revision of the locked timesheet.
- **Matching:** by **timesheet entry**. There is one entry per assignment,
  and it is stable across revisions; display names are never used.
- **Missing lines:** an entry absent from the old side is an added line (old
  side NULL); one absent from the new side is a removed line (new side NULL,
  negative delta).
- **Changed:** a line is changed when it was added or removed, or when any
  minutes, rate or amount on that side differ. Only changed lines are
  stored.
- **Line amounts:** `delta = coalesce(new, 0) − coalesce(old, 0)` for the
  amount and the minutes, enforced by CHECK constraints.
- **Line FKs:** each present side is composite-FK-bound to the exact priced
  pay-side (payroll) or bill-side (invoice) values. A side is wholly present
  or wholly NULL (`num_nulls` check), so the FK always applies when present.

## 4. Totals (signed integers, minor units)

- `total_increase_minor ≥ 0`: the sum of positive line deltas.
- `total_decrease_minor ≥ 0`: the magnitude of negative line deltas.
- `net_delta_minor = increase − decrease` (CHECK). Lines carry signed
  deltas.
- A deferred constraint trigger proves at commit that the totals equal the
  lines.
- Invoice `direction` is generated from the net: `additional_charge` /
  `credit` / `no_net_change`.

## 5. Zero delta

A revision whose changed-line set is empty is **financially identical**. It:

- creates **no document** (`CHY18` if attempted);
- is classed `no_change`, resolved automatically;
- is not offered as ordinary work (no double pay or bill);
- shows the original document as "Revision resolved".

A later revision is compared with the last accounted revision (see
FINANCIAL_ADJUSTMENT_CHAIN). If minutes or a rate change but the net is zero,
that is still a material change: an adjustment is created with
`net_delta_minor = 0` (invoice direction `no_net_change`).

## 6. Rules (fail closed)

An adjustment can be prepared only when:

- the earlier revision was accounted in a LOCKED/EXPORTED document;
- the newer revision is the current one, locked and priced;
- the currency matches (no FX).

| State                                          | Code    |
| ---------------------------------------------- | ------- |
| nothing accounted or current already accounted | `CHY12` |
| open adjustment exists                         | `CHY13` |
| newer revision not locked                      | `CHY14` |
| newer revision not priced                      | `CHY15` |
| original not final, or spans several documents | `CHY16` |
| currency mismatch                              | `CHY17` |
| zero delta                                     | `CHY18` |

Approve and lock refuse an adjustment whose `to_revision` is no longer
current (`CHY02`). Cancel or void it, then prepare again.

## 7. Lifecycle

- **Payroll:** `draft → reviewed → approved → locked → exported`, or
  cancelled before lock.
- **Invoice:** the same, or voided before lock. A locked invoice adjustment
  cannot be voided: the chain after it would lose its base.
- **Original drafts:** an original invoice draft that roots a chain cannot be
  voided (`CHY21`).
- **Capabilities:** the same as the documents they adjust, `payroll.*` /
  `invoice.*`. Approve and export need AAL2, and maker/checker applies.
- **States:** there is no paid, settled, remitted, collected or overdue state.

## 8. Exports

Exports use the S2 infrastructure unchanged; see
[FINANCIAL_EXPORT_MODEL.md](FINANCIAL_EXPORT_MODEL.md) §7.
