# Chelth Worker Mobile — Interaction Specification

## Status

**P0-E8-S7 My Shifts / Worker Mobile: LOCKED**

This is the canonical worker mobile flow visual.  
Do not redesign the visual language, logo treatment, backdrop style, or page hierarchy.

---

## 1. Flow structure

The worker mobile sequence is:

1. `My Shifts`
2. `Shift Details`
3. `Check-In / Check-Out`
4. `Timesheet Handoff`

This should feel like one connected operational journey, not four unrelated screens.

---

## 2. My Shifts

The worker should be able to quickly answer:
- what is my next shift?
- where am I going?
- when do I start?
- what else is coming up?

### Tabs
Use:
- `Today`
- `Upcoming`
- `Past`

Changing tabs updates the visible shifts without leaving the page.

### Next Shift
The primary card should open the selected shift detail.

### Upcoming shifts
Each list item opens that shift's detail view.

### Bottom navigation
Use the canonical worker-mobile navigation pattern.
Expected destinations may include:
- Home
- Shifts
- Timesheets
- More

Do not invent a separate desktop-style nav for worker mobile.

---

## 3. Shift Details

This screen contains the selected shift's operational details, including:
- facility name
- location
- date/time
- role
- unit
- facility contact
- map / route context
- parking / arrival notes if available
- readiness / requirements
- primary attendance action

### Facility contact
Tapping the facility contact call icon should open the supported contact flow.

### Map / directions
The map area should open directions or a facility-location view supported by the mobile product.

### Requirements
Only show real requirements relevant to the shift / worker.

### Check In
The primary CTA enters the attendance verification flow.

---

## 4. Attendance / geofenced check-in

Chelth should capture attendance at important events only:
- check-in
- check-out
- optionally break events later if product scope requires it

Do not perform continuous background location tracking by default.

### Check-in flow
When the worker taps `Check In`:
1. request location permission if needed;
2. capture device latitude/longitude, accuracy, timestamp, worker, shift, facility;
3. compare against the facility geofence;
4. if inside policy radius, record a successful check-in;
5. if outside or accuracy is too weak, show the relevant exception path.

### Geofence states
Support:
- location permission required
- checking location
- within facility radius
- weak/inaccurate GPS
- outside geofence
- supervisor override request if the tenant policy allows it
- successful check-in

The visual reference shows a success state.
Actual implementation must support the exception cases too.

### Check-out
The `Check Out` action should capture:
- time
- location
- geofence result
- worker / shift / facility context

The same location-verification principles apply.

---

## 5. Timesheet handoff

After check-in and check-out are recorded, the worker should not manually re-enter the same time if attendance is already verified.

The timesheet should be prefilled from attendance where supported.

### Expected fields
- check-in time
- check-out time
- total hours
- break (unpaid)
- worked hours
- notes (optional)

### Submit Timesheet
Submitting should send the timesheet into the canonical review/approval path.

Do not create a disconnected timesheet system just for mobile.

---

## 6. Data relationships

The worker-mobile flow should integrate with:
- Shifts
- Attendance
- Timesheets
- Worker Profile
- Notifications
- facility contact/directions behavior if available

Avoid duplicating business rules across modules.

---

## 7. Privacy / location rules

Location capture should be limited and purposeful.

Capture at the attendance event itself, not continuous tracking by default.

Attendance event records should preserve:
- worker id
- shift id
- facility id
- timestamp
- latitude / longitude
- location accuracy
- geofence result
- override state if any
- source/device context where needed

---

## 8. Responsive / shell rules

This is already a mobile-first experience.

Keep:
- Chelth logo / identity style
- typography hierarchy
- rounded-card language
- teal/navy/off-white palette
- calm healthcare-operational tone

Do not redesign it into a consumer wellness app or a generic HR mobile app.

---

## 9. Accessibility

Implement:
- large touch targets
- clear state labels
- visible focus states where relevant
- semantic controls
- reduced-motion support
- readable contrast
- accessible form and status text

---

## 10. No redesign

Do not change:
- the approved Chelth logo direction
- the overall backdrop language
- the typography feel
- the step hierarchy
- the card and button styling
- the worker-mobile operational tone
