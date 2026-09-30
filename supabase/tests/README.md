# Database tests (pgTAP)

Run against the local stack:

```bash
npm run db:start   # once
npm run db:reset   # apply all migrations from scratch
npm run db:test    # run every *.test.sql under supabase/tests/
```

## Layout

- `security/` — invariants from `docs/security/SECURITY_INVARIANTS.md`.
  `000_security_baseline.test.sql` holds schema-wide rules (RLS on every table,
  no anon grants, no public buckets, pinned `search_path` on SECURITY DEFINER
  functions, deny-by-default privileges).

## Rules for future tenant-aware tables (mandatory)

Every tenant-aware table must ship, in the same pull request as its migration,
a test file that proves:

1. A member of organisation A cannot select, insert, update or delete rows of
   organisation B (cross-tenant isolation).
2. `anon` cannot read or write the table.
3. Each role can do exactly what its policy allows — and nothing else.
4. Append-only tables reject `update` and `delete`.

Use the shared helpers in `security/_helpers.psql` (included with `\ir`):
`pg_temp.create_user`, `query_as` / `scalar_as` / `exec_as` / `count_as`
(run SQL as a user at `aal1`/`aal2`, or as `anon` with a NULL user),
`create_org_as`, `add_member`, `membership_of`. Assertions always run as the
owner role; user actions run inside the helpers, which switch role and JWT
claims and switch back. Tests always `rollback`.

When you add an RPC or policy helper, update the allow-lists in
`000_security_baseline.test.sql` in the same pull request.
