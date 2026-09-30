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

Use `set local role authenticated;` plus
`set local request.jwt.claims = '{"sub": "<uuid>", "role": "authenticated"}';`
to act as a specific user inside a transaction. Tests always `rollback`.
