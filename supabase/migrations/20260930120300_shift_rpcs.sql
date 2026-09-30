-- =============================================================================
-- Migration: shift_rpcs
-- Stage:     P0-E5-S1
--
-- Purpose
--   Server-authorized shift commands. Every function is SECURITY DEFINER with
--   an empty search_path, authorizes the caller explicitly and DERIVES the
--   organisation from the referenced record — no organisation id is ever
--   taken from a form.
--
--   Structured errors (SQLSTATE → AppError code, src/lib/errors):
--     CHS04 SHIFT_NOT_FOUND           (also: exists but not visible — no oracle)
--     CHS09 SHIFT_NOT_OPEN
--     CHS10 RELATIONSHIP_NOT_ACTIVE
--     CHS11 FACILITY_LOCATION_INVALID
--
--   Local wall-clock input: shift date + start time + end time in the
--   LOCATION's timezone. An end time at or before the start time means the
--   shift ends the next day (overnight). Local times that do not exist (DST
--   spring-forward gap) are rejected; ambiguous times (DST fall-back) resolve
--   to the later, standard-time instant (PostgreSQL semantics, documented).
--
-- Verified by: supabase/tests/security/110_shifts.test.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers (internal: no API access)
-- -----------------------------------------------------------------------------
create function internal.local_to_instant(p_date date, p_time time, p_timezone text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_instant timestamptz := (p_date + p_time) at time zone p_timezone;
begin
  if (v_instant at time zone p_timezone) <> (p_date + p_time) then
    raise exception 'local time does not exist in the facility timezone' using errcode = 'CH400';
  end if;
  return v_instant;
end;
$$;

create function internal.shift_period(
  p_shift_date date, p_start_time time, p_end_time time, p_timezone text,
  out start_at timestamptz, out end_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_shift_date is null or p_start_time is null or p_end_time is null then
    raise exception 'shift date and times are required' using errcode = 'CH400';
  end if;
  start_at := internal.local_to_instant(p_shift_date, p_start_time, p_timezone);
  end_at := internal.local_to_instant(
    case when p_end_time <= p_start_time then p_shift_date + 1 else p_shift_date end, p_end_time, p_timezone);
end;
$$;

-- Local calendar dates a shift touches, in its timezone: the start date and
-- the date of its last instant (an end exactly at midnight belongs to the
-- previous day). Compliance is evaluated on EVERY such date.
create function internal.shift_local_dates(p_start_at timestamptz, p_end_at timestamptz, p_timezone text)
returns date[]
language sql
stable
set search_path = ''
as $$
  select array(
    select distinct d from unnest(array[
      (p_start_at at time zone p_timezone)::date,
      ((p_end_at - interval '1 microsecond') at time zone p_timezone)::date
    ]) d order by d
  )
$$;

-- Load a shift the caller may see (agency shift.view), optionally requiring a
-- further agency capability, optionally locking it. Missing and invisible
-- shifts are indistinguishable (CHS04).
create function internal.agency_shift(p_shift_id uuid, p_capability text, p_lock boolean)
returns public.shifts
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts;
begin
  perform internal.require_identity();
  select * into s from public.shifts x where x.id = p_shift_id;
  if s.id is null or not authz.has_capability(s.agency_organisation_id, 'shift.view') then
    raise exception 'shift not found' using errcode = 'CHS04';
  end if;
  if p_capability is not null then
    perform internal.require_capability(s.agency_organisation_id, p_capability);
  end if;
  if p_lock then
    select * into s from public.shifts x where x.id = p_shift_id for update;
  end if;
  return s;
end;
$$;

create function internal.require_shift_location(p_facility_location_id uuid, p_agency_facility_id uuid)
returns public.facility_locations
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.facility_locations;
begin
  select * into l from public.facility_locations x
  where x.id = p_facility_location_id and x.agency_facility_id = p_agency_facility_id;
  if l.id is null or l.status <> 'active' then
    raise exception 'facility location is not valid for this facility' using errcode = 'CHS11';
  end if;
  return l;
end;
$$;

create function internal.require_discipline(p_discipline_key text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.disciplines d where d.key = p_discipline_key and d.is_active) then
    raise exception 'unknown discipline' using errcode = 'CH400';
  end if;
end;
$$;

create function internal.require_active_relationship(p_relationship_id uuid)
returns public.agency_facility_relationships
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.agency_facility_relationships;
begin
  select * into r from public.agency_facility_relationships x where x.id = p_relationship_id;
  if r.id is null or r.status <> 'active' then
    raise exception 'the agency-facility relationship is not active' using errcode = 'CHS10';
  end if;
  return r;
end;
$$;

create function internal.active_membership_id(p_organisation_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from public.organisation_memberships m
  where m.organisation_id = p_organisation_id and m.profile_id = auth.uid() and m.status = 'active'
$$;

create function internal.clean_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(p_value), '')
$$;

-- -----------------------------------------------------------------------------
-- Agency: create a shift (draft, or open immediately)
-- -----------------------------------------------------------------------------
create function public.create_shift(
  p_agency_facility_id uuid,
  p_facility_location_id uuid,
  p_discipline_key text,
  p_shift_date date,
  p_start_time time,
  p_end_time time,
  p_requested_headcount integer,
  p_instructions text default null,
  p_external_reference text default null,
  p_open boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_facility public.agency_facilities;
  v_relationship public.agency_facility_relationships;
  v_location public.facility_locations;
  v_period record;
  v_shift_id uuid;
begin
  select * into v_facility from public.agency_facilities f where f.id = p_agency_facility_id;
  perform internal.require_capability(v_facility.agency_organisation_id, 'shift.create');
  if coalesce(p_open, false) then
    perform internal.require_capability(v_facility.agency_organisation_id, 'shift.manage');
  end if;
  if v_facility.status <> 'active' then
    raise exception 'shifts require an active facility record' using errcode = 'CHF09';
  end if;

  select * into v_relationship from public.agency_facility_relationships r
  where r.agency_facility_id = v_facility.id and r.status <> 'ended';
  perform internal.require_active_relationship(v_relationship.id);

  v_location := internal.require_shift_location(p_facility_location_id, v_facility.id);
  perform internal.require_discipline(p_discipline_key);
  select * into v_period from internal.shift_period(p_shift_date, p_start_time, p_end_time, v_location.timezone);
  if v_period.end_at <= now() then
    raise exception 'shift must end in the future' using errcode = 'CH400';
  end if;

  if not internal.consume_rate_limit('shift.create:' || v_facility.agency_organisation_id, 1000, interval '1 day') then
    raise exception 'too many shifts created' using errcode = 'CH429';
  end if;

  insert into public.shifts as s (
    agency_organisation_id, agency_facility_id, relationship_id, facility_location_id, discipline_key,
    start_at, end_at, timezone, requested_headcount, status, source, external_reference, instructions,
    created_by_organisation_id, created_by_membership_id, created_by_profile_id, opened_at, opened_by_profile_id
  ) values (
    v_facility.agency_organisation_id, v_facility.id, v_relationship.id, v_location.id, p_discipline_key,
    v_period.start_at, v_period.end_at, v_location.timezone, p_requested_headcount,
    case when coalesce(p_open, false) then 'open'::public.shift_status else 'draft'::public.shift_status end,
    'agency', internal.clean_text(p_external_reference), internal.clean_text(p_instructions),
    v_facility.agency_organisation_id, internal.active_membership_id(v_facility.agency_organisation_id), v_profile_id,
    case when coalesce(p_open, false) then now() end,
    case when coalesce(p_open, false) then v_profile_id end
  )
  returning s.id into v_shift_id;

  perform internal.record_audit_event('shift.created', v_facility.agency_organisation_id, 'shift', v_shift_id,
    jsonb_build_object('source', 'agency', 'relationship_id', v_relationship.id,
                       'status', case when coalesce(p_open, false) then 'open' else 'draft' end));
  if coalesce(p_open, false) then
    perform internal.record_audit_event('shift.opened', v_facility.agency_organisation_id, 'shift', v_shift_id,
      '{}'::jsonb);
  end if;
  return v_shift_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Facility: submit a staffing request through ONE explicit active relationship
-- -----------------------------------------------------------------------------
create function public.submit_facility_shift_request(
  p_relationship_id uuid,
  p_facility_location_id uuid,
  p_discipline_key text,
  p_shift_date date,
  p_start_time time,
  p_end_time time,
  p_requested_headcount integer,
  p_instructions text default null,
  p_external_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_relationship public.agency_facility_relationships;
  v_facility public.agency_facilities;
  v_location public.facility_locations;
  v_period record;
  v_shift_id uuid;
begin
  if not authz.has_relationship_capability(p_relationship_id, 'shift.request') then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  v_relationship := internal.require_active_relationship(p_relationship_id);
  select * into v_facility from public.agency_facilities f where f.id = v_relationship.agency_facility_id;
  if v_facility.status <> 'active' then
    raise exception 'the agency-facility relationship is not active' using errcode = 'CHS10';
  end if;

  v_location := internal.require_shift_location(p_facility_location_id, v_facility.id);
  perform internal.require_discipline(p_discipline_key);
  select * into v_period from internal.shift_period(p_shift_date, p_start_time, p_end_time, v_location.timezone);
  if v_period.end_at <= now() then
    raise exception 'shift must end in the future' using errcode = 'CH400';
  end if;

  if not internal.consume_rate_limit('shift.request:' || v_facility.linked_facility_organisation_id, 500, interval '1 day') then
    raise exception 'too many requests submitted' using errcode = 'CH429';
  end if;

  insert into public.shifts as s (
    agency_organisation_id, agency_facility_id, relationship_id, facility_location_id, discipline_key,
    start_at, end_at, timezone, requested_headcount, status, source, external_reference, instructions,
    created_by_organisation_id, created_by_membership_id, created_by_profile_id
  ) values (
    v_facility.agency_organisation_id, v_facility.id, v_relationship.id, v_location.id, p_discipline_key,
    v_period.start_at, v_period.end_at, v_location.timezone, p_requested_headcount, 'submitted', 'facility',
    internal.clean_text(p_external_reference), internal.clean_text(p_instructions),
    v_facility.linked_facility_organisation_id,
    internal.active_membership_id(v_facility.linked_facility_organisation_id), v_profile_id
  )
  returning s.id into v_shift_id;

  -- Audited on both sides of the relationship.
  perform internal.record_audit_event('shift.submitted', v_facility.linked_facility_organisation_id, 'shift',
    v_shift_id, jsonb_build_object('relationship_id', v_relationship.id));
  perform internal.record_audit_event('shift.submitted', v_facility.agency_organisation_id, 'shift',
    v_shift_id, jsonb_build_object('relationship_id', v_relationship.id, 'source', 'facility'));
  perform internal.enqueue_notification('facility_request_submitted', v_facility.agency_organisation_id, null,
    v_facility.agency_organisation_id, 'shift', v_shift_id);
  return v_shift_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Agency: open a draft or a facility request
-- -----------------------------------------------------------------------------
create function public.open_shift(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  s public.shifts := internal.agency_shift(p_shift_id, 'shift.manage', true);
  v_linked uuid;
begin
  if s.status not in ('draft', 'submitted') then
    raise exception 'only draft or submitted shifts can be opened' using errcode = 'CH409';
  end if;
  perform internal.require_active_relationship(s.relationship_id);
  perform internal.require_shift_location(s.facility_location_id, s.agency_facility_id);
  if s.end_at <= now() then
    raise exception 'shift has already ended' using errcode = 'CH409';
  end if;

  update public.shifts x set status = 'open', opened_at = now(), opened_by_profile_id = v_profile_id
  where x.id = s.id;

  perform internal.record_audit_event('shift.opened', s.agency_organisation_id, 'shift', s.id,
    jsonb_build_object('source', s.source));
  if s.source = 'facility' then
    select f.linked_facility_organisation_id into v_linked from public.agency_facilities f where f.id = s.agency_facility_id;
    if v_linked is not null then
      perform internal.enqueue_notification('facility_request_opened', s.agency_organisation_id, null, v_linked,
        'shift', s.id);
    end if;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Agency: update a shift. Full replacement of the editable fields. Scheduling
-- identity (location, discipline, date/times) can change only before opening.
-- -----------------------------------------------------------------------------
create function public.update_shift(
  p_shift_id uuid,
  p_facility_location_id uuid,
  p_discipline_key text,
  p_shift_date date,
  p_start_time time,
  p_end_time time,
  p_requested_headcount integer,
  p_instructions text,
  p_external_reference text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts := internal.agency_shift(p_shift_id, 'shift.manage', true);
  v_location public.facility_locations;
  v_period record;
  v_fields text[] := '{}'::text[];
begin
  if s.status in ('cancelled', 'completed') then
    raise exception 'shift is closed' using errcode = 'CHS09';
  end if;

  v_location := internal.require_shift_location(p_facility_location_id, s.agency_facility_id);
  perform internal.require_discipline(p_discipline_key);
  select * into v_period from internal.shift_period(p_shift_date, p_start_time, p_end_time, v_location.timezone);

  if v_location.id <> s.facility_location_id then v_fields := v_fields || 'facility_location_id'::text; end if;
  if p_discipline_key <> s.discipline_key then v_fields := v_fields || 'discipline_key'::text; end if;
  if v_period.start_at <> s.start_at or v_period.end_at <> s.end_at then v_fields := v_fields || 'times'::text; end if;

  if s.status = 'open' and cardinality(v_fields) > 0 then
    raise exception 'scheduling details cannot change once a shift is open' using errcode = 'CH409';
  end if;
  if 'times' = any (v_fields) and v_period.end_at <= now() then
    raise exception 'shift must end in the future' using errcode = 'CH400';
  end if;

  if p_requested_headcount is distinct from s.requested_headcount then
    v_fields := v_fields || 'requested_headcount'::text;
  end if;
  if internal.clean_text(p_instructions) is distinct from s.instructions then
    v_fields := v_fields || 'instructions'::text;
  end if;
  if internal.clean_text(p_external_reference) is distinct from s.external_reference then
    v_fields := v_fields || 'external_reference'::text;
  end if;
  if cardinality(v_fields) = 0 then
    return;
  end if;

  update public.shifts x set
    facility_location_id = v_location.id,
    timezone = v_location.timezone,
    discipline_key = p_discipline_key,
    start_at = v_period.start_at,
    end_at = v_period.end_at,
    requested_headcount = p_requested_headcount,
    instructions = internal.clean_text(p_instructions),
    external_reference = internal.clean_text(p_external_reference)
  where x.id = s.id;

  perform internal.record_audit_event('shift.updated', s.agency_organisation_id, 'shift', s.id,
    jsonb_build_object('fields', to_jsonb(v_fields)));
end;
$$;

-- -----------------------------------------------------------------------------
-- Cancel a shift (agency), or withdraw a still-submitted request (facility).
-- Active assignments are cancelled with reason shift_cancelled.
-- -----------------------------------------------------------------------------
create function public.cancel_shift(p_shift_id uuid, p_reason public.shift_cancellation_reason)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  s public.shifts;
  v_linked uuid;
  v_actor_org uuid;
  v_assignment record;
  v_cancelled integer := 0;
begin
  if p_reason is null then
    raise exception 'a cancellation reason is required' using errcode = 'CH400';
  end if;
  select * into s from public.shifts x where x.id = p_shift_id;
  if s.id is null then
    raise exception 'shift not found' using errcode = 'CHS04';
  end if;
  select f.linked_facility_organisation_id into v_linked from public.agency_facilities f where f.id = s.agency_facility_id;

  if authz.has_capability(s.agency_organisation_id, 'shift.view') then
    perform internal.require_capability(s.agency_organisation_id, 'shift.manage');
    v_actor_org := s.agency_organisation_id;
  elsif s.status <> 'draft' and authz.has_relationship_capability(s.relationship_id, 'shift.view') then
    -- A facility may withdraw only its OWN request, and only before it is opened.
    if not authz.has_relationship_capability(s.relationship_id, 'shift.request') then
      raise exception 'not permitted' using errcode = 'CH403';
    end if;
    if s.source <> 'facility' or s.status <> 'submitted' then
      raise exception 'only a submitted request can be withdrawn by the facility' using errcode = 'CH409';
    end if;
    if p_reason <> 'facility_cancelled' then
      raise exception 'facility withdrawals use reason facility_cancelled' using errcode = 'CH400';
    end if;
    v_actor_org := v_linked;
  else
    raise exception 'shift not found' using errcode = 'CHS04';
  end if;

  select * into s from public.shifts x where x.id = p_shift_id for update;
  if s.status in ('cancelled', 'completed') then
    raise exception 'shift is closed' using errcode = 'CHS09';
  end if;

  for v_assignment in
    update public.shift_assignments a
       set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'shift_cancelled',
           cancelled_by_profile_id = v_profile_id
     where a.shift_id = s.id and a.status in ('assigned', 'accepted')
    returning a.id, a.profile_id
  loop
    v_cancelled := v_cancelled + 1;
    perform internal.enqueue_notification('shift_cancelled', s.agency_organisation_id, v_assignment.profile_id, null,
      'shift_assignment', v_assignment.id);
  end loop;

  update public.shifts x
     set status = 'cancelled', cancelled_at = now(), cancellation_reason = p_reason, cancelled_by_profile_id = v_profile_id
   where x.id = s.id;

  perform internal.record_audit_event('shift.cancelled', v_actor_org, 'shift', s.id,
    jsonb_build_object('reason', p_reason, 'cancelled_assignments', v_cancelled));
  if v_actor_org <> s.agency_organisation_id then
    perform internal.record_audit_event('shift.cancelled', s.agency_organisation_id, 'shift', s.id,
      jsonb_build_object('reason', p_reason, 'by', 'facility'));
  elsif v_linked is not null and s.status <> 'draft' then
    perform internal.enqueue_notification('shift_cancelled', s.agency_organisation_id, null, v_linked, 'shift', s.id);
  end if;
end;
$$;

create function public.complete_shift(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts := internal.agency_shift(p_shift_id, 'shift.manage', true);
begin
  if s.status <> 'open' then
    raise exception 'only open shifts can be completed' using errcode = 'CHS09';
  end if;
  if s.end_at > now() then
    raise exception 'a shift can be completed only after it ends' using errcode = 'CH409';
  end if;
  update public.shifts x set status = 'completed', completed_at = now() where x.id = s.id;
  perform internal.record_audit_event('shift.completed', s.agency_organisation_id, 'shift', s.id, '{}'::jsonb);
end;
$$;

create function public.add_shift_internal_note(p_shift_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  s public.shifts := internal.agency_shift(p_shift_id, 'shift.manage', false);
  v_note_id uuid;
begin
  insert into public.shift_internal_notes as n (agency_organisation_id, shift_id, author_profile_id, body)
  values (s.agency_organisation_id, s.id, v_profile_id, btrim(p_body))
  returning n.id into v_note_id;
  -- The note text is never copied into audit metadata.
  perform internal.record_audit_event('shift.internal_note_added', s.agency_organisation_id, 'shift', s.id,
    jsonb_build_object('note_id', v_note_id));
  return v_note_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Agency shift list with DERIVED fill state.
-- -----------------------------------------------------------------------------
create function public.list_agency_shifts(
  p_organisation_id uuid,
  p_status public.shift_status default null,
  p_agency_facility_id uuid default null,
  p_from date default null,
  p_to date default null
)
returns table (
  shift_id uuid,
  agency_facility_id uuid,
  facility_name text,
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
  relationship_status public.relationship_status,
  external_reference text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'shift.view');
  return query
    select s.id, s.agency_facility_id, f.name, l.name, s.discipline_key, d.name, s.start_at, s.end_at, s.timezone,
           s.requested_headcount, c.active, c.accepted,
           case when c.active = 0 then 'unfilled' when c.active < s.requested_headcount then 'partially_filled'
                else 'filled' end,
           s.status, s.source, r.status, s.external_reference
    from public.shifts s
    join public.agency_facilities f on f.id = s.agency_facility_id
    join public.facility_locations l on l.id = s.facility_location_id
    join public.disciplines d on d.key = s.discipline_key
    join public.agency_facility_relationships r on r.id = s.relationship_id
    cross join lateral (
      select count(*) filter (where a.status in ('assigned', 'accepted'))::integer as active,
             count(*) filter (where a.status = 'accepted')::integer as accepted
      from public.shift_assignments a where a.shift_id = s.id
    ) c
    where s.agency_organisation_id = p_organisation_id
      and (p_status is null or s.status = p_status)
      and (p_agency_facility_id is null or s.agency_facility_id = p_agency_facility_id)
      and (p_from is null or (s.start_at at time zone s.timezone)::date >= p_from)
      and (p_to is null or (s.start_at at time zone s.timezone)::date <= p_to)
    order by s.start_at, s.id
    limit 500;
end;
$$;

revoke all on function
  internal.local_to_instant(date, time, text),
  internal.shift_period(date, time, time, text),
  internal.shift_local_dates(timestamptz, timestamptz, text),
  internal.agency_shift(uuid, text, boolean),
  internal.require_shift_location(uuid, uuid),
  internal.require_discipline(text),
  internal.require_active_relationship(uuid),
  internal.active_membership_id(uuid),
  internal.clean_text(text)
from public, anon, authenticated;

revoke all on function
  public.create_shift(uuid, uuid, text, date, time, time, integer, text, text, boolean),
  public.submit_facility_shift_request(uuid, uuid, text, date, time, time, integer, text, text),
  public.open_shift(uuid),
  public.update_shift(uuid, uuid, text, date, time, time, integer, text, text),
  public.cancel_shift(uuid, public.shift_cancellation_reason),
  public.complete_shift(uuid),
  public.add_shift_internal_note(uuid, text),
  public.list_agency_shifts(uuid, public.shift_status, uuid, date, date)
from public, anon;

grant execute on function
  public.create_shift(uuid, uuid, text, date, time, time, integer, text, text, boolean),
  public.submit_facility_shift_request(uuid, uuid, text, date, time, time, integer, text, text),
  public.open_shift(uuid),
  public.update_shift(uuid, uuid, text, date, time, time, integer, text, text),
  public.cancel_shift(uuid, public.shift_cancellation_reason),
  public.complete_shift(uuid),
  public.add_shift_internal_note(uuid, text),
  public.list_agency_shifts(uuid, public.shift_status, uuid, date, date)
to authenticated;
