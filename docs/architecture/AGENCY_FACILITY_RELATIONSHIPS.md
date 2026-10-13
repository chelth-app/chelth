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

## 5. Linking workflow (agency-initiated, P0-E9-4A.1)

Normal onboarding needs no platform admin. Two-party consent:

1. **Agency initiates** (`relationship.manage`, AAL2) from its own client
   record: "Invite facility to Chelth" (`invite_facility_connection`). It
   enters the facility administrator's email. The agency is resolved from the
   record, never from the browser. The response is the same whether or not the
   person or facility exists on Chelth (no enumeration).
2. **The invitation** (`facility_connection_invites`): a hashed, single-use
   token; bound to the email; expires in 7 days; revocable; resend capped
   (5); rate limited; audited. At most one pending invitation per record. The
   email links to the shared `/invite/<token>` entry (httpOnly cookie,
   resolved only after sign-in for the verified email).
3. **The facility side consents** (`accept_facility_connection_invite`):
   - **Create** a facility organisation (only now; no tenant exists before
     acceptance). The acceptor becomes its owner (`facility.admin`).
   - **Connect** a facility organisation they already administer
     (`organisation.manage`, AAL2). Only their own facilities are listed; a
     scheduler or supervisor cannot consent.
4. **Atomically:** the record is linked (written once:
   `agency_facilities_link_once`), the relationship is activated (or created
   active; a suspended one stays the agency's decision), the invitation is
   accepted, and both organisations get audit events. The invitation and record
   rows are locked: duplicate acceptance, accept-vs-revoke and double links
   resolve to one result.

**Multi-agency:** one facility organisation, many agencies. Each agency keeps
its own private record and its own relationship (one link per agency:
`agency_facilities_one_link_per_agency`). Requests, shifts, workers,
messages, compliance sharing, attendance and sign-off all stay scoped to one
relationship. A facility request goes to exactly one agency (no broadcast).
Ending one agency's relationship leaves the others untouched.

Name, email-domain or address matching is never used, not even as a
suggestion. **Platform fallback:** `platform_create_organisation` +
`platform_link_agency_facility` remain for support and recovery
(PILOT_OPERATIONS.md §10–§11).

## 6. Who sees what

| Viewer                                                                             | Relationship rows                                                                       | Via                                                                                                                             |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Agency staff with `relationship.view` (admin, ops manager, scheduler, finance)     | all of the agency's                                                                     | RLS `has_capability(agency, 'relationship.view')`                                                                               |
| Facility org members with `relationship.view` (facility admin, facility scheduler) | only relationships whose client record is linked to their organisation, while not ended | RLS `has_relationship_capability(id, 'relationship.view')` + `list_partner_agency_relationships()` (agency name, status, start) |
| Anyone else                                                                        | none                                                                                    | —                                                                                                                               |
