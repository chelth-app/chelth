# Claude Implementation — Chelth Workforce

## Primary instruction

**DO NOT REDESIGN.**

Implement the locked Workforce screen exactly within the canonical Chelth app shell.

Visual reference:
`assets/chelth-workforce-locked.png`

Interaction specification:
`WORKFORCE-INTERACTIONS.md`

## Preserve

- canonical sidebar
- global search
- user/profile header
- brand colors
- Manrope / Inter typography
- spacing
- summary cards
- filter layout
- workforce table
- status-chip treatment
- right-side Professional Details drawer
- actions and drawer tabs
- pagination

## Data

Use real application data.

Each professional row must populate the drawer with its own record.

Do not ship screenshot hotspot behavior.

## Responsive drawer

When closed:
- main workforce surface expands into the freed width.

When a professional is selected:
- drawer opens;
- main surface contracts;
- the correct professional record is shown.

## No visual drift

Do not introduce:
- alternate navigation
- new summary metrics
- KPI sparklines
- new gradients
- AI terminology
- decorative analytics
- new button styles
- unrelated HR/recruiting features

This screen is workforce operations, not an applicant tracking system.

## QA gate

- [ ] canonical shell unchanged
- [ ] Workforce screenshot matched
- [ ] each row opens the correct worker
- [ ] drawer close expands table
- [ ] drawer reopen contracts table
- [ ] Overview/Credentials/Assignments/Activity tabs work
- [ ] filters work
- [ ] summary-card shortcuts work
- [ ] Add Professional flow works
- [ ] Assign to Shift works
- [ ] Message works where infrastructure exists
- [ ] View Credentials preserves worker context
- [ ] pagination preserves filters/search/sort
- [ ] keyboard accessibility works
- [ ] no brand drift

## Completion report

Save:
`docs/reports/CHELTH-B3-4-4-workforce-implementation.txt`
