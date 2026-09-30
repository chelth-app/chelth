-- =============================================================================
-- Migration: attendance_hardening_rpcs
-- Stage:     P0-E6-S2
--
-- Purpose
--   * internal.effective_time: the ONE canonical calculation of effective
--     start/end, breaks, break minutes, worked minutes, completeness and
--     blocking reasons from attendance events. Projections and timesheets
--     call it; nothing else computes worked time.
--       - latest corrected_* event wins, else the device event;
--       - instants are truncated to the whole minute (epoch based, so DST
--         and odd offsets cannot skew it), worked = (end − start) − breaks;
--       - no clock-out ⇒ incomplete; an end time is never invented.
--   * Breaks: start_break_assignment / end_break_assignment (no location).
--     Clock-out is refused while on a break (CHT21).
--   * Corrections: break event types, reviewer-adjusted approval (required
--     structured reason, bounded note), reviewer-originated adjustment. A
--     change that would alter an approved/locked timesheet needs explicit
--     confirmation AND timesheet.approve (CHT22) and creates a new revision.
--   * Refused clock-in rate limit: 10 refusals per worker + assignment per
--     10-minute window; beyond it CH429 with NOTHING written (no exception,
--     no audit, no notification).
--   * Facility attendance views: one audit row per viewer + shift per 15 min.
--   * Location evidence: retention (7–365 days, default 90), daily bounded
--     idempotent purge (coordinates only), legal hold, audited counts only.
--
--   New errors: CHT19 ALREADY_ON_BREAK · CHT20 NOT_ON_BREAK · CHT21 ON_BREAK ·
--               CHT22 TIMESHEET_REVISION_REQUIRED
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Canonical effective-time calculation
-- -----------------------------------------------------------------------------
create type internal.effective_time as (
  effective_start_at timestamptz,
  effective_end_at timestamptz,
  breaks jsonb,
  break_minutes integer,
  worked_minutes integer,
  not_worked boolean,
  complete boolean,
  on_break boolean,
  reasons text[]
);

-- Whole minutes between two instants (both truncated to the minute on the epoch).
create function internal.whole_minutes(p_from timestamptz, p_to timestamptz)
returns integer
language sql
immutable
set search_path = ''
as $$
  select (floor(extract(epoch from p_to) / 60) - floor(extract(epoch from p_from) / 60))::integer
$$;

-- Latest corrected_<type> for the segment, else the device <type>.
create function internal.effective_event_time(p_attendance_id uuid, p_type text, p_segment smallint)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select e.occurred_at from public.attendance_events e
     where e.attendance_id = p_attendance_id and e.segment = p_segment
       and e.event_type = ('corrected_' || p_type)::public.attendance_event_type
     order by e.sequence desc limit 1),
    (select e.occurred_at from public.attendance_events e
     where e.attendance_id = p_attendance_id and e.segment = p_segment
       and e.event_type = p_type::public.attendance_event_type))
$$;

create function internal.effective_time(p_attendance_id uuid)
returns internal.effective_time
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r internal.effective_time;
  v_segment smallint;
  v_bs timestamptz;
  v_be timestamptz;
  v_prev_end timestamptz;
  v_breaks jsonb := '[]'::jsonb;
  v_break_minutes integer := 0;
  v_reasons text[] := '{}'::text[];
  v_bad boolean := false;
  v_open_break boolean := false;
begin
  r.not_worked := false;
  r.on_break := false;
  r.breaks := '[]'::jsonb;
  if p_attendance_id is null then
    r.complete := false;
    r.reasons := array['MISSING_CLOCK_IN'];
    return r;
  end if;

  r.effective_start_at := internal.effective_event_time(p_attendance_id, 'clock_in', 1::smallint);
  r.effective_end_at := internal.effective_event_time(p_attendance_id, 'clock_out', 1::smallint);

  for v_segment in
    select distinct e.segment from public.attendance_events e
    where e.attendance_id = p_attendance_id
      and e.event_type in ('break_start', 'break_end', 'corrected_break_start', 'corrected_break_end')
    order by 1
  loop
    v_bs := internal.effective_event_time(p_attendance_id, 'break_start', v_segment);
    v_be := internal.effective_event_time(p_attendance_id, 'break_end', v_segment);
    v_breaks := v_breaks || jsonb_build_object('segment', v_segment, 'start_at', v_bs, 'end_at', v_be);
    if v_open_break then
      v_bad := true;                                   -- a break after an unfinished one
    end if;
    if v_bs is null then
      v_bad := true;
    elsif v_be is null then
      v_open_break := true;
      if (r.effective_start_at is not null and v_bs < r.effective_start_at)
         or (v_prev_end is not null and v_bs < v_prev_end) then
        v_bad := true;
      end if;
    else
      if v_be < v_bs
         or (v_prev_end is not null and v_bs < v_prev_end)
         or (r.effective_start_at is not null and v_bs < r.effective_start_at)
         or (r.effective_end_at is not null and v_be > r.effective_end_at) then
        v_bad := true;
      end if;
      v_break_minutes := v_break_minutes + greatest(0, internal.whole_minutes(v_bs, v_be));
      v_prev_end := v_be;
    end if;
  end loop;
  r.breaks := v_breaks;

  if r.effective_start_at is null then
    if exists (select 1 from public.attendance_exceptions x
               where x.attendance_id = p_attendance_id and x.exception_type = 'missed_clock_in'
                 and x.resolution = 'not_worked') then
      r.not_worked := true;
      r.worked_minutes := 0;
      r.break_minutes := 0;
      r.complete := true;
      r.reasons := '{}'::text[];
      return r;
    end if;
    v_reasons := v_reasons || 'MISSING_CLOCK_IN'::text;
  elsif r.effective_end_at is null then
    v_reasons := v_reasons || 'MISSING_CLOCK_OUT'::text;
    r.on_break := v_open_break;
  elsif r.effective_end_at < r.effective_start_at then
    v_bad := true;
  end if;
  if v_open_break then
    v_reasons := v_reasons || 'BREAK_NOT_ENDED'::text;
  end if;
  if v_bad then
    v_reasons := v_reasons || 'TIMES_INCONSISTENT'::text;
  end if;

  r.break_minutes := v_break_minutes;
  r.reasons := v_reasons;
  r.complete := cardinality(v_reasons) = 0;
  if r.complete then
    r.worked_minutes := greatest(0, internal.whole_minutes(r.effective_start_at, r.effective_end_at) - v_break_minutes);
  end if;
  return r;
end;
$$;

-- Projection refresh: state from the canonical calculation, then the timesheet entry.
create or replace function internal.refresh_attendance(p_attendance_id uuid)
returns public.assignment_attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  eff internal.effective_time := internal.effective_time(p_attendance_id);
  r public.assignment_attendance;
begin
  if eff.effective_end_at is not null and eff.effective_start_at is not null
     and eff.effective_end_at < eff.effective_start_at then
    raise exception 'the corrected times would be out of order' using errcode = 'CHT16';
  end if;
  update public.assignment_attendance x
     set clock_in_at = eff.effective_start_at,
         clock_out_at = case when eff.effective_start_at is null then null else eff.effective_end_at end,
         clock_state = case when eff.effective_start_at is null then 'not_started'::public.attendance_clock_state
                            when eff.effective_end_at is not null then 'clocked_out'::public.attendance_clock_state
                            when eff.on_break then 'on_break'::public.attendance_clock_state
                            else 'clocked_in'::public.attendance_clock_state end,
         open_exception_count = (select count(*) from public.attendance_exceptions ex
                                 where ex.attendance_id = p_attendance_id and ex.status in ('open', 'under_review'))
   where x.id = p_attendance_id
  returning x.* into r;
  perform internal.sync_timesheet_entry(r.assignment_id);
  return r;
end;
$$;

-- Default rules now include evidence retention.
create or replace function internal.attendance_rules(p_organisation_id uuid)
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
    -- Documented defaults (ATTENDANCE_DOMAIN_MODEL.md §4, ATTENDANCE_EVIDENCE_RETENTION.md).
    r.agency_organisation_id := p_organisation_id;
    r.agency_organisation_type := 'agency';
    r.early_clock_in_minutes := 30;
    r.late_clock_in_minutes := 5;
    r.early_clock_out_minutes := 15;
    r.late_clock_out_minutes := 30;
    r.missed_clock_in_minutes := 15;
    r.missed_clock_out_minutes := 60;
    r.clock_out_cutoff_minutes := 240;
    r.location_evidence_retention_days := 90;
  end if;
  return r;
end;
$$;

-- One identical read-audit row per actor + action + target per window.
create function internal.record_audit_event_once(
  p_action text,
  p_organisation_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.audit_events a
             where a.actor_profile_id = auth.uid() and a.action = p_action and a.target_id = p_target_id
               and a.occurred_at > now() - p_window) then
    return false;
  end if;
  perform internal.record_audit_event(p_action, p_organisation_id, p_target_type, p_target_id, '{}'::jsonb);
  return true;
end;
$$;

-- Guard for changes that would alter an approved/locked timesheet.
create function internal.require_timesheet_revision_ok(p_assignment_id uuid, p_confirm boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.timesheet_status;
  v_org uuid;
begin
  select t.status, t.agency_organisation_id into v_status, v_org
  from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
  where e.assignment_id = p_assignment_id;
  if v_status in ('agency_approved', 'locked') then
    if not coalesce(p_confirm, false) then
      raise exception 'this attendance is on an approved timesheet; confirm a new revision' using errcode = 'CHT22';
    end if;
    perform internal.require_capability(v_org, 'timesheet.approve');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Clock in (S1 + break state + refused-attempt rate limit)
-- -----------------------------------------------------------------------------
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
  if g.required and g.outside_policy = 'block' then
    if g.result = 'unavailable' then
      raise exception 'location is required at this site' using errcode = 'CHT12';
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

-- -----------------------------------------------------------------------------
-- Clock out (refused while on a break)
-- -----------------------------------------------------------------------------
create or replace function public.clock_out_assignment(
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
  elsif att.clock_state = 'on_break' then
    raise exception 'end your break before clocking out' using errcode = 'CHT21';
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
-- Breaks (server time; no location is ever requested for a break)
-- -----------------------------------------------------------------------------
create function public.start_break_assignment(p_assignment_id uuid)
returns table (attendance_id uuid, recorded_at timestamptz, segment smallint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  a public.shift_assignments := internal.own_assignment_for_attendance(p_assignment_id);
  att public.assignment_attendance;
  v_now timestamptz := now();
  v_segment smallint;
begin
  select * into att from public.assignment_attendance x where x.assignment_id = a.id for update;
  if att.id is null or att.clock_state = 'not_started' then
    raise exception 'not clocked in' using errcode = 'CHT10';
  elsif att.clock_state = 'clocked_out' then
    raise exception 'already clocked out' using errcode = 'CHT11';
  elsif att.clock_state = 'on_break' then
    raise exception 'already on a break' using errcode = 'CHT19';
  end if;
  select coalesce(max(e.segment), 0) + 1 into v_segment from public.attendance_events e
  where e.attendance_id = att.id and e.event_type in ('break_start', 'corrected_break_start');
  if v_segment > 20 then
    raise exception 'too many breaks on one shift' using errcode = 'CH400';
  end if;
  insert into public.attendance_events
    (attendance_id, assignment_id, agency_organisation_id, event_type, segment, occurred_at, recorded_at, source,
     geofence_result, actor_profile_id)
  values (att.id, a.id, a.agency_organisation_id, 'break_start', v_segment, v_now, v_now, 'worker_device',
          'not_required', v_profile_id);
  perform internal.refresh_attendance(att.id);
  perform internal.record_audit_event('attendance.break_started', a.agency_organisation_id, 'attendance', att.id,
    jsonb_build_object('segment', v_segment));
  return query select att.id, v_now, v_segment;
end;
$$;

create function public.end_break_assignment(p_assignment_id uuid)
returns table (attendance_id uuid, recorded_at timestamptz, segment smallint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  a public.shift_assignments := internal.own_assignment_for_attendance(p_assignment_id);
  att public.assignment_attendance;
  v_now timestamptz := now();
  v_segment smallint;
begin
  select * into att from public.assignment_attendance x where x.assignment_id = a.id for update;
  if att.id is null or att.clock_state <> 'on_break' then
    raise exception 'not on a break' using errcode = 'CHT20';
  end if;
  select max(e.segment) into v_segment from public.attendance_events e
  where e.attendance_id = att.id and e.event_type in ('break_start', 'corrected_break_start');
  insert into public.attendance_events
    (attendance_id, assignment_id, agency_organisation_id, event_type, segment, occurred_at, recorded_at, source,
     geofence_result, actor_profile_id)
  values (att.id, a.id, a.agency_organisation_id, 'break_end', v_segment, v_now, v_now, 'worker_device',
          'not_required', v_profile_id);
  perform internal.refresh_attendance(att.id);
  perform internal.record_audit_event('attendance.break_ended', a.agency_organisation_id, 'attendance', att.id,
    jsonb_build_object('segment', v_segment));
  return query select att.id, v_now, v_segment;
end;
$$;

-- -----------------------------------------------------------------------------
-- Correction requests (worker): clock and break times
-- -----------------------------------------------------------------------------
drop function public.request_attendance_correction(uuid, public.attendance_event_type, timestamptz,
                                                   public.attendance_correction_reason, text);

create function public.request_attendance_correction(
  p_assignment_id uuid,
  p_event_type public.attendance_event_type,
  p_requested_time timestamptz,
  p_reason public.attendance_correction_reason,
  p_note text default null,
  p_segment smallint default 1
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
  v_segment smallint := coalesce(p_segment, 1::smallint);
  v_max_segment smallint;
  v_id uuid;
begin
  select * into s from public.shifts x where x.id = a.shift_id;
  if a.status <> 'accepted' then
    raise exception 'assignment is not accepted' using errcode = 'CHT05';
  end if;
  if p_event_type not in ('clock_in', 'clock_out', 'break_start', 'break_end') or p_reason is null
     or p_requested_time is null or v_segment not between 1 and 20
     or (p_event_type in ('clock_in', 'clock_out') and v_segment <> 1) then
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
  if p_event_type in ('break_start', 'break_end') then
    if att.clock_in_at is null then
      raise exception 'request the clock-in time first' using errcode = 'CHT16';
    end if;
    if p_requested_time < att.clock_in_at or (att.clock_out_at is not null and p_requested_time > att.clock_out_at) then
      raise exception 'a break must fall between clock-in and clock-out' using errcode = 'CHT16';
    end if;
    select coalesce(max(e.segment), 0) into v_max_segment from public.attendance_events e
    where e.attendance_id = att.id and e.event_type in ('break_start', 'corrected_break_start');
    if v_segment > v_max_segment + 1 then
      raise exception 'breaks are numbered in order' using errcode = 'CHT16';
    end if;
    if p_event_type = 'break_end' and internal.effective_event_time(att.id, 'break_start', v_segment) is null
       and not exists (select 1 from public.attendance_corrections c
                       where c.attendance_id = att.id and c.requested_event_type = 'break_start'
                         and c.segment = v_segment and c.status = 'pending') then
      raise exception 'request the break start first' using errcode = 'CHT16';
    end if;
  end if;
  if exists (select 1 from public.attendance_corrections c
             where c.attendance_id = att.id and c.requested_event_type = p_event_type and c.segment = v_segment
               and c.status = 'pending') then
    raise exception 'a request for this time is already pending' using errcode = 'CHT16';
  end if;

  insert into public.attendance_corrections as c
    (attendance_id, assignment_id, agency_organisation_id, requested_by_profile_id, requested_event_type, segment,
     requested_time, reason, worker_note)
  values (att.id, a.id, a.agency_organisation_id, v_profile_id, p_event_type, v_segment, p_requested_time, p_reason,
          nullif(btrim(p_note), ''))
  returning c.id into v_id;

  perform internal.open_attendance_exception(att, 'manual_correction_requested', 'attention', 'correction');
  perform internal.refresh_attendance(att.id);
  perform internal.record_audit_event('attendance.correction_requested', a.agency_organisation_id,
    'attendance_correction', v_id,
    jsonb_build_object('attendance_id', att.id, 'event_type', p_event_type, 'segment', v_segment, 'reason', p_reason));
  perform internal.enqueue_notification('attendance_correction_requested', a.agency_organisation_id, null,
    a.agency_organisation_id, 'shift_assignment', a.id);
  return v_id;
end;
$$;

-- Appends a corrected_* event for an approved correction and resolves what it settles.
create function internal.apply_attendance_correction(p_correction_id uuid, p_actor_profile_id uuid,
                                                     p_membership_id uuid)
returns public.assignment_attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.attendance_corrections;
  att public.assignment_attendance;
begin
  select * into c from public.attendance_corrections x where x.id = p_correction_id;
  insert into public.attendance_events
    (attendance_id, assignment_id, agency_organisation_id, event_type, segment, occurred_at, source,
     geofence_result, actor_profile_id, correction_id)
  values (c.attendance_id, c.assignment_id, c.agency_organisation_id,
          ('corrected_' || c.requested_event_type::text)::public.attendance_event_type, c.segment, c.approved_time,
          'approved_correction', 'not_required', p_actor_profile_id, c.id);
  if c.requested_event_type in ('clock_in', 'clock_out') then
    perform internal.resolve_attendance_exceptions(c.attendance_id,
      array[('missed_' || c.requested_event_type::text)::public.attendance_exception_type],
      'correction_approved', p_membership_id);
  end if;
  if not exists (select 1 from public.attendance_corrections x
                 where x.attendance_id = c.attendance_id and x.status = 'pending') then
    perform internal.resolve_attendance_exceptions(c.attendance_id,
      array['manual_correction_requested']::public.attendance_exception_type[], 'correction_approved', p_membership_id);
  end if;
  att := internal.refresh_attendance(c.attendance_id);
  if 'TIMES_INCONSISTENT' = any ((internal.effective_time(c.attendance_id)).reasons) then
    raise exception 'the corrected times would be out of order' using errcode = 'CHT16';
  end if;
  return att;
end;
$$;

-- -----------------------------------------------------------------------------
-- Review (agency): approve as requested, approve with adjustment, or reject
-- -----------------------------------------------------------------------------
drop function public.review_attendance_correction(uuid, boolean, public.attendance_correction_resolution);

create function public.review_attendance_correction(
  p_correction_id uuid,
  p_approve boolean,
  p_resolution public.attendance_correction_resolution,
  p_approved_time timestamptz default null,
  p_adjustment_reason public.attendance_adjustment_reason default null,
  p_note text default null,
  p_confirm_revision boolean default false
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
  v_time timestamptz;
  v_note text := nullif(btrim(p_note), '');
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
     or p_approve <> (p_resolution in ('approved_as_requested', 'approved_with_adjustment'))
     or (p_resolution = 'approved_with_adjustment'
         and (p_approved_time is null or p_adjustment_reason is null or p_approved_time = c.requested_time))
     or (p_resolution <> 'approved_with_adjustment' and (p_approved_time is not null or p_adjustment_reason is not null)) then
    raise exception 'choose a matching resolution' using errcode = 'CH400';
  end if;
  v_membership := internal.active_membership_id(c.agency_organisation_id);
  v_time := case p_resolution when 'approved_as_requested' then c.requested_time
                              when 'approved_with_adjustment' then p_approved_time end;

  if p_approve then
    if v_time > now() then
      raise exception 'a corrected time cannot be in the future' using errcode = 'CHT16';
    end if;
    perform internal.require_timesheet_revision_ok(c.assignment_id, p_confirm_revision);
    att := internal.refresh_attendance(att.id);
    if (c.requested_event_type = 'clock_out' and (att.clock_in_at is null or v_time <= att.clock_in_at))
       or (c.requested_event_type = 'clock_in' and att.clock_out_at is not null and v_time >= att.clock_out_at) then
      raise exception 'the corrected times would be out of order' using errcode = 'CHT16';
    end if;
    update public.attendance_corrections x
       set status = 'approved', resolution = p_resolution, approved_time = v_time,
           adjustment_reason = p_adjustment_reason, reviewer_note = v_note,
           reviewed_by_membership_id = v_membership, reviewed_at = now()
     where x.id = c.id;
    perform internal.apply_attendance_correction(c.id, v_profile_id, v_membership);
  else
    update public.attendance_corrections x
       set status = 'rejected', resolution = p_resolution, reviewer_note = v_note,
           reviewed_by_membership_id = v_membership, reviewed_at = now()
     where x.id = c.id;
    if not exists (select 1 from public.attendance_corrections x where x.attendance_id = att.id and x.status = 'pending') then
      perform internal.resolve_attendance_exceptions(att.id,
        array['manual_correction_requested']::public.attendance_exception_type[], 'correction_rejected', v_membership);
    end if;
    perform internal.refresh_attendance(att.id);
  end if;

  -- Audit: codes only (no times, no note text).
  perform internal.record_audit_event(
    case when p_approve then 'attendance.correction_approved' else 'attendance.correction_rejected' end,
    c.agency_organisation_id, 'attendance_correction', c.id,
    jsonb_build_object('attendance_id', att.id, 'event_type', c.requested_event_type, 'segment', c.segment,
                       'resolution', p_resolution, 'adjustment_reason', p_adjustment_reason,
                       'revision_confirmed', coalesce(p_confirm_revision, false)));
  perform internal.enqueue_notification(
    case when not p_approve then 'attendance_correction_rejected'::internal.notification_event
         when p_resolution = 'approved_with_adjustment' then 'attendance_time_adjusted'::internal.notification_event
         else 'attendance_correction_approved'::internal.notification_event end,
    c.agency_organisation_id, att.profile_id, null, 'shift_assignment', att.assignment_id);
end;
$$;

-- Reviewer-originated adjustment (e.g. a facility discrepancy): reason required,
-- appended as an approved correction + corrected event; worker is told.
create function public.adjust_attendance_time(
  p_attendance_id uuid,
  p_event_type public.attendance_event_type,
  p_time timestamptz,
  p_adjustment_reason public.attendance_adjustment_reason,
  p_note text default null,
  p_segment smallint default 1,
  p_confirm_revision boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  att public.assignment_attendance;
  s public.shifts;
  v_membership uuid;
  v_segment smallint := coalesce(p_segment, 1::smallint);
  v_id uuid;
begin
  select * into att from public.assignment_attendance x where x.id = p_attendance_id;
  if att.id is null or not authz.has_capability(att.agency_organisation_id, 'attendance.view') then
    raise exception 'attendance not found' using errcode = 'CHT04';
  end if;
  perform internal.require_capability(att.agency_organisation_id, 'attendance.review');
  select * into att from public.assignment_attendance x where x.id = p_attendance_id for update;
  if att.profile_id = v_profile_id then
    raise exception 'you cannot review your own attendance' using errcode = 'CH403';
  end if;
  if p_event_type not in ('clock_in', 'clock_out', 'break_start', 'break_end') or p_time is null
     or p_adjustment_reason is null or v_segment not between 1 and 20
     or (p_event_type in ('clock_in', 'clock_out') and v_segment <> 1) then
    raise exception 'invalid adjustment' using errcode = 'CH400';
  end if;
  select * into s from public.shifts x where x.id = att.shift_id;
  if p_time > now() or p_time < s.start_at - interval '12 hours' or p_time > s.end_at + interval '12 hours' then
    raise exception 'the time is outside the shift window' using errcode = 'CHT16';
  end if;
  if p_event_type in ('clock_out', 'break_start', 'break_end') and att.clock_in_at is null then
    raise exception 'record the clock-in time first' using errcode = 'CHT16';
  end if;
  perform internal.require_timesheet_revision_ok(att.assignment_id, p_confirm_revision);
  v_membership := internal.active_membership_id(att.agency_organisation_id);

  insert into public.attendance_corrections as c
    (attendance_id, assignment_id, agency_organisation_id, requested_by_profile_id, requested_event_type, segment,
     requested_time, reason, origin, status, resolution, approved_time, adjustment_reason, reviewer_note,
     reviewed_by_membership_id, reviewed_at)
  values (att.id, att.assignment_id, att.agency_organisation_id, v_profile_id, p_event_type, v_segment,
          p_time, 'recorded_wrong_time', 'reviewer_adjustment', 'approved', 'approved_with_adjustment', p_time,
          p_adjustment_reason, nullif(btrim(p_note), ''), v_membership, now())
  returning c.id into v_id;
  perform internal.apply_attendance_correction(v_id, v_profile_id, v_membership);

  perform internal.record_audit_event('attendance.time_adjusted', att.agency_organisation_id,
    'attendance_correction', v_id,
    jsonb_build_object('attendance_id', att.id, 'event_type', p_event_type, 'segment', v_segment,
                       'adjustment_reason', p_adjustment_reason,
                       'revision_confirmed', coalesce(p_confirm_revision, false)));
  perform internal.enqueue_notification('attendance_time_adjusted', att.agency_organisation_id, att.profile_id, null,
    'shift_assignment', att.assignment_id);
  return v_id;
end;
$$;

-- Exception review: acknowledge / dismiss / under review, and "not worked" for a no-show.
create or replace function public.review_attendance_exception(
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
  if x.status not in ('open', 'under_review') then
    raise exception 'exception already closed' using errcode = 'CH409';
  end if;
  if p_status = 'under_review' and p_resolution is null then
    update public.attendance_exceptions e set status = 'under_review' where e.id = x.id;
  elsif p_status in ('resolved', 'dismissed') and p_resolution in ('acknowledged', 'not_applicable') then
    update public.attendance_exceptions e
       set status = p_status, resolution = p_resolution, resolved_at = now(),
           reviewer_membership_id = internal.active_membership_id(x.agency_organisation_id)
     where e.id = x.id;
  elsif p_status = 'resolved' and p_resolution = 'not_worked'
        and x.exception_type = 'missed_clock_in' and att.clock_in_at is null then
    update public.attendance_exceptions e
       set status = 'resolved', resolution = 'not_worked', resolved_at = now(),
           reviewer_membership_id = internal.active_membership_id(x.agency_organisation_id)
     where e.id = x.id;
  else
    raise exception 'invalid exception review' using errcode = 'CH400';
  end if;
  perform internal.refresh_attendance(att.id);
  perform internal.record_audit_event('attendance.exception_reviewed', x.agency_organisation_id,
    'attendance_exception', x.id, jsonb_build_object('status', p_status, 'resolution', p_resolution,
                                                     'exception_type', x.exception_type));
end;
$$;

-- -----------------------------------------------------------------------------
-- History: original events, requests, decisions, corrected events, exceptions.
-- Agency (attendance.view) sees actor names; the worker sees their own record
-- without staff names. Never coordinates.
-- -----------------------------------------------------------------------------
create function public.list_attendance_history(p_attendance_id uuid)
returns table (
  item_kind text,
  item_id uuid,
  at timestamptz,
  event_type text,
  segment smallint,
  detail jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  t public.assignment_attendance;
  v_agency boolean;
begin
  perform internal.require_identity();
  select * into t from public.assignment_attendance x where x.id = p_attendance_id;
  v_agency := t.id is not null and authz.has_capability(t.agency_organisation_id, 'attendance.view');
  if t.id is null or not (v_agency or authz.is_own_active_worker(t.agency_worker_id)) then
    raise exception 'attendance not found' using errcode = 'CHT04';
  end if;
  return query
    select 'event'::text, e.id, e.occurred_at, e.event_type::text, e.segment,
           jsonb_build_object('source', e.source, 'recorded_at', e.recorded_at, 'geofence_result', e.geofence_result,
                              'correction_id', e.correction_id,
                              'actor_name', case when v_agency then p.display_name end)
    from public.attendance_events e
    left join public.profiles p on p.id = e.actor_profile_id
    where e.attendance_id = t.id
    union all
    select 'correction'::text, c.id, c.requested_at, c.requested_event_type::text, c.segment,
           jsonb_build_object('origin', c.origin, 'requested_time', c.requested_time, 'reason', c.reason,
                              'worker_note', c.worker_note, 'status', c.status, 'resolution', c.resolution,
                              'approved_time', c.approved_time, 'adjustment_reason', c.adjustment_reason,
                              'reviewer_note', c.reviewer_note, 'reviewed_at', c.reviewed_at,
                              'requested_by_name', case when v_agency then rp.display_name end,
                              'reviewer_name', case when v_agency then vp.display_name end)
    from public.attendance_corrections c
    left join public.profiles rp on rp.id = c.requested_by_profile_id
    left join public.organisation_memberships m on m.id = c.reviewed_by_membership_id
    left join public.profiles vp on vp.id = m.profile_id
    where c.attendance_id = t.id
    union all
    select 'exception'::text, x.id, x.opened_at, x.exception_type::text, null::smallint,
           jsonb_build_object('status', x.status, 'severity', x.severity, 'detected_by', x.detected_by,
                              'resolved_at', x.resolved_at, 'resolution', x.resolution,
                              'reviewer_name', case when v_agency then xp.display_name end)
    from public.attendance_exceptions x
    left join public.organisation_memberships xm on xm.id = x.reviewer_membership_id
    left join public.profiles xp on xp.id = xm.profile_id
    where x.attendance_id = t.id
    order by 3, 1, 2;
end;
$$;

-- -----------------------------------------------------------------------------
-- Worker projection (adds break controls)
-- -----------------------------------------------------------------------------
drop function public.list_my_attendance(uuid);

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
  can_start_break boolean,
  can_end_break boolean,
  break_minutes integer,
  worked_minutes integer,
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
           coalesce(t.clock_state = 'clocked_in', false),
           coalesce(t.clock_state = 'on_break', false),
           e.break_minutes,
           e.worked_minutes,
           coalesce((select jsonb_agg(jsonb_build_object('type', x.exception_type, 'status', x.status,
                                                         'resolution', x.resolution) order by x.opened_at)
                     from public.attendance_exceptions x where x.attendance_id = t.id), '[]'::jsonb),
           coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'event_type', c.requested_event_type,
                                                         'segment', c.segment,
                                                         'requested_time', c.requested_time, 'reason', c.reason,
                                                         'status', c.status, 'resolution', c.resolution,
                                                         'approved_time', c.approved_time, 'origin', c.origin,
                                                         'adjustment_reason', c.adjustment_reason,
                                                         'reviewer_note', c.reviewer_note)
                                      order by c.requested_at)
                     from public.attendance_corrections c where c.attendance_id = t.id), '[]'::jsonb)
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
    join public.agency_facilities f on f.id = s.agency_facility_id
    join public.facility_locations l on l.id = s.facility_location_id
    cross join lateral internal.attendance_rules(a.agency_organisation_id) r
    left join public.assignment_attendance t on t.assignment_id = a.id
    left join lateral internal.effective_time(t.id) e on t.id is not null
    where a.agency_organisation_id = p_organisation_id
      and authz.is_own_active_worker(a.agency_worker_id)
      and (a.status = 'accepted' or t.id is not null)
      and s.end_at > now() - interval '7 days'
      and s.start_at < now() + interval '2 days'
    order by s.start_at, a.id
    limit 100;
end;
$$;

-- -----------------------------------------------------------------------------
-- Facility attendance view: deduplicated access audit (one per viewer + shift / 15 min)
-- -----------------------------------------------------------------------------
create or replace function public.list_facility_shift_attendance(p_shift_id uuid)
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
  perform internal.record_audit_event_once('attendance.viewed_by_facility', v_facility_org, 'shift', s.id,
    interval '15 minutes');
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

-- -----------------------------------------------------------------------------
-- Missed-clock scan: on_break also counts as "still clocked in"
-- -----------------------------------------------------------------------------
create or replace function internal.run_attendance_scan()
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
      and not exists (select 1 from public.attendance_exceptions y
                      where y.attendance_id = x.id and y.exception_type = 'missed_clock_in'
                        and y.resolution = 'not_worked')
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

  for v_row in
    select x.id, x.assignment_id, x.agency_organisation_id, x.profile_id
    from public.assignment_attendance x
    join public.shifts s on s.id = x.shift_id
    cross join lateral internal.attendance_rules(x.agency_organisation_id) r
    where x.clock_state in ('clocked_in', 'on_break')
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

-- -----------------------------------------------------------------------------
-- Raw location evidence viewer (attendance.location.view, AAL2; every read audited)
-- -----------------------------------------------------------------------------
drop function public.list_attendance_location_evidence(uuid);

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
  recorded_at timestamptz,
  purged_at timestamptz,
  state public.location_evidence_state,
  retention_days integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  t public.assignment_attendance;
  v_on_hold boolean;
begin
  perform internal.require_identity();
  select * into t from public.assignment_attendance x where x.id = p_attendance_id;
  if t.id is null or not authz.has_capability(t.agency_organisation_id, 'attendance.view') then
    raise exception 'attendance not found' using errcode = 'CHT04';
  end if;
  perform internal.require_capability(t.agency_organisation_id, 'attendance.location.view');
  perform internal.record_audit_event('attendance.location_viewed', t.agency_organisation_id, 'attendance', t.id,
    '{}'::jsonb);
  v_on_hold := exists (select 1 from public.attendance_evidence_legal_holds h
                       where h.attendance_id = t.id and h.released_at is null);
  return query
    select e.event_type, v.result, v.latitude, v.longitude, v.accuracy_meters, v.distance_meters, v.radius_meters,
           v.device_captured_at, v.recorded_at, v.purged_at,
           case when v.purged_at is not null then 'purged'::public.location_evidence_state
                when v_on_hold then 'on_hold'::public.location_evidence_state
                else 'retained'::public.location_evidence_state end,
           (internal.attendance_rules(t.agency_organisation_id)).location_evidence_retention_days
    from public.attendance_location_evidence v
    join public.attendance_events e on e.id = v.event_id
    where v.attendance_id = t.id
    order by v.recorded_at;
end;
$$;

-- Legal holds (attendance.location.view, AAL2). The reason is stored, never audited.
create function public.list_location_evidence_holds(p_attendance_id uuid)
returns table (hold_id uuid, reason text, placed_at timestamptz, placed_by_name text, released_at timestamptz)
language plpgsql
stable
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
  return query
    select h.id, h.reason, h.placed_at, p.display_name, h.released_at
    from public.attendance_evidence_legal_holds h
    join public.organisation_memberships m on m.id = h.placed_by_membership_id
    join public.profiles p on p.id = m.profile_id
    where h.attendance_id = t.id
    order by h.placed_at desc;
end;
$$;

create function public.place_location_evidence_hold(p_attendance_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.assignment_attendance;
  v_id uuid;
begin
  perform internal.require_identity();
  select * into t from public.assignment_attendance x where x.id = p_attendance_id;
  if t.id is null or not authz.has_capability(t.agency_organisation_id, 'attendance.view') then
    raise exception 'attendance not found' using errcode = 'CHT04';
  end if;
  perform internal.require_capability(t.agency_organisation_id, 'attendance.location.view');
  if exists (select 1 from public.attendance_evidence_legal_holds h where h.attendance_id = t.id and h.released_at is null) then
    raise exception 'this record is already on hold' using errcode = 'CH409';
  end if;
  insert into public.attendance_evidence_legal_holds (attendance_id, agency_organisation_id, reason, placed_by_membership_id)
  values (t.id, t.agency_organisation_id, btrim(p_reason), internal.active_membership_id(t.agency_organisation_id))
  returning id into v_id;
  perform internal.record_audit_event('attendance.location_hold_placed', t.agency_organisation_id,
    'attendance', t.id, jsonb_build_object('hold_id', v_id));
  return v_id;
end;
$$;

create function public.release_location_evidence_hold(p_hold_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.attendance_evidence_legal_holds;
begin
  perform internal.require_identity();
  select * into h from public.attendance_evidence_legal_holds x where x.id = p_hold_id;
  if h.id is null or not authz.has_capability(h.agency_organisation_id, 'attendance.view') then
    raise exception 'hold not found' using errcode = 'CHT04';
  end if;
  perform internal.require_capability(h.agency_organisation_id, 'attendance.location.view');
  if h.released_at is not null then
    raise exception 'hold already released' using errcode = 'CH409';
  end if;
  update public.attendance_evidence_legal_holds x
     set released_at = now(), released_by_membership_id = internal.active_membership_id(h.agency_organisation_id)
   where x.id = h.id;
  perform internal.record_audit_event('attendance.location_hold_released', h.agency_organisation_id,
    'attendance', h.attendance_id, jsonb_build_object('hold_id', h.id));
end;
$$;

-- Retention period (attendance.manage_settings, AAL2).
create function public.set_location_evidence_retention(p_organisation_id uuid, p_retention_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'attendance.manage_settings');
  if p_retention_days is null or p_retention_days not between 7 and 365 then
    raise exception 'retention must be between 7 and 365 days' using errcode = 'CH400';
  end if;
  insert into public.agency_attendance_settings (agency_organisation_id, location_evidence_retention_days,
                                                 updated_by_profile_id)
  values (p_organisation_id, p_retention_days, auth.uid())
  on conflict (agency_organisation_id) do update
    set location_evidence_retention_days = excluded.location_evidence_retention_days,
        updated_by_profile_id = excluded.updated_by_profile_id;
  perform internal.record_audit_event('attendance.retention_updated', p_organisation_id, 'organisation',
    p_organisation_id, jsonb_build_object('retention_days', p_retention_days));
end;
$$;

-- Purge: coordinates (and device time) of evidence older than the agency's
-- retention, never on hold. Bounded batches; idempotent; per-agency counts audited.
create function internal.run_location_evidence_purge(p_batch_size integer default 1000, p_max_batches integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run bigint;
  v_batch integer := 0;
  v_count integer;
  v_total integer := 0;
  v_counts jsonb := '{}'::jsonb;
  v_batch_counts jsonb;
  v_key text;
  v_result jsonb;
begin
  insert into internal.scheduled_job_runs (job) values ('location_evidence_purge') returning id into v_run;
  loop
    v_batch := v_batch + 1;
    with eligible as (
      select v.id
      from public.attendance_location_evidence v
      left join public.agency_attendance_settings st on st.agency_organisation_id = v.agency_organisation_id
      where v.purged_at is null
        and v.recorded_at < now() - make_interval(days => coalesce(st.location_evidence_retention_days, 90))
        and not exists (select 1 from public.attendance_evidence_legal_holds h
                        where h.attendance_id = v.attendance_id and h.released_at is null)
      order by v.recorded_at
      limit p_batch_size
      for update of v skip locked
    ), purged as (
      update public.attendance_location_evidence v
         set latitude = null, longitude = null, device_captured_at = null, purged_at = now()
        from eligible
       where v.id = eligible.id
      returning v.agency_organisation_id
    )
    select coalesce(jsonb_object_agg(q.agency, q.n), '{}'::jsonb), coalesce(sum(q.n), 0)::integer
      into v_batch_counts, v_count
    from (select p.agency_organisation_id::text as agency, count(*) as n from purged p group by 1) q;
    for v_key in select jsonb_object_keys(v_batch_counts) loop
      v_counts := v_counts || jsonb_build_object(v_key,
        coalesce((v_counts ->> v_key)::integer, 0) + (v_batch_counts ->> v_key)::integer);
    end loop;
    v_total := v_total + v_count;
    exit when v_count < p_batch_size or v_batch >= p_max_batches;
  end loop;

  -- Counts only: never coordinates, attendance ids or workers.
  for v_key in select jsonb_object_keys(v_counts) loop
    perform internal.record_audit_event('attendance.location_purged', v_key::uuid, 'organisation', v_key::uuid,
      jsonb_build_object('purged', (v_counts ->> v_key)::integer));
  end loop;

  v_result := jsonb_build_object('purged', v_total, 'batches', v_batch);
  update internal.scheduled_job_runs set finished_at = now(), result = v_result where id = v_run;
  return v_result;
end;
$$;

select cron.schedule('chelth-location-evidence-purge', '17 3 * * *', 'select internal.run_location_evidence_purge()');

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function
  internal.whole_minutes(timestamptz, timestamptz),
  internal.effective_event_time(uuid, text, smallint),
  internal.effective_time(uuid),
  internal.record_audit_event_once(text, uuid, text, uuid, interval),
  internal.require_timesheet_revision_ok(uuid, boolean),
  internal.apply_attendance_correction(uuid, uuid, uuid),
  internal.run_location_evidence_purge(integer, integer)
from public, anon, authenticated, service_role;

revoke all on function
  public.start_break_assignment(uuid),
  public.end_break_assignment(uuid),
  public.request_attendance_correction(uuid, public.attendance_event_type, timestamptz,
                                       public.attendance_correction_reason, text, smallint),
  public.review_attendance_correction(uuid, boolean, public.attendance_correction_resolution, timestamptz,
                                      public.attendance_adjustment_reason, text, boolean),
  public.adjust_attendance_time(uuid, public.attendance_event_type, timestamptz, public.attendance_adjustment_reason,
                                text, smallint, boolean),
  public.list_attendance_history(uuid),
  public.list_my_attendance(uuid),
  public.list_attendance_location_evidence(uuid),
  public.list_location_evidence_holds(uuid),
  public.place_location_evidence_hold(uuid, text),
  public.release_location_evidence_hold(uuid),
  public.set_location_evidence_retention(uuid, integer)
from public, anon;

grant execute on function
  public.start_break_assignment(uuid),
  public.end_break_assignment(uuid),
  public.request_attendance_correction(uuid, public.attendance_event_type, timestamptz,
                                       public.attendance_correction_reason, text, smallint),
  public.review_attendance_correction(uuid, boolean, public.attendance_correction_resolution, timestamptz,
                                      public.attendance_adjustment_reason, text, boolean),
  public.adjust_attendance_time(uuid, public.attendance_event_type, timestamptz, public.attendance_adjustment_reason,
                                text, smallint, boolean),
  public.list_attendance_history(uuid),
  public.list_my_attendance(uuid),
  public.list_attendance_location_evidence(uuid),
  public.list_location_evidence_holds(uuid),
  public.place_location_evidence_hold(uuid, text),
  public.release_location_evidence_hold(uuid),
  public.set_location_evidence_retention(uuid, integer)
to authenticated;
