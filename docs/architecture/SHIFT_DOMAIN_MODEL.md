# Shift Domain Model

Status: P0-E5-S1. Companions: [ASSIGNMENT_DOMAIN_MODEL.md](ASSIGNMENT_DOMAIN_MODEL.md),
[SHIFT_TIME_MODEL.md](SHIFT_TIME_MODEL.md), [ASSIGNMENT_ELIGIBILITY.md](ASSIGNMENT_ELIGIBILITY.md),
[../security/SHIFT_CROSS_ORG_ACCESS.md](../security/SHIFT_CROSS_ORG_ACCESS.md).

## 1. Terminology

One entity, `public.shifts`: **work an agency fulfils for a client facility**.
A facility's staffing request is a shift with `source = 'facility'` that starts
as `submitted`. There is no separate `shift_requests` table, so a request and
the shift it becomes can never drift apart.

## 2. Structural ownership

| Column                                                   | Guarantee (composite FK — holds even as DB owner)                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `agency_organisation_id` (+ type `agency`)               | the owning agency                                                                 |
| `agency_facility_id`                                     | `(id, agency_organisation_id)` → the agency's own client record                   |
| `relationship_id`                                        | `(id, agency_organisation_id, agency_facility_id)` → THAT facility's relationship |
| `facility_location_id`                                   | `(id, agency_facility_id)` → a location of that facility                          |
| `discipline_key`                                         | → `disciplines` reference data                                                    |
| `created_by_membership_id`, `created_by_organisation_id` | → a membership of the creating organisation                                       |

Checks: agency-sourced ⇔ creator organisation = agency; a facility-sourced
shift's creator organisation must be the facility organisation **linked** to
the client record (trigger); timezone = the location's timezone (trigger).
Ownership columns, source and creator are immutable.

## 3. Headcount

`requested_headcount` (1–100) on ONE row. "Mercy Rehab, CNA, 07:00–15:00, need
4" is one shift with up to 4 active assignments — never four duplicate shifts.
Positions (per-slot requirements) can be added later as a child table without
changing this contract. The upper bound of 100 is a sanity bound against input
errors, not an operational limit.

## 4. Lifecycle (stored states only)

```
agency:    draft ──► open ──► completed
facility:  submitted ──► open
any non-terminal ──► cancelled (controlled reason)
```

| State     | Meaning                                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| draft     | agency work in progress; invisible to the facility                                                                |
| submitted | a facility request awaiting the agency (preserves agency control)                                                 |
| open      | assignable                                                                                                        |
| cancelled | terminal; reason ∈ facility_cancelled, staffing_no_longer_needed, entered_in_error, relationship_suspended, other |
| completed | terminal; only after `end_at` (no attendance semantics)                                                           |

**unfilled / partially filled / filled are DERIVED** from active assignments
vs headcount (in `list_agency_shifts`, `list_facility_shifts` and
`deriveFillState`). They are never stored, so they cannot drift.

Transitions are enforced by `internal.enforce_shift_transition` (trigger):
terminal rows are immutable (`CHS09`), and once open the scheduling identity
(location, discipline, times, timezone) is fixed. Headcount and instructions
remain editable while open; headcount can never drop below active assignments.

## 5. Facility requests

A linked facility with `shift.request` submits through ONE active
relationship (`submit_facility_shift_request`). The agency reviews and opens
it (`open_shift`; the UI calls it "Accept and open request"). The facility can
withdraw its own request only while it is still `submitted`, with reason
`facility_cancelled`. Facilities cannot edit requests in this stage (withdraw
and resubmit).

## 6. Relationship state

| Relationship | New shifts / requests | Open drafts / requests | Assign / accept | Existing rows                   |
| ------------ | --------------------- | ---------------------- | --------------- | ------------------------------- |
| active       | yes                   | yes                    | yes             | —                               |
| suspended    | no (`CHS10`)          | no (`CHS10`)           | no (`CHS10`)    | kept; flagged in UI             |
| ended        | no                    | no                     | no              | kept; facility loses visibility |

Nothing is deleted or silently cancelled. Upcoming open shifts under a
suspended/ended relationship are shown as "Relationship not active", surfaced
by the re-evaluation primitive, and cancelled through the explicit workflow
(`cancel_shift` with reason `relationship_suspended`). Workers may still
decline.

## 7. Notes and instructions

| Field                  | Visible to                                                       |
| ---------------------- | ---------------------------------------------------------------- |
| `shifts.instructions`  | agency, linked facility, workers with an ACTIVE assignment       |
| `shift_internal_notes` | agency (`shift.view`) only; append-only; never in audit metadata |

## 8. Commands

`create_shift`, `submit_facility_shift_request`, `open_shift`, `update_shift`,
`cancel_shift`, `complete_shift`, `add_shift_internal_note`, `list_agency_shifts`.
All SECURITY DEFINER, `search_path = ''`, organisation derived from the
referenced record, audited (`shift.created/submitted/opened/updated/cancelled/
completed/internal_note_added`). No direct table writes.
