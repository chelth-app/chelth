# Assignment Readiness Monitoring

Status: P0-E5-S2.

## 1. Why

Eligibility changes after assignment: credentials expire or are revoked,
verifications change, shares are withdrawn, documents lose trust, workers or
memberships are suspended, requirements change, relationships are suspended.
Chelth detects this before the shift, without anyone watching a dashboard.

## 2. Issue model (not an assignment status)

`public.assignment_issues`: assignment, shift, agency, `issue_type`
(`not_eligible` | `relationship_not_active`), severity (`attention`, or
`urgent` when the assignment is accepted or the shift starts within 48 h),
block reason codes, compliance reason codes, `detected_by`
(`scheduled_scan` | `manual_recheck` | `relationship_change`), `opened_at`,
`last_evaluated_at`, `resolved_at` + `resolution`. One open issue per
(assignment, type); resolved issues are immutable; nothing is deleted. Codes
only — never compliance evidence. Readable only with `assignment.view` AND
`compliance.view`, agency only.

## 3. Evaluation

`internal.evaluate_assignment_issues(assignment)` calls the canonical
`internal.assignment_eligibility` (no duplicated rules):

| Result                            | Action                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| eligible, no issue                | nothing                                                                                                   |
| not eligible, no open issue       | open issue · audit `assignment.issue_opened` · notify agency operations once (`assignment_non_compliant`) |
| still not eligible                | refresh reasons and `last_evaluated_at` (severity may escalate)                                           |
| eligible again                    | resolve (`eligible_again`) · audit `assignment.issue_resolved`                                            |
| assignment/shift no longer active | resolve (`assignment_closed` / `shift_closed`)                                                            |

## 4. Policy

- READY → no action.
- Not ready, **assigned** (not yet accepted) → issue + agency notification;
  the worker **cannot accept** (acceptance re-runs the gate).
- Not ready, **accepted** → assignment preserved, issue marked **urgent** for
  the agency to act (replace, cancel with reason `compliance_change`, or
  resolve the gap).
- Chelth never silently cancels an assignment because compliance changed.

## 5. Scheduling

`internal.run_assignment_readiness_scan(within?)` — pg_cron hourly
(`chelth-readiness-scan`). Scans active assignments on open shifts that have
not ended and start within the horizon (`internal.operations_settings.
readiness_horizon`, default 14 days, configurable 1 h – 60 days), plus any
assignment with an open issue. Bounded (20 000 rows per run), idempotent
(re-running opens nothing new), recorded in `internal.scheduled_job_runs`.
`public.recheck_shift_readiness(shift)` runs the same evaluation on demand
("Re-check readiness", `assignment.manage` + `compliance.view`, audited
`assignment.readiness_rechecked`). The P0-E5-S1 hook
`internal.scan_assignment_readiness` now delegates to the scan.

## 6. Surfaces

- Shift page: "Needs attention: …" badge per assignment with reasons; live
  readiness; re-check button.
- `/operations`: all open issues (urgent first), affected work under inactive
  relationships, undelivered notifications.
- Shift list: "Needs attention (n)" badge.
