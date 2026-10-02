# Claude Implementation — Chelth Staffing Requests

## Status
**B3.4.3 Staffing Requests: LOCKED**

## Primary rule
**DO NOT REDESIGN THIS SCREEN.**

Use the locked PNG as the visual source of truth.

## Screen purpose
Staffing Requests is the operational queue for incoming facility workforce demand.

This is intentionally a queue/list experience.
Do not add a Calendar view at this stage.

## Required main-screen structure

Preserve the locked:
- page title and supporting copy
- `New Request` primary action
- summary cards
  - New Requests
  - In Progress
  - Awaiting Facility
  - Filled
- date range filter
- facility filter
- role filter
- status filter
- search
- request queue/table
- pagination
- right-side Request Details panel

## Request lifecycle language

Use:
- New
- In Progress
- Awaiting Facility
- Filled
- Cancelled

Do not introduce alternate workflow terminology unless already present in the Chelth product.

## Queue columns

Use the locked visual as the source of truth for:
- Requested
- Facility
- Unit
- Role
- Need Date
- Shift
- Qty
- Progress
- Status
- row actions

## Multi-position staffing requests

A request may require more than one professional.

Represent fulfillment with values such as:
- `0 / 3`
- `1 / 2`
- `2 / 3`
- `3 / 3`

The Request Details drawer should use plain language such as:
`1 of 2 positions filled`

Do not split one multi-position facility request into unrelated visual rows unless the underlying product data model requires it.

## Row selection

Every request row must be selectable.

Clicking a row must open Request Details for that exact request.

Populate the drawer using real request data, including where available:
- requested time
- facility
- unit
- role
- quantity
- need date
- shift time
- fulfillment progress
- status
- requirements
- assigned professionals
- suggested professionals
- notes
- activity history

Do not use hard-coded screenshot data in production.

## Request Details actions

Preserve the locked hierarchy:
- Find Workers
- Contact Facility
- Edit Request

Only enable actions supported by the current product architecture and permissions.

## Detail-panel responsive behavior

When Request Details is open:
- retain the locked right-side drawer treatment
- request queue uses the remaining width

When Request Details closes:
- remove the reserved drawer column
- expand the request queue naturally into the freed space
- do not leave a blank gutter
- do not reload the page
- preserve filters, sorting, pagination, and selected state

Selecting another request:
- reopens the drawer
- contracts the queue smoothly
- populates the drawer with the newly selected request

Use responsive grid/flex behavior in the real application, not screenshot scaling.

## Accessibility

Implement:
- keyboard-focusable rows
- visible focus states
- Escape closes the drawer on desktop
- semantic table markup where practical
- accessible labels for action buttons
- reduced-motion support

## DO NOT ADD

- Calendar toggle
- sparkline/progress-bar decoration in summary cards
- new KPIs
- new charts
- alternate sidebar
- additional gradients
- AI language
- fake facility logos
- fake customer proof
- decorative animations
- new visual hierarchy

## QA gate

Before completion verify:

- [ ] Matches locked Staffing Requests visual
- [ ] Existing canonical app shell preserved
- [ ] No Calendar view added
- [ ] Every request row opens its own request data
- [ ] Multi-position progress is accurate
- [ ] Drawer closes
- [ ] Queue expands when drawer closes
- [ ] Drawer reopens on another selection
- [ ] Filters remain intact
- [ ] Pagination remains intact
- [ ] No brand drift
- [ ] No unsupported claims or fake data in production
- [ ] No decorative KPI charts added

## Completion report

Save a plain-text report to:

`docs/reports/CHELTH-B3-4-3-staffing-requests-implementation.txt`

Include:
- files changed
- components created/updated
- data sources
- request lifecycle mapping
- drawer behavior
- responsive behavior
- QA results
- unresolved issues
