# Attendance Location Privacy

Status: P0-E6-S1. Chelth checks location only to confirm presence at the
moment a worker clocks, and only where the agency has enabled a geofence for
that facility location. It never tracks workers.

## Rules (enforced)

1. **No continuous tracking.** The app calls `getCurrentPosition` once per
   clock action; there is no `watchPosition`, polling, background location,
   service-worker location, route history or live map.
2. **Explain before asking.** When a location is required, the worker first
   sees why ("{Facility} checks that you are on site when you clock in. Chelth
   uses your location only for this attendance action and does not track
   you.") and chooses "Share location and clock in" or "Not now". The browser
   prompt appears only after that choice.
3. **Collect only where needed.** Coordinates are accepted and stored only
   when the shift's location has an enabled geofence. Otherwise they are
   ignored and nothing is written.
4. **Server decides.** Inside/outside is computed in the database from the
   reading and the site configuration; the client result is never trusted.
5. **Restricted storage.** Raw coordinates live only in
   `attendance_location_evidence` (append-only), readable only with
   `attendance.location.view` — a privileged capability (AAL2) held by the
   agency admin by default. Access is through
   `list_attendance_location_evidence`, and every read is audited
   (`attendance.location_viewed`).
6. **Results, not coordinates.** Everyone else — reviewers, schedulers,
   facilities, the worker's own history, notifications — sees only a result
   label (Inside site area, Outside site area, Location too imprecise,
   Location unavailable, Not required).
7. **Never in audit, logs or notifications.** Audit metadata carries event
   type and result code only (tested). Emails contain no location data or
   refusal reason detail. Server actions do not log input.
8. **Facilities never see coordinates.** The facility projection returns the
   result code only; facilities have no RLS path to evidence or geofences.
9. **Not surveillance evidence.** Location results create exceptions for
   human review. They are not proof of presence (readings can be spoofed or
   imprecise) and outside results are worded "appear to be outside".

## Retention

Evidence is retained with the attendance record. A retention and deletion
schedule (with legal hold) is a deferred item and must be decided before
production use in each jurisdiction.

## Tests

pgTAP 170/180: no coordinates stored without a geofence; evidence invisible
to reviewers without `attendance.location.view` and to facilities/workers;
evidence reads need AAL2 and are audited; audit metadata has no coordinates.
E2E Flow 3 (explanation before prompt) and Flow 5 (no coordinates on the
facility page).

## Retention and the evidence viewer (P0-E6-S2)

- Raw coordinates are **temporary**: purged after the agency's retention
  period (default 90 days, 7–365) unless under legal hold. The result
  classification stays. Legal review of the period is required before
  production. See [ATTENDANCE_EVIDENCE_RETENTION.md](ATTENDANCE_EVIDENCE_RETENTION.md).
- The raw evidence viewer (`/attendance/[id]/evidence`) is available only to
  `attendance.location.view` holders (agency admin by default) after MFA
  step-up; every view is audited. It is labelled as device-reported evidence
  that is **not proof of presence**, shows per clock action the result,
  server and device times, accuracy, distance, radius and — while retained —
  coordinates. Facilities never reach it.
- Breaks never request a location.
- Timesheets, approval snapshots, facility sign-offs and timesheet
  notifications carry no coordinates.
