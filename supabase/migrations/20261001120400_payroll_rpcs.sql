-- =============================================================================
-- Migration: payroll_rpcs
-- Stage:     P0-E7-S2
--
-- Purpose
--   Payroll preparation API. All writes are SECURITY DEFINER RPCs; the browser
--   supplies only identifiers (agency, period start, currency, batch). Minutes,
--   rates and amounts are COPIED from immutable priced lines — never accepted
--   from a client and never recomputed.
--
--   Source eligibility (pay side), evaluated under a per-agency advisory lock:
--     * the priced line's revision is the timesheet's CURRENT revision and the
--       timesheet is locked (a superseded pricing is never current);
--     * the line is not claimed by a non-cancelled batch;
--     * no OTHER revision of the same timesheet is claimed — otherwise the
--       newer revision is "Adjustment required" and is held back, referencing
--       the earlier batch(es). Nothing earlier is mutated.
--
--   Blocking rules (fail closed): approve and lock are refused while any line
--   of the batch is no longer the current locked revision (SOURCE_SUPERSEDED).
--   A locked/exported batch with a superseded source stays intact and is
--   flagged ADJUSTMENT_REQUIRED.
--
--   Errors: CHY01 NOTHING_TO_PREPARE · CHY02 SOURCE_SUPERSEDED ·
--           CHY03 FINANCIAL_DOCUMENT_LOCKED · CHY04 INVALID_FINANCIAL_TRANSITION ·
--           CHY05 PAYROLL_PERIOD_INVALID · CHY06 PAYROLL_BATCH_NOT_FOUND ·
--           CHY10 FINANCIAL_LINE_ALREADY_INCLUDED
-- =============================================================================

-- Current, locked, priced pay-side lines not yet in a batch, with their
-- payroll period and whether an adjustment holds them back.
create function internal.payroll_source_lines(p_organisation_id uuid)
returns table (
  priced_line_id uuid,
  timesheet_id uuid,
  timesheet_revision integer,
  agency_worker_id uuid,
  currency text,
  period_start date,
  period_end date,
  regular_minutes integer,
  overtime_minutes integer,
  pay_amount_minor bigint,
  adjustment_required boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select x.payroll_anchor_date as anchor, case x.payroll_period_type when 'weekly' then 7 else 14 end as len
    from internal.financial_settings_for(p_organisation_id) x
  )
  select l.id, l.timesheet_id, l.timesheet_revision, l.agency_worker_id, l.currency,
         l.local_date - (((l.local_date - s.anchor) % s.len) + s.len) % s.len,
         l.local_date - (((l.local_date - s.anchor) % s.len) + s.len) % s.len + s.len - 1,
         l.pay_regular_minutes, l.pay_overtime_minutes, l.pay_amount_minor,
         exists (select 1 from public.payroll_line_claims c
                 where c.timesheet_id = l.timesheet_id and c.timesheet_revision <> l.timesheet_revision)
  from public.priced_timesheet_lines l
  join public.timesheets t on t.id = l.timesheet_id and t.revision = l.timesheet_revision and t.status = 'locked'
  cross join s
  where l.agency_organisation_id = p_organisation_id
    and not exists (select 1 from public.payroll_line_claims c where c.priced_line_id = l.id)
$$;

-- Why a batch needs attention (null when it does not).
create function internal.payroll_batch_attention(p_batch_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when b.status = 'cancelled' then null
    when not exists (
      select 1 from public.payroll_batch_lines l
      join public.timesheets t on t.id = l.timesheet_id
      where l.payroll_batch_id = b.id and (t.revision <> l.timesheet_revision or t.status <> 'locked')) then null
    when b.status in ('locked', 'exported') then 'ADJUSTMENT_REQUIRED'
    else 'SOURCE_SUPERSEDED' end
  from public.payroll_batches b
  where b.id = p_batch_id
$$;

create function internal.membership_display_name(p_membership_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.display_name from public.organisation_memberships m join public.profiles p on p.id = m.profile_id
  where m.id = p_membership_id
$$;

-- Load a batch for a write: not-found for callers who cannot see it (no oracle).
create function internal.payroll_batch_for_write(p_batch_id uuid, p_capability text)
returns public.payroll_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.payroll_batches;
begin
  perform internal.require_identity();
  select * into b from public.payroll_batches x where x.id = p_batch_id for update;
  if b.id is null or not authz.has_capability(b.agency_organisation_id, 'payroll.view') then
    raise exception 'payroll batch not found' using errcode = 'CHY06';
  end if;
  perform internal.require_capability(b.agency_organisation_id, p_capability);
  return b;
end;
$$;

create function internal.record_payroll_history(
  b public.payroll_batches,
  p_action text,
  p_to public.payroll_batch_status,
  p_note text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.payroll_batch_history
    (payroll_batch_id, agency_organisation_id, action, from_status, to_status, actor_membership_id, note)
  values (b.id, b.agency_organisation_id, p_action,
          case when p_action = 'created' then null else b.status end, p_to,
          internal.active_membership_id(b.agency_organisation_id), p_note)
$$;

-- -----------------------------------------------------------------------------
-- Prepare
-- -----------------------------------------------------------------------------
create function public.create_payroll_batch(p_organisation_id uuid, p_period_start date, p_currency text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period record;
  v_period_id uuid;
  v_membership uuid;
  v_ids uuid[];
  v_id uuid;
  v_reference text;
  b public.payroll_batches;
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'payroll.prepare');
  if p_period_start is null or p_currency is null
     or not exists (select 1 from public.currencies c where c.code = p_currency) then
    raise exception 'a period and currency are required' using errcode = 'CH400';
  end if;
  select * into v_period from internal.payroll_period_for(p_organisation_id, p_period_start);
  if v_period.period_start <> p_period_start then
    raise exception 'not the start of a payroll period' using errcode = 'CHY05';
  end if;
  if not internal.consume_rate_limit('payroll.prepare:' || p_organisation_id::text, 120, interval '1 hour') then
    raise exception 'too many payroll batches' using errcode = 'CH429';
  end if;

  -- Serialise preparation per agency; the claims PK is the structural backstop.
  perform pg_advisory_xact_lock(hashtextextended('chelth.payroll.prepare:' || p_organisation_id::text, 0));
  v_membership := internal.active_membership_id(p_organisation_id);

  begin
    insert into public.payroll_periods (agency_organisation_id, period_type, period_start, period_end)
    values (p_organisation_id, v_period.period_type, v_period.period_start, v_period.period_end)
    on conflict (agency_organisation_id, period_start, period_end) do nothing;
  exception when exclusion_violation then
    raise exception 'this period overlaps an existing payroll period' using errcode = 'CHY05';
  end;
  select p.id into v_period_id from public.payroll_periods p
  where p.agency_organisation_id = p_organisation_id
    and p.period_start = v_period.period_start and p.period_end = v_period.period_end;

  select array_agg(s.priced_line_id) into v_ids
  from internal.payroll_source_lines(p_organisation_id) s
  where s.period_start = p_period_start and s.currency = p_currency and not s.adjustment_required;
  if v_ids is null then
    raise exception 'no priced work is ready for this period and currency' using errcode = 'CHY01';
  end if;

  v_reference := internal.next_financial_reference(p_organisation_id, 'payroll_batch',
                                                   extract(year from p_period_start)::integer);
  insert into public.payroll_batches
    (agency_organisation_id, payroll_period_id, period_start, period_end, currency, reference, line_count,
     worker_count, total_regular_minutes, total_overtime_minutes, total_pay_minor, created_by_membership_id)
  select p_organisation_id, v_period_id, v_period.period_start, v_period.period_end, p_currency, v_reference,
         count(*), count(distinct l.agency_worker_id), sum(l.pay_regular_minutes), sum(l.pay_overtime_minutes),
         sum(l.pay_amount_minor), v_membership
  from public.priced_timesheet_lines l
  where l.id = any (v_ids)
  returning id into v_id;

  insert into public.payroll_batch_lines
    (payroll_batch_id, agency_organisation_id, period_start, period_end, currency, line_number, priced_line_id,
     priced_timesheet_id, timesheet_id, timesheet_revision, entry_id, agency_worker_id, profile_id,
     agency_facility_id, relationship_id, discipline_key, work_date, regular_minutes, overtime_minutes,
     pay_rate_minor, pay_amount_minor, calculation_version, worker_reference, worker_name, facility_name,
     discipline_name)
  select v_id, l.agency_organisation_id, v_period.period_start, v_period.period_end, l.currency,
         row_number() over (order by p.display_name, w.id, l.local_date, f.name, l.entry_id, l.id),
         l.id, l.priced_timesheet_id, l.timesheet_id, l.timesheet_revision, l.entry_id, l.agency_worker_id,
         l.profile_id, l.agency_facility_id, l.relationship_id, l.discipline_key, l.local_date,
         l.pay_regular_minutes, l.pay_overtime_minutes, l.pay_rate_minor, l.pay_amount_minor,
         l.calculation_version, w.worker_reference, p.display_name, f.name, d.name
  from public.priced_timesheet_lines l
  join public.agency_workers w on w.id = l.agency_worker_id
  join public.profiles p on p.id = l.profile_id
  join public.agency_facilities f on f.id = l.agency_facility_id
  join public.disciplines d on d.key = l.discipline_key
  where l.id = any (v_ids);

  begin
    insert into public.payroll_line_claims
      (priced_line_id, payroll_batch_id, payroll_batch_line_id, agency_organisation_id, timesheet_id,
       timesheet_revision)
    select l.priced_line_id, l.payroll_batch_id, l.id, l.agency_organisation_id, l.timesheet_id, l.timesheet_revision
    from public.payroll_batch_lines l where l.payroll_batch_id = v_id;
  exception when unique_violation then
    raise exception 'a pay line is already in another payroll batch' using errcode = 'CHY10';
  end;

  select * into b from public.payroll_batches x where x.id = v_id;
  perform internal.record_payroll_history(b, 'created', 'draft');
  perform internal.record_audit_event('payroll.batch_created', p_organisation_id, 'payroll_batch', v_id,
    jsonb_build_object('reference', b.reference, 'period_start', b.period_start, 'period_end', b.period_end,
                       'currency', b.currency, 'line_count', b.line_count, 'total_pay_minor', b.total_pay_minor));
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Lifecycle
-- -----------------------------------------------------------------------------
create function public.review_payroll_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.payroll_batches := internal.payroll_batch_for_write(p_batch_id, 'payroll.prepare');
begin
  if b.status <> 'draft' then
    raise exception 'only a draft batch can be marked reviewed' using errcode = 'CHY04';
  end if;
  update public.payroll_batches x
     set status = 'reviewed', reviewed_at = now(),
         reviewed_by_membership_id = internal.active_membership_id(b.agency_organisation_id)
   where x.id = b.id;
  perform internal.record_payroll_history(b, 'reviewed', 'reviewed');
  perform internal.record_audit_event('payroll.batch_reviewed', b.agency_organisation_id, 'payroll_batch', b.id,
    jsonb_build_object('reference', b.reference));
end;
$$;

create function public.approve_payroll_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.payroll_batches := internal.payroll_batch_for_write(p_batch_id, 'payroll.approve');
begin
  if b.status <> 'reviewed' then
    raise exception 'only a reviewed batch can be approved' using errcode = 'CHY04';
  end if;
  if internal.payroll_batch_attention(b.id) is not null then
    raise exception 'the batch includes work that has been revised' using errcode = 'CHY02';
  end if;
  update public.payroll_batches x
     set status = 'approved', approved_at = now(),
         approved_by_membership_id = internal.active_membership_id(b.agency_organisation_id)
   where x.id = b.id;
  perform internal.record_payroll_history(b, 'approved', 'approved');
  perform internal.record_audit_event('payroll.batch_approved', b.agency_organisation_id, 'payroll_batch', b.id,
    jsonb_build_object('reference', b.reference, 'total_pay_minor', b.total_pay_minor, 'currency', b.currency));
end;
$$;

create function public.lock_payroll_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.payroll_batches := internal.payroll_batch_for_write(p_batch_id, 'payroll.approve');
begin
  if b.status <> 'approved' then
    raise exception 'only an approved batch can be locked' using errcode = 'CHY04';
  end if;
  if internal.payroll_batch_attention(b.id) is not null then
    raise exception 'the batch includes work that has been revised' using errcode = 'CHY02';
  end if;
  update public.payroll_batches x
     set status = 'locked', locked_at = now(),
         locked_by_membership_id = internal.active_membership_id(b.agency_organisation_id)
   where x.id = b.id;
  perform internal.record_payroll_history(b, 'locked', 'locked');
  perform internal.record_audit_event('payroll.batch_locked', b.agency_organisation_id, 'payroll_batch', b.id,
    jsonb_build_object('reference', b.reference, 'total_pay_minor', b.total_pay_minor, 'currency', b.currency));
end;
$$;

-- Before lock only. Releases the batch's lines for a new batch.
create function public.cancel_payroll_batch(p_batch_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.payroll_batches := internal.payroll_batch_for_write(p_batch_id, 'payroll.prepare');
  v_reason text := nullif(btrim(p_reason), '');
begin
  if b.status in ('locked', 'exported') then
    raise exception 'a locked payroll batch cannot be cancelled' using errcode = 'CHY03';
  end if;
  if b.status = 'cancelled' then
    raise exception 'the batch is already cancelled' using errcode = 'CHY04';
  end if;
  if b.status = 'approved' then
    perform internal.require_capability(b.agency_organisation_id, 'payroll.approve');
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'a reason is required' using errcode = 'CH400';
  end if;
  update public.payroll_batches x
     set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason,
         cancelled_by_membership_id = internal.active_membership_id(b.agency_organisation_id)
   where x.id = b.id;
  delete from public.payroll_line_claims c where c.payroll_batch_id = b.id;
  perform internal.record_payroll_history(b, 'cancelled', 'cancelled', v_reason);
  perform internal.record_audit_event('payroll.batch_cancelled', b.agency_organisation_id, 'payroll_batch', b.id,
    jsonb_build_object('reference', b.reference, 'released_lines', b.line_count));
end;
$$;

-- -----------------------------------------------------------------------------
-- Projections (payroll.view)
-- -----------------------------------------------------------------------------
-- Priced work not yet in a batch, grouped by payroll period and currency.
create function public.list_payroll_work(p_organisation_id uuid)
returns table (
  period_start date,
  period_end date,
  currency text,
  adjustment_required boolean,
  line_count integer,
  worker_count integer,
  timesheet_count integer,
  total_regular_minutes bigint,
  total_overtime_minutes bigint,
  total_pay_minor bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'payroll.view');
  return query
    select s.period_start, s.period_end, s.currency, s.adjustment_required, count(*)::integer,
           count(distinct s.agency_worker_id)::integer, count(distinct s.timesheet_id)::integer,
           sum(s.regular_minutes)::bigint, sum(s.overtime_minutes)::bigint, sum(s.pay_amount_minor)::bigint
    from internal.payroll_source_lines(p_organisation_id) s
    group by s.period_start, s.period_end, s.currency, s.adjustment_required
    order by s.adjustment_required desc, s.period_start desc, s.currency;
end;
$$;

-- Needs-attention queue: adjustments (with references to the earlier
-- batches), batches blocked by revised work, and locked work not yet priced.
create function public.list_payroll_issues(p_organisation_id uuid)
returns table (
  issue_code text,
  timesheet_id uuid,
  payroll_batch_id uuid,
  worker_name text,
  period_start date,
  period_end date,
  current_revision integer,
  prepared_revision integer,
  new_revision_priced boolean,
  document_references text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'payroll.view');
  return query
    -- A newer revision of work already in a batch: held back, original intact.
    select 'ADJUSTMENT_REQUIRED'::text, t.id, null::uuid, p.display_name, t.period_start, t.period_end, t.revision,
           max(c.timesheet_revision)::integer,
           exists (select 1 from public.priced_timesheets x where x.timesheet_id = t.id and x.timesheet_revision = t.revision),
           array_agg(distinct b.reference || ' (' || b.status::text || ')')
    from public.payroll_line_claims c
    join public.timesheets t on t.id = c.timesheet_id
    join public.payroll_batches b on b.id = c.payroll_batch_id
    join public.profiles p on p.id = t.profile_id
    where c.agency_organisation_id = p_organisation_id
      and c.timesheet_revision <> t.revision
      and b.status in ('locked', 'exported')
    group by t.id, p.display_name
    union all
    -- An open batch includes revised work: cancel it and prepare again.
    select 'SOURCE_SUPERSEDED'::text, null::uuid, b.id, null::text, b.period_start, b.period_end, null::integer,
           null::integer, null::boolean, array[b.reference || ' (' || b.status::text || ')']
    from public.payroll_batches b
    where b.agency_organisation_id = p_organisation_id
      and b.status in ('draft', 'reviewed', 'approved')
      and internal.payroll_batch_attention(b.id) is not null
    union all
    -- Locked timesheets whose current revision is not priced yet.
    select 'PRICING_REQUIRED'::text, t.id, null::uuid, p.display_name, t.period_start, t.period_end, t.revision,
           null::integer, false, '{}'::text[]
    from public.timesheets t
    join public.profiles p on p.id = t.profile_id
    where t.agency_organisation_id = p_organisation_id
      and t.status = 'locked'
      and not exists (select 1 from public.priced_timesheets x where x.timesheet_id = t.id and x.timesheet_revision = t.revision)
    order by 1, 5 desc;
end;
$$;

create function public.list_payroll_batches(p_organisation_id uuid, p_status public.payroll_batch_status default null)
returns table (
  payroll_batch_id uuid,
  reference text,
  period_start date,
  period_end date,
  currency text,
  status public.payroll_batch_status,
  line_count integer,
  worker_count integer,
  total_pay_minor bigint,
  created_at timestamptz,
  created_by_name text,
  attention text,
  export_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'payroll.view');
  return query
    select b.id, b.reference, b.period_start, b.period_end, b.currency, b.status, b.line_count, b.worker_count,
           b.total_pay_minor, b.created_at, cp.display_name, internal.payroll_batch_attention(b.id),
           (select count(*)::integer from public.financial_exports e where e.payroll_batch_id = b.id)
    from public.payroll_batches b
    left join public.organisation_memberships m on m.id = b.created_by_membership_id
    left join public.profiles cp on cp.id = m.profile_id
    where b.agency_organisation_id = p_organisation_id
      and (p_status is null or b.status = p_status)
    order by (internal.payroll_batch_attention(b.id) is not null) desc, b.period_start desc, b.created_at desc
    limit 200;
end;
$$;

create function public.get_payroll_batch(p_batch_id uuid)
returns table (
  payroll_batch_id uuid,
  agency_organisation_id uuid,
  reference text,
  period_type public.payroll_period_type,
  period_start date,
  period_end date,
  currency text,
  status public.payroll_batch_status,
  line_count integer,
  worker_count integer,
  total_regular_minutes bigint,
  total_overtime_minutes bigint,
  total_pay_minor bigint,
  created_at timestamptz,
  created_by_name text,
  reviewed_at timestamptz,
  reviewed_by_name text,
  approved_at timestamptz,
  approved_by_name text,
  locked_at timestamptz,
  locked_by_name text,
  exported_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by_name text,
  cancel_reason text,
  attention text
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
  select x.agency_organisation_id into v_org from public.payroll_batches x where x.id = p_batch_id;
  if v_org is null or not authz.has_capability(v_org, 'payroll.view') then
    raise exception 'payroll batch not found' using errcode = 'CHY06';
  end if;
  return query
    select b.id, b.agency_organisation_id, b.reference, pp.period_type, b.period_start, b.period_end, b.currency,
           b.status, b.line_count, b.worker_count, b.total_regular_minutes, b.total_overtime_minutes,
           b.total_pay_minor, b.created_at, internal.membership_display_name(b.created_by_membership_id),
           b.reviewed_at, internal.membership_display_name(b.reviewed_by_membership_id),
           b.approved_at, internal.membership_display_name(b.approved_by_membership_id),
           b.locked_at, internal.membership_display_name(b.locked_by_membership_id),
           b.exported_at, b.cancelled_at, internal.membership_display_name(b.cancelled_by_membership_id),
           b.cancel_reason, internal.payroll_batch_attention(b.id)
    from public.payroll_batches b
    join public.payroll_periods pp on pp.id = b.payroll_period_id
    where b.id = p_batch_id;
end;
$$;

create function public.list_payroll_batch_lines(p_batch_id uuid)
returns table (
  line_number integer,
  work_date date,
  agency_worker_id uuid,
  worker_reference text,
  worker_name text,
  facility_name text,
  discipline_name text,
  regular_minutes integer,
  overtime_minutes integer,
  pay_rate_minor bigint,
  pay_amount_minor bigint,
  calculation_version smallint,
  priced_timesheet_id uuid,
  timesheet_id uuid,
  timesheet_revision integer,
  current_revision integer,
  superseded boolean
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
  select x.agency_organisation_id into v_org from public.payroll_batches x where x.id = p_batch_id;
  if v_org is null or not authz.has_capability(v_org, 'payroll.view') then
    raise exception 'payroll batch not found' using errcode = 'CHY06';
  end if;
  return query
    select l.line_number, l.work_date, l.agency_worker_id, l.worker_reference, l.worker_name, l.facility_name,
           l.discipline_name, l.regular_minutes, l.overtime_minutes, l.pay_rate_minor, l.pay_amount_minor,
           l.calculation_version, l.priced_timesheet_id, l.timesheet_id, l.timesheet_revision, t.revision,
           (t.revision <> l.timesheet_revision or t.status <> 'locked')
    from public.payroll_batch_lines l
    join public.timesheets t on t.id = l.timesheet_id
    where l.payroll_batch_id = p_batch_id
    order by l.line_number;
end;
$$;

create function public.list_payroll_batch_workers(p_batch_id uuid)
returns table (
  agency_worker_id uuid,
  worker_reference text,
  worker_name text,
  line_count integer,
  regular_minutes bigint,
  overtime_minutes bigint,
  total_pay_minor bigint
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
  select x.agency_organisation_id into v_org from public.payroll_batches x where x.id = p_batch_id;
  if v_org is null or not authz.has_capability(v_org, 'payroll.view') then
    raise exception 'payroll batch not found' using errcode = 'CHY06';
  end if;
  return query
    select l.agency_worker_id, min(l.worker_reference), min(l.worker_name), count(*)::integer,
           sum(l.regular_minutes)::bigint, sum(l.overtime_minutes)::bigint, sum(l.pay_amount_minor)::bigint
    from public.payroll_batch_lines l
    where l.payroll_batch_id = p_batch_id
    group by l.agency_worker_id
    order by min(l.worker_name), l.agency_worker_id;
end;
$$;

create function public.list_payroll_batch_history(p_batch_id uuid)
returns table (
  action text,
  from_status public.payroll_batch_status,
  to_status public.payroll_batch_status,
  actor_name text,
  note text,
  occurred_at timestamptz
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
  select x.agency_organisation_id into v_org from public.payroll_batches x where x.id = p_batch_id;
  if v_org is null or not authz.has_capability(v_org, 'payroll.view') then
    raise exception 'payroll batch not found' using errcode = 'CHY06';
  end if;
  return query
    select h.action, h.from_status, h.to_status, internal.membership_display_name(h.actor_membership_id), h.note,
           h.occurred_at
    from public.payroll_batch_history h
    where h.payroll_batch_id = p_batch_id
    order by h.occurred_at, h.id;
end;
$$;

revoke all on function
  internal.payroll_source_lines(uuid),
  internal.payroll_batch_attention(uuid),
  internal.payroll_batch_for_write(uuid, text),
  internal.record_payroll_history(public.payroll_batches, text, public.payroll_batch_status, text),
  internal.membership_display_name(uuid)
from public, anon, authenticated, service_role;

revoke all on function
  public.create_payroll_batch(uuid, date, text),
  public.review_payroll_batch(uuid),
  public.approve_payroll_batch(uuid),
  public.lock_payroll_batch(uuid),
  public.cancel_payroll_batch(uuid, text),
  public.list_payroll_work(uuid),
  public.list_payroll_issues(uuid),
  public.list_payroll_batches(uuid, public.payroll_batch_status),
  public.get_payroll_batch(uuid),
  public.list_payroll_batch_lines(uuid),
  public.list_payroll_batch_workers(uuid),
  public.list_payroll_batch_history(uuid)
from public, anon;

grant execute on function
  public.create_payroll_batch(uuid, date, text),
  public.review_payroll_batch(uuid),
  public.approve_payroll_batch(uuid),
  public.lock_payroll_batch(uuid),
  public.cancel_payroll_batch(uuid, text),
  public.list_payroll_work(uuid),
  public.list_payroll_issues(uuid),
  public.list_payroll_batches(uuid, public.payroll_batch_status),
  public.get_payroll_batch(uuid),
  public.list_payroll_batch_lines(uuid),
  public.list_payroll_batch_workers(uuid),
  public.list_payroll_batch_history(uuid)
to authenticated;
