-- =============================================================================
-- Migration: operations_vocabulary
-- Stage:     P0-E5-S2 (assignment operations & notifications)
--
-- Purpose
--   Controlled vocabularies for this stage. Enum values added here are used by
--   LATER migrations (a value added by ALTER TYPE … ADD VALUE cannot be used in
--   the transaction that adds it).
--
--   No new capabilities: offers reuse assignment.manage (an offer is an
--   invitation to an assignment and passes the same gate on acceptance);
--   operational attention reuses assignment.view (+ compliance.view for
--   compliance reasons). See docs/architecture/AUTHORIZATION_MODEL.md.
-- =============================================================================

-- Ending a relationship cancels not-yet-started work with this reason.
alter type public.shift_cancellation_reason add value if not exists 'relationship_ended';

-- Notification events added by this stage.
alter type internal.notification_event add value if not exists 'shift_offered';
alter type internal.notification_event add value if not exists 'relationship_suspended';
alter type internal.notification_event add value if not exists 'relationship_ended';

-- Delivery state machine (internal only).
create type internal.notification_state as enum ('pending', 'processing', 'sent', 'retry', 'failed');

-- Shift offers
create type public.shift_offer_status as enum ('offered', 'accepted', 'declined', 'expired', 'cancelled');
create type public.shift_offer_close_reason as enum (
  'shift_filled', 'shift_cancelled', 'shift_closed', 'withdrawn', 'relationship_not_active', 'assigned_directly'
);

-- Assignment issues (operational attention; never an assignment status)
create type public.assignment_issue_type as enum ('not_eligible', 'relationship_not_active');
create type public.assignment_issue_status as enum ('open', 'resolved');
create type public.assignment_issue_severity as enum ('attention', 'urgent');
create type public.assignment_issue_source as enum (
  'scheduled_scan', 'manual_recheck', 'relationship_change'
);
create type public.assignment_issue_resolution as enum (
  'eligible_again', 'relationship_restored', 'assignment_closed', 'shift_closed'
);
