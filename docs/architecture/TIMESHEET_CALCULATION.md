# Timesheet Calculation

Status: P0-E6-S2. Calculation version **1**.

One function computes worked time: `internal.effective_time(attendance_id)`.
The attendance projection, the worker's My Shifts view and every timesheet
entry call it. No UI or RPC repeats the arithmetic.

## 1. Effective instants

For each time — clock-in, clock-out, break _n_ start, break _n_ end — the
latest `corrected_*` event for that segment wins, otherwise the device
event. Device events carry server time only. See
[ATTENDANCE_SEGMENTS_AND_BREAKS.md](ATTENDANCE_SEGMENTS_AND_BREAKS.md).

## 2. Minutes

All arithmetic is on UTC instants (`timestamptz`); timezones and DST affect
only display.

```
whole_minutes(a, b) = floor(epoch(b) / 60) − floor(epoch(a) / 60)
break_minutes       = Σ whole_minutes(break_start_n, break_end_n)   (complete breaks)
worked_minutes      = max(0, whole_minutes(clock_in, clock_out) − break_minutes)
```

Truncating both ends to the minute on the epoch is symmetric and immune to
odd UTC offsets. Payroll rounding rules (e.g. 6- or 15-minute increments) are
a later-stage policy applied to locked snapshots, not here.

## 3. Completeness and reasons

| Situation                                                                          | Result                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| No effective clock-in, missed clock-in closed "not worked"                         | complete, 0 minutes, `not_worked`                |
| No effective clock-in                                                              | `MISSING_CLOCK_IN`, no minutes                   |
| Clocked in, no effective clock-out                                                 | `MISSING_CLOCK_OUT`, no minutes (never invented) |
| A break without an end                                                             | `BREAK_NOT_ENDED`                                |
| Out-of-order times (end before start, overlapping breaks, break outside the shift) | `TIMES_INCONSISTENT`                             |

Scheduled duration is never used as worked time. Corrections that would make
times inconsistent are refused at approval (`CHT16`) and roll back.

## 4. Worked examples (tested)

| Case                                                     |           Worked |
| -------------------------------------------------------- | ---------------: |
| 09:02–17:05 with a 12:00–12:30 break                     |              453 |
| 08:55–13:00 (early clock-in counts from the actual time) |              245 |
| Overnight 22:00–06:00                                    |              480 |
| DST fall-back night, 8 wall-clock hours                  |              540 |
| DST spring-forward night, 8 wall-clock hours             |              420 |
| Correction moves clock-out 17:05 → 17:35 after lock      | 483 (revision 2) |
| Reviewer adds a 30-minute break to a 450-minute shift    |              420 |
| No-show closed as not worked                             |                0 |

## 5. Snapshots

An agency approval stores, per included entry: ids, local date, timezone,
scheduled and effective times, breaks, break/worked minutes, not-worked flag,
exception types and approved correction ids, plus totals and the calculation
version. Never coordinates or free-text notes.
