# Feature modules

Business domains live here, one folder per bounded context. None exist yet —
the first (identity & organisations) arrives in P0-E3-S2.

```
src/features/<feature>/
  components/     # UI specific to this feature (server-first; "use client" only when needed)
  actions.ts      # Server Actions — validate input, check authz, call service, return ActionResult
  service.ts      # server-only domain logic / RPC calls (imports "server-only")
  queries.ts      # server-only read functions
  schemas.ts      # Zod schemas for this feature's inputs
  types.ts        # feature types (derived from database.types.ts where possible)
  index.ts        # the feature's public surface — other features import only from here
```

Rules:

- Route files in `src/app/` stay thin: they compose feature components and call
  feature queries/actions. No business logic in `page.tsx`.
- A feature may import from `src/lib`, `src/components` and another feature's
  `index.ts` — never from another feature's internals.
- Every Server Action: parse input with a schema → establish identity →
  authorise → mutate (ideally via an RPC for sensitive state transitions) →
  return `ActionResult`. Never trust client-supplied IDs for tenancy.
