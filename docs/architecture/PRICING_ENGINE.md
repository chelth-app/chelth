# Pricing Engine

Status: P0-E7-S1. One function prices work:
`internal.price_timesheet_revision(timesheet, expected_revision)`, called by
`public.price_timesheet` (`pricing.run`). No UI or other function repeats the
arithmetic.

## 1. Steps

1. Lock the timesheet row (serialises with sign-off, reopen and revision).
   Require `status = locked` (`CHM07`) and the caller's expected revision
   (`CHM08`).
2. If a pricing exists for (timesheet, revision), return it (`existing`) —
   idempotent; nothing is duplicated.
3. Load the **current approval snapshot** for that revision. Worked minutes
   come only from it; each entry is cross-checked against the locked entry
   (any divergence ⇒ `CHM08`). Live attendance is never read.
4. Per worked entry (chronological by effective start): resolve the rate
   ([RATE_CARD_MODEL.md](RATE_CARD_MODEL.md) §4) by the local work date,
   check one currency, apply rounding
   ([ROUNDING_POLICY.md](ROUNDING_POLICY.md)) and overtime
   ([OVERTIME_POLICY_FOUNDATION.md](OVERTIME_POLICY_FOUNDATION.md)),
   compute amounts.
5. Any issue (`RATE_NOT_CONFIGURED`, `RATE_AMBIGUOUS`, `RATE_CURRENCY_MISMATCH`)
   ⇒ nothing is priced. The attempt is stored in `pricing_blocks` (one row
   per revision, attempts counted), audited as `pricing.failed`, and other
   `pricing.run` holders are notified **once** per blocked revision.
6. Otherwise insert the immutable header and lines, resolve the block, audit
   `pricing.created` (and `pricing.repriced_for_revision` for a later
   revision).

Not-worked entries (0 minutes) are not priced. A timesheet with no worked
minutes returns `no_work`.

## 2. Arithmetic (calculation version 1)

Integers only.

```
round_half_up(a / b)  = (2a + b) div (2b)                    a ≥ 0, b > 0
priced_minutes        = raw, or round_half_up(raw / N) × N   (N = rounding increment)
amount_minor          = round_half_up( rate_minor × (regular × den + overtime × num) / (60 × den) )
                        (num/den = overtime multiplier; 1/1 when no overtime)
totals                = sum of line amounts (each line rounded once)
```

Worked examples (tested):

| Case                                            | Pay                                    | Bill                  |
| ----------------------------------------------- | -------------------------------------- | --------------------- |
| 480 min @ 4250 / 5800                           | 34000 ($340.00)                        | 46400 ($464.00)       |
| 453 min @ 4250 / 5800                           | 1,925,250/60 = 32087.5 → **32088**     | 43790 ($437.90)       |
| 453 → 450 (nearest 15), 330 min OT at 3/2, 4400 | 4400 × (120×2 + 330×3)/120 = **45100** | 450 × 6000/60 = 45000 |

## 3. Revisions and history

- A new locked revision is priced into a new record; earlier records stay
  (the pricing list marks them "Superseded by revision N").
- Later rate or policy changes never alter an existing record: every line
  stores the applied version ids **and** applied values.
- Pricing never marks anything paid or billed, creates payroll, invoices,
  ledger entries or payments.

## 4. Downstream consumers (P0-E7-S2)

Payroll preparation and invoice drafting consume priced lines **only**:

- They never call the engine.
- They never read rates.
- They never recompute.

Only the **current** priced revision of a **locked** timesheet is eligible.
A newer revision of work already in a locked document is held back as
"Adjustment required" ([FINANCIAL_RECONCILIATION.md](FINANCIAL_RECONCILIATION.md)).
Pricing itself still marks nothing as paid or billed.
