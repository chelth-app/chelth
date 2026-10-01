# Compliance Engine

Status: P0-E4-S1. **The single source of eligibility for all later stages**
(shift offers, assignments and clock-in must call it, never re-implement it).

## 1. Interface

| Function                                                       | Returns                                                                                                                                                | Who may call                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `evaluate_worker_compliance(worker, facility?, as_of = today)` | one row per applicable requirement (+ worker-level rows): requirement, scope, credential type, **reason code**, severity, credential, effective expiry | the worker (live membership) or agency staff with `compliance.view` |
| `worker_readiness(worker, facility?, as_of = today)`           | `ready` / `action_required` / `not_eligible` + counts                                                                                                  | same                                                                |
| `list_shared_worker_compliance(relationship)`                  | readiness + reasons for workers explicitly shared with that relationship                                                                               | linked facility members with `credential.view`                      |

All three call one internal function, `internal.evaluate_compliance`, so the
agency, worker and facility always see the same answer. Nothing is stored.

`as_of` lets scheduling evaluate on the **shift date**, not today.

## 2. Inputs

worker status + membership status · worker disciplines · active requirements
(agency baseline + the facility's, effective on `as_of`, matching discipline)
· the person's credentials **shared with this agency** · their submitted
versions · document trust state · **this agency's** latest verification per
version (facility-scoped for facility-specific types) · dates.

## 3. Reason codes

| Code                    | Severity | Meaning                                                                          |
| ----------------------- | -------- | -------------------------------------------------------------------------------- |
| `MET`                   | ok       | requirement satisfied                                                            |
| `EXPIRING_SOON`         | warning  | satisfied, but expires within the requirement's warning window (default 30 days) |
| `MISSING_CREDENTIAL`    | blocking | the person holds no such credential                                              |
| `CREDENTIAL_NOT_SHARED` | blocking | held, but not shared with this agency                                            |
| `WRONG_JURISDICTION`    | blocking | held only in another jurisdiction                                                |
| `NOT_SUBMITTED`         | blocking | only drafts exist                                                                |
| `DOCUMENT_MISSING`      | blocking | type requires a document and none exists                                         |
| `DOCUMENT_NOT_CLEARED`  | blocking | documents exist but none has cleared scanning                                    |
| `UNVERIFIED_CREDENTIAL` | blocking | verification required and this agency has not verified this version              |
| `VERIFICATION_REJECTED` | blocking | this agency's latest decision is a rejection                                     |
| `EXPIRED_CREDENTIAL`    | blocking | effective expiry is before `as_of`                                               |
| `INSUFFICIENT_VALIDITY` | blocking | expires before `as_of + minimum_validity_days`                                   |
| `WORKER_NOT_ACTIVE`     | blocking | worker status is not `active`, or the membership is not active                   |
| `DISCIPLINE_NOT_SET`    | warning  | discipline-specific requirements exist but the worker has no discipline          |

Readiness: any blocking → `not_eligible`; else any warning →
`action_required`; else `ready`. (Safety first: a missing credential is
blocking, not merely "action required".)

## 4. Evaluation rules

- **Best candidate wins.** For each requirement every submitted version of
  every qualifying credential is ranked (MET 0, EXPIRING_SOON 1, UNVERIFIED 2,
  REJECTED 3, NOT_CLEARED 4, DOC_MISSING 5, INSUFFICIENT_VALIDITY 6, EXPIRED 7);
  the lowest rank is reported. A verified, valid version 1 keeps a worker
  compliant while the renewed version 2 awaits review.
- **Dates.** Effective expiry = `expiry_date`, or `issue_date + validity_months`.
  Valid _through_ the expiry date. Readiness views evaluate today's UTC date;
  assignment evaluates every LOCAL calendar date the shift touches in the
  location's timezone ([SHIFT_TIME_MODEL.md](SHIFT_TIME_MODEL.md)).
- **Verification is per agency, per version.** Agency B never inherits Agency
  A's decision. A renewal never inherits an old decision.
- **Latest decision** is by a monotonic sequence (timestamps can tie inside a
  transaction — a defect found and fixed during this stage).
- **Trust.** Unscanned documents never count, even if a reviewer tries to
  verify (verification of uncleared evidence is refused).
- `must_be_verified` is forced on when the credential type requires verification.

## 5. Notification hooks (not built)

`internal.credential_versions_expiring(days, as_of)` returns versions whose
effective expiry falls in a window. A notifications stage will consume it
(and the audit events `credential.rejected`, `credential.verified`) to send:
expiry approaching, expired, verification rejected, renewal needed. Delivery
will use the transactional email architecture; payloads carry no numbers or
documents.

## 6. Performance

Evaluation loops over requirements × candidate versions for one worker —
small numbers. Bulk use (rota planning across hundreds of workers) will add a
set-based variant; the reason-code contract stays the same.

## 7. Discipline scope and assignment use (P0-E5-S1)

`internal.evaluate_compliance(worker, facility, as_of, discipline)` is the
discipline-scoped form: with a discipline it applies only requirements with no
discipline or that discipline, and does not emit `DISCIPLINE_NOT_SET` (the
assignment gate checks the discipline itself). The 3-argument form now
delegates with `NULL` (all of the worker's disciplines), so there is still one
implementation. The assignment boundary requires `ready` on every local shift
date and records the reasons in an append-only decision
([ASSIGNMENT_ELIGIBILITY.md](ASSIGNMENT_ELIGIBILITY.md)). Engine version tag
recorded on decisions: `compliance-engine.p0-e5-s1`.

## Requirement dates are local calendar dates (P0-E7-S1A)

- `effective_from` and `effective_until` are explicit calendar **dates**
  chosen by the caller. There is no database default:
  `create_credential_requirement` requires `p_effective_from`, and
  deactivation (`update_credential_requirement`) requires `p_effective_until`.
  The database's UTC `current_date` never decides when a requirement applies.
- **Facility-scoped** requirements: the UI defaults the date to the
  facility's local date (its IANA timezone) and shows it.
- **Agency-wide** requirements: Chelth has no agency timezone, so no default is
  derived. The user chooses the date explicitly; it is compared with each
  shift's facility-local date.
- The engine is unchanged: `internal.evaluate_compliance` compares the
  requirement's dates with the evaluation date, and assignment eligibility
  passes each **facility-local shift date**. A Chicago shift at 20:00 on
  day D (UTC D + 1) is evaluated on D.
- "Readiness today" views with a facility default to that facility's local
  date (`internal.compliance_as_of`). Agency-wide views without a facility
  keep the UTC date as a documented display fallback; they never decide
  assignment.
- A deactivated requirement (`status = inactive`) no longer applies to any
  date; `effective_until` records the last day explicitly.
- Existing requirements were **not rewritten**: dates stored before this
  change (from the old UTC default) remain as historical facts.
