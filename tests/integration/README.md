# Integration tests

Real flows through the public Supabase APIs against the **local** stack only
(`global-setup.ts` refuses non-local API or database hosts).

```bash
npm run db:start && npm run db:reset
npm run test:integration   # reads .env.local locally; CI exports `npm run db:env`
```

- Identities are created by **real sign-up** and confirmed with the real email
  link captured by local Mailpit (`tests/support/mailpit.ts`). No service-role
  key is used.
- MFA step-up uses real TOTP enrolment (`tests/support/totp.ts`).
- The only owner-role database access is the platform-admin **operator
  procedure** (`internal.grant_platform_admin`), which is deliberately
  unreachable through the API.
- `vocabulary-drift.test.ts` fails if TypeScript role/capability constants
  disagree with the migration-defined reference data.

Pure policy invariants belong in pgTAP (`supabase/tests/`); tests here cover
behaviour across the API boundary (PostgREST, GoTrue, RPC error codes).
