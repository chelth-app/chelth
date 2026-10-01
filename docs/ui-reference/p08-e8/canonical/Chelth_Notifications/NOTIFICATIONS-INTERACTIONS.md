# Chelth Notifications / Activity — Interaction Specification

## Status
**Notifications / Activity: LOCKED**

## Purpose
This is Chelth's operational attention center, not a generic inbox.

## KPI filters
- Needs Attention
- Unread
- Today
- This Week

## Filters
Support:
- notification type
- facility
- professional
- status
- time
- search

## Activity views
Locked views:
- All Activity
- Needs Attention
- Unread
- Today
- Archived

Switch views without full-page reload.

## Mark all as read
Update only records the user is authorized to mark as read. Preserve archived/action-required state separately where applicable.

## Notification rows
Clicking a row opens Activity Details for that exact event.

Examples represented in the locked reference include:
- credential expiry
- staffing request
- at-risk shift
- credential verified
- assignment declined
- request filled
- facility update
- shift reminder
- document upload
- facility message

## Activity Details drawer
Show the related operational record, timestamp, facility/professional context, current state, and available actions.

## Contextual actions
Depending on the selected event:
- Request Updated Document
- View Professional
- View Credential
- open linked Shift / Staffing Request / Facility record where supported

Only show actions appropriate to the event.

## Drawer behavior
Closing the drawer expands the main activity workspace. Selecting another notification reopens/updates it.

## Read/archive behavior
Reading a notification must not remove an unresolved operational issue.
Archived state and resolution state are separate concepts.

## Accessibility
Keyboard navigation, visible focus, semantic controls, reduced motion, status text beyond color.

## No redesign
Preserve canonical Chelth shell, typography, cards, filters, row style, drawer and action hierarchy.
