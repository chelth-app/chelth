-- =============================================================================
-- Migration: attendance_rpcs
-- Stage:     P0-E6-S1
--
-- Purpose
--   Server-authoritative attendance commands and projections.
--
--   * Time: every device clock event uses the DATABASE clock (now()); the
--     client never supplies an event time. A client "captured at" value is
--     stored only as location evidence.
--   * Geofence: optional per facility location; distance computed here
--     (haversine, mean Earth radius 6 371 008.8 m) from the worker's
--     coordinates and the configured facility coordinates. The client never
--     declares inside/outside. Coordinates are accepted and stored ONLY when
--     the location's geofence is enabled, only at a clock action.
--   * Clock-in refusals that are operational facts (worker no longer
--     eligible; outside a BLOCKING geofence) RETURN a refusal and commit an
--     exception + agency notification. Other refusals raise.
--   * Clock-out is never blocked by location (a worker must always be able
--     to leave); location problems become exceptions.
--   * Corrections append corrected_* events; nothing is rewritten.
--
--   Structured errors: CHT04 ATTENDANCE_NOT_FOUND · CHT05 ASSIGNMENT_NOT_ACCEPTED ·
--   CHT06 SHIFT_CANCELLED · CHT07 TOO_EARLY_TO_CLOCK_IN · CHT08 TOO_LATE_TO_CLOCK_IN ·
--   CHT09 ALREADY_CLOCKED_IN · CHT10 NOT_CLOCKED_IN · CHT11 ALREADY_CLOCKED_OUT ·
--   CHT12 GEOFENCE_REQUIRED · CHT13 LOCATION_UNAVAILABLE · CHT14 LOCATION_ACCURACY_TOO_LOW ·
--   CHT15 OUTSIDE_GEOFENCE · CHT16 CORRECTION_NOT_ALLOWED · CHT17 CORRECTION_ALREADY_REVIEWED ·
--   CHT18 CLOCK_OUT_WINDOW_CLOSED
--
-- Verified by: supabase/tests/security/170_attendance.test.sql,
--              180_attendance_review.test.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rules, geometry and projection helpers
-- -----------------------------------------------------------------------------
create function internal.attendance_rules(p_organisation_id uuid)
returns public.agency_attendance_settings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.agency_attendance_settings;
begin
  select * into r from public.agency_attendance_settings s where s.agency_organisation_id = p_organisation_id;
  if r.agency_organisation_id is null then
    -- Documented defaults (ATTENDANCE_DOMAIN_MODEL.md §4).
    r.agency_organisation_id := p_organisation_id;
    r.agency_organisation_type := 'agency';
    r.early_clock_in_minutes := 30;
    r.late_clock_in_minutes := 5;
    r.early_clock_out_minutes := 15;
    r.late_clock_out_minutes := 30;
    r.missed_clock_in_minutes := 15;
    r.missed_clock_out_minutes := 60;
    r.clock_out_cutoff_minutes := 240;
  end if;
  return r;
end;
$$;

-- Great-circle distance in metres (haversine, mean Earth radius).
create function internal.distance_meters(
  p_lat1 double precision, p_lon1 double precision, p_lat2 double precision, p_lon2 double precision
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lon2 - p_lon1) / 2), 2))))
$$;

create type internal.geofence_check as (
  required boolean,
  result public.geofence_result,
  distance_meters double precision,
  radius_meters integer,
  outside_policy public.geofence_outside_policy
);

create function internal.check_geofence(
  p_facility_location_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision
)
returns internal.geofence_check
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.location_geofences;
  c internal.geofence_check;
begin
  select * into g from public.location_geofences x where x.facility_location_id = p_facility_location_id and x.enabled;
  if g.facility_location_id is null then
    c.required := false;
    c.result := 'not_required';
    return c;
  end if;
  c.required := true;
  c.radius_meters := g.radius_meters;
  c.outside_policy := g.outside_policy;
  if (p_latitude is null) <> (p_longitude is null)
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
     or p_accuracy_meters < 0 or p_accuracy_meters > 100000 then
    raise exception 'invalid location' using errcode = 'CH400';
  end if;
  if p_latitude is null then
    c.result := 'unavailable';
    return c;
  end if;
  c.distance_meters := internal.distance_meters(p_latitude, p_longitude, g.latitude, g.longitude);
  if p_accuracy_meters is null or p_accuracy_meters > g.max_accuracy_meters then
    c.result := 'low_accuracy';
  elsif c.distance_meters <= g.radius_meters then
    c.result := 'inside';
  else
    c.result := 'outside';
  end if;
  return c;
end;
$$;

-- Recompute the summary from events (the ONLY writer of the projection).
create function internal.refresh_attendance(p_attendance_id uuid)
returns public.assignment_attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in timestamptz;
  v_out timestamptz;
  r public.assignment_attendance;
begin
  select coalesce(
           (select e.occurred_at from public.attendance_events e
            where e.attendance_id = p_attendance_id and e.segment = 1 and e.event_type = 'corrected_clock_in'
            order by e.sequence desc limit 1),
           (select e.occurred_at from public.attendance_events e
            where e.attendance_id = p_attendance_id and e.segment = 1 and e.event_type = 'clock_in')),
         coalesce(
           (select e.occurred_at from public.attendance_events e
            where e.attendance_id = p_attendance_id and e.segment = 1 and e.event_type = 'corrected_clock_out'
            order by e.sequence desc limit 1),
           (select e.occurred_at from public.attendance_events e
            where e.attendance_id = p_attendance_id and e.segment = 1 and e.event_type = 'clock_out'))
    into v_in, v_out;
  update public.assignment_attendance x
     set clock_in_at = v_in,
         clock_out_at = case when v_in is null then null else v_out end,
         clock_state = case when v_in is null then 'not_started'::public.attendance_clock_state
                            when v_out is null then 'clocked_in'::public.attendance_clock_state
                            else 'clocked_out'::public.attendance_clock_state end,
         open_exception_count = (select count(*) from public.attendance_exceptions ex
                                 where ex.attendance_id = p_attendance_id and ex.status in ('open', 'under_review'))
   where x.id = p_attendance_id
  returning x.* into r;
  return r;
end;
$$;

create function internal.ensure_attendance(p_assignment_id uuid)
returns public.assignment_attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.assignment_attendance;
begin
  insert into public.assignment_attendance
    (assignment_id, agency_organisation_id, shift_id, agency_worker_id, profile_id, agency_facility_id, facility_location_id)
  select a.id, a.agency_organisation_id, a.shift_id, a.agency_worker_id, a.profile_id, s.agency_facility_id,
         s.facility_location_id
  from public.shift_assignments a join public.shifts s on s.id = a.shift_id
  where a.id = p_assignment_id
  on conflict (assignment_id) do nothing;
  select * into r from public.assignment_attendance x where x.assignment_id = p_assignment_id for update;
  return r;
end;
$$;

-- Opens an exception once (one open per attendance + type). Returns true if opened.
create function internal.open_attendance_exception(
  p_attendance public.assignment_attendance,
  p_type public.attendance_exception_type,
  p_severity public.assignment_issue_severity,
  p_source public.attendance_exception_source
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.attendance_exceptions as x
    (attendance_id, assignment_id, agency_organisation_id, exception_type, severity, detected_by)
  values (p_attendance.id, p_attendance.assignment_id, p_attendance.agency_organisation_id, p_type, p_severity, p_source)
  on conflict do nothing
  returning x.id into v_id;
  if v_id is null then
    return false;
  end if;
  perform internal.record_audit_event('attendance.exception_opened', p_attendance.agency_organisation_id,
    'attendance_exception', v_id,
    jsonb_build_object('attendance_id', p_attendance.id, 'exception_type', p_type, 'detected_by', p_source));
  return true;
end;
$$;

create function internal.resolve_attendance_exceptions(
  p_attendance_id uuid,
  p_types public.attendance_exception_type[],
  p_resolution public.attendance_exception_resolution,
  p_reviewer_membership_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    update public.attendance_exceptions x
       set status = 'resolved', resolved_at = now(), resolution = p_resolution,
           reviewer_membership_id = p_reviewer_membership_id
     where x.attendance_id = p_attendance_id and x.exception_type = any (p_types)
       and x.status in ('open', 'under_review')
    returning x.id, x.agency_organisation_id, x.exception_type
  loop
    v_count := v_count + 1;
    perform internal.record_audit_event('attendance.exception_resolved', v_row.agency_organisation_id,
      'attendance_exception', v_row.id,
      jsonb_build_object('attendance_id', p_attendance_id, 'exception_type', v_row.exception_type,
                         'resolution', p_resolution));
  end loop;
  return v_count;
end;
$$;

-- The caller's own assignment (live membership), locked; relationship share-locked first.
create function internal.own_assignment_for_attendance(p_assignment_id uuid)
returns public.shift_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.shift_assignments;
begin
  perform internal.require_identity();
  select * into a from public.shift_assignments x where x.id = p_assignment_id;
  if a.id is null or not authz.is_own_active_worker(a.agency_worker_id) then
    raise exception 'assignment not found' using errcode = 'CHA04';
  end if;
  -- Stage lock order: relationship (share) → assignment.
  perform 1 from public.agency_facility_relationships r
  join public.shifts s on s.relationship_id = r.id
  where s.id = a.shift_id
  for share of r;
  select * into a from public.shift_assignments x where x.id = p_assignment_id for update;
  return a;
end;
$$;

-- -----------------------------------------------------------------------------
-- Clock in
-- -----------------------------------------------------------------------------
create function public.clock_in_assignment(
  p_assignment_id uuid,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_meters double precision default null,
  p_device_captured_at timestamptz default null
)
returns table (
  outcome text,
  attendance_id uuid,
  recorded_at timestamptz,
  timezone text,
  geofence_result public.geofence_result,
  exception_codes text[],
  refusal_code text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  a public.shift_assignments := internal.own_assignment_for_attendance(p_assignment_id);
  s public.shifts;
  rules public.agency_attendance_settings;
  att public.assignment_attendance;
  g internal.geofence_check;
  e record;
  v_now timestamptz := now();
  v_event_id uuid;
  v_codes text[] := '{}'::text[];
  v_refusal text;
begin
  select * into s from public.shifts x where x.id = a.shift_id;
  -- Shift state first: cancelling a shift also cancels its assignments.
  if s.status = 'cancelled' then
    raise exception 'shift is cancelled' using errcode = 'CHT06';
  elsif s.status <> 'open' then
    raise exception 'shift is not open' using errcode = 'CHS09';
  end if;
  if a.status <> 'accepted' then
    raise exception 'assignment is not accepted' using errcode = 'CHT05';
  end if;
  perform internal.require_active_relationship(s.relationship_id);

  rules := internal.attendance_rules(a.agency_organisation_id);
  if v_now < s.start_at - make_interval(mins => rules.early_clock_in_minutes) then
    raise exception 'too early to clock in' using errcode = 'CHT07';
  end if;
  if v_now >= s.end_at then
    raise exception 'the shift has ended' using errcode = 'CHT08';
  end if;

  att := internal.ensure_attendance(a.id);
  if att.clock_state = 'clocked_out' then
    raise exception 'already clocked out' using errcode = 'CHT11';
  elsif att.clock_state = 'clocked_in' then
    raise exception 'already clocked in' using errcode = 'CHT09';
  end if;

  -- Location: evaluated server-side, only if this location requires it.
  g := internal.check_geofence(s.facility_location_id, p_latitude, p_longitude, p_accuracy_meters);
  if g.required and g.outside_policy = 'block' then
    if g.result = 'unavailable' then
      raise exception 'location is required at this site' using errcode = 'CHT12';
    elsif g.result = 'low_accuracy' then
      raise exception 'location accuracy too low' using errcode = 'CHT14';
    end if;
  end if;

  -- Eligibility (canonical gate): a worker who is no longer eligible cannot start work.
  select * into e from internal.assignment_eligibility(s.id, a.agency_worker_id, a.id);
  if cardinality(e.block_reasons) > 0 then
    v_refusal := case when 'WORKER_NOT_ACTIVE' = any (e.block_reasons) then 'WORKER_NOT_ACTIVE'
                      else 'WORKER_NOT_ELIGIBLE' end;
    if internal.open_attendance_exception(att, 'assignment_not_ready', 'urgent', 'clock_action') then
      perform internal.enqueue_notification('attendance_clock_in_blocked', a.agency_organisation_id, null,
        a.agency_organisation_id, 'shift_assignment', a.id, '{}'::jsonb, s.end_at);
    end if;
  elsif g.required and g.outside_policy = 'block' and g.result = 'outside' then
    v_refusal := 'OUTSIDE_GEOFENCE';
    if internal.open_attendance_exception(att, 'outside_geofence', 'urgent', 'clock_action') then
      perform internal.enqueue_notification('attendance_clock_in_blocked', a.agency_organisation_id, null,
        a.agency_organisation_id, 'shift_assignment', a.id, '{}'::jsonb, s.end_at);
    end if;
  end if;
  if v_refusal is not null then
    att := internal.refresh_attendance(att.id);
    perform internal.record_audit_event('attendance.clock_in_refused', a.agency_organisation_id, 'attendance',
      att.id, jsonb_build_object('assignment_id', a.id, 'refusal', v_refusal, 'geofence_result', g.result));
    return query select 'refused'::text, att.id, null::timestamptz, s.timezone, g.result,
                        array[case v_refusal when 'OUTSIDE_GEOFENCE' then 'outside_geofence'
                                             else 'assignment_not_ready' end], v_refusal;
    return;
  end if;

  insert into public.attendance_events as ev
    (attendance_id, assignment_id, agency_organisation_id, event_type, occurred_at, recorded_at, source,
     geofence_result, actor_profile_id)
  values (att.id, a.id, a.agency_organisation_id, 'clock_in', v_now, v_now, 'worker_device', g.result, v_profile_id)
  returning ev.id into v_event_id;

  if g.required then
    insert into public.attendance_location_evidence
      (event_id, attendance_id, agency_organisation_id, latitude, longitude, accuracy_meters, device_captured_at,
       distance_meters, radius_meters, result)
    values (v_event_id, att.id, a.agency_organisation_id, p_latitude, p_longitude, p_accuracy_meters,
            p_device_captured_at, g.distance_meters, g.radius_meters, g.result);
    perform internal.record_audit_event('attendance.location_checked', a.agency_organisation_id, 'attendance',
      att.id, jsonb_build_object('event', 'clock_in', 'result', g.result));
    if g.result = 'outside' and internal.open_attendance_exception(att, 'outside_geofence', 'attention', 'clock_action') then
      v_codes := v_codes || 'outside_geofence'::text;
    elsif g.result = 'low_accuracy'
          and internal.open_attendance_exception(att, 'poor_location_accuracy', 'attention', 'clock_action') then
      v_codes := v_codes || 'poor_location_accuracy'::text;
    elsif g.result = 'unavailable'
          and internal.open_attendance_exception(att, 'location_unavailable', 'attention', 'clock_action') then
      v_codes := v_codes || 'location_unavailable'::text;
    end if;
  end if;

  if v_now > s.start_at + make_interval(mins => rules.late_clock_in_minutes)
     and internal.open_attendance_exception(att, 'late_clock_in', 'attention', 'clock_action') then
    v_codes := v_codes || 'late_clock_in'::text;
    perform internal.enqueue_notification('attendance_clock_in_late', a.agency_organisation_id, null,
      a.agency_organisation_id, 'shift_assignment', a.id, '{}'::jsonb, s.end_at);
  end if;
  perform internal.resolve_attendance_exceptions(att.id, array['missed_clock_in']::public.attendance_exception_type[],
    'clocked_in');
  att := internal.refresh_attendance(att.id);

  perform internal.record_audit_event('attendance.clocked_in', a.agency_organisation_id, 'attendance', att.id,
    jsonb_build_object('assignment_id', a.id, 'event_id', v_event_id, 'geofence_result', g.result,
                       'exceptions', to_jsonb(v_codes)));
  return query select 'recorded'::text, att.id, v_now, s.timezone, g.result, v_codes, null::text;
end;
$$;

-- -----------------------------------------------------------------------------
-- Clock out (never blocked by location)
-- -----------------------------------------------------------------------------
create function public.clock_out_assignment(
  p_assignment_id uuid,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_meters double precision default null,
  p_device_captured_at timestamptz default null
)
returns table (
  outcome text,
  attendance_id uuid,
  recorded_at timestamptz,
  timezone text,
  geofence_result public.geofence_result,
  exception_codes text[]
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  a public.shift_assignments := internal.own_assignment_for_attendance(p_assignment_id);
  s public.shifts;
  rules public.agency_attendance_settings;
  att public.assignment_attendance;
  g internal.geofence_check;
  v_now timestamptz := now();
  v_event_id uuid;
  v_codes text[] := '{}'::text[];
begin
  select * into s from public.shifts x where x.id = a.shift_id;
  select * into att from public.assignment_attendance x where x.assignment_id = a.id for update;
  if att.id is null or att.clock_state = 'not_started' then
    raise exception 'not clocked in' using errcode = 'CHT10';
  elsif att.clock_state = 'clocked_out' then
    raise exception 'already clocked out' using errcode = 'CHT11';
  end if;
  rules := internal.attendance_rules(a.agency_organisation_id);
  if v_now > s.end_at + make_interval(mins => rules.clock_out_cutoff_minutes) then
    raise exception 'the clock-out window has closed; request a correction' using errcode = 'CHT18';
  end if;

  g := internal.check_geofence(s.facility_location_id, p_latitude, p_longitude, p_accuracy_meters);

  insert into public.attendance_events as ev
    (attendance_id, assignment_id, agency_organisation_id, event_type, occurred_at, recorded_at, source,
     geofence_result, actor_profile_id)
  values (att.id, a.id, a.agency_organisation_id, 'clock_out', v_now, v_now, 'worker_device', g.result, v_profile_id)
  returning ev.id into v_event_id;

  if g.required then
    insert into public.attendance_location_evidence
      (event_id, attendance_id, agency_organisation_id, latitude, longitude, accuracy_meters, device_captured_at,
       distance_meters, radius_meters, result)
    values (v_event_id, att.id, a.agency_organisation_id, p_latitude, p_longitude, p_accuracy_meters,
            p_device_captured_at, g.distance_meters, g.radius_meters, g.result);
    perform internal.record_audit_event('attendance.location_checked', a.agency_organisation_id, 'attendance',
      att.id, jsonb_build_object('event', 'clock_out', 'result', g.result));
    if g.result = 'outside' and internal.open_attendance_exception(att, 'outside_geofence', 'attention', 'clock_action') then
      v_codes := v_codes || 'outside_geofence'::text;
    elsif g.result = 'low_accuracy'
          and internal.open_attendance_exception(att, 'poor_location_accuracy', 'attention', 'clock_action') then
      v_codes := v_codes || 'poor_location_accuracy'::text;
    elsif g.result = 'unavailable'
          and internal.open_attendance_exception(att, 'location_unavailable', 'attention', 'clock_action') then
      v_codes := v_codes || 'location_unavailable'::text;
    end if;
  end if;

  if v_now < s.end_at - make_interval(mins => rules.early_clock_out_minutes)
     and internal.open_attendance_exception(att, 'early_clock_out', 'attention', 'clock_action') then
    v_codes := v_codes || 'early_clock_out'::text;
  elsif v_now > s.end_at + make_interval(mins => rules.late_clock_out_minutes)
        and internal.open_attendance_exception(att, 'late_clock_out', 'attention', 'clock_action') then
    v_codes := v_codes || 'late_clock_out'::text;
  end if;
  perform internal.resolve_attendance_exceptions(att.id, array['missed_clock_out']::public.attendance_exception_type[],
    'clocked_out');
  att := internal.refresh_attendance(att.id);

  perform internal.record_audit_event('attendance.clocked_out', a.agency_organisation_id, 'attendance', att.id,
    jsonb_build_object('assignment_id', a.id, 'event_id', v_event_id, 'geofence_result', g.result,
                       'exceptions', to_jsonb(v_codes)));
  return query select 'recorded'::text, att.id, v_now, s.timezone, g.result, v_codes;
end;
$$;

-- -----------------------------------------------------------------------------
-- Corrections: request → review → corrected_* event appended
-- -----------------------------------------------------------------------------
create function public.request_attendance_correction(
  p_assignment_id uuid,
  p_event_type public.attendance_event_type,
  p_requested_time timestamptz,
  p_reason public.attendance_correction_reason,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  a public.shift_assignments := internal.own_assignment_for_attendance(p_assignment_id);
  s public.shifts;
  att public.assignment_attendance;
  v_id uuid;
begin
  select * into s from public.shifts x where x.id = a.shift_id;
  if a.status <> 'accepted' then
    raise exception 'assignment is not accepted' using errcode = 'CHT05';
  end if;
  if p_event_type not in ('clock_in', 'clock_out') or p_reason is null or p_requested_time is null then
    raise exception 'invalid correction' using errcode = 'CH400';
  end if;
  if p_requested_time > now()
     or p_requested_time < s.start_at - interval '12 hours'
     or p_requested_time > s.end_at + interval '12 hours' then
    raise exception 'the requested time is outside the shift window' using errcode = 'CHT16';
  end if;
  if not internal.consume_rate_limit('attendance.correction:' || v_profile_id, 20, interval '1 day') then
    raise exception 'too many correction requests' using errcode = 'CH429';
  end if;

  att := internal.ensure_attendance(a.id);
  if p_event_type = 'clock_out' and att.clock_in_at is null and not exists (
    select 1 from public.attendance_corrections c
    where c.attendance_id = att.id and c.requested_event_type = 'clock_in' and c.status = 'pending'
  ) then
    raise exception 'request the clock-in time first' using errcode = 'CHT16';
  end if;
  if (p_event_type = 'clock_out' and att.clock_in_at is not null and p_requested_time <= att.clock_in_at)
     or (p_event_type = 'clock_in' and att.clock_out_at is not null and p_requested_time >= att.clock_out_at) then
    raise exception 'clock-out must be after clock-in' using errcode = 'CHT16';
  end if;
  if exists (select 1 from public.attendance_corrections c
             where c.attendance_id = att.id and c.requested_event_type = p_event_type and c.status = 'pending') then
    raise exception 'a request for this time is already pending' using errcode = 'CHT16';
  end if;

  insert into public.attendance_corrections as c
    (attendance_id, assignment_id, agency_organisation_id, requested_by_profile_id, requested_event_type,
     requested_time, reason, worker_note)
  values (att.id, a.id, a.agency_organisation_id, v_profile_id, p_event_type, p_requested_time, p_reason,
          nullif(btrim(p_note), ''))
  returning c.id into v_id;

  perform internal.open_attendance_exception(att, 'manual_correction_requested', 'attention', 'correction');
  perform internal.refresh_attendance(att.id);
  -- No note text and no timestamps in audit metadata.
  perform internal.record_audit_event('attendance.correction_requested', a.agency_organisation_id,
    'attendance_correction', v_id,
    jsonb_build_object('attendance_id', att.id, 'event_type', p_event_type, 'reason', p_reason));
  perform internal.enqueue_notification('attendance_correction_requested', a.agency_organisation_id, null,
    a.agency_organisation_id, 'shift_assignment', a.id);
  return v_id;
end;
$$;

create function public.review_attendance_correction(
  p_correction_id uuid,
  p_approve boolean,
  p_resolution public.attendance_correction_resolution
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  c public.attendance_corrections;
  att public.assignment_attendance;
  v_membership uuid;
begin
  select * into c from public.attendance_corrections x where x.id = p_correction_id;
  if c.id is null or not authz.has_capability(c.agency_organisation_id, 'attendance.view') then
    raise exception 'correction not found' using errcode = 'CHT04';
  end if;
  perform internal.require_capability(c.agency_organisation_id, 'attendance.review');
  select * into att from public.assignment_attendance x where x.id = c.attendance_id for update;
  if c.requested_by_profile_id = v_profile_id or att.profile_id = v_profile_id then
    raise exception 'you cannot review your own attendance' using errcode = 'CH403';
  end if;
  select * into c from public.attendance_corrections x where x.id = p_correction_id for update;
  if c.status <> 'pending' then
    raise exception 'correction already reviewed' using errcode = 'CHT17';
  end if;
  if p_approve is null or p_resolution is null
     or p_approve <> (p_resolution = 'approved_as_requested') then
    raise exception 'choose a matching resolution' using errcode = 'CH400';
  end if;
  v_membership := internal.active_membership_id(c.agency_organisation_id);
  att := internal.refresh_attendance(att.id);

  if p_approve then
    if (c.requested_event_type = 'clock_out' and (att.clock_in_at is null or c.requested_time <= att.clock_in_at))
       or (c.requested_event_type = 'clock_in' and att.clock_out_at is not null and c.requested_time >= att.clock_out_at) then
      raise exception 'the corrected times would be out of order' using errcode = 'CHT16';
    end if;
    update public.attendance_corrections x
       set status = 'approved', resolution = p_resolution, reviewed_by_membership_id = v_membership, reviewed_at = now()
     where x.id = c.id;
    insert into public.attendance_events
      (attendance_id, assignment_id, agency_organisation_id, event_type, occurred_at, source, actor_profile_id,
       correction_id)
    values (att.id, att.assignment_id, att.agency_organisation_id,
            case c.requested_event_type when 'clock_in' then 'corrected_clock_in'::public.attendance_event_type
                                        else 'corrected_clock_out'::public.attendance_event_type end,
            c.requested_time, 'approved_correction', v_profile_id, c.id);
    perform internal.resolve_attendance_exceptions(att.id,
      case c.requested_event_type
        when 'clock_in' then array['missed_clock_in', 'manual_correction_requested']::public.attendance_exception_type[]
        else array['missed_clock_out', 'manual_correction_requested']::public.attendance_exception_type[] end,
      'correction_approved', v_membership);
  else
    update public.attendance_corrections x
       set status = 'rejected', resolution = p_resolution, reviewed_by_membership_id = v_membership, reviewed_at = now()
     where x.id = c.id;
    if not exists (select 1 from public.attendance_corrections x where x.attendance_id = att.id and x.status = 'pending') then
      perform internal.resolve_attendance_exceptions(att.id,
        array['manual_correction_requested']::public.attendance_exception_type[], 'correction_rejected', v_membership);
    end if;
  end if;
  perform internal.refresh_attendance(att.id);

  perform internal.record_audit_event(
    case when p_approve then 'attendance.correction_approved' else 'attendance.correction_rejected' end,
    c.agency_organisation_id, 'attendance_correction', c.id,
    jsonb_build_object('attendance_id', att.id, 'event_type', c.requested_event_type, 'resolution', p_resolution));
  perform internal.enqueue_notification(
    case when p_approve then 'attendance_correction_approved'::internal.notification_event
         else 'attendance_correction_rejected'::internal.notification_event end,
    c.agency_organisation_id, att.profile_id, null, 'shift_assignment', att.assignment_id);
end;
$$;

-- Agency review of an exception (acknowledge / dismiss / mark under review).
create function public.review_attendance_exception(
  p_exception_id uuid,
  p_status public.attendance_exception_status,
  p_resolution public.attendance_exception_resolution default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  x public.attendance_exceptions;
  att public.assignment_attendance;
begin
  select * into x from public.attendance_exceptions e where e.id = p_exception_id;
  if x.id is null or not authz.has_capability(x.agency_organisation_id, 'attendance.view') then
    raise exception 'exception not found' using errcode = 'CHT04';
  end if;
  perform internal.require_capability(x.agency_organisation_id, 'attendance.review');
  select * into att from public.assignment_attendance a where a.id = x.attendance_id for update;
  if att.profile_id = v_profile_id then
    raise exception 'you cannot review your own attendance' using errcode = 'CH403';
  end if;
  if p_status = 'under_review' then
    update public.attendance_exceptions e set status = 'under_review' where e.id = x.id;
  elsif p_status in ('resolved', 'dismissed') and p_resolution in ('acknowledged', 'not_applicable') then
    update public.attendance_exceptions e
       set status = p_status, resolution = p_resolution, resolved_at = now(),
           reviewer_membership_id = internal.active_membership_id(x.agency_organisation_id)
     where e.id = x.id;
  else
    raise exception 'invalid exception review' using errcode = 'CH400';
  end if;
  perform internal.refresh_attendance(att.id);
  perform internal.record_audit_event('attendance.exception_reviewed', x.agency_organisation_id,
    'attendance_exception', x.id, jsonb_build_object('status', p_status, 'resolution', p_resolution));
end;
$$;

-- -----------------------------------------------------------------------------
-- Settings
-- -----------------------------------------------------------------------------
create function public.set_agency_attendance_settings(
  p_organisation_id uuid,
  p_early_clock_in_minutes integer,
  p_late_clock_in_minutes integer,
  p_early_clock_out_minutes integer,
  p_late_clock_out_minutes integer,
  p_missed_clock_in_minutes integer,
  p_missed_clock_out_minutes integer,
  p_clock_out_cutoff_minutes integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
begin
  perform internal.require_capability(p_organisation_id, 'attendance.manage_settings');
  insert into public.agency_attendance_settings as x (
    agency_organisation_id, early_clock_in_minutes, late_clock_in_minutes, early_clock_out_minutes,
    late_clock_out_minutes, missed_clock_in_minutes, missed_clock_out_minutes, clock_out_cutoff_minutes,
    updated_by_profile_id
  ) values (
    p_organisation_id, p_early_clock_in_minutes, p_late_clock_in_minutes, p_early_clock_out_minutes,
    p_late_clock_out_minutes, p_missed_clock_in_minutes, p_missed_clock_out_minutes, p_clock_out_cutoff_minutes,
    v_profile_id
  )
  on conflict (agency_organisation_id) do update set
    early_clock_in_minutes = excluded.early_clock_in_minutes,
    late_clock_in_minutes = excluded.late_clock_in_minutes,
    early_clock_out_minutes = excluded.early_clock_out_minutes,
    late_clock_out_minutes = excluded.late_clock_out_minutes,
    missed_clock_in_minutes = excluded.missed_clock_in_minutes,
    missed_clock_out_minutes = excluded.missed_clock_out_minutes,
    clock_out_cutoff_minutes = excluded.clock_out_cutoff_minutes,
    updated_by_profile_id = excluded.updated_by_profile_id;
  perform internal.record_audit_event('attendance.settings_updated', p_organisation_id, 'organisation',
    p_organisation_id, '{}'::jsonb);
end;
$$;

create function public.set_location_geofence(
  p_facility_location_id uuid,
  p_enabled boolean,
  p_latitude double precision,
  p_longitude double precision,
  p_radius_meters integer,
  p_max_accuracy_meters integer,
  p_outside_policy public.geofence_outside_policy
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  l public.facility_locations;
begin
  select * into l from public.facility_locations x where x.id = p_facility_location_id;
  perform internal.require_capability(l.agency_organisation_id, 'attendance.manage_settings');
  insert into public.location_geofences as g (
    facility_location_id, agency_facility_id, agency_organisation_id, enabled, latitude, longitude,
    radius_meters, max_accuracy_meters, outside_policy, updated_by_profile_id
  ) values (
    l.id, l.agency_facility_id, l.agency_organisation_id, coalesce(p_enabled, false), p_latitude, p_longitude,
    p_radius_meters, p_max_accuracy_meters, p_outside_policy, v_profile_id
  )
  on conflict (facility_location_id) do update set
    enabled = excluded.enabled,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    radius_meters = excluded.radius_meters,
    max_accuracy_meters = excluded.max_accuracy_meters,
    outside_policy = excluded.outside_policy,
    updated_by_profile_id = excluded.updated_by_profile_id;
  -- Facility coordinates are configuration, not personal data; still kept out of audit.
  perform internal.record_audit_event('attendance.geofence_updated', l.agency_organisation_id, 'facility_location',
    l.id, jsonb_build_object('enabled', coalesce(p_enabled, false), 'radius_meters', p_radius_meters,
                             'outside_policy', p_outside_policy));
end;
$$;

-- -----------------------------------------------------------------------------
-- Scheduled missed-clock detection (idempotent; never manufactures times)
-- -----------------------------------------------------------------------------
create function internal.run_attendance_scan()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run bigint;
  v_row record;
  att public.assignment_attendance;
  v_missed_in integer := 0;
  v_missed_out integer := 0;
  v_resolved integer := 0;
  v_result jsonb;
begin
  insert into internal.scheduled_job_runs (job) values ('attendance_scan') returning id into v_run;

  -- Accepted assignment, shift started + grace, no (effective) clock-in.
  for v_row in
    select a.id, a.agency_organisation_id, s.end_at
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
    cross join lateral internal.attendance_rules(a.agency_organisation_id) r
    left join public.assignment_attendance x on x.assignment_id = a.id
    where a.status = 'accepted' and s.status in ('open', 'completed')
      and s.start_at + make_interval(mins => r.missed_clock_in_minutes) <= now()
      and s.start_at > now() - interval '7 days'
      and (x.id is null or x.clock_in_at is null)
    limit 5000
  loop
    att := internal.ensure_attendance(v_row.id);
    if internal.open_attendance_exception(att, 'missed_clock_in', 'urgent', 'scheduled_scan') then
      v_missed_in := v_missed_in + 1;
      perform internal.enqueue_notification('attendance_missed_clock_in', v_row.agency_organisation_id, null,
        v_row.agency_organisation_id, 'shift_assignment', v_row.id, '{}'::jsonb, v_row.end_at + interval '1 day');
      perform internal.refresh_attendance(att.id);
    end if;
  end loop;

  -- Clocked in, shift ended + grace, no clock-out.
  for v_row in
    select x.id, x.assignment_id, x.agency_organisation_id, x.profile_id
    from public.assignment_attendance x
    join public.shifts s on s.id = x.shift_id
    cross join lateral internal.attendance_rules(x.agency_organisation_id) r
    where x.clock_state = 'clocked_in'
      and s.end_at + make_interval(mins => r.missed_clock_out_minutes) <= now()
      and s.end_at > now() - interval '7 days'
    limit 5000
  loop
    select * into att from public.assignment_attendance a where a.id = v_row.id for update;
    if internal.open_attendance_exception(att, 'missed_clock_out', 'urgent', 'scheduled_scan') then
      v_missed_out := v_missed_out + 1;
      perform internal.enqueue_notification('attendance_missed_clock_out', v_row.agency_organisation_id, null,
        v_row.agency_organisation_id, 'shift_assignment', v_row.assignment_id);
      perform internal.enqueue_notification('attendance_missed_clock_out', v_row.agency_organisation_id,
        v_row.profile_id, null, 'shift_assignment', v_row.assignment_id);
      perform internal.refresh_attendance(att.id);
    end if;
  end loop;

  -- Auto-resolution where the facts changed (idempotent).
  for v_row in
    select x.attendance_id, x.exception_type, a.status as assignment_status, s.status as shift_status,
           t.clock_in_at, t.clock_out_at
    from public.attendance_exceptions x
    join public.assignment_attendance t on t.id = x.attendance_id
    join public.shift_assignments a on a.id = x.assignment_id
    join public.shifts s on s.id = t.shift_id
    where x.status in ('open', 'under_review') and x.exception_type in ('missed_clock_in', 'missed_clock_out')
  loop
    if v_row.assignment_status <> 'accepted' or v_row.shift_status = 'cancelled' then
      v_resolved := v_resolved + internal.resolve_attendance_exceptions(v_row.attendance_id,
        array[v_row.exception_type], 'assignment_closed');
    elsif v_row.exception_type = 'missed_clock_in' and v_row.clock_in_at is not null then
      v_resolved := v_resolved + internal.resolve_attendance_exceptions(v_row.attendance_id,
        array['missed_clock_in']::public.attendance_exception_type[], 'clocked_in');
    elsif v_row.exception_type = 'missed_clock_out' and v_row.clock_out_at is not null then
      v_resolved := v_resolved + internal.resolve_attendance_exceptions(v_row.attendance_id,
        array['missed_clock_out']::public.attendance_exception_type[], 'clocked_out');
    else
      continue;
    end if;
    perform internal.refresh_attendance(v_row.attendance_id);
  end loop;

  v_result := jsonb_build_object('missed_clock_in', v_missed_in, 'missed_clock_out', v_missed_out,
                                 'resolved', v_resolved);
  update internal.scheduled_job_runs set finished_at = now(), result = v_result where id = v_run;
  return v_result;
end;
$$;

select cron.schedule('chelth-attendance-scan', '*/15 * * * *', 'select internal.run_attendance_scan()');

-- -----------------------------------------------------------------------------
-- Projections
-- -----------------------------------------------------------------------------
-- Agency: date-bounded (≤ 7 local days) or one shift; needs-attention first.
create function public.list_agency_attendance(
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
                else (s.start_at at time zone s.timezone)::date between v_from and v_to end)
    order by coalesce(t.open_exception_count, 0) > 0 desc, s.start_at, p.display_name collate "C", a.id
    limit 500;
end;
$$;

-- Worker: own accepted assignments around now (7 days back, 2 days ahead).
create function public.list_my_attendance(p_organisation_id uuid)
returns table (
  assignment_id uuid,
  attendance_id uuid,
  shift_id uuid,
  facility_name text,
  location_name text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  shift_status public.shift_status,
  clock_state public.attendance_clock_state,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  location_required boolean,
  earliest_clock_in_at timestamptz,
  can_clock_in boolean,
  can_clock_out boolean,
  exceptions jsonb,
  corrections jsonb
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
    select a.id, t.id, s.id, f.name, l.name, s.start_at, s.end_at, s.timezone, s.status,
           coalesce(t.clock_state, 'not_started'::public.attendance_clock_state),
           t.clock_in_at, t.clock_out_at,
           exists (select 1 from public.location_geofences g where g.facility_location_id = s.facility_location_id and g.enabled),
           s.start_at - make_interval(mins => r.early_clock_in_minutes),
           coalesce(t.clock_state, 'not_started') = 'not_started' and s.status = 'open'
             and now() >= s.start_at - make_interval(mins => r.early_clock_in_minutes) and now() < s.end_at,
           t.clock_state = 'clocked_in' and now() <= s.end_at + make_interval(mins => r.clock_out_cutoff_minutes),
           coalesce((select jsonb_agg(jsonb_build_object('type', x.exception_type, 'status', x.status,
                                                         'resolution', x.resolution) order by x.opened_at)
                     from public.attendance_exceptions x where x.attendance_id = t.id), '[]'::jsonb),
           coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'event_type', c.requested_event_type,
                                                         'requested_time', c.requested_time, 'reason', c.reason,
                                                         'status', c.status, 'resolution', c.resolution)
                                      order by c.requested_at)
                     from public.attendance_corrections c where c.attendance_id = t.id), '[]'::jsonb)
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
    join public.agency_facilities f on f.id = s.agency_facility_id
    join public.facility_locations l on l.id = s.facility_location_id
    cross join lateral internal.attendance_rules(a.agency_organisation_id) r
    left join public.assignment_attendance t on t.assignment_id = a.id
    where a.agency_organisation_id = p_organisation_id
      and authz.is_own_active_worker(a.agency_worker_id)
      and (a.status = 'accepted' or t.id is not null)
      and s.end_at > now() - interval '7 days'
      and s.start_at < now() + interval '2 days'
    order by s.start_at, a.id
    limit 100;
end;
$$;

-- Facility: relationship-scoped, narrow; location only as a result code. Audited.
create function public.list_facility_shift_attendance(p_shift_id uuid)
returns table (
  assignment_id uuid,
  worker_display_name text,
  clock_state public.attendance_clock_state,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  clock_in_location public.geofence_result,
  clock_out_location public.geofence_result,
  has_open_exception boolean
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
  if s.id is null or s.status = 'draft' or not authz.has_relationship_capability(s.relationship_id, 'attendance.view') then
    raise exception 'shift not found' using errcode = 'CHS04';
  end if;
  select f.linked_facility_organisation_id into v_facility_org from public.agency_facilities f where f.id = s.agency_facility_id;
  perform internal.record_audit_event('attendance.viewed_by_facility', v_facility_org, 'shift', s.id, '{}'::jsonb);
  return query
    select a.id, p.display_name, coalesce(t.clock_state, 'not_started'::public.attendance_clock_state),
           t.clock_in_at, t.clock_out_at,
           (select e.geofence_result from public.attendance_events e where e.attendance_id = t.id and e.event_type = 'clock_in'),
           (select e.geofence_result from public.attendance_events e where e.attendance_id = t.id and e.event_type = 'clock_out'),
           coalesce(t.open_exception_count, 0) > 0
    from public.shift_assignments a
    join public.agency_workers w on w.id = a.agency_worker_id
    join public.profiles p on p.id = w.profile_id
    left join public.assignment_attendance t on t.assignment_id = a.id
    where a.shift_id = s.id and (a.status = 'accepted' or t.id is not null)
    order by p.display_name collate "C", a.id;
end;
$$;

-- Raw coordinates: attendance.location.view (AAL2) only; every read audited.
create function public.list_attendance_location_evidence(p_attendance_id uuid)
returns table (
  event_type public.attendance_event_type,
  result public.geofence_result,
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  distance_meters double precision,
  radius_meters integer,
  device_captured_at timestamptz,
  recorded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  t public.assignment_attendance;
begin
  perform internal.require_identity();
  select * into t from public.assignment_attendance x where x.id = p_attendance_id;
  if t.id is null or not authz.has_capability(t.agency_organisation_id, 'attendance.view') then
    raise exception 'attendance not found' using errcode = 'CHT04';
  end if;
  perform internal.require_capability(t.agency_organisation_id, 'attendance.location.view');
  perform internal.record_audit_event('attendance.location_viewed', t.agency_organisation_id, 'attendance', t.id,
    '{}'::jsonb);
  return query
    select e.event_type, v.result, v.latitude, v.longitude, v.accuracy_meters, v.distance_meters, v.radius_meters,
           v.device_captured_at, v.recorded_at
    from public.attendance_location_evidence v
    join public.attendance_events e on e.id = v.event_id
    where v.attendance_id = t.id
    order by v.recorded_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- Notifications: attendance events go to attendance.review holders
-- -----------------------------------------------------------------------------
create or replace function internal.enqueue_notification(
  p_event internal.notification_event,
  p_organisation_id uuid,
  p_recipient_profile_id uuid,
  p_recipient_organisation_id uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_detail jsonb default '{}'::jsonb,
  p_deliver_until timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audience uuid := coalesce(p_recipient_organisation_id, p_organisation_id);
  v_capability text;
  v_count integer := 0;
  v_deliver_until timestamptz := coalesce(p_deliver_until, now() + interval '7 days');
begin
  if p_recipient_profile_id is not null then
    insert into internal.notification_outbox
      (event, organisation_id, recipient_profile_id, recipient_organisation_id, audience_organisation_id,
       subject_type, subject_id, detail, deliver_until)
    values (p_event, p_organisation_id, p_recipient_profile_id, null, v_audience,
            p_subject_type, p_subject_id, coalesce(p_detail, '{}'::jsonb), v_deliver_until)
    on conflict do nothing;
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  v_capability := case
    when v_audience <> p_organisation_id then 'shift.request'
    when p_event::text like 'attendance\_%' then 'attendance.review'
    else 'assignment.manage' end;
  insert into internal.notification_outbox
    (event, organisation_id, recipient_profile_id, recipient_organisation_id, audience_organisation_id,
     subject_type, subject_id, detail, deliver_until)
  select p_event, p_organisation_id, r, v_audience, v_audience, p_subject_type, p_subject_id,
         coalesce(p_detail, '{}'::jsonb), v_deliver_until
  from internal.notification_recipients(v_audience, v_capability) r
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Template audience now derives from the row shape (worker rows have no recipient organisation).
create or replace function internal.notification_template(p_notification_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n internal.notification_outbox;
  v_shift_id uuid;
  v_worker_id uuid;
  v_offer public.shift_offers;
  v_data jsonb;
  v_facility_org uuid;
  v_audience text;
  v_path text;
begin
  select * into n from internal.notification_outbox x where x.id = p_notification_id;
  if n.id is null then
    return null;
  end if;

  if n.subject_type = 'shift_assignment' then
    select a.shift_id, a.agency_worker_id into v_shift_id, v_worker_id
    from public.shift_assignments a where a.id = n.subject_id;
  elsif n.subject_type = 'shift' then
    v_shift_id := n.subject_id;
  elsif n.subject_type = 'shift_offer' then
    select * into v_offer from public.shift_offers o where o.id = n.subject_id;
    v_shift_id := v_offer.shift_id;
    v_worker_id := v_offer.agency_worker_id;
  end if;

  -- Person-directed rows (workers) carry no recipient organisation; operational
  -- fan-out rows carry the audience organisation.
  v_audience := case
    when n.recipient_organisation_id is null then 'worker'
    when n.audience_organisation_id <> n.organisation_id then 'facility'
    else 'agency' end;

  if n.subject_type = 'relationship' then
    select jsonb_build_object('facilityName', f.name, 'agencyName', o.name)
      into v_data
    from public.agency_facility_relationships r
    join public.agency_facilities f on f.id = r.agency_facility_id
    join public.organisations o on o.id = r.agency_organisation_id
    where r.id = n.subject_id and r.agency_organisation_id = n.organisation_id;
    v_path := '/app/organisations/' || n.organisation_id || '/operations';
  else
    select jsonb_build_object(
             'agencyName', o.name,
             'facilityName', f.name,
             'locationName', l.name,
             'disciplineName', d.name,
             'startAt', s.start_at,
             'endAt', s.end_at,
             'timezone', s.timezone,
             'shiftStatus', s.status,
             'cancellationReason', s.cancellation_reason),
           f.linked_facility_organisation_id
      into v_data, v_facility_org
    from public.shifts s
    join public.organisations o on o.id = s.agency_organisation_id
    join public.agency_facilities f on f.id = s.agency_facility_id
    join public.facility_locations l on l.id = s.facility_location_id
    join public.disciplines d on d.key = s.discipline_key
    where s.id = v_shift_id and s.agency_organisation_id = n.organisation_id;

    if v_data is null then
      return null;
    end if;
    -- Facility recipients must be the shift's linked facility (tenant check at delivery).
    if v_audience = 'facility' and v_facility_org is distinct from n.audience_organisation_id then
      return null;
    end if;

    v_path := case v_audience
      when 'worker' then '/app/organisations/' || n.organisation_id || '/my-shifts'
      when 'facility' then '/app/organisations/' || n.audience_organisation_id || '/staffing-requests/' || v_shift_id
      else '/app/organisations/' || n.organisation_id || '/shifts/' || v_shift_id end;

    -- Agency-facing assignment events name the worker (a colleague record in the same agency).
    if v_audience = 'agency' and v_worker_id is not null then
      v_data := v_data || jsonb_build_object('workerName', (
        select p.display_name from public.agency_workers w join public.profiles p on p.id = w.profile_id
        where w.id = v_worker_id and w.agency_organisation_id = n.organisation_id));
    end if;
    if n.subject_type = 'shift_offer' then
      v_data := v_data || jsonb_build_object('offerExpiresAt', v_offer.expires_at, 'offerStatus', v_offer.status);
    end if;
  end if;

  return coalesce(v_data, '{}'::jsonb) || n.detail || jsonb_build_object(
    'event', n.event,
    'audience', v_audience,
    'path', v_path,
    'recipientName', (select p.display_name from public.profiles p where p.id = n.recipient_profile_id));
end;
$$;
revoke all on function
  internal.attendance_rules(uuid),
  internal.distance_meters(double precision, double precision, double precision, double precision),
  internal.check_geofence(uuid, double precision, double precision, double precision),
  internal.refresh_attendance(uuid),
  internal.ensure_attendance(uuid),
  internal.open_attendance_exception(public.assignment_attendance, public.attendance_exception_type,
                                     public.assignment_issue_severity, public.attendance_exception_source),
  internal.resolve_attendance_exceptions(uuid, public.attendance_exception_type[],
                                         public.attendance_exception_resolution, uuid),
  internal.own_assignment_for_attendance(uuid),
  internal.run_attendance_scan(),
  internal.notification_template(uuid),
  internal.enqueue_notification(internal.notification_event, uuid, uuid, uuid, text, uuid, jsonb, timestamptz)
from public, anon, authenticated, service_role;

revoke all on function
  public.clock_in_assignment(uuid, double precision, double precision, double precision, timestamptz),
  public.clock_out_assignment(uuid, double precision, double precision, double precision, timestamptz),
  public.request_attendance_correction(uuid, public.attendance_event_type, timestamptz,
                                       public.attendance_correction_reason, text),
  public.review_attendance_correction(uuid, boolean, public.attendance_correction_resolution),
  public.review_attendance_exception(uuid, public.attendance_exception_status, public.attendance_exception_resolution),
  public.set_agency_attendance_settings(uuid, integer, integer, integer, integer, integer, integer, integer),
  public.set_location_geofence(uuid, boolean, double precision, double precision, integer, integer,
                               public.geofence_outside_policy),
  public.list_agency_attendance(uuid, date, date, uuid),
  public.list_my_attendance(uuid),
  public.list_facility_shift_attendance(uuid),
  public.list_attendance_location_evidence(uuid)
from public, anon;

grant execute on function
  public.clock_in_assignment(uuid, double precision, double precision, double precision, timestamptz),
  public.clock_out_assignment(uuid, double precision, double precision, double precision, timestamptz),
  public.request_attendance_correction(uuid, public.attendance_event_type, timestamptz,
                                       public.attendance_correction_reason, text),
  public.review_attendance_correction(uuid, boolean, public.attendance_correction_resolution),
  public.review_attendance_exception(uuid, public.attendance_exception_status, public.attendance_exception_resolution),
  public.set_agency_attendance_settings(uuid, integer, integer, integer, integer, integer, integer, integer),
  public.set_location_geofence(uuid, boolean, double precision, double precision, integer, integer,
                               public.geofence_outside_policy),
  public.list_agency_attendance(uuid, date, date, uuid),
  public.list_my_attendance(uuid),
  public.list_facility_shift_attendance(uuid),
  public.list_attendance_location_evidence(uuid)
to authenticated;
