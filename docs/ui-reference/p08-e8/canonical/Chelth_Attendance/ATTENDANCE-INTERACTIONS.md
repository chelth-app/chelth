# Chelth Attendance — Interaction Specification

## Status

**P0-E8-S8 Attendance: LOCKED**

Do not redesign the canonical Chelth app shell, page composition, or Attendance Details drawer.

---

## 1. Purpose

Attendance is the operational verification surface for worker check-in and check-out activity.

It connects:
- worker mobile attendance events
- shifts
- facilities
- geofence verification
- supervisor review
- timesheets

This is not a generic time clock.

---

## 2. KPI cards

The top cards should act as operational shortcuts.

### Checked In Now
Filter to workers currently checked in.

### Late / Missing Check-Ins
Filter to active shifts where the expected attendance event is late or missing.

### Geofence Issues
Filter to attendance records requiring location/geofence review.

### Completed Today
Filter to completed attendance records for the selected day.

Do not add decorative mini charts or sparklines.

---

## 3. Date and status filters

The date picker changes the active attendance date.

The status filter should support the statuses already present in the product, such as:
- Checked In
- Checked Out
- Late
- Missing
- Geofence Review
- Needs Review
- Verified

Filter state should survive drawer open/close.

---

## 4. Today's Attendance

Each row must be selectable.

Clicking a row should:
1. set the active attendance record;
2. open Attendance Details;
3. populate the drawer using that record's live data.

Relevant row information includes:
- event/check-in time
- worker
- facility
- shift
- attendance status
- geofence result

Do not hard-code screenshot records.

---

## 5. Attendance Exceptions

Exceptions represent attendance conditions requiring attention, including:
- outside geofence
- weak GPS
- late arrival
- missing check-in

Clicking an exception opens the corresponding Attendance Details record.

`View All` should show the complete exception list without changing the design system.

---

## 6. Attendance Details drawer

The drawer should show the selected record.

Relevant information includes:
- worker
- role
- facility
- linked shift
- check-in time
- check-out time
- shift duration
- attendance state
- geofence result
- distance from facility
- device/source
- location verification timestamp
- map/location evidence
- available actions

---

## 7. Drawer open / close

When open:
- keep the drawer in the locked right-side position;
- the main Attendance workspace uses the remaining width.

When closed:
- remove the reserved drawer column;
- expand the main Attendance workspace into the freed width;
- reflow the table/cards naturally;
- do not leave a blank right gutter;
- do not reload the page.

Selecting another record should reopen the drawer and load that record.

Desktop:
- Escape closes the drawer.

---

## 8. Geofence verification

Attendance must consume the geofence result created by the worker mobile check-in/out flow.

Potential states:
- within geofence
- outside geofence
- weak/inaccurate GPS
- location unavailable
- manual review
- override approved

Do not continuously track workers in the background by default.

---

## 9. Approve Override

`Approve Override` is a privileged operational action.

It should:
- require appropriate role/permission;
- record who approved it;
- record when it was approved;
- preserve the original geofence/location result;
- optionally require a reason according to tenant policy;
- write an audit event.

Approving an override must not erase the original evidence.

---

## 10. Message Worker

`Message Worker` opens the existing communication flow with the selected worker.

Reuse Chelth's communication infrastructure.

Do not create a separate attendance-only messaging system.

---

## 11. View Shift

`View Shift` opens the canonical Shifts workflow with the linked shift selected.

Preserve worker and facility context where practical.

---

## 12. Mark Resolved

`Mark Resolved` closes the operational exception without deleting the attendance record.

It should:
- preserve the original issue;
- preserve any override decision;
- record who resolved it;
- record a timestamp;
- update activity/audit history.

---

## 13. Check-In Verification panel

The reporting period selector changes the verification summary range.

The verification card should reflect live aggregate data.

Do not animate the chart unnecessarily.

---

## 14. Recent Attendance Activity

Each activity row may open the linked attendance/shift/worker context when available.

`View All Activity` opens the complete attendance activity history.

---

## 15. Timesheet integration

Attendance is a source for Timesheets.

Verified check-in/out events should be able to prefill:
- check-in
- check-out
- total duration
- break deduction where supported
- worked hours

Corrections must follow the actual product approval model.

Do not duplicate attendance truth in the timesheet layer.

---

## 16. Permissions and auditability

Sensitive actions should respect roles.

Examples:
- approve override
- resolve exception
- edit/correct attendance
- verify attendance manually

Important attendance changes should be auditable.

---

## 17. Accessibility

Implement:
- keyboard-accessible rows and controls
- visible focus states
- meaningful status text in addition to color
- semantic buttons
- accessible map/location summary
- reduced-motion support

---

## 18. No redesign

Do not change:
- canonical sidebar
- header
- typography
- spacing
- KPI-card language
- table styling
- status-chip styling
- drawer structure
- colors
- visual hierarchy
