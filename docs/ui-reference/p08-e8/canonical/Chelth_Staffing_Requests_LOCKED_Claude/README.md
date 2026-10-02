# Chelth Staffing Requests — LOCKED

This package contains the approved Staffing Requests screen and an interaction-only HTML reference.

## Locked visual source of truth

`assets/chelth-staffing-requests-locked.png`

Do not redesign:
- Chelth app shell
- sidebar
- top search/user header
- typography
- brand colors
- spacing
- summary cards
- filters
- request table
- status chips
- Request Details panel
- activity treatment
- button styling
- overall visual hierarchy

## Interaction reference

The HTML adds only transparent interaction layers over the locked screenshot.

- Clicking a request row opens Request Details.
- Clicking X closes Request Details.
- When Request Details closes, the request queue expands into the available width.
- Reopening contracts the queue and restores the side panel.

For production, implement these behaviors with real components and application data.
