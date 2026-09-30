# Cross-Organisation Data Sharing

Status: P0-E3-S3. **Normative for every future feature that shows one
organisation's data to another** (shifts, assigned worker details,
timesheets, invoices, credential visibility).

## 1. The rule

> Cross-organisation access is **explicit, specific and relationship-scoped**:
> a specific relationship → a specific shareable resource → an explicit policy.

**Forbidden:** "Facility F is linked to Agency A, therefore F's users can read
A's tenant tables."

**Required:**

1. A live relationship between the organisations
   (`agency_facility_relationships`, status not `ended`).
2. The relationship's client record is **explicitly linked** to the viewer's
   organisation (verified process; set once).
3. The viewer holds the relevant capability **in their own organisation**
   (e.g. `relationship.view`, later `shift.view`, `timesheet.approve`).
4. The resource itself is scoped to that relationship (carries
   `relationship_id` or is reachable from it by composite FK), and its policy
   calls the relationship helper **for that resource**.
5. Only a curated projection is shared (RPC or view), never whole tenant rows,
   unless every column is intended for the partner.

## 2. The primitive

```sql
authz.has_relationship_capability(p_relationship_id uuid, p_capability text) → boolean
```

True only when: the relationship exists and is not ended; its client record is
linked to a facility organisation; and the caller holds `p_capability` in that
facility organisation (active profile, membership, role; AAL2 if privileged).
It is SECURITY DEFINER, `search_path = ''`, and pgTAP allow-listed.

Template for a future shared resource:

```sql
create policy shifts_select on public.shifts for select to authenticated using (
  authz.has_capability(agency_organisation_id, 'shift.view')               -- agency side
  or authz.has_relationship_capability(relationship_id, 'shift.view')      -- facility side, this relationship only
);
```

## 3. What is shared today

| Resource                               | Facility side sees                       | Mechanism                                         |
| -------------------------------------- | ---------------------------------------- | ------------------------------------------------- |
| The relationship row                   | its own relationship(s), while not ended | RLS via helper                                    |
| Agency identity for that relationship  | agency name, status, start date          | `list_partner_agency_relationships(facility_org)` |
| Agency client record, locations, notes | **nothing**                              | no policy path                                    |
| Agency workers, worker profiles        | **nothing**                              | no policy path                                    |
| Agency organisation row, members       | **nothing**                              | tenant RLS unchanged                              |

## 4. Revocation

Sharing stops immediately — evaluated per request, no cached grants — when
the relationship ends, the viewer's membership is suspended/revoked, the
viewer's role changes, the viewer's profile is suspended, or either
organisation is suspended (capabilities require an active organisation).
All are pgTAP/integration tested.

## 5. Planned shares (design guidance)

| Future resource         | Share with facility                                                                                                               | Notes                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Shift requests / shifts | the facility's own shifts under the relationship                                                                                  | relationship_id on the row; `shift.view` / `shift.create` in the facility org |
| Assigned worker details | name + the minimum operational fields for **assigned** shifts only                                                                | projection RPC; never the worker list; never notes                            |
| Timesheets              | for the facility's shifts only                                                                                                    | `timesheet.approve` in the facility org; append-only approvals                |
| Invoices                | invoices issued under the relationship                                                                                            | `invoice.view` in the facility org                                            |
| Credential visibility   | only credentials the worker has consented to share for a placement, and only their verification status unless explicitly required | document access through signed URLs + access audit                            |

Each will ship with pgTAP tests proving: unrelated facility sees nothing;
ended relationship shares nothing; facility cannot read agency tenant tables;
agency B cannot see agency A's shares.

## 6. Credentials and compliance (implemented, P0-E4-S1)

| Resource                                                         | Facility side sees                                                     | Mechanism                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Worker readiness for this facility                               | readiness, reason codes, credential type names, effective expiry dates | explicit per-worker share (`relationship_worker_compliance_shares`, `credential.verify`, active relationship) → `list_shared_worker_compliance` (facility `credential.view`, audited as `compliance.viewed_by_facility`) |
| Credential rows, numbers, documents, verification history, notes | **nothing**                                                            | no policy path                                                                                                                                                                                                           |

Revocation: removing the share, ending/suspending the relationship, or the
facility member losing access each stop sharing immediately (tested).
