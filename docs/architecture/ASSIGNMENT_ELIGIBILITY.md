# Assignment Eligibility

Status: P0-E5-S1.

> Can this exact person be assigned to this exact facility for this exact
> shift date, without violating compliance, tenancy, capacity or schedule
> constraints?

Answered by ONE function, `internal.assignment_eligibility(shift, worker)`,
used by assignment, acceptance, the candidate list, re-evaluation and the
facility readiness indicator. The UI is never the boundary.

## 1. Checks

| Order | Code (`assignment_block_reason`) | Rule                                                                 |
| ----- | -------------------------------- | -------------------------------------------------------------------- |
| —     | tenancy (raises `CHW04`)         | the worker record belongs to the shift's agency                      |
| —     | state (raises `CHS09`/`CHS10`)   | shift open and not ended; relationship active                        |
| 1     | `ASSIGNMENT_ALREADY_EXISTS`      | no active assignment of this worker on this shift                    |
| 2     | `SHIFT_FULL`                     | active assignments < requested headcount                             |
| 3     | `WORKER_NOT_ACTIVE`              | worker record active AND membership active                           |
| 4     | `DISCIPLINE_MISMATCH`            | the worker holds the shift's discipline                              |
| 5     | `WORKER_NOT_ELIGIBLE`            | compliance readiness = `ready` on every local shift date             |
| 6     | `WORKER_SCHEDULE_CONFLICT`       | no overlapping active assignment for the same **person**, any agency |

All applicable codes are returned; the first is the primary code. The
server maps each code to a structured error (`SHIFT_FULL`, `WORKER_NOT_ELIGIBLE`, …).

## 2. Compliance gate

`internal.evaluate_compliance(worker, shift facility, date, shift discipline)`
— the P0-E4-S1 engine, now discipline-scoped (requirements with no discipline
or the shift's discipline). It covers agency baseline and facility
requirements, sharing, verification by THIS agency, document trust, expiry on
the date, minimum validity and jurisdiction. No credential logic is duplicated
in assignment code.

**Policy: assignment requires `ready`.** `action_required` (e.g.
`EXPIRING_SOON` inside a requirement's warning window on the shift date)
**blocks**. Rationale: a warning means the agency's own rule says the
credential is too close to expiry for the shift date; scheduling against it
silently would defeat the rule. Agencies tune this per requirement
(`expiry_warning_days`, 0 disables the warning).

## 3. Decision record (not a flag)

`assignment_eligibility_decisions` — append-only, one row per attempt:
outcome, block reasons, readiness, compliance reason codes, findings
(`{scope, credential_type_key, reason, severity, evaluation_date,
effective_expiry_date}`), evaluation dates, engine version, actor, time. No
credential numbers, documents, or anything about another agency. It proves why
a decision was made; it never replaces live evaluation.

Refusals are **returned, not raised**, so the decision and its audit event
commit. Authorization/tenancy/state failures raise and record nothing.

## 4. Re-evaluation

Eligibility can change after assignment (expiry, revoked share, verification,
requirement change, worker suspension, relationship suspension).

- `list_assignment_readiness(org, shift?, from?, until?)` — live readiness of
  active assignments (`assignment.view` + `compliance.view`); the shift page
  flags "No longer eligible" with reasons.
- `accept_shift_assignment` re-checks before accepting.
- `internal.scan_assignment_readiness(within)` — enqueues one
  `assignment_non_compliant` outbox row per affected upcoming assignment; to be
  scheduled by a later stage (pg_cron / Edge Function). No scheduler is built now.

## 5. Candidates

`list_shift_candidates(shift)` (`assignment.manage` + `compliance.view`):
every non-terminated, not-already-assigned worker with `assignable`, block
reasons, readiness and findings. Ordered alphabetically — **no ranking, no
scoring, no recommendation**. The UI shows eligible workers by default and
unavailable workers (with plain-language reasons) behind a disclosure.

## 6. Privacy of conflicts

A conflict is reported as `WORKER_SCHEDULE_CONFLICT` / "Worker has a
scheduling conflict" only. Neither the result, the decision row nor the audit
metadata carries the other agency, facility, times or ids (pgTAP N,
integration). The candidate list's conflict flag reveals the same single bit.
