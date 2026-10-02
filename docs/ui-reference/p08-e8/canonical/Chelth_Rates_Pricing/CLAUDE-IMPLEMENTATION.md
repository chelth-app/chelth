# Claude Implementation — Chelth Rates + Pricing

## Primary instruction

**DO NOT REDESIGN.**

Visual source:
`assets/chelth-rates-pricing-locked.png`

Interaction source:
`RATES-PRICING-INTERACTIONS.md`

Data rules:
`RATES-PRICING-DATA-RULES.md`

## Scope

Implement P0-E8-S10 Rates + Pricing using the canonical Chelth application shell.

## Preserve

- sidebar
- top global header
- typography
- colors
- spacing
- KPI cards
- filters
- table
- pricing activity section
- Rate Details drawer
- button hierarchy

## Moving parts

Implement:
- KPI quick filters
- facility filter
- role filter
- rate-type filter
- status filter
- effective-date filter
- search
- export
- Add Rate Card
- rate row selection
- drawer open/close
- workspace expansion on drawer close
- Edit Rate
- Duplicate Rate
- Deactivate
- View Related Shifts
- pricing activity navigation

## Historical pricing

Do not overwrite historical pricing relationships simply because a rate card changes.

Use existing schema/versioning/effective-date architecture.

If the current architecture cannot safely preserve historical rate truth, flag this in the implementation report rather than inventing a silent workaround.

## Security

Pricing data is sensitive.

Follow Chelth tenant isolation and database authorization rules.

Do not use client-only authorization for rate writes or reads.

## Typography

Use:
`docs/brand/CHELTH-PRODUCT-TYPOGRAPHY.md`

No page-specific typography invention.

## QA gate

- [ ] visual matches locked Rates + Pricing reference
- [ ] canonical shell unchanged
- [ ] quick filters work
- [ ] all filter/search controls work
- [ ] Add Rate Card works
- [ ] each row opens the correct rate
- [ ] drawer close expands workspace
- [ ] Edit Rate respects historical/effective-date rules
- [ ] Duplicate creates reviewable copy, not silent active rate
- [ ] Deactivate preserves history
- [ ] View Related Shifts preserves rate/facility/role context
- [ ] audit history is retained
- [ ] export respects tenant/filter/permissions
- [ ] no brand drift

## Completion report

Save:
`docs/reports/CHELTH-P0-E8-S10-rates-pricing-implementation.txt`
