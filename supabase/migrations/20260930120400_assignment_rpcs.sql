-- =============================================================================
-- Migration: assignment_rpcs
-- Stage:     P0-E5-S1
--
-- Purpose
--   The assignment boundary: "Can this exact person be assigned to this exact
--   facility for this exact shift date, without violating compliance,
--   tenancy, capacity or schedule constraints?"
--
--   internal.assignment_eligibility(shift, worker) is the single decision
--   function. It returns every applicable block reason (declaration order =
--   priority), the compliance readiness on EVERY local date the shift touches,
--   the non-MET compliance reason codes and findings. It does not duplicate
--   credential logic: compliance comes from internal.evaluate_compliance
--   scoped to the shift's discipline and facility.
--
--   Policy: assignment requires readiness = 'ready'. 'action_required'
--   (e.g. EXPIRING_SOON on the shift date) BLOCKS — see
--   docs/architecture/ASSIGNMENT_ELIGIBILITY.md.
--
--   assign_worker_to_shift
--     1. authorize (assignment.manage in the shift's agency)
--     2. lock the shift row (FOR UPDATE)       → capacity serialises per shift
--     3. lock the person (advisory xact lock)  → schedule serialises per person,
--                                                across agencies
--     4. evaluate; record an append-only decision (allowed OR refused)
--     5. allowed → insert the assignment (capacity trigger + exclusion
--        constraint are structural backstops)
--   Eligibility refusals RETURN (not raise) so the decision and audit event
--   commit; the server maps the primary code to a structured error.
--   Authorization, tenancy and state errors RAISE:
--     CHS04 SHIFT_NOT_FOUND · CHS09 SHIFT_NOT_OPEN · CHS10 RELATIONSHIP_NOT_ACTIVE
--     CHW04 WORKER_NOT_FOUND · CHA04 ASSIGNMENT_NOT_FOUND · CHA09 ASSIGNMENT_NOT_ACTIONABLE
--     CHS12 DISCIPLINE_MISMATCH · CHS13 WORKER_NOT_ACTIVE · CHS14 WORKER_NOT_ELIGIBLE ·
--     CHS15 WORKER_SCHEDULE_CONFLICT (acceptance re-check)
--
--   Privacy: a schedule conflict is reported as WORKER_SCHEDULE_CONFLICT only.
--   The conflicting assignment's agency, facility, times and ids are never
--   returned, recorded in the decision, or written to audit metadata.
--
-- Verified by: supabase/tests/security/120_assignments.test.sql
-- =============================================================================

create function internal.profile_schedule_lock(p_profile_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chelth.schedule:' || p_profile_id::text, 0))
$$;

create function internal.assignment_eligibility(
  p_shift_id uuid,
  p_agency_worker_id uuid,
  p_existing_assignment_id uuid default null
)
returns table (
  block_reasons public.assignment_block_reason[],
  readiness public.readiness_status,
  compliance_reasons public.compliance_reason[],
  compliance_findings jsonb,
  evaluation_dates date[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  s public.shifts;
  w public.agency_workers;
  v_membership_active boolean;
  v_blocks public.assignment_block_reason[] := '{}'::public.assignment_block_reason[];
  v_dates date[];
  v_blocking integer;
  v_warning integer;
  v_reasons public.compliance_reason[];
  v_findings jsonb;
  v_readiness public.readiness_status;
begin
  select * into s from public.shifts x where x.id = p_shift_id;
  select * into w from public.agency_workers x
  where x.id = p_agency_worker_id and x.agency_organisation_id = s.agency_organisation_id;
  if s.id is null or w.id is null then
    raise exception 'shift or worker not found' using errcode = 'CH404';
  end if;
  v_dates := internal.shift_local_dates(s.start_at, s.end_at, s.timezone);

  -- Capacity (only for a NEW assignment).
  if p_existing_assignment_id is null then
    if exists (
      select 1 from public.shift_assignments a
      where a.shift_id = s.id and a.agency_worker_id = w.id and a.status in ('assigned', 'accepted')
    ) then
      v_blocks := v_blocks || 'ASSIGNMENT_ALREADY_EXISTS'::public.assignment_block_reason;
    end if;
    if (select count(*) from public.shift_assignments a
        where a.shift_id = s.id and a.status in ('assigned', 'accepted')) >= s.requested_headcount then
      v_blocks := v_blocks || 'SHIFT_FULL'::public.assignment_block_reason;
    end if;
  end if;

  select m.status = 'active' into v_membership_active
  from public.organisation_memberships m where m.id = w.membership_id;
  if w.status <> 'active' or not coalesce(v_membership_active, false) then
    v_blocks := v_blocks || 'WORKER_NOT_ACTIVE'::public.assignment_block_reason;
  end if;

  if not exists (
    select 1 from public.agency_worker_disciplines d
    where d.agency_worker_id = w.id and d.discipline_key = s.discipline_key
  ) then
    v_blocks := v_blocks || 'DISCIPLINE_MISMATCH'::public.assignment_block_reason;
  end if;

  -- Compliance on every local date the shift touches, for the shift's
  -- facility and discipline. The existing engine is the only rule source.
  with evaluated as (
    select d as evaluation_date, e.*
    from unnest(v_dates) d
    cross join lateral internal.evaluate_compliance(w.id, s.agency_facility_id, d, s.discipline_key) e
  ),
  findings as (
    select distinct on (coalesce(e.credential_type_key, ''), e.reason)
           e.requirement_scope, e.credential_type_key, e.reason, e.severity, e.evaluation_date, e.effective_expiry_date
    from evaluated e
    where e.severity <> 'ok'
    order by coalesce(e.credential_type_key, ''), e.reason, e.evaluation_date
  )
  select
    (select count(*) from evaluated e where e.severity = 'blocking'),
    (select count(*) from evaluated e where e.severity = 'warning'),
    coalesce((select array_agg(distinct f.reason order by f.reason) from findings f), '{}'),
    coalesce((select jsonb_agg(jsonb_build_object(
                'scope', f.requirement_scope,
                'credential_type_key', f.credential_type_key,
                'reason', f.reason,
                'severity', f.severity,
                'evaluation_date', f.evaluation_date,
                'effective_expiry_date', f.effective_expiry_date)
              order by f.severity desc, f.credential_type_key, f.reason)
              from findings f), '[]'::jsonb)
  into v_blocking, v_warning, v_reasons, v_findings;

  v_readiness := internal.readiness_from(v_blocking, v_warning);
  if v_readiness <> 'ready' and exists (
    select 1 from unnest(v_reasons) r where r <> 'WORKER_NOT_ACTIVE'
  ) then
    v_blocks := v_blocks || 'WORKER_NOT_ELIGIBLE'::public.assignment_block_reason;
  end if;

  -- Schedule: the PERSON (profile), across every agency. Half-open intervals.
  if exists (
    select 1 from public.shift_assignments a
    where a.profile_id = w.profile_id
      and a.status in ('assigned', 'accepted')
      and a.shift_id <> s.id
      and a.id is distinct from p_existing_assignment_id
      and a.period && tstzrange(s.start_at, s.end_at, '[)')
  ) then
    v_blocks := v_blocks || 'WORKER_SCHEDULE_CONFLICT'::public.assignment_block_reason;
  end if;

  return query select v_blocks, v_readiness, v_reasons, v_findings, v_dates;
end;
$$;

-- -----------------------------------------------------------------------------
-- Assign
-- -----------------------------------------------------------------------------
create function public.assign_worker_to_shift(p_shift_id uuid, p_agency_worker_id uuid)
returns table (
  outcome public.assignment_decision_outcome,
  assignment_id uuid,
  decision_id uuid,
  primary_reason public.assignment_block_reason,
  block_reasons public.assignment_block_reason[],
  compliance_reasons public.compliance_reason[],
  compliance_findings jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  s public.shifts;
  w public.agency_workers;
  e record;
  v_assignment_id uuid;
  v_decision_id uuid;
  v_outcome public.assignment_decision_outcome;
  v_can_see_compliance boolean;
begin
  s := internal.agency_shift(p_shift_id, 'assignment.manage', false);

  select * into w from public.agency_workers x
  where x.id = p_agency_worker_id and x.agency_organisation_id = s.agency_organisation_id;
  if w.id is null then
    raise exception 'worker not found' using errcode = 'CHW04';
  end if;
  if w.profile_id = v_profile_id then
    raise exception 'you cannot assign yourself' using errcode = 'CH403';
  end if;
  if not internal.consume_rate_limit('assignment.assign:' || v_profile_id, 600, interval '1 hour') then
    raise exception 'too many assignment attempts' using errcode = 'CH429';
  end if;

  -- 1) capacity lock (shift row), 2) schedule lock (person). Always in this order.
  select * into s from public.shifts x where x.id = p_shift_id for update;
  if s.status <> 'open' or s.end_at <= now() then
    raise exception 'shift is not open' using errcode = 'CHS09';
  end if;
  perform internal.require_active_relationship(s.relationship_id);
  perform internal.profile_schedule_lock(w.profile_id);

  select * into e from internal.assignment_eligibility(s.id, w.id, null);
  v_outcome := case when cardinality(e.block_reasons) = 0 then 'allowed'::public.assignment_decision_outcome else 'refused'::public.assignment_decision_outcome end;

  if v_outcome = 'allowed' then
    insert into public.shift_assignments as a (
      shift_id, agency_organisation_id, agency_worker_id, profile_id, start_at, end_at, assigned_by_membership_id
    ) values (
      s.id, s.agency_organisation_id, w.id, w.profile_id, s.start_at, s.end_at,
      internal.active_membership_id(s.agency_organisation_id)
    )
    returning a.id into v_assignment_id;
  end if;

  insert into public.assignment_eligibility_decisions as d (
    agency_organisation_id, shift_id, agency_worker_id, assignment_id, actor_membership_id, outcome,
    block_reasons, readiness, compliance_reasons, compliance_findings, evaluation_dates, engine_version
  ) values (
    s.agency_organisation_id, s.id, w.id, v_assignment_id, internal.active_membership_id(s.agency_organisation_id),
    v_outcome, e.block_reasons, e.readiness, e.compliance_reasons, e.compliance_findings, e.evaluation_dates,
    'compliance-engine.p0-e5-s1'
  )
  returning d.id into v_decision_id;

  if v_outcome = 'allowed' then
    perform internal.record_audit_event('assignment.created', s.agency_organisation_id, 'shift_assignment',
      v_assignment_id, jsonb_build_object('shift_id', s.id, 'agency_worker_id', w.id, 'decision_id', v_decision_id));
    perform internal.enqueue_notification('worker_assigned', s.agency_organisation_id, w.profile_id, null,
      'shift_assignment', v_assignment_id);
  else
    if e.block_reasons && array['WORKER_NOT_ACTIVE', 'DISCIPLINE_MISMATCH', 'WORKER_NOT_ELIGIBLE']::public.assignment_block_reason[] then
      perform internal.record_audit_event('assignment.rejected_by_compliance', s.agency_organisation_id, 'shift',
        s.id, jsonb_build_object('agency_worker_id', w.id, 'decision_id', v_decision_id,
                                 'block_reasons', to_jsonb(e.block_reasons), 'compliance_reasons', to_jsonb(e.compliance_reasons)));
    end if;
    if 'WORKER_SCHEDULE_CONFLICT' = any (e.block_reasons) then
      perform internal.record_audit_event('assignment.rejected_by_conflict', s.agency_organisation_id, 'shift',
        s.id, jsonb_build_object('agency_worker_id', w.id, 'decision_id', v_decision_id));
    end if;
    if not e.block_reasons && array['WORKER_NOT_ACTIVE', 'DISCIPLINE_MISMATCH', 'WORKER_NOT_ELIGIBLE',
                                    'WORKER_SCHEDULE_CONFLICT']::public.assignment_block_reason[] then
      perform internal.record_audit_event('assignment.rejected_by_capacity', s.agency_organisation_id, 'shift',
        s.id, jsonb_build_object('agency_worker_id', w.id, 'decision_id', v_decision_id,
                                 'block_reasons', to_jsonb(e.block_reasons)));
    end if;
  end if;

  -- Compliance detail only for callers entitled to see it.
  v_can_see_compliance := authz.has_capability(s.agency_organisation_id, 'compliance.view');
  return query select
    v_outcome, v_assignment_id, v_decision_id, e.block_reasons[1], e.block_reasons,
    case when v_can_see_compliance then e.compliance_reasons else '{}'::public.compliance_reason[] end,
    case when v_can_see_compliance then e.compliance_findings else '[]'::jsonb end;
end;
$$;

-- -----------------------------------------------------------------------------
-- Worker: accept / decline own assignment
-- -----------------------------------------------------------------------------
create function internal.own_assignment(p_assignment_id uuid)
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
  select * into a from public.shift_assignments x where x.id = p_assignment_id for update;
  return a;
end;
$$;

create function public.accept_shift_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.shift_assignments := internal.own_assignment(p_assignment_id);
  s public.shifts;
  e record;
begin
  if a.status <> 'assigned' then
    raise exception 'assignment cannot be accepted in its current state' using errcode = 'CHA09';
  end if;
  select * into s from public.shifts x where x.id = a.shift_id;
  if s.status <> 'open' or s.end_at <= now() then
    raise exception 'shift is not open' using errcode = 'CHS09';
  end if;
  perform internal.require_active_relationship(s.relationship_id);
  perform internal.profile_schedule_lock(a.profile_id);

  -- Eligibility can change after assignment: re-check live before accepting.
  select * into e from internal.assignment_eligibility(s.id, a.agency_worker_id, a.id);
  if 'WORKER_NOT_ACTIVE' = any (e.block_reasons) then
    raise exception 'worker is not active' using errcode = 'CHS13';
  elsif 'DISCIPLINE_MISMATCH' = any (e.block_reasons) then
    raise exception 'discipline does not match the shift' using errcode = 'CHS12';
  elsif 'WORKER_NOT_ELIGIBLE' = any (e.block_reasons) then
    raise exception 'worker is not eligible for this shift' using errcode = 'CHS14';
  elsif 'WORKER_SCHEDULE_CONFLICT' = any (e.block_reasons) then
    raise exception 'worker has a scheduling conflict' using errcode = 'CHS15';
  end if;

  update public.shift_assignments x set status = 'accepted', accepted_at = now() where x.id = a.id;
  perform internal.record_audit_event('assignment.accepted', a.agency_organisation_id, 'shift_assignment', a.id,
    jsonb_build_object('shift_id', a.shift_id));
end;
$$;

create function public.decline_shift_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.shift_assignments := internal.own_assignment(p_assignment_id);
begin
  if a.status <> 'assigned' then
    raise exception 'assignment cannot be declined in its current state' using errcode = 'CHA09';
  end if;
  update public.shift_assignments x set status = 'declined', declined_at = now() where x.id = a.id;
  perform internal.record_audit_event('assignment.declined', a.agency_organisation_id, 'shift_assignment', a.id,
    jsonb_build_object('shift_id', a.shift_id));
  perform internal.enqueue_notification('assignment_declined', a.agency_organisation_id, null,
    a.agency_organisation_id, 'shift_assignment', a.id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Agency: cancel an assignment
-- -----------------------------------------------------------------------------
create function public.cancel_shift_assignment(p_assignment_id uuid, p_reason public.assignment_cancellation_reason)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  a public.shift_assignments;
begin
  select * into a from public.shift_assignments x where x.id = p_assignment_id;
  if a.id is null or not authz.has_capability(a.agency_organisation_id, 'assignment.view') then
    raise exception 'assignment not found' using errcode = 'CHA04';
  end if;
  perform internal.require_capability(a.agency_organisation_id, 'assignment.manage');
  if p_reason is null or p_reason = 'shift_cancelled' then
    raise exception 'choose a cancellation reason' using errcode = 'CH400';
  end if;
  select * into a from public.shift_assignments x where x.id = p_assignment_id for update;
  if a.status not in ('assigned', 'accepted') then
    raise exception 'assignment cannot be cancelled in its current state' using errcode = 'CHA09';
  end if;

  update public.shift_assignments x
     set status = 'cancelled', cancelled_at = now(), cancellation_reason = p_reason, cancelled_by_profile_id = v_profile_id
   where x.id = a.id;
  perform internal.record_audit_event('assignment.cancelled', a.agency_organisation_id, 'shift_assignment', a.id,
    jsonb_build_object('shift_id', a.shift_id, 'reason', p_reason));
  perform internal.enqueue_notification('assignment_cancelled', a.agency_organisation_id, a.profile_id, null,
    'shift_assignment', a.id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Candidate workers for a shift. NO ranking: alphabetical by display name.
-- -----------------------------------------------------------------------------
create function public.list_shift_candidates(p_shift_id uuid)
returns table (
  agency_worker_id uuid,
  display_name text,
  worker_status public.worker_status,
  assignable boolean,
  primary_reason public.assignment_block_reason,
  block_reasons public.assignment_block_reason[],
  readiness public.readiness_status,
  compliance_reasons public.compliance_reason[],
  compliance_findings jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  s public.shifts;
begin
  select * into s from public.shifts x where x.id = p_shift_id;
  if s.id is null or not authz.has_capability(s.agency_organisation_id, 'shift.view') then
    raise exception 'shift not found' using errcode = 'CHS04';
  end if;
  perform internal.require_capability(s.agency_organisation_id, 'assignment.manage');
  perform internal.require_capability(s.agency_organisation_id, 'compliance.view');

  return query
    select w.id, p.display_name, w.status, cardinality(e.block_reasons) = 0, e.block_reasons[1], e.block_reasons,
           e.readiness, e.compliance_reasons, e.compliance_findings
    from public.agency_workers w
    join public.profiles p on p.id = w.profile_id
    cross join lateral internal.assignment_eligibility(s.id, w.id, null) e
    where w.agency_organisation_id = s.agency_organisation_id
      and w.status <> 'terminated'
      and w.profile_id <> v_profile_id
      and not exists (
        select 1 from public.shift_assignments a
        where a.shift_id = s.id and a.agency_worker_id = w.id and a.status in ('assigned', 'accepted'))
    order by p.display_name collate "C", w.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Re-evaluation primitive: live readiness of active assignments.
-- -----------------------------------------------------------------------------
create function public.list_assignment_readiness(
  p_organisation_id uuid,
  p_shift_id uuid default null,
  p_from timestamptz default null,
  p_until timestamptz default null
)
returns table (
  assignment_id uuid,
  shift_id uuid,
  agency_worker_id uuid,
  display_name text,
  status public.assignment_status,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  relationship_active boolean,
  eligible boolean,
  readiness public.readiness_status,
  block_reasons public.assignment_block_reason[],
  compliance_reasons public.compliance_reason[],
  compliance_findings jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'assignment.view');
  perform internal.require_capability(p_organisation_id, 'compliance.view');

  return query
    select a.id, a.shift_id, a.agency_worker_id, p.display_name, a.status, s.start_at, s.end_at, s.timezone,
           r.status = 'active',
           cardinality(e.block_reasons) = 0 and r.status = 'active',
           e.readiness, e.block_reasons, e.compliance_reasons, e.compliance_findings
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
    join public.agency_facility_relationships r on r.id = s.relationship_id
    join public.agency_workers w on w.id = a.agency_worker_id
    join public.profiles p on p.id = w.profile_id
    cross join lateral internal.assignment_eligibility(s.id, a.agency_worker_id, a.id) e
    where a.agency_organisation_id = p_organisation_id
      and a.status in ('assigned', 'accepted')
      and s.status = 'open'
      and (p_shift_id is null or a.shift_id = p_shift_id)
      and s.end_at > coalesce(p_from, now())
      and (p_until is null or s.start_at < p_until)
    order by s.start_at, p.display_name collate "C";
end;
$$;

-- Hook for a future scheduler (pg_cron / Edge Function): enqueue one pending
-- "assignment no longer compliant" alert per affected upcoming assignment.
create function internal.scan_assignment_readiness(p_within interval default interval '14 days')
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
    select a.id, a.agency_organisation_id
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
    join public.agency_facility_relationships r on r.id = s.relationship_id
    cross join lateral internal.assignment_eligibility(s.id, a.agency_worker_id, a.id) e
    where a.status in ('assigned', 'accepted')
      and s.status = 'open'
      and s.end_at > now()
      and s.start_at < now() + p_within
      and (cardinality(e.block_reasons) > 0 or r.status <> 'active')
  loop
    perform internal.enqueue_notification('assignment_non_compliant', v_row.agency_organisation_id, null,
      v_row.agency_organisation_id, 'shift_assignment', v_row.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function
  internal.profile_schedule_lock(uuid),
  internal.assignment_eligibility(uuid, uuid, uuid),
  internal.own_assignment(uuid),
  internal.scan_assignment_readiness(interval)
from public, anon, authenticated;

revoke all on function
  public.assign_worker_to_shift(uuid, uuid),
  public.accept_shift_assignment(uuid),
  public.decline_shift_assignment(uuid),
  public.cancel_shift_assignment(uuid, public.assignment_cancellation_reason),
  public.list_shift_candidates(uuid),
  public.list_assignment_readiness(uuid, uuid, timestamptz, timestamptz)
from public, anon;

grant execute on function
  public.assign_worker_to_shift(uuid, uuid),
  public.accept_shift_assignment(uuid),
  public.decline_shift_assignment(uuid),
  public.cancel_shift_assignment(uuid, public.assignment_cancellation_reason),
  public.list_shift_candidates(uuid),
  public.list_assignment_readiness(uuid, uuid, timestamptz, timestamptz)
to authenticated;
