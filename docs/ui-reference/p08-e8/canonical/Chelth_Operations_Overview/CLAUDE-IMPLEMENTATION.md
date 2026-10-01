# Claude Implementation — Chelth Operations Overview

## Primary instruction

**DO NOT REDESIGN.**

Use:
`assets/chelth-operations-overview-locked.png`

as the visual source of truth.

Interaction behavior is defined in:
`OPERATIONS-OVERVIEW-INTERACTIONS.md`

## Canonical typography

Use the Chelth product typography system consistently:
- Manrope for page/section display headings
- Inter for product UI, tables, labels, filters, status chips, metadata, and buttons

If `docs/brand/CHELTH-PRODUCT-TYPOGRAPHY.md` exists, it overrides ad-hoc page-level font choices.

Do not choose new typography values independently for this page.

## Data

Use real application data.

Do not hard-code the screenshot values in production.

## Routing

Use the existing Chelth app routes/components for:
- Shifts
- Staffing Requests
- Workforce
- Credentials

Avoid duplicated business logic.

## QA

- [ ] desktop Operations Overview matches locked reference
- [ ] no mobile mockup rendered beside desktop
- [ ] KPI cards route correctly
- [ ] schedule rows open relevant shift
- [ ] staffing request rows open relevant request
- [ ] credential expiration items route correctly
- [ ] workforce readiness link works
- [ ] coverage range control works
- [ ] typography follows Chelth tokens
- [ ] no decorative sparkline bars in KPI cards
- [ ] no brand drift

## Completion report

Save:
`docs/reports/CHELTH-B3-4-1-operations-overview-implementation.txt`
