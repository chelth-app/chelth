## Summary

<!-- What changes and why. Link the stage/ticket. -->

## Checklist

- [ ] No business logic in `src/app` route files (lives in `src/features/<feature>`)
- [ ] Untrusted input validated with a Zod schema at the boundary
- [ ] Authorization enforced server-side / by RLS — not by hiding UI
- [ ] **Database changes are in a new migration** (no edits to merged migrations, nothing applied manually)
- [ ] New tenant-aware tables have RLS + cross-tenant pgTAP tests in the same PR
- [ ] No secrets, tokens or personal data in code, logs, fixtures or screenshots
- [ ] User-facing errors use `AppError` codes (no raw database messages)
- [ ] Accessible: labels, keyboard operation, visible focus, colour contrast
- [ ] `npm run verify` passes locally
