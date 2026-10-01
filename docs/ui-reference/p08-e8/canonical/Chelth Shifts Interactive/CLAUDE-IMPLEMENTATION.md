# Claude Implementation — Chelth Shifts

## Status
B3.4.2 Shifts List + Calendar is LOCKED.

## Rule
DO NOT REDESIGN THE SUPPLIED REFERENCES.

## Build real interactions
Use real Chelth components/data rather than screenshot hotspots.

### View toggle
The existing List and Calendar buttons must switch between the two approved views.

### Shift selection
Every list row and calendar shift block must open Shift Details for the exact selected shift.

### Detail drawer
Populate from selected-shift data:
- date/time
- facility
- unit
- role
- assigned worker
- status
- confirmation
- credential readiness
- requirements
- notes/activity where available

### Responsive expansion
When detail panel closes:
- remove its reserved column
- expand table/calendar into the available width
- reflow columns/blocks naturally
- do not leave a blank gutter
- do not reload the page

When a shift is selected again:
- reopen the panel
- contract main content smoothly
- update to the new shift

### Accessibility
- keyboard-focusable rows/shift blocks
- Escape closes desktop drawer
- accessible labels for List/Calendar
- respect reduced motion

### QA
- no visual drift
- no new charts/progress bars
- exact locked shell retained
- view toggle works
- all shifts open their own data
- close expands the main area
- reopen contracts it again

Save report to:
`docs/reports/CHELTH-B3-4-2-shifts-list-calendar-implementation.txt`
