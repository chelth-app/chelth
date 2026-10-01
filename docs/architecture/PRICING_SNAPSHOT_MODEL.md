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
