# Chelth Credentials — Interaction Specification

## Status
**Credentials: LOCKED**

## Purpose
Credentials is the operational record for workforce credential readiness.

## KPI filters
- Up to Date
- Expiring Soon
- Needs Review
- Missing

Selecting a KPI applies the matching filter without a full page reload.

## Table / rows
Each credential row opens the matching record in the Credential Details drawer.

Preserve the selected worker, credential type, facility context, and active filters.

## Filters
Support the locked controls:
- professional
- credential type
- status
- facility
- expiration
- search

## Add Credential
Open the canonical add/upload credential flow. Do not invent a separate visual system.

## Credential Details drawer
Show live data for the selected record, including supported fields such as:
- worker
- credential type
- issue / expiration dates
- status
- verification state
- facility or role requirement context
- uploaded evidence/document where supported
- audit/review history where supported

## Review Credential
A permission-controlled review action. Record reviewer, timestamp, and resulting state.

## Request Update
Open the existing communication/request flow for updated documentation. Preserve the credential and professional context.

## View Professional
Open the canonical Worker Profile for the selected professional.

## Drawer behavior
When closed, the main Credentials workspace expands into the freed width. Do not leave a blank gutter.

## Accessibility
Use keyboard-accessible rows, semantic controls, visible focus, status text beyond color, and reduced-motion support.

## No redesign
Do not change shell, typography, colors, spacing, table style, chips, drawer, or action hierarchy.
