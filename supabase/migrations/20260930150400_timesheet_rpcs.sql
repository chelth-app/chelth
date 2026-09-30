-- =============================================================================
-- Migration: timesheet_rpcs
-- Stage:     P0-E6-S2
--
-- Purpose
--   Deterministic derivation of timesheets from attendance, and the review
--   lifecycle:  open → submitted → agency_approved → locked
--                      ↘ rejected ↗        (reopen / attendance change ⇒ new revision)
--
--   * Periods: weekly, week_starts_on per agency (ISO dow; default Monday).
--     An entry belongs to the period containing its shift's LOCAL start date.
--     A period can be submitted once its last local date has ended
--     everywhere (period_end + 1 day, 12:00 UTC).
--   * internal.sync_timesheet_entry(assignment) is the only writer of entry
--     values. It runs after every attendance projection refresh and every
--     assignment status change. It calls internal.effective_time (the one
--     calculation). If a derived time changes while the timesheet is approved
--     or locked, the approval and facility decisions are superseded and a new
--     revision awaits agency re-approval (never a silent edit).
--   * Blocking reasons: MISSING_CLOCK_IN, MISSING_CLOCK_OUT, BREAK_NOT_ENDED,
--     TIMES_INCONSISTENT, PENDING_CORRECTION, PERIOD_NOT_ENDED, NO_WORK; agency
--     approval additionally requires UNREVIEWED_EXCEPTION to be absent.
--   * Facility sign-off is per entry, only for entries at the caller's linked
--     facility (relationship-scoped), after agency approval. All entries
--     signed (or none needing sign-off) ⇒ locked.
--
--   Errors: CHP04 TIMESHEET_NOT_FOUND · CHP09 TIMESHEET_NOT_ACTIONABLE ·
--           CHP12 TIMESHEET_ENTRY_NOT_FOUND · CHP13 SIGNOFF_NOT_ACTIONABLE ·
--           CHP14 TIMESHEET_REVISION_CONFLICT · CHP15 TIMESHEET_SETTINGS_LOCKED
--
-- Verified by: supabase/tests/security/190_timesheets.test.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Periods
-- -----------------------------------------------------------------------------
create function internal.period_start_for(p_organisation_id uuid, p_local_date date)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select p_local_date - ((extract(isodow from p_local_date)::integer
                          - coalesce((select s.week_starts_on from public.agency_timesheet_settings s
                                      where s.agency_organisation_id = p_organisation_id), 1)
                          + 7) % 7)
$$;

-- The last local date of the period has ended in every timezone (UTC−12 is last).
create function internal.period_closed(p_period_end date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select now() >= ((p_period_end + 1)::timestamp at time zone 'UTC') + interval '12 hours'
$$;

create function internal.ensure_timesheet(p_organisation_id uuid, p_worker_id uuid, p_profile_id uuid,
                                          p_period_start date)
returns public.timesheets
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.timesheets;
begin
  insert into public.timesheets (agency_organisation_id, agency_worker_id, profile_id, period_start, period_end)
  values (p_organisation_id, p_worker_id, p_profile_id, p_period_start, p_period_start + 6)
  on conflict (agency_worker_id, period_start) do nothing;
  select * into t from public.timesheets x
  where x.agency_worker_id = p_worker_id and x.period_start = p_period_start
  for update;
  return t;
end;
$$;

-- -----------------------------------------------------------------------------
-- Revision: supersede the approval and facility decisions, bump the revision.
-- -----------------------------------------------------------------------------
create function internal.revise_timesheet(
  p_timesheet_id uuid,
  p_target_status public.timesheet_status,
  p_action public.timesheet_history_action,
  p_reason_code text,
  p_note text
)
returns public.timesheets
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.timesheets;
begin
  update public.timesheet_approvals x set superseded_at = now()
   where x.timesheet_id = p_timesheet_id and x.superseded_at is null;
  update public.timesheet_facility_signoffs x
     set superseded_at = now(),
         resolved_at = case when x.decision = 'disputed' and x.resolved_at is null then now() else x.resolved_at end,
         resolution = case when x.decision = 'disputed' and x.resolved_at is null
                           then 'timesheet_revised'::public.timesheet_dispute_resolution else x.resolution end
   where x.timesheet_id = p_timesheet_id and x.superseded_at is null;
  update public.timesheets x
     set status = p_target_status, revision = x.revision + 1,
         agency_approved_at = null, agency_approved_by_membership_id = null, locked_at = null,
         rejected_at = null, rejection_reason = null
   where x.id = p_timesheet_id
  returning x.* into t;

  perform set_config('chelth.timesheet_write', 'on', true);
  update public.timesheet_entries e
     set revision = t.revision,
         facility_state = case when e.facility_organisation_id is null or not e.included
                               then 'not_required'::public.timesheet_facility_state
                               else 'pending'::public.timesheet_facility_state end
   where e.timesheet_id = t.id;
  perform set_config('chelth.timesheet_write', '', true);

  insert into public.timesheet_history (timesheet_id, agency_organisation_id, revision, action, actor_profile_id,
                                        actor_organisation_id, reason_code, note)
  values (t.id, t.agency_organisation_id, t.revision, p_action, auth.uid(),
          case when auth.uid() is null then null else t.agency_organisation_id end, p_reason_code,
          nullif(btrim(p_note), ''));
  perform internal.record_audit_event('timesheet.' || p_action::text, t.agency_organisation_id, 'timesheet', t.id,
    jsonb_build_object('revision', t.revision, 'reason', p_reason_code));
  return t;
end;
$$;

-- -----------------------------------------------------------------------------
-- Derivation (the only writer of entry values)
-- -----------------------------------------------------------------------------
create function internal.sync_timesheet_entry(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.shift_assignments;
  s public.shifts;
  att public.assignment_attendance;
  e public.timesheet_entries;
  t public.timesheets;
  eff internal.effective_time;
  v_facility_org uuid;
  v_included boolean;
  v_reasons text[];
  v_exceptions text[];
  v_pending integer;
begin
  select * into a from public.shift_assignments x where x.id = p_assignment_id;
  if a.id is null then
    return;
  end if;
  select * into s from public.shifts x where x.id = a.shift_id;
  select * into att from public.assignment_attendance x where x.assignment_id = a.id;
  select * into e from public.timesheet_entries x where x.assignment_id = a.id;
  v_included := att.clock_in_at is not null or (a.status = 'accepted' and s.status <> 'cancelled');
  if e.id is null and not v_included then
    return;
  end if;

  if e.id is null then
    t := internal.ensure_timesheet(a.agency_organisation_id, a.agency_worker_id, a.profile_id,
           internal.period_start_for(a.agency_organisation_id, (s.start_at at time zone s.timezone)::date));
  else
    select * into t from public.timesheets x where x.id = e.timesheet_id for update;
  end if;

  eff := internal.effective_time(att.id);
  v_exceptions := coalesce((select array_agg(distinct x.exception_type::text)
                            from public.attendance_exceptions x
                            where x.attendance_id = att.id and x.status in ('open', 'under_review')), '{}'::text[]);
  v_pending := (select count(*) from public.attendance_corrections c
                where c.attendance_id = att.id and c.status = 'pending');
  v_reasons := case when not v_included then '{}'::text[]
                    else eff.reasons || case when v_pending > 0 then array['PENDING_CORRECTION'] else '{}'::text[] end end;
  select f.linked_facility_organisation_id into v_facility_org
  from public.agency_facilities f where f.id = s.agency_facility_id;

  if e.id is not null and t.status in ('agency_approved', 'locked')
     and (e.included, e.effective_start_at, e.effective_end_at, e.breaks, e.break_minutes, e.worked_minutes, e.not_worked)
         is distinct from
         (v_included, eff.effective_start_at, eff.effective_end_at, eff.breaks, eff.break_minutes,
          eff.worked_minutes, eff.not_worked) then
    t := internal.revise_timesheet(t.id, 'submitted', 'revised', 'attendance_changed', null);
  elsif e.id is null and t.status in ('agency_approved', 'locked') then
    t := internal.revise_timesheet(t.id, 'submitted', 'revised', 'attendance_changed', null);
  end if;

  perform set_config('chelth.timesheet_write', 'on', true);
  if e.id is null then
    insert into public.timesheet_entries
      (timesheet_id, agency_organisation_id, agency_worker_id, profile_id, assignment_id, shift_id, relationship_id,
       agency_facility_id, facility_location_id, facility_organisation_id, local_date, timezone, scheduled_start_at,
       scheduled_end_at, attendance_id, included, effective_start_at, effective_end_at, breaks, break_minutes,
       worked_minutes, not_worked, complete, blocking_reasons, open_exception_types, pending_corrections,
       calculation_version, calculated_at, revision, facility_state)
    values
      (t.id, a.agency_organisation_id, a.agency_worker_id, a.profile_id, a.id, s.id, s.relationship_id,
       s.agency_facility_id, s.facility_location_id, v_facility_org, (s.start_at at time zone s.timezone)::date,
       s.timezone, s.start_at, s.end_at, att.id, v_included, eff.effective_start_at, eff.effective_end_at,
       coalesce(eff.breaks, '[]'::jsonb), eff.break_minutes, eff.worked_minutes, coalesce(eff.not_worked, false),
       v_included and coalesce(eff.complete, false), v_reasons, v_exceptions, v_pending, 1, now(), t.revision,
       case when v_facility_org is null or not v_included then 'not_required'::public.timesheet_facility_state
            else 'pending'::public.timesheet_facility_state end);
  else
    update public.timesheet_entries x
       set attendance_id = att.id,
           included = v_included,
           effective_start_at = eff.effective_start_at,
           effective_end_at = eff.effective_end_at,
           breaks = coalesce(eff.breaks, '[]'::jsonb),
           break_minutes = eff.break_minutes,
           worked_minutes = eff.worked_minutes,
           not_worked = coalesce(eff.not_worked, false),
           complete = v_included and coalesce(eff.complete, false),
           blocking_reasons = v_reasons,
           open_exception_types = v_exceptions,
           pending_corrections = v_pending,
           calculation_version = 1,
           calculated_at = now(),
           revision = t.revision,
           facility_organisation_id = case when t.status in ('agency_approved', 'locked') then x.facility_organisation_id
                                           else v_facility_org end,
           facility_state = case when t.status in ('agency_approved', 'locked') then x.facility_state
                                 when v_facility_org is null or not v_included
                                   then 'not_required'::public.timesheet_facility_state
                                 else 'pending'::public.timesheet_facility_state end
     where x.id = e.id;
  end if;
  perform set_config('chelth.timesheet_write', '', true);
end;
$$;

create function internal.sync_timesheet_on_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status <> 'accepted' then
    return null;
  end if;
  perform internal.sync_timesheet_entry(new.id);
  return null;
end;
$$;

create trigger shift_assignments_timesheet_sync
  after insert or update of status on public.shift_assignments
  for each row execute function internal.sync_timesheet_on_assignment();

-- Deterministic rebuild of one timesheet (idempotent; never destructive).
create function internal.rebuild_timesheet(p_timesheet_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.timesheets;
  v_assignment uuid;
begin
  select * into t from public.timesheets x where x.id = p_timesheet_id;
  for v_assignment in
    select a.id from public.shift_assignments a join public.shifts s on s.id = a.shift_id
    where a.agency_worker_id = t.agency_worker_id and a.agency_organisation_id = t.agency_organisation_id
      and (s.start_at at time zone s.timezone)::date between t.period_start and t.period_end
    union
    select e.assignment_id from public.timesheet_entries e where e.timesheet_id = t.id
  loop
    perform internal.sync_timesheet_entry(v_assignment);
  end loop;
end;
$$;

create function internal.timesheet_blocking(p_timesheet_id uuid, p_for_approval boolean)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct r order by r), '{}'::text[])
  from (
    select unnest(e.blocking_reasons) as r
    from public.timesheet_entries e where e.timesheet_id = p_timesheet_id and e.included
    union all
    select 'UNREVIEWED_EXCEPTION' from public.timesheet_entries e
    where p_for_approval and e.timesheet_id = p_timesheet_id and e.included and cardinality(e.open_exception_types) > 0
    union all
    select 'PERIOD_NOT_ENDED' from public.timesheets t
    where t.id = p_timesheet_id and not internal.period_closed(t.period_end)
    union all
    select 'NO_WORK' where not exists (select 1 from public.timesheet_entries e
                                       where e.timesheet_id = p_timesheet_id and e.included)
  ) q
$$;

create function internal.timesheet_for_agency(p_timesheet_id uuid, p_capability text)
returns public.timesheets
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.timesheets;
begin
  select * into t from public.timesheets x where x.id = p_timesheet_id;
  if t.id is null or not authz.has_capability(t.agency_organisation_id, 'timesheet.view') then
    raise exception 'timesheet not found' using errcode = 'CHP04';
  end if;
  perform internal.require_capability(t.agency_organisation_id, p_capability);
  if t.profile_id = auth.uid() then
    raise exception 'you cannot review your own timesheet' using errcode = 'CH403';
  end if;
  select * into t from public.timesheets x where x.id = p_timesheet_id for update;
  return t;
end;
$$;

-- -----------------------------------------------------------------------------
-- Worker submission
-- -----------------------------------------------------------------------------
create function public.submit_timesheet(p_timesheet_id uuid)
returns table (outcome text, blocking_reasons text[])
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  t public.timesheets;
  v_reasons text[];
begin
  select * into t from public.timesheets x where x.id = p_timesheet_id;
  if t.id is null or not authz.is_own_active_worker(t.agency_worker_id) then
    raise exception 'timesheet not found' using errcode = 'CHP04';
  end if;
  select * into t from public.timesheets x where x.id = p_timesheet_id for update;
  if t.status not in ('open', 'rejected') then
    raise exception 'this timesheet cannot be submitted now' using errcode = 'CHP09';
  end if;
  perform internal.rebuild_timesheet(t.id);
  v_reasons := internal.timesheet_blocking(t.id, false);
  if cardinality(v_reasons) > 0 then
    return query select 'blocked'::text, v_reasons;
    return;
  end if;
  update public.timesheets x
     set status = 'submitted', submitted_at = now(), submitted_by_profile_id = v_profile_id,
         rejected_at = null, rejection_reason = null
   where x.id = t.id;
  insert into public.timesheet_history (timesheet_id, agency_organisation_id, revision, action, actor_profile_id,
                                        actor_organisation_id)
  values (t.id, t.agency_organisation_id, t.revision, 'submitted', v_profile_id, t.agency_organisation_id);
  perform internal.record_audit_event('timesheet.submitted', t.agency_organisation_id, 'timesheet', t.id,
    jsonb_build_object('revision', t.revision));
  perform internal.enqueue_notification('timesheet_submitted', t.agency_organisation_id, null,
    t.agency_organisation_id, 'timesheet', t.id);
  return query select 'submitted'::text, '{}'::text[];
end;
$$;

-- -----------------------------------------------------------------------------
-- Agency approval / rejection / reopen / recalculation
-- -----------------------------------------------------------------------------
create function public.approve_timesheet(p_timesheet_id uuid, p_expected_revision integer)
returns table (outcome text, blocking_reasons text[])
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  t public.timesheets := internal.timesheet_for_agency(p_timesheet_id, 'timesheet.approve');
  v_reasons text[];
  v_membership uuid;
  v_snapshot jsonb;
  v_facility uuid;
begin
  if t.status <> 'submitted' then
    raise exception 'only a submitted timesheet can be approved' using errcode = 'CHP09';
  end if;
  if p_expected_revision is distinct from t.revision then
    raise exception 'the timesheet changed; reload it' using errcode = 'CHP14';
  end if;
  perform internal.rebuild_timesheet(t.id);
  select * into t from public.timesheets x where x.id = t.id;
  if t.status <> 'submitted' or t.revision <> p_expected_revision then
    raise exception 'the timesheet changed; reload it' using errcode = 'CHP14';
  end if;
  v_reasons := internal.timesheet_blocking(t.id, true);
  if cardinality(v_reasons) > 0 then
    return query select 'blocked'::text, v_reasons;
    return;
  end if;
  v_membership := internal.active_membership_id(t.agency_organisation_id);

  -- Historical snapshot: derived times and reason codes only. No coordinates, no notes.
  select coalesce(jsonb_agg(jsonb_build_object(
           'entry_id', e.id, 'assignment_id', e.assignment_id, 'shift_id', e.shift_id,
           'agency_facility_id', e.agency_facility_id, 'facility_location_id', e.facility_location_id,
           'local_date', e.local_date, 'timezone', e.timezone,
           'scheduled_start_at', e.scheduled_start_at, 'scheduled_end_at', e.scheduled_end_at,
           'effective_start_at', e.effective_start_at, 'effective_end_at', e.effective_end_at,
           'breaks', e.breaks, 'break_minutes', e.break_minutes, 'worked_minutes', e.worked_minutes,
           'not_worked', e.not_worked,
           'exception_types', coalesce((select jsonb_agg(distinct x.exception_type)
                                        from public.attendance_exceptions x where x.attendance_id = e.attendance_id),
                                       '[]'::jsonb),
           'approved_correction_ids', coalesce((select jsonb_agg(c.id order by c.reviewed_at)
                                                from public.attendance_corrections c
                                                where c.attendance_id = e.attendance_id and c.status = 'approved'),
                                               '[]'::jsonb))
         order by e.local_date, e.scheduled_start_at), '[]'::jsonb)
    into v_snapshot
  from public.timesheet_entries e where e.timesheet_id = t.id and e.included;

  insert into public.timesheet_approvals (timesheet_id, agency_organisation_id, revision, approved_by_membership_id,
                                          entry_count, total_worked_minutes, total_break_minutes, calculation_version,
                                          snapshot)
  select t.id, t.agency_organisation_id, t.revision, v_membership, count(*),
         coalesce(sum(e.worked_minutes), 0), coalesce(sum(e.break_minutes), 0), 1, v_snapshot
  from public.timesheet_entries e where e.timesheet_id = t.id and e.included;

  update public.timesheets x
     set status = 'agency_approved', agency_approved_at = now(), agency_approved_by_membership_id = v_membership
   where x.id = t.id;

  perform set_config('chelth.timesheet_write', 'on', true);
  update public.timesheet_entries e
     set facility_state = case
           when e.included and e.facility_organisation_id is not null
                and exists (select 1 from public.agency_facility_relationships r
                            where r.id = e.relationship_id and r.status <> 'ended')
             then 'pending'::public.timesheet_facility_state
           else 'not_required'::public.timesheet_facility_state end
   where e.timesheet_id = t.id;
  perform set_config('chelth.timesheet_write', '', true);

  insert into public.timesheet_history (timesheet_id, agency_organisation_id, revision, action, actor_profile_id,
                                        actor_organisation_id)
  values (t.id, t.agency_organisation_id, t.revision, 'agency_approved', v_profile_id, t.agency_organisation_id);
  perform internal.record_audit_event('timesheet.agency_approved', t.agency_organisation_id, 'timesheet', t.id,
    jsonb_build_object('revision', t.revision));

  if not exists (select 1 from public.timesheet_entries e where e.timesheet_id = t.id and e.facility_state = 'pending') then
    update public.timesheets x set status = 'locked', locked_at = now() where x.id = t.id;
    insert into public.timesheet_history (timesheet_id, agency_organisation_id, revision, action)
    values (t.id, t.agency_organisation_id, t.revision, 'locked');
    perform internal.record_audit_event('timesheet.locked', t.agency_organisation_id, 'timesheet', t.id,
      jsonb_build_object('revision', t.revision));
    return query select 'locked'::text, '{}'::text[];
    return;
  end if;
  -- One notice per facility organisation per approval.
  for v_facility in
    select distinct e.facility_organisation_id from public.timesheet_entries e
    where e.timesheet_id = t.id and e.facility_state = 'pending'
  loop
    perform internal.enqueue_notification('timesheet_facility_signoff_required', t.agency_organisation_id, null,
      v_facility, 'timesheet', t.id);
  end loop;
  return query select 'agency_approved'::text, '{}'::text[];
end;
$$;

create function public.reject_timesheet(
  p_timesheet_id uuid,
  p_reason public.timesheet_rejection_reason,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  t public.timesheets := internal.timesheet_for_agency(p_timesheet_id, 'timesheet.approve');
begin
  if t.status <> 'submitted' then
    raise exception 'only a submitted timesheet can be returned' using errcode = 'CHP09';
  end if;
  if p_reason is null then
    raise exception 'choose a reason' using errcode = 'CH400';
  end if;
  update public.timesheets x set status = 'rejected', rejected_at = now(), rejection_reason = p_reason
   where x.id = t.id;
  insert into public.timesheet_history (timesheet_id, agency_organisation_id, revision, action, actor_profile_id,
                                        actor_organisation_id, reason_code, note)
  values (t.id, t.agency_organisation_id, t.revision, 'rejected', v_profile_id, t.agency_organisation_id,
          p_reason::text, nullif(btrim(p_note), ''));
  perform internal.record_audit_event('timesheet.rejected', t.agency_organisation_id, 'timesheet', t.id,
    jsonb_build_object('revision', t.revision, 'reason', p_reason));
  perform internal.enqueue_notification('timesheet_rejected', t.agency_organisation_id, t.profile_id, null,
    'timesheet', t.id);
end;
$$;

create function public.reopen_timesheet(
  p_timesheet_id uuid,
  p_reason public.timesheet_reopen_reason,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.timesheets := internal.timesheet_for_agency(p_timesheet_id, 'timesheet.approve');
begin
  if t.status not in ('agency_approved', 'locked') then
    raise exception 'only an approved timesheet can be reopened' using errcode = 'CHP09';
  end if;
  if p_reason is null then
    raise exception 'choose a reason' using errcode = 'CH400';
  end if;
  perform internal.revise_timesheet(t.id, 'open', 'reopened', p_reason::text, p_note);
  perform internal.enqueue_notification('timesheet_rejected', t.agency_organisation_id, t.profile_id, null,
    'timesheet', t.id, jsonb_build_object('reopened', true));
end;
$$;

create function public.rebuild_timesheet(p_timesheet_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.timesheets := internal.timesheet_for_agency(p_timesheet_id, 'timesheet.approve');
begin
  perform internal.rebuild_timesheet(t.id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Facility sign-off / discrepancy (per entry, relationship-scoped)
-- -----------------------------------------------------------------------------
create function internal.entry_for_facility(p_entry_id uuid)
returns public.timesheet_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.timesheet_entries;
begin
  select * into e from public.timesheet_entries x where x.id = p_entry_id;
  if e.id is null or e.facility_organisation_id is null
     or not authz.has_relationship_capability(e.relationship_id, 'timesheet.facility_signoff')
     or not authz.has_capability(e.facility_organisation_id, 'timesheet.facility_signoff') then
    raise exception 'entry not found' using errcode = 'CHP12';
  end if;
  return e;
end;
$$;

create function public.facility_decide_timesheet_entry(
  p_entry_id uuid,
  p_expected_revision integer,
  p_sign_off boolean,
  p_dispute_reason public.timesheet_dispute_reason default null,
  p_note text default null
)
returns public.timesheet_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  e public.timesheet_entries := internal.entry_for_facility(p_entry_id);
  t public.timesheets;
  v_membership uuid;
  v_state public.timesheet_facility_state;
begin
  select * into t from public.timesheets x where x.id = e.timesheet_id for update;
  select * into e from public.timesheet_entries x where x.id = p_entry_id for update;
  if t.status <> 'agency_approved' or e.facility_state <> 'pending' then
    raise exception 'this entry is not awaiting sign-off' using errcode = 'CHP13';
  end if;
  if p_expected_revision is distinct from t.revision then
    raise exception 'the timesheet changed; reload it' using errcode = 'CHP14';
  end if;
  if e.profile_id = v_profile_id then
    raise exception 'you cannot sign off your own work' using errcode = 'CH403';
  end if;
  if p_sign_off is null or (p_sign_off and p_dispute_reason is not null)
     or (not p_sign_off and p_dispute_reason is null) then
    raise exception 'choose sign-off or a discrepancy reason' using errcode = 'CH400';
  end if;
  v_state := case when p_sign_off then 'signed_off'::public.timesheet_facility_state
                  else 'disputed'::public.timesheet_facility_state end;
  v_membership := internal.active_membership_id(e.facility_organisation_id);

  insert into public.timesheet_facility_signoffs
    (entry_id, timesheet_id, agency_organisation_id, relationship_id, agency_facility_id, facility_organisation_id,
     revision, decision, dispute_reason, note, decided_by_membership_id, snapshot)
  values (e.id, t.id, t.agency_organisation_id, e.relationship_id, e.agency_facility_id, e.facility_organisation_id,
          t.revision, v_state, p_dispute_reason, nullif(btrim(p_note), ''), v_membership,
          jsonb_build_object('local_date', e.local_date, 'effective_start_at', e.effective_start_at,
                             'effective_end_at', e.effective_end_at, 'breaks', e.breaks,
                             'break_minutes', e.break_minutes, 'worked_minutes', e.worked_minutes));

  perform set_config('chelth.timesheet_write', 'on', true);
  update public.timesheet_entries x set facility_state = v_state where x.id = e.id;
  perform set_config('chelth.timesheet_write', '', true);

  insert into public.timesheet_history (timesheet_id, agency_organisation_id, revision, action, entry_id,
                                        actor_profile_id, actor_organisation_id, reason_code, note)
  values (t.id, t.agency_organisation_id, t.revision,
          case when p_sign_off then 'facility_signed_off'::public.timesheet_history_action
               else 'facility_disputed'::public.timesheet_history_action end,
          e.id, v_profile_id, e.facility_organisation_id, p_dispute_reason::text, nullif(btrim(p_note), ''));
  perform internal.record_audit_event(
    case when p_sign_off then 'timesheet.entry_signed_off' else 'timesheet.entry_disputed' end,
    e.facility_organisation_id, 'timesheet_entry', e.id,
    jsonb_build_object('revision', t.revision, 'reason', p_dispute_reason));

  if not p_sign_off then
    perform internal.enqueue_notification('timesheet_disputed', t.agency_organisation_id, null,
      t.agency_organisation_id, 'timesheet', t.id);
    return t.status;
  end if;
  if not exists (select 1 from public.timesheet_entries x
                 where x.timesheet_id = t.id and x.facility_state in ('pending', 'disputed')) then
    update public.timesheets x set status = 'locked', locked_at = now() where x.id = t.id;
    insert into public.timesheet_history (timesheet_id, agency_organisation_id, revision, action)
    values (t.id, t.agency_organisation_id, t.revision, 'locked');
    perform internal.record_audit_event('timesheet.locked', t.agency_organisation_id, 'timesheet', t.id,
      jsonb_build_object('revision', t.revision));
    return 'locked'::public.timesheet_status;
  end if;
  return t.status;
end;
$$;

-- Agency answers a discrepancy by confirming the times stand (the entry
-- returns to the facility). Changing times goes through attendance
-- corrections/adjustments, which create a new revision.
create function public.resolve_timesheet_dispute(p_entry_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  e public.timesheet_entries;
  t public.timesheets;
  v_membership uuid;
begin
  select * into e from public.timesheet_entries x where x.id = p_entry_id;
  if e.id is null then
    raise exception 'entry not found' using errcode = 'CHP12';
  end if;
  t := internal.timesheet_for_agency(e.timesheet_id, 'timesheet.approve');
  select * into e from public.timesheet_entries x where x.id = p_entry_id for update;
  if t.status <> 'agency_approved' or e.facility_state <> 'disputed' then
    raise exception 'this entry has no open discrepancy' using errcode = 'CHP13';
  end if;
  v_membership := internal.active_membership_id(t.agency_organisation_id);
  update public.timesheet_facility_signoffs x
     set resolved_at = now(), resolution = 'times_confirmed', resolved_by_membership_id = v_membership,
         resolution_note = nullif(btrim(p_note), '')
   where x.entry_id = e.id and x.decision = 'disputed' and x.resolved_at is null and x.superseded_at is null;
  perform set_config('chelth.timesheet_write', 'on', true);
  update public.timesheet_entries x set facility_state = 'pending' where x.id = e.id;
  perform set_config('chelth.timesheet_write', '', true);
  insert into public.timesheet_history (timesheet_id, agency_organisation_id, revision, action, entry_id,
                                        actor_profile_id, actor_organisation_id, reason_code, note)
  values (t.id, t.agency_organisation_id, t.revision, 'dispute_resolved', e.id, v_profile_id,
          t.agency_organisation_id, 'times_confirmed', nullif(btrim(p_note), ''));
  perform internal.record_audit_event('timesheet.dispute_resolved', t.agency_organisation_id, 'timesheet_entry', e.id,
    jsonb_build_object('revision', t.revision, 'resolution', 'times_confirmed'));
  perform internal.enqueue_notification('timesheet_facility_signoff_required', t.agency_organisation_id, null,
    e.facility_organisation_id, 'timesheet', t.id);
end;
$$;

-- Settings: fixed once timesheets exist (period boundaries must stay deterministic).
create function public.set_agency_timesheet_settings(p_organisation_id uuid, p_week_starts_on smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'attendance.manage_settings');
  if p_week_starts_on is null or p_week_starts_on not between 1 and 7 then
    raise exception 'week start must be 1 (Monday) to 7 (Sunday)' using errcode = 'CH400';
  end if;
  if exists (select 1 from public.timesheets t where t.agency_organisation_id = p_organisation_id) then
    raise exception 'the timesheet week is fixed once timesheets exist' using errcode = 'CHP15';
  end if;
  insert into public.agency_timesheet_settings (agency_organisation_id, week_starts_on, updated_by_profile_id)
  values (p_organisation_id, p_week_starts_on, auth.uid())
  on conflict (agency_organisation_id) do update
    set week_starts_on = excluded.week_starts_on, updated_by_profile_id = excluded.updated_by_profile_id;
  perform internal.record_audit_event('timesheet.settings_updated', p_organisation_id, 'organisation',
    p_organisation_id, jsonb_build_object('week_starts_on', p_week_starts_on));
end;
$$;

-- -----------------------------------------------------------------------------
-- Projections
-- -----------------------------------------------------------------------------
-- Header for one timesheet: the worker (own) or agency timesheet.view.
create function public.get_timesheet(p_timesheet_id uuid)
returns table (
  timesheet_id uuid,
  agency_organisation_id uuid,
  worker_name text,
  period_start date,
  period_end date,
  status public.timesheet_status,
  revision integer,
  submitted_at timestamptz,
  agency_approved_at timestamptz,
  approved_by_name text,
  locked_at timestamptz,
  rejection_reason public.timesheet_rejection_reason,
  return_note text,
  entry_count integer,
  total_worked_minutes integer,
  total_break_minutes integer,
  submit_blocking_reasons text[],
  approval_blocking_reasons text[],
  viewer_is_worker boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  t public.timesheets;
  v_worker boolean;
begin
  perform internal.require_identity();
  select * into t from public.timesheets x where x.id = p_timesheet_id;
  v_worker := t.id is not null and authz.is_own_active_worker(t.agency_worker_id);
  if t.id is null or not (v_worker or authz.has_capability(t.agency_organisation_id, 'timesheet.view')) then
    raise exception 'timesheet not found' using errcode = 'CHP04';
  end if;
  return query
    select t.id, t.agency_organisation_id, p.display_name, t.period_start, t.period_end, t.status, t.revision,
           t.submitted_at, t.agency_approved_at,
           case when v_worker then null else ap.display_name end,
           t.locked_at, t.rejection_reason,
           (select h.note from public.timesheet_history h
            where h.timesheet_id = t.id and h.action in ('rejected', 'reopened') order by h.sequence desc limit 1),
           (select count(*)::integer from public.timesheet_entries e where e.timesheet_id = t.id and e.included),
           (select coalesce(sum(e.worked_minutes), 0)::integer from public.timesheet_entries e
            where e.timesheet_id = t.id and e.included),
           (select coalesce(sum(e.break_minutes), 0)::integer from public.timesheet_entries e
            where e.timesheet_id = t.id and e.included),
           internal.timesheet_blocking(t.id, false),
           internal.timesheet_blocking(t.id, true),
           v_worker
    from public.profiles p
    left join public.organisation_memberships am on am.id = t.agency_approved_by_membership_id
    left join public.profiles ap on ap.id = am.profile_id
    where p.id = t.profile_id;
end;
$$;

create function public.list_my_timesheets(p_organisation_id uuid)
returns table (
  timesheet_id uuid,
  period_start date,
  period_end date,
  status public.timesheet_status,
  revision integer,
  entry_count integer,
  total_worked_minutes integer,
  incomplete_count integer,
  blocking_reasons text[],
  can_submit boolean
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
    select t.id, t.period_start, t.period_end, t.status, t.revision,
           (select count(*)::integer from public.timesheet_entries e where e.timesheet_id = t.id and e.included),
           (select coalesce(sum(e.worked_minutes), 0)::integer from public.timesheet_entries e
            where e.timesheet_id = t.id and e.included),
           (select count(*)::integer from public.timesheet_entries e
            where e.timesheet_id = t.id and e.included and cardinality(e.blocking_reasons) > 0),
           b.reasons,
           t.status in ('open', 'rejected') and cardinality(b.reasons) = 0
    from public.timesheets t
    cross join lateral (select internal.timesheet_blocking(t.id, false) as reasons) b
    where t.agency_organisation_id = p_organisation_id
      and authz.is_own_active_worker(t.agency_worker_id)
      and t.period_start > current_date - 91
      and exists (select 1 from public.timesheet_entries e where e.timesheet_id = t.id and e.included)
    order by t.period_start desc
    limit 30;
end;
$$;

create function public.list_timesheet_entries(p_timesheet_id uuid)
returns table (
  entry_id uuid,
  assignment_id uuid,
  attendance_id uuid,
  shift_id uuid,
  local_date date,
  timezone text,
  facility_name text,
  location_name text,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  effective_start_at timestamptz,
  effective_end_at timestamptz,
  breaks jsonb,
  break_minutes integer,
  worked_minutes integer,
  not_worked boolean,
  included boolean,
  complete boolean,
  blocking_reasons text[],
  open_exception_types text[],
  pending_corrections integer,
  approved_corrections integer,
  clock_in_location public.geofence_result,
  clock_out_location public.geofence_result,
  facility_state public.timesheet_facility_state
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  t public.timesheets;
begin
  perform internal.require_identity();
  select * into t from public.timesheets x where x.id = p_timesheet_id;
  if t.id is null or not (authz.is_own_active_worker(t.agency_worker_id)
                          or authz.has_capability(t.agency_organisation_id, 'timesheet.view')) then
    raise exception 'timesheet not found' using errcode = 'CHP04';
  end if;
  return query
    select e.id, e.assignment_id, e.attendance_id, e.shift_id, e.local_date, e.timezone, f.name, l.name,
           e.scheduled_start_at, e.scheduled_end_at, e.effective_start_at, e.effective_end_at, e.breaks,
           e.break_minutes, e.worked_minutes, e.not_worked, e.included, e.complete, e.blocking_reasons,
           e.open_exception_types, e.pending_corrections,
           (select count(*)::integer from public.attendance_corrections c
            where c.attendance_id = e.attendance_id and c.status = 'approved'),
           (select v.geofence_result from public.attendance_events v
            where v.attendance_id = e.attendance_id and v.event_type = 'clock_in'),
           (select v.geofence_result from public.attendance_events v
            where v.attendance_id = e.attendance_id and v.event_type = 'clock_out'),
           e.facility_state
    from public.timesheet_entries e
    join public.agency_facilities f on f.id = e.agency_facility_id
    join public.facility_locations l on l.id = e.facility_location_id
    where e.timesheet_id = t.id
    order by e.included desc, e.local_date, e.scheduled_start_at;
end;
$$;

-- History: the agency sees everything; the worker sees actions and codes plus
-- the agency's note when their timesheet was returned (never facility notes
-- or staff names).
create function public.list_timesheet_history(p_timesheet_id uuid)
returns table (
  action public.timesheet_history_action,
  revision integer,
  occurred_at timestamptz,
  entry_id uuid,
  reason_code text,
  note text,
  actor_name text,
  actor_side text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  t public.timesheets;
  v_agency boolean;
begin
  perform internal.require_identity();
  select * into t from public.timesheets x where x.id = p_timesheet_id;
  v_agency := t.id is not null and authz.has_capability(t.agency_organisation_id, 'timesheet.view');
  if t.id is null or not (v_agency or authz.is_own_active_worker(t.agency_worker_id)) then
    raise exception 'timesheet not found' using errcode = 'CHP04';
  end if;
  return query
    select h.action, h.revision, h.occurred_at, h.entry_id, h.reason_code,
           case when v_agency or h.action in ('rejected', 'reopened') then h.note end,
           case when v_agency then p.display_name end,
           case when h.actor_organisation_id is null then 'system'
                when h.actor_organisation_id <> t.agency_organisation_id then 'facility'
                when h.actor_profile_id = t.profile_id then 'worker'
                else 'agency' end
    from public.timesheet_history h
    left join public.profiles p on p.id = h.actor_profile_id
    where h.timesheet_id = t.id
    order by h.sequence;
end;
$$;

create function public.list_agency_timesheets(
  p_organisation_id uuid,
  p_period_start date default null,
  p_status public.timesheet_status default null
)
returns table (
  timesheet_id uuid,
  worker_name text,
  period_start date,
  period_end date,
  status public.timesheet_status,
  revision integer,
  entry_count integer,
  total_worked_minutes integer,
  issue_count integer,
  pending_facility_count integer,
  disputed_count integer,
  facilities text[],
  submitted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'timesheet.view');
  return query
    select t.id, p.display_name, t.period_start, t.period_end, t.status, t.revision,
           agg.entry_count, agg.worked, agg.issues, agg.pending_facility, agg.disputed, agg.facilities, t.submitted_at
    from public.timesheets t
    join public.profiles p on p.id = t.profile_id
    cross join lateral (
      select count(*)::integer as entry_count,
             coalesce(sum(e.worked_minutes), 0)::integer as worked,
             count(*) filter (where cardinality(e.blocking_reasons) > 0
                                 or cardinality(e.open_exception_types) > 0)::integer as issues,
             count(*) filter (where e.facility_state = 'pending'
                                and t.status = 'agency_approved')::integer as pending_facility,
             count(*) filter (where e.facility_state = 'disputed')::integer as disputed,
             coalesce(array_agg(distinct f.name order by f.name), '{}'::text[]) as facilities
      from public.timesheet_entries e
      join public.agency_facilities f on f.id = e.agency_facility_id
      where e.timesheet_id = t.id and e.included
    ) agg
    where t.agency_organisation_id = p_organisation_id
      and agg.entry_count > 0
      and (p_period_start is null or t.period_start = p_period_start)
      and (p_status is null or t.status = p_status)
    order by (t.status = 'submitted' or agg.disputed > 0) desc, t.period_start desc, p.display_name collate "C", t.id
    limit 500;
end;
$$;

-- Facility: only entries at ITS facility (linked relationship), after agency
-- approval. Narrow: no coordinates, notes, credentials or other facilities.
create function public.list_facility_timesheet_entries(p_facility_organisation_id uuid)
returns table (
  entry_id uuid,
  timesheet_revision integer,
  agency_name text,
  worker_display_name text,
  facility_name text,
  location_name text,
  local_date date,
  timezone text,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  effective_start_at timestamptz,
  effective_end_at timestamptz,
  breaks jsonb,
  break_minutes integer,
  worked_minutes integer,
  had_attendance_exception boolean,
  facility_state public.timesheet_facility_state,
  decided_at timestamptz,
  dispute_reason public.timesheet_dispute_reason
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_facility_organisation_id, 'timesheet.facility_signoff');
  perform internal.record_audit_event_once('timesheet.viewed_by_facility', p_facility_organisation_id,
    'organisation', p_facility_organisation_id, interval '15 minutes');
  return query
    select e.id, t.revision, o.name, p.display_name, f.name, l.name, e.local_date, e.timezone,
           e.scheduled_start_at, e.scheduled_end_at, e.effective_start_at, e.effective_end_at,
           (select coalesce(jsonb_agg(jsonb_build_object('start_at', b -> 'start_at', 'end_at', b -> 'end_at')), '[]'::jsonb)
            from jsonb_array_elements(e.breaks) b),
           e.break_minutes, e.worked_minutes,
           exists (select 1 from public.attendance_exceptions x where x.attendance_id = e.attendance_id),
           e.facility_state,
           d.decided_at, d.dispute_reason
    from public.timesheet_entries e
    join public.timesheets t on t.id = e.timesheet_id
    join public.organisations o on o.id = t.agency_organisation_id
    join public.profiles p on p.id = e.profile_id
    join public.agency_facilities f on f.id = e.agency_facility_id
    join public.facility_locations l on l.id = e.facility_location_id
    left join lateral (
      select s.decided_at, s.dispute_reason from public.timesheet_facility_signoffs s
      where s.entry_id = e.id and s.superseded_at is null order by s.decided_at desc limit 1
    ) d on true
    where e.facility_organisation_id = p_facility_organisation_id
      and e.included
      and e.facility_state <> 'not_required'
      and t.status in ('agency_approved', 'locked')
      and authz.has_relationship_capability(e.relationship_id, 'timesheet.facility_signoff')
    order by (e.facility_state = 'pending') desc, e.local_date desc, p.display_name collate "C", e.id
    limit 500;
end;
$$;

-- -----------------------------------------------------------------------------
-- Notifications: routing and templates for timesheet events
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
    when v_audience <> p_organisation_id and p_event::text like 'timesheet\_%' then 'timesheet.facility_signoff'
    when v_audience <> p_organisation_id then 'shift.request'
    when p_event::text like 'attendance\_%' then 'attendance.review'
    when p_event::text like 'timesheet\_%' then 'timesheet.approve'
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
  elsif n.subject_type = 'timesheet' then
    -- Timesheet notices: agency, period and (agency audience only) the worker. No times, no totals.
    select jsonb_build_object('agencyName', o.name, 'periodStart', t.period_start, 'periodEnd', t.period_end,
                              'workerName', case when v_audience = 'agency' then p.display_name end)
      into v_data
    from public.timesheets t
    join public.organisations o on o.id = t.agency_organisation_id
    join public.profiles p on p.id = t.profile_id
    where t.id = n.subject_id and t.agency_organisation_id = n.organisation_id;
    if v_data is null then
      return null;
    end if;
    if v_audience = 'facility' and not exists (
      select 1 from public.timesheet_entries e
      where e.timesheet_id = n.subject_id and e.facility_organisation_id = n.audience_organisation_id) then
      return null;
    end if;
    v_path := case v_audience
      when 'facility' then '/app/organisations/' || n.audience_organisation_id || '/timesheets'
      else '/app/organisations/' || n.organisation_id || '/timesheets/' || n.subject_id end;
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
    if v_audience = 'facility' and v_facility_org is distinct from n.audience_organisation_id then
      return null;
    end if;

    v_path := case v_audience
      when 'worker' then '/app/organisations/' || n.organisation_id || '/my-shifts'
      when 'facility' then '/app/organisations/' || n.audience_organisation_id || '/staffing-requests/' || v_shift_id
      else '/app/organisations/' || n.organisation_id || '/shifts/' || v_shift_id end;

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

-- Backfill existing accepted/attended assignments (no-op on a fresh database).
select internal.sync_timesheet_entry(a.id)
from public.shift_assignments a
where a.status = 'accepted' or exists (select 1 from public.assignment_attendance x where x.assignment_id = a.id);

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function
  internal.period_start_for(uuid, date),
  internal.period_closed(date),
  internal.ensure_timesheet(uuid, uuid, uuid, date),
  internal.revise_timesheet(uuid, public.timesheet_status, public.timesheet_history_action, text, text),
  internal.sync_timesheet_entry(uuid),
  internal.sync_timesheet_on_assignment(),
  internal.rebuild_timesheet(uuid),
  internal.timesheet_blocking(uuid, boolean),
  internal.timesheet_for_agency(uuid, text),
  internal.entry_for_facility(uuid)
from public, anon, authenticated, service_role;

revoke all on function
  public.submit_timesheet(uuid),
  public.approve_timesheet(uuid, integer),
  public.reject_timesheet(uuid, public.timesheet_rejection_reason, text),
  public.reopen_timesheet(uuid, public.timesheet_reopen_reason, text),
  public.rebuild_timesheet(uuid),
  public.facility_decide_timesheet_entry(uuid, integer, boolean, public.timesheet_dispute_reason, text),
  public.resolve_timesheet_dispute(uuid, text),
  public.set_agency_timesheet_settings(uuid, smallint),
  public.get_timesheet(uuid),
  public.list_my_timesheets(uuid),
  public.list_timesheet_entries(uuid),
  public.list_timesheet_history(uuid),
  public.list_agency_timesheets(uuid, date, public.timesheet_status),
  public.list_facility_timesheet_entries(uuid)
from public, anon;

grant execute on function
  public.submit_timesheet(uuid),
  public.approve_timesheet(uuid, integer),
  public.reject_timesheet(uuid, public.timesheet_rejection_reason, text),
  public.reopen_timesheet(uuid, public.timesheet_reopen_reason, text),
  public.rebuild_timesheet(uuid),
  public.facility_decide_timesheet_entry(uuid, integer, boolean, public.timesheet_dispute_reason, text),
  public.resolve_timesheet_dispute(uuid, text),
  public.set_agency_timesheet_settings(uuid, smallint),
  public.get_timesheet(uuid),
  public.list_my_timesheets(uuid),
  public.list_timesheet_entries(uuid),
  public.list_timesheet_history(uuid),
  public.list_agency_timesheets(uuid, date, public.timesheet_status),
  public.list_facility_timesheet_entries(uuid)
to authenticated;
