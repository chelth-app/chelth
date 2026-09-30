# Integration tests

Service- and database-level tests that exercise real Supabase behaviour
(RLS as seen through the API, RPC contracts, auth flows) against the **local**
stack only. `global-setup.ts` refuses to run against any non-local host.

```bash
npm run db:start && npm run db:reset
npm run test:integration   # reads NEXT_PUBLIC_SUPABASE_* from the environment
```

No tests exist yet: they arrive with the first schema in P0-E3-S2. Pure policy
invariants belong in pgTAP (`supabase/tests/`); tests here cover behaviour that
spans the API boundary.
