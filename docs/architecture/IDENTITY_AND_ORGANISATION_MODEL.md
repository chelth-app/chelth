# Identity & Organisation Model

Status: P0-E3-S2. Normative for every later stage. Companion documents:
[AUTHORIZATION_MODEL.md](AUTHORIZATION_MODEL.md) (what identities may do) and
[../security/THREAT_MODEL_IDENTITY.md](../security/THREAT_MODEL_IDENTITY.md).

## 1. Identity vs authorization

| Concept           | Question                                   | Where it lives                                                       | Changes                                |
| ----------------- | ------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------- |
| **Identity**      | _Who is this person?_                      | Supabase Auth (`auth.users`) + `public.profiles`                     | Sign-up, email change, MFA enrolment   |
| **Authorization** | _What may they do, in which organisation?_ | memberships → role assignments → capabilities, evaluated in Postgres | Invitations, role changes, suspensions |

Authentication never implies authorization. A verified identity with no
membership can do exactly three things: manage its own profile, redeem an
invitation addressed to it, and create a new agency.

**Forbidden model:** `user → one workspace → one global role`. Chelth uses:

```
identity (profile)
  └─ memberships  (one per organisation)
        └─ role assignments  (many, history-preserving)
              └─ capabilities  (namespaced keys, some privileged/AAL2)
```

Example (supported and tested):

| Identity | Organisation   | Role(s)             |
| -------- | -------------- | ------------------- |
| User A   | Agency Alpha   | Recruiter           |
| User A   | Agency Beta    | Healthcare Worker   |
| User A   | Facility Gamma | Facility Supervisor |

## 2. Entities

```
auth.users 1──1 profiles 1──* organisation_memberships *──1 organisations
                   │                    │
                   │                    1──* membership_roles *──1 roles *──* capabilities
                   │                                                  (role_capabilities)
                   ├──* platform_admins            (separate platform privilege)
                   └── (actor of) audit_events     (append-only)
organisations 1──* organisation_invites  (token hash only)
```

| Table                          | Purpose                                                           | Why it exists                                                                                    |
| ------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `profiles`                     | Application identity, 1:1 with `auth.users` (`id` = auth user id) | Anchor for FKs and RLS without exposing `auth` schema; holds display name + platform status only |
| `organisations`                | Tenant (agency or facility)                                       | Every tenant-scoped row will reference it                                                        |
| `organisation_memberships`     | Profile ↔ organisation, with lifecycle                            | Makes multi-organisation identities first-class                                                  |
| `roles`                        | Named capability bundles, bound to one organisation type          | Admin-friendly grants; never compared in code                                                    |
| `capabilities`                 | Namespaced permission vocabulary                                  | The only thing authorization checks                                                              |
| `role_capabilities`            | Role → capability mapping                                         | Normalised; changing a role's power is one reviewed migration                                    |
| `membership_roles`             | Role assignments on memberships                                   | Membership-scoped roles; revocation keeps history                                                |
| `organisation_invites`         | Pending invitations                                               | Invitees may not have an identity yet                                                            |
| `platform_admins`              | Platform privilege grants                                         | Deliberately NOT a membership                                                                    |
| `audit_events`                 | Append-only audit log                                             | Accountability for access and state changes                                                      |
| `internal.rate_limit_counters` | Throttling                                                        | Invitation redemption, org creation, invite issuance                                             |

No table stores a "global role", "active organisation" or "workspace role".
This is enforced by a pgTAP column test on `profiles`.

## 3. Profiles

- Created by trigger `on_auth_user_created` for every new auth user.
- Only `display_name` is read from sign-up metadata (length-limited, control
  characters discarded). Metadata is user-controlled and is never used for
  authorization.
- Users may update **only** their own `display_name` (column-level grant +
  RLS). `status` (`active | suspended`) is changed only by a platform admin RPC.
- A suspended profile holds no capabilities anywhere and cannot act through
  any RPC (`authz.current_profile_id()` returns NULL).
- Email lives only in `auth.users` (PII minimisation). Server-side functions
  read the **verified** email from `auth.users`, never from JWT claims.
- Deleting an auth user with memberships is blocked (`on delete restrict`):
  account erasure is a deliberate future process that must preserve audit.

## 4. Organisations

- `type`: enum `agency | facility`. New types are added by migration
  (`alter type … add value`) together with their roles. Application code uses
  the generated enum type — no free-text type strings.
- `type` is immutable (trigger). `(id, type)` is unique so role assignments
  and invites can bind to it with composite FKs.
- `slug`: stable, URL-safe identifier (`[a-z0-9-]`, 3–63). Self-serve slugs
  get a random suffix (non-enumerable, collision-resistant).
- `status`: `active | suspended | archived`. Suspended: members still see
  the organisation but hold no capabilities. Archived: invisible. Organisations
  are never deleted.
- No healthcare operational fields. Agency/facility domain data belongs to
  later tables keyed by `organisation_id`.

### Creation (the only creation paths)

| Path                                                          | Who                                                  | Result                                                                                                |
| ------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `create_organisation('agency', name, slug)`                   | Any active identity with a **verified email**; 5/day | Organisation + creator's membership + server-derived owner role (`agency.admin`), atomically, audited |
| `platform_create_organisation(type, name, slug, owner_email)` | Platform admin at AAL2                               | Organisation + owner **invitation**; the platform admin does not become a member                      |

Facilities are not self-serve. Sign-up alone never grants any role.

## 5. Membership lifecycle

```
            invitation accepted / organisation created
                          │
                          ▼
   ┌────────────── active ◀──────────────┐
   │  suspend         │                  │ reinstate
   ▼                  │ revoke           │
suspended ────────────┼──────────────────┘
   │ revoke           ▼
   └────────────▶ revoked ── re-admission only by a NEW invitation
```

| State       | Access                                       | Roles                                                                               |
| ----------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `active`    | Capabilities from unrevoked role assignments | Kept                                                                                |
| `suspended` | None (organisation hidden, no capabilities)  | Kept (restored on reinstatement)                                                    |
| `revoked`   | None                                         | **All ended** on revocation, so re-admission never silently restores old privileges |

- One membership row per (organisation, profile); lifecycle is a status change.
- `organisation_id` / `profile_id` are immutable (trigger).
- Nobody can change their own membership status or roles.
- Invitation state is not a membership state: it lives in `organisation_invites`
  because the invitee may not have an identity yet (deviation from the
  suggested `invited` membership status, by design).

## 6. Invitations

See [AUTHORIZATION_MODEL.md §7](AUTHORIZATION_MODEL.md#7-invitations) for the
authorization rules. Lifecycle: `pending → accepted | revoked` (expiry is
time-based, `expires_at`, 7 days).

User journey:

1. Issuer (holder of `membership.invite` at AAL2) creates an invitation for an
   email and a role within their ceiling. The raw link is shown **once** to the
   issuer (email delivery is a later stage).
2. Invitee opens `/invite/<token>` → the token is moved into a 1-hour httpOnly
   cookie and the browser is redirected to `/invite` (token leaves the
   address bar; the page is identical for any token).
3. Invitee signs in or signs up **with the invited email** and verifies it.
4. `/invite` shows the organisation and role (throttled, validated preview).
5. Accept → membership created (or a revoked one reactivated) with exactly the
   invited role; the invite becomes `accepted`; everything is audited.

## 7. Active organisation context

- The database has no notion of an active organisation.
- Every RPC names the organisation explicitly or derives it from the target
  row (membership, invite). RLS evaluates per row, per organisation.
- The web app remembers the last opened organisation in a cookie
  (`chelth_active_org`). It only reorders the list on `/app`; nothing is
  auto-selected and there is no "first membership wins" rule. Server Actions
  never read it.
- Organisation pages are addressed by id: `/app/organisations/<uuid>`.
  Non-members get a 404 indistinguishable from a non-existent organisation.

## 8. Authentication flows (Supabase Auth)

| Flow                      | Route                                             | Notes                                                                                      |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Sign up                   | `/sign-up`                                        | Identity only. Uniform "check your email" response (no account enumeration)                |
| Email verification        | `/auth/confirm?token_hash&type=email`             | Server-side `verifyOtp`; then `/app`                                                       |
| Sign in                   | `/sign-in`                                        | Uniform invalid-credentials error; unverified email is told to verify                      |
| Password reset request    | `/forgot-password`                                | Uniform response for known/unknown emails                                                  |
| Password reset completion | `/auth/confirm?type=recovery` → `/reset-password` | Requires the recovery session; recovery ALWAYS lands on `/reset-password` (`next` ignored) |
| Sign out                  | POST action                                       | Local scope; never a GET link                                                              |
| MFA enrolment             | `/app/security`                                   | TOTP (QR + setup key)                                                                      |
| MFA step-up               | `/app/security/verify`                            | Raises session to AAL2                                                                     |

**Hosted templates must link to `/auth/confirm` with `token_hash`.** Supabase's
default templates (`{{ .ConfirmationURL }}`) send users to GoTrue `/verify`,
which redirects to the Site URL root with a PKCE `code` that Chelth does not
exchange — the user lands on the landing page (see
`docs/reports/P0-E3-S2B-password-recovery-hosted-fix.txt`).
`tests/unit/supabase/email-templates.test.ts` pins the expected links.

Email links use the `token_hash` flow. Templates live in
`supabase/templates/` and are referenced from `supabase/config.toml`.
**Hosted projects must use the same templates and Site URL** (release
checklist item until hosted auth config is automated).

No social/OAuth providers are enabled. Facebook login will not be enabled.

## 9. Future evolution (designed for, not built)

- **Agency ↔ facility relationships:** a relationship table between two
  organisations with its own lifecycle and capabilities (e.g.
  `relationship.manage`); cross-organisation reads will be granted by explicit
  relationship-aware policies, never by making members of one tenant members
  of the other.
- **Workers across multiple agencies:** already supported — one identity,
  one membership per agency, each with its own `agency.healthcare_worker`
  assignment. Worker domain records (P0-E4+) will key on
  `(organisation_id, membership_id)`.
- **Narrower scopes (facility site, department, team):** see
  [AUTHORIZATION_MODEL.md §10](AUTHORIZATION_MODEL.md#10-future-scoped-permissions).
- **Enterprise SSO / SCIM:** additional identity providers attach to the same
  profile; memberships remain the authorization source.
