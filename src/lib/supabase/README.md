# Supabase clients

| Module       | Where it may be used                              | Credentials     | Guard         |
| ------------ | ------------------------------------------------- | --------------- | ------------- |
| `browser.ts` | Client Components                                 | anon key + user | `client-only` |
| `server.ts`  | Server Components, Server Actions, Route Handlers | anon key + user | `server-only` |
| `proxy.ts`   | `src/proxy.ts` only (session refresh)             | anon key + user | —             |

All three act **as the signed-in user**, so Row Level Security always applies.

## There is intentionally no service-role client

No module in this repository reads a Supabase service-role / secret key, and
ESLint rejects the identifier `SUPABASE_SERVICE_ROLE_KEY` anywhere in `src/`.

If a future feature genuinely requires privileged access (e.g. a scheduled
reconciliation job), it must:

1. Be approved as an architecture decision and recorded in `docs/architecture/`.
2. Live in a dedicated `src/lib/supabase/privileged/` module that imports
   `server-only`, exposes **narrow, purpose-named functions** (never a raw
   client), and validates all inputs.
3. Prefer a `security definer` Postgres function with explicit checks, or an
   Edge Function, over a service-role client in the web app.
4. Update the ESLint exception and `docs/security/SECURITY_INVARIANTS.md`.

Never create a generic `createAdminClient()` that can be imported anywhere.
