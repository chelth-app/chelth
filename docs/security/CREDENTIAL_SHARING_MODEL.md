# Credential Sharing Model

Status: P0-E4-S1.

## 1. Principle

Credentials belong to the person. **No agency sees a credential unless the
person has explicitly shared it with that agency**, and even then only staff
with the right capability see it. Belonging to an agency does not share
anything automatically.

## 2. The share

`credential_shares` (credential → agency), bound by composite FK to the
**same person's membership** in that agency. Conditions to create: the caller
owns the credential; the credential is active; the person is a current
(non-terminated) worker there with an active membership. Revocation is
immediate and kept as history; re-sharing creates a new row.

UX rule: when a worker adds a credential inside an agency's area, a checkbox
"Share this credential with <agency>" is pre-ticked and explained; unticking
it keeps the credential private. The credential page shows the sharing state
and a "Stop sharing" action.

## 3. What each party sees

| Party                                                           | Through a share, sees                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Worker (owner)                                                  | everything they own, and every agency's decisions about it                  |
| Agency, `credential.view`                                       | credential metadata, versions (dates), share, **its own** decisions         |
| Agency, `credential.review` (AAL2)                              | + number and clean documents (audited)                                      |
| Agency, `credential.verify` (AAL2)                              | + record decisions (never on own credential)                                |
| Agency, `compliance.view` only (scheduler)                      | readiness and reasons only — no credential rows                             |
| Other agencies                                                  | nothing, including other agencies' decisions                                |
| Facility (linked, `credential.view`, explicit per-worker share) | readiness + reason codes + expiry dates via `list_shared_worker_compliance` |
| Platform admins                                                 | nothing through RLS                                                         |

Access requires **both** an active share and an active membership: suspending
or revoking a worker's membership hides their credentials from that agency
immediately.

## 4. Multi-agency trust boundary

Agency B cannot see, rely on or inherit Agency A's verification. The engine
counts only the evaluating agency's decisions (tested). A person working for
two agencies shares the same credential with both; each verifies it
independently.

## 5. Facility-side sharing

Follows [CROSS_ORG_DATA_SHARING.md](CROSS_ORG_DATA_SHARING.md): a specific
relationship → a specific resource (a worker's readiness) → an explicit
share (`relationship_worker_compliance_shares`, created by `credential.verify`
under an **active** relationship) → a narrow, audited projection. Documents,
numbers, verification detail and notes are never shared. Raw-document
visibility for facilities would require a new, explicit, consent-based policy.
