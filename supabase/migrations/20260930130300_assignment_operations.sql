-- =============================================================================
-- Migration: assignment_operations
-- Stage:     P0-E5-S2
--
-- Purpose
--   1. One assignment core, internal.perform_assignment, used by direct
--      assignment AND offer acceptance: shift row lock → relationship share
--      lock → person advisory lock → canonical eligibility → decision record →
--      assignment. public.assign_worker_to_shift now delegates to it.
--   2. Shift offers: offer (broadcast to up to 50 workers), accept (full live
--      gate), decline, withdraw, expire. Offers reserve no headcount; when a
--      shift fills, remaining live offers close as `shift_filled`.
--   3. Assignment readiness monitoring: issues open/update/resolve from the
--      canonical eligibility function; scheduled scan over a bounded horizon;
--      manual re-check; notifications to agency operations on issue open.
--   4. Relationship suspension/ending as one transactional operation.
--
--   Lock order everywhere: relationship row (share) → shift row → person
--   (advisory) → offer rows. Relationship status changes take the
--   relationship row FOR UPDATE first, so they serialise with in-flight
--   assignments and offers without deadlocking. open_shift is redefined
--   below to follow the same order.
--
--   Structured errors added: CHO04 OFFER_NOT_FOUND · CHO09 OFFER_NOT_ACTIONABLE ·
--   CHO10 OFFER_EXPIRED.
--
-- Verified by: supabase/tests/security/150_offers.test.sql,
--              160_issues_and_relationships.test.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Relationship check now takes a SHARE lock so a concurrent status change
-- (which locks FOR UPDATE) cannot interleave with new operational work.
-- -----------------------------------------------------------------------------
create or replace function internal.require_active_relationship(p_relationship_id uuid)
returns public.agency_facility_relationships
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.agency_facility_relationships;
begin
  select * into r from public.agency_facility_relationships x where x.id = p_relationship_id for share;
  if r.id is null or r.status <> 'active' then
    raise exception 'the agency-facility relationship is not active' using errcode = 'CHS10';
  end if;
  return r;
end;
$$;

-- -----------------------------------------------------------------------------
-- Offer closing helper
-- -----------------------------------------------------------------------------
create function internal.close_live_offers(
  p_shift_id uuid,
  p_reason public.shift_offer_close_reason,
  p_only_worker uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.shift_offers o
     set status = 'cancelled', closed_at = now(), close_reason = p_reason
   where o.shift_id = p_shift_id and o.status = 'offered'
     and (p_only_worker is null or o.agency_worker_id = p_only_worker);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Shift cancelled/completed or headcount reduced to the active count → close offers.
create function internal.close_offers_on_shift_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('cancelled', 'completed') then
    perform internal.close_live_offers(new.id,
      case when new.status = 'cancelled' then 'shift_cancelled'::public.shift_offer_close_reason
           else 'shift_closed'::public.shift_offer_close_reason end);
  elsif new.requested_headcount < old.requested_headcount
        and (select count(*) from public.shift_assignments a
             where a.shift_id = new.id and a.status in ('assigned', 'accepted')) >= new.requested_headcount then
    perform internal.close_live_offers(new.id, 'shift_filled');
  end if;
  return null;
end;
$$;

create trigger shifts_close_offers
  after update on public.shifts
  for each row execute function internal.close_offers_on_shift_change();

-- -----------------------------------------------------------------------------
-- Assignment core (callers authorize first)
-- -----------------------------------------------------------------------------
create function internal.perform_assignment(
  p_shift_id uuid,
  p_agency_worker_id uuid,
  p_assigned_by_membership_id uuid,
  p_offer_id uuid default null
)
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
  s public.shifts;
  w public.agency_workers;
  e record;
  v_assignment_id uuid;
  v_decision_id uuid;
  v_outcome public.assignment_decision_outcome;
  v_active integer;
begin
  -- Lock order: 1) relationship (share), 2) shift row (capacity), 3) person.
  select * into s from public.shifts x where x.id = p_shift_id;
  if s.id is null then
    raise exception 'shift is not open' using errcode = 'CHS09';
  end if;
  perform internal.require_active_relationship(s.relationship_id);
  select * into s from public.shifts x where x.id = p_shift_id for update;
  if s.status <> 'open' or s.end_at <= now() then
    raise exception 'shift is not open' using errcode = 'CHS09';
  end if;
  select * into w from public.agency_workers x
  where x.id = p_agency_worker_id and x.agency_organisation_id = s.agency_organisation_id;
  if w.id is null then
    raise exception 'worker not found' using errcode = 'CHW04';
  end if;
  perform internal.profile_schedule_lock(w.profile_id);

  select * into e from internal.assignment_eligibility(s.id, w.id, null);
  v_outcome := case when cardinality(e.block_reasons) = 0 then 'allowed'::public.assignment_decision_outcome
                    else 'refused'::public.assignment_decision_outcome end;

  if v_outcome = 'allowed' then
    insert into public.shift_assignments as a (
      shift_id, agency_organisation_id, agency_worker_id, profile_id, start_at, end_at, assigned_by_membership_id
    ) values (
      s.id, s.agency_organisation_id, w.id, w.profile_id, s.start_at, s.end_at, p_assigned_by_membership_id
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
      v_assignment_id, jsonb_build_object('shift_id', s.id, 'agency_worker_id', w.id, 'decision_id', v_decision_id,
                                          'via', case when p_offer_id is null then 'direct' else 'offer' end));
    if p_offer_id is null then
      -- A worker assigned directly no longer needs an open offer for this shift.
      perform internal.close_live_offers(s.id, 'assigned_directly', w.id);
      perform internal.enqueue_notification('worker_assigned', s.agency_organisation_id, w.profile_id, null,
        'shift_assignment', v_assignment_id, '{}'::jsonb, s.end_at);
    else
      update public.shift_offers o
         set status = 'accepted', responded_at = now(), assignment_id = v_assignment_id
       where o.id = p_offer_id;
      -- The worker consented by accepting the offer: no second acceptance step.
      update public.shift_assignments x set status = 'accepted', accepted_at = now() where x.id = v_assignment_id;
      perform internal.record_audit_event('assignment.accepted', s.agency_organisation_id, 'shift_assignment',
        v_assignment_id, jsonb_build_object('shift_id', s.id, 'via', 'offer'));
      perform internal.record_audit_event('shift.offer_accepted', s.agency_organisation_id, 'shift_offer',
        p_offer_id, jsonb_build_object('shift_id', s.id, 'assignment_id', v_assignment_id));
    end if;

    select count(*) into v_active from public.shift_assignments a
    where a.shift_id = s.id and a.status in ('assigned', 'accepted');
    if v_active >= s.requested_headcount then
      perform internal.close_live_offers(s.id, 'shift_filled');
    end if;
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
      -- A full shift makes the offer pointless.
      if p_offer_id is not null and 'SHIFT_FULL' = any (e.block_reasons) then
        perform internal.close_live_offers(s.id, 'shift_filled', w.id);
      end if;
    end if;
  end if;

  return query select v_outcome, v_assignment_id, v_decision_id, e.block_reasons[1], e.block_reasons,
                      e.compliance_reasons, e.compliance_findings;
end;
$$;

-- Direct assignment: same contract as P0-E5-S1, now through the shared core.
create or replace function public.assign_worker_to_shift(p_shift_id uuid, p_agency_worker_id uuid)
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
  r record;
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

  select * into r from internal.perform_assignment(s.id, w.id, internal.active_membership_id(s.agency_organisation_id));
  v_can_see_compliance := authz.has_capability(s.agency_organisation_id, 'compliance.view');
  return query select r.outcome, r.assignment_id, r.decision_id, r.primary_reason, r.block_reasons,
    case when v_can_see_compliance then r.compliance_reasons else '{}'::public.compliance_reason[] end,
    case when v_can_see_compliance then r.compliance_findings else '[]'::jsonb end;
end;
$$;

-- -----------------------------------------------------------------------------
-- Offers
-- -----------------------------------------------------------------------------
create function public.offer_shift_to_workers(
  p_shift_id uuid,
  p_agency_worker_ids uuid[],
  p_expires_in_minutes integer default 1440
)
returns table (agency_worker_id uuid, outcome text, offer_id uuid, reason text)
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
  v_worker_id uuid;
  v_expires timestamptz;
  v_offer_id uuid;
  v_membership uuid;
  v_active integer;
begin
  s := internal.agency_shift(p_shift_id, 'assignment.manage', false);
  perform internal.require_active_relationship(s.relationship_id);
  select * into s from public.shifts x where x.id = p_shift_id for update;
  if p_agency_worker_ids is null or cardinality(p_agency_worker_ids) not between 1 and 50 then
    raise exception 'offer to between 1 and 50 workers' using errcode = 'CH400';
  end if;
  if coalesce(p_expires_in_minutes, 0) not between 15 and 10080 then
    raise exception 'offer expiry must be between 15 minutes and 7 days' using errcode = 'CH400';
  end if;
  if s.status <> 'open' or s.start_at <= now() then
    raise exception 'offers are made only for open shifts that have not started' using errcode = 'CHS09';
  end if;
  select count(*) into v_active from public.shift_assignments a
  where a.shift_id = s.id and a.status in ('assigned', 'accepted');
  if v_active >= s.requested_headcount then
    raise exception 'shift is full' using errcode = 'CHS16';
  end if;
  if not internal.consume_rate_limit('shift.offer:' || v_profile_id, 500, interval '1 hour') then
    raise exception 'too many offers' using errcode = 'CH429';
  end if;

  -- Tenancy first, for the whole batch: no partial effects on a foreign id.
  if exists (
    select 1 from unnest(p_agency_worker_ids) as u (requested_id)
    where not exists (select 1 from public.agency_workers x
                      where x.id = u.requested_id and x.agency_organisation_id = s.agency_organisation_id)
  ) then
    raise exception 'worker not found' using errcode = 'CHW04';
  end if;

  v_expires := least(now() + make_interval(mins => p_expires_in_minutes), s.start_at);
  v_membership := internal.active_membership_id(s.agency_organisation_id);

  for v_worker_id in select distinct u.requested_id from unnest(p_agency_worker_ids) as u (requested_id) loop
    select * into w from public.agency_workers x where x.id = v_worker_id;
    if w.profile_id = v_profile_id then
      return query select w.id, 'skipped'::text, null::uuid, 'SELF'::text;
      continue;
    end if;
    if exists (select 1 from public.shift_offers o where o.shift_id = s.id and o.agency_worker_id = w.id
               and o.status = 'offered') then
      return query select w.id, 'skipped'::text, null::uuid, 'OFFER_ALREADY_EXISTS'::text;
      continue;
    end if;
    select * into e from internal.assignment_eligibility(s.id, w.id, null);
    if cardinality(e.block_reasons) > 0 then
      return query select w.id, 'skipped'::text, null::uuid, e.block_reasons[1]::text;
      continue;
    end if;

    insert into public.shift_offers as o
      (shift_id, agency_organisation_id, agency_worker_id, profile_id, expires_at, created_by_membership_id)
    values (s.id, s.agency_organisation_id, w.id, w.profile_id, v_expires, v_membership)
    returning o.id into v_offer_id;
    perform internal.record_audit_event('shift.offer_created', s.agency_organisation_id, 'shift_offer', v_offer_id,
      jsonb_build_object('shift_id', s.id, 'agency_worker_id', w.id));
    perform internal.enqueue_notification('shift_offered', s.agency_organisation_id, w.profile_id, null,
      'shift_offer', v_offer_id, '{}'::jsonb, v_expires);
    return query select w.id, 'offered'::text, v_offer_id, null::text;
  end loop;
end;
$$;

create function internal.own_offer(p_offer_id uuid)
returns public.shift_offers
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.shift_offers;
begin
  perform internal.require_identity();
  select * into o from public.shift_offers x where x.id = p_offer_id;
  if o.id is null or not authz.is_own_active_worker(o.agency_worker_id) then
    raise exception 'offer not found' using errcode = 'CHO04';
  end if;
  return o;
end;
$$;

-- Acceptance re-runs the FULL live gate (compliance, schedule, capacity).
-- Refusals return (the decision commits); state errors raise.
create function public.accept_shift_offer(p_offer_id uuid)
returns table (
  outcome public.assignment_decision_outcome,
  assignment_id uuid,
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
  o public.shift_offers := internal.own_offer(p_offer_id);
  r record;
begin
  -- Lock order: relationship (share) → shift → offer.
  perform internal.require_active_relationship((select x.relationship_id from public.shifts x where x.id = o.shift_id));
  perform 1 from public.shifts x where x.id = o.shift_id for update;
  select * into o from public.shift_offers x where x.id = p_offer_id for update;
  if o.status <> 'offered' then
    raise exception 'offer is no longer open' using errcode = 'CHO09';
  end if;
  if o.expires_at <= now() then
    raise exception 'offer has expired' using errcode = 'CHO10';
  end if;

  select * into r from internal.perform_assignment(o.shift_id, o.agency_worker_id, o.created_by_membership_id, o.id);
  -- The worker sees their own compliance anyway; findings are theirs.
  return query select r.outcome, r.assignment_id, r.primary_reason, r.block_reasons, r.compliance_reasons,
                      r.compliance_findings;
end;
$$;

create function public.decline_shift_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.shift_offers := internal.own_offer(p_offer_id);
begin
  select * into o from public.shift_offers x where x.id = p_offer_id for update;
  if o.status <> 'offered' then
    raise exception 'offer is no longer open' using errcode = 'CHO09';
  end if;
  update public.shift_offers x set status = 'declined', responded_at = now() where x.id = o.id;
  perform internal.record_audit_event('shift.offer_declined', o.agency_organisation_id, 'shift_offer', o.id,
    jsonb_build_object('shift_id', o.shift_id));
end;
$$;

create function public.cancel_shift_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.shift_offers;
begin
  perform internal.require_identity();
  select * into o from public.shift_offers x where x.id = p_offer_id;
  if o.id is null or not authz.has_capability(o.agency_organisation_id, 'assignment.view') then
    raise exception 'offer not found' using errcode = 'CHO04';
  end if;
  perform internal.require_capability(o.agency_organisation_id, 'assignment.manage');
  select * into o from public.shift_offers x where x.id = p_offer_id for update;
  if o.status <> 'offered' then
    raise exception 'offer is no longer open' using errcode = 'CHO09';
  end if;
  update public.shift_offers x set status = 'cancelled', closed_at = now(), close_reason = 'withdrawn'
   where x.id = o.id;
  perform internal.record_audit_event('shift.offer_cancelled', o.agency_organisation_id, 'shift_offer', o.id,
    jsonb_build_object('shift_id', o.shift_id, 'reason', 'withdrawn'));
end;
$$;

-- Scheduled: mark stale offers expired. Acceptance already refuses expired
-- offers deterministically; this only tidies state. Safe to repeat.
create function internal.expire_shift_offers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer record;
  v_count integer := 0;
begin
  for v_offer in
    update public.shift_offers o set status = 'expired', closed_at = now()
     where o.status = 'offered' and o.expires_at <= now()
    returning o.id, o.agency_organisation_id, o.shift_id
  loop
    v_count := v_count + 1;
    perform internal.record_audit_event('shift.offer_expired', v_offer.agency_organisation_id, 'shift_offer',
      v_offer.id, jsonb_build_object('shift_id', v_offer.shift_id));
  end loop;
  return v_count;
end;
$$;

create function public.list_my_shift_offers(p_organisation_id uuid)
returns table (
  offer_id uuid,
  facility_name text,
  location_name text,
  discipline_name text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  status public.shift_offer_status,
  expires_at timestamptz,
  can_respond boolean
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
    select o.id, f.name, l.name, d.name, s.start_at, s.end_at, s.timezone, o.status, o.expires_at,
           o.status = 'offered' and o.expires_at > now() and s.status = 'open'
    from public.shift_offers o
    join public.shifts s on s.id = o.shift_id
    join public.agency_facilities f on f.id = s.agency_facility_id
    join public.facility_locations l on l.id = s.facility_location_id
    join public.disciplines d on d.key = s.discipline_key
    where o.agency_organisation_id = p_organisation_id
      and authz.is_own_active_worker(o.agency_worker_id)
      and (o.status = 'offered' or o.updated_at > now() - interval '14 days')
    order by (o.status = 'offered' and o.expires_at > now()) desc, s.start_at, o.id
    limit 100;
end;
$$;

-- -----------------------------------------------------------------------------
-- Assignment readiness monitoring
-- -----------------------------------------------------------------------------
create function internal.set_issue(
  a public.shift_assignments,
  s public.shifts,
  p_type public.assignment_issue_type,
  p_present boolean,
  p_block_reasons public.assignment_block_reason[],
  p_compliance_reasons public.compliance_reason[],
  p_source public.assignment_issue_source
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issue public.assignment_issues;
  v_severity public.assignment_issue_severity :=
    case when a.status = 'accepted' or s.start_at < now() + interval '48 hours'
         then 'urgent'::public.assignment_issue_severity else 'attention'::public.assignment_issue_severity end;
begin
  select * into v_issue from public.assignment_issues i
  where i.assignment_id = a.id and i.issue_type = p_type and i.status = 'open'
  for update;

  if p_present and v_issue.id is null then
    insert into public.assignment_issues as i (
      agency_organisation_id, assignment_id, shift_id, issue_type, severity, block_reasons, compliance_reasons,
      detected_by
    ) values (
      a.agency_organisation_id, a.id, s.id, p_type, v_severity, p_block_reasons, p_compliance_reasons, p_source
    )
    on conflict do nothing
    returning i.* into v_issue;
    if v_issue.id is null then
      return 'none';
    end if;
    perform internal.record_audit_event('assignment.issue_opened', a.agency_organisation_id, 'assignment_issue',
      v_issue.id, jsonb_build_object('assignment_id', a.id, 'shift_id', s.id, 'issue_type', p_type,
                                     'severity', v_severity, 'block_reasons', to_jsonb(p_block_reasons),
                                     'detected_by', p_source));
    if p_type = 'not_eligible' then
      perform internal.enqueue_notification('assignment_non_compliant', a.agency_organisation_id, null,
        a.agency_organisation_id, 'shift_assignment', a.id, '{}'::jsonb, s.end_at);
    end if;
    return 'opened';
  elsif p_present then
    update public.assignment_issues i
       set last_evaluated_at = now(), block_reasons = p_block_reasons, compliance_reasons = p_compliance_reasons,
           severity = case when v_severity = 'urgent' then 'urgent'::public.assignment_issue_severity else i.severity end
     where i.id = v_issue.id;
    return 'updated';
  elsif v_issue.id is not null then
    update public.assignment_issues i
       set status = 'resolved', resolved_at = now(), last_evaluated_at = now(),
           resolution = case p_type when 'not_eligible' then 'eligible_again'::public.assignment_issue_resolution
                                    else 'relationship_restored'::public.assignment_issue_resolution end
     where i.id = v_issue.id;
    perform internal.record_audit_event('assignment.issue_resolved', a.agency_organisation_id, 'assignment_issue',
      v_issue.id, jsonb_build_object('assignment_id', a.id, 'issue_type', p_type, 'detected_by', p_source));
    return 'resolved';
  end if;
  return 'none';
end;
$$;

-- Evaluate one assignment; returns {opened, resolved} counts.
create function internal.evaluate_assignment_issues(p_assignment_id uuid, p_source public.assignment_issue_source)
returns integer[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.shift_assignments;
  s public.shifts;
  v_relationship_status public.relationship_status;
  e record;
  v_results text[] := '{}'::text[];
  v_issue record;
begin
  select * into a from public.shift_assignments x where x.id = p_assignment_id;
  select * into s from public.shifts x where x.id = a.shift_id;
  if a.id is null then
    return array[0, 0];
  end if;

  -- No longer operationally relevant: close any open issue.
  if a.status not in ('assigned', 'accepted') or s.status <> 'open' or s.end_at <= now() then
    for v_issue in
      update public.assignment_issues i
         set status = 'resolved', resolved_at = now(), last_evaluated_at = now(),
             resolution = case when a.status in ('assigned', 'accepted')
                               then 'shift_closed'::public.assignment_issue_resolution
                               else 'assignment_closed'::public.assignment_issue_resolution end
       where i.assignment_id = a.id and i.status = 'open'
      returning i.id, i.issue_type
    loop
      v_results := v_results || 'resolved'::text;
      perform internal.record_audit_event('assignment.issue_resolved', a.agency_organisation_id, 'assignment_issue',
        v_issue.id, jsonb_build_object('assignment_id', a.id, 'issue_type', v_issue.issue_type, 'detected_by', p_source));
    end loop;
  else
    select r.status into v_relationship_status from public.agency_facility_relationships r where r.id = s.relationship_id;
    select * into e from internal.assignment_eligibility(s.id, a.agency_worker_id, a.id);
    v_results := v_results
      || internal.set_issue(a, s, 'not_eligible', cardinality(e.block_reasons) > 0, e.block_reasons,
                            e.compliance_reasons, p_source)
      || internal.set_issue(a, s, 'relationship_not_active', v_relationship_status <> 'active',
                            '{}'::public.assignment_block_reason[], '{}'::public.compliance_reason[], p_source);
  end if;
  return array[
    (select count(*) from unnest(v_results) x where x = 'opened')::integer,
    (select count(*) from unnest(v_results) x where x = 'resolved')::integer];
end;
$$;

create table internal.scheduled_job_runs (
  id bigint generated always as identity primary key,
  job text not null check (job ~ '^[a-z][a-z_]{2,60}$'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result jsonb not null default '{}'::jsonb check (pg_column_size(result) <= 1024)
);
create index scheduled_job_runs_job_idx on internal.scheduled_job_runs (job, started_at desc);
alter table internal.scheduled_job_runs enable row level security;

-- Scheduled re-evaluation over a bounded horizon (default from settings).
-- Safe to run repeatedly: issues are opened once and resolved once.
create function internal.run_assignment_readiness_scan(
  p_within interval default null,
  p_source public.assignment_issue_source default 'scheduled_scan'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_horizon interval := coalesce(p_within, (select s.readiness_horizon from internal.operations_settings s));
  v_run bigint;
  v_id uuid;
  v_counts integer[];
  v_checked integer := 0;
  v_opened integer := 0;
  v_resolved integer := 0;
  v_result jsonb;
begin
  insert into internal.scheduled_job_runs (job) values ('assignment_readiness_scan') returning id into v_run;
  for v_id in
    select a.id
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
    where a.status in ('assigned', 'accepted') and s.status = 'open'
      and s.end_at > now() and s.start_at < now() + v_horizon
    union
    select i.assignment_id from public.assignment_issues i where i.status = 'open'
    limit 20000
  loop
    v_counts := internal.evaluate_assignment_issues(v_id, p_source);
    v_checked := v_checked + 1;
    v_opened := v_opened + v_counts[1];
    v_resolved := v_resolved + v_counts[2];
  end loop;
  v_result := jsonb_build_object('checked', v_checked, 'opened', v_opened, 'resolved', v_resolved,
                                 'horizon', v_horizon::text);
  update internal.scheduled_job_runs set finished_at = now(), result = v_result where id = v_run;
  return v_result;
end;
$$;

-- P0-E5-S1 hook, kept for compatibility: now drives issues (which enqueue once).
create or replace function internal.scan_assignment_readiness(p_within interval default interval '14 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return (internal.run_assignment_readiness_scan(p_within, 'scheduled_scan') ->> 'opened')::integer;
end;
$$;

-- Agency: re-check a shift's active assignments now.
create function public.recheck_shift_readiness(p_shift_id uuid)
returns table (checked integer, opened integer, resolved integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  s public.shifts := internal.agency_shift(p_shift_id, 'assignment.manage', false);
  v_id uuid;
  v_counts integer[];
  v_checked integer := 0;
  v_opened integer := 0;
  v_resolved integer := 0;
begin
  perform internal.require_capability(s.agency_organisation_id, 'compliance.view');
  for v_id in
    select a.id from public.shift_assignments a
    where a.shift_id = s.id
      and (a.status in ('assigned', 'accepted')
           or exists (select 1 from public.assignment_issues i where i.assignment_id = a.id and i.status = 'open'))
  loop
    v_counts := internal.evaluate_assignment_issues(v_id, 'manual_recheck');
    v_checked := v_checked + 1;
    v_opened := v_opened + v_counts[1];
    v_resolved := v_resolved + v_counts[2];
  end loop;
  perform internal.record_audit_event('assignment.readiness_rechecked', s.agency_organisation_id, 'shift', s.id,
    jsonb_build_object('checked', v_checked, 'opened', v_opened, 'resolved', v_resolved));
  return query select v_checked, v_opened, v_resolved;
end;
$$;

create function public.list_assignment_issues(p_organisation_id uuid, p_shift_id uuid default null)
returns table (
  issue_id uuid,
  assignment_id uuid,
  shift_id uuid,
  issue_type public.assignment_issue_type,
  severity public.assignment_issue_severity,
  block_reasons public.assignment_block_reason[],
  compliance_reasons public.compliance_reason[],
  detected_by public.assignment_issue_source,
  opened_at timestamptz,
  last_evaluated_at timestamptz,
  worker_name text,
  assignment_status public.assignment_status,
  facility_name text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text
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
    select i.id, i.assignment_id, i.shift_id, i.issue_type, i.severity, i.block_reasons, i.compliance_reasons,
           i.detected_by, i.opened_at, i.last_evaluated_at, p.display_name, a.status, f.name,
           s.start_at, s.end_at, s.timezone
    from public.assignment_issues i
    join public.shift_assignments a on a.id = i.assignment_id
    join public.shifts s on s.id = i.shift_id
    join public.agency_facilities f on f.id = s.agency_facility_id
    join public.agency_workers w on w.id = a.agency_worker_id
    join public.profiles p on p.id = w.profile_id
    where i.agency_organisation_id = p_organisation_id and i.status = 'open'
      and (p_shift_id is null or i.shift_id = p_shift_id)
    order by (i.severity = 'urgent') desc, s.start_at, i.id
    limit 200;
end;
$$;

-- -----------------------------------------------------------------------------
-- Relationship suspension / ending: one transactional operation.
--   suspended: no new work (CHS10 everywhere); live offers cancelled;
--              upcoming active assignments flagged (relationship_not_active
--              issues); agency operations notified. Nothing deleted, no
--              assignment cancelled.
--   ended:     additionally cancels NOT-YET-STARTED shifts (reason
--              relationship_ended; their assignments cancelled and workers
--              notified). In-progress shifts are kept and flagged.
--   active (from suspended): issues re-evaluated (resolved where restored).
-- -----------------------------------------------------------------------------
create or replace function public.set_facility_relationship_status(
  p_relationship_id uuid,
  p_status public.relationship_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_relationship public.agency_facility_relationships;
  v_linked_organisation_id uuid;
  v_shift record;
  v_assignment uuid;
  v_counts integer[];
  v_cancelled_offers integer := 0;
  v_cancelled_shifts integer := 0;
  v_flagged integer := 0;
  v_resolved integer := 0;
  v_upcoming integer := 0;
begin
  perform internal.require_identity();
  select * into v_relationship
  from public.agency_facility_relationships r
  where r.id = p_relationship_id
  for update;

  perform internal.require_capability(v_relationship.agency_organisation_id, 'relationship.manage');

  if not (
    (v_relationship.status = 'pending' and p_status in ('active', 'ended'))
    or (v_relationship.status = 'active' and p_status in ('suspended', 'ended'))
    or (v_relationship.status = 'suspended' and p_status in ('active', 'ended'))
  ) then
    raise exception 'relationship status change not allowed' using errcode = 'CHR09';
  end if;

  update public.agency_facility_relationships r
     set status = p_status,
         status_changed_at = now(),
         started_at = case when p_status = 'active' then coalesce(r.started_at, now()) else r.started_at end,
         ended_at = case when p_status = 'ended' then now() else r.ended_at end
   where r.id = p_relationship_id;

  perform internal.record_audit_event('relationship.status_changed', v_relationship.agency_organisation_id,
    'relationship', p_relationship_id, jsonb_build_object('from', v_relationship.status, 'to', p_status));

  select f.linked_facility_organisation_id into v_linked_organisation_id
  from public.agency_facilities f
  where f.id = v_relationship.agency_facility_id;

  if v_linked_organisation_id is not null then
    perform internal.record_audit_event('relationship.status_changed', v_linked_organisation_id,
      'relationship', p_relationship_id, jsonb_build_object('from', v_relationship.status, 'to', p_status));
  end if;

  if v_relationship.status = 'pending' then
    return;
  end if;

  -- Operational effects on upcoming work under this relationship.
  for v_shift in
    select s.id, s.start_at, s.status from public.shifts s
    where s.relationship_id = p_relationship_id
      and s.status in ('draft', 'submitted', 'open') and s.end_at > now()
    order by s.start_at
  loop
    v_upcoming := v_upcoming + 1;
    if p_status in ('suspended', 'ended') then
      v_cancelled_offers := v_cancelled_offers + internal.close_live_offers(v_shift.id, 'relationship_not_active');
    end if;

    if p_status = 'ended' and v_shift.start_at > now() then
      -- Not yet started: cancel through the normal shift path semantics.
      for v_assignment in
        update public.shift_assignments a
           set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'shift_cancelled',
               cancelled_by_profile_id = auth.uid()
         where a.shift_id = v_shift.id and a.status in ('assigned', 'accepted')
        returning a.id
      loop
        perform internal.enqueue_notification('shift_cancelled', v_relationship.agency_organisation_id,
          (select a.profile_id from public.shift_assignments a where a.id = v_assignment), null,
          'shift_assignment', v_assignment);
        perform internal.evaluate_assignment_issues(v_assignment, 'relationship_change');
      end loop;
      update public.shifts x
         set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'relationship_ended',
             cancelled_by_profile_id = auth.uid()
       where x.id = v_shift.id;
      v_cancelled_shifts := v_cancelled_shifts + 1;
    else
      for v_assignment in
        select a.id from public.shift_assignments a
        where a.shift_id = v_shift.id and a.status in ('assigned', 'accepted')
      loop
        v_counts := internal.evaluate_assignment_issues(v_assignment, 'relationship_change');
        v_flagged := v_flagged + v_counts[1];
        v_resolved := v_resolved + v_counts[2];
      end loop;
    end if;
  end loop;

  -- Counts only: no worker names or addresses in audit.
  perform internal.record_audit_event('relationship.operations_applied', v_relationship.agency_organisation_id,
    'relationship', p_relationship_id,
    jsonb_build_object('to', p_status, 'upcoming_shifts', v_upcoming, 'cancelled_shifts', v_cancelled_shifts,
                       'cancelled_offers', v_cancelled_offers, 'flagged_assignments', v_flagged,
                       'resolved_issues', v_resolved));

  if p_status in ('suspended', 'ended') and v_upcoming > 0 then
    perform internal.enqueue_notification(
      case when p_status = 'ended' then 'relationship_ended'::internal.notification_event
           else 'relationship_suspended'::internal.notification_event end,
      v_relationship.agency_organisation_id, null, v_relationship.agency_organisation_id,
      'relationship', p_relationship_id,
      jsonb_build_object('upcomingShifts', v_upcoming, 'cancelledShifts', v_cancelled_shifts,
                         'flaggedAssignments', v_flagged));
  end if;
end;
$$;

-- Upcoming shifts under relationships that are not active (operations surface).
create function public.list_relationship_affected_shifts(p_organisation_id uuid)
returns table (
  shift_id uuid,
  facility_name text,
  relationship_status public.relationship_status,
  status public.shift_status,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  active_count integer
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
    select s.id, f.name, r.status, s.status, s.start_at, s.end_at, s.timezone,
           (select count(*) from public.shift_assignments a
            where a.shift_id = s.id and a.status in ('assigned', 'accepted'))::integer
    from public.shifts s
    join public.agency_facility_relationships r on r.id = s.relationship_id
    join public.agency_facilities f on f.id = s.agency_facility_id
    where s.agency_organisation_id = p_organisation_id
      and r.status <> 'active'
      and s.status in ('draft', 'submitted', 'open')
      and s.end_at > now()
    order by s.start_at, s.id
    limit 200;
end;
$$;

-- open_shift (P0-E5-S1) redefined only to follow the lock order.
create or replace function public.open_shift(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  s public.shifts := internal.agency_shift(p_shift_id, 'shift.manage', false);
  v_linked uuid;
begin
  perform internal.require_active_relationship(s.relationship_id);
  select * into s from public.shifts x where x.id = p_shift_id for update;
  if s.status not in ('draft', 'submitted') then
    raise exception 'only draft or submitted shifts can be opened' using errcode = 'CH409';
  end if;
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
        'shift', s.id, '{}'::jsonb, s.end_at);
    end if;
  end if;
end;
$$;

revoke all on function
  internal.close_live_offers(uuid, public.shift_offer_close_reason, uuid),
  internal.close_offers_on_shift_change(),
  internal.perform_assignment(uuid, uuid, uuid, uuid),
  internal.own_offer(uuid),
  internal.expire_shift_offers(),
  internal.set_issue(public.shift_assignments, public.shifts, public.assignment_issue_type, boolean,
                     public.assignment_block_reason[], public.compliance_reason[], public.assignment_issue_source),
  internal.evaluate_assignment_issues(uuid, public.assignment_issue_source),
  internal.run_assignment_readiness_scan(interval, public.assignment_issue_source)
from public, anon, authenticated, service_role;

revoke all on function
  public.offer_shift_to_workers(uuid, uuid[], integer),
  public.accept_shift_offer(uuid),
  public.decline_shift_offer(uuid),
  public.cancel_shift_offer(uuid),
  public.list_my_shift_offers(uuid),
  public.recheck_shift_readiness(uuid),
  public.list_assignment_issues(uuid, uuid),
  public.list_relationship_affected_shifts(uuid)
from public, anon;

grant execute on function
  public.offer_shift_to_workers(uuid, uuid[], integer),
  public.accept_shift_offer(uuid),
  public.decline_shift_offer(uuid),
  public.cancel_shift_offer(uuid),
  public.list_my_shift_offers(uuid),
  public.recheck_shift_readiness(uuid),
  public.list_assignment_issues(uuid, uuid),
  public.list_relationship_affected_shifts(uuid)
to authenticated;
