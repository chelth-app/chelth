# Chelth Attendance — Geofence Integration

## Source event

Worker mobile creates attendance events from:
- Check In
- Check Out

## Recommended attendance-event data

- worker_id
- shift_id
- facility_id
- event_type
- event_timestamp
- latitude
- longitude
- location_accuracy
- distance_from_facility
- geofence_result
- device_source
- override_status
- override_reason
- approved_by
- approved_at
- resolved_by
- resolved_at

## Important rule

Never overwrite the original location/geofence evidence when an override is approved.

Store the operational decision separately.

## Verification states

Examples:
- verified_in_radius
- outside_geofence
- weak_accuracy
- location_unavailable
- override_requested
- override_approved
- resolved

Use names consistent with the actual schema.

## Facility policy

Geofence radius should be configurable per tenant/facility if supported.

Large campuses may require:
- larger radius
- multiple approved points
- facility-specific configuration

## Privacy

Use location only for legitimate attendance verification.

Do not introduce continuous worker tracking by default.
