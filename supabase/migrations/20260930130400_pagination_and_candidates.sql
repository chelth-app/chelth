-- =============================================================================
-- Migration: pagination_and_candidates
-- Stage:     P0-E5-S2
--
-- Purpose
--   1. Keyset-paginated shift lists (stable order, no OFFSET):
--        list_agency_shifts_page     (start_at, id) ascending
--        list_facility_shifts_page   (start_at, id) descending
--   2. Scalable candidate evaluation, list_shift_candidates_page:
--        a set-based PRE-FILTER removes structurally impossible candidates
--        (inactive worker/membership, missing discipline, already assigned,
--        overlapping active assignment) with plain SQL; only survivors are
--        evaluated by the CANONICAL internal.assignment_eligibility. No
--        compliance rule is re-implemented, nothing is cached, no ranking
--        (alphabetical keyset by display name, id).
--   3. accept_shift_assignment follows the stage lock order
--      (relationship → assignment).
-- =============================================================================

create function public.list_agency_shifts_page(
  p_organisation_id uuid,
  p_status public.shift_status default null,
  p_agency_facility_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 25,
  p_after_start_at timestamptz default null,
  p_after_id uuid default null
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
  external_reference text,
  open_issue_count integer
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
  if (p_after_start_at is null) <> (p_after_id is null) then
    raise exception 'invalid cursor' using errcode = 'CH400';
  end if;
  return query
    select s.id, s.agency_facility_id, f.name, l.name, s.discipline_key, d.name, s.start_at, s.end_at, s.timezone,
           s.requested_headcount, c.active, c.accepted,
           case when c.active = 0 then 'unfilled' when c.active < s.requested_headcount then 'partially_filled'
                else 'filled' end,
           s.status, s.source, r.status, s.external_reference,
           (select count(*) from public.assignment_issues i where i.shift_id = s.id and i.status = 'open')::integer
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
      and (p_after_start_at is null or (s.start_at, s.id) > (p_after_start_at, p_after_id))
    order by s.start_at, s.id
    limit least(greatest(coalesce(p_limit, 25), 1), 101);
end;
$$;

create function public.list_facility_shifts_page(
  p_facility_organisation_id uuid,
  p_limit integer default 25,
  p_before_start_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  shift_id uuid,
  relationship_id uuid,
  agency_name text,
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
  instructions text,
  external_reference text,
  cancellation_reason public.shift_cancellation_reason,
  relationship_status public.relationship_status
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_facility_organisation_id, 'shift.view');
  if (p_before_start_at is null) <> (p_before_id is null) then
    raise exception 'invalid cursor' using errcode = 'CH400';
  end if;
  return query
    select s.id, r.id, o.name, l.name, s.discipline_key, d.name, s.start_at, s.end_at, s.timezone,
           s.requested_headcount, c.active, c.accepted,
           case when c.active = 0 then 'unfilled' when c.active < s.requested_headcount then 'partially_filled'
                else 'filled' end,
           s.status, s.source, s.instructions, s.external_reference, s.cancellation_reason, r.status
    from public.agency_facilities f
    join public.agency_facility_relationships r
      on r.agency_facility_id = f.id and r.agency_organisation_id = f.agency_organisation_id
    join public.shifts s on s.relationship_id = r.id
    join public.organisations o on o.id = r.agency_organisation_id
    join public.facility_locations l on l.id = s.facility_location_id
    join public.disciplines d on d.key = s.discipline_key
    cross join lateral (
      select count(*) filter (where a.status in ('assigned', 'accepted'))::integer as active,
             count(*) filter (where a.status = 'accepted')::integer as accepted
      from public.shift_assignments a where a.shift_id = s.id
    ) c
    where f.linked_facility_organisation_id = p_facility_organisation_id
      and r.status <> 'ended'
      and authz.has_relationship_capability(r.id, 'shift.view')
      and s.status <> 'draft'
      and (p_before_start_at is null or (s.start_at, s.id) < (p_before_start_at, p_before_id))
    order by s.start_at desc, s.id desc
    limit least(greatest(coalesce(p_limit, 25), 1), 101);
end;
$$;

-- -----------------------------------------------------------------------------
-- Candidates: pre-filter (set-based), then canonical evaluation of survivors.
--   p_include_unavailable = false: only assignable workers (the default UI).
--   p_include_unavailable = true:  every candidate; structurally blocked ones
--     carry their cheap reason and readiness NULL ("not evaluated").
-- -----------------------------------------------------------------------------
create function public.list_shift_candidates_page(
  p_shift_id uuid,
  p_include_unavailable boolean default false,
  p_limit integer default 50,
  p_after_name text default null,
  p_after_id uuid default null
)
returns table (
  agency_worker_id uuid,
  display_name text,
  worker_status public.worker_status,
  assignable boolean,
  primary_reason public.assignment_block_reason,
  block_reasons public.assignment_block_reason[],
  readiness public.readiness_status,
  compliance_reasons public.compliance_reason[],
  compliance_findings jsonb,
  has_live_offer boolean
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
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 101);
  v_returned integer := 0;
  v_scanned integer := 0;
  c record;
  e record;
  v_blocks public.assignment_block_reason[];
begin
  select * into s from public.shifts x where x.id = p_shift_id;
  if s.id is null or not authz.has_capability(s.agency_organisation_id, 'shift.view') then
    raise exception 'shift not found' using errcode = 'CHS04';
  end if;
  perform internal.require_capability(s.agency_organisation_id, 'assignment.manage');
  perform internal.require_capability(s.agency_organisation_id, 'compliance.view');

  for c in
    select w.id, p.display_name, w.status,
           (w.status = 'active' and m.status = 'active') as is_active,
           exists (select 1 from public.agency_worker_disciplines d
                   where d.agency_worker_id = w.id and d.discipline_key = s.discipline_key) as has_discipline,
           exists (select 1 from public.shift_assignments a
                   where a.profile_id = w.profile_id and a.status in ('assigned', 'accepted')
                     and a.shift_id <> s.id and a.period && tstzrange(s.start_at, s.end_at, '[)')) as has_conflict,
           exists (select 1 from public.shift_offers o
                   where o.shift_id = s.id and o.agency_worker_id = w.id and o.status = 'offered') as has_offer
    from public.agency_workers w
    join public.profiles p on p.id = w.profile_id
    join public.organisation_memberships m on m.id = w.membership_id
    where w.agency_organisation_id = s.agency_organisation_id
      and w.status <> 'terminated'
      and w.profile_id <> v_profile_id
      and not exists (select 1 from public.shift_assignments a
                      where a.shift_id = s.id and a.agency_worker_id = w.id and a.status in ('assigned', 'accepted'))
      and (p_after_id is null
           or (coalesce(p.display_name, '') collate "C", w.id) > (coalesce(p_after_name, '') collate "C", p_after_id))
    order by coalesce(p.display_name, '') collate "C", w.id
  loop
    exit when v_returned >= v_limit or v_scanned >= 2000;
    v_scanned := v_scanned + 1;

    if not (c.is_active and c.has_discipline and not c.has_conflict) then
      -- Structurally impossible: no compliance evaluation needed.
      if p_include_unavailable then
        v_blocks := '{}'::public.assignment_block_reason[];
        if not c.is_active then v_blocks := v_blocks || 'WORKER_NOT_ACTIVE'::public.assignment_block_reason; end if;
        if not c.has_discipline then v_blocks := v_blocks || 'DISCIPLINE_MISMATCH'::public.assignment_block_reason; end if;
        if c.has_conflict then v_blocks := v_blocks || 'WORKER_SCHEDULE_CONFLICT'::public.assignment_block_reason; end if;
        v_returned := v_returned + 1;
        return query select c.id, c.display_name, c.status, false, v_blocks[1], v_blocks,
                            null::public.readiness_status, '{}'::public.compliance_reason[], '[]'::jsonb, c.has_offer;
      end if;
      continue;
    end if;

    select * into e from internal.assignment_eligibility(s.id, c.id, null);
    if cardinality(e.block_reasons) = 0 or p_include_unavailable then
      v_returned := v_returned + 1;
      return query select c.id, c.display_name, c.status, cardinality(e.block_reasons) = 0, e.block_reasons[1],
                          e.block_reasons, e.readiness, e.compliance_reasons, e.compliance_findings, c.has_offer;
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Worker acceptance of a direct assignment (P0-E5-S1 contract), lock order fixed.
-- -----------------------------------------------------------------------------
create or replace function public.accept_shift_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.shift_assignments;
  s public.shifts;
  e record;
begin
  perform internal.require_identity();
  select * into a from public.shift_assignments x where x.id = p_assignment_id;
  if a.id is null or not authz.is_own_active_worker(a.agency_worker_id) then
    raise exception 'assignment not found' using errcode = 'CHA04';
  end if;
  select * into s from public.shifts x where x.id = a.shift_id;
  if a.status <> 'assigned' then
    raise exception 'assignment cannot be accepted in its current state' using errcode = 'CHA09';
  end if;
  if s.status <> 'open' or s.end_at <= now() then
    raise exception 'shift is not open' using errcode = 'CHS09';
  end if;
  perform internal.require_active_relationship(s.relationship_id);
  select * into a from public.shift_assignments x where x.id = p_assignment_id for update;
  if a.status <> 'assigned' then
    raise exception 'assignment cannot be accepted in its current state' using errcode = 'CHA09';
  end if;
  perform internal.profile_schedule_lock(a.profile_id);

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

revoke all on function
  public.list_agency_shifts_page(uuid, public.shift_status, uuid, date, date, integer, timestamptz, uuid),
  public.list_facility_shifts_page(uuid, integer, timestamptz, uuid),
  public.list_shift_candidates_page(uuid, boolean, integer, text, uuid)
from public, anon;

grant execute on function
  public.list_agency_shifts_page(uuid, public.shift_status, uuid, date, date, integer, timestamptz, uuid),
  public.list_facility_shifts_page(uuid, integer, timestamptz, uuid),
  public.list_shift_candidates_page(uuid, boolean, integer, text, uuid)
to authenticated;
