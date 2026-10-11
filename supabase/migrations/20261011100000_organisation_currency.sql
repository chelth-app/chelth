-- =============================================================================
-- Migration: organisation_currency
-- Stage:     P0-E9-3I (Language & Region)
--
-- Purpose
--   One authoritative organisation DEFAULT currency (ISO 4217 code), used to
--   preselect the currency of new rates and to label money entry. It is NOT a
--   conversion setting and it never rewrites money:
--   - every rate version, priced timesheet, payroll batch, invoice draft and
--     adjustment keeps the currency it was created with (unchanged columns);
--   - Chelth has no FX: a workspace may not switch its default away from a
--     currency its financial records already use (DATABASE-enforced, CHY22).
--   Changing the currency never changes the locale and vice versa (separate
--   columns, separate RPCs; organisations.locale is P0-E9-3F).
--
--   NULL default ⇒ the app shows the currency already in use, else a
--   suggestion from the locale (en-GB ⇒ GBP, otherwise USD). Existing rows are
--   not rewritten.
--
--   Also: internal.notification_template returns the recipient workspace's
--   `locale`, so operational emails use the workspace's spelling.
-- =============================================================================

alter table public.organisations
  add column default_currency text references public.currencies (code) on delete restrict;

comment on column public.organisations.default_currency is
  'Default ISO 4217 currency for NEW rates (P0-E9-3I). Never converts or rewrites existing money.';

-- Currencies already used by the organisation's financial records (any state
-- except discarded rate drafts). Snapshots are authoritative for their money.
create function internal.organisation_currencies_in_use(p_organisation_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct c order by c), '{}'::text[])
  from (
    select v.currency as c from public.rate_card_versions v
     where v.agency_organisation_id = p_organisation_id and v.status <> 'discarded'
    union select t.currency from public.priced_timesheets t where t.agency_organisation_id = p_organisation_id
    union select b.currency from public.payroll_batches b where b.agency_organisation_id = p_organisation_id
    union select d.currency from public.invoice_drafts d where d.agency_organisation_id = p_organisation_id
    union select a.currency from public.payroll_adjustments a where a.agency_organisation_id = p_organisation_id
    union select a.currency from public.invoice_adjustments a where a.agency_organisation_id = p_organisation_id
  ) used
$$;

-- Read model for Settings (organisation.view): the default and what is in use.
create function public.get_organisation_currency(p_organisation_id uuid)
returns table (default_currency text, currencies_in_use text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'organisation.view');
  return query
    select o.default_currency, internal.organisation_currencies_in_use(o.id)
    from public.organisations o where o.id = p_organisation_id;
end;
$$;

-- Set the default (organisation.manage, privileged ⇒ AAL2). Refused when the
-- organisation's financial records use a different currency: no FX, no
-- reinterpretation of existing money.
create function public.set_organisation_currency(p_organisation_id uuid, p_currency text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_in_use text[];
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'organisation.manage');
  if p_currency is null or not exists (
    select 1 from public.currencies c where c.code = p_currency and c.active) then
    raise exception 'unsupported currency' using errcode = 'CH400';
  end if;
  select o.default_currency into v_old from public.organisations o where o.id = p_organisation_id for update;
  v_in_use := internal.organisation_currencies_in_use(p_organisation_id);
  if exists (select 1 from unnest(v_in_use) u where u <> p_currency) then
    raise exception 'financial records already use another currency' using errcode = 'CHY22';
  end if;
  if v_old is distinct from p_currency then
    update public.organisations o set default_currency = p_currency where o.id = p_organisation_id;
    perform internal.record_audit_event('organisation.currency_updated', p_organisation_id, 'organisation',
      p_organisation_id, jsonb_build_object('from', v_old, 'to', p_currency));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Email presentation: the recipient workspace's locale travels with the
-- template data (P0-E9-3I). Same resolver as P0-E9-3G, one extra field.
-- -----------------------------------------------------------------------------
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
  v_assignment public.shift_assignments;
  v_offer public.shift_offers;
  v_data jsonb;
  v_facility_org uuid;
  v_audience text;
  v_path text;
  v_shift_status public.shift_status;
  v_start_at timestamptz;
begin
  select * into n from internal.notification_outbox x where x.id = p_notification_id;
  if n.id is null then
    return null;
  end if;

  if n.subject_type = 'shift_assignment' then
    select * into v_assignment from public.shift_assignments a where a.id = n.subject_id;
    v_shift_id := v_assignment.shift_id;
    v_worker_id := v_assignment.agency_worker_id;
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

  if n.subject_type = 'conversation_thread' then
    -- P0-E9-3D-S3: a new message for the worker. Never the message body.
    if v_audience <> 'worker' then
      return null;
    end if;
    select jsonb_build_object('agencyName', o.name, 'facilityName', f.name,
                              'startAt', s.start_at, 'endAt', s.end_at, 'timezone', s.timezone)
      into v_data
    from public.conversation_threads t
    join public.organisations o on o.id = t.agency_organisation_id
    left join public.shifts s on s.id = t.shift_id
    left join public.agency_facilities f on f.id = s.agency_facility_id
    where t.id = n.subject_id and t.agency_organisation_id = n.organisation_id
      and t.worker_profile_id = n.recipient_profile_id;
    if v_data is null then
      return null;
    end if;
    v_path := '/app/organisations/' || n.organisation_id || '/messages/' || n.subject_id;
  elsif n.subject_type = 'relationship' then
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
    -- P0-E9-3G: a worker's assignment email is only for that worker's own assignment.
    if v_audience = 'worker' and n.subject_type = 'shift_assignment'
       and v_assignment.profile_id is distinct from n.recipient_profile_id then
      return null;
    end if;

    select jsonb_build_object(
             'agencyName', o.name,
             'facilityName', f.name,
             'locationName', l.name,
             'disciplineName', d.name,
             'startAt', s.start_at,
             'endAt', s.end_at,
             'timezone', s.timezone,
             'shiftStatus', s.status,
             'cancellationReason', s.cancellation_reason,
             'unitLabel', s.unit_label,
             'arrivalInstructions', case
               when v_audience = 'worker' and n.event in ('worker_assigned', 'shift_reminder')
               then left(f.arrival_instructions, 280) end),
           f.linked_facility_organisation_id, s.status, s.start_at
      into v_data, v_facility_org, v_shift_status, v_start_at
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

    -- P0-E9-3G: never deliver a change or a reminder for work that is no
    -- longer active (cancelled, declined, completed, or already started).
    if n.event = 'shift_changed'
       and (v_assignment.status not in ('assigned', 'accepted') or v_shift_status <> 'open') then
      return null;
    end if;
    if n.event = 'shift_reminder'
       and (v_assignment.status <> 'accepted' or v_shift_status <> 'open' or v_start_at <= now()) then
      return null;
    end if;

    v_path := case
      when v_audience = 'worker' and n.subject_type = 'shift_assignment'
           and n.event in ('worker_assigned', 'shift_changed', 'shift_reminder')
        then '/app/organisations/' || n.organisation_id || '/my-shifts/' || n.subject_id
      when v_audience = 'worker' then '/app/organisations/' || n.organisation_id || '/my-shifts'
      when v_audience = 'facility' then '/app/organisations/' || n.audience_organisation_id || '/staffing-requests/' || v_shift_id
      else '/app/organisations/' || n.organisation_id || '/shifts/' || v_shift_id end;

    if v_audience = 'agency' and v_worker_id is not null then
      v_data := v_data || jsonb_build_object('workerName', (
        select p.display_name from public.agency_workers w join public.profiles p on p.id = w.profile_id
        where w.id = v_worker_id and w.agency_organisation_id = n.organisation_id));
    end if;
    if n.subject_type = 'shift_offer' then
      v_data := v_data || jsonb_build_object('offerExpiresAt', v_offer.expires_at, 'offerStatus', v_offer.status);
    end if;
    -- Change detail: previous location / role resolved to display names, same agency only.
    if n.event = 'shift_changed' then
      v_data := v_data || jsonb_build_object(
        'previousLocationName', (select l.name from public.facility_locations l
                                 where l.id = (n.detail ->> 'previousLocationId')::uuid
                                   and l.agency_organisation_id = n.organisation_id),
        'previousDisciplineName', (select d.name from public.disciplines d
                                   where d.key = n.detail ->> 'previousDisciplineKey'));
    end if;
  end if;

  return coalesce(v_data, '{}'::jsonb) || (n.detail - 'previousLocationId' - 'previousDisciplineKey')
    || jsonb_build_object(
    'event', n.event,
    'audience', v_audience,
    'path', v_path,
    'recipientName', (select p.display_name from public.profiles p where p.id = n.recipient_profile_id),
    -- P0-E9-3I: the recipient workspace's language (spelling only; NULL ⇒ en-US).
    'locale', (select o.locale from public.organisations o where o.id = n.audience_organisation_id));
end;
$$;

revoke all on function internal.notification_template(uuid) from public, anon, authenticated, service_role;
revoke all on function internal.organisation_currencies_in_use(uuid) from public, anon, authenticated, service_role;
revoke all on function
  public.get_organisation_currency(uuid),
  public.set_organisation_currency(uuid, text)
from public, anon;
grant execute on function
  public.get_organisation_currency(uuid),
  public.set_organisation_currency(uuid, text)
to authenticated;
