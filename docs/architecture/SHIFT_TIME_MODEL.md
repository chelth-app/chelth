# Shift Time Model

Status: P0-E5-S1.

## 1. Source of truth

- `start_at`, `end_at`: **timestamptz** (canonical UTC instants).
- `timezone`: the facility location's IANA zone, captured when the shift is
  scheduled and trigger-checked to equal the location's zone.
- No local datetime strings are stored.

## 2. Input

Commands take the **wall-clock** date and times in the location's timezone:
`(shift_date, start_time, end_time)`. The server converts
(`internal.shift_period`):

- `start_at = (shift_date + start_time) AT TIME ZONE tz`
- if `end_time <= start_time` the shift ends on the next day (overnight);
  equal times mean a 24-hour shift.
- A local time that does not exist (inside a DST spring-forward gap, e.g.
  02:30 on 2030-03-10 in New York) is **rejected** (`CH400`).
- An ambiguous local time (DST fall-back hour) resolves to the later,
  standard-time instant (PostgreSQL semantics).

The facility is the authority for the timezone — the browser's timezone is
never used.

## 3. Constraints

- `end_at > start_at`.
- `end_at - start_at <= 25 hours`: the input model allows at most a 24-hour
  wall-clock shift, which lasts 25 elapsed hours across a fall-back. Longer
  engagements are modelled as multiple shifts. This is the only duration cap.
- Durations are elapsed time: 19:00–07:00 is 13 h across fall-back, 11 h
  across spring-forward (tested).

## 4. Compliance date semantics

`internal.shift_local_dates(start_at, end_at, tz)` returns every local
calendar date the shift touches: the start date and the date of its last
instant (a shift ending exactly at 00:00 belongs to the previous day). The
compliance engine is evaluated **on each of those dates** and the assignment
requires `ready` on all of them. A credential valid through 14 Nov does not
cover a 14 Nov 19:00 → 15 Nov 07:00 shift.

## 5. Display

Always in the shift's timezone with its abbreviation, e.g.
`7:00 PM – 7:00 AM (+1 day) EDT` (`formatShiftTimeRange`). Filters on the
agency list use the shift's local start date.

## 6. Tests

pgTAP (110): UTC conversion, facility timezone (New York vs Chicago),
overnight, DST fall-back and spring-forward durations, non-existent local time,
24-hour shift, local-date sets. pgTAP (120): back-to-back allowed, one-minute
overlap refused, credential expiring before a future shift date. Unit tests:
display formatting, DST durations, midnight end. Integration: future expiry,
back-to-back across agencies. E2E: overnight display "(+1 day)".
