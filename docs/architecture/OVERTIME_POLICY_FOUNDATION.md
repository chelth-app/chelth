# Overtime Policy Foundation

Status: P0-E7-S1.

> **Not legal advice.** Chelth stores the policies an agency configures and
> applies them deterministically. Configuring a policy does not make pricing
> compliant with any law or contract; agencies remain responsible for the
> rules that apply to them. No federal, state or national rule is built in.

## Model

`overtime_policy_versions`, separately for **pay** and **bill** (contracts
often differ): `none` or `weekly_threshold` with a threshold in minutes
(60–10080) and a multiplier as an exact fraction `numerator/denominator`
(≥ 1×, e.g. 3/2). Versioned like rounding; **disabled unless an active
policy exists**.

## Calculation (implemented)

- The week is the **timesheet period** (the agency's configured week start).
- The policy in force on the period's first day applies to the whole week.
- Entries are taken in chronological order of effective start; **priced**
  (post-rounding) minutes accumulate. For each entry:
  `regular = max(0, min(priced, threshold − counted))`, `overtime = priced − regular`.
- Pay and bill accumulate independently with their own policies.
- Amount = `rate × (regular × den + overtime × num) / (60 × den)`, rounded
  half up once per line ([PRICING_ENGINE.md](PRICING_ENGINE.md)).
- Different rate versions within one week are fine: each entry uses its own
  rate; overtime minutes multiply that entry's rate.

Tested: threshold not reached, crossed inside an entry, exactly at the
threshold, after the threshold, across entries (pgTAP 210/220).

## Not implemented

Daily overtime, double time tiers, seventh-day rules, blended/regular-rate
calculations, differentials, holiday premiums, jurisdiction workweeks that
differ from the timesheet week. These need new policy types and legal review.
