-- =============================================================================
-- Migration: attendance_segments_and_retention
-- Stage:     P0-E6-S2
--
-- Purpose
--   * Breaks: break_start / break_end device events (segment = break number)
--     and corrected_* variants. Clock events stay on segment 1.
--   * Corrections: break event types, reviewer-adjusted approvals
--     (approved_time + structured adjustment reason + bounded note), and
--     reviewer-originated adjustments. History is still append-only.
--   * Location evidence retention: per-agency retention period (default 90
--     days), purge = coordinates nulled in place (result, accuracy, distance
--     and radius kept; the event's geofence_result is untouched), narrow legal
--     hold per attendance record.
--   * Audit dedupe index for repeated identical read events.
--
-- Verified by: supabase/tests/security/190_timesheets.test.sql,
--              200_attendance_hardening.test.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Events: breaks
-- -----------------------------------------------------------------------------
alter table public.attendance_events drop constraint attendance_events_check;
alter table public.attendance_events drop constraint attendance_events_check1;
alter table public.attendance_events
  add constraint attendance_events_device_time_check
    check (event_type not in ('clock_in', 'clock_out', 'break_start', 'break_end') or occurred_at = recorded_at),
  add constraint attendance_events_correction_source_check
    check ((source = 'approved_correction')
           = (event_type in ('corrected_clock_in', 'corrected_clock_out', 'corrected_break_start', 'corrected_break_end'))),
  add constraint attendance_events_clock_segment_check
    check (event_type not in ('clock_in', 'clock_out', 'corrected_clock_in', 'corrected_clock_out') or segment = 1);

create unique index attendance_events_one_break_start
  on public.attendance_events (attendance_id, segment) where event_type = 'break_start';
create unique index attendance_events_one_break_end
  on public.attendance_events (attendance_id, segment) where event_type = 'break_end';

-- -----------------------------------------------------------------------------
-- Corrections: breaks, reviewer adjustments
-- -----------------------------------------------------------------------------
alter table public.attendance_corrections
  add column origin public.attendance_correction_origin not null default 'worker_request',
  add column segment smallint not null default 1 check (segment between 1 and 20),
  add column approved_time timestamptz,
  add column adjustment_reason public.attendance_adjustment_reason,
  add column reviewer_note text check (reviewer_note is null or char_length(btrim(reviewer_note)) between 1 and 500);

-- Backfill S1 approvals (approved as requested) before the new invariants apply.
alter table public.attendance_corrections disable trigger attendance_corrections_transition;
alter table public.attendance_corrections disable trigger attendance_corrections_ownership_immutable;
update public.attendance_corrections set approved_time = requested_time where status = 'approved';
alter table public.attendance_corrections enable trigger attendance_corrections_transition;
alter table public.attendance_corrections enable trigger attendance_corrections_ownership_immutable;

alter table public.attendance_corrections drop constraint attendance_corrections_requested_event_type_check;
alter table public.attendance_corrections drop constraint attendance_corrections_check1;
alter table public.attendance_corrections drop constraint attendance_corrections_check2;
alter table public.attendance_corrections
  add constraint attendance_corrections_event_type_check
    check (requested_event_type in ('clock_in', 'clock_out', 'break_start', 'break_end')),
  add constraint attendance_corrections_clock_segment_check
    check (requested_event_type not in ('clock_in', 'clock_out') or segment = 1),
  add constraint attendance_corrections_approval_check
    check (status <> 'approved'
           or (resolution in ('approved_as_requested', 'approved_with_adjustment') and approved_time is not null)),
  add constraint attendance_corrections_rejection_check
    check (status <> 'rejected'
           or (resolution not in ('approved_as_requested', 'approved_with_adjustment') and approved_time is null)),
  add constraint attendance_corrections_adjustment_check
    check ((resolution = 'approved_with_adjustment') = (adjustment_reason is not null)),
  add constraint attendance_corrections_as_requested_check
    check (resolution is distinct from 'approved_as_requested' or approved_time = requested_time),
  add constraint attendance_corrections_reviewer_origin_check
    check (origin = 'worker_request' or (status = 'approved' and resolution = 'approved_with_adjustment'));

drop index public.attendance_corrections_one_pending;
create unique index attendance_corrections_one_pending
  on public.attendance_corrections (attendance_id, requested_event_type, segment) where status = 'pending';

drop trigger attendance_corrections_ownership_immutable on public.attendance_corrections;
create trigger attendance_corrections_ownership_immutable
  before update on public.attendance_corrections
  for each row execute function internal.enforce_immutable_columns(
    'attendance_id', 'assignment_id', 'agency_organisation_id', 'requested_by_profile_id',
    'requested_event_type', 'requested_time', 'reason', 'worker_note', 'requested_at', 'origin', 'segment');

-- -----------------------------------------------------------------------------
-- Location evidence: retention and purge
-- -----------------------------------------------------------------------------
alter table public.agency_attendance_settings
  add column location_evidence_retention_days integer not null default 90
    check (location_evidence_retention_days between 7 and 365);

alter table public.attendance_location_evidence add column purged_at timestamptz;
alter table public.attendance_location_evidence drop constraint attendance_location_evidence_check1;
alter table public.attendance_location_evidence
  add constraint attendance_location_evidence_unavailable_check
    check (purged_at is not null or (result = 'unavailable') = (latitude is null)),
  add constraint attendance_location_evidence_purged_check
    check (purged_at is null or (latitude is null and longitude is null and device_captured_at is null));
create index attendance_location_evidence_purge_idx
  on public.attendance_location_evidence (agency_organisation_id, recorded_at) where purged_at is null;

-- Evidence stays append-only except for exactly one transition: the purge
-- (coordinates and device time nulled, purged_at set, everything else equal).
create function internal.enforce_evidence_purge_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.purged_at is null and new.purged_at is not null
     and new.latitude is null and new.longitude is null and new.device_captured_at is null
     and (to_jsonb(new) - array['latitude', 'longitude', 'device_captured_at', 'purged_at'])
         = (to_jsonb(old) - array['latitude', 'longitude', 'device_captured_at', 'purged_at']) then
    return new;
  end if;
  raise exception 'attendance_location_evidence rows are append-only' using errcode = 'CH409';
end;
$$;

drop trigger attendance_location_evidence_append_only on public.attendance_location_evidence;
create trigger attendance_location_evidence_no_delete
  before delete on public.attendance_location_evidence
  for each row execute function internal.refuse_update_delete();
create trigger attendance_location_evidence_purge_only
  before update on public.attendance_location_evidence
  for each row execute function internal.enforce_evidence_purge_only();

-- Legal hold: narrow, per attendance record. Active hold ⇒ never purged.
create table public.attendance_evidence_legal_holds (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null,
  agency_organisation_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 300 and reason !~ '[[:cntrl:]]'),
  placed_by_membership_id uuid not null,
  placed_at timestamptz not null default now(),
  released_at timestamptz,
  released_by_membership_id uuid,
  foreign key (attendance_id, agency_organisation_id)
    references public.assignment_attendance (id, agency_organisation_id) on delete restrict,
  foreign key (placed_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  foreign key (released_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  check ((released_at is null) = (released_by_membership_id is null)),
  check (released_at is null or released_at >= placed_at)
);

create unique index attendance_evidence_legal_holds_one_active
  on public.attendance_evidence_legal_holds (attendance_id) where released_at is null;

create function internal.enforce_legal_hold_release_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.released_at is null and new.released_at is not null
     and (to_jsonb(new) - array['released_at', 'released_by_membership_id'])
         = (to_jsonb(old) - array['released_at', 'released_by_membership_id']) then
    return new;
  end if;
  raise exception 'legal holds can only be released' using errcode = 'CH409';
end;
$$;

create trigger attendance_evidence_legal_holds_release_only
  before update on public.attendance_evidence_legal_holds
  for each row execute function internal.enforce_legal_hold_release_only();
create trigger attendance_evidence_legal_holds_no_delete
  before delete on public.attendance_evidence_legal_holds
  for each row execute function internal.refuse_update_delete();
create trigger attendance_evidence_legal_holds_no_truncate
  before truncate on public.attendance_evidence_legal_holds
  for each statement execute function internal.refuse_update_delete();

alter table public.attendance_evidence_legal_holds enable row level security;
grant select on public.attendance_evidence_legal_holds to authenticated;
create policy attendance_evidence_legal_holds_select on public.attendance_evidence_legal_holds
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'attendance.location.view'));

-- -----------------------------------------------------------------------------
-- Audit: supports "one identical read event per actor/target per window".
-- -----------------------------------------------------------------------------
create index audit_events_dedupe_idx on public.audit_events (actor_profile_id, action, target_id, occurred_at desc);

revoke all on function
  internal.enforce_evidence_purge_only(),
  internal.enforce_legal_hold_release_only()
from public, anon, authenticated;
