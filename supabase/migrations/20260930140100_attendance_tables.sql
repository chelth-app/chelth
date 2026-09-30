-- =============================================================================
-- Migration: attendance_tables
-- Stage:     P0-E6-S1
--
-- Purpose
--   agency_attendance_settings   timing rules per agency (defaults if absent)
--   location_geofences           OPTIONAL geofence per facility location
--   assignment_attendance        one row per assignment; SUMMARY PROJECTION
--                                of events (maintained only by
--                                internal.refresh_attendance)
--   attendance_events            APPEND-ONLY source of truth. Clock events
--                                carry server time only; corrections append
--                                corrected_* events and never rewrite history
--   attendance_location_evidence RESTRICTED raw coordinates, captured only at
--                                an explicit clock action and only when the
--                                location's geofence is enabled
--   attendance_exceptions        explicit operational problems (codes)
--   attendance_corrections       worker requests → agency review
--
--   Docs: docs/architecture/ATTENDANCE_DOMAIN_MODEL.md, ATTENDANCE_EVENT_MODEL.md,
--   GEOFENCE_MODEL.md, ATTENDANCE_CORRECTIONS.md,
--   docs/security/ATTENDANCE_LOCATION_PRIVACY.md.
--
-- Verified by: supabase/tests/security/170_attendance.test.sql,
--              180_attendance_review.test.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Timing rules (defaults documented in ATTENDANCE_DOMAIN_MODEL.md §4)
-- -----------------------------------------------------------------------------
create table public.agency_attendance_settings (
  agency_organisation_id uuid primary key,
  agency_organisation_type public.organisation_type not null default 'agency'
    check (agency_organisation_type = 'agency'),
  early_clock_in_minutes integer not null default 30 check (early_clock_in_minutes between 0 and 240),
  late_clock_in_minutes integer not null default 5 check (late_clock_in_minutes between 0 and 120),
  early_clock_out_minutes integer not null default 15 check (early_clock_out_minutes between 0 and 240),
  late_clock_out_minutes integer not null default 30 check (late_clock_out_minutes between 0 and 240),
  missed_clock_in_minutes integer not null default 15 check (missed_clock_in_minutes between 5 and 240),
  missed_clock_out_minutes integer not null default 60 check (missed_clock_out_minutes between 15 and 720),
  clock_out_cutoff_minutes integer not null default 240
    check (clock_out_cutoff_minutes between 60 and 1440),
  updated_by_profile_id uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (agency_organisation_id, agency_organisation_type)
    references public.organisations (id, type) on delete restrict,
  check (missed_clock_out_minutes <= clock_out_cutoff_minutes)
);

create trigger agency_attendance_settings_set_updated_at
  before update on public.agency_attendance_settings
  for each row execute function internal.set_updated_at();

alter table public.agency_attendance_settings enable row level security;
grant select on public.agency_attendance_settings to authenticated;
create policy agency_attendance_settings_select on public.agency_attendance_settings
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'attendance.view'));

-- -----------------------------------------------------------------------------
-- Optional geofence per facility location (facility coordinates are not
-- personal data; worker coordinates live in attendance_location_evidence)
-- -----------------------------------------------------------------------------
create table public.location_geofences (
  facility_location_id uuid primary key,
  agency_facility_id uuid not null,
  agency_organisation_id uuid not null,
  enabled boolean not null default false,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_meters integer not null check (radius_meters between 50 and 2000),
  max_accuracy_meters integer not null default 100 check (max_accuracy_meters between 10 and 500),
  outside_policy public.geofence_outside_policy not null default 'allow_with_review',
  updated_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (facility_location_id, agency_facility_id)
    references public.facility_locations (id, agency_facility_id) on delete restrict,
  foreign key (agency_facility_id, agency_organisation_id)
    references public.agency_facilities (id, agency_organisation_id) on delete restrict
);

create trigger location_geofences_set_updated_at
  before update on public.location_geofences
  for each row execute function internal.set_updated_at();
create trigger location_geofences_ownership_immutable
  before update on public.location_geofences
  for each row execute function internal.enforce_immutable_columns(
    'facility_location_id', 'agency_facility_id', 'agency_organisation_id', 'created_at');

alter table public.location_geofences enable row level security;
grant select on public.location_geofences to authenticated;
create policy location_geofences_select on public.location_geofences
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'facility.view'));

-- -----------------------------------------------------------------------------
-- Attendance summary (projection)
-- -----------------------------------------------------------------------------
create table public.assignment_attendance (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique,
  agency_organisation_id uuid not null,
  shift_id uuid not null,
  agency_worker_id uuid not null,
  profile_id uuid not null,
  agency_facility_id uuid not null,
  facility_location_id uuid not null,
  clock_state public.attendance_clock_state not null default 'not_started',
  -- Effective times: latest corrected_* event, else the device event.
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  open_exception_count integer not null default 0 check (open_exception_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (assignment_id, agency_organisation_id, shift_id, agency_worker_id, profile_id)
    references public.shift_assignments (id, agency_organisation_id, shift_id, agency_worker_id, profile_id)
    on delete restrict,
  foreign key (shift_id, agency_organisation_id, agency_facility_id, facility_location_id)
    references public.shifts (id, agency_organisation_id, agency_facility_id, facility_location_id)
    on delete restrict,
  unique (id, agency_organisation_id),
  unique (id, assignment_id),
  check ((clock_state = 'not_started') = (clock_in_at is null)),
  check ((clock_state = 'clocked_out') = (clock_out_at is not null)),
  check (clock_out_at is null or clock_out_at >= clock_in_at)
);

comment on table public.assignment_attendance is
  'Attendance summary per assignment: a projection of attendance_events, maintained only by internal.refresh_attendance.';

create index assignment_attendance_agency_idx on public.assignment_attendance (agency_organisation_id, clock_state);
create index assignment_attendance_shift_idx on public.assignment_attendance (shift_id);

create trigger assignment_attendance_set_updated_at
  before update on public.assignment_attendance
  for each row execute function internal.set_updated_at();
create trigger assignment_attendance_ownership_immutable
  before update on public.assignment_attendance
  for each row execute function internal.enforce_immutable_columns(
    'assignment_id', 'agency_organisation_id', 'shift_id', 'agency_worker_id', 'profile_id',
    'agency_facility_id', 'facility_location_id', 'created_at');

alter table public.assignment_attendance enable row level security;
grant select on public.assignment_attendance to authenticated;
create policy assignment_attendance_select on public.assignment_attendance
  for select to authenticated
  using (
    authz.has_capability(agency_organisation_id, 'attendance.view')
    or authz.is_own_active_worker(agency_worker_id)
  );

-- -----------------------------------------------------------------------------
-- Events: append-only source of truth
-- -----------------------------------------------------------------------------
create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null,
  assignment_id uuid not null,
  agency_organisation_id uuid not null,
  event_type public.attendance_event_type not null,
  -- Future breaks/split shifts add segments without a schema rewrite.
  segment smallint not null default 1 check (segment between 1 and 20),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  source public.attendance_event_source not null,
  geofence_result public.geofence_result not null default 'not_required',
  actor_profile_id uuid references public.profiles (id) on delete set null,
  correction_id uuid,
  sequence bigint generated always as identity,
  foreign key (attendance_id, assignment_id)
    references public.assignment_attendance (id, assignment_id) on delete restrict,
  foreign key (attendance_id, agency_organisation_id)
    references public.assignment_attendance (id, agency_organisation_id) on delete restrict,
  unique (id, attendance_id),
  -- Device clock events are server-timed: the event time IS the record time.
  check (event_type not in ('clock_in', 'clock_out') or occurred_at = recorded_at),
  check ((source = 'approved_correction') = (event_type in ('corrected_clock_in', 'corrected_clock_out'))),
  check ((source = 'approved_correction') = (correction_id is not null))
);

comment on table public.attendance_events is
  'Append-only attendance events. Device clock events use server time; approved corrections append corrected_* events.';

-- Exactly one device clock-in and one device clock-out per segment.
create unique index attendance_events_one_clock_in
  on public.attendance_events (attendance_id, segment) where event_type = 'clock_in';
create unique index attendance_events_one_clock_out
  on public.attendance_events (attendance_id, segment) where event_type = 'clock_out';
create index attendance_events_attendance_idx on public.attendance_events (attendance_id, sequence);

create trigger attendance_events_append_only
  before update or delete on public.attendance_events
  for each row execute function internal.refuse_update_delete();

create trigger attendance_events_no_truncate
  before truncate on public.attendance_events
  for each statement execute function internal.refuse_update_delete();

alter table public.attendance_events enable row level security;
grant select on public.attendance_events to authenticated;
create policy attendance_events_select on public.attendance_events
  for select to authenticated
  using (
    authz.has_capability(agency_organisation_id, 'attendance.view')
    or exists (select 1 from public.assignment_attendance a
               where a.id = attendance_events.attendance_id and authz.is_own_active_worker(a.agency_worker_id))
  );

-- -----------------------------------------------------------------------------
-- Raw location evidence: restricted (attendance.location.view, AAL2)
-- -----------------------------------------------------------------------------
create table public.attendance_location_evidence (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique,
  attendance_id uuid not null,
  agency_organisation_id uuid not null,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  accuracy_meters double precision check (accuracy_meters between 0 and 100000),
  device_captured_at timestamptz,
  distance_meters double precision check (distance_meters >= 0),
  radius_meters integer not null,
  result public.geofence_result not null check (result <> 'not_required'),
  recorded_at timestamptz not null default now(),
  foreign key (event_id, attendance_id)
    references public.attendance_events (id, attendance_id) on delete restrict,
  foreign key (attendance_id, agency_organisation_id)
    references public.assignment_attendance (id, agency_organisation_id) on delete restrict,
  check ((latitude is null) = (longitude is null)),
  check ((result = 'unavailable') = (latitude is null))
);

create trigger attendance_location_evidence_append_only
  before update or delete on public.attendance_location_evidence
  for each row execute function internal.refuse_update_delete();

create trigger attendance_location_evidence_no_truncate
  before truncate on public.attendance_location_evidence
  for each statement execute function internal.refuse_update_delete();

alter table public.attendance_location_evidence enable row level security;
grant select on public.attendance_location_evidence to authenticated;
create policy attendance_location_evidence_select on public.attendance_location_evidence
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'attendance.location.view'));

-- -----------------------------------------------------------------------------
-- Exceptions
-- -----------------------------------------------------------------------------
create table public.attendance_exceptions (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null,
  assignment_id uuid not null,
  agency_organisation_id uuid not null,
  exception_type public.attendance_exception_type not null,
  severity public.assignment_issue_severity not null,
  status public.attendance_exception_status not null default 'open',
  detected_by public.attendance_exception_source not null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution public.attendance_exception_resolution,
  reviewer_membership_id uuid,
  foreign key (attendance_id, assignment_id)
    references public.assignment_attendance (id, assignment_id) on delete restrict,
  foreign key (attendance_id, agency_organisation_id)
    references public.assignment_attendance (id, agency_organisation_id) on delete restrict,
  foreign key (reviewer_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  check ((status in ('resolved', 'dismissed')) = (resolved_at is not null and resolution is not null))
);

create unique index attendance_exceptions_one_open
  on public.attendance_exceptions (attendance_id, exception_type) where status in ('open', 'under_review');
create index attendance_exceptions_agency_open_idx
  on public.attendance_exceptions (agency_organisation_id, opened_at desc) where status in ('open', 'under_review');

create trigger attendance_exceptions_ownership_immutable
  before update on public.attendance_exceptions
  for each row execute function internal.enforce_immutable_columns(
    'attendance_id', 'assignment_id', 'agency_organisation_id', 'exception_type', 'detected_by', 'opened_at');
create trigger attendance_exceptions_no_delete
  before delete on public.attendance_exceptions
  for each row execute function internal.refuse_update_delete();

create function internal.enforce_attendance_exception_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('resolved', 'dismissed') then
    raise exception 'closed exceptions are immutable' using errcode = 'CH409';
  end if;
  return new;
end;
$$;

create trigger attendance_exceptions_transition
  before update on public.attendance_exceptions
  for each row execute function internal.enforce_attendance_exception_transition();

create trigger attendance_exceptions_no_truncate
  before truncate on public.attendance_exceptions
  for each statement execute function internal.refuse_update_delete();

alter table public.attendance_exceptions enable row level security;
grant select on public.attendance_exceptions to authenticated;
create policy attendance_exceptions_select on public.attendance_exceptions
  for select to authenticated
  using (
    authz.has_capability(agency_organisation_id, 'attendance.view')
    or exists (select 1 from public.assignment_attendance a
               where a.id = attendance_exceptions.attendance_id and authz.is_own_active_worker(a.agency_worker_id))
  );

-- -----------------------------------------------------------------------------
-- Corrections
-- -----------------------------------------------------------------------------
create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null,
  assignment_id uuid not null,
  agency_organisation_id uuid not null,
  requested_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  requested_event_type public.attendance_event_type not null check (requested_event_type in ('clock_in', 'clock_out')),
  requested_time timestamptz not null,
  reason public.attendance_correction_reason not null,
  worker_note text check (worker_note is null or char_length(btrim(worker_note)) between 1 and 500),
  status public.attendance_correction_status not null default 'pending',
  reviewed_by_membership_id uuid,
  reviewed_at timestamptz,
  resolution public.attendance_correction_resolution,
  requested_at timestamptz not null default now(),
  foreign key (attendance_id, assignment_id)
    references public.assignment_attendance (id, assignment_id) on delete restrict,
  foreign key (attendance_id, agency_organisation_id)
    references public.assignment_attendance (id, agency_organisation_id) on delete restrict,
  foreign key (reviewed_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  unique (id, attendance_id),
  check ((status = 'pending') = (reviewed_at is null and resolution is null and reviewed_by_membership_id is null)),
  check (status <> 'approved' or resolution = 'approved_as_requested'),
  check (status <> 'rejected' or resolution <> 'approved_as_requested')
);

create unique index attendance_corrections_one_pending
  on public.attendance_corrections (attendance_id, requested_event_type) where status = 'pending';

alter table public.attendance_events
  add constraint attendance_events_correction_fk
  foreign key (correction_id, attendance_id) references public.attendance_corrections (id, attendance_id)
  on delete restrict;

create trigger attendance_corrections_ownership_immutable
  before update on public.attendance_corrections
  for each row execute function internal.enforce_immutable_columns(
    'attendance_id', 'assignment_id', 'agency_organisation_id', 'requested_by_profile_id',
    'requested_event_type', 'requested_time', 'reason', 'worker_note', 'requested_at');
create trigger attendance_corrections_no_delete
  before delete on public.attendance_corrections
  for each row execute function internal.refuse_update_delete();

create function internal.enforce_correction_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'pending' then
    raise exception 'correction already reviewed' using errcode = 'CHT17';
  end if;
  return new;
end;
$$;

create trigger attendance_corrections_transition
  before update on public.attendance_corrections
  for each row execute function internal.enforce_correction_transition();

create trigger attendance_corrections_no_truncate
  before truncate on public.attendance_corrections
  for each statement execute function internal.refuse_update_delete();

alter table public.attendance_corrections enable row level security;
grant select on public.attendance_corrections to authenticated;
create policy attendance_corrections_select on public.attendance_corrections
  for select to authenticated
  using (
    authz.has_capability(agency_organisation_id, 'attendance.view')
    or exists (select 1 from public.assignment_attendance a
               where a.id = attendance_corrections.attendance_id and authz.is_own_active_worker(a.agency_worker_id))
  );

revoke all on function
  internal.enforce_attendance_exception_transition(),
  internal.enforce_correction_transition()
from public, anon, authenticated;
