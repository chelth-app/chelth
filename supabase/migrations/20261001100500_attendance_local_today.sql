-- =============================================================================
-- Migration: attendance_local_today
-- Stage:     P0-E7-S1 (fix of a P0-E6-S1 behaviour found during validation)
--
-- Purpose
--   list_agency_attendance without dates meant "shifts whose local date equals
--   the UTC date". In the US evening the UTC date is already tomorrow, so the
--   default view hid shifts that were in progress. The default is now "today
--   in each facility's own timezone" plus any shift in progress now (a night
--   shift that began before local midnight). Explicit dates and the shift filter are
--   unchanged. Same signature (redefinition only).
-- =============================================================================

create or replace function public.list_agency_attendance(
  p_organisation_id uuid,
  p_from date default null,
  p_to date default null,
  p_shift_id uuid default null
)
returns table (
  assignment_id uuid,
  attendance_id uuid,
  shift_id uuid,
  worker_name text,
  assignment_status public.assignment_status,
  facility_name text,
  location_name text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  clock_state public.attendance_clock_state,
  needs_review boolean,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  clock_in_location public.geofence_result,
  clock_out_location public.geofence_result,
  open_exception_types text[],
  pending_corrections integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  -- No dates and no shift: "today" in each facility's own timezone.
  v_local_today boolean := p_from is null and p_to is null and p_shift_id is null;
  v_from date := coalesce(p_from, current_date);
  v_to date := coalesce(p_to, coalesce(p_from, current_date));
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'attendance.view');
  if p_shift_id is null and (v_to < v_from or v_to - v_from > 7) then
    raise exception 'choose a range of at most 7 days' using errcode = 'CH400';
  end if;
  return query
    select a.id, t.id, s.id, p.display_name, a.status, f.name, l.name, s.start_at, s.end_at, s.timezone,
           coalesce(t.clock_state, 'not_started'::public.attendance_clock_state),
           coalesce(t.open_exception_count, 0) > 0,
           t.clock_in_at, t.clock_out_at,
           (select e.geofence_result from public.attendance_events e
            where e.attendance_id = t.id and e.event_type = 'clock_in'),
           (select e.geofence_result from public.attendance_events e
            where e.attendance_id = t.id and e.event_type = 'clock_out'),
           coalesce((select array_agg(x.exception_type::text order by x.opened_at) from public.attendance_exceptions x
                     where x.attendance_id = t.id and x.status in ('open', 'under_review')), '{}'),
           (select count(*) from public.attendance_corrections c
            where c.attendance_id = t.id and c.status = 'pending')::integer
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
    join public.agency_facilities f on f.id = s.agency_facility_id
    join public.facility_locations l on l.id = s.facility_location_id
    join public.agency_workers w on w.id = a.agency_worker_id
    join public.profiles p on p.id = w.profile_id
    left join public.assignment_attendance t on t.assignment_id = a.id
    where a.agency_organisation_id = p_organisation_id
      and (a.status = 'accepted' or t.id is not null)
      and (case when p_shift_id is not null then s.id = p_shift_id
                when v_local_today then (s.start_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date
                                        or (s.start_at <= now() and s.end_at > now())
                else (s.start_at at time zone s.timezone)::date between v_from and v_to end)
    order by coalesce(t.open_exception_count, 0) > 0 desc, s.start_at, p.display_name collate "C", a.id
    limit 500;
end;
$$;
