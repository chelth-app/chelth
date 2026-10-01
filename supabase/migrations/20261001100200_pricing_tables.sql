-- =============================================================================
-- Migration: pricing_tables
-- Stage:     P0-E7-S1
--
-- Purpose
--   Immutable pricing snapshots of LOCKED timesheet revisions.
--
--   priced_timesheets        one per (timesheet, revision); one currency;
--                            frozen totals; applied policy versions
--   priced_timesheet_lines   one per worked entry of the approval snapshot:
--                            raw and priced minutes, regular/overtime split per
--                            side, applied rate version + applied pay/bill rate
--                            (FK-bound to that version's exact terms), applied
--                            rounding/overtime terms, amounts in minor units
--   pricing_blocks           operational queue: the latest blocked attempt per
--                            (timesheet, revision) with issue codes. Not money.
--
--   No invoice, payroll, payment or ledger concept exists. Pricing marks
--   nothing as paid or billed.
--
-- Verified by: supabase/tests/security/220_pricing.test.sql
-- =============================================================================

create table public.priced_timesheets (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  timesheet_id uuid not null,
  timesheet_revision integer not null,
  approval_id uuid not null,
  agency_worker_id uuid not null,
  profile_id uuid not null,
  period_start date not null,
  period_end date not null,
  currency text not null references public.currencies (code) on delete restrict,
  line_count integer not null check (line_count >= 1),
  total_raw_minutes integer not null check (total_raw_minutes >= 0),
  total_priced_minutes integer not null check (total_priced_minutes >= 0),
  total_pay_overtime_minutes integer not null check (total_pay_overtime_minutes >= 0),
  total_bill_overtime_minutes integer not null check (total_bill_overtime_minutes >= 0),
  total_pay_minor bigint not null check (total_pay_minor >= 0),
  total_bill_minor bigint not null check (total_bill_minor >= 0),
  pay_overtime_policy_version_id uuid,
  bill_overtime_policy_version_id uuid,
  -- Constant sides, so each policy FK also proves the policy's side.
  pay_side public.pricing_side generated always as ('pay'::public.pricing_side) stored,
  bill_side public.pricing_side generated always as ('bill'::public.pricing_side) stored,
  calculation_version smallint not null check (calculation_version >= 1),
  priced_by_membership_id uuid not null,
  priced_at timestamptz not null default now(),
  foreign key (timesheet_id, agency_organisation_id, agency_worker_id, profile_id)
    references public.timesheets (id, agency_organisation_id, agency_worker_id, profile_id) on delete restrict,
  foreign key (approval_id, timesheet_id, timesheet_revision)
    references public.timesheet_approvals (id, timesheet_id, revision) on delete restrict,
  foreign key (pay_overtime_policy_version_id, agency_organisation_id, pay_side)
    references public.overtime_policy_versions (id, agency_organisation_id, side) on delete restrict,
  foreign key (bill_overtime_policy_version_id, agency_organisation_id, bill_side)
    references public.overtime_policy_versions (id, agency_organisation_id, side) on delete restrict,
  foreign key (priced_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  unique (timesheet_id, timesheet_revision),
  unique (id, agency_organisation_id, timesheet_id, timesheet_revision),
  unique (id, currency),
  check (period_end = period_start + 6),
  check (total_priced_minutes >= total_pay_overtime_minutes and total_priced_minutes >= total_bill_overtime_minutes)
);

create index priced_timesheets_agency_idx on public.priced_timesheets (agency_organisation_id, period_start desc, id desc);

create table public.priced_timesheet_lines (
  id uuid primary key default gen_random_uuid(),
  priced_timesheet_id uuid not null,
  agency_organisation_id uuid not null,
  timesheet_id uuid not null,
  timesheet_revision integer not null,
  entry_id uuid not null,
  assignment_id uuid not null,
  shift_id uuid not null,
  agency_worker_id uuid not null,
  profile_id uuid not null,
  relationship_id uuid not null,
  agency_facility_id uuid not null,
  discipline_key text not null,
  classification public.shift_classification not null,
  local_date date not null,
  line_number smallint not null check (line_number >= 1),
  raw_minutes integer not null check (raw_minutes > 0),
  priced_minutes integer not null check (priced_minutes >= 0),
  pay_regular_minutes integer not null check (pay_regular_minutes >= 0),
  pay_overtime_minutes integer not null check (pay_overtime_minutes >= 0),
  bill_regular_minutes integer not null check (bill_regular_minutes >= 0),
  bill_overtime_minutes integer not null check (bill_overtime_minutes >= 0),
  rate_card_id uuid not null,
  rate_version_id uuid not null,
  rate_precedence smallint not null check (rate_precedence between 1 and 4),
  currency text not null,
  pay_rate_minor bigint not null,
  bill_rate_minor bigint not null,
  rounding_policy_version_id uuid,
  rounding_mode public.rounding_mode not null,
  rounding_increment_minutes smallint,
  pay_overtime_numerator integer,
  pay_overtime_denominator integer,
  bill_overtime_numerator integer,
  bill_overtime_denominator integer,
  pay_amount_minor bigint not null check (pay_amount_minor >= 0),
  bill_amount_minor bigint not null check (bill_amount_minor >= 0),
  calculation_version smallint not null,
  foreign key (priced_timesheet_id, agency_organisation_id, timesheet_id, timesheet_revision)
    references public.priced_timesheets (id, agency_organisation_id, timesheet_id, timesheet_revision) on delete restrict,
  foreign key (priced_timesheet_id, currency)
    references public.priced_timesheets (id, currency) on delete restrict,
  foreign key (entry_id, timesheet_id, assignment_id, shift_id, agency_worker_id, profile_id, relationship_id,
               agency_facility_id)
    references public.timesheet_entries (id, timesheet_id, assignment_id, shift_id, agency_worker_id, profile_id,
                                         relationship_id, agency_facility_id) on delete restrict,
  foreign key (shift_id, agency_organisation_id, discipline_key, classification)
    references public.shifts (id, agency_organisation_id, discipline_key, classification) on delete restrict,
  foreign key (relationship_id, agency_organisation_id, agency_facility_id)
    references public.agency_facility_relationships (id, agency_organisation_id, agency_facility_id) on delete restrict,
  foreign key (rate_card_id, agency_organisation_id, discipline_key)
    references public.rate_cards (id, agency_organisation_id, discipline_key) on delete restrict,
  foreign key (rate_version_id, rate_card_id, agency_organisation_id)
    references public.rate_card_versions (id, rate_card_id, agency_organisation_id) on delete restrict,
  foreign key (rate_version_id, currency, pay_rate_minor, bill_rate_minor)
    references public.rate_card_versions (id, currency, pay_rate_minor, bill_rate_minor) on delete restrict,
  foreign key (rounding_policy_version_id, agency_organisation_id)
    references public.rounding_policy_versions (id, agency_organisation_id) on delete restrict,
  unique (priced_timesheet_id, entry_id),
  unique (priced_timesheet_id, line_number),
  check (pay_regular_minutes + pay_overtime_minutes = priced_minutes),
  check (bill_regular_minutes + bill_overtime_minutes = priced_minutes),
  check ((rounding_mode = 'none') = (rounding_increment_minutes is null)),
  check ((pay_overtime_numerator is null) = (pay_overtime_denominator is null)),
  check ((bill_overtime_numerator is null) = (bill_overtime_denominator is null)),
  check (pay_overtime_numerator is not null or pay_overtime_minutes = 0),
  check (bill_overtime_numerator is not null or bill_overtime_minutes = 0)
);

-- The applied rate card's scope must cover the line (relationship and
-- classification: equal, or the card applies to all).
create function internal.validate_priced_line_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c public.rate_cards;
begin
  select * into c from public.rate_cards r where r.id = new.rate_card_id;
  if (c.relationship_id is not null and c.relationship_id <> new.relationship_id)
     or (c.classification is not null and c.classification <> new.classification) then
    raise exception 'the applied rate card does not cover this work' using errcode = 'CH409';
  end if;
  return new;
end;
$$;

create trigger priced_timesheet_lines_scope
  before insert on public.priced_timesheet_lines
  for each row execute function internal.validate_priced_line_scope();

-- Historical pricing is immutable.
create trigger priced_timesheets_immutable
  before update or delete on public.priced_timesheets
  for each row execute function internal.refuse_update_delete();
create trigger priced_timesheets_no_truncate
  before truncate on public.priced_timesheets
  for each statement execute function internal.refuse_update_delete();
create trigger priced_timesheet_lines_immutable
  before update or delete on public.priced_timesheet_lines
  for each row execute function internal.refuse_update_delete();
create trigger priced_timesheet_lines_no_truncate
  before truncate on public.priced_timesheet_lines
  for each statement execute function internal.refuse_update_delete();

alter table public.priced_timesheets enable row level security;
grant select on public.priced_timesheets to authenticated;
create policy priced_timesheets_select on public.priced_timesheets
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'pricing.view'));

alter table public.priced_timesheet_lines enable row level security;
grant select on public.priced_timesheet_lines to authenticated;
create policy priced_timesheet_lines_select on public.priced_timesheet_lines
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'pricing.view'));

-- -----------------------------------------------------------------------------
-- Blocked pricing queue (operational, not financial)
-- -----------------------------------------------------------------------------
create table public.pricing_blocks (
  timesheet_id uuid not null,
  timesheet_revision integer not null,
  agency_organisation_id uuid not null,
  issues jsonb not null check (jsonb_typeof(issues) = 'array' and pg_column_size(issues) <= 65536),
  attempts integer not null default 1 check (attempts >= 1),
  first_blocked_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (timesheet_id, timesheet_revision),
  foreign key (timesheet_id, agency_organisation_id)
    references public.timesheets (id, agency_organisation_id) on delete restrict
);

create index pricing_blocks_agency_open_idx
  on public.pricing_blocks (agency_organisation_id, last_attempt_at desc) where resolved_at is null;

create trigger pricing_blocks_no_delete
  before delete on public.pricing_blocks
  for each row execute function internal.refuse_update_delete();

alter table public.pricing_blocks enable row level security;
grant select on public.pricing_blocks to authenticated;
create policy pricing_blocks_select on public.pricing_blocks
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'pricing.view'));

revoke all on function internal.validate_priced_line_scope() from public, anon, authenticated;
