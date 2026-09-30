-- =============================================================================
-- Migration: shifts
-- Stage:     P0-E5-S1
--
-- Purpose
--   One entity, public.shifts, models work an agency fulfils for a client
--   facility. A facility staffing REQUEST is a shift with source = 'facility'
--   that starts in status 'submitted' and becomes 'open' only when the agency
--   opens it (agency keeps operational control). Headcount is a column: one
--   shift needing 4 CNAs is ONE row with requested_headcount = 4 and up to 4
--   active assignments — never four duplicate shifts.
--
--   Structural ownership (composite FKs; hold even if RLS or code fails):
--     (agency_facility_id, agency_organisation_id)            → agency_facilities
--     (relationship_id, agency_organisation_id, agency_facility_id)
--                                                             → agency_facility_relationships
--     (facility_location_id, agency_facility_id)              → facility_locations
--     (created_by_membership_id, created_by_organisation_id)  → organisation_memberships
--   A facility-sourced shift's creator organisation must be the facility
--   organisation LINKED to the agency's client record (trigger).
--
--   Time model (docs/architecture/SHIFT_TIME_MODEL.md): start_at/end_at are
--   canonical timestamptz; timezone is the location's IANA zone captured at
--   scheduling time (trigger-checked against the location). end_at > start_at;
--   a shift spans at most 25 hours of elapsed time (a 24-hour wall-clock shift
--   across a DST fall-back); longer engagements are multiple shifts.
--
--   Lifecycle (stored):
--     draft ──► open ──► completed        agency-created
--     submitted ──► open                  facility-submitted request
--     draft | submitted | open ──► cancelled (controlled reason)
--   cancelled and completed are terminal (immutable). Once open, the
--   scheduling identity (location, discipline, times) is fixed.
--
--   Notes: `instructions` are operational instructions visible to the agency,
--   the linked facility and actively assigned workers. Agency-internal notes
--   live in shift_internal_notes (agency only).
--
-- Verified by: supabase/tests/security/110_shifts.test.sql
-- =============================================================================

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  agency_organisation_type public.organisation_type not null default 'agency'
    check (agency_organisation_type = 'agency'),
  agency_facility_id uuid not null,
  relationship_id uuid not null,
  facility_location_id uuid not null,
  discipline_key text not null references public.disciplines (key) on delete restrict,
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null,
  requested_headcount integer not null check (requested_headcount between 1 and 100),
  status public.shift_status not null,
  source public.shift_source not null,
  external_reference text
    check (external_reference is null
           or (char_length(btrim(external_reference)) between 1 and 100 and external_reference !~ '[[:cntrl:]]')),
  instructions text
    check (instructions is null or char_length(btrim(instructions)) between 1 and 2000),
  created_by_organisation_id uuid not null,
  created_by_membership_id uuid not null,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  opened_at timestamptz,
  opened_by_profile_id uuid references public.profiles (id) on delete set null,
  cancelled_at timestamptz,
  cancellation_reason public.shift_cancellation_reason,
  cancelled_by_profile_id uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_organisation_id, agency_organisation_type)
    references public.organisations (id, type) on delete restrict,
  foreign key (agency_facility_id, agency_organisation_id)
    references public.agency_facilities (id, agency_organisation_id) on delete restrict,
  foreign key (relationship_id, agency_organisation_id, agency_facility_id)
    references public.agency_facility_relationships (id, agency_organisation_id, agency_facility_id)
    on delete restrict,
  foreign key (facility_location_id, agency_facility_id)
    references public.facility_locations (id, agency_facility_id) on delete restrict,
  foreign key (created_by_membership_id, created_by_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  unique (id, agency_organisation_id),
  -- Target for assignments: the assignment's copy of the period must match.
  unique (id, agency_organisation_id, start_at, end_at),
  check (end_at > start_at),
  check (end_at - start_at <= interval '25 hours'),
  check ((status = 'cancelled') = (cancelled_at is not null and cancellation_reason is not null)),
  check ((status = 'completed') = (completed_at is not null)),
  check (status <> 'open' or opened_at is not null),
  -- Agency shifts start as drafts; facility requests start as submissions.
  check (not (source = 'agency' and status = 'submitted')),
  check (not (source = 'facility' and status = 'draft')),
  check ((source = 'agency') = (created_by_organisation_id = agency_organisation_id))
);

comment on table public.shifts is
  'Work requested for a client facility and fulfilled by an agency. Fill state is derived, never stored.';
comment on column public.shifts.instructions is
  'Operational instructions visible to the agency, the linked facility and actively assigned workers. No patient data.';
comment on column public.shifts.timezone is
  'IANA timezone of the facility location at scheduling time. Display and date semantics only; start_at/end_at are canonical.';

create index shifts_agency_start_idx on public.shifts (agency_organisation_id, start_at);
create index shifts_relationship_start_idx on public.shifts (relationship_id, start_at);
create index shifts_facility_idx on public.shifts (agency_facility_id, start_at);

create trigger shifts_set_updated_at
  before update on public.shifts
  for each row execute function internal.set_updated_at();
create trigger shifts_ownership_immutable
  before update on public.shifts
  for each row execute function internal.enforce_immutable_columns(
    'agency_organisation_id', 'agency_organisation_type', 'agency_facility_id', 'relationship_id', 'source',
    'created_by_organisation_id', 'created_by_membership_id', 'created_at');
create trigger shifts_validate_timezone
  before insert or update of timezone on public.shifts
  for each row execute function internal.validate_timezone();

-- Timezone follows the location; facility requests are made by the LINKED facility.
create function internal.check_shift_context()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_location_timezone text;
  v_linked uuid;
begin
  select l.timezone into v_location_timezone
  from public.facility_locations l where l.id = new.facility_location_id;
  if new.timezone is distinct from v_location_timezone then
    raise exception 'shift timezone must match the facility location' using errcode = 'CH400';
  end if;

  if tg_op = 'INSERT' and new.source = 'facility' then
    select f.linked_facility_organisation_id into v_linked
    from public.agency_facilities f where f.id = new.agency_facility_id;
    if v_linked is null or new.created_by_organisation_id <> v_linked then
      raise exception 'facility requests must come from the linked facility organisation' using errcode = 'CH403';
    end if;
  end if;
  return new;
end;
$$;

create trigger shifts_check_context
  before insert or update of facility_location_id, timezone on public.shifts
  for each row execute function internal.check_shift_context();

create function internal.enforce_shift_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_active integer;
begin
  if old.status in ('cancelled', 'completed') then
    raise exception 'shift is closed' using errcode = 'CHS09';
  end if;

  if new.status is distinct from old.status then
    if (old.status, new.status) not in (
      ('draft'::public.shift_status, 'open'::public.shift_status),
      ('draft', 'cancelled'),
      ('submitted', 'open'),
      ('submitted', 'cancelled'),
      ('open', 'cancelled'),
      ('open', 'completed')
    ) then
      raise exception 'shift status change not allowed' using errcode = 'CH409';
    end if;
    new.status_changed_at := now();
  end if;

  if old.status = 'open'
     and (new.start_at, new.end_at, new.facility_location_id, new.discipline_key, new.timezone)
         is distinct from (old.start_at, old.end_at, old.facility_location_id, old.discipline_key, old.timezone) then
    raise exception 'scheduling details cannot change once a shift is open' using errcode = 'CH409';
  end if;

  if new.requested_headcount < old.requested_headcount then
    select count(*) into v_active from public.shift_assignments a
    where a.shift_id = new.id and a.status in ('assigned', 'accepted');
    if new.requested_headcount < v_active then
      raise exception 'headcount cannot be below active assignments' using errcode = 'CH409';
    end if;
  end if;
  return new;
end;
$$;

create trigger shifts_transition
  before update on public.shifts
  for each row execute function internal.enforce_shift_transition();

alter table public.shifts enable row level security;
grant select on public.shifts to authenticated;

-- Agency side only. Facilities and workers read through narrow projections
-- (list_facility_shifts, list_my_shift_assignments).
create policy shifts_select on public.shifts
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'shift.view'));

-- -----------------------------------------------------------------------------
-- Agency-internal shift notes: never visible to facilities or workers.
-- -----------------------------------------------------------------------------
create table public.shift_internal_notes (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  shift_id uuid not null,
  author_profile_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (shift_id, agency_organisation_id)
    references public.shifts (id, agency_organisation_id) on delete restrict
);

comment on table public.shift_internal_notes is
  'Agency-internal notes about a shift. Never visible to facilities or workers.';

create index shift_internal_notes_shift_idx on public.shift_internal_notes (shift_id, created_at desc);

create trigger shift_internal_notes_append_only
  before update or delete on public.shift_internal_notes
  for each row execute function internal.refuse_update_delete();

alter table public.shift_internal_notes enable row level security;
grant select on public.shift_internal_notes to authenticated;
create policy shift_internal_notes_select on public.shift_internal_notes
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'shift.view'));

revoke all on function internal.check_shift_context(), internal.enforce_shift_transition()
from public, anon, authenticated;
