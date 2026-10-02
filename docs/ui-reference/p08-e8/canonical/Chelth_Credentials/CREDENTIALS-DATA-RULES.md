# Chelth Credentials — Data Rules

## Source of truth
Credential readiness must come from the canonical credential records.

Do not duplicate credential truth inside Workforce, Worker Profile, Shifts, or other modules.

## Typical concepts
Use the actual Chelth schema where available:
- credential record id
- tenant/workspace id
- worker id
- credential type
- status
- issue date
- expiration date
- verification state
- reviewer
- reviewed at
- document/evidence reference
- notes
- created/updated timestamps

## Historical integrity
Do not erase:
- prior verification decisions
- original uploaded evidence
- rejection/update history

## Tenant isolation
Enforce tenant isolation at the database/server layer.

## Permissions
Review, approve, reject, request update, and delete/archive actions must be permission-controlled.

## Auditability
Material credential actions should record actor and timestamp.
