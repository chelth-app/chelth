-- =============================================================================
-- Migration: shift_projections
-- Stage:     P0-E5-S1
--
-- Purpose
--   Narrow, relationship-scoped and self-scoped read models. Facilities and
--   workers never read public.shifts / shift_assignments of an agency through
--   RLS; they read ONLY these projections.
--
--   Facility (docs/security/SHIFT_CROSS_ORG_ACCESS.md):
--     list_facility_request_options   active locations of ONE relationship (to request)
--     list_facility_shifts            shifts under the facility's non-ended
--                                     relationships (drafts excluded): time,
--                                     location, discipline, headcount, fill
--                                     counts, status, instructions
--     list_facility_shift_assignments who is coming: assignment id, display
--                                     name, discipline, assignment state and a
--                                     readiness indicator (no reasons, no
--                                     credentials, no contact details). Audited.
--   Worker:
--     list_my_shift_assignments       own assignments at one agency; shift
--                                     instructions only while the assignment
--                                     is active
--
-- Verified by: supabase/tests/security/130_shift_projections.test.sql
-- =============================================================================

create function public.list_facility_request_options(p_relationship_id uuid)
returns table (facility_location_id uuid, location_name text, timezone text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  if not authz.has_relationship_capability(p_relationship_id, 'shift.request') then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  return query
    select l.id, l.name, l.timezone
    from public.agency_facility_relationships r
    join public.facility_locations l on l.agency_facility_id = r.agency_facility_id
    where r.id = p_relationship_id and r.status = 'active' and l.status = 'active'
    order by l.name;
end;
$$;

create function public.list_facility_shifts(p_facility_organisation_id uuid, p_shift_id uuid default null)
returns table (
  shift_id uuid,
  relationship_id uuid,
  agency_name text,
  location_name text,
  discipline_key text,
  discipline_name text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  requested_headcount integer,
  active_count integer,
  accepted_count integer,
  fill_state text,
  status public.shift_status,
  source public.shift_source,
  instructions text,
  external_reference text,
  cancellation_reason public.shift_cancellation_reason,
  relationship_status public.relationship_status
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_facility_organisation_id, 'shift.view');
  return query
    select s.id, r.id, o.name, l.name, s.discipline_key, d.name, s.start_at, s.end_at, s.timezone,
           s.requested_headcount, c.active, c.accepted,
           case when c.active = 0 then 'unfilled' when c.active < s.requested_headcount then 'partially_filled'
                else 'filled' end,
           s.status, s.source, s.instructions, s.external_reference, s.cancellation_reason, r.status
    from public.agency_facilities f
    join public.agency_facility_relationships r
      on r.agency_facility_id = f.id and r.agency_organisation_id = f.agency_organisation_id
    join public.shifts s on s.relationship_id = r.id
    join public.organisations o on o.id = r.agency_organisation_id
    join public.facility_locations l on l.id = s.facility_location_id
    join public.disciplines d on d.key = s.discipline_key
    cross join lateral (
      select count(*) filter (where a.status in ('assigned', 'accepted'))::integer as active,
             count(*) filter (where a.status = 'accepted')::integer as accepted
      from public.shift_assignments a where a.shift_id = s.id
    ) c
    where f.linked_facility_organisation_id = p_facility_organisation_id
      and r.status <> 'ended'
      and authz.has_relationship_capability(r.id, 'shift.view')
      and s.status <> 'draft'
      and (p_shift_id is null or s.id = p_shift_id)
    order by s.start_at desc, s.id
    limit 500;
end;
$$;

create function public.list_facility_shift_assignments(p_shift_id uuid)
returns table (
  assignment_id uuid,
  worker_display_name text,
  discipline_name text,
  status public.assignment_status,
  readiness public.readiness_status
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  s public.shifts;
  v_facility_org uuid;
begin
  perform internal.require_identity();
  select * into s from public.shifts x where x.id = p_shift_id;
  if s.id is null or s.status = 'draft' or not authz.has_relationship_capability(s.relationship_id, 'shift.view') then
    raise exception 'shift not found' using errcode = 'CHS04';
  end if;
  select f.linked_facility_organisation_id into v_facility_org
  from public.agency_facilities f where f.id = s.agency_facility_id;

  perform internal.record_audit_event('shift.assignments_viewed_by_facility', v_facility_org, 'shift', s.id,
    '{}'::jsonb);

  return query
    select a.id, p.display_name, d.name, a.status, e.readiness
    from public.shift_assignments a
    join public.agency_workers w on w.id = a.agency_worker_id
    join public.profiles p on p.id = w.profile_id
    join public.disciplines d on d.key = s.discipline_key
    cross join lateral internal.assignment_eligibility(s.id, a.agency_worker_id, a.id) e
    where a.shift_id = s.id and a.status in ('assigned', 'accepted')
    order by p.display_name collate "C", a.id;
end;
$$;

create function public.list_my_shift_assignments(p_organisation_id uuid)
returns table (
  assignment_id uuid,
  shift_id uuid,
  facility_name text,
  location_name text,
  discipline_name text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  status public.assignment_status,
  shift_status public.shift_status,
  instructions text,
  cancellation_reason public.assignment_cancellation_reason,
  assigned_at timestamptz,
  accepted_at timestamptz,
  can_respond boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  return query
    select a.id, s.id, f.name, l.name, d.name, s.start_at, s.end_at, s.timezone, a.status, s.status,
           case when a.status in ('assigned', 'accepted') and s.status = 'open' then s.instructions end,
           a.cancellation_reason, a.assigned_at, a.accepted_at,
           a.status = 'assigned' and s.status = 'open' and s.end_at > now()
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
    join public.agency_facilities f on f.id = s.agency_facility_id
    join public.facility_locations l on l.id = s.facility_location_id
    join public.disciplines d on d.key = s.discipline_key
    where a.agency_organisation_id = p_organisation_id
      and authz.is_own_active_worker(a.agency_worker_id)
    order by s.start_at desc, a.id
    limit 500;
end;
$$;

revoke all on function
  public.list_facility_request_options(uuid),
  public.list_facility_shifts(uuid, uuid),
  public.list_facility_shift_assignments(uuid),
  public.list_my_shift_assignments(uuid)
from public, anon;

grant execute on function
  public.list_facility_request_options(uuid),
  public.list_facility_shifts(uuid, uuid),
  public.list_facility_shift_assignments(uuid),
  public.list_my_shift_assignments(uuid)
to authenticated;
