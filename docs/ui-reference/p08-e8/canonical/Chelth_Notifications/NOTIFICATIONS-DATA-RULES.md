# Chelth Notifications / Activity — Data Rules

## Principle
Notifications should link to real operational events rather than duplicate their source data.

## Event references
Where possible retain:
- workspace/tenant
- event type
- related record id
- worker id
- facility id
- created timestamp
- read state
- archived state
- action-required / resolved state

## Source integrity
A notification may summarize a Shift, Credential, Staffing Request, Facility, Attendance or Timesheet event, but the underlying module remains the source of truth.

## Tenant isolation
All notification reads/writes must be tenant-scoped server-side.

## Auditability
Important user actions such as archive, resolve, or document request should be auditable where required.

## Permissions
Do not expose linked records a user is not permitted to access.
