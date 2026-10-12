-- =============================================================================
-- Migration: facility_coverage
-- Stage:     P0-E9-3K (facility workspace audit & completion)
--
-- Purpose
--   One facility-side projection of the workers serving a facility over a
--   bounded window of shift dates: the Coverage and Attendance pages and the
--   Overview "today" counts. It adds no new visibility. It returns exactly
--   what the existing per-shift facility projections already expose, for
--   many shifts in one audited read instead of one read per shift:
--   - list_facility_shift_assignments (shift.view): worker display name,
--     role, assignment status, readiness for that shift;
--   - list_facility_shift_attendance (attendance.view): clock state, clock
--     times, open-exception flag. NEVER coordinates or geofence evidence.
--   Scoping (database-enforced, per row): the caller's facility organisation
--   is the shift's linked facility, the relationship is not ended, and the
--   caller holds the capability on that relationship
--   (authz.has_relationship_capability). Attendance columns are NULL unless
--   attendance.view is held on that relationship. Draft shifts are never
--   shown. No pay, bill, pricing, contact or address fields.
--   Window: shift local dates, at most 31 days.
--   Audit: coverage.viewed_by_facility, at most once per 15 minutes per org.
-- =============================================================================

create function public.list_facility_coverage(
  p_facility_organisation_id uuid,
  p_from date,
  p_to date
)
returns table (
  assignment_id uuid,
  shift_id uuid,
  agency_name text,
  location_name text,
  discipline_name text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  shift_status public.shift_status,
  worker_display_name text,
  assignment_status public.assignment_status,
  readiness public.readiness_status,
  attendance_visible boolean,
  clock_state public.attendance_clock_state,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  has_open_exception boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_facility_organisation_id, 'shift.view');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 31 then
    raise exception 'invalid window' using errcode = 'CH400';
  end if;
  if not exists (select 1 from public.organisations o
                 where o.id = p_facility_organisation_id and o.type = 'facility') then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;

  perform internal.record_audit_event_once('coverage.viewed_by_facility', p_facility_organisation_id,
    'organisation', p_facility_organisation_id, interval '15 minutes');

  return query
    select a.id, s.id, o.name, l.name, d.name, s.start_at, s.end_at, s.timezone, s.status,
           p.display_name, a.status,
           -- Readiness only matters for work still ahead (as on the request page).
           case when s.end_at > now() and a.status in ('assigned', 'accepted') and s.status = 'open'
                then (select e.readiness from internal.assignment_eligibility(s.id, a.agency_worker_id, a.id) e)
           end,
           v.attendance,
           case when v.attendance then coalesce(t.clock_state, 'not_started'::public.attendance_clock_state) end,
           case when v.attendance then t.clock_in_at end,
           case when v.attendance then t.clock_out_at end,
           case when v.attendance then coalesce(t.open_exception_count, 0) > 0 end
    from public.agency_facilities f
    join public.agency_facility_relationships r
      on r.agency_facility_id = f.id and r.agency_organisation_id = f.agency_organisation_id
    join public.shifts s on s.relationship_id = r.id
    join public.organisations o on o.id = r.agency_organisation_id
    join public.facility_locations l on l.id = s.facility_location_id
    join public.disciplines d on d.key = s.discipline_key
    join public.shift_assignments a on a.shift_id = s.id
    join public.agency_workers w on w.id = a.agency_worker_id
    join public.profiles p on p.id = w.profile_id
    left join public.assignment_attendance t on t.assignment_id = a.id
    cross join lateral (select authz.has_relationship_capability(r.id, 'attendance.view') as attendance) v
    where f.linked_facility_organisation_id = p_facility_organisation_id
      and r.status <> 'ended'
      and authz.has_relationship_capability(r.id, 'shift.view')
      and s.status <> 'draft'
      and (s.start_at at time zone s.timezone)::date between p_from and p_to
      and (a.status in ('assigned', 'accepted') or t.id is not null)
    order by s.start_at, s.id, p.display_name collate "C", a.id;
end;
$$;

comment on function public.list_facility_coverage(uuid, date, date) is
  'P0-E9-3K: workers serving a facility over <= 31 shift dates. Same fields as the per-shift facility projections; attendance only with attendance.view; audited.';

revoke all on function public.list_facility_coverage(uuid, date, date) from public, anon;
grant execute on function public.list_facility_coverage(uuid, date, date) to authenticated;
