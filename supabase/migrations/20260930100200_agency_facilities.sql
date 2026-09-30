-- =============================================================================
-- Migration: agency_facilities
-- Stage:     P0-E3-S3
--
-- Purpose
--   Client facility records in an agency's operational domain, distinct from
--   participating facility ORGANISATIONS on Chelth:
--
--     public.organisations (type facility)  a facility that has joined Chelth
--     public.agency_facilities              an agency's record of a client
--                                           facility (may not be on Chelth)
--
--   linked_facility_organisation_id is NULL until an explicit, verified link
--   is made (platform-verified today; two-party consent designed for later).
--   Linking never re-points an existing link and never grants access by
--   itself — cross-organisation access flows through relationships
--   (docs/security/CROSS_ORG_DATA_SHARING.md).
--
--   Location hierarchy: facility → facility_locations (campus/site/ward
--   group) with an explicit IANA timezone. Departments/units are designed
--   (docs/architecture/FACILITY_DOMAIN_MODEL.md) but not created yet.
--
--   Facility types: migration-managed reference table (labels, ordering,
--   deprecation without enum surgery). Lifecycle states: enums.
--
-- Verified by: supabase/tests/security/080_facilities_relationships.test.sql
-- =============================================================================

create table public.facility_types (
  key text primary key check (key ~ '^[a-z][a-z_]*$'),
  name text not null,
  description text not null,
  is_active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now()
);

insert into public.facility_types (key, name, description, sort_order) values
  ('hospital',          'Hospital',                  'Acute or general hospital.',                        10),
  ('skilled_nursing',   'Skilled nursing facility',  'Skilled nursing / nursing home.',                   20),
  ('assisted_living',   'Assisted living',           'Assisted living or residential care.',              30),
  ('rehabilitation',    'Rehabilitation',            'Inpatient or outpatient rehabilitation.',           40),
  ('home_health',       'Home health',               'Care delivered in patients'' homes.',               50),
  ('hospice',           'Hospice',                   'Hospice and palliative care.',                      60),
  ('clinic',            'Clinic',                    'Outpatient clinic or practice.',                    70),
  ('behavioral_health', 'Behavioral health',         'Mental health and behavioral health services.',     80),
  ('other',             'Other',                     'Any other care setting.',                           90);

alter table public.facility_types enable row level security;
grant select on public.facility_types to authenticated;
create policy facility_types_select on public.facility_types for select to authenticated using (true);

create type public.facility_status as enum ('active', 'inactive', 'archived');
create type public.facility_location_status as enum ('active', 'inactive');

-- IANA timezone validation (trigger: pg_timezone_names is not immutable).
create function internal.validate_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.timezone is null
     or new.timezone ~ '^(posix|right)/'
     or not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = new.timezone) then
    raise exception 'invalid timezone' using errcode = 'CH400';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
create table public.agency_facilities (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  agency_organisation_type public.organisation_type not null default 'agency'
    check (agency_organisation_type = 'agency'),
  linked_facility_organisation_id uuid,
  linked_facility_organisation_type public.organisation_type
    check (linked_facility_organisation_type = 'facility'),
  name text not null check (char_length(btrim(name)) between 2 and 200 and name !~ '[[:cntrl:]]'),
  facility_type_key text not null references public.facility_types (key) on delete restrict,
  status public.facility_status not null default 'active',
  timezone text not null,
  -- Business contact details for the site (not personal contacts).
  phone text check (phone is null or phone ~ '^\+?[0-9 ()-]{6,20}$'),
  email text check (
    email is null
    or (email = lower(btrim(email)) and char_length(email) <= 320
        and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  address_line1 text check (address_line1 is null or char_length(address_line1) <= 200),
  address_line2 text check (address_line2 is null or char_length(address_line2) <= 200),
  locality text check (locality is null or char_length(locality) <= 100),
  region text check (region is null or char_length(region) <= 100),
  postal_code text check (postal_code is null or char_length(postal_code) <= 20),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  external_reference text check (external_reference is null or char_length(external_reference) between 1 and 100),
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_organisation_id, agency_organisation_type)
    references public.organisations (id, type) on delete restrict,
  foreign key (linked_facility_organisation_id, linked_facility_organisation_type)
    references public.organisations (id, type) on delete restrict,
  check ((linked_facility_organisation_id is null) = (linked_facility_organisation_type is null)),
  check (linked_facility_organisation_id is distinct from agency_organisation_id),
  unique (id, agency_organisation_id)
);

comment on table public.agency_facilities is
  'An agency''s client facility record. Optionally linked (explicitly, once) to a facility organisation.';

create unique index agency_facilities_one_link_per_agency
  on public.agency_facilities (agency_organisation_id, linked_facility_organisation_id)
  where linked_facility_organisation_id is not null;
create unique index agency_facilities_external_reference_per_agency
  on public.agency_facilities (agency_organisation_id, lower(external_reference))
  where external_reference is not null;
create index agency_facilities_agency_idx on public.agency_facilities (agency_organisation_id, status);
create index agency_facilities_linked_idx on public.agency_facilities (linked_facility_organisation_id)
  where linked_facility_organisation_id is not null;

create trigger agency_facilities_set_updated_at
  before update on public.agency_facilities
  for each row execute function internal.set_updated_at();
create trigger agency_facilities_ownership_immutable
  before update on public.agency_facilities
  for each row execute function internal.enforce_immutable_columns(
    'agency_organisation_id', 'agency_organisation_type');
create trigger agency_facilities_validate_timezone
  before insert or update of timezone on public.agency_facilities
  for each row execute function internal.validate_timezone();

-- A link is set once and never re-pointed or silently removed.
create function internal.protect_facility_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.linked_facility_organisation_id is not null
     and new.linked_facility_organisation_id is distinct from old.linked_facility_organisation_id then
    raise exception 'facility link cannot be changed' using errcode = 'CH409';
  end if;
  return new;
end;
$$;

create trigger agency_facilities_link_once
  before update on public.agency_facilities
  for each row execute function internal.protect_facility_link();

alter table public.agency_facilities enable row level security;
grant select on public.agency_facilities to authenticated;

-- -----------------------------------------------------------------------------
create table public.facility_locations (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  agency_facility_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 200 and name !~ '[[:cntrl:]]'),
  timezone text not null,
  status public.facility_location_status not null default 'active',
  address_line1 text check (address_line1 is null or char_length(address_line1) <= 200),
  locality text check (locality is null or char_length(locality) <= 100),
  postal_code text check (postal_code is null or char_length(postal_code) <= 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_facility_id, agency_organisation_id)
    references public.agency_facilities (id, agency_organisation_id) on delete restrict,
  -- Targets for future departments / shifts composite FKs.
  unique (id, agency_organisation_id),
  unique (id, agency_facility_id)
);

create unique index facility_locations_name_per_facility
  on public.facility_locations (agency_facility_id, lower(name));

create trigger facility_locations_set_updated_at
  before update on public.facility_locations
  for each row execute function internal.set_updated_at();
create trigger facility_locations_ownership_immutable
  before update on public.facility_locations
  for each row execute function internal.enforce_immutable_columns(
    'agency_organisation_id', 'agency_facility_id');
create trigger facility_locations_validate_timezone
  before insert or update of timezone on public.facility_locations
  for each row execute function internal.validate_timezone();

alter table public.facility_locations enable row level security;
grant select on public.facility_locations to authenticated;

revoke all on function internal.validate_timezone(), internal.protect_facility_link()
from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- RLS: agency staff with facility.view only. Facility organisations never read
-- agency client records directly (docs/security/CROSS_ORG_DATA_SHARING.md).
-- -----------------------------------------------------------------------------
create policy agency_facilities_select on public.agency_facilities
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'facility.view'));

create policy facility_locations_select on public.facility_locations
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'facility.view'));
