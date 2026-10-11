-- =============================================================================
-- Migration: geofence_fail_closed
-- Stage:     P0-E9-3E (production geofence remediation)
--
-- Purpose
--   Worker clock-in at a geofenced location fails CLOSED on unknown location
--   evidence (UNKNOWN ≠ INSIDE), server-side:
--   - no coordinates                         ⇒ CHT12 (refused, nothing recorded)
--   - a reading not captured within the last 5 minutes (or > 2 minutes in the
--     future) of the server clock           ⇒ CHT13
--   - accuracy worse than the configured maximum OR wider than the fence
--     radius itself                         ⇒ CHT14
--   These now apply under EVERY outside policy (previously only "block"; the
--   default "allow_with_review" recorded them as successful clock-ins).
--   A precise reading outside the fence is refused under "block" (now the
--   default) and recorded with an urgent review exception only where an
--   agency explicitly chose "allow_with_review".
--
--   Unchanged: a location without an enabled geofence does not check location
--   (documented product behaviour); clock-out is never blocked by location;
--   distance is the existing haversine in metres; inside ⇔ distance ≤ radius.
-- =============================================================================

alter table public.location_geofences alter column outside_policy set default 'block';

-- Inside only when the reading is precise enough to place the worker inside:
-- accuracy ≤ least(max_accuracy_meters, radius_meters) and distance ≤ radius.
create or replace function internal.check_geofence(
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
     or p_accuracy_meters < 0 or p_accuracy_meters > 100000
     or p_latitude = 'NaN'::double precision or p_longitude = 'NaN'::double precision
     or p_accuracy_meters = 'NaN'::double precision then
    raise exception 'invalid location' using errcode = 'CH400';
  end if;
  if p_latitude is null then
    c.result := 'unavailable';
    return c;
  end if;
  c.distance_meters := internal.distance_meters(p_latitude, p_longitude, g.latitude, g.longitude);
  if p_accuracy_meters is null or p_accuracy_meters > least(g.max_accuracy_meters, g.radius_meters) then
    c.result := 'low_accuracy';
  elsif c.distance_meters <= g.radius_meters then
    c.result := 'inside';
  else
    c.result := 'outside';
  end if;
  return c;
end;
$$;

create or replace function public.clock_in_assignment(
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
  v_exception public.attendance_exception_type;
begin
  select * into s from public.shifts x where x.id = a.shift_id;
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
  elsif att.clock_state in ('clocked_in', 'on_break') then
    raise exception 'already clocked in' using errcode = 'CHT09';
  end if;

  g := internal.check_geofence(s.facility_location_id, p_latitude, p_longitude, p_accuracy_meters);
  -- P0-E9-3E: UNKNOWN ≠ INSIDE. Where a geofence applies, clock-in fails closed
  -- whatever the outside policy: no reading, a stale reading, or one too
  -- imprecise to place the worker inside the fence is refused and nothing is
  -- recorded. (The outside policy only decides what a PRECISE outside reading
  -- does.)
  if g.required then
    if g.result = 'unavailable' then
      raise exception 'location is required at this site' using errcode = 'CHT12';
    elsif p_device_captured_at is null
          or p_device_captured_at < v_now - interval '5 minutes'
          or p_device_captured_at > v_now + interval '2 minutes' then
      raise exception 'location reading is not current' using errcode = 'CHT13';
    elsif g.result = 'low_accuracy' then
      raise exception 'location accuracy too low' using errcode = 'CHT14';
    end if;
  end if;

  select * into e from internal.assignment_eligibility(s.id, a.agency_worker_id, a.id);
  if cardinality(e.block_reasons) > 0 then
    v_refusal := case when 'WORKER_NOT_ACTIVE' = any (e.block_reasons) then 'WORKER_NOT_ACTIVE'
                      else 'WORKER_NOT_ELIGIBLE' end;
    v_exception := 'assignment_not_ready';
  elsif g.required and g.outside_policy = 'block' and g.result = 'outside' then
    v_refusal := 'OUTSIDE_GEOFENCE';
    v_exception := 'outside_geofence';
  end if;
  if v_refusal is not null then
    -- Bounded: beyond 10 refusals per worker + assignment per 10 minutes, nothing is written.
    if not internal.consume_rate_limit('attendance.clock_in_refused:' || v_profile_id || ':' || a.id,
                                       10, interval '10 minutes') then
      raise exception 'too many refused clock-in attempts' using errcode = 'CH429';
    end if;
    if internal.open_attendance_exception(att, v_exception, 'urgent', 'clock_action') then
      perform internal.enqueue_notification('attendance_clock_in_blocked', a.agency_organisation_id, null,
        a.agency_organisation_id, 'shift_assignment', a.id, '{}'::jsonb, s.end_at);
    end if;
    att := internal.refresh_attendance(att.id);
    perform internal.record_audit_event('attendance.clock_in_refused', a.agency_organisation_id, 'attendance',
      att.id, jsonb_build_object('assignment_id', a.id, 'refusal', v_refusal, 'geofence_result', g.result));
    return query select 'refused'::text, att.id, null::timestamptz, s.timezone, g.result,
                        array[v_exception::text], v_refusal;
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
