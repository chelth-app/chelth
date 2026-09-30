# Attendance Evidence Retention

Status: P0-E6-S2. Closes P0-E6-S1 finding F5. Companion to
[ATTENDANCE_LOCATION_PRIVACY.md](ATTENDANCE_LOCATION_PRIVACY.md).

> **Legal review required before production.** The default below is a
> conservative engineering default, not legal advice. Each agency's retention
> period must be confirmed against the applicable jurisdiction(s), employment
> and privacy law, and customer contracts before geofencing is used with real
> workers.

## 1. What is retained, and for how long

| Data                                                          | Retention                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| Raw coordinates (latitude, longitude) and device capture time | Agency setting, **default 90 days**, bounds 7–365             |
| Location result (`inside`, `outside`, …) on the event         | With the attendance record                                    |
| Accuracy, distance-to-site and radius used                    | With the attendance record (a classification, not a location) |
| Attendance events, corrections, exceptions, timesheets        | With the attendance record                                    |

Changing the period (`set_location_evidence_retention`) needs
`attendance.manage_settings` (AAL2) and is audited with the new value.

## 2. Purge

`internal.run_location_evidence_purge()` runs daily at 03:17 UTC (pg_cron
`chelth-location-evidence-purge`) and is recorded in
`internal.scheduled_job_runs`.

- Selects evidence older than **its own agency's** retention period (a
  tenant's setting never affects another tenant), not already purged, whose
  attendance record has no active legal hold.
- Bounded: batches of 1000, at most 20 batches per run, `FOR UPDATE SKIP LOCKED`.
- Purging nulls `latitude`, `longitude` and `device_captured_at` and sets
  `purged_at`. This is the only update the evidence table accepts (trigger);
  rows are never deleted, and purged coordinates cannot be restored.
- Attendance events and their `geofence_result` are untouched.
- Idempotent: a second run purges nothing.
- Audited per agency as `attendance.location_purged` with a **count only**.

Privacy effect: after the retention period, nobody — including privileged
administrators — can see where a worker was; only whether the clock action
was inside the site area remains.

## 3. Legal hold

A narrow hold on one attendance record's evidence
(`attendance_evidence_legal_holds`):

- place: `place_location_evidence_hold(attendance, reason)`; release:
  `release_location_evidence_hold(hold)` — both `attendance.location.view`
  (AAL2);
- one active hold per record; holds are never deleted, only released;
- the reason (3–300 characters) is stored with the hold, readable only by
  raw-evidence holders, and **never** written to audit metadata;
- a held record is skipped by the purge; after release it follows the policy.

This is not a records-management platform: there is no case management,
bulk hold or custodian workflow.

## 4. Tests

pgTAP 200 (R, S, T): purge keeps events and results, holds prevent purge,
retention is per tenant, idempotent, audited as counts, no restore/edit.
Integration: purge and hold through the API.
