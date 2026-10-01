# Rounding Policy

Status: P0-E7-S1.

- **Default: no rounding.** Nothing is rounded unless the agency activates a
  policy.
- Versioned, agency-wide: `rounding_policy_versions` (`none` or `nearest`
  with an increment of **5, 6, 10 or 15** minutes), `effective_from`,
  `draft → active | discarded`, active versions frozen. The active version
  with the latest start on or before the **work date** applies. At most one
  active version per start date.
- **Scope: per timesheet entry**, after the entry's effective worked minutes
  are established. `raw_minutes` and `priced_minutes` are both stored.
  Attendance and timesheet minutes are never changed.
- **Method: half up** — `round_half_up(raw / N) × N`. With 10 minutes, 455 →
  460; with 15 minutes, 453 → 450.
- The same priced minutes are used for pay and bill in this stage; separate
  pay/bill rounding would be a new policy dimension.
- Overnight shifts are one entry; rounding applies to the entry as a whole.
