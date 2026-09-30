# Shift Cross-Organisation Access

Status: P0-E5-S1. Applies [CROSS_ORG_DATA_SHARING.md](CROSS_ORG_DATA_SHARING.md):
specific relationship → specific resource → explicit policy → narrow projection.

## 1. Who reads what

| Party                            | Tables (RLS)                                              | Projections                                                                                      |
| -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Agency, `shift.view`             | `shifts`, `shift_internal_notes`                          | `list_agency_shifts`                                                                             |
| Agency, `assignment.view`        | `shift_assignments`; decisions need `compliance.view` too | `list_assignment_readiness` (+ `compliance.view`)                                                |
| Agency, `assignment.manage`      | —                                                         | `list_shift_candidates` (+ `compliance.view`)                                                    |
| Worker (self)                    | own `shift_assignments` rows (active membership)          | `list_my_shift_assignments`                                                                      |
| Linked facility, `shift.view`    | **none**                                                  | `list_facility_shifts`, `list_facility_shift_assignments` (audited)                              |
| Linked facility, `shift.request` | none                                                      | `list_facility_request_options`, `submit_facility_shift_request`, withdraw own submitted request |
| Other agencies / facilities      | nothing                                                   | nothing (`CH403` / `CHS04`)                                                                      |
| Platform admins                  | nothing                                                   | nothing                                                                                          |

Facility capabilities are effective only through
`authz.has_relationship_capability(relationship, capability)`: the
relationship is not ended, its client record is explicitly linked to the
caller's facility organisation, and the caller holds the capability there.

## 2. Facility shift projection

Time, timezone, location name, discipline, headcount, derived fill counts and
state, status, source, instructions, reference, cancellation reason,
relationship status, agency name. **Not:** drafts, internal notes, agency
client-record fields, other client facilities, other agencies, rates, worker
records.

## 3. Assigned-worker projection ("who is coming")

Assignment id, worker display name, discipline, assignment state, readiness
indicator (`ready` / `action_required` / `not_eligible`, no reasons). **Not:**
email, phone, address, credential numbers or documents, notes, reasons, other
agency relationships. Every read records `shift.assignments_viewed_by_facility`
in the facility organisation. Basis for sharing: the worker is actively
assigned to that facility's shift under an active relationship.

## 4. Worker projection

Facility name, location, discipline, times, timezone, assignment state,
cancellation reason, and instructions **only while the assignment is active**.
Never internal notes, headcount, other workers or other agencies.

## 5. Structural backstops

Composite FKs (shift ↔ facility ↔ relationship ↔ location; assignment ↔
worker ↔ person ↔ agency; actor ↔ agency), the linked-facility trigger for
facility requests, and the cross-agency exclusion constraint hold even if a
policy or function is wrong (pgTAP U/M/O/P as DB owner).

## 6. Error oracle

Missing and invisible shifts both return `SHIFT_NOT_FOUND`; missing and
not-own assignments both return `ASSIGNMENT_NOT_FOUND`. A worker id from
another agency returns `WORKER_NOT_FOUND`.
