# Payroll Export Model

Status: P0-E7-S2. This is a generic, documented CSV for handing prepared
payroll to the agency's own payroll provider. It is **not a certified
integration** with any payroll system, and it is not a bank, ACH or tax
file.

## Columns (export version 1)

```
batch_reference,worker_reference,worker_name,period_start,period_end,work_date,
facility,discipline,regular_minutes,overtime_minutes,pay_rate_minor,
pay_amount_minor,currency
```

There is one row per batch line, ordered by the line number fixed at
preparation.

- Minutes and amounts are integers in minor units, copied from the batch
  lines and therefore from the priced lines.
- `pay_rate_minor` is the hourly base pay rate.
- Overtime minutes are already priced at the applied multiplier inside
  `pay_amount_minor`.
- Names, references, facility and discipline are the display snapshots taken
  at preparation.

## Rules

- **Only a locked batch can be exported.** The first export moves it to
  `exported`. Re-exports are allowed and numbered, and they produce the same
  bytes and checksum.
- A batch flagged **Adjustment required** can still be exported (it is the
  approved record). The export UX shows the flag.
- Encoding, quoting, injection protection and checksum are as in
  [FINANCIAL_EXPORT_MODEL.md](FINANCIAL_EXPORT_MODEL.md).
