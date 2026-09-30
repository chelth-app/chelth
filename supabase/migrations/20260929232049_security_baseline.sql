-- =============================================================================
-- Migration: security_baseline
-- Stage:     P0-E3-S1 (technical foundation)
--
-- Purpose
--   Make "deny by default" an explicit, versioned property of the database
--   rather than an implicit platform default that could change or differ
--   between environments.
--
--   After this migration, any table, view, sequence or function created in
--   the `public` schema by the migration role is NOT accessible to the Data
--   API roles (`anon`, `authenticated`) until a later migration grants access
--   deliberately, alongside the RLS policies that constrain it.
--
--   Postgres grants EXECUTE on new functions to PUBLIC by default; that is
--   revoked here so a newly created (possibly SECURITY DEFINER) function is
--   never callable by anonymous users by accident.
--
--   Objects must be created by the migration role (`postgres`). Default
--   privileges of platform roles (e.g. supabase_admin) are outside our
--   control; the pgTAP RLS/grant checks catch anything created another way.
--
-- Creates no tables. Domain schema begins in P0-E3-S2+.
-- Verified by: supabase/tests/security/000_security_baseline.test.sql
-- =============================================================================

-- Tables and views
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

-- Sequences
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- Functions / procedures (public schema): no Data API role may execute by default.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- Postgres grants EXECUTE to PUBLIC through a *global* default privilege,
-- which a per-schema revoke cannot remove. Revoke it globally for the
-- migration role. Consequence (intended): every function created by a
-- migration — including by an extension installed in a migration — needs an
-- explicit `grant execute ... to <role>` before any API role can call it.
alter default privileges for role postgres
  revoke execute on functions from public;

-- Only the migration role may create objects in public.
revoke create on schema public from public;
