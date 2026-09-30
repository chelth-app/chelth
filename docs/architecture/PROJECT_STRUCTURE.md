# Project Structure

```
.
├── .github/
│   ├── workflows/ci.yml          # quality, e2e and database jobs (verifies; never deploys)
│   ├── dependabot.yml
│   └── pull_request_template.md  # security/migration checklist
├── docs/
│   ├── architecture/             # TECHNICAL_ARCHITECTURE, PROJECT_STRUCTURE,
│   │                             # DATABASE_MIGRATION_POLICY, DESIGN_SYSTEM, future ADRs
│   ├── security/                 # SECURITY_INVARIANTS
│   └── reports/                  # stage completion reports
├── scripts/
│   ├── check-client-bundle.mjs   # post-build secret scan of browser output
│   └── check-migrations.mjs      # migration naming/immutability, seed hygiene
├── src/
│   ├── app/                      # routes only — thin composition, no business logic
│   │   ├── (internal)/design-system/   # non-production UI reference
│   │   ├── api/health/           # liveness probe
│   │   ├── auth/confirm/         # email-link verification (route handler)
│   │   ├── auth/error/
│   │   ├── layout.tsx, page.tsx, error.tsx, global-error.tsx, not-found.tsx, loading.tsx
│   │   └── globals.css           # design tokens (Tailwind @theme)
│   ├── components/
│   │   ├── ui/                   # owned primitives: Button, Input, Label, FormField,
│   │   │                         # Badge, Card, Dialog, Spinner, LoadingState, ErrorState
│   │   ├── layout/               # SkipLink, PageContainer (app shells later)
│   │   └── shared/               # cross-feature composites (BrandMark)
│   ├── config/
│   │   ├── env.schema.ts         # pure Zod schemas + parsing (tested)
│   │   ├── env.public.ts         # validated NEXT_PUBLIC_* values
│   │   ├── env.server.ts         # validated server-only values (server-only)
│   │   └── runtime.ts            # build mode flags
│   ├── constants/                # app-wide constants (name, descriptor)
│   ├── features/                 # business domains (from P0-E3-S2) — see features/README.md
│   ├── hooks/                    # shared client hooks
│   ├── lib/
│   │   ├── auth/                 # identity helpers (who) — no roles/permissions
│   │   ├── errors/               # AppError, codes, normalisation, ActionResult
│   │   ├── logging/              # redacting structured logger
│   │   ├── security/             # CSP, nonce, headers, safe redirects
│   │   ├── supabase/             # browser / server / proxy clients (+ README)
│   │   ├── utils/                # cn()
│   │   └── validation/           # parseInput, shared schemas
│   ├── types/database.types.ts   # generated — do not edit (npm run db:types)
│   ├── instrumentation.ts        # server error reporting hook
│   └── proxy.ts                  # nonce/CSP + session refresh
├── supabase/
│   ├── config.toml               # local stack (ports 553xx, auth policy, MFA)
│   ├── migrations/               # THE source of truth for the database
│   ├── seed.sql                  # local dev data only — no DDL/grants
│   └── tests/security/           # pgTAP invariants
├── tests/
│   ├── unit/                     # Vitest (mirrors src/)
│   ├── integration/              # Vitest vs local Supabase only
│   ├── e2e/                      # Playwright + axe
│   └── support/                  # test setup and shims
├── .env.example                  # template; real values never committed
├── eslint.config.mjs             # includes architectural guardrails
├── next.config.ts                # env validation + static security headers
├── playwright.config.ts, vitest.config.ts, vitest.integration.config.ts
└── tsconfig.json                 # strict, noUncheckedIndexedAccess
```

## Deviation from the suggested layout

- `src/lib/validation` holds shared primitives only; **feature-specific
  schemas live inside each feature** (`src/features/<f>/schemas.ts`) so a
  feature is self-contained.
- `src/lib/utils` added for `cn()`.
- `src/types` currently holds only generated database types; hand-written
  shared types go next to the code that owns them.

## Feature boundaries

Each domain is a folder in `src/features/` with a public `index.ts`. Expected
first features, in order of the roadmap: `identity`, `organisations`, then the
workforce, scheduling, time and finance domains. Rules (lint-enforced where
possible):

1. Routes import from features; features never import from routes.
2. Features import other features only through `@/features/<name>`.
3. Server-only feature code (`service.ts`, `queries.ts`) imports
   `server-only`.
4. A feature owns its schemas, types, actions and UI; shared primitives are
   promoted to `src/components` / `src/lib` only when a second feature needs
   them.

## Naming

- Files: `kebab-case.ts(x)`; React components: `PascalCase` exports.
- Tests: `*.test.ts(x)` under `tests/unit` mirroring `src/`; E2E `*.spec.ts`.
- SQL tests: `NNN_description.test.sql`.
- Migrations: see `DATABASE_MIGRATION_POLICY.md` §3.
