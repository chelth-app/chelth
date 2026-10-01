-- =============================================================================
-- Migration: pricing_vocabulary
-- Stage:     P0-E7-S1 (pay & bill rate foundations)
--
-- Purpose
--   Capabilities (least privilege):
--     rates.view     view rate cards, rounding and overtime policies
--     rates.manage   create, edit drafts of and activate rates and policies (AAL2)
--     pricing.view   view priced timesheets (pay AND bill amounts)
--     pricing.run    price a locked timesheet revision
--
--       agency.admin               all four
--       agency.finance             all four
--       agency.operations_manager  rates.view, pricing.view
--       scheduler / recruiter / credentialing / healthcare worker: none
--       facility roles: none (facilities never see pay, margin or pricing)
--
--   Vocabularies: shift classification, rate/policy lifecycle, rounding and
--   overtime modes, pricing sides; ISO 4217 currency reference data (minor
--   unit digits); the pricing-blocked notification; the timesheet history
--   action for a sign-off that is no longer required (relationship ended).
--
--   Shifts gain a controlled `classification` (default `regular`, fixed once
--   the shift is open) — an operational attribute used to SELECT a rate, never
--   a money column. Composite keys for pricing integrity.
-- =============================================================================

insert into public.capabilities (key, description, is_privileged) values
  ('rates.view',   'View pay and bill rate cards and pricing policies.',                      false),
  ('rates.manage', 'Create and activate pay and bill rates, rounding and overtime policies.', true),
  ('pricing.view', 'View priced timesheets, including pay and bill amounts.',                 false),
  ('pricing.run',  'Price locked timesheets using the active rate versions and policies.',    false);

insert into public.role_capabilities (role_key, capability_key)
select role_key, capability_key
from (values
  ('agency.admin', 'rates.view'), ('agency.admin', 'rates.manage'),
  ('agency.admin', 'pricing.view'), ('agency.admin', 'pricing.run'),
  ('agency.finance', 'rates.view'), ('agency.finance', 'rates.manage'),
  ('agency.finance', 'pricing.view'), ('agency.finance', 'pricing.run'),
  ('agency.operations_manager', 'rates.view'), ('agency.operations_manager', 'pricing.view')
) as mapping (role_key, capability_key);

create type public.shift_classification as enum ('regular', 'evening', 'night', 'weekend');
create type public.rate_version_status as enum ('draft', 'active', 'discarded');
create type public.rounding_mode as enum ('none', 'nearest');
create type public.overtime_mode as enum ('none', 'weekly_threshold');
create type public.pricing_side as enum ('pay', 'bill');

alter type internal.notification_event add value if not exists 'pricing_blocked_missing_rate';
alter type public.timesheet_history_action add value if not exists 'facility_signoff_not_required';

-- ISO 4217 reference data. No FX: a priced record has exactly one currency.
create table public.currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  name text not null,
  minor_unit_digits smallint not null check (minor_unit_digits between 0 and 3),
  active boolean not null default true
);
insert into public.currencies (code, name, minor_unit_digits) values
  ('USD', 'US dollar', 2),
  ('CAD', 'Canadian dollar', 2),
  ('GBP', 'Pound sterling', 2),
  ('EUR', 'Euro', 2),
  ('AUD', 'Australian dollar', 2),
  ('NZD', 'New Zealand dollar', 2);

alter table public.currencies enable row level security;
grant select on public.currencies to authenticated;
create policy currencies_select on public.currencies for select to authenticated using (true);

create trigger currencies_no_change
  before update or delete on public.currencies
  for each row execute function internal.refuse_update_delete();

-- Shift classification: chosen explicitly, never inferred from free text.
alter table public.shifts
  add column classification public.shift_classification not null default 'regular';

create function internal.enforce_shift_classification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.classification is distinct from old.classification and old.status not in ('draft', 'submitted') then
    raise exception 'the classification is fixed once a shift is open' using errcode = 'CH409';
  end if;
  return new;
end;
$$;

create trigger shifts_classification_fixed
  before update of classification on public.shifts
  for each row execute function internal.enforce_shift_classification();

alter table public.shifts
  add constraint shifts_pricing_key unique (id, agency_organisation_id, discipline_key, classification);
alter table public.timesheet_approvals
  add constraint timesheet_approvals_revision_key unique (id, timesheet_id, revision);
alter table public.timesheet_entries
  add constraint timesheet_entries_pricing_key
  unique (id, timesheet_id, assignment_id, shift_id, agency_worker_id, profile_id, relationship_id, agency_facility_id);

revoke all on function internal.enforce_shift_classification() from public, anon, authenticated;
