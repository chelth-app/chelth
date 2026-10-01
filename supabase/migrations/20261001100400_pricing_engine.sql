-- =============================================================================
-- Migration: pricing_engine
-- Stage:     P0-E7-S1
--
-- Purpose
--   * internal.price_timesheet_revision — the ONE pricing engine. It prices a
--     LOCKED timesheet revision from its immutable approval snapshot using the
--     versioned rates and policies, and stores an immutable priced record.
--       1. lock the timesheet; require status locked and the expected revision
--          (CHM07 / CHM08); an existing pricing for (timesheet, revision) is
--          returned unchanged (idempotent);
--       2. read worked minutes ONLY from the approval snapshot, cross-checked
--          against the locked entry (divergence ⇒ CHM08);
--       3. resolve the rate per entry (precedence below), rounding by work
--          date, overtime per side by the period start;
--       4. any issue ⇒ nothing priced; the attempt is recorded in
--          pricing_blocks, audited, finance notified once per revision;
--       5. otherwise insert header + lines and audit.
--   * Rate precedence (first tier with a matching CARD decides; a card with no
--     version effective on the work date ⇒ RATE_NOT_CONFIGURED, no fallback):
--       1 relationship + discipline + classification
--       2 relationship + discipline (any classification)
--       3 all facilities + discipline + classification
--       4 all facilities + discipline (any classification)
--   * Arithmetic (calculation version 1): integers only.
--       priced minutes = raw, or round-half-up(raw / N) × N
--       amount_minor   = round-half-up( rate_minor × (regular × den + overtime × num) / (60 × den) )
--       round-half-up(a / b) = (2a + b) div (2b)   (a ≥ 0, b > 0)
--   * S7 (from P0-E6-S2): when a relationship ENDS, entries still awaiting its
--     facility's sign-off become not_required (history + audit); a timesheet
--     with nothing left pending locks. Facility decisions take the
--     relationship lock first and are refused once it has ended.
--
--   Errors: CHM01 RATE_NOT_CONFIGURED · CHM02 RATE_AMBIGUOUS ·
--           CHM06 RATE_CURRENCY_MISMATCH · CHM07 TIMESHEET_NOT_LOCKED ·
--           CHM08 TIMESHEET_REVISION_CHANGED · CHM15 PRICING_NOT_FOUND
-- =============================================================================

create function internal.round_half_up_div(p_numerator numeric, p_denominator numeric)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select div(2 * p_numerator + p_denominator, 2 * p_denominator)::bigint
$$;

-- Regular minutes of an entry under a weekly threshold, given the minutes
-- already counted this week (chronological order). The rest is overtime.
create function internal.overtime_regular_minutes(p_counted integer, p_priced integer, p_threshold integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(0, least(p_priced, p_threshold - p_counted))
$$;

create type internal.rate_resolution as (
  rate_card_id uuid,
  rate_version_id uuid,
  precedence smallint,
  currency text,
  pay_rate_minor bigint,
  bill_rate_minor bigint,
  issue text
);

create function internal.resolve_rate(
  p_organisation_id uuid,
  p_relationship_id uuid,
  p_discipline_key text,
  p_classification public.shift_classification,
  p_work_date date
)
returns internal.rate_resolution
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r internal.rate_resolution;
  v_tier smallint;
  v_cards uuid[];
  v_versions integer;
begin
  foreach v_tier in array array[1, 2, 3, 4]::smallint[] loop
    select array_agg(c.id) into v_cards
    from public.rate_cards c
    where c.agency_organisation_id = p_organisation_id
      and c.discipline_key = p_discipline_key
      and (case when v_tier in (1, 2) then c.relationship_id = p_relationship_id else c.relationship_id is null end)
      and (case when v_tier in (1, 3) then c.classification = p_classification else c.classification is null end);
    if v_cards is null then
      continue;
    end if;
    r.precedence := v_tier;
    if cardinality(v_cards) > 1 then
      r.issue := 'RATE_AMBIGUOUS';
      return r;
    end if;
    select count(*) into v_versions from public.rate_card_versions v
    where v.rate_card_id = v_cards[1] and v.status = 'active' and v.effective_period @> p_work_date;
    if v_versions = 0 then
      r.rate_card_id := v_cards[1];
      r.issue := 'RATE_NOT_CONFIGURED';
      return r;
    elsif v_versions > 1 then
      r.rate_card_id := v_cards[1];
      r.issue := 'RATE_AMBIGUOUS';
      return r;
    end if;
    select v.rate_card_id, v.id, v.currency, v.pay_rate_minor, v.bill_rate_minor
      into r.rate_card_id, r.rate_version_id, r.currency, r.pay_rate_minor, r.bill_rate_minor
    from public.rate_card_versions v
    where v.rate_card_id = v_cards[1] and v.status = 'active' and v.effective_period @> p_work_date;
    return r;
  end loop;
  r.issue := 'RATE_NOT_CONFIGURED';
  return r;
end;
$$;

create function internal.rounding_policy_for(p_organisation_id uuid, p_date date)
returns public.rounding_policy_versions
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.rounding_policy_versions r
  where r.agency_organisation_id = p_organisation_id and r.status = 'active' and r.effective_from <= p_date
  order by r.effective_from desc limit 1
$$;

create function internal.overtime_policy_for(p_organisation_id uuid, p_side public.pricing_side, p_date date)
returns public.overtime_policy_versions
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.overtime_policy_versions o
  where o.agency_organisation_id = p_organisation_id and o.side = p_side and o.status = 'active'
    and o.effective_from <= p_date
  order by o.effective_from desc limit 1
$$;

-- -----------------------------------------------------------------------------
-- The engine
-- -----------------------------------------------------------------------------
create function internal.price_timesheet_revision(p_timesheet_id uuid, p_expected_revision integer)
returns table (outcome text, priced_timesheet_id uuid, issues jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  t public.timesheets;
  a public.timesheet_approvals;
  s record;
  e public.timesheet_entries;
  sh public.shifts;
  rr internal.rate_resolution;
  rp public.rounding_policy_versions;
  op_pay public.overtime_policy_versions;
  op_bill public.overtime_policy_versions;
  v_existing uuid;
  v_issues jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_currency text;
  v_line integer := 0;
  v_raw integer;
  v_priced integer;
  v_pay_cum integer := 0;
  v_bill_cum integer := 0;
  v_pay_reg integer;
  v_pay_ot integer;
  v_bill_reg integer;
  v_bill_ot integer;
  v_pay_num integer;
  v_pay_den integer;
  v_bill_num integer;
  v_bill_den integer;
  v_pay_amount bigint;
  v_bill_amount bigint;
  v_id uuid;
  v_new_block boolean;
  v_previous uuid;
begin
  select * into t from public.timesheets x where x.id = p_timesheet_id for update;
  if t.id is null then
    raise exception 'timesheet not found' using errcode = 'CHM15';
  end if;
  if t.revision is distinct from p_expected_revision then
    raise exception 'the timesheet revision changed' using errcode = 'CHM08';
  end if;
  if t.status <> 'locked' then
    raise exception 'only a locked timesheet can be priced' using errcode = 'CHM07';
  end if;

  select p.id into v_existing from public.priced_timesheets p
  where p.timesheet_id = t.id and p.timesheet_revision = t.revision;
  if v_existing is not null then
    return query select 'existing'::text, v_existing, '[]'::jsonb;
    return;
  end if;

  select * into a from public.timesheet_approvals x
  where x.timesheet_id = t.id and x.revision = t.revision and x.superseded_at is null;
  if a.id is null then
    raise exception 'no current approval for this revision' using errcode = 'CHM07';
  end if;

  op_pay := internal.overtime_policy_for(t.agency_organisation_id, 'pay', t.period_start);
  op_bill := internal.overtime_policy_for(t.agency_organisation_id, 'bill', t.period_start);
  v_pay_num := case when op_pay.mode = 'weekly_threshold' then op_pay.multiplier_numerator end;
  v_pay_den := case when op_pay.mode = 'weekly_threshold' then op_pay.multiplier_denominator end;
  v_bill_num := case when op_bill.mode = 'weekly_threshold' then op_bill.multiplier_numerator end;
  v_bill_den := case when op_bill.mode = 'weekly_threshold' then op_bill.multiplier_denominator end;

  -- Worked entries of the snapshot, in chronological order (overtime accrues in this order).
  for s in
    select x.value as item, (x.value ->> 'entry_id')::uuid as entry_id,
           (x.value ->> 'worked_minutes')::integer as worked, (x.value ->> 'local_date')::date as local_date
    from jsonb_array_elements(a.snapshot) x
    where coalesce((x.value ->> 'not_worked')::boolean, false) = false
      and coalesce((x.value ->> 'worked_minutes')::integer, 0) > 0
    order by (x.value ->> 'effective_start_at')::timestamptz, x.value ->> 'entry_id'
  loop
    select * into e from public.timesheet_entries x where x.id = s.entry_id and x.timesheet_id = t.id;
    if e.id is null or e.worked_minutes is distinct from s.worked or e.revision <> t.revision then
      raise exception 'the locked entry does not match its approval snapshot' using errcode = 'CHM08';
    end if;
    select * into sh from public.shifts x where x.id = e.shift_id;
    rr := internal.resolve_rate(t.agency_organisation_id, e.relationship_id, sh.discipline_key, sh.classification,
                                s.local_date);
    if rr.issue is null and v_currency is not null and rr.currency <> v_currency then
      rr.issue := 'RATE_CURRENCY_MISMATCH';
    end if;
    if rr.issue is not null then
      v_issues := v_issues || jsonb_build_object(
        'entry_id', e.id, 'local_date', s.local_date, 'code', rr.issue, 'relationship_id', e.relationship_id,
        'agency_facility_id', e.agency_facility_id, 'discipline_key', sh.discipline_key,
        'classification', sh.classification, 'rate_card_id', rr.rate_card_id);
      continue;
    end if;
    v_currency := coalesce(v_currency, rr.currency);

    v_raw := s.worked;
    rp := internal.rounding_policy_for(t.agency_organisation_id, s.local_date);
    v_priced := case when rp.mode = 'nearest'
                     then internal.round_half_up_div(v_raw, rp.increment_minutes)::integer * rp.increment_minutes
                     else v_raw end;

    if v_pay_num is null then
      v_pay_reg := v_priced; v_pay_ot := 0;
    else
      v_pay_reg := internal.overtime_regular_minutes(v_pay_cum, v_priced, op_pay.weekly_threshold_minutes);
      v_pay_ot := v_priced - v_pay_reg;
    end if;
    if v_bill_num is null then
      v_bill_reg := v_priced; v_bill_ot := 0;
    else
      v_bill_reg := internal.overtime_regular_minutes(v_bill_cum, v_priced, op_bill.weekly_threshold_minutes);
      v_bill_ot := v_priced - v_bill_reg;
    end if;
    v_pay_cum := v_pay_cum + v_priced;
    v_bill_cum := v_bill_cum + v_priced;

    v_pay_amount := internal.round_half_up_div(
      rr.pay_rate_minor::numeric * (v_pay_reg * coalesce(v_pay_den, 1) + v_pay_ot * coalesce(v_pay_num, 1)),
      60 * coalesce(v_pay_den, 1));
    v_bill_amount := internal.round_half_up_div(
      rr.bill_rate_minor::numeric * (v_bill_reg * coalesce(v_bill_den, 1) + v_bill_ot * coalesce(v_bill_num, 1)),
      60 * coalesce(v_bill_den, 1));

    v_line := v_line + 1;
    v_lines := v_lines || jsonb_build_object(
      'line_number', v_line, 'entry_id', e.id, 'assignment_id', e.assignment_id, 'shift_id', e.shift_id,
      'agency_worker_id', e.agency_worker_id, 'profile_id', e.profile_id, 'relationship_id', e.relationship_id,
      'agency_facility_id', e.agency_facility_id, 'discipline_key', sh.discipline_key,
      'classification', sh.classification, 'local_date', s.local_date, 'raw_minutes', v_raw,
      'priced_minutes', v_priced, 'pay_regular_minutes', v_pay_reg, 'pay_overtime_minutes', v_pay_ot,
      'bill_regular_minutes', v_bill_reg, 'bill_overtime_minutes', v_bill_ot,
      'rate_card_id', rr.rate_card_id, 'rate_version_id', rr.rate_version_id, 'rate_precedence', rr.precedence,
      'currency', rr.currency, 'pay_rate_minor', rr.pay_rate_minor, 'bill_rate_minor', rr.bill_rate_minor,
      'rounding_policy_version_id', rp.id, 'rounding_mode', coalesce(rp.mode, 'none'),
      'rounding_increment_minutes', rp.increment_minutes,
      'pay_overtime_numerator', v_pay_num, 'pay_overtime_denominator', v_pay_den,
      'bill_overtime_numerator', v_bill_num, 'bill_overtime_denominator', v_bill_den,
      'pay_amount_minor', v_pay_amount, 'bill_amount_minor', v_bill_amount);
  end loop;

  if jsonb_array_length(v_issues) > 0 then
    insert into public.pricing_blocks as b (timesheet_id, timesheet_revision, agency_organisation_id, issues)
    values (t.id, t.revision, t.agency_organisation_id, v_issues)
    on conflict (timesheet_id, timesheet_revision) do update
      set issues = excluded.issues, attempts = b.attempts + 1, last_attempt_at = now(), resolved_at = null
    returning (xmax = 0) into v_new_block;
    perform internal.record_audit_event('pricing.failed', t.agency_organisation_id, 'timesheet', t.id,
      jsonb_build_object('revision', t.revision,
                         'codes', (select jsonb_agg(distinct i ->> 'code') from jsonb_array_elements(v_issues) i)));
    if v_new_block then
      perform internal.enqueue_notification('pricing_blocked_missing_rate', t.agency_organisation_id, null,
        t.agency_organisation_id, 'timesheet', t.id);
    end if;
    return query select 'blocked'::text, null::uuid, v_issues;
    return;
  end if;
  if v_line = 0 then
    return query select 'no_work'::text, null::uuid, '[]'::jsonb;
    return;
  end if;

  insert into public.priced_timesheets as p
    (agency_organisation_id, timesheet_id, timesheet_revision, approval_id, agency_worker_id, profile_id,
     period_start, period_end, currency, line_count, total_raw_minutes, total_priced_minutes,
     total_pay_overtime_minutes, total_bill_overtime_minutes, total_pay_minor, total_bill_minor,
     pay_overtime_policy_version_id, bill_overtime_policy_version_id, calculation_version, priced_by_membership_id)
  select t.agency_organisation_id, t.id, t.revision, a.id, t.agency_worker_id, t.profile_id, t.period_start,
         t.period_end, v_currency, v_line,
         sum((l ->> 'raw_minutes')::integer), sum((l ->> 'priced_minutes')::integer),
         sum((l ->> 'pay_overtime_minutes')::integer), sum((l ->> 'bill_overtime_minutes')::integer),
         sum((l ->> 'pay_amount_minor')::bigint), sum((l ->> 'bill_amount_minor')::bigint),
         op_pay.id, op_bill.id, 1, internal.active_membership_id(t.agency_organisation_id)
  from jsonb_array_elements(v_lines) l
  returning p.id into v_id;

  insert into public.priced_timesheet_lines
    (priced_timesheet_id, agency_organisation_id, timesheet_id, timesheet_revision, entry_id, assignment_id,
     shift_id, agency_worker_id, profile_id, relationship_id, agency_facility_id, discipline_key, classification,
     local_date, line_number, raw_minutes, priced_minutes, pay_regular_minutes, pay_overtime_minutes,
     bill_regular_minutes, bill_overtime_minutes, rate_card_id, rate_version_id, rate_precedence, currency,
     pay_rate_minor, bill_rate_minor, rounding_policy_version_id, rounding_mode, rounding_increment_minutes,
     pay_overtime_numerator, pay_overtime_denominator, bill_overtime_numerator, bill_overtime_denominator,
     pay_amount_minor, bill_amount_minor, calculation_version)
  select v_id, t.agency_organisation_id, t.id, t.revision, x.entry_id, x.assignment_id, x.shift_id,
         x.agency_worker_id, x.profile_id, x.relationship_id, x.agency_facility_id, x.discipline_key,
         x.classification, x.local_date, x.line_number, x.raw_minutes, x.priced_minutes, x.pay_regular_minutes,
         x.pay_overtime_minutes, x.bill_regular_minutes, x.bill_overtime_minutes, x.rate_card_id,
         x.rate_version_id, x.rate_precedence, x.currency, x.pay_rate_minor, x.bill_rate_minor,
         x.rounding_policy_version_id, x.rounding_mode, x.rounding_increment_minutes, x.pay_overtime_numerator,
         x.pay_overtime_denominator, x.bill_overtime_numerator, x.bill_overtime_denominator, x.pay_amount_minor,
         x.bill_amount_minor, 1
  from jsonb_to_recordset(v_lines) as x(
    line_number smallint, entry_id uuid, assignment_id uuid, shift_id uuid, agency_worker_id uuid, profile_id uuid,
    relationship_id uuid, agency_facility_id uuid, discipline_key text, classification public.shift_classification,
    local_date date, raw_minutes integer, priced_minutes integer, pay_regular_minutes integer,
    pay_overtime_minutes integer, bill_regular_minutes integer, bill_overtime_minutes integer, rate_card_id uuid,
    rate_version_id uuid, rate_precedence smallint, currency text, pay_rate_minor bigint, bill_rate_minor bigint,
    rounding_policy_version_id uuid, rounding_mode public.rounding_mode, rounding_increment_minutes smallint,
    pay_overtime_numerator integer, pay_overtime_denominator integer, bill_overtime_numerator integer,
    bill_overtime_denominator integer, pay_amount_minor bigint, bill_amount_minor bigint);

  update public.pricing_blocks b set resolved_at = now()
   where b.timesheet_id = t.id and b.timesheet_revision = t.revision and b.resolved_at is null;

  perform internal.record_audit_event('pricing.created', t.agency_organisation_id, 'priced_timesheet', v_id,
    (select jsonb_build_object('timesheet_id', t.id, 'revision', t.revision, 'currency', p.currency,
                               'lines', p.line_count, 'total_pay_minor', p.total_pay_minor,
                               'total_bill_minor', p.total_bill_minor, 'calculation_version', 1)
     from public.priced_timesheets p where p.id = v_id));
  select p.id into v_previous from public.priced_timesheets p
  where p.timesheet_id = t.id and p.timesheet_revision < t.revision
  order by p.timesheet_revision desc limit 1;
  if v_previous is not null then
    perform internal.record_audit_event('pricing.repriced_for_revision', t.agency_organisation_id,
      'priced_timesheet', v_id, jsonb_build_object('timesheet_id', t.id, 'revision', t.revision,
                                                  'previous_priced_timesheet_id', v_previous));
  end if;
  return query select 'priced'::text, v_id, '[]'::jsonb;
end;
$$;

create function public.price_timesheet(p_timesheet_id uuid, p_expected_revision integer)
returns table (outcome text, priced_timesheet_id uuid, issues jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid;
begin
  perform internal.require_identity();
  select x.agency_organisation_id into v_org from public.timesheets x where x.id = p_timesheet_id;
  if v_org is null or not authz.has_capability(v_org, 'pricing.view') then
    raise exception 'timesheet not found' using errcode = 'CHM15';
  end if;
  perform internal.require_capability(v_org, 'pricing.run');
  return query select * from internal.price_timesheet_revision(p_timesheet_id, p_expected_revision);
end;
$$;

-- -----------------------------------------------------------------------------
-- Projections (pricing.view). Keyset by (period_start, id) descending.
-- -----------------------------------------------------------------------------
create function public.list_pricing_queue(
  p_organisation_id uuid,
  p_state text,
  p_after_period date default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns table (
  timesheet_id uuid,
  priced_timesheet_id uuid,
  worker_name text,
  period_start date,
  period_end date,
  revision integer,
  current_revision integer,
  state text,
  entry_count integer,
  worked_minutes integer,
  facilities text[],
  issues jsonb,
  currency text,
  total_pay_minor bigint,
  total_bill_minor bigint,
  priced_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'pricing.view');
  if p_state not in ('attention', 'ready', 'priced') then
    raise exception 'unknown pricing state' using errcode = 'CH400';
  end if;
  if p_state = 'priced' then
    return query
      select p.timesheet_id, p.id, pr.display_name, p.period_start, p.period_end, p.timesheet_revision, t.revision,
             'priced'::text, p.line_count, p.total_raw_minutes,
             (select coalesce(array_agg(distinct f.name order by f.name), '{}'::text[])
              from public.priced_timesheet_lines l join public.agency_facilities f on f.id = l.agency_facility_id
              where l.priced_timesheet_id = p.id),
             '[]'::jsonb, p.currency, p.total_pay_minor, p.total_bill_minor, p.priced_at
      from public.priced_timesheets p
      join public.timesheets t on t.id = p.timesheet_id
      join public.profiles pr on pr.id = p.profile_id
      where p.agency_organisation_id = p_organisation_id
        and (p_after_period is null or (p.period_start, p.id) < (p_after_period, p_after_id))
      order by p.period_start desc, p.id desc
      limit v_limit;
    return;
  end if;
  return query
    select t.id, null::uuid, pr.display_name, t.period_start, t.period_end, t.revision, t.revision,
           p_state, a.entry_count, a.total_worked_minutes,
           (select coalesce(array_agg(distinct f.name order by f.name), '{}'::text[])
            from public.timesheet_entries e join public.agency_facilities f on f.id = e.agency_facility_id
            where e.timesheet_id = t.id and e.included),
           coalesce(b.issues, '[]'::jsonb), null::text, null::bigint, null::bigint, null::timestamptz
    from public.timesheets t
    join public.profiles pr on pr.id = t.profile_id
    join public.timesheet_approvals a on a.timesheet_id = t.id and a.revision = t.revision and a.superseded_at is null
    left join public.pricing_blocks b
      on b.timesheet_id = t.id and b.timesheet_revision = t.revision and b.resolved_at is null
    where t.agency_organisation_id = p_organisation_id
      and t.status = 'locked'
      and not exists (select 1 from public.priced_timesheets p where p.timesheet_id = t.id and p.timesheet_revision = t.revision)
      and (case when p_state = 'attention' then b.timesheet_id is not null else b.timesheet_id is null end)
      and (p_after_period is null or (t.period_start, t.id) < (p_after_period, p_after_id))
    order by t.period_start desc, t.id desc
    limit v_limit;
end;
$$;

create function public.get_priced_timesheet(p_priced_timesheet_id uuid)
returns table (
  priced_timesheet_id uuid,
  timesheet_id uuid,
  agency_organisation_id uuid,
  worker_name text,
  period_start date,
  period_end date,
  timesheet_revision integer,
  current_revision integer,
  currency text,
  line_count integer,
  total_raw_minutes integer,
  total_priced_minutes integer,
  total_pay_overtime_minutes integer,
  total_bill_overtime_minutes integer,
  total_pay_minor bigint,
  total_bill_minor bigint,
  calculation_version smallint,
  priced_at timestamptz,
  priced_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  p public.priced_timesheets;
begin
  perform internal.require_identity();
  select * into p from public.priced_timesheets x where x.id = p_priced_timesheet_id;
  if p.id is null or not authz.has_capability(p.agency_organisation_id, 'pricing.view') then
    raise exception 'pricing not found' using errcode = 'CHM15';
  end if;
  return query
    select p.id, p.timesheet_id, p.agency_organisation_id, w.display_name, p.period_start, p.period_end,
           p.timesheet_revision, t.revision, p.currency, p.line_count, p.total_raw_minutes, p.total_priced_minutes,
           p.total_pay_overtime_minutes, p.total_bill_overtime_minutes, p.total_pay_minor, p.total_bill_minor,
           p.calculation_version, p.priced_at, bp.display_name
    from public.timesheets t
    join public.profiles w on w.id = p.profile_id
    left join public.organisation_memberships m on m.id = p.priced_by_membership_id
    left join public.profiles bp on bp.id = m.profile_id
    where t.id = p.timesheet_id;
end;
$$;

create function public.list_priced_timesheet_lines(p_priced_timesheet_id uuid)
returns table (
  line_number smallint,
  entry_id uuid,
  shift_id uuid,
  local_date date,
  facility_name text,
  discipline_name text,
  classification public.shift_classification,
  raw_minutes integer,
  priced_minutes integer,
  pay_regular_minutes integer,
  pay_overtime_minutes integer,
  bill_regular_minutes integer,
  bill_overtime_minutes integer,
  rate_version_id uuid,
  rate_version integer,
  rate_precedence smallint,
  currency text,
  pay_rate_minor bigint,
  bill_rate_minor bigint,
  rounding_mode public.rounding_mode,
  rounding_increment_minutes smallint,
  pay_overtime_numerator integer,
  pay_overtime_denominator integer,
  bill_overtime_numerator integer,
  bill_overtime_denominator integer,
  pay_amount_minor bigint,
  bill_amount_minor bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid;
begin
  perform internal.require_identity();
  select x.agency_organisation_id into v_org from public.priced_timesheets x where x.id = p_priced_timesheet_id;
  if v_org is null or not authz.has_capability(v_org, 'pricing.view') then
    raise exception 'pricing not found' using errcode = 'CHM15';
  end if;
  return query
    select l.line_number, l.entry_id, l.shift_id, l.local_date, f.name, d.name, l.classification, l.raw_minutes,
           l.priced_minutes, l.pay_regular_minutes, l.pay_overtime_minutes, l.bill_regular_minutes,
           l.bill_overtime_minutes, l.rate_version_id, v.version, l.rate_precedence, l.currency, l.pay_rate_minor,
           l.bill_rate_minor, l.rounding_mode, l.rounding_increment_minutes, l.pay_overtime_numerator,
           l.pay_overtime_denominator, l.bill_overtime_numerator, l.bill_overtime_denominator,
           l.pay_amount_minor, l.bill_amount_minor
    from public.priced_timesheet_lines l
    join public.agency_facilities f on f.id = l.agency_facility_id
    join public.disciplines d on d.key = l.discipline_key
    join public.rate_card_versions v on v.id = l.rate_version_id
    where l.priced_timesheet_id = p_priced_timesheet_id
    order by l.line_number;
end;
$$;

-- -----------------------------------------------------------------------------
-- S7: relationship end releases pending facility sign-offs
-- -----------------------------------------------------------------------------
-- Lock a timesheet whose facility decisions are all complete (caller holds the lock).
create function internal.lock_timesheet_if_signed(p_timesheet_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.timesheets;
begin
  select * into t from public.timesheets x where x.id = p_timesheet_id;
  if t.status <> 'agency_approved' or exists (
    select 1 from public.timesheet_entries e
    where e.timesheet_id = t.id and e.facility_state in ('pending', 'disputed')) then
    return false;
  end if;
  update public.timesheets x set status = 'locked', locked_at = now() where x.id = t.id;
  insert into public.timesheet_history (timesheet_id, agency_organisation_id, revision, action)
  values (t.id, t.agency_organisation_id, t.revision, 'locked');
  perform internal.record_audit_event('timesheet.locked', t.agency_organisation_id, 'timesheet', t.id,
    jsonb_build_object('revision', t.revision));
  return true;
end;
$$;

create function internal.release_facility_signoffs(p_relationship_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timesheet uuid;
  t public.timesheets;
  v_entry uuid;
  v_count integer := 0;
  v_released integer;
begin
  for v_timesheet in
    select distinct e.timesheet_id from public.timesheet_entries e
    join public.timesheets x on x.id = e.timesheet_id
    where e.relationship_id = p_relationship_id and e.facility_state = 'pending' and x.status = 'agency_approved'
    order by 1
  loop
    select * into t from public.timesheets x where x.id = v_timesheet for update;
    if t.status <> 'agency_approved' then
      continue;
    end if;
    v_released := 0;
    perform set_config('chelth.timesheet_write', 'on', true);
    for v_entry in
      update public.timesheet_entries e set facility_state = 'not_required'
       where e.timesheet_id = t.id and e.relationship_id = p_relationship_id and e.facility_state = 'pending'
      returning e.id
    loop
      v_released := v_released + 1;
      insert into public.timesheet_history (timesheet_id, agency_organisation_id, revision, action, entry_id,
                                            actor_profile_id, actor_organisation_id, reason_code)
      values (t.id, t.agency_organisation_id, t.revision, 'facility_signoff_not_required', v_entry, auth.uid(),
              case when auth.uid() is null then null else t.agency_organisation_id end, p_reason);
    end loop;
    perform set_config('chelth.timesheet_write', '', true);
    v_count := v_count + v_released;
    perform internal.record_audit_event('timesheet.signoff_not_required', t.agency_organisation_id, 'timesheet',
      t.id, jsonb_build_object('revision', t.revision, 'entries', v_released, 'reason', p_reason));
    perform internal.lock_timesheet_if_signed(t.id);
  end loop;
  return v_count;
end;
$$;

create function internal.on_relationship_ended()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.release_facility_signoffs(new.id, 'relationship_ended');
  return null;
end;
$$;

create trigger agency_facility_relationships_release_signoffs
  after update of status on public.agency_facility_relationships
  for each row
  when (new.status = 'ended' and old.status is distinct from 'ended')
  execute function internal.on_relationship_ended();

-- Relationships that ended before this stage: release now (no-op on a fresh database).
select internal.release_facility_signoffs(r.id, 'relationship_ended')
from public.agency_facility_relationships r where r.status = 'ended';

-- -----------------------------------------------------------------------------
-- Redefinitions (S2 functions: relationship lock + S7; notification routing)
-- -----------------------------------------------------------------------------
create or replace function public.facility_decide_timesheet_entry(
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
  -- Lock order: relationship (share) → timesheet → entry. An ended relationship has no authority.
  perform 1 from public.agency_facility_relationships r
  where r.id = e.relationship_id and r.status <> 'ended'
  for share of r;
  if not found then
    raise exception 'entry not found' using errcode = 'CHP12';
  end if;
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

create or replace function public.resolve_timesheet_dispute(p_entry_id uuid, p_note text default null)
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
  v_ended boolean;
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
  -- If the relationship has ended, the facility can no longer decide: the entry
  -- no longer needs sign-off (and the timesheet may lock); otherwise it returns
  -- to the facility.
  v_ended := exists (select 1 from public.agency_facility_relationships r
                     where r.id = e.relationship_id and r.status = 'ended');
  perform set_config('chelth.timesheet_write', 'on', true);
  update public.timesheet_entries x
     set facility_state = case when v_ended then 'not_required'::public.timesheet_facility_state
                               else 'pending'::public.timesheet_facility_state end
   where x.id = e.id;
  perform set_config('chelth.timesheet_write', '', true);
  insert into public.timesheet_history (timesheet_id, agency_organisation_id, revision, action, entry_id,
                                        actor_profile_id, actor_organisation_id, reason_code, note)
  values (t.id, t.agency_organisation_id, t.revision, 'dispute_resolved', e.id, v_profile_id,
          t.agency_organisation_id, 'times_confirmed', nullif(btrim(p_note), ''));
  perform internal.record_audit_event('timesheet.dispute_resolved', t.agency_organisation_id, 'timesheet_entry', e.id,
    jsonb_build_object('revision', t.revision, 'resolution', 'times_confirmed'));
  if v_ended then
    insert into public.timesheet_history (timesheet_id, agency_organisation_id, revision, action, entry_id,
                                          actor_profile_id, actor_organisation_id, reason_code)
    values (t.id, t.agency_organisation_id, t.revision, 'facility_signoff_not_required', e.id, v_profile_id,
            t.agency_organisation_id, 'relationship_ended');
    perform internal.lock_timesheet_if_signed(t.id);
  else
    perform internal.enqueue_notification('timesheet_facility_signoff_required', t.agency_organisation_id, null,
      e.facility_organisation_id, 'timesheet', t.id);
  end if;
end;
$$;

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
    when p_event::text like 'pricing\_%' then 'pricing.run'
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
    v_path := case
      when n.event::text like 'pricing\_%' then '/app/organisations/' || n.organisation_id || '/pricing'
      when v_audience = 'facility' then '/app/organisations/' || n.audience_organisation_id || '/timesheets'
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

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function
  internal.round_half_up_div(numeric, numeric),
  internal.overtime_regular_minutes(integer, integer, integer),
  internal.resolve_rate(uuid, uuid, text, public.shift_classification, date),
  internal.rounding_policy_for(uuid, date),
  internal.overtime_policy_for(uuid, public.pricing_side, date),
  internal.price_timesheet_revision(uuid, integer),
  internal.lock_timesheet_if_signed(uuid),
  internal.release_facility_signoffs(uuid, text),
  internal.on_relationship_ended()
from public, anon, authenticated, service_role;

revoke all on function
  public.price_timesheet(uuid, integer),
  public.list_pricing_queue(uuid, text, date, uuid, integer),
  public.get_priced_timesheet(uuid),
  public.list_priced_timesheet_lines(uuid)
from public, anon;

grant execute on function
  public.price_timesheet(uuid, integer),
  public.list_pricing_queue(uuid, text, date, uuid, integer),
  public.get_priced_timesheet(uuid),
  public.list_priced_timesheet_lines(uuid)
to authenticated;
