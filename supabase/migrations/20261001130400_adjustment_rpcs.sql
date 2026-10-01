-- =============================================================================
-- Migration: adjustment_rpcs
-- Stage:     P0-E7-S3
--
-- Purpose
--   * Payroll adjustments: create (per timesheet), review, approve, lock,
--     cancel-before-lock, and projections.
--   * Invoice adjustments: create (per timesheet + relationship), review,
--     approve, lock, void-before-lock, and projections.
--   * Approvals (S2 batch/draft approvals and the new adjustment approvals)
--     go through internal.financial_authorize:
--       - maker/checker (when enabled) — preparer ≠ approver;
--       - a denial is AUDITED and RETURNED as (outcome 'denied', reason_code)
--         rather than raised, so the audit row commits.
--     State errors (wrong status, superseded source) still raise.
--   * void_invoice_draft refuses a draft that has adjustments (the chain needs
--     its root).
--
--   Errors: CHY02 SOURCE_SUPERSEDED · CHY03 locked · CHY04 transition ·
--           CHY12 ADJUSTMENT_NOT_REQUIRED · CHY13 ADJUSTMENT_ALREADY_EXISTS ·
--           CHY14 ADJUSTMENT_SOURCE_NOT_LOCKED · CHY15 ADJUSTMENT_SOURCE_NOT_PRICED ·
--           CHY16 ADJUSTMENT_ORIGINAL_NOT_FINAL · CHY17 ADJUSTMENT_CURRENCY_MISMATCH ·
--           CHY18 ADJUSTMENT_ZERO_DELTA · CHY19 ADJUSTMENT_NOT_FOUND ·
--           CHY21 DOCUMENT_HAS_ADJUSTMENTS
-- =============================================================================

-- Map an adjustment status to its error (state is not 'required').
create function internal.raise_adjustment_state(p_state text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_state
    when 'none', 'accounted' then
      raise exception 'no adjustment is required' using errcode = 'CHY12';
    when 'adjusted' then
      raise exception 'this revision is already adjusted' using errcode = 'CHY12';
    when 'no_change' then
      raise exception 'the revision has no financial change' using errcode = 'CHY18';
    when 'in_progress', 'in_progress_superseded' then
      raise exception 'an adjustment is already in progress' using errcode = 'CHY13';
    when 'original_open', 'split' then
      raise exception 'the original document is not final' using errcode = 'CHY16';
    when 'awaiting_lock' then
      raise exception 'the newer revision is not locked' using errcode = 'CHY14';
    when 'awaiting_pricing' then
      raise exception 'the newer revision is not priced' using errcode = 'CHY15';
    when 'currency_mismatch' then
      raise exception 'the newer pricing uses another currency' using errcode = 'CHY17';
    else
      raise exception 'adjustment not available' using errcode = 'CHY12';
  end case;
end;
$$;

-- =============================================================================
-- PAYROLL ADJUSTMENTS
-- =============================================================================
create function internal.payroll_adjustment_attention(p_adjustment_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.payroll_adjustments;
  t public.timesheets;
  v_state text;
begin
  select * into a from public.payroll_adjustments x where x.id = p_adjustment_id;
  if a.id is null or a.status = 'cancelled' then
    return null;
  end if;
  select * into t from public.timesheets x where x.id = a.timesheet_id;
  if t.revision = a.to_revision and t.status = 'locked' then
    return null;
  elsif a.status in ('draft', 'reviewed', 'approved') then
    return 'SOURCE_SUPERSEDED';
  end if;
  select st.state into v_state from internal.payroll_adjustment_status(a.timesheet_id) st;
  return case when internal.adjustment_state_holds(v_state) then 'ADJUSTMENT_REQUIRED'
              when v_state = 'in_progress' then 'ADJUSTMENT_IN_PROGRESS'
              else 'REVISION_RESOLVED' end;
end;
$$;

create function internal.record_payroll_adjustment_history(
  a public.payroll_adjustments,
  p_action text,
  p_to public.payroll_batch_status,
  p_note text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.payroll_adjustment_history
    (payroll_adjustment_id, agency_organisation_id, action, from_status, to_status, actor_membership_id, note)
  values (a.id, a.agency_organisation_id, p_action,
          case when p_action = 'created' then null else a.status end, p_to,
          internal.active_membership_id(a.agency_organisation_id), p_note)
$$;

create function internal.payroll_adjustment_for_write(p_adjustment_id uuid, p_capability text)
returns public.payroll_adjustments
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.payroll_adjustments;
begin
  perform internal.require_identity();
  select * into a from public.payroll_adjustments x where x.id = p_adjustment_id for update;
  if a.id is null or not authz.has_capability(a.agency_organisation_id, 'payroll.view') then
    raise exception 'adjustment not found' using errcode = 'CHY19';
  end if;
  perform internal.require_capability(a.agency_organisation_id, p_capability);
  return a;
end;
$$;

create function public.create_payroll_adjustment(p_timesheet_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.timesheets;
  st record;
  v_from public.priced_timesheets;
  v_to public.priced_timesheets;
  v_id uuid;
  a public.payroll_adjustments;
begin
  perform internal.require_identity();
  select * into t from public.timesheets x where x.id = p_timesheet_id;
  if t.id is null or not authz.has_capability(t.agency_organisation_id, 'payroll.view') then
    raise exception 'timesheet not found' using errcode = 'CHY19';
  end if;
  perform internal.require_capability(t.agency_organisation_id, 'payroll.prepare');
  if not internal.consume_rate_limit('payroll.prepare:' || t.agency_organisation_id::text, 120, interval '1 hour') then
    raise exception 'too many payroll documents' using errcode = 'CH429';
  end if;

  -- Same lock as batch preparation: all payroll preparation per agency is serial.
  perform pg_advisory_xact_lock(hashtextextended('chelth.payroll.prepare:' || t.agency_organisation_id::text, 0));
  -- Hold the timesheet's revision still for this transaction.
  perform 1 from public.timesheets x where x.id = t.id for share;

  select * into st from internal.payroll_adjustment_status(t.id);
  if st.state <> 'required' then
    perform internal.raise_adjustment_state(st.state);
  end if;
  select * into v_from from public.priced_timesheets x where x.timesheet_id = t.id and x.timesheet_revision = st.base_revision;
  select * into v_to from public.priced_timesheets x where x.id = st.current_priced_timesheet_id;

  insert into public.payroll_adjustments
    (agency_organisation_id, reference, timesheet_id, agency_worker_id, profile_id, period_start, period_end,
     from_revision, to_revision, from_priced_timesheet_id, to_priced_timesheet_id, original_payroll_batch_id,
     previous_adjustment_id, currency, line_count, delta_regular_minutes, delta_overtime_minutes,
     total_increase_minor, total_decrease_minor, net_delta_minor, worker_reference, worker_name,
     created_by_membership_id)
  select t.agency_organisation_id,
         internal.next_financial_reference(t.agency_organisation_id, 'payroll_adjustment',
                                           extract(year from v_to.period_start)::integer),
         t.id, t.agency_worker_id, t.profile_id, v_to.period_start, v_to.period_end,
         st.base_revision, v_to.timesheet_revision, v_from.id, v_to.id, st.root_batch_id,
         case when st.base_kind = 'adjustment' then st.base_document_id end, v_to.currency,
         count(*), sum(d.delta_regular_minutes), sum(d.delta_overtime_minutes),
         coalesce(sum(d.delta_pay_amount_minor) filter (where d.delta_pay_amount_minor > 0), 0),
         coalesce(-sum(d.delta_pay_amount_minor) filter (where d.delta_pay_amount_minor < 0), 0),
         sum(d.delta_pay_amount_minor),
         (select w.worker_reference from public.agency_workers w where w.id = t.agency_worker_id),
         (select pr.display_name from public.profiles pr where pr.id = t.profile_id),
         internal.active_membership_id(t.agency_organisation_id)
  from internal.payroll_adjustment_delta(t.id, st.base_kind, st.base_document_id, st.base_revision,
                                         v_to.timesheet_revision) d
  where d.changed
  returning id into v_id;

  insert into public.payroll_adjustment_lines
    (payroll_adjustment_id, agency_organisation_id, timesheet_id, from_revision, to_revision, currency, line_number,
     entry_id, agency_worker_id, profile_id, agency_facility_id, relationship_id, discipline_key, work_date,
     old_priced_line_id, old_priced_timesheet_id, old_regular_minutes, old_overtime_minutes, old_pay_rate_minor,
     old_pay_amount_minor, old_calculation_version,
     new_priced_line_id, new_priced_timesheet_id, new_regular_minutes, new_overtime_minutes, new_pay_rate_minor,
     new_pay_amount_minor, new_calculation_version,
     delta_regular_minutes, delta_overtime_minutes, delta_pay_amount_minor,
     worker_reference, worker_name, facility_name, discipline_name)
  select v_id, t.agency_organisation_id, t.id, st.base_revision, v_to.timesheet_revision, v_to.currency,
         row_number() over (order by coalesce(n.local_date, o.local_date), d.entry_id),
         d.entry_id, t.agency_worker_id, t.profile_id, coalesce(n.agency_facility_id, o.agency_facility_id),
         coalesce(n.relationship_id, o.relationship_id), coalesce(n.discipline_key, o.discipline_key),
         coalesce(n.local_date, o.local_date),
         o.id, o.priced_timesheet_id, o.pay_regular_minutes, o.pay_overtime_minutes, o.pay_rate_minor,
         o.pay_amount_minor, o.calculation_version,
         n.id, n.priced_timesheet_id, n.pay_regular_minutes, n.pay_overtime_minutes, n.pay_rate_minor,
         n.pay_amount_minor, n.calculation_version,
         d.delta_regular_minutes, d.delta_overtime_minutes, d.delta_pay_amount_minor,
         (select w.worker_reference from public.agency_workers w where w.id = t.agency_worker_id),
         (select pr.display_name from public.profiles pr where pr.id = t.profile_id),
         f.name, dd.name
  from internal.payroll_adjustment_delta(t.id, st.base_kind, st.base_document_id, st.base_revision,
                                         v_to.timesheet_revision) d
  left join public.priced_timesheet_lines o on o.id = d.old_priced_line_id
  left join public.priced_timesheet_lines n on n.id = d.new_priced_line_id
  join public.agency_facilities f on f.id = coalesce(n.agency_facility_id, o.agency_facility_id)
  join public.disciplines dd on dd.key = coalesce(n.discipline_key, o.discipline_key)
  where d.changed;

  begin
    insert into public.payroll_adjustment_claims (timesheet_id, from_revision, payroll_adjustment_id, agency_organisation_id)
    values (t.id, st.base_revision, v_id, t.agency_organisation_id);
  exception when unique_violation then
    raise exception 'this revision change already has an adjustment' using errcode = 'CHY13';
  end;

  select * into a from public.payroll_adjustments x where x.id = v_id;
  perform internal.record_payroll_adjustment_history(a, 'created', 'draft');
  perform internal.record_audit_event('payroll.adjustment_created', a.agency_organisation_id, 'payroll_adjustment', a.id,
    jsonb_build_object('reference', a.reference, 'timesheet_id', a.timesheet_id, 'from_revision', a.from_revision,
                       'to_revision', a.to_revision, 'original_payroll_batch_id', a.original_payroll_batch_id,
                       'previous_adjustment_id', a.previous_adjustment_id, 'currency', a.currency,
                       'net_delta_minor', a.net_delta_minor, 'line_count', a.line_count));
  return v_id;
end;
$$;

create function public.review_payroll_adjustment(p_adjustment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.payroll_adjustments := internal.payroll_adjustment_for_write(p_adjustment_id, 'payroll.prepare');
begin
  if a.status <> 'draft' then
    raise exception 'only a draft adjustment can be marked reviewed' using errcode = 'CHY04';
  end if;
  update public.payroll_adjustments x
     set status = 'reviewed', reviewed_at = now(),
         reviewed_by_membership_id = internal.active_membership_id(a.agency_organisation_id)
   where x.id = a.id;
  perform internal.record_payroll_adjustment_history(a, 'reviewed', 'reviewed');
  perform internal.record_audit_event('payroll.adjustment_reviewed', a.agency_organisation_id, 'payroll_adjustment', a.id,
    jsonb_build_object('reference', a.reference));
end;
$$;

create function public.approve_payroll_adjustment(p_adjustment_id uuid)
returns table (outcome text, reason_code text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  a public.payroll_adjustments;
  v_reason text;
begin
  perform internal.require_identity();
  select * into a from public.payroll_adjustments x where x.id = p_adjustment_id;
  v_reason := internal.financial_authorize(a.agency_organisation_id, 'payroll.approve', 'payroll.adjustment_approve',
                                           'payroll_adjustment', p_adjustment_id, a.created_by_membership_id);
  if v_reason is not null then
    return query select 'denied'::text, v_reason;
    return;
  end if;
  select * into a from public.payroll_adjustments x where x.id = p_adjustment_id for update;
  if a.status <> 'reviewed' then
    raise exception 'only a reviewed adjustment can be approved' using errcode = 'CHY04';
  end if;
  if internal.payroll_adjustment_attention(a.id) is not null then
    raise exception 'the adjustment''s revision is no longer current' using errcode = 'CHY02';
  end if;
  update public.payroll_adjustments x
     set status = 'approved', approved_at = now(),
         approved_by_membership_id = internal.active_membership_id(a.agency_organisation_id)
   where x.id = a.id;
  perform internal.record_payroll_adjustment_history(a, 'approved', 'approved');
  perform internal.record_audit_event('payroll.adjustment_approved', a.agency_organisation_id, 'payroll_adjustment', a.id,
    jsonb_build_object('reference', a.reference, 'net_delta_minor', a.net_delta_minor, 'currency', a.currency,
                       'maker_checker', internal.maker_checker_required(a.agency_organisation_id)));
  return query select 'approved'::text, null::text;
end;
$$;

create function public.lock_payroll_adjustment(p_adjustment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.payroll_adjustments := internal.payroll_adjustment_for_write(p_adjustment_id, 'payroll.approve');
begin
  if a.status <> 'approved' then
    raise exception 'only an approved adjustment can be locked' using errcode = 'CHY04';
  end if;
  if internal.payroll_adjustment_attention(a.id) is not null then
    raise exception 'the adjustment''s revision is no longer current' using errcode = 'CHY02';
  end if;
  update public.payroll_adjustments x
     set status = 'locked', locked_at = now(),
         locked_by_membership_id = internal.active_membership_id(a.agency_organisation_id)
   where x.id = a.id;
  perform internal.record_payroll_adjustment_history(a, 'locked', 'locked');
  perform internal.record_audit_event('payroll.adjustment_locked', a.agency_organisation_id, 'payroll_adjustment', a.id,
    jsonb_build_object('reference', a.reference, 'net_delta_minor', a.net_delta_minor, 'currency', a.currency));
end;
$$;

create function public.cancel_payroll_adjustment(p_adjustment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.payroll_adjustments := internal.payroll_adjustment_for_write(p_adjustment_id, 'payroll.prepare');
  v_reason text := nullif(btrim(p_reason), '');
begin
  if a.status in ('locked', 'exported') then
    raise exception 'a locked adjustment cannot be cancelled' using errcode = 'CHY03';
  end if;
  if a.status = 'cancelled' then
    raise exception 'the adjustment is already cancelled' using errcode = 'CHY04';
  end if;
  if a.status = 'approved' then
    perform internal.require_capability(a.agency_organisation_id, 'payroll.approve');
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'a reason is required' using errcode = 'CH400';
  end if;
  update public.payroll_adjustments x
     set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason,
         cancelled_by_membership_id = internal.active_membership_id(a.agency_organisation_id)
   where x.id = a.id;
  delete from public.payroll_adjustment_claims c where c.payroll_adjustment_id = a.id;
  perform internal.record_payroll_adjustment_history(a, 'cancelled', 'cancelled', v_reason);
  perform internal.record_audit_event('payroll.adjustment_cancelled', a.agency_organisation_id, 'payroll_adjustment', a.id,
    jsonb_build_object('reference', a.reference));
end;
$$;

-- Projections ------------------------------------------------------------------
create function public.list_payroll_adjustment_candidates(p_organisation_id uuid)
returns table (
  timesheet_id uuid,
  worker_name text,
  period_start date,
  period_end date,
  state text,
  original_batch_id uuid,
  original_batch_reference text,
  base_reference text,
  base_revision integer,
  current_revision integer,
  current_priced boolean,
  currency text,
  changed_lines integer,
  net_delta_minor bigint,
  open_adjustment_id uuid,
  open_adjustment_reference text
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
    with tracked as (
      select distinct c.timesheet_id from public.payroll_line_claims c where c.agency_organisation_id = p_organisation_id
      union
      select distinct a.timesheet_id from public.payroll_adjustments a where a.agency_organisation_id = p_organisation_id
    )
    select t.id, pr.display_name, t.period_start, t.period_end, st.state, st.root_batch_id, rb.reference,
           coalesce(bb.reference, ba.reference), st.base_revision, st.current_revision,
           st.current_priced_timesheet_id is not null, st.base_currency, st.changed_lines,
           case when st.state = 'required' then st.net_delta_minor end,
           oa.id, oa.reference
    from tracked x
    cross join lateral internal.payroll_adjustment_status(x.timesheet_id) st
    join public.timesheets t on t.id = x.timesheet_id
    join public.profiles pr on pr.id = t.profile_id
    left join public.payroll_batches rb on rb.id = st.root_batch_id
    left join public.payroll_batches bb on bb.id = st.base_document_id
    left join public.payroll_adjustments ba on ba.id = st.base_document_id
    left join lateral (
      select a.id, a.reference from public.payroll_adjustments a
      where a.timesheet_id = t.id and a.status in ('draft', 'reviewed', 'approved') limit 1) oa on true
    where st.state not in ('none', 'accounted', 'adjusted', 'no_change', 'original_open')
    order by (st.state = 'required') desc, t.period_start desc, pr.display_name;
end;
$$;

create function public.list_payroll_adjustments(p_organisation_id uuid)
returns table (
  payroll_adjustment_id uuid,
  reference text,
  worker_name text,
  period_start date,
  period_end date,
  from_revision integer,
  to_revision integer,
  original_batch_reference text,
  status public.payroll_batch_status,
  currency text,
  line_count integer,
  net_delta_minor bigint,
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
    select a.id, a.reference, a.worker_name, a.period_start, a.period_end, a.from_revision, a.to_revision, b.reference,
           a.status, a.currency, a.line_count, a.net_delta_minor, a.created_at,
           internal.membership_display_name(a.created_by_membership_id), internal.payroll_adjustment_attention(a.id),
           (select count(*)::integer from public.financial_exports e where e.payroll_adjustment_id = a.id)
    from public.payroll_adjustments a
    join public.payroll_batches b on b.id = a.original_payroll_batch_id
    where a.agency_organisation_id = p_organisation_id
    order by (internal.payroll_adjustment_attention(a.id) is not null) desc, a.created_at desc
    limit 200;
end;
$$;

create function public.get_payroll_adjustment(p_adjustment_id uuid)
returns table (
  payroll_adjustment_id uuid,
  agency_organisation_id uuid,
  reference text,
  status public.payroll_batch_status,
  timesheet_id uuid,
  worker_name text,
  worker_reference text,
  period_start date,
  period_end date,
  from_revision integer,
  to_revision integer,
  current_revision integer,
  from_priced_timesheet_id uuid,
  to_priced_timesheet_id uuid,
  original_batch_id uuid,
  original_batch_reference text,
  previous_adjustment_id uuid,
  previous_adjustment_reference text,
  currency text,
  line_count integer,
  delta_regular_minutes integer,
  delta_overtime_minutes integer,
  total_increase_minor bigint,
  total_decrease_minor bigint,
  net_delta_minor bigint,
  created_at timestamptz,
  created_by_name text,
  created_by_membership_id uuid,
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
  attention text,
  prepared_by_me boolean
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
  select x.agency_organisation_id into v_org from public.payroll_adjustments x where x.id = p_adjustment_id;
  if v_org is null or not authz.has_capability(v_org, 'payroll.view') then
    raise exception 'adjustment not found' using errcode = 'CHY19';
  end if;
  return query
    select a.id, a.agency_organisation_id, a.reference, a.status, a.timesheet_id, a.worker_name, a.worker_reference,
           a.period_start, a.period_end, a.from_revision, a.to_revision, t.revision, a.from_priced_timesheet_id,
           a.to_priced_timesheet_id, a.original_payroll_batch_id, b.reference, a.previous_adjustment_id, pa.reference,
           a.currency, a.line_count, a.delta_regular_minutes, a.delta_overtime_minutes, a.total_increase_minor,
           a.total_decrease_minor, a.net_delta_minor, a.created_at,
           internal.membership_display_name(a.created_by_membership_id), a.created_by_membership_id,
           a.reviewed_at, internal.membership_display_name(a.reviewed_by_membership_id),
           a.approved_at, internal.membership_display_name(a.approved_by_membership_id),
           a.locked_at, internal.membership_display_name(a.locked_by_membership_id),
           a.exported_at, a.cancelled_at, internal.membership_display_name(a.cancelled_by_membership_id),
           a.cancel_reason, internal.payroll_adjustment_attention(a.id),
           a.created_by_membership_id = internal.active_membership_id(a.agency_organisation_id)
    from public.payroll_adjustments a
    join public.timesheets t on t.id = a.timesheet_id
    join public.payroll_batches b on b.id = a.original_payroll_batch_id
    left join public.payroll_adjustments pa on pa.id = a.previous_adjustment_id
    where a.id = p_adjustment_id;
end;
$$;

create function public.list_payroll_adjustment_lines(p_adjustment_id uuid)
returns table (
  line_number integer,
  work_date date,
  facility_name text,
  discipline_name text,
  old_regular_minutes integer,
  new_regular_minutes integer,
  old_overtime_minutes integer,
  new_overtime_minutes integer,
  old_pay_rate_minor bigint,
  new_pay_rate_minor bigint,
  old_pay_amount_minor bigint,
  new_pay_amount_minor bigint,
  delta_regular_minutes integer,
  delta_overtime_minutes integer,
  delta_pay_amount_minor bigint
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
  select x.agency_organisation_id into v_org from public.payroll_adjustments x where x.id = p_adjustment_id;
  if v_org is null or not authz.has_capability(v_org, 'payroll.view') then
    raise exception 'adjustment not found' using errcode = 'CHY19';
  end if;
  return query
    select l.line_number, l.work_date, l.facility_name, l.discipline_name, l.old_regular_minutes, l.new_regular_minutes,
           l.old_overtime_minutes, l.new_overtime_minutes, l.old_pay_rate_minor, l.new_pay_rate_minor,
           l.old_pay_amount_minor, l.new_pay_amount_minor, l.delta_regular_minutes, l.delta_overtime_minutes,
           l.delta_pay_amount_minor
    from public.payroll_adjustment_lines l
    where l.payroll_adjustment_id = p_adjustment_id
    order by l.line_number;
end;
$$;

create function public.list_payroll_adjustment_history(p_adjustment_id uuid)
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
  select x.agency_organisation_id into v_org from public.payroll_adjustments x where x.id = p_adjustment_id;
  if v_org is null or not authz.has_capability(v_org, 'payroll.view') then
    raise exception 'adjustment not found' using errcode = 'CHY19';
  end if;
  return query
    select h.action, h.from_status, h.to_status, internal.membership_display_name(h.actor_membership_id), h.note,
           h.occurred_at
    from public.payroll_adjustment_history h
    where h.payroll_adjustment_id = p_adjustment_id
    order by h.occurred_at, h.id;
end;
$$;

-- =============================================================================
-- INVOICE ADJUSTMENTS (bill side only)
-- =============================================================================
create function internal.invoice_adjustment_attention(p_adjustment_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.invoice_adjustments;
  t public.timesheets;
  v_state text;
begin
  select * into a from public.invoice_adjustments x where x.id = p_adjustment_id;
  if a.id is null or a.status = 'voided' then
    return null;
  end if;
  select * into t from public.timesheets x where x.id = a.timesheet_id;
  if t.revision = a.to_revision and t.status = 'locked' then
    return null;
  elsif a.status in ('draft', 'reviewed', 'approved') then
    return 'SOURCE_SUPERSEDED';
  end if;
  select st.state into v_state from internal.invoice_adjustment_status(a.timesheet_id, a.relationship_id) st;
  return case when internal.adjustment_state_holds(v_state) then 'ADJUSTMENT_REQUIRED'
              when v_state = 'in_progress' then 'ADJUSTMENT_IN_PROGRESS'
              else 'REVISION_RESOLVED' end;
end;
$$;

create function internal.record_invoice_adjustment_history(
  a public.invoice_adjustments,
  p_action text,
  p_to public.invoice_draft_status,
  p_note text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.invoice_adjustment_history
    (invoice_adjustment_id, agency_organisation_id, action, from_status, to_status, actor_membership_id, note)
  values (a.id, a.agency_organisation_id, p_action,
          case when p_action = 'created' then null else a.status end, p_to,
          internal.active_membership_id(a.agency_organisation_id), p_note)
$$;

create function internal.invoice_adjustment_for_write(p_adjustment_id uuid, p_capability text)
returns public.invoice_adjustments
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.invoice_adjustments;
begin
  perform internal.require_identity();
  select * into a from public.invoice_adjustments x where x.id = p_adjustment_id for update;
  if a.id is null or not authz.has_capability(a.agency_organisation_id, 'invoice.view') then
    raise exception 'adjustment not found' using errcode = 'CHY19';
  end if;
  perform internal.require_capability(a.agency_organisation_id, p_capability);
  return a;
end;
$$;

create function public.create_invoice_adjustment(p_timesheet_id uuid, p_relationship_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.timesheets;
  r public.agency_facility_relationships;
  st record;
  v_from public.priced_timesheets;
  v_to public.priced_timesheets;
  v_id uuid;
  a public.invoice_adjustments;
begin
  perform internal.require_identity();
  select * into t from public.timesheets x where x.id = p_timesheet_id;
  if t.id is null or not authz.has_capability(t.agency_organisation_id, 'invoice.view') then
    raise exception 'timesheet not found' using errcode = 'CHY19';
  end if;
  perform internal.require_capability(t.agency_organisation_id, 'invoice.prepare');
  select * into r from public.agency_facility_relationships x
  where x.id = p_relationship_id and x.agency_organisation_id = t.agency_organisation_id;
  if r.id is null then
    raise exception 'relationship not found' using errcode = 'CHY19';
  end if;
  if not internal.consume_rate_limit('invoice.prepare:' || t.agency_organisation_id::text, 120, interval '1 hour') then
    raise exception 'too many invoice documents' using errcode = 'CH429';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('chelth.invoice.prepare:' || t.agency_organisation_id::text, 0));
  perform 1 from public.timesheets x where x.id = t.id for share;

  select * into st from internal.invoice_adjustment_status(t.id, r.id);
  if st.state <> 'required' then
    perform internal.raise_adjustment_state(st.state);
  end if;
  select * into v_from from public.priced_timesheets x where x.timesheet_id = t.id and x.timesheet_revision = st.base_revision;
  select * into v_to from public.priced_timesheets x where x.id = st.current_priced_timesheet_id;

  insert into public.invoice_adjustments
    (agency_organisation_id, reference, timesheet_id, relationship_id, agency_facility_id, period_start, period_end,
     from_revision, to_revision, from_priced_timesheet_id, to_priced_timesheet_id, original_invoice_draft_id,
     previous_adjustment_id, currency, line_count, delta_priced_minutes, total_increase_minor, total_decrease_minor,
     net_delta_minor, agency_name, facility_name, created_by_membership_id)
  select t.agency_organisation_id,
         internal.next_financial_reference(t.agency_organisation_id, 'invoice_adjustment',
                                           extract(year from v_to.period_start)::integer),
         t.id, r.id, r.agency_facility_id, v_to.period_start, v_to.period_end,
         st.base_revision, v_to.timesheet_revision, v_from.id, v_to.id, st.root_draft_id,
         case when st.base_kind = 'adjustment' then st.base_document_id end, v_to.currency,
         count(*), sum(d.delta_priced_minutes),
         coalesce(sum(d.delta_bill_amount_minor) filter (where d.delta_bill_amount_minor > 0), 0),
         coalesce(-sum(d.delta_bill_amount_minor) filter (where d.delta_bill_amount_minor < 0), 0),
         sum(d.delta_bill_amount_minor),
         (select o.name from public.organisations o where o.id = t.agency_organisation_id),
         (select f.name from public.agency_facilities f where f.id = r.agency_facility_id),
         internal.active_membership_id(t.agency_organisation_id)
  from internal.invoice_adjustment_delta(t.id, r.id, st.base_kind, st.base_document_id, st.base_revision,
                                         v_to.timesheet_revision) d
  where d.changed
  returning id into v_id;

  insert into public.invoice_adjustment_lines
    (invoice_adjustment_id, agency_organisation_id, timesheet_id, relationship_id, agency_facility_id, from_revision,
     to_revision, currency, line_number, entry_id, agency_worker_id, profile_id, discipline_key, work_date,
     old_priced_line_id, old_priced_timesheet_id, old_priced_minutes, old_bill_regular_minutes,
     old_bill_overtime_minutes, old_bill_rate_minor, old_bill_amount_minor, old_calculation_version,
     new_priced_line_id, new_priced_timesheet_id, new_priced_minutes, new_bill_regular_minutes,
     new_bill_overtime_minutes, new_bill_rate_minor, new_bill_amount_minor, new_calculation_version,
     delta_priced_minutes, delta_bill_amount_minor, worker_reference, worker_name, discipline_name)
  select v_id, t.agency_organisation_id, t.id, r.id, r.agency_facility_id, st.base_revision, v_to.timesheet_revision,
         v_to.currency, row_number() over (order by coalesce(n.local_date, o.local_date), d.entry_id),
         d.entry_id, t.agency_worker_id, t.profile_id, coalesce(n.discipline_key, o.discipline_key),
         coalesce(n.local_date, o.local_date),
         o.id, o.priced_timesheet_id, o.priced_minutes, o.bill_regular_minutes, o.bill_overtime_minutes,
         o.bill_rate_minor, o.bill_amount_minor, o.calculation_version,
         n.id, n.priced_timesheet_id, n.priced_minutes, n.bill_regular_minutes, n.bill_overtime_minutes,
         n.bill_rate_minor, n.bill_amount_minor, n.calculation_version,
         d.delta_priced_minutes, d.delta_bill_amount_minor,
         (select w.worker_reference from public.agency_workers w where w.id = t.agency_worker_id),
         (select pr.display_name from public.profiles pr where pr.id = t.profile_id),
         dd.name
  from internal.invoice_adjustment_delta(t.id, r.id, st.base_kind, st.base_document_id, st.base_revision,
                                         v_to.timesheet_revision) d
  left join public.priced_timesheet_lines o on o.id = d.old_priced_line_id
  left join public.priced_timesheet_lines n on n.id = d.new_priced_line_id
  join public.disciplines dd on dd.key = coalesce(n.discipline_key, o.discipline_key)
  where d.changed;

  begin
    insert into public.invoice_adjustment_claims
      (timesheet_id, relationship_id, from_revision, invoice_adjustment_id, agency_organisation_id)
    values (t.id, r.id, st.base_revision, v_id, t.agency_organisation_id);
  exception when unique_violation then
    raise exception 'this revision change already has an adjustment' using errcode = 'CHY13';
  end;

  select * into a from public.invoice_adjustments x where x.id = v_id;
  perform internal.record_invoice_adjustment_history(a, 'created', 'draft');
  perform internal.record_audit_event('invoice.adjustment_created', a.agency_organisation_id, 'invoice_adjustment', a.id,
    jsonb_build_object('reference', a.reference, 'timesheet_id', a.timesheet_id, 'relationship_id', a.relationship_id,
                       'from_revision', a.from_revision, 'to_revision', a.to_revision,
                       'original_invoice_draft_id', a.original_invoice_draft_id,
                       'previous_adjustment_id', a.previous_adjustment_id, 'currency', a.currency,
                       'net_delta_minor', a.net_delta_minor, 'direction', a.direction));
  return v_id;
end;
$$;

create function public.review_invoice_adjustment(p_adjustment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.invoice_adjustments := internal.invoice_adjustment_for_write(p_adjustment_id, 'invoice.prepare');
begin
  if a.status <> 'draft' then
    raise exception 'only a draft adjustment can be marked reviewed' using errcode = 'CHY04';
  end if;
  update public.invoice_adjustments x
     set status = 'reviewed', reviewed_at = now(),
         reviewed_by_membership_id = internal.active_membership_id(a.agency_organisation_id)
   where x.id = a.id;
  perform internal.record_invoice_adjustment_history(a, 'reviewed', 'reviewed');
  perform internal.record_audit_event('invoice.adjustment_reviewed', a.agency_organisation_id, 'invoice_adjustment', a.id,
    jsonb_build_object('reference', a.reference));
end;
$$;

create function public.approve_invoice_adjustment(p_adjustment_id uuid)
returns table (outcome text, reason_code text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  a public.invoice_adjustments;
  v_reason text;
begin
  perform internal.require_identity();
  select * into a from public.invoice_adjustments x where x.id = p_adjustment_id;
  v_reason := internal.financial_authorize(a.agency_organisation_id, 'invoice.approve', 'invoice.adjustment_approve',
                                           'invoice_adjustment', p_adjustment_id, a.created_by_membership_id);
  if v_reason is not null then
    return query select 'denied'::text, v_reason;
    return;
  end if;
  select * into a from public.invoice_adjustments x where x.id = p_adjustment_id for update;
  if a.status <> 'reviewed' then
    raise exception 'only a reviewed adjustment can be approved' using errcode = 'CHY04';
  end if;
  if internal.invoice_adjustment_attention(a.id) is not null then
    raise exception 'the adjustment''s revision is no longer current' using errcode = 'CHY02';
  end if;
  update public.invoice_adjustments x
     set status = 'approved', approved_at = now(),
         approved_by_membership_id = internal.active_membership_id(a.agency_organisation_id)
   where x.id = a.id;
  perform internal.record_invoice_adjustment_history(a, 'approved', 'approved');
  perform internal.record_audit_event('invoice.adjustment_approved', a.agency_organisation_id, 'invoice_adjustment', a.id,
    jsonb_build_object('reference', a.reference, 'net_delta_minor', a.net_delta_minor, 'currency', a.currency,
                       'maker_checker', internal.maker_checker_required(a.agency_organisation_id)));
  return query select 'approved'::text, null::text;
end;
$$;

create function public.lock_invoice_adjustment(p_adjustment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.invoice_adjustments := internal.invoice_adjustment_for_write(p_adjustment_id, 'invoice.approve');
begin
  if a.status <> 'approved' then
    raise exception 'only an approved adjustment can be locked' using errcode = 'CHY04';
  end if;
  if internal.invoice_adjustment_attention(a.id) is not null then
    raise exception 'the adjustment''s revision is no longer current' using errcode = 'CHY02';
  end if;
  update public.invoice_adjustments x
     set status = 'locked', locked_at = now(),
         locked_by_membership_id = internal.active_membership_id(a.agency_organisation_id)
   where x.id = a.id;
  perform internal.record_invoice_adjustment_history(a, 'locked', 'locked');
  perform internal.record_audit_event('invoice.adjustment_locked', a.agency_organisation_id, 'invoice_adjustment', a.id,
    jsonb_build_object('reference', a.reference, 'net_delta_minor', a.net_delta_minor, 'currency', a.currency));
end;
$$;

create function public.void_invoice_adjustment(p_adjustment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.invoice_adjustments := internal.invoice_adjustment_for_write(p_adjustment_id, 'invoice.prepare');
  v_reason text := nullif(btrim(p_reason), '');
begin
  if a.status in ('locked', 'exported') then
    raise exception 'a locked adjustment cannot be voided' using errcode = 'CHY03';
  end if;
  if a.status = 'voided' then
    raise exception 'the adjustment is already voided' using errcode = 'CHY04';
  end if;
  if a.status = 'approved' then
    perform internal.require_capability(a.agency_organisation_id, 'invoice.approve');
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'a reason is required' using errcode = 'CH400';
  end if;
  update public.invoice_adjustments x
     set status = 'voided', voided_at = now(), void_reason = v_reason,
         voided_by_membership_id = internal.active_membership_id(a.agency_organisation_id)
   where x.id = a.id;
  delete from public.invoice_adjustment_claims c where c.invoice_adjustment_id = a.id;
  perform internal.record_invoice_adjustment_history(a, 'voided', 'voided', v_reason);
  perform internal.record_audit_event('invoice.adjustment_voided', a.agency_organisation_id, 'invoice_adjustment', a.id,
    jsonb_build_object('reference', a.reference));
end;
$$;

create function public.list_invoice_adjustment_candidates(p_organisation_id uuid)
returns table (
  timesheet_id uuid,
  relationship_id uuid,
  facility_name text,
  worker_name text,
  period_start date,
  period_end date,
  state text,
  original_draft_id uuid,
  original_draft_reference text,
  base_reference text,
  base_revision integer,
  current_revision integer,
  current_priced boolean,
  currency text,
  changed_lines integer,
  net_delta_minor bigint,
  open_adjustment_id uuid,
  open_adjustment_reference text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'invoice.view');
  return query
    with tracked as (
      select distinct c.timesheet_id, l.relationship_id
      from public.invoice_line_claims c join public.invoice_draft_lines l on l.id = c.invoice_draft_line_id
      where c.agency_organisation_id = p_organisation_id
      union
      select distinct a.timesheet_id, a.relationship_id from public.invoice_adjustments a
      where a.agency_organisation_id = p_organisation_id
    )
    select t.id, x.relationship_id, f.name, pr.display_name, t.period_start, t.period_end, st.state, st.root_draft_id,
           rd.reference, coalesce(bd.reference, ba.reference), st.base_revision, st.current_revision,
           st.current_priced_timesheet_id is not null, st.base_currency, st.changed_lines,
           case when st.state = 'required' then st.net_delta_minor end, oa.id, oa.reference
    from tracked x
    cross join lateral internal.invoice_adjustment_status(x.timesheet_id, x.relationship_id) st
    join public.timesheets t on t.id = x.timesheet_id
    join public.profiles pr on pr.id = t.profile_id
    join public.agency_facility_relationships r on r.id = x.relationship_id
    join public.agency_facilities f on f.id = r.agency_facility_id
    left join public.invoice_drafts rd on rd.id = st.root_draft_id
    left join public.invoice_drafts bd on bd.id = st.base_document_id
    left join public.invoice_adjustments ba on ba.id = st.base_document_id
    left join lateral (
      select a.id, a.reference from public.invoice_adjustments a
      where a.timesheet_id = t.id and a.relationship_id = x.relationship_id
        and a.status in ('draft', 'reviewed', 'approved') limit 1) oa on true
    where st.state not in ('none', 'accounted', 'adjusted', 'no_change', 'original_open')
    order by f.name, (st.state = 'required') desc, t.period_start desc, pr.display_name;
end;
$$;

create function public.list_invoice_adjustments(p_organisation_id uuid)
returns table (
  invoice_adjustment_id uuid,
  reference text,
  facility_name text,
  relationship_id uuid,
  period_start date,
  period_end date,
  from_revision integer,
  to_revision integer,
  original_draft_reference text,
  status public.invoice_draft_status,
  direction text,
  currency text,
  line_count integer,
  net_delta_minor bigint,
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
  perform internal.require_capability(p_organisation_id, 'invoice.view');
  return query
    select a.id, a.reference, a.facility_name, a.relationship_id, a.period_start, a.period_end, a.from_revision,
           a.to_revision, d.reference, a.status, a.direction, a.currency, a.line_count, a.net_delta_minor,
           a.created_at, internal.membership_display_name(a.created_by_membership_id),
           internal.invoice_adjustment_attention(a.id),
           (select count(*)::integer from public.financial_exports e where e.invoice_adjustment_id = a.id)
    from public.invoice_adjustments a
    join public.invoice_drafts d on d.id = a.original_invoice_draft_id
    where a.agency_organisation_id = p_organisation_id
    order by (internal.invoice_adjustment_attention(a.id) is not null) desc, a.facility_name, a.created_at desc
    limit 200;
end;
$$;

create function public.get_invoice_adjustment(p_adjustment_id uuid)
returns table (
  invoice_adjustment_id uuid,
  agency_organisation_id uuid,
  reference text,
  status public.invoice_draft_status,
  direction text,
  timesheet_id uuid,
  relationship_id uuid,
  facility_name text,
  period_start date,
  period_end date,
  from_revision integer,
  to_revision integer,
  current_revision integer,
  original_draft_id uuid,
  original_draft_reference text,
  previous_adjustment_id uuid,
  previous_adjustment_reference text,
  currency text,
  line_count integer,
  delta_priced_minutes integer,
  total_increase_minor bigint,
  total_decrease_minor bigint,
  net_delta_minor bigint,
  created_at timestamptz,
  created_by_name text,
  reviewed_at timestamptz,
  reviewed_by_name text,
  approved_at timestamptz,
  approved_by_name text,
  locked_at timestamptz,
  locked_by_name text,
  exported_at timestamptz,
  voided_at timestamptz,
  voided_by_name text,
  void_reason text,
  attention text,
  prepared_by_me boolean
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
  select x.agency_organisation_id into v_org from public.invoice_adjustments x where x.id = p_adjustment_id;
  if v_org is null or not authz.has_capability(v_org, 'invoice.view') then
    raise exception 'adjustment not found' using errcode = 'CHY19';
  end if;
  return query
    select a.id, a.agency_organisation_id, a.reference, a.status, a.direction, a.timesheet_id, a.relationship_id,
           a.facility_name, a.period_start, a.period_end, a.from_revision, a.to_revision, t.revision,
           a.original_invoice_draft_id, d.reference, a.previous_adjustment_id, pa.reference, a.currency, a.line_count,
           a.delta_priced_minutes, a.total_increase_minor, a.total_decrease_minor, a.net_delta_minor, a.created_at,
           internal.membership_display_name(a.created_by_membership_id),
           a.reviewed_at, internal.membership_display_name(a.reviewed_by_membership_id),
           a.approved_at, internal.membership_display_name(a.approved_by_membership_id),
           a.locked_at, internal.membership_display_name(a.locked_by_membership_id),
           a.exported_at, a.voided_at, internal.membership_display_name(a.voided_by_membership_id), a.void_reason,
           internal.invoice_adjustment_attention(a.id),
           a.created_by_membership_id = internal.active_membership_id(a.agency_organisation_id)
    from public.invoice_adjustments a
    join public.timesheets t on t.id = a.timesheet_id
    join public.invoice_drafts d on d.id = a.original_invoice_draft_id
    left join public.invoice_adjustments pa on pa.id = a.previous_adjustment_id
    where a.id = p_adjustment_id;
end;
$$;

create function public.list_invoice_adjustment_lines(p_adjustment_id uuid)
returns table (
  line_number integer,
  work_date date,
  worker_reference text,
  worker_name text,
  discipline_name text,
  old_priced_minutes integer,
  new_priced_minutes integer,
  old_bill_rate_minor bigint,
  new_bill_rate_minor bigint,
  old_bill_amount_minor bigint,
  new_bill_amount_minor bigint,
  delta_priced_minutes integer,
  delta_bill_amount_minor bigint
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
  select x.agency_organisation_id into v_org from public.invoice_adjustments x where x.id = p_adjustment_id;
  if v_org is null or not authz.has_capability(v_org, 'invoice.view') then
    raise exception 'adjustment not found' using errcode = 'CHY19';
  end if;
  return query
    select l.line_number, l.work_date, l.worker_reference, l.worker_name, l.discipline_name, l.old_priced_minutes,
           l.new_priced_minutes, l.old_bill_rate_minor, l.new_bill_rate_minor, l.old_bill_amount_minor,
           l.new_bill_amount_minor, l.delta_priced_minutes, l.delta_bill_amount_minor
    from public.invoice_adjustment_lines l
    where l.invoice_adjustment_id = p_adjustment_id
    order by l.line_number;
end;
$$;

create function public.list_invoice_adjustment_history(p_adjustment_id uuid)
returns table (
  action text,
  from_status public.invoice_draft_status,
  to_status public.invoice_draft_status,
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
  select x.agency_organisation_id into v_org from public.invoice_adjustments x where x.id = p_adjustment_id;
  if v_org is null or not authz.has_capability(v_org, 'invoice.view') then
    raise exception 'adjustment not found' using errcode = 'CHY19';
  end if;
  return query
    select h.action, h.from_status, h.to_status, internal.membership_display_name(h.actor_membership_id), h.note,
           h.occurred_at
    from public.invoice_adjustment_history h
    where h.invoice_adjustment_id = p_adjustment_id
    order by h.occurred_at, h.id;
end;
$$;

-- =============================================================================
-- S2 approvals: maker/checker + audited, returned denials
-- =============================================================================
drop function public.approve_payroll_batch(uuid);
create function public.approve_payroll_batch(p_batch_id uuid)
returns table (outcome text, reason_code text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  b public.payroll_batches;
  v_reason text;
begin
  perform internal.require_identity();
  select * into b from public.payroll_batches x where x.id = p_batch_id;
  v_reason := internal.financial_authorize(b.agency_organisation_id, 'payroll.approve', 'payroll.batch_approve',
                                           'payroll_batch', p_batch_id, b.created_by_membership_id);
  if v_reason is not null then
    return query select 'denied'::text, v_reason;
    return;
  end if;
  select * into b from public.payroll_batches x where x.id = p_batch_id for update;
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
    jsonb_build_object('reference', b.reference, 'total_pay_minor', b.total_pay_minor, 'currency', b.currency,
                       'maker_checker', internal.maker_checker_required(b.agency_organisation_id)));
  return query select 'approved'::text, null::text;
end;
$$;

drop function public.approve_invoice_draft(uuid);
create function public.approve_invoice_draft(p_draft_id uuid)
returns table (outcome text, reason_code text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  d public.invoice_drafts;
  v_reason text;
begin
  perform internal.require_identity();
  select * into d from public.invoice_drafts x where x.id = p_draft_id;
  v_reason := internal.financial_authorize(d.agency_organisation_id, 'invoice.approve', 'invoice.draft_approve',
                                           'invoice_draft', p_draft_id, d.created_by_membership_id);
  if v_reason is not null then
    return query select 'denied'::text, v_reason;
    return;
  end if;
  select * into d from public.invoice_drafts x where x.id = p_draft_id for update;
  if d.status <> 'reviewed' then
    raise exception 'only a reviewed draft can be approved' using errcode = 'CHY04';
  end if;
  if internal.invoice_draft_attention(d.id) is not null then
    raise exception 'the draft includes work that has been revised' using errcode = 'CHY02';
  end if;
  update public.invoice_drafts x
     set status = 'approved', approved_at = now(),
         approved_by_membership_id = internal.active_membership_id(d.agency_organisation_id)
   where x.id = d.id;
  perform internal.record_invoice_history(d, 'approved', 'approved');
  perform internal.record_audit_event('invoice.draft_approved', d.agency_organisation_id, 'invoice_draft', d.id,
    jsonb_build_object('reference', d.reference, 'total_bill_minor', d.total_bill_minor, 'currency', d.currency,
                       'maker_checker', internal.maker_checker_required(d.agency_organisation_id)));
  return query select 'approved'::text, null::text;
end;
$$;

-- An original draft that roots an adjustment chain cannot be voided.
create or replace function public.void_invoice_draft(p_draft_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.invoice_drafts := internal.invoice_draft_for_write(p_draft_id, 'invoice.prepare');
  v_reason text := nullif(btrim(p_reason), '');
begin
  if d.status = 'voided' then
    raise exception 'the draft is already voided' using errcode = 'CHY04';
  end if;
  if exists (select 1 from public.invoice_adjustments a
             where a.original_invoice_draft_id = d.id and a.status <> 'voided') then
    raise exception 'the draft has adjustments and cannot be voided' using errcode = 'CHY21';
  end if;
  if d.status in ('approved', 'locked', 'exported') then
    perform internal.require_capability(d.agency_organisation_id, 'invoice.approve');
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'a reason is required' using errcode = 'CH400';
  end if;
  update public.invoice_drafts x
     set status = 'voided', voided_at = now(), void_reason = v_reason,
         voided_by_membership_id = internal.active_membership_id(d.agency_organisation_id)
   where x.id = d.id;
  delete from public.invoice_line_claims c where c.invoice_draft_id = d.id;
  perform internal.record_invoice_history(d, 'voided', 'voided', v_reason);
  perform internal.record_audit_event('invoice.voided', d.agency_organisation_id, 'invoice_draft', d.id,
    jsonb_build_object('reference', d.reference, 'status_before', d.status, 'released_lines', d.line_count));
end;
$$;

-- =============================================================================
-- Grants
-- =============================================================================
revoke all on function
  internal.raise_adjustment_state(text),
  internal.payroll_adjustment_attention(uuid),
  internal.record_payroll_adjustment_history(public.payroll_adjustments, text, public.payroll_batch_status, text),
  internal.payroll_adjustment_for_write(uuid, text),
  internal.invoice_adjustment_attention(uuid),
  internal.record_invoice_adjustment_history(public.invoice_adjustments, text, public.invoice_draft_status, text),
  internal.invoice_adjustment_for_write(uuid, text)
from public, anon, authenticated, service_role;

revoke all on function
  public.create_payroll_adjustment(uuid),
  public.review_payroll_adjustment(uuid),
  public.approve_payroll_adjustment(uuid),
  public.lock_payroll_adjustment(uuid),
  public.cancel_payroll_adjustment(uuid, text),
  public.list_payroll_adjustment_candidates(uuid),
  public.list_payroll_adjustments(uuid),
  public.get_payroll_adjustment(uuid),
  public.list_payroll_adjustment_lines(uuid),
  public.list_payroll_adjustment_history(uuid),
  public.create_invoice_adjustment(uuid, uuid),
  public.review_invoice_adjustment(uuid),
  public.approve_invoice_adjustment(uuid),
  public.lock_invoice_adjustment(uuid),
  public.void_invoice_adjustment(uuid, text),
  public.list_invoice_adjustment_candidates(uuid),
  public.list_invoice_adjustments(uuid),
  public.get_invoice_adjustment(uuid),
  public.list_invoice_adjustment_lines(uuid),
  public.list_invoice_adjustment_history(uuid),
  public.approve_payroll_batch(uuid),
  public.approve_invoice_draft(uuid)
from public, anon;

grant execute on function
  public.create_payroll_adjustment(uuid),
  public.review_payroll_adjustment(uuid),
  public.approve_payroll_adjustment(uuid),
  public.lock_payroll_adjustment(uuid),
  public.cancel_payroll_adjustment(uuid, text),
  public.list_payroll_adjustment_candidates(uuid),
  public.list_payroll_adjustments(uuid),
  public.get_payroll_adjustment(uuid),
  public.list_payroll_adjustment_lines(uuid),
  public.list_payroll_adjustment_history(uuid),
  public.create_invoice_adjustment(uuid, uuid),
  public.review_invoice_adjustment(uuid),
  public.approve_invoice_adjustment(uuid),
  public.lock_invoice_adjustment(uuid),
  public.void_invoice_adjustment(uuid, text),
  public.list_invoice_adjustment_candidates(uuid),
  public.list_invoice_adjustments(uuid),
  public.get_invoice_adjustment(uuid),
  public.list_invoice_adjustment_lines(uuid),
  public.list_invoice_adjustment_history(uuid),
  public.approve_payroll_batch(uuid),
  public.approve_invoice_draft(uuid)
to authenticated;
