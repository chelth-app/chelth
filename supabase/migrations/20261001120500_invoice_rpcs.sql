-- =============================================================================
-- Migration: invoice_rpcs
-- Stage:     P0-E7-S2
--
-- Purpose
--   Invoice DRAFTING API (bill side only). The browser supplies identifiers
--   only (agency, relationship, week, currency, draft). Bill minutes, rates
--   and amounts are copied from immutable priced lines; no pay value or
--   margin is read into, stored on or returned for a draft.
--
--   Source eligibility (bill side), under a per-agency advisory lock:
--     * current, locked priced revision;
--     * not claimed by a non-voided draft;
--     * no OTHER revision of the same timesheet is claimed for the same
--       relationship — otherwise "Adjustment required", referencing the
--       earlier draft(s), which stay unchanged.
--   Approve/lock fail closed while any line is no longer current.
--   Drafts are never sent, paid or overdue; there is no tax.
--
--   Errors: CHY02 SOURCE_SUPERSEDED · CHY03 FINANCIAL_DOCUMENT_LOCKED ·
--           CHY04 INVALID_FINANCIAL_TRANSITION · CHY07 INVOICE_DRAFT_NOT_FOUND ·
--           CHY09 NOTHING_TO_INVOICE · CHY10 FINANCIAL_LINE_ALREADY_INCLUDED
-- =============================================================================

create function internal.invoice_source_lines(p_organisation_id uuid)
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
  select l.id, l.timesheet_id, l.timesheet_revision, l.relationship_id, l.agency_facility_id, l.agency_worker_id,
         l.currency, pt.period_start, pt.period_end, l.priced_minutes, l.bill_amount_minor,
         exists (select 1 from public.invoice_line_claims c
                 join public.invoice_draft_lines il on il.id = c.invoice_draft_line_id
                 where c.timesheet_id = l.timesheet_id and c.timesheet_revision <> l.timesheet_revision
                   and il.relationship_id = l.relationship_id)
  from public.priced_timesheet_lines l
  join public.priced_timesheets pt on pt.id = l.priced_timesheet_id
  join public.timesheets t on t.id = l.timesheet_id and t.revision = l.timesheet_revision and t.status = 'locked'
  where l.agency_organisation_id = p_organisation_id
    and not exists (select 1 from public.invoice_line_claims c where c.priced_line_id = l.id)
$$;

create function internal.invoice_draft_attention(p_draft_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when d.status = 'voided' then null
    when not exists (
      select 1 from public.invoice_draft_lines l
      join public.timesheets t on t.id = l.timesheet_id
      where l.invoice_draft_id = d.id and (t.revision <> l.timesheet_revision or t.status <> 'locked')) then null
    when d.status in ('locked', 'exported') then 'ADJUSTMENT_REQUIRED'
    else 'SOURCE_SUPERSEDED' end
  from public.invoice_drafts d
  where d.id = p_draft_id
$$;

create function internal.invoice_draft_for_write(p_draft_id uuid, p_capability text)
returns public.invoice_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.invoice_drafts;
begin
  perform internal.require_identity();
  select * into d from public.invoice_drafts x where x.id = p_draft_id for update;
  if d.id is null or not authz.has_capability(d.agency_organisation_id, 'invoice.view') then
    raise exception 'invoice draft not found' using errcode = 'CHY07';
  end if;
  perform internal.require_capability(d.agency_organisation_id, p_capability);
  return d;
end;
$$;

create function internal.record_invoice_history(
  d public.invoice_drafts,
  p_action text,
  p_to public.invoice_draft_status,
  p_note text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.invoice_draft_history
    (invoice_draft_id, agency_organisation_id, action, from_status, to_status, actor_membership_id, note)
  values (d.id, d.agency_organisation_id, p_action,
          case when p_action = 'created' then null else d.status end, p_to,
          internal.active_membership_id(d.agency_organisation_id), p_note)
$$;

-- -----------------------------------------------------------------------------
-- Prepare
-- -----------------------------------------------------------------------------
create function public.create_invoice_draft(
  p_organisation_id uuid,
  p_relationship_id uuid,
  p_period_start date,
  p_currency text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.agency_facility_relationships;
  v_ids uuid[];
  v_id uuid;
  v_period_end date;
  v_reference text;
  d public.invoice_drafts;
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'invoice.prepare');
  if p_relationship_id is null or p_period_start is null or p_currency is null
     or not exists (select 1 from public.currencies c where c.code = p_currency) then
    raise exception 'a relationship, week and currency are required' using errcode = 'CH400';
  end if;
  select * into r from public.agency_facility_relationships x
  where x.id = p_relationship_id and x.agency_organisation_id = p_organisation_id;
  if r.id is null then
    raise exception 'relationship not found' using errcode = 'CH403';
  end if;
  if not internal.consume_rate_limit('invoice.prepare:' || p_organisation_id::text, 120, interval '1 hour') then
    raise exception 'too many invoice drafts' using errcode = 'CH429';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('chelth.invoice.prepare:' || p_organisation_id::text, 0));

  select array_agg(s.priced_line_id), min(s.period_end) into v_ids, v_period_end
  from internal.invoice_source_lines(p_organisation_id) s
  where s.relationship_id = p_relationship_id and s.period_start = p_period_start and s.currency = p_currency
    and not s.adjustment_required;
  if v_ids is null then
    raise exception 'no billable priced work is ready for this facility, week and currency' using errcode = 'CHY09';
  end if;

  v_reference := internal.next_financial_reference(p_organisation_id, 'invoice_draft',
                                                   extract(year from p_period_start)::integer);
  insert into public.invoice_drafts
    (agency_organisation_id, relationship_id, agency_facility_id, period_start, period_end, currency, reference,
     line_count, total_priced_minutes, total_bill_minor, agency_name, facility_name, created_by_membership_id)
  select p_organisation_id, r.id, r.agency_facility_id, p_period_start, v_period_end, p_currency, v_reference,
         count(*), sum(l.priced_minutes), sum(l.bill_amount_minor),
         (select o.name from public.organisations o where o.id = p_organisation_id),
         (select f.name from public.agency_facilities f where f.id = r.agency_facility_id),
         internal.active_membership_id(p_organisation_id)
  from public.priced_timesheet_lines l
  where l.id = any (v_ids)
  returning id into v_id;

  insert into public.invoice_draft_lines
    (invoice_draft_id, agency_organisation_id, relationship_id, agency_facility_id, period_start, period_end,
     currency, line_number, priced_line_id, priced_timesheet_id, timesheet_id, timesheet_revision, entry_id,
     agency_worker_id, profile_id, discipline_key, work_date, priced_minutes, bill_regular_minutes,
     bill_overtime_minutes, bill_rate_minor, bill_amount_minor, calculation_version, worker_reference,
     worker_name, discipline_name)
  select v_id, l.agency_organisation_id, l.relationship_id, l.agency_facility_id, p_period_start, v_period_end,
         l.currency, row_number() over (order by l.local_date, p.display_name, w.id, l.entry_id, l.id),
         l.id, l.priced_timesheet_id, l.timesheet_id, l.timesheet_revision, l.entry_id, l.agency_worker_id,
         l.profile_id, l.discipline_key, l.local_date, l.priced_minutes, l.bill_regular_minutes,
         l.bill_overtime_minutes, l.bill_rate_minor, l.bill_amount_minor, l.calculation_version,
         w.worker_reference, p.display_name, dd.name
  from public.priced_timesheet_lines l
  join public.agency_workers w on w.id = l.agency_worker_id
  join public.profiles p on p.id = l.profile_id
  join public.disciplines dd on dd.key = l.discipline_key
  where l.id = any (v_ids);

  begin
    insert into public.invoice_line_claims
      (priced_line_id, invoice_draft_id, invoice_draft_line_id, agency_organisation_id, timesheet_id,
       timesheet_revision)
    select l.priced_line_id, l.invoice_draft_id, l.id, l.agency_organisation_id, l.timesheet_id, l.timesheet_revision
    from public.invoice_draft_lines l where l.invoice_draft_id = v_id;
  exception when unique_violation then
    raise exception 'a bill line is already in another invoice draft' using errcode = 'CHY10';
  end;

  select * into d from public.invoice_drafts x where x.id = v_id;
  perform internal.record_invoice_history(d, 'created', 'draft');
  perform internal.record_audit_event('invoice.draft_created', p_organisation_id, 'invoice_draft', v_id,
    jsonb_build_object('reference', d.reference, 'relationship_id', d.relationship_id,
                       'period_start', d.period_start, 'currency', d.currency, 'line_count', d.line_count,
                       'total_bill_minor', d.total_bill_minor));
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Lifecycle
-- -----------------------------------------------------------------------------
create function public.review_invoice_draft(p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.invoice_drafts := internal.invoice_draft_for_write(p_draft_id, 'invoice.prepare');
begin
  if d.status <> 'draft' then
    raise exception 'only a draft can be marked reviewed' using errcode = 'CHY04';
  end if;
  update public.invoice_drafts x
     set status = 'reviewed', reviewed_at = now(),
         reviewed_by_membership_id = internal.active_membership_id(d.agency_organisation_id)
   where x.id = d.id;
  perform internal.record_invoice_history(d, 'reviewed', 'reviewed');
  perform internal.record_audit_event('invoice.draft_reviewed', d.agency_organisation_id, 'invoice_draft', d.id,
    jsonb_build_object('reference', d.reference));
end;
$$;

create function public.approve_invoice_draft(p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.invoice_drafts := internal.invoice_draft_for_write(p_draft_id, 'invoice.approve');
begin
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
    jsonb_build_object('reference', d.reference, 'total_bill_minor', d.total_bill_minor, 'currency', d.currency));
end;
$$;

create function public.lock_invoice_draft(p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.invoice_drafts := internal.invoice_draft_for_write(p_draft_id, 'invoice.approve');
begin
  if d.status <> 'approved' then
    raise exception 'only an approved draft can be locked' using errcode = 'CHY04';
  end if;
  if internal.invoice_draft_attention(d.id) is not null then
    raise exception 'the draft includes work that has been revised' using errcode = 'CHY02';
  end if;
  update public.invoice_drafts x
     set status = 'locked', locked_at = now(),
         locked_by_membership_id = internal.active_membership_id(d.agency_organisation_id)
   where x.id = d.id;
  perform internal.record_invoice_history(d, 'locked', 'locked');
  perform internal.record_audit_event('invoice.draft_locked', d.agency_organisation_id, 'invoice_draft', d.id,
    jsonb_build_object('reference', d.reference, 'total_bill_minor', d.total_bill_minor, 'currency', d.currency));
end;
$$;

-- Voiding never changes the draft's lines or totals; it releases the bill
-- lines so the work can be drafted again. Before approval invoice.prepare is
-- enough; from approval on it needs invoice.approve (AAL2).
create function public.void_invoice_draft(p_draft_id uuid, p_reason text)
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

-- -----------------------------------------------------------------------------
-- Projections (invoice.view) — bill side only
-- -----------------------------------------------------------------------------
create function public.list_billable_work(p_organisation_id uuid)
returns table (
  relationship_id uuid,
  agency_facility_id uuid,
  facility_name text,
  relationship_status text,
  period_start date,
  period_end date,
  currency text,
  adjustment_required boolean,
  line_count integer,
  worker_count integer,
  total_priced_minutes bigint,
  total_bill_minor bigint
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
    select s.relationship_id, s.agency_facility_id, f.name, r.status::text, s.period_start, s.period_end, s.currency,
           s.adjustment_required, count(*)::integer, count(distinct s.agency_worker_id)::integer,
           sum(s.priced_minutes)::bigint, sum(s.bill_amount_minor)::bigint
    from internal.invoice_source_lines(p_organisation_id) s
    join public.agency_facilities f on f.id = s.agency_facility_id
    join public.agency_facility_relationships r on r.id = s.relationship_id
    group by s.relationship_id, s.agency_facility_id, f.name, r.status, s.period_start, s.period_end, s.currency,
             s.adjustment_required
    order by s.adjustment_required desc, f.name, s.period_start desc, s.currency;
end;
$$;

create function public.list_invoice_issues(p_organisation_id uuid)
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
    select 'ADJUSTMENT_REQUIRED'::text, t.id, null::uuid, d.facility_name, p.display_name, t.period_start,
           t.period_end, t.revision, max(c.timesheet_revision)::integer,
           exists (select 1 from public.priced_timesheets x where x.timesheet_id = t.id and x.timesheet_revision = t.revision),
           array_agg(distinct d.reference || ' (' || d.status::text || ')')
    from public.invoice_line_claims c
    join public.timesheets t on t.id = c.timesheet_id
    join public.invoice_drafts d on d.id = c.invoice_draft_id
    join public.profiles p on p.id = t.profile_id
    where c.agency_organisation_id = p_organisation_id
      and c.timesheet_revision <> t.revision
      and d.status in ('locked', 'exported')
    group by t.id, d.facility_name, p.display_name
    union all
    select 'SOURCE_SUPERSEDED'::text, null::uuid, d.id, d.facility_name, null::text, d.period_start, d.period_end,
           null::integer, null::integer, null::boolean, array[d.reference || ' (' || d.status::text || ')']
    from public.invoice_drafts d
    where d.agency_organisation_id = p_organisation_id
      and d.status in ('draft', 'reviewed', 'approved')
      and internal.invoice_draft_attention(d.id) is not null
    union all
    select 'PRICING_REQUIRED'::text, t.id, null::uuid, null::text, p.display_name, t.period_start, t.period_end,
           t.revision, null::integer, false, '{}'::text[]
    from public.timesheets t
    join public.profiles p on p.id = t.profile_id
    where t.agency_organisation_id = p_organisation_id
      and t.status = 'locked'
      and not exists (select 1 from public.priced_timesheets x where x.timesheet_id = t.id and x.timesheet_revision = t.revision)
    order by 1, 6 desc;
end;
$$;

create function public.list_invoice_drafts(p_organisation_id uuid, p_status public.invoice_draft_status default null)
returns table (
  invoice_draft_id uuid,
  reference text,
  relationship_id uuid,
  facility_name text,
  period_start date,
  period_end date,
  currency text,
  status public.invoice_draft_status,
  line_count integer,
  total_priced_minutes bigint,
  total_bill_minor bigint,
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
    select d.id, d.reference, d.relationship_id, d.facility_name, d.period_start, d.period_end, d.currency, d.status,
           d.line_count, d.total_priced_minutes, d.total_bill_minor, d.created_at,
           internal.membership_display_name(d.created_by_membership_id), internal.invoice_draft_attention(d.id),
           (select count(*)::integer from public.financial_exports e where e.invoice_draft_id = d.id)
    from public.invoice_drafts d
    where d.agency_organisation_id = p_organisation_id
      and (p_status is null or d.status = p_status)
    order by (internal.invoice_draft_attention(d.id) is not null) desc, d.period_start desc, d.created_at desc
    limit 200;
end;
$$;

create function public.get_invoice_draft(p_draft_id uuid)
returns table (
  invoice_draft_id uuid,
  agency_organisation_id uuid,
  reference text,
  relationship_id uuid,
  agency_facility_id uuid,
  facility_name text,
  period_start date,
  period_end date,
  currency text,
  status public.invoice_draft_status,
  line_count integer,
  total_priced_minutes bigint,
  total_bill_minor bigint,
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
  select x.agency_organisation_id into v_org from public.invoice_drafts x where x.id = p_draft_id;
  if v_org is null or not authz.has_capability(v_org, 'invoice.view') then
    raise exception 'invoice draft not found' using errcode = 'CHY07';
  end if;
  return query
    select d.id, d.agency_organisation_id, d.reference, d.relationship_id, d.agency_facility_id, d.facility_name,
           d.period_start, d.period_end, d.currency, d.status, d.line_count, d.total_priced_minutes,
           d.total_bill_minor, d.created_at, internal.membership_display_name(d.created_by_membership_id),
           d.reviewed_at, internal.membership_display_name(d.reviewed_by_membership_id),
           d.approved_at, internal.membership_display_name(d.approved_by_membership_id),
           d.locked_at, internal.membership_display_name(d.locked_by_membership_id),
           d.exported_at, d.voided_at, internal.membership_display_name(d.voided_by_membership_id),
           d.void_reason, internal.invoice_draft_attention(d.id)
    from public.invoice_drafts d
    where d.id = p_draft_id;
end;
$$;

create function public.list_invoice_draft_lines(p_draft_id uuid)
returns table (
  line_number integer,
  work_date date,
  worker_reference text,
  worker_name text,
  discipline_name text,
  priced_minutes integer,
  bill_regular_minutes integer,
  bill_overtime_minutes integer,
  bill_rate_minor bigint,
  bill_amount_minor bigint,
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
  select x.agency_organisation_id into v_org from public.invoice_drafts x where x.id = p_draft_id;
  if v_org is null or not authz.has_capability(v_org, 'invoice.view') then
    raise exception 'invoice draft not found' using errcode = 'CHY07';
  end if;
  return query
    select l.line_number, l.work_date, l.worker_reference, l.worker_name, l.discipline_name, l.priced_minutes,
           l.bill_regular_minutes, l.bill_overtime_minutes, l.bill_rate_minor, l.bill_amount_minor, l.timesheet_id,
           l.timesheet_revision, t.revision, (t.revision <> l.timesheet_revision or t.status <> 'locked')
    from public.invoice_draft_lines l
    join public.timesheets t on t.id = l.timesheet_id
    where l.invoice_draft_id = p_draft_id
    order by l.line_number;
end;
$$;

create function public.list_invoice_draft_history(p_draft_id uuid)
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
  select x.agency_organisation_id into v_org from public.invoice_drafts x where x.id = p_draft_id;
  if v_org is null or not authz.has_capability(v_org, 'invoice.view') then
    raise exception 'invoice draft not found' using errcode = 'CHY07';
  end if;
  return query
    select h.action, h.from_status, h.to_status, internal.membership_display_name(h.actor_membership_id), h.note,
           h.occurred_at
    from public.invoice_draft_history h
    where h.invoice_draft_id = p_draft_id
    order by h.occurred_at, h.id;
end;
$$;

revoke all on function
  internal.invoice_source_lines(uuid),
  internal.invoice_draft_attention(uuid),
  internal.invoice_draft_for_write(uuid, text),
  internal.record_invoice_history(public.invoice_drafts, text, public.invoice_draft_status, text)
from public, anon, authenticated, service_role;

revoke all on function
  public.create_invoice_draft(uuid, uuid, date, text),
  public.review_invoice_draft(uuid),
  public.approve_invoice_draft(uuid),
  public.lock_invoice_draft(uuid),
  public.void_invoice_draft(uuid, text),
  public.list_billable_work(uuid),
  public.list_invoice_issues(uuid),
  public.list_invoice_drafts(uuid, public.invoice_draft_status),
  public.get_invoice_draft(uuid),
  public.list_invoice_draft_lines(uuid),
  public.list_invoice_draft_history(uuid)
from public, anon;

grant execute on function
  public.create_invoice_draft(uuid, uuid, date, text),
  public.review_invoice_draft(uuid),
  public.approve_invoice_draft(uuid),
  public.lock_invoice_draft(uuid),
  public.void_invoice_draft(uuid, text),
  public.list_billable_work(uuid),
  public.list_invoice_issues(uuid),
  public.list_invoice_drafts(uuid, public.invoice_draft_status),
  public.get_invoice_draft(uuid),
  public.list_invoice_draft_lines(uuid),
  public.list_invoice_draft_history(uuid)
to authenticated;
