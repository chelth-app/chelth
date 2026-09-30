# Attendance Event Model

Status: P0-E6-S1. See [ATTENDANCE_DOMAIN_MODEL.md](ATTENDANCE_DOMAIN_MODEL.md).

## 1. Events are the source of truth

`public.attendance_events` is append-only (trigger refuses UPDATE, DELETE and
TRUNCATE for every role). The attendance summary is a projection rebuilt from
events by `internal.refresh_attendance`; nothing edits a recorded time.

| Column             | Meaning                                                                                |
| ------------------ | -------------------------------------------------------------------------------------- |
| `event_type`       | `clock_in`, `clock_out`, `corrected_clock_in`, `corrected_clock_out`                   |
| `occurred_at`      | When it happened. For device events = `recorded_at`. For corrections = approved time.  |
| `recorded_at`      | Database time the row was written (`now()`), never client-supplied.                    |
| `source`           | `worker_device` or `approved_correction`                                               |
| `correction_id`    | Required iff source is `approved_correction` (composite FK to the same attendance)     |
| `geofence_result`  | `not_required`, `inside`, `outside`, `low_accuracy`, `unavailable` — never coordinates |
| `segment`          | Work segment (1 today; reserved for split shifts)                                      |
| `sequence`         | Monotonic order within the table                                                       |
| `actor_profile_id` | Worker (device) or reviewer (correction)                                               |

Constraints:

- device events: `occurred_at = recorded_at` (server time only);
- `source = approved_correction ⇔ event_type is corrected_* ⇔ correction_id is not null`;
- at most one `clock_in` and one `clock_out` per (attendance, segment) — unique indexes; a second attempt fails with `CHT09`/`CHT11` before insert;
- composite FKs `(attendance_id, assignment_id)` and `(attendance_id, agency_organisation_id)`.

## 2. Server-authoritative time

The client never sends an event time. `p_device_captured_at` (from the browser
geolocation reading) is stored only as location evidence, for investigating
stale readings; it never influences timing rules. All timing comparisons use
`now()` against the shift's `start_at`/`end_at` (UTC instants derived from the
facility timezone, [SHIFT_TIME_MODEL.md](SHIFT_TIME_MODEL.md)). Display always
uses the shift's own timezone (`formatLocalClockTime`), never the viewer's.

## 3. Corrections append

Approving a correction appends `corrected_clock_in` / `corrected_clock_out`
with `occurred_at` = the requested (approved) time. The original device event
stays. The projection uses the **latest** corrected event, else the device
event. Rejection appends nothing.

## 4. Reading

- Agency `attendance.view` and the worker (own, live membership) may SELECT
  events; facilities cannot (they use the narrow projection).
- Writes only through `SECURITY DEFINER` RPCs; `authenticated` has SELECT only.

## 5. Breaks and corrected variants (P0-E6-S2)

- New event types: `break_start`, `break_end`, `corrected_break_start`,
  `corrected_break_end`. Break events use `segment` = break number; clock
  events are constrained to segment 1.
- Device events of all four device types have `occurred_at = recorded_at`.
- `source = approved_correction` ⇔ the event type is any `corrected_*`.
- One device `break_start` and one `break_end` per (attendance, segment).
- Effective time per (type, segment): latest corrected event, else device
  event (`internal.effective_event_time`).
- Reviewer-originated adjustments are stored as approved corrections and
  appended as corrected events like any other approval; the original event
  always remains.
