# Pricing Snapshot Model

Status: P0-E7-S1. "Why was this amount calculated?" must be answerable
months later without consulting current configuration.

## `priced_timesheets` (one per timesheet revision)

Timesheet, revision, the approval it priced (FK `(approval, timesheet,
revision)`), worker, period, **one currency**, line count, total raw/priced
minutes, total pay/bill overtime minutes, total pay and bill minor units,
applied pay/bill overtime policy versions (FK also proves the side),
calculation version, who priced it and when. Unique `(timesheet, revision)`.

## `priced_timesheet_lines` (one per worked entry)

| Group         | Stored                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Source        | timesheet, revision, entry, assignment, shift, worker, person, relationship, facility, discipline, classification, local date |
| Minutes       | raw (from the approval snapshot), priced (after rounding), pay/bill regular and overtime split                                |
| Applied rate  | card, version, precedence tier, currency, pay rate, bill rate                                                                 |
| Applied rules | rounding version, mode, increment; pay/bill overtime numerator/denominator                                                    |
| Amounts       | pay and bill in minor units                                                                                                   |
| Version       | calculation version                                                                                                           |

## Structural guarantees

- `(rate_version_id, currency, pay_rate_minor, bill_rate_minor)` references
  the version's exact terms: a line cannot claim a rate its version does not
  have.
- `(entry, timesheet, assignment, shift, worker, person, relationship,
facility)` references the timesheet entry; `(shift, agency, discipline,
classification)` references the shift; `(card, agency, discipline)` the
  card, and a trigger checks the card's relationship/classification scope
  covers the line.
- `(priced_timesheet_id, currency)` references the header: one currency per
  record.
- Minutes split checks: regular + overtime = priced, for each side.
- Header and lines refuse UPDATE, DELETE and TRUNCATE for every role.
- `authenticated` has SELECT only (RLS: `pricing.view`); writes happen only
  in the engine.

Margin (bill − pay) is derived for display, never stored.

## Consumption by payroll and invoices (P0-E7-S2)

P0-E7-S2 added two composite unique keys to `priced_timesheet_lines`. Both
are supersets of the primary key.

- **Payroll** (`priced_timesheet_lines_payroll_source_key`): ids, revision,
  worker, facility, relationship, discipline, local date, currency, pay
  minutes, pay rate, pay amount and calculation version.
  `payroll_batch_lines` references it.
- **Invoices** (`priced_timesheet_lines_invoice_source_key`): the same ids
  plus priced minutes, bill minutes, bill rate, bill amount and calculation
  version. `invoice_draft_lines` references it.

`priced_timesheets` gained `(id, agency, period_start, period_end,
currency)`, so an invoice line proves its week.

As a result, a batch or draft line can hold only values that exist on an
immutable priced line, even when written by the database owner. Snapshots
remain immutable, and later revisions are new records, never edits.
