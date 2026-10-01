# Chelth Worker Profile — Interaction Specification

## Status

**P0-E8-S4 Worker Profile: LOCKED**

The visual source of truth is the supplied Worker Profile image.

Do not redesign the canonical Chelth app shell or profile layout.

---

## 1. Worker identity and profile context

The Worker Profile is the persistent worker record.

It should be reachable from:
- Workforce
- Shifts
- Staffing Requests
- Credentials
- Timesheets
- Attendance
- Notifications where the worker is the related record

The profile header should use the selected worker's real data.

---

## 2. Primary actions

### Message
Open the existing Chelth communication flow for the selected worker.

Do not create a second messaging system.

### Assign to Shift
Open the canonical assignment workflow with this worker preselected.

Before assignment, respect:
- availability
- role
- credential readiness
- existing shift conflicts
- facility requirements
- other product rules already implemented

### More
Use the existing Chelth action-menu pattern.

Only show actions supported by permissions and product scope.

---

## 3. Availability

`Update Availability` opens the worker availability editor.

The weekly availability summary should reflect live availability data.

Changing availability should:
- persist via the existing data layer;
- update the profile;
- update Workforce availability state;
- affect shift eligibility where relevant.

Do not use availability as a decorative indicator only.

---

## 4. Profile tabs

The locked tab set is:

- Overview
- Credentials
- Assignments
- Schedule
- Timesheets
- Documents
- Activity
- Notes

Tabs should update content without leaving the worker context.

### Overview
Contains:
- worker summary
- availability
- KPI summary
- professional information
- skills/preferences
- next scheduled shift
- credential status
- recent activity

### Credentials
Show the selected worker's credential records using the canonical Credentials patterns.

### Assignments
Show current, upcoming, and recent assignment history.

### Schedule
Show the worker's own schedule using the canonical shift data model.

### Timesheets
Show timesheets for the selected worker.
This tab should connect to P0-E8-S9 Timesheets rather than duplicate its business logic.

### Documents
Show operational worker documents supported by the product.

### Activity
Show meaningful worker-related operational events.

### Notes
Show internal notes according to role permissions.

---

## 5. Professional Information

The `Edit` action should open an edit flow for supported worker fields.

Only persist fields present in the actual data model.

Potential fields shown in the reference include:
- full name
- professional type
- phone
- email
- location
- employment type
- start date
- languages
- about/notes

Do not hard-code screenshot values.

---

## 6. Skills and Preferences

The second `Edit` action controls supported:
- clinical skills
- facility preferences
- shift preferences
- preferred units
- additional availability/preferences

These values should inform assignment matching where the product supports it.

Do not represent preference as hard eligibility unless business rules say so.

---

## 7. Next Scheduled Shift

`View Shift Details` should open the canonical Shifts workflow with that exact shift selected.

`Add to Calendar` should use the product's supported calendar/export behavior if implemented.

`View All` should open all shifts scoped to the selected worker.

---

## 8. Credential Status

Each credential row should open the selected worker's credential detail.

`View All` should open Credentials scoped to this worker.

Credential state must come from the canonical credential data source.

Do not duplicate credential truth inside the profile.

---

## 9. Recent Activity

Activity entries should be clickable when linked to a real record.

Examples:
- completed shift → open shift
- credential verified → open credential
- assigned to shift → open shift/assignment
- availability updated → open availability history if supported

`View All` opens the worker Activity tab.

---

## 10. Cross-module context

When navigating away from Worker Profile, preserve worker context where practical.

Examples:
- Worker Profile → Credentials should prefilter to worker
- Worker Profile → Shifts should prefilter to worker
- Worker Profile → Timesheets should prefilter to worker
- Worker Profile → Attendance should prefilter to worker

Avoid forcing the user to find the same worker again.

---

## 11. Permissions

Profile visibility/editability must respect the application's existing permissions.

Potential distinctions:
- workspace admin
- staffing coordinator
- supervisor
- healthcare professional

Do not expose private/internal data to roles that should not see it.

---

## 12. Responsive behavior

On mobile:
- maintain canonical Chelth mobile shell
- stack profile summary intelligently
- tabs may become horizontally scrollable or a compact switcher
- actions remain reachable
- do not squeeze desktop columns
- maintain touch targets

---

## 13. Accessibility

Implement:
- keyboard-accessible tabs/actions
- correct tab semantics
- visible focus state
- accessible labels
- logical heading hierarchy
- reduced-motion support

---

## 14. No redesign

Do not introduce:
- alternate page shell
- different sidebar
- new typography
- extra KPI charts
- AI-oriented labels
- recruiting/ATS workflows
- decorative motion
- new card language

Worker Profile should remain operational, calm, premium, and consistent with Chelth.
