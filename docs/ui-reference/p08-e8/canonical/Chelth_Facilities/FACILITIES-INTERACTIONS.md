# Chelth Facilities — Interaction Specification

## Status

**B3.4.6 Facilities visual direction is locked.**

Do not redesign the canonical Chelth app shell or Facilities screen.

---

## 1. Facility row selection

Every facility row is selectable.

Selecting a facility should:
1. set that facility as the active record;
2. open the right-side `Facility Details` drawer;
3. populate the drawer with that facility's real data;
4. preserve filters, sorting, search, and pagination.

The selected row may use the same restrained selected-row treatment already established in Chelth.

---

## 2. Drawer open / close behavior

### Open
When Facility Details is open:
- retain the locked right-side drawer position;
- the facility table uses the remaining width.

### Closed
When the drawer closes:
- remove its reserved column;
- expand the table into the freed width;
- reflow columns naturally;
- do not leave a blank right gutter;
- do not reload the page.

### Reopen
Selecting another facility should:
- reopen the drawer;
- contract the main work surface;
- load the new facility's data.

Desktop:
- `Escape` closes the drawer.

---

## 3. Facility Details tabs

The drawer contains:

- `Overview`
- `Requests`
- `Shifts`
- `Activity`

### Overview
Show:
- facility name/type
- location
- primary contact
- units/departments
- preferred/commonly used roles
- open request count
- upcoming shift count
- active worker count
- recent requests

### Requests
Show staffing requests scoped to the selected facility.

Requests should be clickable and open the existing Staffing Requests workflow with the relevant request selected.

### Shifts
Show upcoming/current shifts scoped to the selected facility.

Shift items should be clickable and open the Shifts workflow with that shift selected.

### Activity
Show meaningful facility-related operational events, such as:
- request created
- request filled
- shift changed
- facility contact updated
- staffing note added

Do not turn Activity into a generic CRM feed.

---

## 4. Summary cards

The summary cards act as operational shortcuts.

### Active Facilities
Show facilities currently active/partnered.

### Open Requests
Show facilities with open staffing demand.

### Shifts This Week
Show facilities with scheduled shifts in the current week.

### Needs Attention
Show facilities with operational follow-up required.

Do not add sparklines or decorative charting.

---

## 5. Filters and search

Preserve the locked filters:
- region
- facility type
- status
- unit
- search

Filter state must survive:
- drawer open/close
- tab interaction
- pagination

---

## 6. Add Facility

`Add Facility` opens the canonical facility onboarding flow.

Use the existing Chelth component/navigation pattern.

Do not create a facility silently.

Only capture fields supported by the actual product model, such as:
- facility name
- facility type
- location/address
- primary contact
- contact details
- units/departments
- common roles
- notes/status

---

## 7. Create Request

`Create Request` opens a staffing-request flow pre-scoped to the selected facility.

The facility should already be selected when the flow opens.

Reuse the Staffing Requests data model and existing request-creation workflow.

Do not build a separate facility-specific request system.

---

## 8. View Shifts

`View Shifts` should navigate to the canonical Shifts screen with the selected facility filter applied.

Do not duplicate shift-management functionality inside Facilities.

---

## 9. Message Facility

`Message Facility` opens the existing communication workflow for the selected facility/contact.

Reuse current messaging/communication infrastructure if present.

Do not introduce a separate CRM messaging product solely for Facilities.

---

## 10. Recent Requests and Shifts

Rows/cards inside the drawer should be clickable.

Clicking:
- a request → Staffing Requests with that request selected;
- a shift → Shifts with that shift selected.

Preserve facility context when practical.

---

## 11. Pagination

Pagination changes visible facilities while preserving:
- filters
- search
- sort state

Avoid stale drawer data if the selected facility is no longer in the active result set.

---

## 12. Responsive behavior

On smaller screens:
- follow the existing Chelth responsive shell;
- table may become stacked facility rows/cards only if consistent with existing product patterns;
- Facility Details may become a full-height sheet;
- tabs and actions remain available;
- keep minimum touch-target sizes.

---

## 13. Accessibility

Implement:
- keyboard-focusable rows
- visible focus states
- semantic tab controls
- accessible labels
- `Escape` drawer close on desktop
- reduced-motion support

---

## 14. Product boundary

Facilities is an operational facility hub.

Do not turn it into:
- a generic CRM
- a sales pipeline
- marketing account management
- billing/finance software

The page exists to support staffing demand, shifts, facility coordination, and operational relationships.
