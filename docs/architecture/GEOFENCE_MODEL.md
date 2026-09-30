# Geofence Model

Status: P0-E6-S1. Privacy rules:
[../security/ATTENDANCE_LOCATION_PRIVACY.md](../security/ATTENDANCE_LOCATION_PRIVACY.md).

## 1. Configuration

`public.location_geofences`, at most one per facility location (composite FKs
to the location, facility and agency). Optional: a location without an enabled
geofence never asks for or stores a location.

| Field                 | Bounds                        | Meaning                                            |
| --------------------- | ----------------------------- | -------------------------------------------------- |
| `enabled`             |                               | Off ⇒ result `not_required`                        |
| `latitude/longitude`  | ±90 / ±180                    | Site centre (the facility, not a person)           |
| `radius_meters`       | 50–2000                       | Inside when distance ≤ radius                      |
| `max_accuracy_meters` | 10–500 (default 100)          | Readings less precise than this are `low_accuracy` |
| `outside_policy`      | `block` / `allow_with_review` | What happens outside at clock-in                   |

Set by `set_location_geofence` (`attendance.manage_settings`, AAL2). Audit
records enabled, radius and policy, never the coordinates. Readable by agency
`facility.view`; facilities and workers cannot read it.

## 2. Validation (server-side only)

`internal.check_geofence(location, lat, lon, accuracy)`:

1. No enabled geofence ⇒ `not_required` (coordinates ignored, not stored).
2. Invalid input (one of lat/lon missing, out of range, accuracy < 0 or > 100 km) ⇒ `CH400`.
3. No coordinates ⇒ `unavailable`.
4. Distance: haversine, mean Earth radius 6 371 008.8 m (`internal.distance_meters`).
5. Accuracy missing or > `max_accuracy_meters` ⇒ `low_accuracy`.
6. Distance ≤ radius ⇒ `inside`, else `outside`.

The client **never** declares inside/outside; it sends a single reading it
obtained after the worker chose to share it.

## 3. Policy

| Result         | Clock-in, `block`                                 | Clock-in, `allow_with_review`           | Clock-out (any policy) |
| -------------- | ------------------------------------------------- | --------------------------------------- | ---------------------- |
| `inside`       | recorded                                          | recorded                                | recorded               |
| `outside`      | **refused** (committed exception + agency notice) | recorded + `outside_geofence` exception | recorded + exception   |
| `low_accuracy` | `CHT14` (try again)                               | recorded + `poor_location_accuracy`     | recorded + exception   |
| `unavailable`  | `CHT12` (location required)                       | recorded + `location_unavailable`       | recorded + exception   |

Clock-out is never blocked: a worker must always be able to leave.

## 4. Tested edges

199.5 m inside / 200.5 m outside a 200 m fence; 1000 m along a meridian exact
to 1 cm; accuracy worse than configured ⇒ `low_accuracy` at the centre;
geofences are location-scoped; invalid coordinates and absurd accuracy are
rejected as input errors.

## 5. Limits

A browser location can be spoofed by a determined user. The geofence is an
operational signal that raises exceptions for human review; it is not proof
of presence and must not be used as sole evidence for disciplinary action.
