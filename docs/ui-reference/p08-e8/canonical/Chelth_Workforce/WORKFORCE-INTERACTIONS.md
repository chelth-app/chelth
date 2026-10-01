# Chelth Workforce — Interaction Specification

## Status

**B3.4.4 Workforce visual direction is locked.**

Do not redesign the canonical app shell or Workforce screen.

---

## 1. Professional row selection

Every row in the workforce table is selectable.

Selecting a professional should:
1. set that professional as the active record;
2. open the right-side `Professional Details` drawer;
3. populate the drawer with the selected professional's real data;
4. keep the current filters, sort state, search, and pagination intact.

The selected row may use the same subtle selected-row treatment already established elsewhere in Chelth.

---

## 2. Drawer open / close behavior

### Open
When Professional Details is open:
- keep the drawer in the locked right-side location;
- the workforce table occupies the remaining width.

### Closed
When the user closes the drawer:
- remove the reserved drawer column;
- expand the workforce table into the freed horizontal space;
- reflow columns naturally;
- do not leave a blank right gutter;
- do not reload the page.

### Reopen
Selecting any professional again should:
- reopen the drawer;
- contract the table smoothly;
- show that professional's information.

Desktop keyboard:
- `Escape` closes the drawer.

---

## 3. Professional Details tabs

The drawer includes:

- `Overview`
- `Credentials`
- `Assignments`
- `Activity`

### Overview
Show:
- availability
- current assignment
- upcoming shifts
- credential summary
- key contact/location information

### Credentials
Show:
- credential name
- status
- issued/expiration dates where supported
- missing/expiring/verified state
- review action where permissions allow

### Assignments
Show:
- current assignment
- upcoming shifts
- recent completed assignments where useful

### Activity
Show:
- meaningful workforce events
- assignment changes
- credential updates
- availability changes
- messages or operational notes where supported

Tabs should change drawer content without leaving the Workforce screen.

---

## 4. Top summary cards

The four summary cards act as operational shortcuts.

### Available Now
Filter workforce to professionals currently available.

### On Assignment
Filter to professionals currently working/assigned.

### Needs Attention
Filter to professionals with an operational issue requiring review, such as expiring credentials or incomplete readiness.

### Credential Ready
Filter to professionals whose required credentials are complete/current.

Do not add mini charts or sparklines.

---

## 5. Filters

The Workforce screen supports the locked filters:

- professional scope
- role
- availability
- credential status
- facility
- search

Changing filters should update the table without a full page reload.

Filter state should remain when opening/closing the drawer.

---

## 6. Add Professional

`Add Professional` opens the product's worker/professional onboarding flow.

Do not silently create a professional.

Use whatever modal, drawer, or route pattern is already established in the Chelth application.

Expected information may include:
- name
- role
- contact information
- location
- availability
- facility relationship
- credentials/onboarding state

Only fields supported by the real product model should be implemented.

---

## 7. Assign to Shift

`Assign to Shift` should open an assignment flow for the currently selected professional.

The flow should show eligible open shifts based on product rules and existing data.

Before assignment, respect:
- availability
- role fit
- credential readiness
- existing assignment conflicts
- other rules already implemented by Chelth

Do not present an ineligible worker as safely assignable without warning.

---

## 8. Message

`Message` opens a communication flow for the selected professional.

Reuse existing Chelth messaging infrastructure if present.

Do not invent a separate messaging system solely for this screen.

---

## 9. View Credentials

`View Credentials` should switch to the selected worker's credential details or navigate to the canonical Credentials workflow.

Preserve the professional context.

---

## 10. Pagination

Pagination changes the visible workforce records while preserving:
- filters
- search
- sort state

If the selected professional is no longer on the current page, drawer behavior should follow the app's established state model rather than displaying stale data.

---

## 11. Responsive behavior

On smaller screens:
- do not simply shrink the desktop table;
- use the existing Chelth responsive app-shell pattern;
- convert professional records to readable stacked rows/cards only if the product already uses that responsive convention;
- drawer may become a full-height sheet;
- preserve actions and tabs;
- maintain minimum touch-target sizes.

---

## 12. Accessibility

Implement:
- keyboard-focusable rows
- semantic controls
- visible focus state
- accessible tab semantics
- `Escape` close behavior on desktop
- correct labels for action buttons
- reduced-motion support

---

## 13. Source of truth

The screenshot is authoritative for visual design.

The real implementation must use live application data and Chelth's existing architecture.

Do not hard-code the screenshot's example workers in production.
