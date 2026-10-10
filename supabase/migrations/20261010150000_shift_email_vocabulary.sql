-- =============================================================================
-- Migration: shift_email_vocabulary
-- Stage:     P0-E9-3G (shift email notifications)
--
-- Purpose
--   New worker notification events (enum values must be committed before the
--   functions in 20261010150100 can use them):
--     shift_changed   a worker-relevant field of a shift the worker holds changed
--     shift_reminder  ~24 hours before an accepted shift starts
--   Existing events reused (unchanged meaning): worker_assigned (direct
--   assignment), shift_offered, assignment_cancelled, shift_cancelled.
-- =============================================================================

alter type internal.notification_event add value if not exists 'shift_changed';
alter type internal.notification_event add value if not exists 'shift_reminder';
