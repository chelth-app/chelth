# Facility Domain Model

Status: P0-E3-S3. Companion:
[AGENCY_FACILITY_RELATIONSHIPS.md](AGENCY_FACILITY_RELATIONSHIPS.md).

## 1. Two different things called "facility"

| Concept                                                                        | Table                             | Owned by                 | Exists when                                                             |
| ------------------------------------------------------------------------------ | --------------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| **Facility organisation** — a care provider that uses Chelth itself            | `organisations` (type `facility`) | itself (its own members) | the facility joins Chelth                                               |
| **Client facility record** — an agency's operational record of a customer site | `agency_facilities`               | the agency               | the agency starts working with the site, whether or not it is on Chelth |

An agency's client record is the agency's data (its own reference, the
contact details it uses, its view of the site). A facility organisation's
own data belongs to the facility. The two meet only through an explicit link
and a relationship — never by one owning the other.

Facility **users** are members of a facility organisation
(`profile → organisation_memberships` with a `facility.*` role). There is no
second facility-user table.

## 2. `agency_facilities`

| Field                             | Notes                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `agency_organisation_id`          | owner; type-checked `agency` via composite FK; immutable                                       |
| `linked_facility_organisation_id` | NULL until an explicit verified link (§4); type-checked `facility`; set once, never re-pointed |
| `name`                            | 2–200 chars                                                                                    |
| `facility_type_key`               | FK to `facility_types` (§3)                                                                    |
| `status`                          | `active \| inactive \| archived` (archived = read-only; requires no open relationship)         |
| `timezone`                        | **required** IANA name, validated against Postgres' catalogue                                  |
| `phone`, `email`                  | **business site contacts only** (shared office numbers/addresses), validated                   |
| address fields                    | line 1–2, locality, region, postal code, ISO country code                                      |
| `external_reference`              | the agency's own reference; unique per agency                                                  |

Minimal PII: no personal contact names, no patient data.

## 3. Facility types — reference table, not enum

`facility_types` (hospital, skilled_nursing, assisted_living, rehabilitation,
home_health, hospice, clinic, behavioral_health, other) is migration-managed
reference data because the vocabulary is descriptive and will grow: rows carry
labels and ordering, can be retired with `is_active = false` without enum
surgery, and are drift-tested against `src/lib/domain/vocabulary.ts`.
Lifecycle states (which code branches on) remain enums.

## 4. Linking a client record to a facility organisation

A facility may join Chelth after an agency has years of history with it.
Linking attaches the existing client record — **no duplication of history**.

Rules (enforced by schema + RPC):

- Never automatic; never by matching name, email or address.
- Set once (NULL → facility org); cannot be re-pointed or silently cleared.
- One agency client record per linked facility organisation per agency.
- Audited in **both** organisations (`facility.linked`).
- Linking alone grants nothing: cross-organisation access is always
  relationship-scoped (CROSS_ORG_DATA_SHARING.md).

Current verified process: **platform-verified linking**
(`platform_link_agency_facility`, platform admin at AAL2, after an
out-of-band verification with both parties). Planned self-service process:
see AGENCY_FACILITY_RELATIONSHIPS.md §5 (two-party consent code).

## 5. Location hierarchy

```
agency_facilities            the client site / organisation-level record
  └─ facility_locations      campus, building, site, ward group — explicit timezone
        └─ (facility_departments / units — designed, not created)
```

- `facility_locations` binds to `(agency_facility_id, agency_organisation_id)`,
  so a location can never attach one agency to another agency's facility.
- Location timezone is explicit; when omitted at creation it is copied from
  the facility (stored, not inherited at read time), so later facility edits
  never silently shift location schedules.
- `(id, agency_organisation_id)` and `(id, agency_facility_id)` are unique so
  future **departments** (`facility_departments` with
  `(location_id, agency_facility_id)` composite FK) and **shifts** can bind to
  the exact location and tenant.
- Departments are deferred until scheduling defines what a bookable unit is.

## 6. Access

| Capability               | Agency roles holding it                       |
| ------------------------ | --------------------------------------------- |
| `facility.view`          | admin, operations manager, scheduler, finance |
| `facility.manage` (AAL2) | admin, operations manager                     |

Facility organisation members never read `agency_facilities` or
`facility_locations` directly — including after linking.

## 7. UI

`/app/organisations/[id]/facilities` (list + create) and
`/app/organisations/[id]/facilities/[facilityId]` (details, locations,
relationship, edit, status).

## 8. Credential requirements (P0-E4-S1)

Facilities may add credential requirements to the agency baseline (e.g.
orientation, TB screening, longer minimum validity) —
[FACILITY_CREDENTIAL_REQUIREMENTS.md](FACILITY_CREDENTIAL_REQUIREMENTS.md).
Facility-specific credentials (orientation) are verified by the agency **for
that facility**. A linked facility organisation sees only readiness for
workers explicitly shared under an active relationship.
