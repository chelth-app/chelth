# Chelth Settings — Data & Policy Rules

## Principle

Settings should configure existing Chelth product behavior.

Do not create a second set of business rules disconnected from:
- Shifts
- Credentials
- Attendance
- Timesheets
- Rates + Pricing
- Payroll + Invoices
- Notifications
- Security

---

## Workspace scope

Settings should be stored at the appropriate level:
- workspace / tenant defaults
- facility override
- user preference

Do not store a facility-specific policy globally if the architecture supports facility overrides.

---

## Suggested settings domains

### Organization
- workspace name
- business type
- support contact
- timezone
- currency
- logo/identity reference

### Scheduling
- confirmation window
- default calendar view
- week-start preference
- self-scheduling policy

### Credentials
- verification requirement
- reminder window

### Attendance
- geofence enabled
- default radius
- accuracy threshold
- late threshold
- missing threshold
- override policy

### Timesheets
- pay period
- default break
- submission deadline
- attendance prefill
- correction policy

### Billing
- invoice terms
- numbering
- billing contact
- currency
- historical-rate protection

### Notifications
- event-category preferences
- supported delivery channels
- digest/quiet-hour preferences

### Security
- MFA policy
- session timeout
- audit controls

---

## Tenant isolation

Settings are tenant/workspace-sensitive.

Enforce tenant isolation at:
- database policy / query layer
- server/API layer
- background jobs

Never rely on front-end filtering alone.

---

## Auditability

Important settings changes should be auditable, especially:
- security changes
- permission changes
- attendance/geofence policy changes
- timesheet/payroll rule changes
- pricing/billing changes
- workspace lifecycle actions

Audit events should retain:
- actor
- timestamp
- setting changed
- old value where appropriate
- new value where appropriate

---

## Historical integrity

Settings changes should generally affect future behavior.

Do not silently rewrite historical records when changing:
- rate rules
- pay periods
- break policy
- geofence settings
- approval rules
- invoice terms

Existing records should preserve the rules/evidence that applied when they were created.

---

## Sensitive settings

Treat as sensitive:
- permissions
- security policy
- payroll/billing configuration
- workspace lifecycle

Require suitable roles for changes.

---

## Validation

Validate settings on the server.

Examples:
- geofence radius must be within allowed limits;
- percentages/timeouts must be valid;
- invoice terms must match supported values;
- workspace timezone must be recognized;
- email fields must be structurally valid.

Do not trust client-provided settings values without validation.
