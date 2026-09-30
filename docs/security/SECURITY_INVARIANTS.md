# Security Invariants

These are non-negotiable properties of Chelth. A change that violates one is a
defect regardless of how it was reviewed. Each invariant lists how it is
**enforced** today and what later stages must add.

Chelth handles healthcare workforce data: identities, professional
registrations, right-to-work and compliance documents, pay and bill rates.
Leaks and cross-tenant exposure have regulatory and human consequences.

| #   | Invariant                                                                               | Enforced now (P0-E3-S2)                                                                                                                                                                                          | Required later                                                                |
| --- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | **Tenant isolation is enforced by the database**, not only by UI or application checks. | RLS on every identity/organisation table via `authz.has_capability(row.organisation_id, …)`; composite FKs bind rows to one organisation; cross-tenant pgTAP + integration tests.                                | Same pattern for every domain table.                                          |
| 2   | **Service-role credentials never reach browser code.**                                  | No service-role key is used anywhere — app, tests or CI; lint ban; env validation; bundle scan; `local-supabase-env.mjs` exports only the anon key.                                                              | Any privileged path follows `src/lib/supabase/README.md` and is ADR-approved. |
| 3   | **Sensitive state transitions use server- or RPC-controlled mutation.**                 | All membership, role, invitation, organisation and platform writes are `SECURITY DEFINER` RPCs; `authenticated` holds only `SELECT` (+ own display name) — pgTAP-enforced.                                       | Shift/timesheet/invoice/credential transitions as RPCs.                       |
| 4   | **RLS is deny-by-default.**                                                             | Default privileges revoked; no `anon` grants anywhere; allow-listed function grants.                                                                                                                             | —                                                                             |
| 5   | **No tenant-sensitive table is exposed without deliberate RLS review.**                 | pgTAP: RLS on every table in `public`/`authz`/`internal`; explicit function allow-lists; PR template.                                                                                                            | Security sign-off per new table.                                              |
| 6   | **Cross-tenant tests are mandatory for tenant-aware tables.**                           | 184 pgTAP assertions incl. cross-tenant read/write denial; integration tests across organisations.                                                                                                               | Every new tenant-aware table ships its own.                                   |
| 7   | **Historical financial and compliance events are append-only.**                         | `audit_events` refuses UPDATE/DELETE/TRUNCATE for every role; role assignments are revoke-only history.                                                                                                          | Financial/compliance event tables follow the audit pattern.                   |
| 8   | **Production database state is reproducible from migrations.**                          | Roles, capabilities and mappings are migration reference data; CI resets from empty and checks type drift.                                                                                                       | Scheduled drift detection vs hosted projects.                                 |
| 9   | **Secrets are never committed.**                                                        | `.gitignore`, bundle scan, secret search each stage; invite tokens only hashed at rest.                                                                                                                          | GitHub secret scanning / push protection.                                     |
| 10  | **Privileged roles support MFA enforcement.**                                           | Privileged capabilities and platform admin require AAL2 in `authz.has_capability` / `is_platform_admin`; TOTP enrolment + step-up UI.                                                                            | "Recent MFA" window for platform actions.                                     |
| 11  | **Storage permissions align with database permissions.**                                | — (no buckets). Future policies will call the same `authz` helpers.                                                                                                                                              | Bucket policies via `authz.has_capability`.                                   |
| 12  | **Sensitive workforce documents never use public buckets.**                             | pgTAP: no bucket is public.                                                                                                                                                                                      | Private buckets + signed URLs.                                                |
| 13  | **UI hiding is not authorization.**                                                     | UI uses `my_capabilities()` for hints only; every RPC re-authorises; tests call RPCs directly as adversaries.                                                                                                    | —                                                                             |
| 14  | **Error messages never expose database internals.**                                     | `CH4xx` SQLSTATE convention → safe `AppError` codes; uniform invite/credential/reset responses.                                                                                                                  | —                                                                             |
| 15  | **Security regressions block production releases.**                                     | CI: lint, typecheck, unit, integration, E2E, pgTAP, migration checks, type drift, bundle scan.                                                                                                                   | Branch protection requiring CI.                                               |
| 16  | **Authorization is capability-based and organisation-explicit.**                        | No role-name checks; no active-organisation state in the database; every helper/RPC takes or derives the organisation.                                                                                           | —                                                                             |
| 17  | **Nobody can grant beyond their own authority.**                                        | No self role/membership changes; capability ceiling on assign, revoke, invite and membership management.                                                                                                         | Scoped ceilings (scope-aware).                                                |
| 18  | **Platform administration is separate from tenancy.**                                   | `platform_admins` is not a membership; no RLS bypass; narrow audited RPCs; operator-only grants.                                                                                                                 | —                                                                             |
| 19  | **Authorization is evaluated live.**                                                    | No roles/capabilities in JWT claims; suspension/revocation effective on the next request.                                                                                                                        | Keep it so (no custom access-token claims for authz).                         |
| 20  | **Invitation tokens are secrets.**                                                      | 256-bit, hashed at rest, shown once, single use, expiring, email-bound, throttled, never logged or audited.                                                                                                      | Email delivery must not log links.                                            |
| 21  | **A worker is a person, not a tenant object.**                                          | Worker records bind (membership, agency, person) by composite FK; one person, many agencies; no identity duplication.                                                                                            | Credentials owned by the person, shared per agency by consent.                |
| 22  | **Cross-organisation access is explicit and relationship-scoped.**                      | `authz.has_relationship_capability` is the only cross-org primitive; linked facilities see only their relationship via a narrow projection.                                                                      | Every shared resource follows CROSS_ORG_DATA_SHARING.md with tests.           |
| 23  | **Worker self-access is least privilege.**                                              | Workers read only their own record while their membership is live; cannot change it; never see internal notes.                                                                                                   | —                                                                             |
| 24  | **Worker/facility data never enters audit metadata.**                                   | Audit carries ids, status codes and changed-field names only (tested for notes, contacts).                                                                                                                       | —                                                                             |
| 25  | **No document storage without the storage model.**                                      | No buckets exist; DOCUMENT_STORAGE_MODEL.md defines private, DB-authorised, scanned, versioned storage.                                                                                                          | Implemented with credentials.                                                 |
| 26  | **Eligibility is derived, never stored.**                                               | No compliant flag exists; readiness comes only from `internal.evaluate_compliance` with reason codes.                                                                                                            | Done (P0-E5-S1): assignment calls the engine for every local shift date.      |
| 27  | **Credentials are person-owned and shared explicitly.**                                 | Shares bind the same person's membership; access needs an active share + active membership + capability; Agency B never inherits Agency A's verification.                                                        | —                                                                             |
| 28  | **Untrusted documents are never evidence.**                                             | Only `clean` documents count or can be opened by reviewers; no API can set `clean`; no production scanner yet ⇒ uploads stay `scanning`.                                                                         | Integrate a malware scanner.                                                  |
| 29  | **Storage authorization equals table authorization.**                                   | One helper drives both policies; pgTAP asserts parity per actor and trust state.                                                                                                                                 | Every future bucket follows the pattern.                                      |
| 30  | **Evidence history is immutable.**                                                      | Versions, documents, verifications, shares and requirements are append-only / revoke-only / deactivate-only (triggers).                                                                                          | —                                                                             |
| 31  | **No assignment without a server-side eligibility decision.**                           | `assign_worker_to_shift` evaluates compliance (shift facility, discipline, every local shift date), activity, discipline, capacity and person-level schedule; requires `ready`; records an append-only decision. | Scheduled re-evaluation (outbox consumer).                                    |
| 32  | **A person cannot be double-booked, across agencies.**                                  | Exclusion constraint on (profile, [start, end)) for active assignments; advisory lock per person; generic conflict code with no other-agency detail.                                                             | —                                                                             |
| 33  | **Capacity cannot be exceeded under concurrency.**                                      | Shift row lock in the RPC + capacity trigger backstop; concurrency integration tests.                                                                                                                            | —                                                                             |
| 34  | **Facilities see shifts only through their relationship, via narrow projections.**      | No facility RLS path to `shifts`/`shift_assignments`; audited assigned-worker projection with display name, discipline, state and readiness only.                                                                | —                                                                             |
| 35  | **Background delivery never uses a service-role key.**                                  | The dispatcher connects as a login role in `chelth_notification_worker`, which can execute exactly `claim_notifications` / `complete_notification` (pgTAP); the route requires a bearer secret.                  | Rotate the worker password and dispatch secret on a schedule.                 |
| 36  | **Notifications carry no secrets and cross no tenants.**                                | Outbox stores ids and codes only; address + template resolved at claim for an active member of the audience organisation; subject must belong to that tenant; escaped templates; no tokens or signed URLs.       | —                                                                             |
| 37  | **Delivery is exclusive, bounded and idempotent.**                                      | SKIP LOCKED + lease + claim token; retries 1m/5m/30m/2h then failed; stable provider idempotency key; `deliver_until` prevents stale sends.                                                                      | —                                                                             |
| 38  | **Offers never bypass the assignment gate.**                                            | Acceptance runs `perform_assignment` (compliance, schedule, capacity, decision record); expiry checked server-side; facilities have no path to offer data.                                                       | —                                                                             |
| 39  | **Operational change never silently destroys work.**                                    | Compliance changes open issues (never auto-cancel); suspension flags; only ending a relationship cancels not-yet-started work, audited with counts.                                                              | —                                                                             |

---

## Supporting rules

### Authentication vs authorization

- **Authentication** (Supabase Auth) establishes _who_ the person is.
  `src/lib/auth/session.ts` returns an identity (user id, email, verified flag)
  and nothing else.
- **Authorization** (designed in P0-E3-S2) decides _what_ they may do, from
  organisation membership and roles held in the database — never from JWT
  claims the user can influence, never from `user_metadata`.
- Healthcare roles are not hard-coded into authentication.
- On the server, identity comes from `supabase.auth.getUser()` /
  `getClaims()` (validated), never from `getSession()` alone.

### Input

- Every boundary (Server Action, Route Handler, form, external API response,
  environment) validates with a Zod schema (`src/lib/validation`).
- Tenant/organisation IDs are never trusted from the client for authorization;
  RLS and server lookups decide.
- Redirect targets pass through `getSafeRedirectPath`.

### Logging and monitoring

- Use `src/lib/logging` only (`no-console` is enforced in `src/`).
- Never log: passwords, tokens, cookies, authorization headers, form payloads,
  credential documents, national insurance / tax / registration numbers,
  dates of birth, health information, precise geolocation. The logger redacts
  these by key and scrubs JWTs, bearer tokens, Supabase keys and email
  addresses from strings — but redaction is a safety net, not permission.
- Error monitoring (Sentry, when approved) must: initialise per environment,
  disable default PII (`sendDefaultPii: false`), scrub request bodies and
  cookies, and upload source maps privately (never publish them).

### HTTP security headers

Set by `next.config.ts` (static) and `src/proxy.ts` (CSP with per-request nonce):

| Header                       | Value                                                                                                                                     | Notes                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Content-Security-Policy      | nonce + `'strict-dynamic'` scripts; nonce styles; `frame-ancestors 'none'`; `object-src 'none'`; `connect-src` limited to self + Supabase | **No `'unsafe-inline'` for scripts or styles in production.**                                                            |
| Strict-Transport-Security    | `max-age=63072000`                                                                                                                        | `includeSubDomains`/`preload` deferred until domain topology is confirmed (both are hard to undo).                       |
| X-Content-Type-Options       | `nosniff`                                                                                                                                 |                                                                                                                          |
| Referrer-Policy              | `strict-origin-when-cross-origin`                                                                                                         |                                                                                                                          |
| X-Frame-Options              | `DENY`                                                                                                                                    | Legacy complement to `frame-ancestors`.                                                                                  |
| Permissions-Policy           | `geolocation=(self)`; camera, microphone, payment, USB etc. disabled                                                                      | Geolocation kept for the future worker PWA clock-in. Camera may be enabled for `self` when document capture is designed. |
| Cross-Origin-Opener-Policy   | `same-origin`                                                                                                                             |                                                                                                                          |
| Cross-Origin-Resource-Policy | `same-origin`                                                                                                                             |                                                                                                                          |

**Documented relaxations (development builds only, never production):**
`'unsafe-eval'` for scripts (React dev tooling), `ws:` for hot reload, and
`style-src 'unsafe-inline'` (the Next.js dev overlay injects un-nonced styles;
browsers ignore `'unsafe-inline'` when a nonce is present, so dev omits the
style nonce). Production builds are verified violation-free by Playwright.

### Supabase Auth configuration (local, mirrored to hosted projects)

- Email confirmation required; secure password change (reauthentication).
- Password policy: ≥ 12 characters with lower, upper and digit
  (`supabase/config.toml` ⇄ `src/lib/validation/common.ts`).
- Anonymous sign-in disabled; manual identity linking disabled.
- No OAuth providers enabled. **Facebook login will not be enabled.** Any
  OAuth provider requires an approved decision first.
- TOTP MFA enabled for enrolment/verification.
- Hosted project auth settings must be kept in line with `config.toml`
  (verification of hosted settings is part of each release checklist until it
  can be automated via the Management API).

### Reporting a vulnerability

Do not open a public issue. Contact the engineering lead directly; include
reproduction steps. Treat any suspected credential exposure as an incident:
rotate first, investigate second.
