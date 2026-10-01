# Financial Data Access

Status: P0-E7-S1.

## Capabilities

| Capability     | Meaning                                       | Roles                              | AAL2 |
| -------------- | --------------------------------------------- | ---------------------------------- | :--: |
| `rates.view`   | See rate cards, versions and pricing policies | admin, finance, operations manager |  no  |
| `rates.manage` | Create, edit drafts, activate rates/policies  | admin, finance                     | yes  |
| `pricing.view` | See priced timesheets (pay **and** bill)      | admin, finance, operations manager |  no  |
| `pricing.run`  | Price a locked timesheet revision             | admin, finance                     |  no  |

Scheduler, recruiter, credentialing officer and healthcare worker: none.
Facility roles: none. `pricing.run` is not AAL2 because it cannot introduce
any value: it is deterministic from locked evidence and active
configuration, idempotent and audited.

## Rules

- **Facilities never see pay, margin or pricing.** No facility RLS path to
  any rate or pricing table; no facility projection includes rates or
  amounts; facility routes to rates/pricing return 404.
- **Workers see no internal pricing** in this stage (no pay details,
  no priced timesheets, no rates). Timesheet projections carry minutes only.
- **Tenant isolation**: every table is agency-scoped by RLS
  (`has_capability(agency, …)`) and composite foreign keys; platform
  administrators have no tenant path; anon has nothing.
- **Deny by default**: `authenticated` holds SELECT only; all writes are
  SECURITY DEFINER functions with an empty `search_path`.
- **No client amounts or minutes**: rate amounts typed by finance users are
  parsed exactly and validated; pricing accepts only a timesheet id and the
  expected revision.
- **Audit** records ids, codes, currency and minor-unit values — never free
  text.
- Location-evidence retention remains configurable and still requires
  jurisdiction/contract confirmation
  ([ATTENDANCE_EVIDENCE_RETENTION.md](ATTENDANCE_EVIDENCE_RETENTION.md)).
- This stage performs **no payroll, tax or invoicing**.
