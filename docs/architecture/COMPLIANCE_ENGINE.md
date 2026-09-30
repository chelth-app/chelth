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
  Valid _through_ the expiry date. Evaluated in UTC dates today; per-facility
  time zones will apply when shifts carry local dates.
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
