# Security Invariants

These are non-negotiable properties of Chelth. A change that violates one is a
defect regardless of how it was reviewed. Each invariant lists how it is
**enforced** today and what later stages must add.

Chelth handles healthcare workforce data: identities, professional
registrations, right-to-work and compliance documents, pay and bill rates.
Leaks and cross-tenant exposure have regulatory and human consequences.

| #   | Invariant                                                                               | Enforced now                                                                                                                                                                                          | Required later                                                                                                                               |
| --- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Tenant isolation is enforced by the database**, not only by UI or application checks. | RLS-on-every-table pgTAP check; deny-by-default grants.                                                                                                                                               | Organisation-scoped RLS on every tenant-aware table (P0-E3-S2+).                                                                             |
| 2   | **Service-role credentials never reach browser code.**                                  | No service-role client exists; ESLint bans `SUPABASE_SERVICE_ROLE_KEY` / `service_role` / `sb_secret_` in `src/`; env validation rejects a privileged key in `NEXT_PUBLIC_*`; post-build bundle scan. | Any privileged path follows `src/lib/supabase/README.md` and is ADR-approved.                                                                |
| 3   | **Sensitive state transitions use server- or RPC-controlled mutation.**                 | Error mapping for RPC `CH*` SQLSTATEs; feature-module rules.                                                                                                                                          | Shift/timesheet/invoice/credential state machines implemented as RPCs with explicit checks; clients cannot `update` status columns directly. |
| 4   | **RLS is deny-by-default.**                                                             | Baseline migration revokes default table/sequence/function privileges from `anon`/`authenticated` and `EXECUTE` from `PUBLIC`; pgTAP verifies.                                                        | Each table grants only what its policies are designed for.                                                                                   |
| 5   | **No tenant-sensitive table is exposed without deliberate RLS review.**                 | pgTAP: every `public` table has RLS enabled; `anon` holds no table grants. PR template checklist.                                                                                                     | Security review sign-off recorded in the PR for each new table.                                                                              |
| 6   | **Cross-tenant tests are mandatory for tenant-aware tables.**                           | Test conventions in `supabase/tests/README.md`.                                                                                                                                                       | Every tenant-aware table ships pgTAP tests proving org A cannot read/write org B.                                                            |
| 7   | **Historical financial and compliance events are append-only.**                         | — (no such tables yet).                                                                                                                                                                               | Audit/event tables revoke `update`/`delete`, enforced by trigger and tested. Corrections are new events.                                     |
| 8   | **Production database state is reproducible from migrations.**                          | `DATABASE_MIGRATION_POLICY.md`; CI applies all migrations from empty; `check-migrations` blocks edits to merged migrations and DDL in seeds.                                                          | Scheduled drift detection against staging/production.                                                                                        |
| 9   | **Secrets are never committed.**                                                        | `.gitignore` covers all `.env*` except `.env.example`; bundle scan; secret search at each stage report.                                                                                               | Secret scanning (e.g. GitHub push protection / gitleaks) enabled on the repository.                                                          |
| 10  | **Privileged roles support MFA enforcement.**                                           | TOTP MFA enabled in `supabase/config.toml`.                                                                                                                                                           | Privileged organisation roles require `aal2` — enforced in RLS (`auth.jwt()->>'aal'`) and server checks.                                     |
| 11  | **Storage permissions align with database permissions.**                                | — (no buckets yet).                                                                                                                                                                                   | Every bucket's `storage.objects` policies derive from the same membership functions as table RLS; tested.                                    |
| 12  | **Sensitive workforce documents never use public buckets.**                             | pgTAP: no bucket is public.                                                                                                                                                                           | Private buckets + short-lived signed URLs; upload type/size limits.                                                                          |
| 13  | **UI hiding is not authorization.**                                                     | Architecture rule; proxy performs no authorization.                                                                                                                                                   | Every Server Action/Route Handler checks identity and permission; RLS backs it.                                                              |
| 14  | **Error messages never expose database internals.**                                     | `AppError` + `toPublicError`; `normalizeError` maps DB errors to safe codes; error boundaries show generic text + digest; unit tests.                                                                 | All actions return `ActionResult`; no raw error forwarding.                                                                                  |
| 15  | **Security regressions block production releases.**                                     | CI (lint, typecheck, tests, pgTAP, bundle scan) on every PR and `main`.                                                                                                                               | Branch protection requiring CI; Vercel production deploys only from protected `main`.                                                        |

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
