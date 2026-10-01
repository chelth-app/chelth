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
