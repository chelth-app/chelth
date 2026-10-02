# Chelth Rates + Pricing — Interaction Specification

## Status

**P0-E8-S10 Rates + Pricing: LOCKED**

Do not redesign the canonical Chelth app shell, rate-card table, or Rate Details drawer.

---

## 1. Purpose

Rates + Pricing manages the rules that define:
- facility bill rates
- worker pay rates
- permitted differentials
- effective dates
- rate-card status

This module defines pricing rules.

It is not the Payroll or Invoice engine.

---

## 2. KPI cards

The top cards act as operational shortcuts.

### Active Rate Cards
Filter to currently active pricing rules.

### Missing Rates
Filter to roles/facility combinations missing required pricing.

### Expiring Soon
Filter to rate cards nearing their effective end date.

### Rate Exceptions
Filter to rate records requiring review or correction.

Do not add decorative sparklines.

---

## 3. Filters and search

Preserve the locked controls:
- Facility
- Role
- Rate Type
- Status
- Effective Date
- Search

Filter state should survive drawer open/close.

---

## 4. Add Rate Card

`Add Rate Card` opens the canonical rate creation flow.

Only capture fields supported by the actual data model.

Typical concepts may include:
- facility
- role
- base bill rate
- worker pay rate
- differential
- overtime rule
- effective-from date
- effective-to date
- status

Do not create the record silently.

---

## 5. Current Rate Cards table

Every rate-card row is selectable.

Clicking a row should:
1. set the active rate card;
2. open Rate Details;
3. populate the drawer from live data.

Relevant fields include:
- facility
- role
- base bill rate
- worker pay rate
- differential
- effective dates
- status

Do not hard-code screenshot values.

---

## 6. Rate Details drawer

The selected rate should show:
- facility
- role
- status
- bill rate
- worker pay rate
- weekend differential
- night differential
- overtime rule
- effective-from
- effective-to
- updated date
- updated by
- usage/related data
- audit history
- available actions

Only display fields supported by the actual product model.

---

## 7. Drawer behavior

When open:
- preserve the locked right-side drawer;
- main workspace uses remaining width.

When closed:
- remove reserved drawer width;
- expand the rate-card table into the freed area;
- reflow naturally;
- do not leave a blank gutter;
- do not reload the page.

Selecting another row reopens/updates the drawer.

Desktop:
- Escape closes the drawer.

---

## 8. Edit Rate

`Edit Rate` opens the canonical rate editor.

Rate changes should:
- respect permissions;
- preserve effective-date logic;
- write audit history;
- avoid silently rewriting historical shift pricing.

Where the data model supports versioning/effective dating, prefer a new effective version rather than mutating historical truth.

---

## 9. Duplicate Rate

`Duplicate Rate` creates a new draft/pending rate card prefilled from the selected rate.

The user must review and save/activate it.

Do not silently activate duplicates.

---

## 10. Deactivate

`Deactivate` disables the rate for future use according to product rules.

The system should:
- require appropriate permission;
- confirm the action;
- preserve historical usage;
- write audit history.

Do not delete historical rates used by prior shifts/timesheets/invoices.

---

## 11. View Related Shifts

`View Related Shifts` opens the canonical Shifts workflow filtered to shifts using the selected rate card where the architecture supports that relation.

Preserve facility/role context.

---

## 12. Usage & Related Data

This section is informational.

It may summarize:
- active shifts using rate
- recent hours
- spend/billing context

Only show metrics supported by real data.

Do not turn this into a finance analytics dashboard.

---

## 13. Audit History

Audit history should record meaningful pricing events, such as:
- rate created
- rate updated
- differential changed
- rate deactivated

Include:
- actor
- timestamp
- change summary

Sensitive pricing changes must be auditable.

---

## 14. Export

Export should reflect the current filtered view.

Respect:
- tenant scope
- permissions
- date/effective filters

---

## 15. Recent Pricing Activity

Activity entries should open linked rate details where available.

Examples:
- rate updated
- rate created
- differential corrected
- expiring soon
- deactivated

---

## 16. Relationship to shifts and financial modules

Rate Cards may be referenced by:
- Shifts
- Timesheets
- Payroll
- Invoices

Do not make downstream modules recalculate historical pricing from a newly edited rate unless the architecture explicitly requires it.

Historical records should preserve the applied rate/version where needed.

---

## 17. Permissions

Pricing is sensitive.

Actions such as:
- create
- edit
- duplicate
- deactivate
- export

must respect existing authorization rules.

---

## 18. Accessibility

Implement:
- keyboard-selectable rows
- semantic controls
- visible focus state
- status text beyond color
- accessible drawer
- reduced-motion support

---

## 19. No redesign

Do not change:
- canonical shell
- typography
- spacing
- colors
- KPI cards
- filters
- table structure
- status treatment
- drawer hierarchy
- action hierarchy
