# Chelth Attendance / Geofence Flow

## Purpose

Chelth should verify attendance using location at key attendance events.

## Core events

- Check In
- Check Out

Optional future scope:
- Break Start
- Break End

## Recommended policy

1. Facility stores one or more approved coordinates and a configurable radius.
2. Worker taps `Check In`.
3. App requests / uses location permission.
4. App captures location and accuracy.
5. Backend compares worker location against allowed geofence.
6. Result is stored with the attendance event.

## Result states

### Success
Worker is within allowed radius and attendance is recorded.

### Weak GPS
Location accuracy is too weak to confidently verify attendance.

Suggested UX:
`We couldn't verify your location accurately. Try again or request supervisor verification.`

### Outside geofence
Worker is outside the permitted radius.

Suggested UX:
`You appear to be outside the facility check-in area.`

Where policy allows, offer:
`Request Supervisor Approval`

### Permission denied
Worker has not granted location access.

Suggested UX:
`Chelth needs your location to verify facility check-in.`

## Data to capture

- worker_id
- shift_id
- facility_id
- event_type
- timestamp
- latitude
- longitude
- location_accuracy
- geofence_result
- distance_from_facility
- override_status
- override_reason
- approved_by
- source/device metadata if supported

## Timesheet connection

Verified attendance should prefill timesheet times where possible.

Do not require the worker to re-enter time already captured by attendance unless correction is needed.
