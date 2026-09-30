-- =============================================================================
-- Migration: identity_profiles
-- Stage:     P0-E3-S2 (identity, organisations & authorization)
--
-- Purpose
--   1. Private schemas:
--        authz    — authorization helpers called from RLS policies. The schema
--                   is NOT exposed through the Data API; `authenticated` gets
--                   USAGE only so policies can call granted helpers.
--        internal — triggers, audit writer, rate limiter, operator procedures.
--                   No API role has any privilege here.
--   2. Shared enums for the identity/organisation model.
--   3. `profiles`: the application identity, 1:1 with auth.users.
--
--   Profiles hold identity only. There is deliberately NO role, organisation
--   or "active organisation" column: authorization is membership-scoped
--   (docs/architecture/AUTHORIZATION_MODEL.md).
--
-- Verified by: supabase/tests/security/010_identity_profiles.test.sql
-- =============================================================================

create schema authz;
comment on schema authz is
  'Authorization helpers used by RLS policies and RPCs. Not exposed via the Data API.';
revoke all on schema authz from public;
grant usage on schema authz to authenticated;

create schema internal;
comment on schema internal is
  'Internal triggers, audit writer, rate limiting and operator procedures. No API access.';
revoke all on schema internal from public;

-- -----------------------------------------------------------------------------
-- Enums (in public so generated TypeScript types include them)
-- -----------------------------------------------------------------------------
create type public.profile_status as enum ('active', 'suspended');
create type public.organisation_type as enum ('agency', 'facility');
create type public.organisation_status as enum ('active', 'suspended', 'archived');
create type public.membership_status as enum ('active', 'suspended', 'revoked');
create type public.invite_status as enum ('pending', 'accepted', 'revoked');

-- -----------------------------------------------------------------------------
-- Shared trigger: maintain updated_at
-- -----------------------------------------------------------------------------
create function internal.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create table public.profiles (
  -- Same value as auth.users.id: one identity, one profile, no mapping lookups.
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text
    check (
      display_name is null
      or (char_length(btrim(display_name)) between 1 and 120 and display_name !~ '[[:cntrl:]]')
    ),
  status public.profile_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application identity (1:1 with auth.users). No roles or organisation data by design.';
comment on column public.profiles.status is
  'Platform-level account state. A suspended profile holds no capabilities anywhere.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function internal.set_updated_at();

alter table public.profiles enable row level security;

-- Users may read profiles (policy decides which) and edit ONLY their display name.
-- status and id are not updatable by any API role.
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- Create a profile for every new auth user.
-- user_metadata is user-controlled: display_name is length-limited and
-- control characters are discarded. Nothing else is read from it.
-- -----------------------------------------------------------------------------
create function internal.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text :=
    nullif(btrim(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 120)), '');
begin
  if v_display_name is not null and v_display_name ~ '[[:cntrl:]]' then
    v_display_name := null;
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, v_display_name);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function internal.handle_new_auth_user();
