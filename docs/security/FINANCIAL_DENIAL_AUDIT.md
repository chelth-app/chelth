# Financial Denial Audit

Status: P0-E7-S3. This closes the S2 gap where refused downloads were not
audited.

## What is audited

Refusals of these actions are audited:

- **Downloads:** financial export downloads (`download_financial_export`).
- **Approvals:** payroll batches and invoice drafts.
- **Adjustment approvals:** payroll adjustments and invoice adjustments.

Each refusal records `financial.action_denied` with:

| Field        | Value                                                                 |
| ------------ | --------------------------------------------------------------------- |
| actor        | `actor_profile_id`, membership and AAL (standard audit columns)       |
| organisation | the target's agency **only if the actor is a member**, otherwise NULL |
| target       | the target type and the id supplied                                   |
| metadata     | `{ attempted_action, reason_code }` only                              |

Reason codes are `NOT_FOUND`, `NOT_PERMITTED`, `MFA_REQUIRED` and
`MAKER_CHECKER`. Nothing else is recorded: no names, no free text, no file
contents, no amounts.

## Why refusals are returned, not raised

A raised error rolls back the transaction, and the audit row with it. These
RPCs therefore **return** the refusal and commit the audit row:

- approvals return `(outcome 'denied', reason_code)`;
- the download returns a row with `denied_reason`.

The server maps a refusal to the same safe error it would have shown before:
`MFA_REQUIRED`, `FORBIDDEN`, `MAKER_CHECKER_REQUIRED` or not-found. The
download route answers 404, or 403 with a verification prompt. Clients fail
closed unless `outcome = 'approved'`; `assertNotDenied` is unit-tested.

State errors are not security denials and still raise. These are a wrong
status, superseded sources and locked documents.

## Abuse bounds (no audit-log DoS)

- **Cap first:** at most 60 denial attempts per actor per hour are
  considered for recording. The cap is checked before deduplication, so an
  attacker cycling random target ids cannot grow either the audit log or the
  rate-limit counters without bound.
- **Deduplication:** one row per (actor, action, target, reason) per 15
  minutes, using rate-limit buckets.
- **Refusal still applies:** an attempt beyond either bound is refused but
  not recorded.
- **Cross-tenant attempts:** these are recorded without an organisation, so
  another agency's audit log is never written to.
