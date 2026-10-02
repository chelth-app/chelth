# Chelth Settings — Interaction Specification

## Status

**Settings: LOCKED**

Do not redesign the canonical Chelth app shell or Settings information architecture.

---

## 1. Page behavior

Settings uses the normal Chelth application shell.

Inside the main content area, Settings introduces a secondary vertical navigation.

Changing a Settings section should:
1. keep the global Chelth shell unchanged;
2. keep the Settings page title/context;
3. update only the Settings work area;
4. avoid full-page reload where practical;
5. preserve unsaved-change safeguards.

---

## 2. Organization

Purpose:
Manage core workspace identity and operational defaults.

Supported concepts may include:
- workspace name
- business type
- support email
- phone
- timezone
- default currency
- default shift confirmation window
- credential reminder window
- first day of week
- default facility view
- credential verification policy
- shift reminder policy
- location verification/geofencing
- self-scheduling
- workspace logo / identity

### Save behavior
- changed fields should show a dirty/unsaved state;
- `Save Changes` persists all valid changes;
- `Cancel` restores last-saved values;
- successful save uses the canonical Chelth success-toast pattern.

---

## 3. Team & Permissions

Purpose:
Manage workspace members and role-based access.

Capabilities:
- invite member
- view member status
- view assigned role
- resend/revoke invitation where supported
- deactivate/remove workspace access
- review role permissions

Do not silently create new roles if the current authorization model does not support them.

Permissions must be enforced server/database-side, not only hidden in the UI.

---

## 4. Notifications

Purpose:
Control workspace operational alerts.

Suggested categories:
- shift confirmations
- credential readiness
- attendance exceptions
- staffing requests
- timesheets/payroll

Delivery preferences may include:
- email
- in-app
- digest frequency
- quiet hours

Only expose channels implemented by the product.

---

## 5. Attendance & Geofencing

Purpose:
Configure the worker attendance verification policy.

Potential controls:
- location verification enabled/disabled
- default geofence radius
- minimum acceptable location accuracy
- late check-in threshold
- missing check-in threshold
- supervisor overrides
- required override reason
- evidence preservation

### Critical rule
The original location/geofence evidence must not be overwritten by an override.

Overrides should create a separate auditable decision.

Facility-specific geofence policy may override workspace defaults where the product supports it.

---

## 6. Shifts & Scheduling

Purpose:
Control scheduling defaults and worker self-service rules.

Potential controls:
- confirmation window
- default calendar view
- first day of week
- open/unassigned shift visibility
- self-scheduling
- credential conflict prevention
- overlapping shift prevention

These settings should feed existing Shifts logic instead of creating parallel business rules.

---

## 7. Timesheets & Payroll

Purpose:
Configure worked-time and approval defaults.

Potential controls:
- pay period
- week start
- default unpaid break
- timesheet deadline
- attendance prefill
- manual-adjustment review
- approved-timesheet locking/correction flow

Do not allow Settings to rewrite historical Attendance or approved Timesheet evidence.

---

## 8. Rates & Billing

Purpose:
Set default commercial configuration.

Potential controls:
- default currency
- invoice terms
- invoice numbering format
- billing contact
- rate effective-date requirements
- historical-rate protection

### Critical rule
Historical payroll/invoice calculations must retain their applied rate/version.

Changing Settings must not retrospectively rewrite historical financial records.

---

## 9. Integrations

Purpose:
Manage supported external connections.

Potential categories:
- payroll
- calendar
- email
- accounting

Only show providers/integrations supported by the actual implementation.

Connection state should use real integration status.

Do not fabricate provider availability.

---

## 10. Security

Purpose:
Manage workspace security controls.

Potential settings:
- MFA requirement
- session timeout
- audit logging
- active sessions
- session revocation

Security-sensitive operations require authoritative backend enforcement.

---

## 11. Workspace

Purpose:
Manage workspace-level identity, regional settings, and lifecycle.

Potential controls:
- display name
- workspace ID
- timezone
- regional date format
- archive workspace
- deactivate workspace

Archive/deactivate actions require explicit destructive confirmation.

Do not delete historical operational records unless there is a separate approved deletion workflow.

---

## 12. Unsaved changes

If the user attempts to:
- switch Settings section,
- navigate away,
- close the page,

while changes are unsaved, use the canonical confirmation pattern.

Options:
- discard changes
- remain on page
- save first where supported

---

## 13. Access control

Settings sections should be permission-aware.

Examples:
- general admins may edit operational defaults;
- security settings may be limited to workspace admins;
- financial settings may be restricted to authorized finance/admin roles;
- destructive workspace actions should use the highest permission threshold.

Do not depend on front-end visibility as authorization.

---

## 14. Accessibility

Implement:
- keyboard-accessible Settings navigation
- semantic form labels
- correct toggle semantics
- visible focus states
- accessible validation messages
- status text in addition to color
- reduced-motion support
- properly announced success/error states

---

## 15. No redesign

Do not change:
- canonical sidebar
- top global header
- backdrop
- typography
- spacing
- card system
- form language
- toggle language
- button hierarchy
- destructive-modal language
- Chelth logo treatment
