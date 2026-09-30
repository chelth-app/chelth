# Workforce Domain Model

Status: P0-E3-S3. Companion: [AUTHORIZATION_MODEL.md](AUTHORIZATION_MODEL.md),
[../security/CROSS_ORG_DATA_SHARING.md](../security/CROSS_ORG_DATA_SHARING.md).

## 1. A worker is a person first

A healthcare worker is a **human identity** who may work with several
agencies. Chelth therefore models two layers and never makes a person a
tenant-owned object:

```
profiles                         the person (shared, one row per human)
  └─ organisation_memberships    one per agency the person belongs to
        └─ agency_workers        one per agency engagement: status, reference, dates
```

- Nothing about the person (name, email) is copied into `agency_workers`.
- The same person can be onboarding at Agency A, active at Agency B and
  terminated at Agency C — each agency sees and controls only its own record.
- Future person-level data (e.g. credentials the worker owns and chooses to
  share) will key on `profile_id`; agency-specific data (assignments,
  timesheets) will key on `(agency_worker_id, agency_organisation_id)`.

## 2. `agency_workers`

| Column                                          | Meaning                                                       | Worker can see |
| ----------------------------------------------- | ------------------------------------------------------------- | :------------: |
| `id`                                            | worker record id                                              |       ✔        |
| `agency_organisation_id`                        | the agency (type-checked `agency`)                            |       ✔        |
| `membership_id`, `profile_id`                   | the person's membership in that agency                        |       ✔        |
| `status`                                        | lifecycle (below)                                             |       ✔        |
| `worker_reference`                              | agency's own reference (HR/payroll number); unique per agency |       ✔        |
| `start_date`, `end_date`                        | engagement dates (set by status changes)                      |       ✔        |
| `status_changed_at`, `created_at`, `updated_at` | timestamps                                                    |       ✔        |

**Every column in this table is worker-visible by design.** Anything an agency
must keep from the worker lives in a separate table with its own capability
(today: `agency_worker_notes`). This keeps self-access a simple row rule
instead of fragile column filtering.

Not stored (deliberately, this stage): credentials, government identifiers,
date of birth, contact details (they are the person's, in Auth/profile),
engagement/employment type (jurisdiction-specific — arrives with pay).

## 3. Structural tenant safety

```
agency_workers (membership_id, agency_organisation_id, profile_id)
  → organisation_memberships (id, organisation_id, profile_id)
agency_workers (agency_organisation_id, agency_organisation_type = 'agency')
  → organisations (id, type)
```

It is structurally impossible for an Agency A worker record to reference an
Agency B membership, a different person, or a facility organisation — even
with RLS disabled (pgTAP-tested as the owner role). Ownership columns are
immutable (trigger). `(id, agency_organisation_id)` is unique so future tables
can bind to a worker AND its agency with one composite FK.

## 4. Lifecycle

| Status       | Meaning                                    | Allowed next                    |
| ------------ | ------------------------------------------ | ------------------------------- |
| `onboarding` | record exists; not yet available for work  | active, terminated              |
| `active`     | available for work                         | inactive, suspended, terminated |
| `inactive`   | temporarily unavailable (not disciplinary) | active, suspended, terminated   |
| `suspended`  | agency-imposed hold (compliance/conduct)   | active, inactive, terminated    |
| `terminated` | engagement ended — terminal                | —                               |

- Changes only through `set_agency_worker_status` (worker.manage, AAL2),
  audited with `{from, to}` codes. Activation sets `start_date` if unset;
  termination sets `end_date`.
- Nobody can change their own worker record (even an admin who is also a
  worker at their agency).
- Terminated records are read-only history. **Re-engagement creates a new
  record** (revoke and re-grant the healthcare-worker role); at most one
  non-terminated record per membership.
- Worker status is independent of membership status: suspending a
  _membership_ removes the person's access; suspending a _worker_ is an
  operational availability decision. Both are audited.

## 5. Creating workers

A worker record is created **by the database** when a membership is granted
the `agency.healthcare_worker` role (trigger `ensure_worker_record`), so there
is exactly one creation rule regardless of path:

| Flow                                                | Path                                                                                                       | Status                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| B. New to Chelth                                    | Invite (`membership.invite`) with the healthcare-worker role → invitee signs up, verifies email, accepts   | **Built** (Workforce → Invite worker; role fixed server-side) |
| A. Existing member of the agency                    | Assign the healthcare-worker role (`role.assign`)                                                          | **Built** (Organisation → Members)                            |
| A′. Existing Chelth identity, not yet in the agency | Same as B: invitation to their email. Agencies cannot look people up or add them directly (no enumeration) | Built (via B)                                                 |
| C. Candidate → worker                               | Recruiting stage converts a candidate by issuing the invitation                                            | Deferred                                                      |

No auth users are ever created by the application; identities come only from
self sign-up.

## 6. Internal notes

`agency_worker_notes`: append-only (trigger refuses UPDATE/DELETE), 2 000
characters, written via `add_agency_worker_note` (`worker.notes.manage`,
AAL2), read with `worker.notes.view`. Never visible to the worker, and never
visible to a note-reader when the note is about themselves. Bodies never
enter audit metadata (audit records `note_id` only). Policy: no clinical,
credential or health information in notes.

## 7. Access summary

| Who                              | Sees                                                     | Can change               |
| -------------------------------- | -------------------------------------------------------- | ------------------------ |
| Agency admin                     | all agency workers + notes                               | status, reference, notes |
| Operations manager, Recruiter    | all agency workers + notes                               | status, reference, notes |
| Scheduler, Credentialing officer | agency workers (no notes)                                | —                        |
| Finance                          | —                                                        | —                        |
| Healthcare worker                | **own** record(s) only, while their membership is active | —                        |
| Facility users                   | —                                                        | —                        |
| Platform admin                   | — (no RLS path)                                          | —                        |

## 8. UI

`/app/organisations/[id]/workforce` (list + invite) and
`/app/organisations/[id]/workforce/[workerId]` (record, status actions,
reference, notes). Workers see "My worker record" on the organisation page.
The organisation id is always explicit in the route.
