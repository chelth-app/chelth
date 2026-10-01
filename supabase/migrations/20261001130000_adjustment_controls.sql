-- =============================================================================
-- Migration: adjustment_controls
-- Stage:     P0-E7-S3 (financial adjustments & control hardening)
--
-- Purpose
--   * Agency settings gain:
--       financial_maker_checker_required (default FALSE — existing agencies
--       keep today's workflow) and the adjustment reference prefixes
--       (PAY-ADJ, INV-ADJ).
--   * Reference counters accept the adjustment kinds.
--   * internal.audit_financial_denial — safe, bounded denial audit:
--       - at most 60 denial attempts recorded per actor per hour (checked
--         first, which also bounds the dedupe counters);
--       - one row per (actor, action, target, reason) per 15 minutes;
--       - metadata is the attempted action and a reason code only.
--   * internal.financial_authorize — the single authorisation gate for
--     sensitive financial actions (approvals, downloads). It returns NULL when
--     allowed, else a reason code (NOT_FOUND, NOT_PERMITTED, MFA_REQUIRED,
--     MAKER_CHECKER) after auditing the denial. Callers RETURN the denial
--     instead of raising, so the audit row commits.
--   * set_financial_maker_checker — AAL2 (payroll.approve AND
--     invoice.approve), audited.
--   * get_agency_financial_settings now also returns the maker/checker flag.
--
--   No capability is added: adjustments reuse payroll.* / invoice.*.
-- =============================================================================

alter table public.agency_financial_settings
  add column financial_maker_checker_required boolean not null default false,
  add column payroll_adjustment_prefix text not null default 'PAY-ADJ'
    check (payroll_adjustment_prefix ~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$' and char_length(payroll_adjustment_prefix) <= 20),
  add column invoice_adjustment_prefix text not null default 'INV-ADJ'
    check (invoice_adjustment_prefix ~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$' and char_length(invoice_adjustment_prefix) <= 20);

alter table internal.financial_reference_counters
  drop constraint financial_reference_counters_kind_check,
  add constraint financial_reference_counters_kind_check
    check (kind in ('payroll_batch', 'invoice_draft', 'payroll_adjustment', 'invoice_adjustment'));

create function internal.maker_checker_required(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.financial_maker_checker_required from public.agency_financial_settings s
                   where s.agency_organisation_id = p_organisation_id), false)
$$;

create or replace function internal.next_financial_reference(p_organisation_id uuid, p_kind text, p_year integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value integer;
  v_prefix text;
begin
  insert into internal.financial_reference_counters as c (agency_organisation_id, kind, year, last_value)
  values (p_organisation_id, p_kind, p_year, 1)
  on conflict (agency_organisation_id, kind, year) do update set last_value = c.last_value + 1
  returning c.last_value into v_value;
  select case p_kind
           when 'payroll_batch' then s.payroll_reference_prefix
           when 'invoice_draft' then s.invoice_reference_prefix
           when 'payroll_adjustment' then coalesce(x.payroll_adjustment_prefix, 'PAY-ADJ')
           else coalesce(x.invoice_adjustment_prefix, 'INV-ADJ') end
    into v_prefix
  from internal.financial_settings_for(p_organisation_id) s
  left join public.agency_financial_settings x on x.agency_organisation_id = p_organisation_id;
  return v_prefix || '-' || p_year::text || '-' || lpad(v_value::text, 6, '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- Denial audit (bounded; no names, no free text, no file content)
-- -----------------------------------------------------------------------------
create function internal.audit_financial_denial(
  p_organisation_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := coalesce(auth.uid()::text, 'anonymous');
begin
  -- The per-actor cap comes first, so neither audit rows nor dedupe counters
  -- can grow without bound (e.g. by cycling random target ids).
  if not internal.consume_rate_limit('fin.denial.cap:' || v_actor, 60, interval '1 hour') then
    return;
  end if;
  -- Repeats of the same denial within 15 minutes are not re-recorded.
  if not internal.consume_rate_limit(
       'fin.denial:' || v_actor || ':' || p_action || ':' || coalesce(p_target_id::text, '-') || ':' || p_reason,
       1, interval '15 minutes') then
    return;
  end if;
  -- Recorded in the agency's history only when the actor belongs to it.
  perform internal.record_audit_event('financial.action_denied',
    case when p_organisation_id is not null and authz.is_org_member(p_organisation_id) then p_organisation_id end,
    p_target_type, p_target_id,
    jsonb_build_object('attempted_action', p_action, 'reason_code', p_reason));
end;
$$;

-- NULL = allowed. Otherwise the denial is audited and its reason returned.
--   NOT_FOUND      caller cannot see the target (no oracle)
--   MFA_REQUIRED   capability held, session not AAL2
--   NOT_PERMITTED  capability not held
--   MAKER_CHECKER  maker/checker on and the caller prepared the document
create function internal.financial_authorize(
  p_organisation_id uuid,
  p_capability text,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_preparer_membership_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_view text := split_part(p_capability, '.', 1) || '.view';
  v_reason text;
begin
  if p_organisation_id is null or not authz.has_capability(p_organisation_id, v_view) then
    v_reason := 'NOT_FOUND';
  elsif not authz.has_capability(p_organisation_id, p_capability) then
    v_reason := case when exists (
        select 1 from internal.profile_capabilities(auth.uid(), p_organisation_id) held
        where held.capability_key = p_capability) then 'MFA_REQUIRED' else 'NOT_PERMITTED' end;
  elsif p_preparer_membership_id is not null
        and internal.maker_checker_required(p_organisation_id)
        and internal.active_membership_id(p_organisation_id) = p_preparer_membership_id then
    v_reason := 'MAKER_CHECKER';
  end if;
  if v_reason is not null then
    perform internal.audit_financial_denial(p_organisation_id, p_action, p_target_type, p_target_id, v_reason);
  end if;
  return v_reason;
end;
$$;

-- -----------------------------------------------------------------------------
-- Maker/checker setting
-- -----------------------------------------------------------------------------
create function public.set_financial_maker_checker(p_organisation_id uuid, p_required boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'payroll.approve');
  perform internal.require_capability(p_organisation_id, 'invoice.approve');
  if p_required is null then
    raise exception 'choose whether a second approver is required' using errcode = 'CH400';
  end if;
  select * into s from internal.financial_settings_for(p_organisation_id);
  insert into public.agency_financial_settings as x
    (agency_organisation_id, payroll_period_type, payroll_week_starts_on, payroll_anchor_date,
     payroll_reference_prefix, invoice_reference_prefix, financial_maker_checker_required,
     updated_by_profile_id, updated_at)
  values (p_organisation_id, s.payroll_period_type, s.payroll_week_starts_on, s.payroll_anchor_date,
          s.payroll_reference_prefix, s.invoice_reference_prefix, p_required, auth.uid(), now())
  on conflict (agency_organisation_id) do update
    set financial_maker_checker_required = excluded.financial_maker_checker_required,
        updated_by_profile_id = excluded.updated_by_profile_id,
        updated_at = excluded.updated_at;
  perform internal.record_audit_event('financial.maker_checker_updated', p_organisation_id, 'organisation',
    p_organisation_id, jsonb_build_object('required', p_required));
end;
$$;

drop function public.get_agency_financial_settings(uuid);
create function public.get_agency_financial_settings(p_organisation_id uuid)
returns table (
  payroll_period_type public.payroll_period_type,
  payroll_week_starts_on smallint,
  payroll_anchor_date date,
  payroll_reference_prefix text,
  invoice_reference_prefix text,
  configured boolean,
  maker_checker_required boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform internal.require_identity();
  if not (authz.has_capability(p_organisation_id, 'payroll.view')
          or authz.has_capability(p_organisation_id, 'invoice.view')) then
    perform internal.require_capability(p_organisation_id, 'payroll.view');
  end if;
  return query
    select s.*, exists (select 1 from public.agency_financial_settings x where x.agency_organisation_id = p_organisation_id),
           internal.maker_checker_required(p_organisation_id)
    from internal.financial_settings_for(p_organisation_id) s;
end;
$$;

-- Composite keys the adjustment documents reference.
alter table public.payroll_batches
  add constraint payroll_batches_adjustment_key unique (id, agency_organisation_id, currency);

revoke all on function
  internal.maker_checker_required(uuid),
  internal.audit_financial_denial(uuid, text, text, uuid, text),
  internal.financial_authorize(uuid, text, text, text, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function
  public.set_financial_maker_checker(uuid, boolean),
  public.get_agency_financial_settings(uuid)
from public, anon;
grant execute on function
  public.set_financial_maker_checker(uuid, boolean),
  public.get_agency_financial_settings(uuid)
to authenticated;
