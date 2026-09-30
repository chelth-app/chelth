-- =============================================================================
-- Migration: agency_facility_relationships
-- Stage:     P0-E3-S3
--
-- Purpose
--   The explicit commercial/operational relationship between an agency and a
--   client facility record. Future contracts, billing terms, rate cards,
--   staffing permissions and VMS vendor settings attach to a relationship
--   (child tables keyed by (relationship_id, agency_organisation_id)) — no
--   redesign needed.
--
--   Lifecycle (relationship_status):
--     pending    proposed/being set up; no operational use
--     active     live relationship
--     suspended  temporarily on hold
--     ended      terminal; a new relationship may be created later
--   At most one non-ended relationship per client facility record.
--
--   Cross-organisation access primitive:
--     authz.has_relationship_capability(relationship_id, capability)
--   true only when ALL hold: relationship not ended; its client record is
--   explicitly linked to a facility organisation; the caller holds the
--   capability IN THAT FACILITY ORGANISATION. It grants access to the
--   specific relationship-scoped resource that calls it — never to agency
--   tenant tables in general.
--
-- Verified by: supabase/tests/security/080_facilities_relationships.test.sql
-- =============================================================================

create type public.relationship_status as enum ('pending', 'active', 'suspended', 'ended');

create table public.agency_facility_relationships (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  agency_facility_id uuid not null,
  status public.relationship_status not null default 'pending',
  started_at timestamptz,
  ended_at timestamptz,
  status_changed_at timestamptz not null default now(),
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The agency side is structurally an agency (agency_facilities enforces
  -- the agency type) and the facility record belongs to the same agency.
  foreign key (agency_facility_id, agency_organisation_id)
    references public.agency_facilities (id, agency_organisation_id) on delete restrict,
  unique (id, agency_organisation_id),
  check (status <> 'ended' or ended_at is not null),
  check (ended_at is null or started_at is null or ended_at >= started_at)
);

comment on table public.agency_facility_relationships is
  'Agency ↔ client facility relationship. Commercial terms attach here in later stages.';

create unique index agency_facility_relationships_one_open
  on public.agency_facility_relationships (agency_facility_id) where status <> 'ended';
create index agency_facility_relationships_agency_idx
  on public.agency_facility_relationships (agency_organisation_id, status);

create trigger agency_facility_relationships_set_updated_at
  before update on public.agency_facility_relationships
  for each row execute function internal.set_updated_at();
create trigger agency_facility_relationships_ownership_immutable
  before update on public.agency_facility_relationships
  for each row execute function internal.enforce_immutable_columns(
    'agency_organisation_id', 'agency_facility_id', 'created_at');

-- Ended relationships are history: no further changes.
create function internal.protect_ended_relationship()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'ended' then
    raise exception 'ended relationships are immutable' using errcode = 'CHR09';
  end if;
  return new;
end;
$$;

create trigger agency_facility_relationships_ended_immutable
  before update on public.agency_facility_relationships
  for each row execute function internal.protect_ended_relationship();

alter table public.agency_facility_relationships enable row level security;
grant select on public.agency_facility_relationships to authenticated;

-- -----------------------------------------------------------------------------
-- Relationship-scoped authorization
-- -----------------------------------------------------------------------------
create function authz.has_relationship_capability(p_relationship_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.agency_facility_relationships r
    join public.agency_facilities f
      on f.id = r.agency_facility_id
     and f.agency_organisation_id = r.agency_organisation_id
    where r.id = p_relationship_id
      and r.status <> 'ended'
      and f.linked_facility_organisation_id is not null
      and authz.has_capability(f.linked_facility_organisation_id, p_capability)
  )
$$;

revoke all on function authz.has_relationship_capability(uuid, text) from public, anon;
grant execute on function authz.has_relationship_capability(uuid, text) to authenticated;
revoke all on function internal.protect_ended_relationship() from public, anon, authenticated;

-- Agency side: relationship.view in the agency. Facility side: the SAME
-- capability held in the explicitly linked facility organisation, for this
-- relationship only, while it is not ended.
create policy agency_facility_relationships_select on public.agency_facility_relationships
  for select to authenticated
  using (
    authz.has_capability(agency_organisation_id, 'relationship.view')
    or authz.has_relationship_capability(id, 'relationship.view')
  );

-- -----------------------------------------------------------------------------
-- Facility-side projection: what a facility organisation may know about its
-- agency relationships. Deliberately narrow: agency name, status, start date.
-- No agency client-record fields, no workers, no other clients.
-- -----------------------------------------------------------------------------
create function public.list_partner_agency_relationships(p_facility_organisation_id uuid)
returns table (
  relationship_id uuid,
  agency_organisation_id uuid,
  agency_name text,
  relationship_status public.relationship_status,
  relationship_started_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_facility_organisation_id, 'relationship.view');

  return query
    select r.id, r.agency_organisation_id, o.name, r.status, r.started_at
    from public.agency_facility_relationships r
    join public.agency_facilities f
      on f.id = r.agency_facility_id and f.agency_organisation_id = r.agency_organisation_id
    join public.organisations o on o.id = r.agency_organisation_id
    where f.linked_facility_organisation_id = p_facility_organisation_id
      and r.status <> 'ended'
    order by o.name;
end;
$$;

revoke all on function public.list_partner_agency_relationships(uuid) from public, anon;
grant execute on function public.list_partner_agency_relationships(uuid) to authenticated;
