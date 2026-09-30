# Credential Requirements (Agency Baseline & Facility)

Status: P0-E4-S1.

## 1. Model

One table, `credential_requirements`, with an explicit scope:

| Scope           | `agency_facility_id`                  | Applies to                                             |
| --------------- | ------------------------------------- | ------------------------------------------------------ |
| Agency baseline | NULL                                  | every worker of the agency (optionally one discipline) |
| Facility        | one of the agency's client facilities | work at that facility, **in addition** to the baseline |

Fields: credential type · discipline (NULL = all) · `must_be_verified`
(forced on when the type requires verification) · `minimum_validity_days`
(must remain valid at least this long past the evaluation date) ·
`expiry_warning_days` (default 30) · jurisdiction (e.g. `US-GA` for a licence)
· status active/inactive · effective from/until.

## 2. Integrity

- `(agency_facility_id, agency_organisation_id)` composite FK → a requirement
  can only target the agency's own facility (tested).
- Agency side type-checked `agency`.
- One active requirement per (agency, facility, discipline, type).
- Ownership columns immutable; requirements are **deactivated, never
  deleted** (history of what applied when).
- Facility-scoped types (orientation) can only be required by a facility.
- Writes only via RPCs requiring `credential.requirements.manage` (AAL2);
  audited (`credential.requirement_created/updated`).

## 3. Who

| Capability                              | Roles                                            |
| --------------------------------------- | ------------------------------------------------ |
| `credential.requirements.view`          | admin, credentialing officer, operations manager |
| `credential.requirements.manage` (AAL2) | admin, credentialing officer                     |

Schedulers see the _effect_ (readiness reasons) without needing the rules.

## 4. Future scoping

Location/department/role-specific requirements add nullable
`facility_location_id` / `department_id` / `role_key` columns with composite
FKs, and the engine filters by the shift's context. The reason-code contract
does not change. Contract-driven requirements (per relationship) attach via
`relationship_id`.

## 5. UI

- Agency baseline: `/app/organisations/[id]/compliance`.
- Facility: "Credential requirements" on the facility page.
  Controlled credential types only; no free-form rule builder.
