# Attendance Segments and Breaks

Status: P0-E6-S2. Extends [ATTENDANCE_EVENT_MODEL.md](ATTENDANCE_EVENT_MODEL.md).

## 1. Model

One work span per assignment (clock-in … clock-out, segment 1) containing
zero or more recorded breaks. A break is a pair of events sharing a
**segment number** = the break number (1, 2, … ≤ 20):

```
clock_in(1) → break_start(1) → break_end(1) → break_start(2) → break_end(2) → clock_out(1)
```

Event types: `break_start`, `break_end`, and corrected variants
`corrected_break_start`, `corrected_break_end`. Unique indexes allow one
device `break_start` and one `break_end` per segment. Clock events are
constrained to segment 1. Nothing is ever edited: a wrong break time is
fixed by appending a corrected event.

## 2. States

`not_started → clocked_in ⇄ on_break → clocked_out`

| Command                  | Allowed from | Otherwise                                                                 |
| ------------------------ | ------------ | ------------------------------------------------------------------------- |
| `start_break_assignment` | `clocked_in` | `CHT19` already on a break · `CHT10` not clocked in · `CHT11` clocked out |
| `end_break_assignment`   | `on_break`   | `CHT20` not on a break                                                    |
| `clock_out_assignment`   | `clocked_in` | `CHT21` end your break first                                              |

Break commands take no time and no location: the server records its own
time and never asks for coordinates. Only the worker (own assignment, live
membership) can start or end their break.

## 3. Rules not automated

No jurisdictional break law (minimum breaks, paid/unpaid meal periods) is
applied. Chelth records actual breaks; policy engines are a later stage.

## 4. Corrections

Workers and reviewers can correct a break time by event type and break
number. A new break can be added by a reviewer adjustment (start, then end)
or by worker requests (start first). Approval re-runs the calculation and is
refused if breaks would overlap, precede clock-in or follow clock-out.
