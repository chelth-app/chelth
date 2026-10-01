-- =============================================================================
-- Migration: adjustment_state
-- Stage:     P0-E7-S3
--
-- Purpose
--   The "last financially accounted" state of a timesheet, per side, and the
--   deterministic delta between it and the current priced revision.
--
--   Accounted base (payroll, per timesheet; invoice, per timesheet+relationship):
--     1. the latest non-cancelled/non-voided ADJUSTMENT → its to_revision
--        (the whole revision is accounted once an adjustment covers it);
--     2. else the claimed lines in the original batch/draft → their revision.
--
--   Matching: by timesheet entry (one entry per assignment, stable across
--   revisions) — never by names. Old side = accounted lines; new side = the
--   current priced revision. FULL JOIN on entry: absent on one side ⇒ added or
--   removed. A line is CHANGED when added, removed, or any of its minutes,
--   rate or amount differ (pay side: regular/overtime minutes, pay rate, pay
--   amount; bill side: priced/regular/overtime minutes, bill rate, bill amount).
--
--   States:
--     none                    nothing accounted yet (ordinary preparation)
--     accounted               base revision is current (document holds it)
--     adjusted                base is a locked/exported adjustment to current
--     in_progress             an open adjustment targets the current revision
--     in_progress_superseded  an open adjustment targets an older revision
--     original_open           the original document is not locked (S2:
--                             SOURCE_SUPERSEDED — cancel/void and re-prepare)
--     split                   accounted lines span several original documents
--     awaiting_lock           current revision not locked
--     awaiting_pricing        current revision locked but not priced
--     currency_mismatch       current pricing has another currency
--     no_change               revised, but no line changed financially —
--                             resolved without a document
--     required                an adjustment can be prepared
--
--   S2 functions replaced (same signatures): payroll/invoice source lines
--   (resolved revisions are no longer offered or held), document attention,
--   issue queues and reconciliation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Payroll: delta and state
-- -----------------------------------------------------------------------------
create function internal.payroll_adjustment_delta(
  p_timesheet_id uuid,
  p_base_kind text,
  p_base_document_id uuid,
  p_base_revision integer,
  p_new_revision integer
)
returns table (
  entry_id uuid,
  old_priced_line_id uuid,
  new_priced_line_id uuid,
  delta_regular_minutes integer,
  delta_overtime_minutes integer,
  delta_pay_amount_minor bigint,
  changed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with old_lines as (
    select l.* from public.priced_timesheet_lines l
    where l.timesheet_id = p_timesheet_id and l.timesheet_revision = p_base_revision
      and (p_base_kind = 'adjustment' or exists (
        select 1 from public.payroll_batch_lines b
        where b.payroll_batch_id = p_base_document_id and b.priced_line_id = l.id))
  ), new_lines as (
    select l.* from public.priced_timesheet_lines l
    where l.timesheet_id = p_timesheet_id and l.timesheet_revision = p_new_revision
  )
  select coalesce(o.entry_id, n.entry_id), o.id, n.id,
         coalesce(n.pay_regular_minutes, 0) - coalesce(o.pay_regular_minutes, 0),
         coalesce(n.pay_overtime_minutes, 0) - coalesce(o.pay_overtime_minutes, 0),
         coalesce(n.pay_amount_minor, 0) - coalesce(o.pay_amount_minor, 0),
         o.id is null or n.id is null
           or (o.pay_regular_minutes, o.pay_overtime_minutes, o.pay_rate_minor, o.pay_amount_minor)
              is distinct from (n.pay_regular_minutes, n.pay_overtime_minutes, n.pay_rate_minor, n.pay_amount_minor)
  from old_lines o
  full join new_lines n on n.entry_id = o.entry_id
$$;

create function internal.payroll_adjustment_status(p_timesheet_id uuid)
returns table (
  state text,
  base_kind text,
  base_document_id uuid,
  base_revision integer,
  root_batch_id uuid,
  base_currency text,
  current_revision integer,
  current_priced_timesheet_id uuid,
  changed_lines integer,
  net_delta_minor bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.timesheets;
  a public.payroll_adjustments;
  p public.priced_timesheets;
  v_batches uuid[];
  v_kind text;
  v_doc uuid;
  v_rev integer;
  v_root uuid;
  v_currency text;
  v_open boolean;
  v_state text;
  v_changed integer := 0;
  v_net bigint := 0;
begin
  select * into t from public.timesheets x where x.id = p_timesheet_id;
  if t.id is null then
    return;
  end if;
  select * into p from public.priced_timesheets x where x.timesheet_id = t.id and x.timesheet_revision = t.revision;

  select * into a from public.payroll_adjustments x
  where x.timesheet_id = t.id and x.status <> 'cancelled'
  order by x.to_revision desc limit 1;
  if a.id is not null then
    v_kind := 'adjustment';
    v_doc := a.id;
    v_rev := a.to_revision;
    v_root := a.original_payroll_batch_id;
    v_currency := a.currency;
    v_open := a.status in ('draft', 'reviewed', 'approved');
  else
    select array_agg(distinct c.payroll_batch_id), max(c.timesheet_revision) into v_batches, v_rev
    from public.payroll_line_claims c where c.timesheet_id = t.id;
    if v_batches is null then
      return query select 'none'::text, null::text, null::uuid, null::integer, null::uuid, null::text,
                          t.revision, p.id, 0, 0::bigint;
      return;
    end if;
    v_kind := 'batch';
    v_doc := v_batches[1];
    v_root := v_batches[1];
    select b.currency, b.status not in ('locked', 'exported') into v_currency, v_open
    from public.payroll_batches b where b.id = v_doc;
  end if;

  if v_rev = t.revision then
    v_state := case when v_kind = 'batch' then 'accounted' when v_open then 'in_progress' else 'adjusted' end;
  elsif v_open then
    v_state := case when v_kind = 'adjustment' then 'in_progress_superseded' else 'original_open' end;
  elsif cardinality(v_batches) > 1 then
    v_state := 'split';
  elsif t.status <> 'locked' then
    v_state := 'awaiting_lock';
  elsif p.id is null then
    v_state := 'awaiting_pricing';
  elsif p.currency <> v_currency then
    v_state := 'currency_mismatch';
  else
    select count(*) filter (where d.changed)::integer, coalesce(sum(d.delta_pay_amount_minor), 0)::bigint
      into v_changed, v_net
    from internal.payroll_adjustment_delta(t.id, v_kind, v_doc, v_rev, t.revision) d;
    v_state := case when v_changed = 0 then 'no_change' else 'required' end;
  end if;

  return query select v_state, v_kind, v_doc, v_rev, v_root, v_currency, t.revision, p.id, v_changed, v_net;
end;
$$;

-- -----------------------------------------------------------------------------
-- Invoice: delta and state (per timesheet + relationship)
-- -----------------------------------------------------------------------------
create function internal.invoice_adjustment_delta(
  p_timesheet_id uuid,
  p_relationship_id uuid,
  p_base_kind text,
  p_base_document_id uuid,
  p_base_revision integer,
  p_new_revision integer
)
returns table (
  entry_id uuid,
  old_priced_line_id uuid,
  new_priced_line_id uuid,
  delta_priced_minutes integer,
  delta_bill_amount_minor bigint,
  changed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with old_lines as (
    select l.* from public.priced_timesheet_lines l
    where l.timesheet_id = p_timesheet_id and l.relationship_id = p_relationship_id
      and l.timesheet_revision = p_base_revision
      and (p_base_kind = 'adjustment' or exists (
        select 1 from public.invoice_draft_lines d
        where d.invoice_draft_id = p_base_document_id and d.priced_line_id = l.id))
  ), new_lines as (
    select l.* from public.priced_timesheet_lines l
    where l.timesheet_id = p_timesheet_id and l.relationship_id = p_relationship_id
      and l.timesheet_revision = p_new_revision
  )
  select coalesce(o.entry_id, n.entry_id), o.id, n.id,
         coalesce(n.priced_minutes, 0) - coalesce(o.priced_minutes, 0),
         coalesce(n.bill_amount_minor, 0) - coalesce(o.bill_amount_minor, 0),
         o.id is null or n.id is null
           or (o.priced_minutes, o.bill_regular_minutes, o.bill_overtime_minutes, o.bill_rate_minor, o.bill_amount_minor)
              is distinct from
              (n.priced_minutes, n.bill_regular_minutes, n.bill_overtime_minutes, n.bill_rate_minor, n.bill_amount_minor)
  from old_lines o
  full join new_lines n on n.entry_id = o.entry_id
$$;

create function internal.invoice_adjustment_status(p_timesheet_id uuid, p_relationship_id uuid)
returns table (
  state text,
  base_kind text,
  base_document_id uuid,
  base_revision integer,
  root_draft_id uuid,
  base_currency text,
  current_revision integer,
  current_priced_timesheet_id uuid,
  changed_lines integer,
  net_delta_minor bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.timesheets;
  a public.invoice_adjustments;
  p public.priced_timesheets;
  v_drafts uuid[];
  v_kind text;
  v_doc uuid;
  v_rev integer;
  v_root uuid;
  v_currency text;
  v_open boolean;
  v_state text;
  v_changed integer := 0;
  v_net bigint := 0;
begin
  select * into t from public.timesheets x where x.id = p_timesheet_id;
  if t.id is null then
    return;
  end if;
  select * into p from public.priced_timesheets x where x.timesheet_id = t.id and x.timesheet_revision = t.revision;

  select * into a from public.invoice_adjustments x
  where x.timesheet_id = t.id and x.relationship_id = p_relationship_id and x.status <> 'voided'
  order by x.to_revision desc limit 1;
  if a.id is not null then
    v_kind := 'adjustment';
    v_doc := a.id;
    v_rev := a.to_revision;
    v_root := a.original_invoice_draft_id;
    v_currency := a.currency;
    v_open := a.status in ('draft', 'reviewed', 'approved');
  else
    select array_agg(distinct c.invoice_draft_id), max(c.timesheet_revision) into v_drafts, v_rev
    from public.invoice_line_claims c
    join public.invoice_draft_lines l on l.id = c.invoice_draft_line_id
    where c.timesheet_id = t.id and l.relationship_id = p_relationship_id;
    if v_drafts is null then
      return query select 'none'::text, null::text, null::uuid, null::integer, null::uuid, null::text,
                          t.revision, p.id, 0, 0::bigint;
      return;
    end if;
    v_kind := 'draft';
    v_doc := v_drafts[1];
    v_root := v_drafts[1];
    select d.currency, d.status not in ('locked', 'exported') into v_currency, v_open
    from public.invoice_drafts d where d.id = v_doc;
  end if;

  if v_rev = t.revision then
    v_state := case when v_kind = 'draft' then 'accounted' when v_open then 'in_progress' else 'adjusted' end;
  elsif v_open then
    v_state := case when v_kind = 'adjustment' then 'in_progress_superseded' else 'original_open' end;
  elsif cardinality(v_drafts) > 1 then
    v_state := 'split';
  elsif t.status <> 'locked' then
    v_state := 'awaiting_lock';
  elsif p.id is null then
    v_state := 'awaiting_pricing';
  elsif p.currency <> v_currency then
    v_state := 'currency_mismatch';
  else
    select count(*) filter (where d.changed)::integer, coalesce(sum(d.delta_bill_amount_minor), 0)::bigint
      into v_changed, v_net
    from internal.invoice_adjustment_delta(t.id, p_relationship_id, v_kind, v_doc, v_rev, t.revision) d;
    v_state := case when v_changed = 0 then 'no_change' else 'required' end;
  end if;

  return query select v_state, v_kind, v_doc, v_rev, v_root, v_currency, t.revision, p.id, v_changed, v_net;
end;
$$;

-- States that hold current work back from ordinary preparation.
create function internal.adjustment_state_holds(p_state text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_state in ('required', 'awaiting_lock', 'awaiting_pricing', 'original_open', 'in_progress_superseded',
                     'split', 'currency_mismatch')
$$;

-- -----------------------------------------------------------------------------
-- Source lines (S2 signatures). Resolved revisions are neither offered nor held.
-- -----------------------------------------------------------------------------
create or replace function internal.payroll_source_lines(p_organisation_id uuid)
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
  ), candidates as (
    select l.*
    from public.priced_timesheet_lines l
    join public.timesheets t on t.id = l.timesheet_id and t.revision = l.timesheet_revision and t.status = 'locked'
    where l.agency_organisation_id = p_organisation_id
      and not exists (select 1 from public.payroll_line_claims c where c.priced_line_id = l.id)
  ), states as (
    select x.timesheet_id, st.state
    from (select distinct c.timesheet_id from candidates c) x
    cross join lateral internal.payroll_adjustment_status(x.timesheet_id) st
  )
  select l.id, l.timesheet_id, l.timesheet_revision, l.agency_worker_id, l.currency,
         l.local_date - (((l.local_date - s.anchor) % s.len) + s.len) % s.len,
         l.local_date - (((l.local_date - s.anchor) % s.len) + s.len) % s.len + s.len - 1,
         l.pay_regular_minutes, l.pay_overtime_minutes, l.pay_amount_minor,
         internal.adjustment_state_holds(st.state)
  from candidates l
  join states st on st.timesheet_id = l.timesheet_id
  cross join s
  where st.state in ('none', 'accounted') or internal.adjustment_state_holds(st.state)
$$;

create or replace function internal.invoice_source_lines(p_organisation_id uuid)
returns table (
  priced_line_id uuid,
  timesheet_id uuid,
  timesheet_revision integer,
  relationship_id uuid,
  agency_facility_id uuid,
  agency_worker_id uuid,
  currency text,
  period_start date,
  period_end date,
  priced_minutes integer,
  bill_amount_minor bigint,
  adjustment_required boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    select l.*, pt.period_start as week_start, pt.period_end as week_end
    from public.priced_timesheet_lines l
    join public.priced_timesheets pt on pt.id = l.priced_timesheet_id
    join public.timesheets t on t.id = l.timesheet_id and t.revision = l.timesheet_revision and t.status = 'locked'
    where l.agency_organisation_id = p_organisation_id
      and not exists (select 1 from public.invoice_line_claims c where c.priced_line_id = l.id)
  ), states as (
    select x.timesheet_id, x.relationship_id, st.state
    from (select distinct c.timesheet_id, c.relationship_id from candidates c) x
    cross join lateral internal.invoice_adjustment_status(x.timesheet_id, x.relationship_id) st
  )
  select l.id, l.timesheet_id, l.timesheet_revision, l.relationship_id, l.agency_facility_id, l.agency_worker_id,
         l.currency, l.week_start, l.week_end, l.priced_minutes, l.bill_amount_minor,
         internal.adjustment_state_holds(st.state)
  from candidates l
  join states st on st.timesheet_id = l.timesheet_id and st.relationship_id = l.relationship_id
  where st.state in ('none', 'accounted') or internal.adjustment_state_holds(st.state)
$$;

-- -----------------------------------------------------------------------------
-- Document attention (S2 signatures)
--   open document with revised work      SOURCE_SUPERSEDED (fail closed)
--   locked/exported, unresolved          ADJUSTMENT_REQUIRED
--   locked/exported, adjustment open     ADJUSTMENT_IN_PROGRESS
--   locked/exported, all resolved        REVISION_RESOLVED (informational)
-- -----------------------------------------------------------------------------
create or replace function internal.payroll_batch_attention(p_batch_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.payroll_batches;
  v_states text[];
begin
  select * into b from public.payroll_batches x where x.id = p_batch_id;
  if b.id is null or b.status = 'cancelled' then
    return null;
  end if;
  select array_agg(st.state) into v_states
  from (select distinct l.timesheet_id from public.payroll_batch_lines l
        join public.timesheets t on t.id = l.timesheet_id
        where l.payroll_batch_id = b.id and (t.revision <> l.timesheet_revision or t.status <> 'locked')) x
  cross join lateral internal.payroll_adjustment_status(x.timesheet_id) st;
  if v_states is null then
    return null;
  elsif b.status not in ('locked', 'exported') then
    return 'SOURCE_SUPERSEDED';
  elsif exists (select 1 from unnest(v_states) s where internal.adjustment_state_holds(s)) then
    return 'ADJUSTMENT_REQUIRED';
  elsif 'in_progress' = any (v_states) then
    return 'ADJUSTMENT_IN_PROGRESS';
  end if;
  return 'REVISION_RESOLVED';
end;
$$;

create or replace function internal.invoice_draft_attention(p_draft_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.invoice_drafts;
  v_states text[];
begin
  select * into d from public.invoice_drafts x where x.id = p_draft_id;
  if d.id is null or d.status = 'voided' then
    return null;
  end if;
  select array_agg(st.state) into v_states
  from (select distinct l.timesheet_id from public.invoice_draft_lines l
        join public.timesheets t on t.id = l.timesheet_id
        where l.invoice_draft_id = d.id and (t.revision <> l.timesheet_revision or t.status <> 'locked')) x
  cross join lateral internal.invoice_adjustment_status(x.timesheet_id, d.relationship_id) st;
  if v_states is null then
    return null;
  elsif d.status not in ('locked', 'exported') then
    return 'SOURCE_SUPERSEDED';
  elsif exists (select 1 from unnest(v_states) s where internal.adjustment_state_holds(s)) then
    return 'ADJUSTMENT_REQUIRED';
  elsif 'in_progress' = any (v_states) then
    return 'ADJUSTMENT_IN_PROGRESS';
  end if;
  return 'REVISION_RESOLVED';
end;
$$;

-- -----------------------------------------------------------------------------
-- Issue queues (S2 signatures): ADJUSTMENT_REQUIRED now means unresolved only.
-- -----------------------------------------------------------------------------
create or replace function public.list_payroll_issues(p_organisation_id uuid)
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
    with tracked as (
      select distinct c.timesheet_id from public.payroll_line_claims c where c.agency_organisation_id = p_organisation_id
      union
      select distinct a.timesheet_id from public.payroll_adjustments a where a.agency_organisation_id = p_organisation_id
    )
    select 'ADJUSTMENT_REQUIRED'::text, t.id, null::uuid, pr.display_name, t.period_start, t.period_end, t.revision,
           st.base_revision, st.current_priced_timesheet_id is not null,
           array[coalesce(
             (select b.reference || ' (' || b.status::text || ')' from public.payroll_batches b where b.id = st.base_document_id),
             (select a.reference || ' (' || a.status::text || ')' from public.payroll_adjustments a where a.id = st.base_document_id))]
    from tracked x
    cross join lateral internal.payroll_adjustment_status(x.timesheet_id) st
    join public.timesheets t on t.id = x.timesheet_id
    join public.profiles pr on pr.id = t.profile_id
    where internal.adjustment_state_holds(st.state) and st.state <> 'original_open'
    union all
    select 'SOURCE_SUPERSEDED'::text, null::uuid, b.id, null::text, b.period_start, b.period_end, null::integer,
           null::integer, null::boolean, array[b.reference || ' (' || b.status::text || ')']
    from public.payroll_batches b
    where b.agency_organisation_id = p_organisation_id
      and b.status in ('draft', 'reviewed', 'approved')
      and internal.payroll_batch_attention(b.id) is not null
    union all
    select 'PRICING_REQUIRED'::text, t.id, null::uuid, pr.display_name, t.period_start, t.period_end, t.revision,
           null::integer, false, '{}'::text[]
    from public.timesheets t
    join public.profiles pr on pr.id = t.profile_id
    where t.agency_organisation_id = p_organisation_id
      and t.status = 'locked'
      and not exists (select 1 from public.priced_timesheets x where x.timesheet_id = t.id and x.timesheet_revision = t.revision)
    order by 1, 5 desc;
end;
$$;

create or replace function public.list_invoice_issues(p_organisation_id uuid)
returns table (
  issue_code text,
  timesheet_id uuid,
  invoice_draft_id uuid,
  facility_name text,
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
    select 'ADJUSTMENT_REQUIRED'::text, t.id, null::uuid, f.name, pr.display_name, t.period_start, t.period_end,
           t.revision, st.base_revision, st.current_priced_timesheet_id is not null,
           array[coalesce(
             (select d.reference || ' (' || d.status::text || ')' from public.invoice_drafts d where d.id = st.base_document_id),
             (select a.reference || ' (' || a.status::text || ')' from public.invoice_adjustments a where a.id = st.base_document_id))]
    from tracked x
    cross join lateral internal.invoice_adjustment_status(x.timesheet_id, x.relationship_id) st
    join public.timesheets t on t.id = x.timesheet_id
    join public.profiles pr on pr.id = t.profile_id
    join public.agency_facility_relationships r on r.id = x.relationship_id
    join public.agency_facilities f on f.id = r.agency_facility_id
    where internal.adjustment_state_holds(st.state) and st.state <> 'original_open'
    union all
    select 'SOURCE_SUPERSEDED'::text, null::uuid, d.id, d.facility_name, null::text, d.period_start, d.period_end,
           null::integer, null::integer, null::boolean, array[d.reference || ' (' || d.status::text || ')']
    from public.invoice_drafts d
    where d.agency_organisation_id = p_organisation_id
      and d.status in ('draft', 'reviewed', 'approved')
      and internal.invoice_draft_attention(d.id) is not null
    union all
    select 'PRICING_REQUIRED'::text, t.id, null::uuid, null::text, pr.display_name, t.period_start, t.period_end,
           t.revision, null::integer, false, '{}'::text[]
    from public.timesheets t
    join public.profiles pr on pr.id = t.profile_id
    where t.agency_organisation_id = p_organisation_id
      and t.status = 'locked'
      and not exists (select 1 from public.priced_timesheets x where x.timesheet_id = t.id and x.timesheet_revision = t.revision)
    order by 1, 6 desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reconciliation (S2 signature). States:
--   unprepared, drafted, approved, exported           lines + amounts (as S2)
--   adjustment_required                                changed lines + signed
--                                                      delta estimate (0 while
--                                                      awaiting lock/pricing)
--   adjustment_in_progress, adjusted                   adjustment lines + signed
--                                                      deltas (adjusted also
--                                                      counts no-change revisions
--                                                      with 0 lines)
-- -----------------------------------------------------------------------------
create or replace function public.financial_reconciliation(p_organisation_id uuid, p_side text)
returns table (state text, currency text, line_count integer, amount_minor bigint, minutes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  if p_side = 'pay' then
    perform internal.require_capability(p_organisation_id, 'payroll.view');
    return query
      with tracked as (
        select distinct c.timesheet_id from public.payroll_line_claims c where c.agency_organisation_id = p_organisation_id
        union
        select distinct a.timesheet_id from public.payroll_adjustments a where a.agency_organisation_id = p_organisation_id
      ), rows_ as (
        select 'unprepared'::text as state, s.currency, 1 as lines, s.pay_amount_minor as amount,
               (s.regular_minutes + s.overtime_minutes)::bigint as minutes
        from internal.payroll_source_lines(p_organisation_id) s
        where not s.adjustment_required
        union all
        select case when b.status in ('draft', 'reviewed') then 'drafted'
                    when b.status in ('approved', 'locked') then 'approved' else 'exported' end,
               l.currency, 1, l.pay_amount_minor, (l.regular_minutes + l.overtime_minutes)::bigint
        from public.payroll_line_claims c
        join public.payroll_batch_lines l on l.id = c.payroll_batch_line_id
        join public.payroll_batches b on b.id = c.payroll_batch_id
        where c.agency_organisation_id = p_organisation_id
        union all
        select 'adjustment_required', coalesce(st.base_currency, '—'), st.changed_lines, st.net_delta_minor, 0::bigint
        from tracked x cross join lateral internal.payroll_adjustment_status(x.timesheet_id) st
        where internal.adjustment_state_holds(st.state)
        union all
        select 'adjusted', st.base_currency, 0, 0::bigint, 0::bigint
        from tracked x cross join lateral internal.payroll_adjustment_status(x.timesheet_id) st
        where st.state = 'no_change'
        union all
        select case when a.status in ('draft', 'reviewed', 'approved') then 'adjustment_in_progress' else 'adjusted' end,
               l.currency, 1, l.delta_pay_amount_minor, (l.delta_regular_minutes + l.delta_overtime_minutes)::bigint
        from public.payroll_adjustment_lines l
        join public.payroll_adjustments a on a.id = l.payroll_adjustment_id
        where a.agency_organisation_id = p_organisation_id and a.status <> 'cancelled'
      )
      select r.state, r.currency, sum(r.lines)::integer, sum(r.amount)::bigint, sum(r.minutes)::bigint
      from rows_ r group by r.state, r.currency
      order by array_position(array['unprepared', 'drafted', 'approved', 'exported', 'adjustment_required',
                                    'adjustment_in_progress', 'adjusted'], r.state), r.currency;
  elsif p_side = 'bill' then
    perform internal.require_capability(p_organisation_id, 'invoice.view');
    return query
      with tracked as (
        select distinct c.timesheet_id, l.relationship_id
        from public.invoice_line_claims c join public.invoice_draft_lines l on l.id = c.invoice_draft_line_id
        where c.agency_organisation_id = p_organisation_id
        union
        select distinct a.timesheet_id, a.relationship_id from public.invoice_adjustments a
        where a.agency_organisation_id = p_organisation_id
      ), rows_ as (
        select 'unprepared'::text as state, s.currency, 1 as lines, s.bill_amount_minor as amount,
               s.priced_minutes::bigint as minutes
        from internal.invoice_source_lines(p_organisation_id) s
        where not s.adjustment_required
        union all
        select case when d.status in ('draft', 'reviewed') then 'drafted'
                    when d.status in ('approved', 'locked') then 'approved' else 'exported' end,
               l.currency, 1, l.bill_amount_minor, l.priced_minutes::bigint
        from public.invoice_line_claims c
        join public.invoice_draft_lines l on l.id = c.invoice_draft_line_id
        join public.invoice_drafts d on d.id = c.invoice_draft_id
        where c.agency_organisation_id = p_organisation_id
        union all
        select 'adjustment_required', coalesce(st.base_currency, '—'), st.changed_lines, st.net_delta_minor, 0::bigint
        from tracked x cross join lateral internal.invoice_adjustment_status(x.timesheet_id, x.relationship_id) st
        where internal.adjustment_state_holds(st.state)
        union all
        select 'adjusted', st.base_currency, 0, 0::bigint, 0::bigint
        from tracked x cross join lateral internal.invoice_adjustment_status(x.timesheet_id, x.relationship_id) st
        where st.state = 'no_change'
        union all
        select case when a.status in ('draft', 'reviewed', 'approved') then 'adjustment_in_progress' else 'adjusted' end,
               l.currency, 1, l.delta_bill_amount_minor, l.delta_priced_minutes::bigint
        from public.invoice_adjustment_lines l
        join public.invoice_adjustments a on a.id = l.invoice_adjustment_id
        where a.agency_organisation_id = p_organisation_id and a.status <> 'voided'
      )
      select r.state, r.currency, sum(r.lines)::integer, sum(r.amount)::bigint, sum(r.minutes)::bigint
      from rows_ r group by r.state, r.currency
      order by array_position(array['unprepared', 'drafted', 'approved', 'exported', 'adjustment_required',
                                    'adjustment_in_progress', 'adjusted'], r.state), r.currency;
  else
    raise exception 'side must be pay or bill' using errcode = 'CH400';
  end if;
end;
$$;

revoke all on function
  internal.payroll_adjustment_delta(uuid, text, uuid, integer, integer),
  internal.payroll_adjustment_status(uuid),
  internal.invoice_adjustment_delta(uuid, uuid, text, uuid, integer, integer),
  internal.invoice_adjustment_status(uuid, uuid),
  internal.adjustment_state_holds(text)
from public, anon, authenticated, service_role;
