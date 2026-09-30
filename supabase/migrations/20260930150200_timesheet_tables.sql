-- =============================================================================
-- Migration: timesheet_tables
-- Stage:     P0-E6-S2
--
-- Purpose
--   Timesheets SUMMARISE attendance; they are never a second clock.
--
--   agency_timesheet_settings   weekly periods; week_starts_on (ISO 1=Mon … 7=Sun)
--   timesheets                  agency + worker + period; lifecycle + revision
--   timesheet_entries           one per assignment; every time column is DERIVED
--                               (internal.sync_timesheet_entry only, guarded by
--                               a trigger) and frozen while approved/locked
--   timesheet_approvals         immutable approval snapshots (per revision)
--   timesheet_facility_signoffs per-entry facility decisions (sign-off/dispute)
--   timesheet_history           append-only lifecycle log
--
--   No pay, bill, rate, overtime or money column exists anywhere.
--
-- Verified by: supabase/tests/security/190_timesheets.test.sql
-- =============================================================================

create table public.agency_timesheet_settings (
  agency_organisation_id uuid primary key,
  agency_organisation_type public.organisation_type not null default 'agency'
    check (agency_organisation_type = 'agency'),
  week_starts_on smallint not null default 1 check (week_starts_on between 1 and 7),
  updated_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_organisation_id, agency_organisation_type)
    references public.organisations (id, type) on delete restrict
);

create trigger agency_timesheet_settings_set_updated_at
  before update on public.agency_timesheet_settings
  for each row execute function internal.set_updated_at();

alter table public.agency_timesheet_settings enable row level security;
grant select on public.agency_timesheet_settings to authenticated;
create policy agency_timesheet_settings_select on public.agency_timesheet_settings
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'timesheet.view'));

-- -----------------------------------------------------------------------------
-- Timesheets
-- -----------------------------------------------------------------------------
create table public.timesheets (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  agency_worker_id uuid not null,
  profile_id uuid not null,
  period_start date not null,
  period_end date not null,
  status public.timesheet_status not null default 'open',
  revision integer not null default 1 check (revision between 1 and 1000),
  submitted_at timestamptz,
  submitted_by_profile_id uuid references public.profiles (id) on delete restrict,
  agency_approved_at timestamptz,
  agency_approved_by_membership_id uuid,
  locked_at timestamptz,
  rejected_at timestamptz,
  rejection_reason public.timesheet_rejection_reason,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_worker_id, agency_organisation_id, profile_id)
    references public.agency_workers (id, agency_organisation_id, profile_id) on delete restrict,
  foreign key (agency_approved_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  unique (agency_worker_id, period_start),
  unique (id, agency_organisation_id),
  unique (id, agency_organisation_id, agency_worker_id, profile_id),
  check (period_end = period_start + 6),
  check (status not in ('submitted', 'agency_approved', 'locked') or submitted_at is not null),
  check ((status in ('agency_approved', 'locked'))
         = (agency_approved_at is not null and agency_approved_by_membership_id is not null)),
  check ((status = 'locked') = (locked_at is not null)),
  check ((status = 'rejected') = (rejected_at is not null and rejection_reason is not null)),
  check (submitted_by_profile_id is null or submitted_by_profile_id = profile_id)
);

create index timesheets_agency_period_idx on public.timesheets (agency_organisation_id, period_start desc, status);
create index timesheets_profile_idx on public.timesheets (profile_id, period_start desc);

create trigger timesheets_set_updated_at
  before update on public.timesheets
  for each row execute function internal.set_updated_at();
create trigger timesheets_ownership_immutable
  before update on public.timesheets
  for each row execute function internal.enforce_immutable_columns(
    'agency_organisation_id', 'agency_worker_id', 'profile_id', 'period_start', 'period_end', 'created_at');
create trigger timesheets_no_delete
  before delete on public.timesheets
  for each row execute function internal.refuse_update_delete();
create trigger timesheets_no_truncate
  before truncate on public.timesheets
  for each statement execute function internal.refuse_update_delete();

-- Lifecycle. Leaving an approved state always creates a new revision.
create function internal.enforce_timesheet_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    if new.revision <> old.revision then
      raise exception 'revision changes only with a lifecycle transition' using errcode = 'CH409';
    end if;
    return new;
  end if;
  if (old.status, new.status) in (
       ('open', 'submitted'), ('rejected', 'submitted'),
       ('submitted', 'rejected'), ('submitted', 'agency_approved'),
       ('agency_approved', 'locked')) then
    if new.revision <> old.revision then
      raise exception 'revision changes only when an approval is superseded' using errcode = 'CH409';
    end if;
    return new;
  end if;
  if old.status in ('agency_approved', 'locked') and new.status in ('open', 'submitted')
     and new.revision = old.revision + 1 then
    return new;
  end if;
  raise exception 'invalid timesheet transition % → %', old.status, new.status using errcode = 'CHP09';
end;
$$;

create trigger timesheets_transition
  before update on public.timesheets
  for each row execute function internal.enforce_timesheet_transition();

alter table public.timesheets enable row level security;
grant select on public.timesheets to authenticated;
create policy timesheets_select on public.timesheets
  for select to authenticated
  using (
    authz.has_capability(agency_organisation_id, 'timesheet.view')
    or authz.is_own_active_worker(agency_worker_id)
  );

-- -----------------------------------------------------------------------------
-- Entries (derived)
-- -----------------------------------------------------------------------------
create table public.timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  timesheet_id uuid not null,
  agency_organisation_id uuid not null,
  agency_worker_id uuid not null,
  profile_id uuid not null,
  assignment_id uuid not null unique,
  shift_id uuid not null,
  relationship_id uuid not null,
  agency_facility_id uuid not null,
  facility_location_id uuid not null,
  facility_organisation_id uuid,
  local_date date not null,
  timezone text not null,
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz not null,
  attendance_id uuid,
  -- Derived (internal.sync_timesheet_entry only).
  included boolean not null default true,
  effective_start_at timestamptz,
  effective_end_at timestamptz,
  breaks jsonb not null default '[]'::jsonb check (jsonb_typeof(breaks) = 'array'),
  break_minutes integer check (break_minutes >= 0),
  worked_minutes integer check (worked_minutes >= 0),
  not_worked boolean not null default false,
  complete boolean not null default false,
  blocking_reasons text[] not null default '{}',
  open_exception_types text[] not null default '{}',
  pending_corrections integer not null default 0 check (pending_corrections >= 0),
  calculation_version smallint not null default 1,
  calculated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision >= 1),
  facility_state public.timesheet_facility_state not null default 'not_required',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (timesheet_id, agency_organisation_id, agency_worker_id, profile_id)
    references public.timesheets (id, agency_organisation_id, agency_worker_id, profile_id) on delete restrict,
  foreign key (assignment_id, agency_organisation_id, shift_id, agency_worker_id, profile_id)
    references public.shift_assignments (id, agency_organisation_id, shift_id, agency_worker_id, profile_id)
    on delete restrict,
  foreign key (shift_id, agency_organisation_id, relationship_id, agency_facility_id, facility_location_id)
    references public.shifts (id, agency_organisation_id, relationship_id, agency_facility_id, facility_location_id)
    on delete restrict,
  foreign key (agency_facility_id, facility_organisation_id)
    references public.agency_facilities (id, linked_facility_organisation_id) on delete restrict,
  foreign key (attendance_id, assignment_id)
    references public.assignment_attendance (id, assignment_id) on delete restrict,
  unique (id, timesheet_id),
  unique (id, agency_organisation_id),
  unique (id, timesheet_id, relationship_id, agency_facility_id, facility_organisation_id),
  check (scheduled_end_at > scheduled_start_at),
  check (effective_end_at is null or (effective_start_at is not null and effective_end_at >= effective_start_at)),
  check (not complete or worked_minutes is not null),
  check (not not_worked or (worked_minutes = 0 and effective_start_at is null)),
  check (facility_state = 'not_required' or facility_organisation_id is not null)
);

create index timesheet_entries_timesheet_idx on public.timesheet_entries (timesheet_id, local_date);
create index timesheet_entries_facility_idx
  on public.timesheet_entries (facility_organisation_id, facility_state) where facility_organisation_id is not null;

create trigger timesheet_entries_set_updated_at
  before update on public.timesheet_entries
  for each row execute function internal.set_updated_at();
create trigger timesheet_entries_ownership_immutable
  before update on public.timesheet_entries
  for each row execute function internal.enforce_immutable_columns(
    'timesheet_id', 'agency_organisation_id', 'agency_worker_id', 'profile_id', 'assignment_id', 'shift_id',
    'relationship_id', 'agency_facility_id', 'facility_location_id', 'local_date', 'created_at');
create trigger timesheet_entries_no_delete
  before delete on public.timesheet_entries
  for each row execute function internal.refuse_update_delete();
create trigger timesheet_entries_no_truncate
  before truncate on public.timesheet_entries
  for each statement execute function internal.refuse_update_delete();

-- Source-of-truth guard: derived values are written only by the trusted
-- calculation (transaction-local flag set by internal functions), and time
-- values are frozen while the parent timesheet is approved or locked.
create function internal.guard_timesheet_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.timesheet_status;
begin
  if coalesce(current_setting('chelth.timesheet_write', true), '') <> 'on' then
    raise exception 'timesheet entries are derived from attendance' using errcode = 'CH409';
  end if;
  if tg_op = 'UPDATE'
     and (new.included, new.effective_start_at, new.effective_end_at, new.breaks, new.break_minutes,
          new.worked_minutes, new.not_worked)
         is distinct from
         (old.included, old.effective_start_at, old.effective_end_at, old.breaks, old.break_minutes,
          old.worked_minutes, old.not_worked) then
    select t.status into v_status from public.timesheets t where t.id = new.timesheet_id;
    if v_status in ('agency_approved', 'locked') then
      raise exception 'approved timesheet entries change only through a new revision' using errcode = 'CHP09';
    end if;
  end if;
  return new;
end;
$$;

create trigger timesheet_entries_guard
  before insert or update on public.timesheet_entries
  for each row execute function internal.guard_timesheet_entry();

alter table public.timesheet_entries enable row level security;
grant select on public.timesheet_entries to authenticated;
create policy timesheet_entries_select on public.timesheet_entries
  for select to authenticated
  using (
    authz.has_capability(agency_organisation_id, 'timesheet.view')
    or authz.is_own_active_worker(agency_worker_id)
  );

-- -----------------------------------------------------------------------------
-- Approval snapshots (immutable; superseded, never edited)
-- -----------------------------------------------------------------------------
create table public.timesheet_approvals (
  id uuid primary key default gen_random_uuid(),
  timesheet_id uuid not null,
  agency_organisation_id uuid not null,
  revision integer not null,
  approved_by_membership_id uuid not null,
  approved_at timestamptz not null default now(),
  entry_count integer not null check (entry_count >= 0),
  total_worked_minutes integer not null check (total_worked_minutes >= 0),
  total_break_minutes integer not null check (total_break_minutes >= 0),
  calculation_version smallint not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'array' and pg_column_size(snapshot) <= 262144),
  superseded_at timestamptz,
  foreign key (timesheet_id, agency_organisation_id)
    references public.timesheets (id, agency_organisation_id) on delete restrict,
  foreign key (approved_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  unique (timesheet_id, revision),
  check (superseded_at is null or superseded_at >= approved_at)
);

create function internal.enforce_supersede_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.superseded_at is null and new.superseded_at is not null
     and (to_jsonb(new) - 'superseded_at') = (to_jsonb(old) - 'superseded_at') then
    return new;
  end if;
  raise exception '% rows are immutable', tg_table_name using errcode = 'CH409';
end;
$$;

create trigger timesheet_approvals_supersede_only
  before update on public.timesheet_approvals
  for each row execute function internal.enforce_supersede_only();
create trigger timesheet_approvals_no_delete
  before delete on public.timesheet_approvals
  for each row execute function internal.refuse_update_delete();
create trigger timesheet_approvals_no_truncate
  before truncate on public.timesheet_approvals
  for each statement execute function internal.refuse_update_delete();

alter table public.timesheet_approvals enable row level security;
grant select on public.timesheet_approvals to authenticated;
create policy timesheet_approvals_select on public.timesheet_approvals
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'timesheet.view'));

-- -----------------------------------------------------------------------------
-- Facility decisions, per entry and revision
-- -----------------------------------------------------------------------------
create table public.timesheet_facility_signoffs (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null,
  timesheet_id uuid not null,
  agency_organisation_id uuid not null,
  relationship_id uuid not null,
  agency_facility_id uuid not null,
  facility_organisation_id uuid not null,
  revision integer not null,
  decision public.timesheet_facility_state not null check (decision in ('signed_off', 'disputed')),
  dispute_reason public.timesheet_dispute_reason,
  note text check (note is null or (char_length(btrim(note)) between 1 and 500)),
  decided_by_membership_id uuid not null,
  decided_at timestamptz not null default now(),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  resolved_at timestamptz,
  resolution public.timesheet_dispute_resolution,
  resolved_by_membership_id uuid,
  resolution_note text check (resolution_note is null or (char_length(btrim(resolution_note)) between 1 and 500)),
  superseded_at timestamptz,
  foreign key (entry_id, timesheet_id, relationship_id, agency_facility_id, facility_organisation_id)
    references public.timesheet_entries (id, timesheet_id, relationship_id, agency_facility_id, facility_organisation_id)
    on delete restrict,
  foreign key (timesheet_id, agency_organisation_id)
    references public.timesheets (id, agency_organisation_id) on delete restrict,
  foreign key (relationship_id, agency_organisation_id, agency_facility_id)
    references public.agency_facility_relationships (id, agency_organisation_id, agency_facility_id) on delete restrict,
  foreign key (agency_facility_id, facility_organisation_id)
    references public.agency_facilities (id, linked_facility_organisation_id) on delete restrict,
  foreign key (decided_by_membership_id, facility_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  foreign key (resolved_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  check ((decision = 'disputed') = (dispute_reason is not null)),
  check ((resolved_at is null) = (resolution is null)),
  check (resolution is null or decision = 'disputed'),
  check (resolved_by_membership_id is null or resolved_at is not null)
);

-- One live decision per entry and revision.
create unique index timesheet_facility_signoffs_one_live
  on public.timesheet_facility_signoffs (entry_id, revision)
  where superseded_at is null and resolved_at is null;
create index timesheet_facility_signoffs_facility_idx
  on public.timesheet_facility_signoffs (facility_organisation_id, decided_at desc);

create function internal.enforce_signoff_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fixed text[] := array['resolved_at', 'resolution', 'resolved_by_membership_id', 'resolution_note', 'superseded_at'];
begin
  if (to_jsonb(new) - v_fixed) <> (to_jsonb(old) - v_fixed) then
    raise exception 'facility decisions are immutable' using errcode = 'CH409';
  end if;
  if old.superseded_at is not null
     or (old.resolved_at is not null and (new.resolved_at, new.resolution, new.resolved_by_membership_id, new.resolution_note)
                                         is distinct from
                                         (old.resolved_at, old.resolution, old.resolved_by_membership_id, old.resolution_note)) then
    raise exception 'facility decisions are immutable' using errcode = 'CH409';
  end if;
  return new;
end;
$$;

create trigger timesheet_facility_signoffs_transition
  before update on public.timesheet_facility_signoffs
  for each row execute function internal.enforce_signoff_transition();
create trigger timesheet_facility_signoffs_no_delete
  before delete on public.timesheet_facility_signoffs
  for each row execute function internal.refuse_update_delete();
create trigger timesheet_facility_signoffs_no_truncate
  before truncate on public.timesheet_facility_signoffs
  for each statement execute function internal.refuse_update_delete();

alter table public.timesheet_facility_signoffs enable row level security;
grant select on public.timesheet_facility_signoffs to authenticated;
create policy timesheet_facility_signoffs_select on public.timesheet_facility_signoffs
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'timesheet.view'));

-- -----------------------------------------------------------------------------
-- History (append-only)
-- -----------------------------------------------------------------------------
create table public.timesheet_history (
  id uuid primary key default gen_random_uuid(),
  timesheet_id uuid not null,
  agency_organisation_id uuid not null,
  revision integer not null,
  action public.timesheet_history_action not null,
  entry_id uuid,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  actor_organisation_id uuid references public.organisations (id) on delete restrict,
  reason_code text check (reason_code is null or reason_code ~ '^[a-z_]{1,60}$'),
  note text check (note is null or (char_length(btrim(note)) between 1 and 500)),
  sequence bigint generated always as identity,
  occurred_at timestamptz not null default now(),
  foreign key (timesheet_id, agency_organisation_id)
    references public.timesheets (id, agency_organisation_id) on delete restrict,
  foreign key (entry_id, timesheet_id) references public.timesheet_entries (id, timesheet_id) on delete restrict
);

create index timesheet_history_timesheet_idx on public.timesheet_history (timesheet_id, sequence);

create trigger timesheet_history_append_only
  before update or delete on public.timesheet_history
  for each row execute function internal.refuse_update_delete();
create trigger timesheet_history_no_truncate
  before truncate on public.timesheet_history
  for each statement execute function internal.refuse_update_delete();

alter table public.timesheet_history enable row level security;
grant select on public.timesheet_history to authenticated;
create policy timesheet_history_select on public.timesheet_history
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'timesheet.view'));

revoke all on function
  internal.enforce_timesheet_transition(),
  internal.guard_timesheet_entry(),
  internal.enforce_supersede_only(),
  internal.enforce_signoff_transition()
from public, anon, authenticated;
