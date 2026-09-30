# Agency ↔ Facility Relationships

Status: P0-E3-S3.

## 1. Why a separate relationship

A client facility is not "a row that belongs to an agency forever". Commercial
reality has its own lifecycle, terms and — eventually — multi-party structures
(VMS, managed service providers, facility-run float pools). So the
**relationship** is its own entity:

```
agency organisation ─┐
                     ├─ agency_facilities (client record) ─ agency_facility_relationships
facility organisation (optional, linked) ┘                     status · dates · (future terms)
```

## 2. Schema

`agency_facility_relationships`: `agency_organisation_id`,
`agency_facility_id` (composite FK to the client record of the SAME agency),
`status`, `started_at`, `ended_at`, `status_changed_at`, `created_by_profile_id`.

- At most one non-ended relationship per client record (partial unique index).
- The agency side is structurally an agency (via the client record's type
  constraint); the facility side is structurally the agency's own client
  record, optionally linked to a facility-type organisation.
- Ownership columns immutable; **ended relationships are immutable history**
  (trigger); a new relationship can be created later.

## 3. Lifecycle

| Status      | Meaning                          | Allowed next     |
| ----------- | -------------------------------- | ---------------- |
| `pending`   | being set up; no operational use | active, ended    |
| `active`    | live                             | suspended, ended |
| `suspended` | on hold (e.g. payment dispute)   | active, ended    |
| `ended`     | terminal                         | —                |

Changes via `set_facility_relationship_status` (`relationship.manage`, AAL2 —
agency admin only today), audited in the agency and, when linked, in the
facility organisation too.

## 4. Designed-for extensions (not built)

All attach to a relationship as child tables keyed by
`(relationship_id, agency_organisation_id)` — no redesign of workers,
facilities or tenancy:

| Future concept             | Shape                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract dates / documents | `relationship_contracts` (effective ranges; documents via the storage model)                                                                    |
| Billing terms, rate cards  | `relationship_rate_cards` (versioned, effective-dated, append-only history)                                                                     |
| Staffing permissions       | `relationship_permissions` (which locations/roles the agency may staff)                                                                         |
| Facility-managed access    | facility-side capabilities (`shift.view`, `timesheet.approve`) checked through `authz.has_relationship_capability`                              |
| VMS / vendor tiers         | a relationship between a facility organisation and several agencies, or an MSP organisation type, with vendor rank/priority on the relationship |

## 5. Linking workflow (future self-service)

Today linking is **platform-verified** (`platform_link_agency_facility`).
The planned self-service process reuses the invitation pattern and requires
consent from both sides:

1. A facility organisation admin (`organisation.manage`, AAL2) issues a
   single-use **link code** for their organisation (256-bit, hashed at rest,
   short expiry, audited).
2. They give it to the agency out-of-band.
3. An agency admin (`relationship.manage`, AAL2) redeems it against a
   specific client record. Redemption verifies the code, that the record is
   unlinked, and that the agency has no other record linked to that facility.
4. The link is written once; both organisations get audit events; access
   still flows only through relationships.

Name/email matching is never used, even as a suggestion.

## 6. Who sees what

| Viewer                                                                             | Relationship rows                                                                       | Via                                                                                                                             |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Agency staff with `relationship.view` (admin, ops manager, scheduler, finance)     | all of the agency's                                                                     | RLS `has_capability(agency, 'relationship.view')`                                                                               |
| Facility org members with `relationship.view` (facility admin, facility scheduler) | only relationships whose client record is linked to their organisation, while not ended | RLS `has_relationship_capability(id, 'relationship.view')` + `list_partner_agency_relationships()` (agency name, status, start) |
| Anyone else                                                                        | none                                                                                    | —                                                                                                                               |
