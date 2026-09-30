# Technical Architecture

Status: P0-E3-S1 (foundation), updated for P0-E3-S2 (identity, organisations
& authorization). This document describes the architecture the
platform is built on and the rules later stages must follow. Domain design
(identity, organisations, workforce, shifts, time, finance) is out of scope
here and is recorded in its own documents as each stage is approved.

## 1. System overview

```
 Browser (agency / facility desktop, worker mobile PWA later)
   │  HTTPS — CSP with per-request nonce, security headers
   ▼
 Vercel ── Next.js 16 (App Router, React 19, Node.js runtime)
   │   src/proxy.ts        nonce + CSP, Supabase session refresh (no authz)
   │   Server Components   reads, as the signed-in user
   │   Server Actions /    validated mutations, as the signed-in user
   │   Route Handlers
   ▼
 Supabase
   ├─ Postgres  ← source of truth; RLS enforces tenancy; RPCs own sensitive transitions
   ├─ Auth      ← identity only (who), email/password, email verification, TOTP MFA
   ├─ Storage   ← private buckets, policies aligned with table RLS (future)
   └─ Edge Functions ← background / webhook work when needed (future)
```

| Layer      | Choice                                              | Version                      |
| ---------- | --------------------------------------------------- | ---------------------------- |
| Runtime    | Node.js                                             | 24 LTS (`.nvmrc`, `engines`) |
| Framework  | Next.js App Router                                  | 16.3                         |
| UI         | React                                               | 19.3                         |
| Language   | TypeScript (strict)                                 | 6.0                          |
| Styling    | Tailwind CSS                                        | 4.3                          |
| Validation | Zod                                                 | 4                            |
| Backend    | Supabase (`@supabase/ssr`, `@supabase/supabase-js`) | 0.12 / 2.117                 |
| Unit tests | Vitest + Testing Library                            | 5                            |
| E2E        | Playwright + axe-core                               | 1.63                         |
| DB tests   | pgTAP via Supabase CLI                              | CLI 2.109                    |

TypeScript is pinned to 6.0 because `typescript-eslint` does not yet support
the native TypeScript 7 compiler. ESLint is pinned to 9 because the plugins
bundled by `eslint-config-next` do not yet declare ESLint 10 support.
Revisit both when upstream support lands.

## 2. Frontend architecture

- **Server-first.** Pages and layouts are Server Components. `"use client"` is
  added only to the smallest component that needs browser interactivity
  (e.g. `Dialog`, error boundaries). Data is fetched on the server; the browser
  receives HTML and the minimum JavaScript.
- **Thin routes.** `src/app/**/page.tsx` composes feature components and calls
  feature queries/actions. Business logic lives in `src/features/<feature>`
  (see `PROJECT_STRUCTURE.md`).
- **Dynamic rendering.** Every route renders per request because the CSP nonce
  is per request (`connection()` in the root layout). This suits an
  authenticated, tenant-specific product; public marketing pages, if ever
  hosted here, would be a separate concern.
- **Design system.** Owned primitives in `src/components/ui` built on semantic
  Tailwind tokens (`DESIGN_SYSTEM.md`). No component framework runtime; the
  modal uses the native `<dialog>` element.
- **Responsive by default.** Mobile-first utility classes, 44 px touch targets,
  16 px inputs (no iOS zoom), `min-h-dvh`. Shared components make no
  desktop-only assumptions.
- **Accessibility is a gate, not polish.** Semantic HTML, `FormField` wires
  labels/descriptions/errors, visible focus everywhere, skip link, reduced
  motion respected, jsx-a11y lint rules, axe checks in E2E.

## 3. Backend architecture

- **Postgres is the system of record** and the enforcement point for tenancy.
- **Reads:** Server Components use `createSupabaseServerClient()` and query as
  the signed-in user; RLS filters rows.
- **Mutations:** Server Actions follow one shape:
  1. `parseInput(schema, input)` — never trust browser objects;
  2. establish identity (`requireAuthIdentity()`);
  3. authorise (server check backed by RLS);
  4. mutate — **sensitive state transitions via Postgres functions (RPCs)**
     that check permissions and current state in one transaction;
  5. return `ActionResult<T>`; errors pass through `normalizeError` →
     `toPublicError`.
- **Errors** (`src/lib/errors`): one `AppError` type with stable codes
  (validation, authentication, authorization, not-found, conflict/state,
  rate-limit, internal). Users see only the registered safe message and, for
  unexpected errors, a digest reference. Database functions raise
  application errors with SQLSTATE class `CH` (`CH400`, `CH403`, `CH404`,
  `CH409`, `CH429`) so mapping never parses message text.
- **Background work** (future: reminders, credential expiry, reconciliation,
  exports) runs in Supabase Edge Functions or scheduled Postgres jobs — not in
  request handlers.

## 4. Supabase relationship

| Concern                                          | Where                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| Schema, RLS, grants, functions, storage policies | `supabase/migrations/` only (`DATABASE_MIGRATION_POLICY.md`)      |
| Local stack config (auth policy, MFA, ports)     | `supabase/config.toml`                                            |
| Security tests                                   | `supabase/tests/security/*.test.sql` (pgTAP)                      |
| Generated types                                  | `src/types/database.types.ts` (`npm run db:types`, checked in CI) |
| Clients                                          | `src/lib/supabase/{browser,server,proxy}.ts`                      |

The local stack uses ports **553xx** (API 55321, DB 55322, Studio 55323,
Mailpit 55324) so it never collides with other local Supabase projects.

The repository is **not linked** to any hosted project in version control
(`supabase/.temp` is git-ignored). Operators link locally to the Chelth
staging/production projects only when applying migrations.

**No service-role client exists.** All three clients act as the signed-in user
with the anon key. See `src/lib/supabase/README.md` for the approval path if a
privileged operation is ever required.

## 5. Server / client boundaries

| Module                                                                              | Boundary guard                                                  |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `src/config/env.server.ts`, `src/lib/supabase/server.ts`, `src/lib/auth/session.ts` | `import "server-only"` → build error if imported by client code |
| `src/lib/supabase/browser.ts`                                                       | `import "client-only"`                                          |
| `src/config/env.public.ts`                                                          | Only `NEXT_PUBLIC_*` values; safe in both                       |
| Everything in `src/lib/{errors,validation,logging,security,utils}`                  | Pure / isomorphic; no secrets                                   |

### Environment

- `src/config/env.schema.ts` defines public and server schemas (pure, tested).
- `next.config.ts` validates both at **dev start, build and production start**;
  failure aborts. There is no demo mode, no localStorage persistence mode and
  no fake authentication path.
- `NEXT_PUBLIC_APP_ENV` ∈ `development | test | preview | production`.
  Resolution: explicit value → `VERCEL_ENV` → `NODE_ENV`; an unlabelled
  production build resolves to `production` (fail closed).
- Production rules: Supabase URL must be `https` and non-local; the public key
  must not be a service-role / `sb_secret_` key.
- `process.env` may only be read in `src/config/**` and `instrumentation.ts`
  (ESLint).

### Enforced boundaries (lint)

- No `process.env` outside `src/config`.
- No `SUPABASE_SERVICE_ROLE_KEY`, `service_role` or `sb_secret_` in `src/`.
- No direct `createClient` from `@supabase/supabase-js` — use the helpers.
- No deep imports into another feature (`@/features/x/internal`).
- No `any`, no `@ts-ignore`, no non-null assertions, no floating promises,
  no `dangerouslySetInnerHTML`, no `console` (use the logger).

## 6. Security model

Summarised; the normative list is `docs/security/SECURITY_INVARIANTS.md`.
The identity and authorization design is specified in
[IDENTITY_AND_ORGANISATION_MODEL.md](IDENTITY_AND_ORGANISATION_MODEL.md),
[AUTHORIZATION_MODEL.md](AUTHORIZATION_MODEL.md) and
[../security/THREAT_MODEL_IDENTITY.md](../security/THREAT_MODEL_IDENTITY.md).

### Identity & authorization at a glance (P0-E3-S2)

- `profiles` (identity) → `organisation_memberships` (one per organisation)
  → `membership_roles` → `roles` → `capabilities`. No global or active role.
- Authorization primitive: `authz.has_capability(organisation_id, key)`,
  used by RLS and RPCs; privileged capabilities require an AAL2 session.
- Private schemas: `authz` (policy helpers; EXECUTE for `authenticated`, not
  exposed via the Data API) and `internal` (triggers, audit writer, rate
  limiter, operator procedures; no API access).
- All writes to identity/organisation tables are `SECURITY DEFINER` RPCs that
  authorise, enforce the capability ceiling, mutate and audit in one
  transaction. Errors use SQLSTATE class `CH` (`CH402` = MFA step-up).
- Platform admins are not tenant members, get no RLS access to tenant rows,
  and act only through narrow audited RPCs.
- Correlation: the server client forwards `x-chelth-request-id` (per request);
  audit events record it.

### Healthcare domain foundations (P0-E3-S3)

- Workers: `profile → membership → agency_workers` (per agency); created by
  the database when the healthcare-worker role is granted
  ([WORKFORCE_DOMAIN_MODEL.md](WORKFORCE_DOMAIN_MODEL.md)).
- Facilities: agency client records (`agency_facilities`, `facility_locations`)
  distinct from facility organisations; explicit verified linking
  ([FACILITY_DOMAIN_MODEL.md](FACILITY_DOMAIN_MODEL.md)).
- Relationships: `agency_facility_relationships` with lifecycle; future
  commercial terms attach here
  ([AGENCY_FACILITY_RELATIONSHIPS.md](AGENCY_FACILITY_RELATIONSHIPS.md)).
- Cross-org sharing: relationship-scoped only
  ([../security/CROSS_ORG_DATA_SHARING.md](../security/CROSS_ORG_DATA_SHARING.md)).
- Email: provider abstraction (Resend adapter, disabled by default),
  post-commit delivery with recorded outcome
  ([TRANSACTIONAL_EMAIL.md](TRANSACTIONAL_EMAIL.md)).
- Documents: design only ([../security/DOCUMENT_STORAGE_MODEL.md](../security/DOCUMENT_STORAGE_MODEL.md)).
- Routes are organisation-scoped: `/app/organisations/[id]/workforce…`,
  `/app/organisations/[id]/facilities…` (explicit context, 404 for non-members).

### Credentials & compliance (P0-E4-S1)

- Person-owned credentials with immutable versions, explicit agency shares and
  append-only per-agency verification
  ([CREDENTIAL_DOMAIN_MODEL.md](CREDENTIAL_DOMAIN_MODEL.md),
  [../security/CREDENTIAL_SHARING_MODEL.md](../security/CREDENTIAL_SHARING_MODEL.md)).
- Private Storage bucket with signed upload/download URLs, server-side content
  checks and a scan trust gate
  ([../security/CREDENTIAL_DOCUMENT_SECURITY.md](../security/CREDENTIAL_DOCUMENT_SECURITY.md)).
- Requirements: agency baseline + facility add-ons
  ([FACILITY_CREDENTIAL_REQUIREMENTS.md](FACILITY_CREDENTIAL_REQUIREMENTS.md)).
- Derived, explainable eligibility with reason codes
  ([COMPLIANCE_ENGINE.md](COMPLIANCE_ENGINE.md)).

1. **Identity** — Supabase Auth; server code trusts only validated sessions.
2. **Authorization** — database-enforced (RLS + RPC checks), mirrored by
   server checks for good UX. UI hiding is never authorization.
3. **Deny by default** — baseline migration removes default grants; each table
   opts in deliberately with policies and grants in the same migration.
4. **Tenancy** — organisation-scoped RLS (P0-E3-S2), with mandatory
   cross-tenant pgTAP tests.
5. **Transport & browser** — HTTPS/HSTS, strict nonce CSP (no
   `'unsafe-inline'` in production), anti-framing, restrictive
   Permissions-Policy.
6. **Data minimisation in telemetry** — redacting structured logger.

### Shift requests & assignments (P0-E5-S1)

- One `shifts` entity (agency shifts and facility requests), stored lifecycle
  draft/submitted/open/cancelled/completed, derived fill
  ([SHIFT_DOMAIN_MODEL.md](SHIFT_DOMAIN_MODEL.md)); canonical UTC instants +
  location timezone ([SHIFT_TIME_MODEL.md](SHIFT_TIME_MODEL.md)).
- Assignments with explicit worker acceptance, structural capacity/duplicate/
  cross-agency overlap guarantees ([ASSIGNMENT_DOMAIN_MODEL.md](ASSIGNMENT_DOMAIN_MODEL.md)).
- One eligibility decision function calling the compliance engine for the
  shift's facility, discipline and local dates; append-only decision records
  ([ASSIGNMENT_ELIGIBILITY.md](ASSIGNMENT_ELIGIBILITY.md)).
- Facility and worker access only through narrow projections
  ([../security/SHIFT_CROSS_ORG_ACCESS.md](../security/SHIFT_CROSS_ORG_ACCESS.md)).
- Notification hooks: `internal.notification_outbox` (transactional outbox; delivery later).
- UI: `/shifts`, `/shifts/[shiftId]` (agency), `/my-shifts` (worker),
  `/staffing-requests`, `/staffing-requests/[shiftId]` (facility); feature
  module `src/features/shifts`, vocabulary `src/lib/domain/shifts.ts`.

### Assignment operations & notifications (P0-E5-S2)

- Reliable notification delivery: per-recipient outbox, SKIP LOCKED claims
  with leases, bounded retries, provider idempotency, consumed by
  `POST /api/internal/notifications/dispatch` (bearer secret) through a
  least-privilege database role — no service-role key
  ([NOTIFICATION_DELIVERY.md](NOTIFICATION_DELIVERY.md)).
- Migration-driven schedules (pg_cron): readiness scan hourly, offer expiry
  every 5 min, dispatch kick every minute via pg_net (URL/secret in Vault).
- Shift offers ([SHIFT_OFFER_MODEL.md](SHIFT_OFFER_MODEL.md)), readiness
  monitoring ([ASSIGNMENT_READINESS_MONITORING.md](ASSIGNMENT_READINESS_MONITORING.md)),
  relationship suspension operations
  ([RELATIONSHIP_SUSPENSION_OPERATIONS.md](RELATIONSHIP_SUSPENSION_OPERATIONS.md)).
- Keyset pagination for shift lists; pre-filtered candidate evaluation.
- UI: offers on the shift page and `/my-shifts`; `/operations` attention
  surface. Code: `src/lib/notifications`, `src/features/shifts`.

### Time & attendance (P0-E6-S1)

- Attendance per accepted assignment: append-only events with server time,
  a projection rebuilt from events, exceptions, and corrections that append
  corrected events ([ATTENDANCE_DOMAIN_MODEL.md](ATTENDANCE_DOMAIN_MODEL.md),
  [ATTENDANCE_EVENT_MODEL.md](ATTENDANCE_EVENT_MODEL.md),
  [ATTENDANCE_CORRECTIONS.md](ATTENDANCE_CORRECTIONS.md)).
- Optional per-location geofence validated in the database (haversine); one
  location reading per clock action, never tracking
  ([GEOFENCE_MODEL.md](GEOFENCE_MODEL.md),
  [../security/ATTENDANCE_LOCATION_PRIVACY.md](../security/ATTENDANCE_LOCATION_PRIVACY.md)).
- pg_cron `chelth-attendance-scan` every 15 min detects missed clocks
  idempotently.
- UI: agency `/attendance`, attendance on shift detail and facility request
  detail, clock in/out on `/my-shifts` (mobile-first). Code:
  `src/features/attendance`, vocabulary `src/lib/domain/attendance.ts`.

### Timesheets & attendance review hardening (P0-E6-S2)

- Weekly timesheets derived from attendance by one calculation
  (`internal.effective_time`), synced on every attendance or assignment
  change; worker submission, agency approval (immutable snapshots), per-entry
  facility sign-off, revisions after post-approval changes
  ([TIMESHEET_DOMAIN_MODEL.md](TIMESHEET_DOMAIN_MODEL.md),
  [TIMESHEET_APPROVAL_FLOW.md](TIMESHEET_APPROVAL_FLOW.md),
  [TIMESHEET_CALCULATION.md](TIMESHEET_CALCULATION.md)).
- Breaks as attendance segments
  ([ATTENDANCE_SEGMENTS_AND_BREAKS.md](ATTENDANCE_SEGMENTS_AND_BREAKS.md));
  reviewer-adjusted corrections; full correction history.
- Location evidence retention: pg_cron `chelth-location-evidence-purge`
  daily, legal hold, AAL2 raw evidence viewer
  ([../security/ATTENDANCE_EVIDENCE_RETENTION.md](../security/ATTENDANCE_EVIDENCE_RETENTION.md)).
- Refused clock-in rate limit; deduplicated facility-view audit.
- UI: `/timesheets` (worker, agency, facility audiences),
  `/timesheets/[timesheetId]`, `/attendance/[attendanceId]` (history, review,
  adjustment), `/attendance/[attendanceId]/evidence`; break buttons on
  `/my-shifts`. Code: `src/features/timesheets`, `src/lib/domain/timesheets.ts`.

### Content Security Policy

`src/proxy.ts` generates a 128-bit nonce per request and sets:

```
default-src 'self';
script-src 'self' 'nonce-…' 'strict-dynamic';
style-src 'self' 'nonce-…';
img-src 'self' blob: data: <supabase>;
font-src 'self';
connect-src 'self' <supabase> <supabase-wss>;
object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'none'; frame-src 'none'; worker-src 'self'; manifest-src 'self';
upgrade-insecure-requests
```

Next.js reads the nonce from the request header and applies it to its own
scripts and styles. Third-party scripts must be loaded with `next/script` and
the nonce (read via `headers().get(NONCE_HEADER)`), and justified in review.

## 7. Observability

- `src/lib/logging`: structured JSON lines, level-filtered (`LOG_LEVEL`),
  redacted, with pluggable sinks (`addLogSink`).
- `src/instrumentation.ts`: `onRequestError` logs unhandled server errors with
  route metadata and digest only (no headers, cookies, query or body).
- Error boundaries show a generic message plus the digest, which support can
  correlate with server logs.
- **Sentry is prepared for, not installed.** When approved: add `SENTRY_DSN`
  (already in the server schema), register a sink in `register()`, set
  `sendDefaultPii: false`, scrub bodies/cookies in `beforeSend`, and upload
  source maps privately with deletion after upload
  (`productionBrowserSourceMaps` stays `false`; CI's bundle scan fails on any
  published `.map`).

## 8. Testing strategy

| Layer                                        | Tool                                                        | Location            | Runs                                                             |
| -------------------------------------------- | ----------------------------------------------------------- | ------------------- | ---------------------------------------------------------------- |
| Unit (pure logic, components)                | Vitest, Testing Library, jsdom                              | `tests/unit`        | every PR                                                         |
| Database security invariants & RLS           | pgTAP                                                       | `supabase/tests`    | every PR                                                         |
| Integration (API-level, local Supabase only) | Vitest + Mailpit (real sign-up/verify, no service-role key) | `tests/integration` | every PR                                                         |
| E2E smoke, headers/CSP, accessibility        | Playwright + axe                                            | `tests/e2e`         | every PR, against a production build, desktop + mobile viewports |
| Bundle secret scan                           | `scripts/check-client-bundle.mjs`                           | —                   | every PR                                                         |
| Migration discipline                         | `scripts/check-migrations.mjs`                              | —                   | every PR                                                         |

Principles: test behaviour at the lowest layer that proves it; RLS is tested
in the database, not inferred from UI; every tenant-aware table has
cross-tenant tests; integration tests refuse to run against non-local hosts.

## 9. CI and deployment flow

```
feature branch ──PR──► GitHub Actions CI
                        ├─ quality: format, lint, typecheck, unit, build, bundle scan
                        ├─ database: migration checks, local Supabase from empty,
                        │            db lint, pgTAP, generated-types drift,
                        │            integration tests
                        └─ e2e: local Supabase + production build, Playwright
                                (auth flows via Mailpit, TOTP, axe)
                 ──merge──► main ──► Vercel Git integration deploys (production)
                 PRs      ──────────► Vercel preview deployments
Database migrations ──► applied by an operator per DATABASE_MIGRATION_POLICY §7
```

- CI verifies; **Vercel deploys**. CI holds no production secrets and never
  deploys.
- Vercel environment variables: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` per environment (Production → production
  project, Preview → staging project). `NEXT_PUBLIC_APP_ENV` is derived from
  `VERCEL_ENV` unless set explicitly.
- Required before launch: branch protection on `main` requiring CI.

## 10. Future PWA considerations (worker app)

Not implemented. The foundation keeps these paths open:

- **Installability:** add `src/app/manifest.ts` (metadata route) and icons;
  CSP already allows `manifest-src 'self'` and `worker-src 'self'`.
- **Service worker:** a deliberately designed worker (e.g. Serwist), scoped to
  the worker experience, with an explicit caching policy that **never caches
  authenticated API responses or documents**. No placeholder service worker
  has been added, so there is nothing to migrate away from.
- **Offline-tolerant clock events:** an IndexedDB outbox of clock events, each
  with a client-generated idempotency key and device timestamp; the server RPC
  accepts, de-duplicates and records both device and server time. Server time
  and server rules are authoritative.
- **Background reconciliation:** Background Sync where supported, otherwise
  replay on app foreground.
- **Geolocation:** `Permissions-Policy: geolocation=(self)` already allows it;
  location is captured only at clock events, with consent, and treated as
  sensitive data (redacted from logs).
- **Push notifications:** Web Push with VAPID keys (server-only env), consent
  UX, and notification content free of sensitive details.
- **Secure document uploads:** direct-to-Storage uploads into private buckets
  with signed upload URLs, type/size validation, and malware scanning before
  documents are marked usable.

## 11. Future integration strategy

- **Integration boundary per provider** under `src/features/integrations/<provider>`
  (or Edge Functions for webhooks/background sync), each with Zod-validated
  inbound payloads and an anti-corruption layer mapping external models to
  Chelth's domain.
- **Inbound webhooks:** signature verification, idempotency keys, persisted
  raw event log (append-only) before processing, retry-safe handlers.
- **Outbound exports** (payroll, invoicing, accounting): generated from
  immutable, approved records; each export is itself recorded (who, when,
  which records, checksum).
- **Secrets** for integrations are server-only env vars or Supabase Vault,
  never `NEXT_PUBLIC_*`.
- **Public API / VMS / enterprise SSO** (future): versioned API surface,
  per-client credentials and scopes, rate limiting, audit trail; SAML/OIDC SSO
  via Supabase Auth when approved.
- **White-label facility experiences:** tenant configuration in the database;
  theming through the semantic token layer, never forks of components.
