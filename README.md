# CHELTH

**Healthcare workforce operations** — a platform for healthcare staffing
agencies, facilities and healthcare professionals to coordinate workers,
credentials and compliance, staffing requests, shifts, attendance, timesheets,
rates, invoicing and payroll exports.

> Current stage: **P0-E3-S2 — identity, organisations & authorization.**
> Multi-organisation memberships, capability-based roles, MFA-gated
> administration, invitations and audit are in place. Healthcare workforce
> domain modules arrive in later stages.

---

## Prerequisites

| Tool         | Version                                       |
| ------------ | --------------------------------------------- |
| Node.js      | 24.x (`nvm use` reads `.nvmrc`)               |
| npm          | 11+                                           |
| Docker       | running (for local Supabase)                  |
| Supabase CLI | 2.109+ (`brew install supabase/tap/supabase`) |

## Local development

```bash
npm install
npm run db:start            # start local Supabase (ports 553xx)
cp .env.example .env.local  # then paste the local anon/publishable key (see below)
npm run dev                 # http://localhost:3000
```

## Environment setup

Configuration is validated at dev start, build and production start. **Missing
or invalid configuration fails immediately** — there is no demo or offline
mode.

| Variable                        | Scope  | Purpose                                                                                                                                                          |
| ------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_ENV`           | public | `development` \| `test` \| `preview` \| `production`. Optional on Vercel (derived from `VERCEL_ENV`). An unlabelled production build is treated as `production`. |
| `NEXT_PUBLIC_SUPABASE_URL`      | public | Supabase API URL. Production requires `https` and a non-local host.                                                                                              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Anon / publishable key **only**. A service-role or `sb_secret_` key is rejected.                                                                                 |
| `LOG_LEVEL`                     | server | `debug` \| `info` \| `warn` \| `error` (default `info`).                                                                                                         |
| `SENTRY_DSN`                    | server | Reserved; unused until error monitoring is approved.                                                                                                             |

Get local values with `supabase status`. For local builds against the local
stack, set `NEXT_PUBLIC_APP_ENV=development` (or `test`) — a production-labelled
build refuses to point at `127.0.0.1`.

Hosted values live **only** in Vercel project settings (Production → Chelth
production Supabase project; Preview → Chelth staging project). Never commit
`.env*` files other than `.env.example`.

## Supabase local setup

```bash
npm run db:start     # start stack; applies all migrations + seed
npm run db:reset     # rebuild database from migrations (do this, never hand-fix)
npm run db:test      # pgTAP security tests
npm run db:lint      # schema lint
npm run db:types     # regenerate src/types/database.types.ts
npm run db:env       # print local URL / anon key / Mailpit URL (never service-role)
npm run db:stop
```

Studio: http://127.0.0.1:55323 · Mailpit (auth emails): http://127.0.0.1:55324

The repository is not linked to a hosted Supabase project. Link locally only
when applying migrations, and only to the Chelth staging/production projects.

## Tests

```bash
npm test                  # unit tests (Vitest)
npm run test:coverage
npm run test:e2e:install  # once: Playwright Chromium
npm run build && npm run test:e2e   # E2E against the production build
npm run test:integration  # real flows against LOCAL Supabase + Mailpit
npm run db:test           # database security tests
```

## Build and verify

```bash
npm run verify   # format check, lint, typecheck, unit tests, build, bundle secret scan
```

| Script                    | Purpose                                                |
| ------------------------- | ------------------------------------------------------ |
| `dev` / `build` / `start` | Next.js                                                |
| `lint` / `lint:fix`       | ESLint (zero warnings allowed)                         |
| `typecheck`               | route types + `tsc --noEmit`                           |
| `format` / `format:check` | Prettier                                               |
| `check:bundle`            | fail if browser output contains secrets or source maps |
| `check:migrations`        | migration naming, immutability, seed hygiene           |

## Architecture overview

- **Next.js 16 App Router**, server-first; `"use client"` only where needed.
- **Supabase**: Postgres (source of truth, RLS), Auth (identity only), Storage
  and Edge Functions later.
- **Feature modules** in `src/features/<domain>`; routes stay thin.
- **Strict CSP** with per-request nonces — no `'unsafe-inline'` in production.
- **Identity → memberships → roles → capabilities**, evaluated by the database
  per organisation; privileged capabilities require MFA (AAL2).

Read before contributing:

- [Technical architecture](docs/architecture/TECHNICAL_ARCHITECTURE.md)
- [Project structure](docs/architecture/PROJECT_STRUCTURE.md)
- [Database migration policy](docs/architecture/DATABASE_MIGRATION_POLICY.md)
- [Security invariants](docs/security/SECURITY_INVARIANTS.md)
- [Identity & organisation model](docs/architecture/IDENTITY_AND_ORGANISATION_MODEL.md)
- [Authorization model](docs/architecture/AUTHORIZATION_MODEL.md)
- [Identity threat model](docs/security/THREAT_MODEL_IDENTITY.md)
- [Design system](docs/architecture/DESIGN_SYSTEM.md)

## Security principles

1. Tenant isolation is enforced by the database (RLS), not the UI.
2. Service-role credentials never reach browser code — and no service-role
   client exists in this codebase.
3. Deny by default: new tables/functions are inaccessible until a migration
   grants access deliberately, alongside RLS policies.
4. Validate every boundary with Zod; never trust browser-provided objects.
5. Users see safe error codes/messages only; details go to redacted logs.
6. Never log tokens, passwords, documents or workforce identifiers.
7. Security regressions block releases.

## Migration rules

**The migration history is the database source of truth.**

- Every schema, RLS, grant, function, trigger and storage-policy change is a
  migration in `supabase/migrations/` (`npm run db:new -- <description>`).
- No changes via the Supabase SQL Editor / Studio on hosted projects.
- Merged migrations are immutable — fix forward.
- `seed.sql` is local sample data only.

Full policy: [DATABASE_MIGRATION_POLICY.md](docs/architecture/DATABASE_MIGRATION_POLICY.md).

## Contribution workflow

1. Branch from `main` (`feat/…`, `fix/…`, `chore/…`).
2. Keep changes within one feature boundary where possible.
3. Database changes: new migration + pgTAP tests (cross-tenant tests for any
   tenant-aware table) in the same PR; regenerate types.
4. Run `npm run verify` (and `npm run db:test` for database changes).
5. Open a PR; complete the checklist in the template. CI must pass.
6. Merge to `main` → Vercel deploys. Migrations are applied by an operator per
   the migration policy.
