# Geofence Model

Status: P0-E6-S1; P0-E9-3E fail-closed; P0-E9-3E.1 agency policy and readiness. Privacy rules:
[../security/ATTENDANCE_LOCATION_PRIVACY.md](../security/ATTENDANCE_LOCATION_PRIVACY.md).

## 1. Configuration

`public.location_geofences`, at most one per facility location (composite FKs
to the location, facility and agency). Optional: a location without an enabled
geofence never asks for or stores a location.

| Field                 | Bounds                                  | Meaning                                            |
| --------------------- | --------------------------------------- | -------------------------------------------------- |
| `enabled`             |                                         | Off ⇒ result `not_required`                        |
| `latitude/longitude`  | ±90 / ±180                              | Site centre (the facility, not a person)           |
| `radius_meters`       | 50–2000                                 | Inside when distance ≤ radius                      |
| `max_accuracy_meters` | 10–500 (default 100)                    | Readings less precise than this are `low_accuracy` |
| `outside_policy`      | `block` (default) / `allow_with_review` | What a PRECISE outside reading does at clock-in    |

Set by `set_location_geofence` (`attendance.manage_settings`, AAL2). Audit
records enabled, radius and policy, never the coordinates. Readable by agency
`facility.view`; facilities and workers cannot read it.

## 2. Validation (server-side only)

`internal.check_geofence(location, lat, lon, accuracy)`:

1. No enabled geofence ⇒ `not_required` (coordinates ignored, not stored).
2. Invalid input (one of lat/lon missing, out of range, accuracy < 0 or > 100 km) ⇒ `CH400`.
3. No coordinates ⇒ `unavailable`.
4. Distance: haversine, mean Earth radius 6 371 008.8 m (`internal.distance_meters`).
5. Accuracy missing or > `least(max_accuracy_meters, radius_meters)` ⇒ `low_accuracy`
   (P0-E9-3E: a reading less precise than the fence itself cannot place anyone inside it).
6. Distance ≤ radius ⇒ `inside` (the boundary is inside), else `outside`.

Clock-in also requires the reading to be current: the device capture time
must be within 5 minutes before / 2 minutes after the server clock, else
`CHT13` (a stale or cached fix is refused).

The client **never** declares inside/outside; it sends a single reading it
obtained after the worker chose to share it.

## 3. Policy

P0-E9-3E: **UNKNOWN ≠ INSIDE.** Missing, stale or imprecise evidence is
refused at clock-in under every policy; nothing is recorded.

| Result         | Clock-in, `block` (default)                       | Clock-in, `allow_with_review`           | Clock-out (any policy) |
| -------------- | ------------------------------------------------- | --------------------------------------- | ---------------------- |
| `inside`       | recorded                                          | recorded                                | recorded               |
| `outside`      | **refused** (committed exception + agency notice) | recorded + `outside_geofence` exception | recorded + exception   |
| stale reading  | `CHT13` (try again)                               | `CHT13` (try again)                     | recorded               |
| `low_accuracy` | `CHT14` (try again)                               | `CHT14` (try again)                     | recorded + exception   |
| `unavailable`  | `CHT12` (location required)                       | `CHT12` (location required)             | recorded + exception   |

A location WITHOUT an enabled geofence does not check location at all
(`not_required`): clock-in is recorded on server time without a reading. To
enforce location at a site, an agency must configure and enable its
geofence (Facility → Attendance location checks).

Clock-out is never blocked: a worker must always be able to leave.

## 3a. Agency policy: require geofencing (P0-E9-3E.1)

`agency_attendance_settings` carries the agency policy and defaults:

| Field                                  | Default | Meaning                                                   |
| -------------------------------------- | ------- | --------------------------------------------------------- |
| `require_geofence`                     | `false` | ON ⇒ clock-in needs a configured geofence at the location |
| `default_geofence_radius_meters`       | 150     | Prefills a new location geofence (50–2000)                |
| `default_geofence_max_accuracy_meters` | 100     | Prefills a new location geofence (10–500)                 |
| `default_geofence_outside_policy`      | `block` | Prefills a new location geofence                          |

The defaults never enforce attendance and never rewrite an existing location
geofence; check-in always uses the location's own row. Set by
`set_geofence_policy` (`attendance.manage_settings`, AAL2, audited with the
list of changed fields).

`internal.location_geofence_readiness(location)` is the single definition of
"configured": `ready` (enabled, valid, `block`), `not_blocking` (enabled,
valid, `allow_with_review`), `disabled`, `not_configured`, `invalid`.

When `require_geofence` is ON, `clock_in_assignment` refuses check-in with
`CHT23` (`GEOFENCE_NOT_CONFIGURED`: "Check-in isn't available because this
location hasn't been configured yet. Contact your agency.") unless the
location is `ready` or `not_blocking`. Nothing is recorded. **UNCONFIGURED ≠
NOT_REQUIRED** when the agency requires geofencing. When OFF, §3's
`not_required` behaviour is unchanged. Clock-out is never affected.

Pilot readiness (`list_geofence_readiness`, `facility.view`, no coordinates;
Settings → Attendance & Geofencing): READY only when geofencing is required and
every active location is `ready`.

## 4. Tested edges

199.5 m inside / 200.5 m outside a 200 m fence; 1000 m along a meridian exact
to 1 cm; accuracy worse than configured ⇒ `low_accuracy` at the centre;
geofences are location-scoped; invalid coordinates and absurd accuracy are
rejected as input errors.

## 5. Limits

A browser location can be spoofed by a determined user. The geofence is an
operational signal that raises exceptions for human review; it is not proof
of presence and must not be used as sole evidence for disciplinary action.
