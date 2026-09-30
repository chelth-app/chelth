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

| Capability            | Privileged (AAL2) | Meaning                                                 |
| --------------------- | :---------------: | ------------------------------------------------------- |
| `organisation.view`   |                   | See the organisation                                    |
| `organisation.manage` |         ✔         | Organisation settings/status (reserved for owner roles) |
| `membership.view`     |                   | See members, their roles and profiles                   |
| `membership.invite`   |         ✔         | Issue, resend, revoke and list invitations              |
| `membership.manage`   |         ✔         | Suspend, reinstate, revoke memberships                  |
| `role.assign`         |         ✔         | Assign and revoke roles                                 |
| `audit.view`          |         ✔         | Read the organisation audit history                     |

Self-service identity actions (edit own name, enrol MFA, redeem an invitation
addressed to you) are **identity-scoped**, not organisation capabilities, so
there is no `identity.manage_self` row: they are authorised by being the
identity (`auth.uid()`), enforced by RLS/column grants and RPC checks.

Reserved namespaces for later stages (not created yet): `worker.*`,
`credential.*`, `shift.*`, `assignment.*`, `timesheet.*`, `rate.*`,
`invoice.*`, `payroll.*`, `relationship.*`. Each stage adds only the
capabilities it implements, in its own migration, with role mappings.

## 3. Roles

Roles are bundles of capabilities bound to one organisation type (the key
prefix equals the type; enforced by a check constraint). Exactly one owner
role per type is granted to an organisation's creator.

| Role                   | Type     | Capabilities                                                 |
| ---------------------- | -------- | ------------------------------------------------------------ |
| Agency Admin (owner)   | agency   | all seven                                                    |
| Operations Manager     | agency   | view, membership.view/invite/manage, role.assign, audit.view |
| Recruiter              | agency   | organisation.view, membership.view, membership.invite        |
| Scheduler              | agency   | organisation.view, membership.view                           |
| Credentialing Officer  | agency   | organisation.view, membership.view                           |
| Finance                | agency   | organisation.view, membership.view                           |
| Healthcare Worker      | agency   | organisation.view                                            |
| Facility Admin (owner) | facility | all seven                                                    |
| Facility Scheduler     | facility | organisation.view, membership.view                           |
| Facility Supervisor    | facility | organisation.view, membership.view                           |

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

Deliberately absent: any `has_role()` helper (would invite role-name checks),
and any unscoped "my organisation"/"my staff" helper.

## 6. RLS strategy

| Table                                        | SELECT policy                                        | Writes                                                 |
| -------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| `profiles`                                   | `can_view_profile(id)`                               | UPDATE own `display_name` only (column grant + policy) |
| `organisations`                              | `is_org_member(id)`                                  | RPC only                                               |
| `organisation_memberships`                   | own row, or `has_capability(org, 'membership.view')` | RPC only                                               |
| `membership_roles`                           | own membership, or `membership.view` in that org     | RPC only                                               |
| `roles`, `capabilities`, `role_capabilities` | any authenticated (reference data)                   | migrations only                                        |
| `organisation_invites`                       | **no grant at all** (token hash)                     | RPC only; listing via `list_organisation_invites`      |
| `platform_admins`                            | own grant rows only                                  | operator procedure only                                |
| `audit_events`                               | own actions, or `audit.view` (AAL2) in that org      | `internal.record_audit_event` only                     |
| `internal.rate_limit_counters`               | none                                                 | internal only                                          |

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

| SQLSTATE       | App code                   | Meaning                                                             |
| -------------- | -------------------------- | ------------------------------------------------------------------- |
| `CH400`        | `VALIDATION_FAILED`        | invalid input for the operation                                     |
| `CH401`        | `AUTH_REQUIRED`            | no active identity                                                  |
| `CH402`        | `MFA_REQUIRED`             | capability held, but session is not AAL2                            |
| `CH403`        | `FORBIDDEN`                | not permitted (also used for unknown targets — no existence oracle) |
| `CH404`        | `NOT_FOUND`                | target missing after authorization succeeded                        |
| `CH409`        | `INVALID_STATE_TRANSITION` | lifecycle rule violated                                             |
| `CH429`        | `RATE_LIMITED`             | throttled                                                           |
| (empty result) | `INVITE_INVALID`           | invitation cannot be redeemed (uniform)                             |
