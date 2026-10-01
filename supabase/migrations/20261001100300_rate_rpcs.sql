-- =============================================================================
-- Migration: rate_rpcs
-- Stage:     P0-E7-S1
--
-- Purpose
--   Rate and policy administration (rates.manage, AAL2), all audited with ids,
--   codes and minor-unit values only.
--
--   * create_rate_card: one scope (agency, relationship|all, discipline,
--     classification|any); idempotent per scope.
--   * create/update/discard a DRAFT version; activate it. Activation freezes the
--     terms. If an active open-ended (or later-ending) version of the same card
--     covers the new start date, that version is superseded FROM the new start
--     (history before the start is untouched). A new version starting on or
--     before an existing active version's start is refused (CHM12): history is
--     never rewritten.
--   * Rounding and overtime policies: draft → active; the latest active start
--     on or before the date applies.
--   * set_shift_classification: while the shift is draft/submitted.
--
--   Errors: CHM04 RATE_NOT_FOUND · CHM03 RATE_NOT_ACTIVE (not a draft) ·
--           CHM10 INVALID_RATE · CHM11 INVALID_EFFECTIVE_PERIOD ·
--           CHM12 OVERLAPPING_RATE_VERSION · CHM13 ROUNDING_POLICY_INVALID ·
--           CHM14 OVERTIME_POLICY_INVALID · CHM06 RATE_CURRENCY_MISMATCH (inactive currency)
-- =============================================================================

create function internal.validate_rate_terms(p_currency text, p_pay bigint, p_bill bigint, p_from date, p_to date)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_currency is null or not exists (select 1 from public.currencies c where c.code = p_currency and c.active) then
    raise exception 'unsupported currency' using errcode = 'CHM06';
  end if;
  if p_pay is null or p_bill is null or p_pay not between 1 and 100000000 or p_bill not between 1 and 100000000 then
    raise exception 'rates must be positive amounts in minor units' using errcode = 'CHM10';
  end if;
  if p_from is null or (p_to is not null and p_to < p_from) then
    raise exception 'invalid effective period' using errcode = 'CHM11';
  end if;
end;
$$;

create function public.create_rate_card(
  p_organisation_id uuid,
  p_discipline_key text,
  p_relationship_id uuid default null,
  p_classification public.shift_classification default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'rates.manage');
  if not exists (select 1 from public.disciplines d where d.key = p_discipline_key) then
    raise exception 'unknown discipline' using errcode = 'CH400';
  end if;
  if p_relationship_id is not null and not exists (
    select 1 from public.agency_facility_relationships r
    where r.id = p_relationship_id and r.agency_organisation_id = p_organisation_id) then
    raise exception 'relationship not found' using errcode = 'CHR04';
  end if;
  select c.id into v_id from public.rate_cards c
  where c.agency_organisation_id = p_organisation_id and c.discipline_key = p_discipline_key
    and c.relationship_id is not distinct from p_relationship_id
    and c.classification is not distinct from p_classification;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.rate_cards (agency_organisation_id, relationship_id, discipline_key, classification,
                                 created_by_membership_id)
  values (p_organisation_id, p_relationship_id, p_discipline_key, p_classification,
          internal.active_membership_id(p_organisation_id))
  returning id into v_id;
  perform internal.record_audit_event('rate.card_created', p_organisation_id, 'rate_card', v_id,
    jsonb_build_object('relationship_id', p_relationship_id, 'discipline', p_discipline_key,
                       'classification', p_classification));
  return v_id;
end;
$$;

create function public.create_rate_version(
  p_rate_card_id uuid,
  p_currency text,
  p_pay_rate_minor bigint,
  p_bill_rate_minor bigint,
  p_effective_from date,
  p_effective_to date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.rate_cards;
  v_id uuid;
  v_version integer;
begin
  perform internal.require_identity();
  select * into c from public.rate_cards r where r.id = p_rate_card_id;
  if c.id is null or not authz.has_capability(c.agency_organisation_id, 'rates.view') then
    raise exception 'rate card not found' using errcode = 'CHM04';
  end if;
  perform internal.require_capability(c.agency_organisation_id, 'rates.manage');
  perform internal.validate_rate_terms(p_currency, p_pay_rate_minor, p_bill_rate_minor, p_effective_from, p_effective_to);
  perform 1 from public.rate_cards r where r.id = c.id for update;
  select coalesce(max(v.version), 0) + 1 into v_version from public.rate_card_versions v where v.rate_card_id = c.id;
  insert into public.rate_card_versions (rate_card_id, agency_organisation_id, version, currency, pay_rate_minor,
                                         bill_rate_minor, effective_from, effective_to, created_by_membership_id)
  values (c.id, c.agency_organisation_id, v_version, p_currency, p_pay_rate_minor, p_bill_rate_minor,
          p_effective_from, p_effective_to, internal.active_membership_id(c.agency_organisation_id))
  returning id into v_id;
  perform internal.record_audit_event('rate.created', c.agency_organisation_id, 'rate_version', v_id,
    jsonb_build_object('rate_card_id', c.id, 'version', v_version, 'currency', p_currency,
                       'pay_rate_minor', p_pay_rate_minor, 'bill_rate_minor', p_bill_rate_minor,
                       'effective_from', p_effective_from, 'effective_to', p_effective_to));
  return v_id;
end;
$$;

-- The caller's draft version of a card, locked (card lock first: one activation at a time per card).
create function internal.draft_rate_version(p_version_id uuid)
returns public.rate_card_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.rate_card_versions;
begin
  perform internal.require_identity();
  select * into v from public.rate_card_versions x where x.id = p_version_id;
  if v.id is null or not authz.has_capability(v.agency_organisation_id, 'rates.view') then
    raise exception 'rate version not found' using errcode = 'CHM04';
  end if;
  perform internal.require_capability(v.agency_organisation_id, 'rates.manage');
  perform 1 from public.rate_cards r where r.id = v.rate_card_id for update;
  select * into v from public.rate_card_versions x where x.id = p_version_id for update;
  if v.status <> 'draft' then
    raise exception 'only a draft version can be changed' using errcode = 'CHM03';
  end if;
  return v;
end;
$$;

create function public.update_rate_version_draft(
  p_version_id uuid,
  p_currency text,
  p_pay_rate_minor bigint,
  p_bill_rate_minor bigint,
  p_effective_from date,
  p_effective_to date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.rate_card_versions := internal.draft_rate_version(p_version_id);
begin
  perform internal.validate_rate_terms(p_currency, p_pay_rate_minor, p_bill_rate_minor, p_effective_from, p_effective_to);
  update public.rate_card_versions x
     set currency = p_currency, pay_rate_minor = p_pay_rate_minor, bill_rate_minor = p_bill_rate_minor,
         effective_from = p_effective_from, effective_to = p_effective_to
   where x.id = v.id;
  perform internal.record_audit_event('rate.updated_draft', v.agency_organisation_id, 'rate_version', v.id,
    jsonb_build_object('currency', p_currency, 'pay_rate_minor', p_pay_rate_minor, 'bill_rate_minor', p_bill_rate_minor,
                       'effective_from', p_effective_from, 'effective_to', p_effective_to));
end;
$$;

create function public.discard_rate_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.rate_card_versions := internal.draft_rate_version(p_version_id);
begin
  update public.rate_card_versions x set status = 'discarded', discarded_at = now() where x.id = v.id;
  perform internal.record_audit_event('rate.discarded', v.agency_organisation_id, 'rate_version', v.id, '{}'::jsonb);
end;
$$;

create function public.activate_rate_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.rate_card_versions := internal.draft_rate_version(p_version_id);
  v_new_end date := coalesce(v.effective_to + 1, 'infinity'::date);
  o record;
begin
  perform internal.validate_rate_terms(v.currency, v.pay_rate_minor, v.bill_rate_minor, v.effective_from, v.effective_to);
  for o in
    select x.id, x.effective_from, upper(x.effective_period) as period_end
    from public.rate_card_versions x
    where x.rate_card_id = v.rate_card_id and x.status = 'active'
      and x.effective_period && daterange(v.effective_from, v_new_end, '[)')
    order by x.effective_from
  loop
    -- Supersede only an earlier version, and only if the new version covers the rest of it.
    if o.effective_from >= v.effective_from or v_new_end < o.period_end then
      raise exception 'this version would overlap an existing active version' using errcode = 'CHM12';
    end if;
    update public.rate_card_versions x set superseded_from = v.effective_from where x.id = o.id;
    perform internal.record_audit_event('rate.superseded', v.agency_organisation_id, 'rate_version', o.id,
      jsonb_build_object('superseded_from', v.effective_from, 'by_version_id', v.id));
  end loop;
  update public.rate_card_versions x
     set status = 'active', activated_at = now(),
         activated_by_membership_id = internal.active_membership_id(v.agency_organisation_id)
   where x.id = v.id;
  perform internal.record_audit_event('rate.activated', v.agency_organisation_id, 'rate_version', v.id,
    jsonb_build_object('rate_card_id', v.rate_card_id, 'version', v.version, 'currency', v.currency,
                       'pay_rate_minor', v.pay_rate_minor, 'bill_rate_minor', v.bill_rate_minor,
                       'effective_from', v.effective_from, 'effective_to', v.effective_to));
end;
$$;

-- -----------------------------------------------------------------------------
-- Rounding and overtime policies
-- -----------------------------------------------------------------------------
create function public.create_rounding_policy(
  p_organisation_id uuid,
  p_mode public.rounding_mode,
  p_effective_from date,
  p_increment_minutes smallint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_version integer;
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'rates.manage');
  if p_mode is null or p_effective_from is null
     or (p_mode = 'none') <> (p_increment_minutes is null)
     or (p_increment_minutes is not null and p_increment_minutes not in (5, 6, 10, 15)) then
    raise exception 'invalid rounding policy' using errcode = 'CHM13';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rounding:' || p_organisation_id::text, 0));
  select coalesce(max(r.version), 0) + 1 into v_version from public.rounding_policy_versions r
  where r.agency_organisation_id = p_organisation_id;
  insert into public.rounding_policy_versions (agency_organisation_id, version, mode, increment_minutes,
                                               effective_from, created_by_membership_id)
  values (p_organisation_id, v_version, p_mode, p_increment_minutes, p_effective_from,
          internal.active_membership_id(p_organisation_id))
  returning id into v_id;
  perform internal.record_audit_event('pricing.rounding_policy_created', p_organisation_id, 'rounding_policy', v_id,
    jsonb_build_object('mode', p_mode, 'increment_minutes', p_increment_minutes, 'effective_from', p_effective_from));
  return v_id;
end;
$$;

create function public.create_overtime_policy(
  p_organisation_id uuid,
  p_side public.pricing_side,
  p_mode public.overtime_mode,
  p_effective_from date,
  p_weekly_threshold_minutes integer default null,
  p_multiplier_numerator integer default null,
  p_multiplier_denominator integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_version integer;
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'rates.manage');
  if p_side is null or p_mode is null or p_effective_from is null
     or (p_mode = 'none' and (p_weekly_threshold_minutes, p_multiplier_numerator, p_multiplier_denominator)
                             is distinct from (null::integer, null::integer, null::integer))
     or (p_mode = 'weekly_threshold'
         and (p_weekly_threshold_minutes is null or p_weekly_threshold_minutes not between 60 and 10080
              or p_multiplier_numerator is null or p_multiplier_denominator is null
              or p_multiplier_denominator not between 1 and 100 or p_multiplier_numerator not between 1 and 1000
              or p_multiplier_numerator < p_multiplier_denominator)) then
    raise exception 'invalid overtime policy' using errcode = 'CHM14';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('overtime:' || p_organisation_id::text || p_side::text, 0));
  select coalesce(max(o.version), 0) + 1 into v_version from public.overtime_policy_versions o
  where o.agency_organisation_id = p_organisation_id and o.side = p_side;
  insert into public.overtime_policy_versions (agency_organisation_id, side, version, mode, weekly_threshold_minutes,
                                               multiplier_numerator, multiplier_denominator, effective_from,
                                               created_by_membership_id)
  values (p_organisation_id, p_side, v_version, p_mode, p_weekly_threshold_minutes, p_multiplier_numerator,
          p_multiplier_denominator, p_effective_from, internal.active_membership_id(p_organisation_id))
  returning id into v_id;
  perform internal.record_audit_event('pricing.overtime_policy_created', p_organisation_id, 'overtime_policy', v_id,
    jsonb_build_object('side', p_side, 'mode', p_mode, 'weekly_threshold_minutes', p_weekly_threshold_minutes,
                       'multiplier_numerator', p_multiplier_numerator,
                       'multiplier_denominator', p_multiplier_denominator, 'effective_from', p_effective_from));
  return v_id;
end;
$$;

-- Activate or discard a draft rounding/overtime policy.
create function public.set_pricing_policy_status(
  p_policy_id uuid,
  p_status public.rate_version_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_kind text;
  v_status public.rate_version_status;
  v_membership uuid;
begin
  perform internal.require_identity();
  select r.agency_organisation_id, 'rounding', r.status into v_org, v_kind, v_status
  from public.rounding_policy_versions r where r.id = p_policy_id;
  if v_org is null then
    select o.agency_organisation_id, 'overtime', o.status into v_org, v_kind, v_status
    from public.overtime_policy_versions o where o.id = p_policy_id;
  end if;
  if v_org is null or not authz.has_capability(v_org, 'rates.view') then
    raise exception 'policy not found' using errcode = 'CHM04';
  end if;
  perform internal.require_capability(v_org, 'rates.manage');
  if v_status <> 'draft' or p_status not in ('active', 'discarded') then
    raise exception 'only a draft policy can be activated or discarded' using errcode = 'CHM03';
  end if;
  v_membership := internal.active_membership_id(v_org);
  begin
    if v_kind = 'rounding' then
      update public.rounding_policy_versions r
         set status = p_status,
             activated_at = case when p_status = 'active' then now() end,
             activated_by_membership_id = case when p_status = 'active' then v_membership end,
             discarded_at = case when p_status = 'discarded' then now() end
       where r.id = p_policy_id;
    else
      update public.overtime_policy_versions o
         set status = p_status,
             activated_at = case when p_status = 'active' then now() end,
             activated_by_membership_id = case when p_status = 'active' then v_membership end,
             discarded_at = case when p_status = 'discarded' then now() end
       where o.id = p_policy_id;
    end if;
  exception when unique_violation then
    raise exception 'an active policy already starts on that date' using errcode = 'CHM12';
  end;
  perform internal.record_audit_event(
    case when p_status = 'active' then 'pricing.policy_activated' else 'pricing.policy_discarded' end,
    v_org, v_kind || '_policy', p_policy_id, jsonb_build_object('kind', v_kind));
end;
$$;

-- -----------------------------------------------------------------------------
-- Shift classification (operational attribute; fixed once the shift is open)
-- -----------------------------------------------------------------------------
create function public.set_shift_classification(p_shift_id uuid, p_classification public.shift_classification)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts;
begin
  perform internal.require_identity();
  select * into s from public.shifts x where x.id = p_shift_id;
  if s.id is null or not authz.has_capability(s.agency_organisation_id, 'shift.view') then
    raise exception 'shift not found' using errcode = 'CHS04';
  end if;
  perform internal.require_capability(s.agency_organisation_id, 'shift.manage');
  if p_classification is null then
    raise exception 'choose a classification' using errcode = 'CH400';
  end if;
  update public.shifts x set classification = p_classification where x.id = s.id;
  perform internal.record_audit_event('shift.classification_set', s.agency_organisation_id, 'shift', s.id,
    jsonb_build_object('classification', p_classification));
end;
$$;

-- -----------------------------------------------------------------------------
-- Projection: rate cards with their versions (keyset by (created_at, id))
-- -----------------------------------------------------------------------------
create function public.list_rate_cards(
  p_organisation_id uuid,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns table (
  rate_card_id uuid,
  created_at timestamptz,
  relationship_id uuid,
  facility_name text,
  discipline_key text,
  discipline_name text,
  classification public.shift_classification,
  versions jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'rates.view');
  return query
    select c.id, c.created_at, c.relationship_id, f.name, c.discipline_key, d.name, c.classification,
           coalesce((select jsonb_agg(jsonb_build_object(
                       'id', v.id, 'version', v.version, 'status', v.status, 'currency', v.currency,
                       'pay_rate_minor', v.pay_rate_minor, 'bill_rate_minor', v.bill_rate_minor,
                       'effective_from', v.effective_from, 'effective_to', v.effective_to,
                       'superseded_from', v.superseded_from,
                       'period_end', case when upper_inf(v.effective_period)
                                               or upper(v.effective_period) = 'infinity'::date then null
                                          else upper(v.effective_period) - 1 end)
                     order by v.version desc)
                     from (select * from public.rate_card_versions x where x.rate_card_id = c.id
                           order by x.version desc limit 50) v), '[]'::jsonb)
    from public.rate_cards c
    join public.disciplines d on d.key = c.discipline_key
    left join public.agency_facility_relationships r on r.id = c.relationship_id
    left join public.agency_facilities f on f.id = r.agency_facility_id
    where c.agency_organisation_id = p_organisation_id
      and (p_after_created_at is null or (c.created_at, c.id) > (p_after_created_at, p_after_id))
    order by c.created_at, c.id
    limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

revoke all on function
  internal.validate_rate_terms(text, bigint, bigint, date, date),
  internal.draft_rate_version(uuid)
from public, anon, authenticated, service_role;

revoke all on function
  public.create_rate_card(uuid, text, uuid, public.shift_classification),
  public.create_rate_version(uuid, text, bigint, bigint, date, date),
  public.update_rate_version_draft(uuid, text, bigint, bigint, date, date),
  public.discard_rate_version(uuid),
  public.activate_rate_version(uuid),
  public.create_rounding_policy(uuid, public.rounding_mode, date, smallint),
  public.create_overtime_policy(uuid, public.pricing_side, public.overtime_mode, date, integer, integer, integer),
  public.set_pricing_policy_status(uuid, public.rate_version_status),
  public.set_shift_classification(uuid, public.shift_classification),
  public.list_rate_cards(uuid, timestamptz, uuid, integer)
from public, anon;

grant execute on function
  public.create_rate_card(uuid, text, uuid, public.shift_classification),
  public.create_rate_version(uuid, text, bigint, bigint, date, date),
  public.update_rate_version_draft(uuid, text, bigint, bigint, date, date),
  public.discard_rate_version(uuid),
  public.activate_rate_version(uuid),
  public.create_rounding_policy(uuid, public.rounding_mode, date, smallint),
  public.create_overtime_policy(uuid, public.pricing_side, public.overtime_mode, date, integer, integer, integer),
  public.set_pricing_policy_status(uuid, public.rate_version_status),
  public.set_shift_classification(uuid, public.shift_classification),
  public.list_rate_cards(uuid, timestamptz, uuid, integer)
to authenticated;
