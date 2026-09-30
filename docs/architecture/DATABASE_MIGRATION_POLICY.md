# Database Migration Policy

> **THE MIGRATION HISTORY IS THE DATABASE SOURCE OF TRUTH.**

Every environment's database — local, CI, preview, production — must be
reproducible by applying `supabase/migrations/` in order to an empty Supabase
project. If a production object cannot be traced to a migration file in this
repository, it is drift, and drift is a defect.

This policy exists because schema drift in a regulated system is not a
cosmetic problem: an untracked policy, grant or function is an access-control
rule nobody has reviewed and no test covers.

---

## 1. What belongs in a migration

**Everything** that shapes the database:

- tables, columns, constraints, indexes, types, enums, views
- Row Level Security enablement **and** every policy
- grants and revokes (including default privileges)
- functions / RPCs, triggers, event triggers
- extensions
- storage buckets and `storage.objects` policies
- scheduled jobs (`pg_cron`) and their definitions
- reference data that the application depends on to function (e.g. a fixed
  list of status codes). Environment-specific or sample data is **not** this.

## 2. What is prohibited

| Prohibited                                                                | Why                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Changing schema, policies or grants in the Supabase SQL Editor            | Untracked, unreviewed, unreproducible                               |
| Creating tables/policies/buckets through the Studio UI in hosted projects | Same                                                                |
| "Hotfix now, migration later"                                             | Later rarely happens; the next deploy may silently revert it        |
| Production-only policies or grants                                        | Environments diverge; tests no longer prove production behaviour    |
| Grants, policies, functions or DDL in `supabase/seed.sql`                 | Seeds only run locally — production would lack them                 |
| Editing, renaming or deleting a migration after it is merged              | Environments that already applied it diverge from those that didn't |
| RPCs or functions that exist only in one environment                      | Callers break or behave differently per environment                 |

The Studio **Table Editor and SQL Editor may be used read-only** against hosted
projects (inspection, `EXPLAIN`, data queries during an incident). Any write
performed during an incident must be followed immediately by a migration that
reproduces it, and recorded in the incident notes.

`scripts/check-migrations.mjs` (run in CI) rejects DDL/grants in `seed.sql`,
malformed names, duplicate timestamps, out-of-order new migrations and any
modification of a migration that already exists on the base branch.

## 3. Naming

```
supabase/migrations/<YYYYMMDDHHMMSS>_<snake_case_description>.sql
```

- Always create with `npm run db:new -- <description>` (wraps
  `supabase migration new`), which generates a UTC timestamp.
- Description: imperative, specific, snake_case — e.g.
  `create_organisations`, `add_rls_to_shift_assignments`,
  `add_index_timesheets_worker_period`. Avoid `fix`, `update`, `misc`.
- One logical change per migration. A new table ships **with** its RLS
  enablement, policies, grants and indexes in the same file (never a window
  where the table exists without RLS).
- Every migration starts with a header comment: purpose, stage/ticket, and the
  pgTAP test file that verifies it.

## 4. Ordering

- Migrations apply in lexical (timestamp) order. A new migration must sort
  after every migration already on `main`; CI enforces this on pull requests.
- If `main` gains a newer migration while your branch is open, regenerate your
  file with a fresh timestamp (rename before merge — it has not been applied
  anywhere shared yet).
- Never depend on objects created by a _later_ migration.

## 5. Writing migrations

- Prefer idempotence-safe forms only where they do not hide mistakes
  (`create extension if not exists` is fine; `create table if not exists`
  usually hides drift — avoid it).
- Tables in exposed schemas: `alter table … enable row level security;` in the
  same migration. The baseline migration revokes default privileges from
  `anon`/`authenticated`, so access must be granted explicitly — grant only
  what the policies are designed for.
- Functions: `security invoker` by default. `security definer` only with
  explicit authorization checks inside, `set search_path = ''` (or a pinned
  list), fully-qualified names, and `grant execute` to the minimum roles.
  Raise application errors with SQLSTATE class `CH` (see
  `src/lib/errors/normalize-error.ts`).
- Destructive changes (drop column/table, type narrowing) follow
  expand → migrate → contract across separate deploys so the running
  application never sees a schema it cannot handle.
- Long-running operations (large backfills, index builds on big tables) use
  `create index concurrently` in their own migration and batched backfills.
  Note: `concurrently` cannot run inside a transaction block.

## 6. Local workflow

```bash
npm run db:start                 # local stack (ports 553xx)
npm run db:new -- create_example # new empty migration file
# edit the file
npm run db:reset                 # rebuild local DB from ALL migrations + seed
npm run db:test                  # pgTAP tests
npm run db:lint                  # schema lint
npm run db:types                 # regenerate src/types/database.types.ts
```

`db:reset` from zero is the proof that history is complete. Never "fix" your
local database by hand; reset it.

`npm run db:diff` can help draft a migration from local exploratory changes,
but its output must be reviewed line by line — it is a starting point, not an
authority.

## 7. Production migration procedure

1. The migration merges to `main` only after CI passes (migrations applied from
   an empty database, `db lint`, pgTAP security tests, generated types match).
2. Apply to the **preview/staging** project first:
   `supabase link --project-ref <staging-ref>` then `supabase db push --dry-run`,
   review the list, then `supabase db push`.
3. Verify the application against staging.
4. Take/confirm a backup point (PITR or manual backup) for production.
5. Apply to production the same way (`--dry-run` first). The operator records
   who applied what, and when.
6. Deploy application code that depends on the new schema **after** the
   migration (expand-first ordering makes this safe).

Automating steps 2–5 in CI with a protected environment and approval gate is a
deferred item; until then the procedure is manual, reviewed and logged.

Credentials for `supabase link` / `db push` belong to named operators, never to
CI logs, the repository or shared documents.

## 8. Rollback and repair

Migrations are **forward-only**. There are no down-migrations.

- **Bad migration not yet applied anywhere shared:** amend it on the branch.
- **Bad migration applied to staging/production:** write a new migration that
  corrects it (fix forward). Never edit the applied file.
- **Data loss / corruption:** restore via point-in-time recovery to a new
  project or a known-good point, then replay from migrations as needed. This
  is an incident, handled under the incident process.
- **Migration history table out of sync** (e.g. a migration was applied
  manually): use `supabase migration repair --status applied|reverted <version>`
  only after confirming the actual database state matches the file, and record
  the repair in the incident notes.

## 9. Drift detection

- **CI (every PR/push):** all migrations apply cleanly to an empty database;
  security invariants pass; generated types match the schema.
- **Periodic (deferred, required before production launch):** a scheduled job
  runs `supabase db diff --linked` (schema) against staging and production and
  alerts on any non-empty diff. A non-empty diff is treated as an incident:
  identify who/what changed the database, then either codify it in a migration
  or revert it.
- **Before every production migration:** `supabase db push --dry-run` must list
  exactly the expected pending migrations.

## 10. Seeds

`supabase/seed.sql` holds **local development data only** and runs only on
local `db reset`. It must contain no DDL, grants, policies, functions or
triggers (CI enforces this). Production reference data belongs in migrations.
