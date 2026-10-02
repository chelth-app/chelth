# Chelth Rates + Pricing — Data Rules

## Core principle

Rates + Pricing defines pricing rules.

Downstream operational and financial records should reference the appropriate applied rate/version rather than relying only on today's current rate.

## Typical concepts

Use the actual Chelth schema where it exists.

Potential fields:
- rate_card_id
- workspace / tenant id
- facility_id
- role_id / role
- rate_type
- base_bill_rate
- worker_pay_rate
- weekend_differential
- night_differential
- overtime_rule
- effective_from
- effective_to
- status
- created_by
- updated_by
- created_at
- updated_at

## Effective dating

Avoid destructive edits to historical pricing.

Where supported:
- future pricing changes should have effective dates;
- historical shifts/timesheets/invoices should preserve their applied rate/version;
- deactivation should stop future use without erasing history.

## Tenant isolation

Pricing data is commercially sensitive.

Enforce tenant/workspace isolation at the data layer.

Do not rely on client-side filtering for authorization.

## Auditability

Important rate changes should be recorded:
- create
- edit
- activate
- deactivate
- differential change
- date change

Preserve actor and timestamp.

## Currency

Use the tenant/business currency configuration where product architecture supports it.

Do not hard-code USD solely because the visual reference uses `$`.
