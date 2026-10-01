# Authorization Model

Status: P0-E3-S2. **Every future feature must authorise through this model.**

## 1. Principles

1. **Capabilities, not role names.** Code and policies ask "does this identity
   hold `membership.invite` in organisation X?" — never "is this user an admin?".
2. **Organisation is always explicit.** Every check names the organisation or
   derives it server-side from the target row. No ambient tenant.
3. **The database decides.** RLS policies and `SECURITY DEFINER` RPCs call the
   same helpers. UI checks are hints; Server Actions add no authority.
4. **Deny by default.** No table grants beyond `SELECT` to `authenticated`;
   all writes are RPCs; nothing is granted to `anon`.
5. **Live evaluation.** Roles and capabilities are never copied into JWT
   claims, so suspension and revocation take effect on the next request.
6. **No escalation.** You cannot change your own roles or membership, and you
   cannot grant, revoke or offer anything you do not hold (capability ceiling).
7. **Privileged means MFA.** Privileged capabilities are only effective in an
   AAL2 session.

## 2. Capabilities

Namespaced keys `<domain>.<action>` (lowercase, dot-separated), defined as
reference rows by migration and mirrored in `src/lib/authz/vocabulary.ts`
(drift-tested).

| Capability                       | Privileged (AAL2) | Meaning                                                                               |
| -------------------------------- | :---------------: | ------------------------------------------------------------------------------------- |
| `organisation.view`              |                   | See the organisation                                                                  |
| `organisation.manage`            |         ✔         | Organisation settings/status (reserved for owner roles)                               |
| `membership.view`                |                   | See members, their roles and profiles                                                 |
| `membership.invite`              |         ✔         | Issue, resend, revoke and list invitations                                            |
| `membership.manage`              |         ✔         | Suspend, reinstate, revoke memberships                                                |
| `role.assign`                    |         ✔         | Assign and revoke roles                                                               |
| `audit.view`                     |         ✔         | Read the organisation audit history                                                   |
| `worker.view`                    |                   | View agency worker records (P0-E3-S3)                                                 |
| `worker.manage`                  |         ✔         | Change worker status and reference                                                    |
| `worker.notes.view`              |                   | Read internal notes about workers                                                     |
| `worker.notes.manage`            |         ✔         | Add internal notes about workers                                                      |
| `facility.view`                  |                   | View client facilities and locations                                                  |
| `facility.manage`                |         ✔         | Create/update client facilities and locations                                         |
| `relationship.view`              |                   | View agency–facility relationships                                                    |
| `relationship.manage`            |         ✔         | Create relationships and change their status                                          |
| `credential.view`                |                   | View shared credential metadata and this agency's decisions (P0-E4-S1)                |
| `credential.review`              |         ✔         | Open numbers and clean documents of shared credentials                                |
| `credential.verify`              |         ✔         | Record verification decisions; share readiness with facilities                        |
| `credential.requirements.view`   |                   | View baseline and facility requirements                                               |
| `credential.requirements.manage` |         ✔         | Create, change and deactivate requirements                                            |
| `compliance.view`                |                   | View derived readiness and reasons                                                    |
| `shift.view`                     |                   | View shifts and derived fill progress (P0-E5-S1); facility side via relationship only |
| `shift.create`                   |                   | Create shifts for the agency's client facilities                                      |
| `shift.manage`                   |                   | Open, update, cancel, complete shifts; internal shift notes                           |
| `shift.request`                  |                   | Facility side: submit/withdraw staffing requests through a relationship               |
| `assignment.view`                |                   | View assignments, decisions and live assignment readiness                             |
| `assignment.manage`              |                   | Assign workers (server-gated) and cancel assignments                                  |

Self-service identity actions (edit own name, enrol MFA, redeem an invitation
addressed to you) are **identity-scoped**, not organisation capabilities, so
there is no `identity.manage_self` row: they are authorised by being the
identity (`auth.uid()`), enforced by RLS/column grants and RPC checks.

Reserved namespaces for later stages (not created yet): `timesheet.*`, `rate.*`, `invoice.*`,
`payroll.*`. Each stage adds only the capabilities it implements, in its own
migration, with role mappings.

## 3. Roles

Roles are bundles of capabilities bound to one organisation type (the key
prefix equals the type; enforced by a check constraint). Exactly one owner
role per type is granted to an organisation's creator.

| Role                   | Type     | Identity-stage capabilities (S2)                                          | Domain capabilities (S3)                                                              |
| ---------------------- | -------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Agency Admin (owner)   | agency   | all seven                                                                 | all eight                                                                             |
| Operations Manager     | agency   | organisation.view, membership.view/invite/manage, role.assign, audit.view | worker.view/manage, worker.notes.view/manage, facility.view/manage, relationship.view |
| Recruiter              | agency   | organisation.view, membership.view, membership.invite                     | worker.view/manage, worker.notes.view/manage                                          |
| Scheduler              | agency   | organisation.view, membership.view                                        | worker.view, facility.view, relationship.view                                         |
| Credentialing Officer  | agency   | organisation.view, membership.view                                        | worker.view                                                                           |
| Finance                | agency   | organisation.view, membership.view                                        | facility.view, relationship.view                                                      |
| Healthcare Worker      | agency   | organisation.view                                                         | none (self-access is an identity rule, §6)                                            |
| Facility Admin (owner) | facility | all seven                                                                 | relationship.view (effective only via linked relationships)                           |
| Facility Scheduler     | facility | organisation.view, membership.view                                        | relationship.view                                                                     |
| Facility Supervisor    | facility | organisation.view, membership.view                                        | none                                                                                  |

Credential & compliance capabilities (P0-E4-S1): admin — all six;
credentialing officer — all six; operations manager — credential.view,
requirements.view, compliance.view; recruiter — credential.view,
compliance.view; scheduler — compliance.view; finance — none; healthcare
worker — none (self-access is an identity rule); facility admin/scheduler —
credential.view, effective only through the relationship projection.

Shift & assignment capabilities (P0-E5-S1, none privileged — see below):
admin, operations manager, scheduler — shift.view/create/manage,
assignment.view/manage; recruiter, credentialing officer, finance — none
(recruiting and credentialing do not schedule; billing is a later stage);
healthcare worker — none (own assignments are an identity rule:
`authz.is_own_active_worker`); facility admin/scheduler — shift.view,
shift.request; facility supervisor — shift.view (who is coming). Facility
capabilities are effective only through `authz.has_relationship_capability`.
They are not AAL2-privileged: shift work is high-frequency operational work
that changes no person, client record, commercial term or credential decision,
and every assignment is independently gated server-side (compliance, tenancy,
capacity, schedule).

Assignment operations (P0-E5-S2) add **no capabilities**: offers reuse
`assignment.manage` (an offer is an invitation to an assignment and passes the
same gate on acceptance); re-checking readiness needs `assignment.manage` +
`compliance.view`; issues and the operations surface need `assignment.view`
(+ `compliance.view` for issue reasons); delivery status needs
`assignment.view` and shows only deliveries to the caller's own organisation.
Workers act on their own offers by identity (`authz.is_own_active_worker`).
Facilities have no offer or issue access. The dispatcher is not an
application role: it is a database role limited to two functions.

Attendance capabilities (P0-E6-S1): `attendance.view` (see attendance,
exceptions, corrections), `attendance.review` (approve/reject corrections,
resolve exceptions), `attendance.manage_settings` (timing rules, geofences —
**privileged, AAL2**), `attendance.location.view` (raw clock-action
coordinates — **privileged, AAL2**, every read audited). Admin — all four;
operations manager — view, review; scheduler — view; recruiter, credentialing
officer, finance — none; healthcare worker — none (own attendance is an
identity rule); facility admin/scheduler/supervisor — view, effective only
through `authz.has_relationship_capability` and only via the narrow facility
projection (no coordinates, no exception detail). Reviewers can never review
their own attendance.

Timesheet capabilities (P0-E6-S2, none AAL2-privileged): `timesheet.view`
(agency timesheets and entries) — admin, operations manager, scheduler,
finance (later payroll/billing consume approved timesheets);
`timesheet.approve` (approve, return, reopen, answer discrepancies,
recalculate) — admin, operations manager; `timesheet.facility_signoff`
(sign off or dispute entries at the caller's facility) — facility admin and
facility supervisor, effective only through the linked relationship.
Recruiter, credentialing officer, healthcare worker and facility scheduler:
none. A worker submits their **own** timesheet by identity
(`authz.is_own_active_worker`), never by capability, and can never approve
it; approvers can never approve their own timesheet. Correction review that
would change an approved timesheet additionally requires `timesheet.approve`.
Retention settings use `attendance.manage_settings`; legal holds use
`attendance.location.view` (both AAL2).

Financial capabilities (P0-E7-S1): `rates.view` — admin, finance, operations
manager; `rates.manage` (**privileged, AAL2**) — admin, finance;
`pricing.view` — admin, finance, operations manager; `pricing.run` — admin,
finance. Scheduler, recruiter, credentialing officer, healthcare worker and
every facility role hold none: facilities and workers never see pay rates,
margin or pricing. See
[../security/FINANCIAL_DATA_ACCESS.md](../security/FINANCIAL_DATA_ACCESS.md).

Least-privilege notes: `relationship.manage` (commercial state) is owner-only;
recruiters do not see client data; finance does not see workers; credentialing
officers do not see internal notes (credentials arrive later).

Healthcare roles differ mainly in _future_ domain capabilities; today they
share the identity-stage capabilities above. Platform Admin is **not** a role
(§8).

A member may hold several roles in one organisation; effective capabilities
are the union.

## 4. Where authorization is evaluated

| Layer                                    | Responsibility                                                                                                                   | Authoritative? |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | :------------: |
| UI (React)                               | Hide/disable controls using `my_capabilities()`; prompt MFA step-up                                                              |       No       |
| Proxy                                    | Refresh session; no decisions                                                                                                    |       No       |
| Server Action                            | Validate input, require identity, name the organisation, call the RPC, map errors                                                | No (adds none) |
| **RPC** (`public.*`, `SECURITY DEFINER`) | Require identity, derive organisation, require capability (AAL2), ceiling, no-self, state rules, mutate, audit — one transaction |    **Yes**     |
| **RLS** (policies calling `authz.*`)     | Row visibility for every read                                                                                                    |    **Yes**     |
| Constraints / composite FKs / triggers   | Cross-tenant integrity, immutability, append-only                                                                                |    **Yes**     |

## 5. Helpers

`authz` schema — EXECUTE granted to `authenticated`; not exposed as API
endpoints (schema not in the Data API); used by RLS:

| Helper                                | Returns                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `authz.current_profile_id()`          | caller's profile id if active, else NULL                                                                                  |
| `authz.current_aal()`                 | `'aal2'` only if the JWT says so; otherwise `'aal1'` (fails closed)                                                       |
| `authz.has_capability(org, key)`      | **the primitive**: active profile + active org + active membership + unrevoked role granting `key` + (AAL2 if privileged) |
| `authz.is_org_member(org)`            | active membership in a non-archived org                                                                                   |
| `authz.is_own_membership(membership)` | membership belongs to the caller                                                                                          |
| `authz.can_view_profile(profile)`     | self, or target is a member of an org where caller has `membership.view`                                                  |
| `authz.is_platform_admin()`           | active platform grant AND AAL2                                                                                            |

`internal` schema — no API role can execute; used inside RPCs:
`profile_capabilities`, `require_identity`, `require_capability` (raises
`CH402` step-up / `CH403`), `require_platform_admin`, `role_within_ceiling`,
`membership_within_ceiling`, `assert_owner_remains`, `record_audit_event`,
`consume_rate_limit`, invite token helpers, operator procedures.

Every helper: fixed `search_path = ''`, fully-qualified names, narrow return
type, EXECUTE revoked from PUBLIC. pgTAP enforces an explicit allow-list of
every function executable by `authenticated`; adding a function without
updating the list fails CI.

Added in P0-E3-S3:

| Helper                                                 | Returns                                                                                                                                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authz.is_own_active_membership(membership)`           | the membership is the caller's AND live (active membership, active profile, non-archived org) — worker self-access                                                                                                                          |
| `authz.has_relationship_capability(relationship, key)` | relationship not ended, client record explicitly linked to a facility org, caller holds `key` in THAT facility org — the only cross-organisation primitive ([../security/CROSS_ORG_DATA_SHARING.md](../security/CROSS_ORG_DATA_SHARING.md)) |

Added in P0-E4-S1: `authz.can_access_shared_credential(credential, key)`
(active share + active membership + capability in that agency),
`authz.can_read_credential_document(document)` and its Storage twins
`can_read/upload/delete_credential_object(path)` — the single source for both
table RLS and Storage policies.

Added in P0-E4-S1: `authz.can_access_shared_credential(credential, key)`
(active share + active membership + capability in that agency),
`authz.can_read_credential_document(document)` and its Storage twins
`can_read/upload/delete_credential_object(path)` — the single source for both
table RLS and Storage policies.

`authz.can_view_profile` also admits `worker.view` holders for that agency's workers.

Deliberately absent: any `has_role()` helper (would invite role-name checks),
and any unscoped "my organisation"/"my staff" helper.

Payroll and invoice capabilities (P0-E7-S2):

| Capability        | Privileged (AAL2) | admin | finance | operations manager | others |
| ----------------- | ----------------- | ----- | ------- | ------------------ | ------ |
| `payroll.view`    | no                | ✓     | ✓       | ✓                  | —      |
| `payroll.prepare` | no                | ✓     | ✓       | —                  | —      |
| `payroll.approve` | **yes**           | ✓     | ✓       | —                  | —      |
| `payroll.export`  | **yes**           | ✓     | ✓       | —                  | —      |
| `invoice.view`    | no                | ✓     | ✓       | ✓                  | —      |
| `invoice.prepare` | no                | ✓     | ✓       | —                  | —      |
| `invoice.approve` | **yes**           | ✓     | ✓       | —                  | —      |
| `invoice.export`  | **yes**           | ✓     | ✓       | —                  | —      |

- Scheduler, recruiter, credentialing, worker and every facility role hold
  none of these.
- Platform admins have no tenant path.
- No separate `financial_exports.view` exists. Export metadata follows
  `payroll.view` / `invoice.view`; downloading needs `*.export`.
- See [../security/FINANCIAL_EXPORT_SECURITY.md](../security/FINANCIAL_EXPORT_SECURITY.md)
  for the AAL2 decision.

Adjustments (P0-E7-S3) reuse the payroll and invoice capabilities; no new
capability was added.

- **Prepare, review, cancel/void before approval:** `*.prepare`.
- **Approve and lock:** `*.approve` (AAL2).
- **Export and download:** `*.export` (AAL2).
- **Maker/checker:** optional, default off; the preparer may not approve.
  See [MAKER_CHECKER_POLICY.md](MAKER_CHECKER_POLICY.md).
- **Audited refusals:** approvals and downloads return their refusals (see
  [../security/FINANCIAL_DENIAL_AUDIT.md](../security/FINANCIAL_DENIAL_AUDIT.md)).

## 6. RLS strategy

| Table                                        | SELECT policy                                                                                | Writes                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `profiles`                                   | `can_view_profile(id)`                                                                       | UPDATE own `display_name` only (column grant + policy) |
| `organisations`                              | `is_org_member(id)`                                                                          | RPC only                                               |
| `organisation_memberships`                   | own row, or `has_capability(org, 'membership.view')`                                         | RPC only                                               |
| `membership_roles`                           | own membership, or `membership.view` in that org                                             | RPC only                                               |
| `roles`, `capabilities`, `role_capabilities` | any authenticated (reference data)                                                           | migrations only                                        |
| `organisation_invites`                       | **no grant at all** (token hash)                                                             | RPC only; listing via `list_organisation_invites`      |
| `platform_admins`                            | own grant rows only                                                                          | operator procedure only                                |
| `agency_workers`                             | `worker.view` in the agency, or own record while membership is live                          | RPC only                                               |
| `agency_worker_notes`                        | `worker.notes.view`, never notes about oneself                                               | RPC only (append-only)                                 |
| `agency_facilities`, `facility_locations`    | `facility.view` in the agency                                                                | RPC only                                               |
| `agency_facility_relationships`              | `relationship.view` in the agency, or `has_relationship_capability(id, 'relationship.view')` | RPC only                                               |
| `facility_types`                             | any authenticated (reference)                                                                | migrations only                                        |
| `audit_events`                               | own actions, or `audit.view` (AAL2) in that org                                              | `internal.record_audit_event` only                     |
| `internal.rate_limit_counters`               | none                                                                                         | internal only                                          |

Future tenant tables follow the same template:
`using (authz.has_capability(organisation_id, '<domain>.view'))`, with writes
through RPCs for any sensitive state transition.

## 7. Invitations

| Property                         | Mechanism                                                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strong token                     | 256 bits from `pgcrypto`, base64url (43 chars)                                                                                                           |
| Hashed at rest                   | only `sha256(token)` stored; table has no API grants                                                                                                     |
| Shown only when needed           | returned once to the issuer by `create`/`resend`; never listed, never logged, never in audit metadata                                                    |
| Expiry                           | 7 days                                                                                                                                                   |
| Single use                       | `pending → accepted`; replays return the uniform empty result                                                                                            |
| Resend rotates                   | new token; the old hash is overwritten; expiry reset; max 5 sends                                                                                        |
| Uniform pre-auth response        | there is **no anonymous validation endpoint**; `/invite/<token>` behaves identically for every token                                                     |
| No PII in validation             | preview returns organisation name + role only; never emails                                                                                              |
| Server-side acceptance           | `accept_organisation_invite(token)` — the only parameter is the token                                                                                    |
| Email binding                    | caller's **verified** `auth.users.email` must equal the invited email                                                                                    |
| Organisation/role server-derived | from the invite row; the client cannot supply either                                                                                                     |
| Throttling                       | 20 preview/accept attempts per identity per 15 min; invalid attempts return normally so the counter commits                                              |
| Stale issuer authority           | at redemption the issuer must still hold `membership.invite` and every capability of the role (or still be a platform admin for platform-issued invites) |
| Audited                          | `invite.created/resent/revoked/accepted/acceptance_failed`                                                                                               |

Invalid, expired, revoked, already-used, wrong-email, unverified-email and
stale-issuer cases are indistinguishable to the caller.

## 8. Platform administration

- `platform_admins` grant + AAL2 session. Not a membership: platform admins
  are members of no tenant and RLS gives them **no** tenant rows.
- Platform operations are narrow RPCs that return only what they need:
  `platform_list_organisations` (summary + member count),
  `platform_create_organisation` (org + owner invitation),
  `platform_set_organisation_status`, `platform_set_profile_status`.
- **Every** platform call — reads included — writes an audit event with the
  session AAL.
- Grants are operator procedures executed by the database owner role:
  `select internal.grant_platform_admin('<profile uuid>', '<operator name>', '<reason>');`
  (and `internal.revoke_platform_admin`). They are unreachable through the
  API and are audited with the named operator. See
  DATABASE_MIGRATION_POLICY.md §11.
- No service-role key is used anywhere.

## 9. MFA / AAL2 policy

| Question                           | Answer                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who must use MFA?                  | Anyone exercising a privileged capability, and all platform admins.                                                                                                                                                                                                                                                                                                                     |
| Is enrolment mandatory at sign-up? | No. Privileged capabilities simply do not work at AAL1; the UI routes the user to enrol/step up. Workers without privileged capabilities are not forced to enrol.                                                                                                                                                                                                                       |
| Factor                             | TOTP (Supabase Auth).                                                                                                                                                                                                                                                                                                                                                                   |
| Where is AAL2 checked?             | **RLS/helper layer:** `authz.has_capability` (privileged capabilities) and `authz.is_platform_admin`. **RPC layer:** `internal.require_capability` / `require_platform_admin` raise `CH402` so the UI can prompt step-up. **Server Actions:** map `CH402` → `MFA_REQUIRED`. **UI:** `my_capabilities().is_satisfied` shows the step-up notice. The UI and actions are convenience only. |
| Source of AAL                      | The `aal` claim of the Supabase-signed JWT; missing/unknown → AAL1.                                                                                                                                                                                                                                                                                                                     |

## 10. Future scoped permissions

Today every capability is organisation-wide. Narrower scopes (facility site,
department, team) will be added without redesign:

1. Add nullable `scope_type` / `scope_id` to `membership_roles` (NULL =
   organisation-wide), with composite FKs to the scope tables (which carry
   `organisation_id`, so scopes cannot cross tenants).
2. Add `authz.has_capability(org, key, scope_type, scope_id)` that accepts an
   organisation-wide grant **or** a grant at the given scope (or an ancestor
   scope, once hierarchies exist). The two-argument form remains the
   organisation-wide check.
3. Domain RLS for scoped tables calls the four-argument form with the row's
   own scope columns.
4. The capability ceiling compares (capability, scope) pairs.

Nothing in the current schema or helper contracts prevents this.

## 11. Server Action pattern

```ts
export async function doThingAction(_state: ActionState, formData: FormData) {
  return runAction("feature.doThing", async () => {
    const input = parseInput(schema, formDataToObject(formData)); // 1. validate
    await requireAuthIdentity();                                   // 2. identity
    const supabase = await createSupabaseServerClient();           // 3. as the user
    const { data, error } = await supabase.rpc("do_thing", {       // 4. RPC: authorise,
      p_organisation_id: input.organisationId,                     //    mutate, audit
      ...
    });
    if (error) throw error;                                        // 5. normalised → safe code
    revalidatePath(...);
    return data;                                                   // 6. ActionResult
  });
}
```

Actions never: read the active-organisation cookie for decisions, accept a
role or capability as trusted input, skip the RPC because the UI already
hid the button, or use a privileged key.

## 12. Error codes

| SQLSTATE                    | App code                                                                                                                                                                                                                                                                                                                         | Meaning                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `CH400`                     | `VALIDATION_FAILED`                                                                                                                                                                                                                                                                                                              | invalid input for the operation                                          |
| `CH401`                     | `AUTH_REQUIRED`                                                                                                                                                                                                                                                                                                                  | no active identity                                                       |
| `CH402`                     | `MFA_REQUIRED`                                                                                                                                                                                                                                                                                                                   | capability held, but session is not AAL2                                 |
| `CH403`                     | `FORBIDDEN`                                                                                                                                                                                                                                                                                                                      | not permitted (also used for unknown targets — no existence oracle)      |
| `CH404`                     | `NOT_FOUND`                                                                                                                                                                                                                                                                                                                      | target missing after authorization succeeded                             |
| `CH409`                     | `INVALID_STATE_TRANSITION`                                                                                                                                                                                                                                                                                                       | lifecycle rule violated                                                  |
| `CHW09` / `CHR09` / `CHF09` | `INVALID_WORKER_STATE` / `INVALID_RELATIONSHIP_STATE` / `INVALID_STATE_TRANSITION`                                                                                                                                                                                                                                               | domain lifecycle rule violated                                           |
| `CHW04` / `CHF04` / `CHR04` | `WORKER_NOT_FOUND` / `FACILITY_NOT_FOUND` / `RELATIONSHIP_NOT_FOUND`                                                                                                                                                                                                                                                             | target missing after authorization                                       |
| `CHS04` / `CHA04`           | `SHIFT_NOT_FOUND` / `ASSIGNMENT_NOT_FOUND`                                                                                                                                                                                                                                                                                       | missing or not visible (no oracle)                                       |
| `CHS09` / `CHA09`           | `SHIFT_NOT_OPEN` / `ASSIGNMENT_NOT_ACTIONABLE`                                                                                                                                                                                                                                                                                   | shift/assignment lifecycle rule violated                                 |
| `CHS10` / `CHS11`           | `RELATIONSHIP_NOT_ACTIVE` / `FACILITY_LOCATION_INVALID`                                                                                                                                                                                                                                                                          | relationship not active / location not of this facility                  |
| `CHS12`–`CHS16`             | `DISCIPLINE_MISMATCH`, `WORKER_NOT_ACTIVE`, `WORKER_NOT_ELIGIBLE`, `WORKER_SCHEDULE_CONFLICT`, `SHIFT_FULL`                                                                                                                                                                                                                      | eligibility (acceptance re-check; capacity backstop)                     |
| `CHO04` / `CHO09` / `CHO10` | `OFFER_NOT_FOUND` / `OFFER_NOT_ACTIONABLE` / `OFFER_EXPIRED`                                                                                                                                                                                                                                                                     | offer missing or not own / closed / expired                              |
| (decision row)              | `ASSIGNMENT_ALREADY_EXISTS` and the codes above                                                                                                                                                                                                                                                                                  | refused assignment returned as a recorded decision, mapped by the server |
| `CHT04`–`CHT18`             | `ATTENDANCE_NOT_FOUND`, `ASSIGNMENT_NOT_ACCEPTED`, `SHIFT_CANCELLED`, `TOO_EARLY/LATE_TO_CLOCK_IN`, `ALREADY_CLOCKED_IN/OUT`, `NOT_CLOCKED_IN`, `GEOFENCE_REQUIRED`, `LOCATION_UNAVAILABLE`, `LOCATION_ACCURACY_TOO_LOW`, `OUTSIDE_GEOFENCE`, `CORRECTION_NOT_ALLOWED`, `CORRECTION_ALREADY_REVIEWED`, `CLOCK_OUT_WINDOW_CLOSED` | attendance rules (refused clock-ins return a recorded refusal)           |
| `CHT19`–`CHT22`             | `ALREADY_ON_BREAK`, `NOT_ON_BREAK`, `ON_BREAK`, `TIMESHEET_REVISION_REQUIRED`                                                                                                                                                                                                                                                    | break state / change to an approved timesheet needs a confirmed revision |
| `CHP04`–`CHP15`             | `TIMESHEET_NOT_FOUND`, `TIMESHEET_NOT_ACTIONABLE`, `TIMESHEET_ENTRY_NOT_FOUND`, `SIGNOFF_NOT_ACTIONABLE`, `TIMESHEET_REVISION_CONFLICT`, `TIMESHEET_SETTINGS_LOCKED`                                                                                                                                                             | timesheet lifecycle (blocked submission/approval returns reason codes)   |
| `CHY12`–`CHY21`             | `ADJUSTMENT_NOT_REQUIRED`, `ADJUSTMENT_ALREADY_EXISTS`, `ADJUSTMENT_SOURCE_NOT_LOCKED`, `ADJUSTMENT_SOURCE_NOT_PRICED`, `ADJUSTMENT_ORIGINAL_NOT_FINAL`, `ADJUSTMENT_CURRENCY_MISMATCH`, `ADJUSTMENT_ZERO_DELTA`, `ADJUSTMENT_NOT_FOUND`, `DOCUMENT_HAS_ADJUSTMENTS` (+ app-level `MAKER_CHECKER_REQUIRED`)                      | financial adjustments (P0-E7-S3)                                         |
| `CHY01`–`CHY10`             | `PAYROLL_NOTHING_TO_PREPARE`, `FINANCIAL_SOURCE_SUPERSEDED`, `FINANCIAL_DOCUMENT_LOCKED`, `INVALID_FINANCIAL_TRANSITION`, `PAYROLL_PERIOD_INVALID`, `PAYROLL_BATCH_NOT_FOUND`, `INVOICE_DRAFT_NOT_FOUND`, `FINANCIAL_EXPORT_NOT_FOUND`, `INVOICE_NOTHING_TO_DRAFT`, `FINANCIAL_LINE_ALREADY_INCLUDED`                            | payroll/invoice preparation (P0-E7-S2)                                   |
| `CHM01`–`CHM15`             | `RATE_NOT_CONFIGURED`, `RATE_AMBIGUOUS`, `RATE_NOT_ACTIVE`, `RATE_NOT_FOUND`, `RATE_CURRENCY_MISMATCH`, `TIMESHEET_NOT_LOCKED`, `TIMESHEET_REVISION_CHANGED`, `INVALID_RATE`, `INVALID_EFFECTIVE_PERIOD`, `OVERLAPPING_RATE_VERSION`, `ROUNDING_POLICY_INVALID`, `OVERTIME_POLICY_INVALID`, `PRICING_NOT_FOUND`                  | rate/pricing rules (blocked pricing returns issue codes)                 |
| `CH429`                     | `RATE_LIMITED`                                                                                                                                                                                                                                                                                                                   | throttled                                                                |
| (empty result)              | `INVITE_INVALID`                                                                                                                                                                                                                                                                                                                 | invitation cannot be redeemed (uniform)                                  |
