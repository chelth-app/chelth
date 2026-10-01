-- =============================================================================
-- Migration: financial_vocabulary
-- Stage:     P0-E7-S2 (payroll preparation & invoice drafting)
--
-- Purpose
--   Capabilities (least privilege; approve/export are privileged ⇒ AAL2):
--     payroll.view     view payroll periods, batches, exports, reconciliation
--     payroll.prepare  create, review and cancel draft payroll batches
--     payroll.approve  approve and lock payroll batches              (AAL2)
--     payroll.export   generate and download payroll exports         (AAL2)
--     invoice.view     view invoice drafts (bill side only), exports
--     invoice.prepare  create, review and cancel invoice drafts
--     invoice.approve  approve, lock and void invoice drafts         (AAL2)
--     invoice.export   generate and download invoice draft documents (AAL2)
--
--       agency.admin               all eight
--       agency.finance             all eight
--       agency.operations_manager  payroll.view, invoice.view
--       scheduler / recruiter / credentialing / healthcare worker: none
--       facility roles: none (facilities never see internal financial records)
--
--   Agency financial settings: payroll period type (weekly | biweekly), the
--   weekday payroll periods start on and the anchor date that fixes biweekly
--   alignment (DATE only, no timezone), and the reference prefixes.
--   Monotonic reference counters per (agency, document kind, year).
--
--   This is PREPARATION. Nothing here runs payroll, pays anyone, calculates
--   tax, sends an invoice or collects payment.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

insert into public.capabilities (key, description, is_privileged) values
  ('payroll.view',    'View payroll periods, batches, exports and reconciliation.',          false),
  ('payroll.prepare', 'Prepare, review and cancel draft payroll batches from priced work.',  false),
  ('payroll.approve', 'Approve and lock payroll batches.',                                   true),
  ('payroll.export',  'Generate and download payroll batch exports.',                        true),
  ('invoice.view',    'View invoice drafts (bill side only) and their exports.',             false),
  ('invoice.prepare', 'Prepare, review and cancel invoice drafts from billable priced work.', false),
  ('invoice.approve', 'Approve, lock and void invoice drafts.',                              true),
  ('invoice.export',  'Generate and download invoice draft documents.',                      true);

insert into public.role_capabilities (role_key, capability_key)
select role_key, capability_key
from (values
  ('agency.admin', 'payroll.view'), ('agency.admin', 'payroll.prepare'),
  ('agency.admin', 'payroll.approve'), ('agency.admin', 'payroll.export'),
  ('agency.admin', 'invoice.view'), ('agency.admin', 'invoice.prepare'),
  ('agency.admin', 'invoice.approve'), ('agency.admin', 'invoice.export'),
  ('agency.finance', 'payroll.view'), ('agency.finance', 'payroll.prepare'),
  ('agency.finance', 'payroll.approve'), ('agency.finance', 'payroll.export'),
  ('agency.finance', 'invoice.view'), ('agency.finance', 'invoice.prepare'),
  ('agency.finance', 'invoice.approve'), ('agency.finance', 'invoice.export'),
  ('agency.operations_manager', 'payroll.view'), ('agency.operations_manager', 'invoice.view')
) as mapping (role_key, capability_key);

create type public.payroll_period_type as enum ('weekly', 'biweekly');
create type public.payroll_batch_status as enum ('draft', 'reviewed', 'approved', 'locked', 'exported', 'cancelled');
create type public.invoice_draft_status as enum ('draft', 'reviewed', 'approved', 'locked', 'exported', 'voided');

-- -----------------------------------------------------------------------------
-- Agency financial settings
-- -----------------------------------------------------------------------------
create table public.agency_financial_settings (
  agency_organisation_id uuid primary key references public.organisations (id) on delete restrict,
  payroll_period_type public.payroll_period_type not null default 'weekly',
  -- ISO weekday (1 = Monday … 7 = Sunday) payroll periods start on.
  payroll_week_starts_on smallint not null check (payroll_week_starts_on between 1 and 7),
  -- Any date that starts a payroll period; fixes biweekly alignment.
  payroll_anchor_date date not null check (payroll_anchor_date between date '2000-01-01' and date '2099-12-31'),
  payroll_reference_prefix text not null default 'PAY'
    check (payroll_reference_prefix ~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$' and char_length(payroll_reference_prefix) <= 20),
  invoice_reference_prefix text not null default 'INV-DRAFT'
    check (invoice_reference_prefix ~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$' and char_length(invoice_reference_prefix) <= 20),
  updated_by_profile_id uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  check (extract(isodow from payroll_anchor_date) = payroll_week_starts_on)
);

comment on table public.agency_financial_settings is
  'Payroll period configuration (calendar DATES, no timezone) and document reference prefixes.';

alter table public.agency_financial_settings enable row level security;
grant select on public.agency_financial_settings to authenticated;
create policy agency_financial_settings_select on public.agency_financial_settings
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'payroll.view')
         or authz.has_capability(agency_organisation_id, 'invoice.view'));

-- Effective settings: stored, else weekly starting on the agency's timesheet
-- week start (default Monday). 2000-01-03 is a Monday.
create function internal.financial_settings_for(p_organisation_id uuid)
returns table (
  payroll_period_type public.payroll_period_type,
  payroll_week_starts_on smallint,
  payroll_anchor_date date,
  payroll_reference_prefix text,
  invoice_reference_prefix text
)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.payroll_period_type, 'weekly'::public.payroll_period_type),
         coalesce(s.payroll_week_starts_on, ts.week_starts_on, 1::smallint),
         coalesce(s.payroll_anchor_date, date '2000-01-03' + (coalesce(ts.week_starts_on, 1) - 1)),
         coalesce(s.payroll_reference_prefix, 'PAY'),
         coalesce(s.invoice_reference_prefix, 'INV-DRAFT')
  from (select p_organisation_id as id) o
  left join public.agency_financial_settings s on s.agency_organisation_id = o.id
  left join public.agency_timesheet_settings ts on ts.agency_organisation_id = o.id
$$;

-- The payroll period containing a calendar date (pure date arithmetic).
create function internal.payroll_period_for(p_organisation_id uuid, p_date date)
returns table (period_type public.payroll_period_type, period_start date, period_end date)
language sql
stable
security definer
set search_path = ''
as $$
  select s.payroll_period_type,
         p_date - (((p_date - s.payroll_anchor_date) % x.len) + x.len) % x.len,
         p_date - (((p_date - s.payroll_anchor_date) % x.len) + x.len) % x.len + x.len - 1
  from internal.financial_settings_for(p_organisation_id) s
  cross join lateral (select case s.payroll_period_type when 'weekly' then 7 else 14 end as len) x
$$;

-- -----------------------------------------------------------------------------
-- Reference counters: PREFIX-YYYY-NNNNNN, monotonic per (agency, kind, year).
-- -----------------------------------------------------------------------------
create table internal.financial_reference_counters (
  agency_organisation_id uuid not null references public.organisations (id) on delete restrict,
  kind text not null check (kind in ('payroll_batch', 'invoice_draft')),
  year integer not null check (year between 2000 and 2099),
  last_value integer not null check (last_value between 1 and 999999),
  primary key (agency_organisation_id, kind, year)
);
alter table internal.financial_reference_counters enable row level security;

create trigger financial_reference_counters_no_delete
  before delete on internal.financial_reference_counters
  for each row execute function internal.refuse_update_delete();

create function internal.next_financial_reference(p_organisation_id uuid, p_kind text, p_year integer)
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
  select case p_kind when 'payroll_batch' then s.payroll_reference_prefix else s.invoice_reference_prefix end
    into v_prefix
  from internal.financial_settings_for(p_organisation_id) s;
  return v_prefix || '-' || p_year::text || '-' || lpad(v_value::text, 6, '0');
end;
$$;

create function public.set_agency_financial_settings(
  p_organisation_id uuid,
  p_payroll_period_type public.payroll_period_type,
  p_payroll_anchor_date date,
  p_payroll_reference_prefix text default 'PAY',
  p_invoice_reference_prefix text default 'INV-DRAFT'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'payroll.approve');
  perform internal.require_capability(p_organisation_id, 'invoice.approve');
  if p_payroll_period_type is null or p_payroll_anchor_date is null
     or p_payroll_anchor_date not between date '2000-01-01' and date '2099-12-31' then
    raise exception 'a payroll period type and anchor date are required' using errcode = 'CH400';
  end if;
  if coalesce(p_payroll_reference_prefix, '') !~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$'
     or char_length(p_payroll_reference_prefix) > 20
     or coalesce(p_invoice_reference_prefix, '') !~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$'
     or char_length(p_invoice_reference_prefix) > 20 then
    raise exception 'reference prefixes use capital letters, digits and single hyphens' using errcode = 'CH400';
  end if;
  insert into public.agency_financial_settings as s
    (agency_organisation_id, payroll_period_type, payroll_week_starts_on, payroll_anchor_date,
     payroll_reference_prefix, invoice_reference_prefix, updated_by_profile_id, updated_at)
  values (p_organisation_id, p_payroll_period_type, extract(isodow from p_payroll_anchor_date)::smallint,
          p_payroll_anchor_date, p_payroll_reference_prefix, p_invoice_reference_prefix, auth.uid(), now())
  on conflict (agency_organisation_id) do update
    set payroll_period_type = excluded.payroll_period_type,
        payroll_week_starts_on = excluded.payroll_week_starts_on,
        payroll_anchor_date = excluded.payroll_anchor_date,
        payroll_reference_prefix = excluded.payroll_reference_prefix,
        invoice_reference_prefix = excluded.invoice_reference_prefix,
        updated_by_profile_id = excluded.updated_by_profile_id,
        updated_at = excluded.updated_at;
  perform internal.record_audit_event('payroll.settings_updated', p_organisation_id, 'organisation',
    p_organisation_id, jsonb_build_object('payroll_period_type', p_payroll_period_type,
                                          'payroll_anchor_date', p_payroll_anchor_date,
                                          'payroll_reference_prefix', p_payroll_reference_prefix,
                                          'invoice_reference_prefix', p_invoice_reference_prefix));
end;
$$;

create function public.get_agency_financial_settings(p_organisation_id uuid)
returns table (
  payroll_period_type public.payroll_period_type,
  payroll_week_starts_on smallint,
  payroll_anchor_date date,
  payroll_reference_prefix text,
  invoice_reference_prefix text,
  configured boolean
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
    select s.*, exists (select 1 from public.agency_financial_settings x where x.agency_organisation_id = p_organisation_id)
    from internal.financial_settings_for(p_organisation_id) s;
end;
$$;

revoke all on function
  internal.financial_settings_for(uuid),
  internal.payroll_period_for(uuid, date),
  internal.next_financial_reference(uuid, text, integer)
from public, anon, authenticated, service_role;
revoke all on function
  public.set_agency_financial_settings(uuid, public.payroll_period_type, date, text, text),
  public.get_agency_financial_settings(uuid)
from public, anon;
grant execute on function
  public.set_agency_financial_settings(uuid, public.payroll_period_type, date, text, text),
  public.get_agency_financial_settings(uuid)
to authenticated;
