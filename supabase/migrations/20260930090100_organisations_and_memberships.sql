-- =============================================================================
-- Migration: organisations_and_memberships
-- Stage:     P0-E3-S2
--
-- Purpose
--   `organisations`: generic tenant abstraction (agency | facility). Holds no
--   healthcare operational detail — agency/facility domain data belongs to
--   later domain tables keyed by organisation_id.
--
--   `organisation_memberships`: the link between a profile and an
--   organisation. A profile may hold many memberships. There is no "active
--   organisation" in the database: every authorization check names the
--   organisation explicitly.
--
--   Membership lifecycle: active ⇄ suspended → revoked. Invitation state lives
--   in organisation_invites (an invitee may not have an identity yet), so a
--   membership row only exists once an invitation is accepted or an
--   organisation is created.
--
--   Writes happen only through RPCs (later migrations). No API role has
--   insert/update/delete privileges on these tables.
--
-- Verified by: supabase/tests/security/020_organisations_memberships.test.sql
-- =============================================================================

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  type public.organisation_type not null,
  name text not null
    check (char_length(btrim(name)) between 2 and 200 and name !~ '[[:cntrl:]]'),
  slug text not null unique
    check (char_length(slug) between 3 and 63 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status public.organisation_status not null default 'active',
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target for composite foreign keys that bind (organisation, type) together.
  unique (id, type)
);

comment on table public.organisations is
  'Tenant abstraction. Type is immutable; organisations are archived, never deleted.';

create trigger organisations_set_updated_at
  before update on public.organisations
  for each row execute function internal.set_updated_at();

create function internal.prevent_organisation_type_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type is distinct from old.type then
    raise exception 'organisation type is immutable' using errcode = 'CH409';
  end if;
  return new;
end;
$$;

create trigger organisations_type_immutable
  before update on public.organisations
  for each row execute function internal.prevent_organisation_type_change();

alter table public.organisations enable row level security;
grant select on public.organisations to authenticated;

-- -----------------------------------------------------------------------------

create table public.organisation_memberships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One membership per person per organisation; lifecycle is a status change.
  unique (organisation_id, profile_id),
  -- Target for composite FKs: anything referencing a membership must also
  -- name the same organisation, so it cannot point across tenants.
  unique (id, organisation_id)
);

comment on table public.organisation_memberships is
  'Profile ↔ organisation link. Roles hang off memberships, never off profiles.';

create index organisation_memberships_profile_id_idx
  on public.organisation_memberships (profile_id);

create trigger organisation_memberships_set_updated_at
  before update on public.organisation_memberships
  for each row execute function internal.set_updated_at();

create function internal.prevent_membership_rebinding()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organisation_id is distinct from old.organisation_id
     or new.profile_id is distinct from old.profile_id then
    raise exception 'membership organisation and profile are immutable' using errcode = 'CH409';
  end if;
  return new;
end;
$$;

create trigger organisation_memberships_binding_immutable
  before update on public.organisation_memberships
  for each row execute function internal.prevent_membership_rebinding();

alter table public.organisation_memberships enable row level security;
grant select on public.organisation_memberships to authenticated;
