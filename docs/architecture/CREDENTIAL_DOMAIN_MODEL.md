# Credential Domain Model

Status: P0-E4-S1. Companions: [COMPLIANCE_ENGINE.md](COMPLIANCE_ENGINE.md),
[FACILITY_CREDENTIAL_REQUIREMENTS.md](FACILITY_CREDENTIAL_REQUIREMENTS.md),
[../security/CREDENTIAL_SHARING_MODEL.md](../security/CREDENTIAL_SHARING_MODEL.md),
[../security/CREDENTIAL_DOCUMENT_SECURITY.md](../security/CREDENTIAL_DOCUMENT_SECURITY.md).

## 1. Four separate questions

| Question                                        | Where it is answered                                 | Owned by          |
| ----------------------------------------------- | ---------------------------------------------------- | ----------------- |
| Does this **person** hold credential X?         | `credentials` + `credential_versions` (+ documents)  | the person        |
| Does **Agency A** accept it?                    | `credential_verifications` (per version, per agency) | the agency        |
| What does an **agency / facility require**?     | `credential_requirements`                            | the agency        |
| Is this **worker eligible** here, on this date? | derived by the compliance engine — never stored      | nobody (computed) |

There is no `compliant` flag anywhere.

## 2. Entities

```
profiles
  └─ credentials                 type + jurisdiction + issuing body; active | withdrawn
       ├─ credential_identifiers  the number (restricted table)
       ├─ credential_versions     immutable evidence periods; draft → submitted | withdrawn
       │    └─ credential_documents   files with a trust state (scan gate)
       ├─ credential_shares        explicit share with one agency (via membership)
       └─ credential_verifications append-only decisions (per version, per agency[, facility])
```

Reference data (migrations only): `credential_types`, `jurisdictions`, `disciplines`.

## 3. Credential types

Each type describes its own shape; no profession-specific code:

| Attribute                                                                                                                 | Meaning                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `category`                                                                                                                | professional_license, certification, background_screening, health_screening, training, identity_work_authorization (no types yet), competency |
| `scope`                                                                                                                   | `person` (portable) or `facility` (e.g. orientation — satisfied only by a verification scoped to that facility)                               |
| `jurisdiction_rule`                                                                                                       | none / country / subdivision — licences are subdivision-level (e.g. `US-GA`)                                                                  |
| `requires_issue_date`, `requires_expiry_date`, `requires_credential_number`, `requires_document`, `requires_verification` | enforced by RPCs at creation/submission and by the engine                                                                                     |
| `validity_months`                                                                                                         | validity from the issue date when no expiry exists (TB screening: 12)                                                                         |
| `is_renewable`, `is_active`                                                                                               | renewal allowed; retire a type without deleting history                                                                                       |

Seeded: RN licence, LPN/LVN licence, CNA, BLS, ACLS, PALS, CPR, TB screening,
background check, drug screening, facility orientation.

## 4. Jurisdictions

ISO 3166-1 countries and ISO 3166-2 subdivisions (`US`, `US-GA`, `GB`,
`GB-ENG` …) as reference rows with a checked parent/level structure. Seeded:
US (+ all states and DC), GB (+ nations), IE, CA, AU. Adding a country or
province is a data migration — nothing is hard-coded to one country.

## 5. Lifecycles

| Object       | States                                                           | Rules                                                                                                   |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| credential   | active → withdrawn                                               | core fields immutable; correct by withdrawing and re-adding                                             |
| version      | draft → submitted \| withdrawn                                   | one draft at a time; numbers assigned 1, 2, 3 … by the DB; submitted versions never change or disappear |
| document     | upload_pending → scanning → clean \| quarantined \| rejected     | only `clean` is evidence; no API can set `clean`                                                        |
| share        | active → revoked                                                 | never deleted; re-sharing creates a new row                                                             |
| verification | (append-only events) under_review / verified / rejected(+reason) | latest event (by sequence) per version, agency and facility is current                                  |
| "expired"    | —                                                                | **derived** from dates; never stored                                                                    |

Renewal = a new version with its own dates and documents. Earlier versions
remain as evidence. Because verification attaches to a _version_, a renewal
never inherits an old decision.

## 6. Sensitive data rules

- No SSN, national insurance or similar identifiers in this stage.
- Credential numbers live in `credential_identifiers`, readable only by the
  owner and by reviewers holding `credential.review` (AAL2). Never in audit
  metadata or logs (pgTAP-tested).
- Storage paths are opaque IDs; no names or numbers in paths.

## 7. Disciplines

`disciplines` (RN, LPN/LVN, CNA, MA, HHA, PT, OT, RT) and
`agency_worker_disciplines` (agency-assigned, `worker.manage`). They only
select which requirements apply. A job/specialty taxonomy arrives with
recruiting and scheduling.

## 8. Worker experience

`/app/organisations/[id]/my-credentials`: own credentials, sharing state with
this agency, readiness at this agency with reasons, add credential (with an
explicit "share with this agency" choice), upload, submit, renew, stop
sharing, withdraw, and every agency's decisions about the credential.
