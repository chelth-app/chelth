-- =============================================================================
-- Migration: custom_credential_vocabulary
-- Stage:     P0-E9-3J (custom certifications & requirements)
--
-- Purpose
--   Two credential categories for agency-defined requirement types (enum
--   values must be committed before 20261011110100 uses them):
--     orientation  e.g. "North Wing Orientation", client-specific induction
--     other        anything that fits no other category
-- =============================================================================

alter type public.credential_category add value if not exists 'orientation';
alter type public.credential_category add value if not exists 'other';
