-- =============================================================================
-- Migration: geofence_settings_readiness
-- Stage:     P0-E9-3E.1 (geofence settings + pilot readiness guard)
--
-- Purpose
--   1. Agency geofence POLICY and DEFAULTS on the existing per-agency settings
--      row (public.agency_attendance_settings):
--      - require_geofence (default OFF): when ON, a worker clock-in at a
--        location WITHOUT an enabled, valid geofence is REFUSED (CHT23) instead
--        of silently recording "not_required". UNKNOWN / UNCONFIGURED is not
--        NOT_REQUIRED when the agency requires geofencing.
--      - default_geofence_radius_meters (150), default_geofence_max_accuracy_meters
--        (100), default_geofence_outside_policy ('block'): used ONLY to
--        prepopulate a location's geofence form. They never enforce attendance
--        and never rewrite an existing location's geofence.
--   2. internal.location_geofence_readiness: ONE definition of "this location's
--      geofence is configured", used by clock-in enforcement and the operator
--      readiness listing.
--   3. public.set_geofence_policy (attendance.manage_settings, AAL2, audited).
--   4. public.list_geofence_readiness (facility.view): per-location status for
--      the Settings readiness surface. No coordinates.
--   5. public.set_location_geofence: same signature; explicit server-side
--      validation (CH400) and a richer audit record (what changed; never the
--      coordinates).
--
--   Unchanged: location_geofences (the operational per-location values),
--   internal.check_geofence, every P0-E9-3E fail-closed rule, and clock-out
--   (never blocked by location or by configuration).
-- =============================================================================

create type public.geofence_readiness as enum (
  'ready',          -- enabled, valid, blocks precise outside readings
  'not_blocking',   -- enabled, valid, precise outside readings are allowed and flagged
  'disabled',       -- configured but switched off
  'not_configured', -- no geofence row for the location
  'invalid'         -- enabled but a value is missing or out of bounds (defensive)
);
comment on type public.geofence_readiness is
  'Worker check-in readiness of a facility location''s geofence (P0-E9-3E.1).';

alter table public.agency_attendance_settings
  add column require_geofence boolean not null default false,
  add column default_geofence_radius_meters integer not null default 150
    check (default_geofence_radius_meters between 50 and 2000),
  add column default_geofence_max_accuracy_meters integer not null default 100
    check (default_geofence_max_accuracy_meters between 10 and 500),
  add column default_geofence_outside_policy public.geofence_outside_policy not null default 'block';

comment on column public.agency_attendance_settings.require_geofence is
  'When true, worker clock-in at a location without an enabled, valid geofence is refused (CHT23).';
comment on column public.agency_attendance_settings.default_geofence_radius_meters is
  'Prepopulates new location geofences only; never enforces attendance.';

-- Documented defaults now include the geofence policy and defaults.
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
    -- Documented defaults (ATTENDANCE_DOMAIN_MODEL.md §4, ATTENDANCE_EVIDENCE_RETENTION.md, GEOFENCE_MODEL.md §6).
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
    r.require_geofence := false;
    r.default_geofence_radius_meters := 150;
    r.default_geofence_max_accuracy_meters := 100;
    r.default_geofence_outside_policy := 'block';
  end if;
  return r;
end;
$$;

-- The single definition of a configured geofence. The table constraints
-- already bound every value; the checks are repeated so that a future schema
-- change cannot silently turn an unusable row into "configured".
create function internal.location_geofence_readiness(p_facility_location_id uuid)
returns public.geofence_readiness
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.location_geofences;
begin
  select * into g from public.location_geofences x where x.facility_location_id = p_facility_location_id;
  if g.facility_location_id is null then
    return 'not_configured'::public.geofence_readiness;
  elsif not g.enabled then
    return 'disabled'::public.geofence_readiness;
  elsif g.latitude is null or g.longitude is null
        or g.latitude = 'NaN'::double precision or g.longitude = 'NaN'::double precision
        or g.latitude not between -90 and 90 or g.longitude not between -180 and 180
        or g.radius_meters is null or g.radius_meters not between 50 and 2000
        or g.max_accuracy_meters is null or g.max_accuracy_meters not between 10 and 500
        or g.outside_policy is null then
    return 'invalid'::public.geofence_readiness;
  elsif g.outside_policy <> 'block' then
    return 'not_blocking'::public.geofence_readiness;
  end if;
  return 'ready'::public.geofence_readiness;
end;
$$;

-- -----------------------------------------------------------------------------
-- Clock-in: P0-E9-3E unchanged, plus the require-geofence guard (CHT23)
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

  -- P0-E9-3E.1: where the agency REQUIRES geofencing, a location without an
  -- enabled, valid geofence is a configuration failure, not "not_required".
  -- Refused before any location is evaluated; nothing is recorded. (Any error
  -- while reading the configuration aborts the transaction: fail closed.)
  if rules.require_geofence is distinct from false
     and internal.location_geofence_readiness(s.facility_location_id) not in ('ready', 'not_blocking') then
    raise exception 'geofencing is required but not configured for this location' using errcode = 'CHT23';
  end if;

  g := internal.check_geofence(s.facility_location_id, p_latitude, p_longitude, p_accuracy_meters);
  if rules.require_geofence is distinct from false and not coalesce(g.required, false) then
    raise exception 'geofencing is required but not configured for this location' using errcode = 'CHT23';
  end if;
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

-- -----------------------------------------------------------------------------
-- Agency geofence policy and defaults (attendance.manage_settings, AAL2)
-- -----------------------------------------------------------------------------
create function public.set_geofence_policy(
  p_organisation_id uuid,
  p_require_geofence boolean,
  p_default_radius_meters integer,
  p_default_max_accuracy_meters integer,
  p_default_outside_policy public.geofence_outside_policy
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  old public.agency_attendance_settings;
  v_changes text[] := '{}'::text[];
begin
  perform internal.require_capability(p_organisation_id, 'attendance.manage_settings');
  if p_require_geofence is null
     or p_default_radius_meters is null or p_default_radius_meters not between 50 and 2000
     or p_default_max_accuracy_meters is null or p_default_max_accuracy_meters not between 10 and 500
     or p_default_outside_policy is null then
    raise exception 'invalid geofence policy' using errcode = 'CH400';
  end if;

  old := internal.attendance_rules(p_organisation_id);
  if old.require_geofence is distinct from p_require_geofence then
    v_changes := v_changes || 'require_geofence'::text;
  end if;
  if old.default_geofence_radius_meters is distinct from p_default_radius_meters then
    v_changes := v_changes || 'default_radius'::text;
  end if;
  if old.default_geofence_max_accuracy_meters is distinct from p_default_max_accuracy_meters then
    v_changes := v_changes || 'default_max_accuracy'::text;
  end if;
  if old.default_geofence_outside_policy is distinct from p_default_outside_policy then
    v_changes := v_changes || 'default_outside_policy'::text;
  end if;

  insert into public.agency_attendance_settings (
    agency_organisation_id, require_geofence, default_geofence_radius_meters,
    default_geofence_max_accuracy_meters, default_geofence_outside_policy, updated_by_profile_id
  ) values (
    p_organisation_id, p_require_geofence, p_default_radius_meters, p_default_max_accuracy_meters,
    p_default_outside_policy, v_profile_id
  )
  on conflict (agency_organisation_id) do update set
    require_geofence = excluded.require_geofence,
    default_geofence_radius_meters = excluded.default_geofence_radius_meters,
    default_geofence_max_accuracy_meters = excluded.default_geofence_max_accuracy_meters,
    default_geofence_outside_policy = excluded.default_geofence_outside_policy,
    updated_by_profile_id = excluded.updated_by_profile_id;

  perform internal.record_audit_event('attendance.geofence_policy_updated', p_organisation_id, 'organisation',
    p_organisation_id, jsonb_build_object(
      'require_geofence', p_require_geofence,
      'default_radius_meters', p_default_radius_meters,
      'default_max_accuracy_meters', p_default_max_accuracy_meters,
      'default_outside_policy', p_default_outside_policy,
      'changes', to_jsonb(v_changes)));
end;
$$;

-- -----------------------------------------------------------------------------
-- Location geofence: same signature; explicit validation; change audit
-- -----------------------------------------------------------------------------
create or replace function public.set_location_geofence(
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
  old public.location_geofences;
  v_changes text[] := '{}'::text[];
begin
  select * into l from public.facility_locations x where x.id = p_facility_location_id;
  perform internal.require_capability(l.agency_organisation_id, 'attendance.manage_settings');
  if p_latitude is null or p_longitude is null
     or p_latitude = 'NaN'::double precision or p_longitude = 'NaN'::double precision
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
     or p_radius_meters is null or p_radius_meters not between 50 and 2000
     or p_max_accuracy_meters is null or p_max_accuracy_meters not between 10 and 500
     or p_outside_policy is null then
    raise exception 'invalid geofence' using errcode = 'CH400';
  end if;

  select * into old from public.location_geofences x where x.facility_location_id = l.id;
  if old.facility_location_id is null then
    v_changes := array['created'];
  else
    if old.enabled is distinct from coalesce(p_enabled, false) then
      v_changes := v_changes || (case when coalesce(p_enabled, false) then 'enabled' else 'disabled' end);
    end if;
    if old.latitude is distinct from p_latitude or old.longitude is distinct from p_longitude then
      v_changes := v_changes || 'site_centre'::text;
    end if;
    if old.radius_meters is distinct from p_radius_meters then
      v_changes := v_changes || 'radius'::text;
    end if;
    if old.max_accuracy_meters is distinct from p_max_accuracy_meters then
      v_changes := v_changes || 'max_accuracy'::text;
    end if;
    if old.outside_policy is distinct from p_outside_policy then
      v_changes := v_changes || 'outside_policy'::text;
    end if;
  end if;

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
  -- Facility coordinates are configuration, not personal data; still kept out
  -- of audit: only THAT the site centre changed is recorded.
  perform internal.record_audit_event('attendance.geofence_updated', l.agency_organisation_id, 'facility_location',
    l.id, jsonb_build_object('enabled', coalesce(p_enabled, false), 'radius_meters', p_radius_meters,
                             'max_accuracy_meters', p_max_accuracy_meters, 'outside_policy', p_outside_policy,
                             'changes', to_jsonb(v_changes)));
end;
$$;

-- -----------------------------------------------------------------------------
-- Operator readiness: one row per non-archived facility location. No coordinates.
-- -----------------------------------------------------------------------------
create function public.list_geofence_readiness(p_organisation_id uuid)
returns table (
  facility_id uuid,
  facility_name text,
  location_id uuid,
  location_name text,
  location_active boolean,
  enabled boolean,
  radius_meters integer,
  max_accuracy_meters integer,
  outside_policy public.geofence_outside_policy,
  readiness public.geofence_readiness,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'facility.view');
  return query
    select f.id, f.name, l.id, l.name, (l.status = 'active' and f.status = 'active'),
           coalesce(g.enabled, false), g.radius_meters, g.max_accuracy_meters, g.outside_policy,
           internal.location_geofence_readiness(l.id), g.updated_at
    from public.facility_locations l
    join public.agency_facilities f on f.id = l.agency_facility_id
    left join public.location_geofences g on g.facility_location_id = l.id
    where l.agency_organisation_id = p_organisation_id
      and f.status <> 'archived'
    order by lower(f.name), lower(l.name), l.id
    limit 1000;
end;
$$;

revoke all on function internal.location_geofence_readiness(uuid) from public, anon, authenticated, service_role;

revoke all on function
  public.set_geofence_policy(uuid, boolean, integer, integer, public.geofence_outside_policy),
  public.list_geofence_readiness(uuid)
from public, anon;
grant execute on function
  public.set_geofence_policy(uuid, boolean, integer, integer, public.geofence_outside_policy),
  public.list_geofence_readiness(uuid)
to authenticated;
