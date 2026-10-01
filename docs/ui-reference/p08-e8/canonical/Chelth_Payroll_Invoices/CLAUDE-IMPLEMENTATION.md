# Claude Implementation — Chelth Payroll + Invoices

## Primary instruction

**DO NOT REDESIGN.**

Visual source:
`assets/chelth-payroll-invoices-locked.png`

Interaction specification:
`PAYROLL-INVOICES-INTERACTIONS.md`

Data rules:
`PAYROLL-INVOICES-DATA-RULES.md`

## Scope

Implement P0-E8-S11 Payroll + Invoices using the canonical Chelth application shell.

The supplied visual is the locked Payroll-mode source of truth.

Invoices must reuse the same shell, component language, spacing, typography, table style, tabs, and drawer pattern.

## Preserve exactly

- Chelth logo and sidebar treatment
- global search / user header
- mint/off-white backdrop
- Manrope / Inter system
- page-heading hierarchy
- Payroll / Invoices segmented control
- KPI-card structure
- filters
- table language
- status chips
- Recent Billing Activity
- right-side details drawer
- drawer action hierarchy

## Moving parts

Implement:
- Payroll / Invoices toggle
- period selector
- KPI quick filters
- facility filter
- status filter
- search
- export
- Process Payroll
- payroll/invoice row selection
- detail drawer open/close
- main workspace expansion when drawer closes
- Review Payroll
- Approve Payroll
- View Timesheets
- View Rate
- billing activity navigation

Invoice-mode actions should be implemented only where supported by the current product architecture.

## Historical integrity

Do not recalculate historical payroll/invoice records from the latest rate card.

Use the applied rate/version or snapshot relationship supported by the architecture.

If this relationship is not currently safe, document the gap and stop before destructive behavior.

## Security

Financial data and actions require real server/database authorization.

Do not rely on client-side-only permission checks.

Maintain tenant isolation for all reads, writes, exports, and batch operations.

## Typography

Use:
`docs/brand/CHELTH-PRODUCT-TYPOGRAPHY.md`

Do not invent page-specific font sizes or weights.

## QA gate

- [ ] canonical Chelth shell unchanged
- [ ] locked Payroll visual matched
- [ ] Payroll / Invoices toggle works
- [ ] period/filter/search state works
- [ ] KPI shortcuts work
- [ ] each payroll row opens correct record
- [ ] detail drawer close expands workspace
- [ ] payroll calculation traces to approved timesheets and applied rates
- [ ] Review Payroll is non-destructive
- [ ] Approve Payroll is permission-controlled and auditable
- [ ] Process Payroll surfaces exceptions before processing
- [ ] View Timesheets preserves worker/period context
- [ ] View Rate opens the applied historical rate where supported
- [ ] invoice mode uses same canonical design system
- [ ] export respects filters, permissions, and tenant isolation
- [ ] historical values do not change when rate cards change
- [ ] accessibility works
- [ ] no brand/design drift

## Completion report

Save:
`docs/reports/CHELTH-P0-E8-S11-payroll-invoices-implementation.txt`
