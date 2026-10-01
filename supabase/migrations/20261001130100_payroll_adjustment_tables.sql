-- =============================================================================
-- Migration: payroll_adjustment_tables
-- Stage:     P0-E7-S3
--
-- Purpose
--   A payroll adjustment is a separate, delta-only preparation document for
--   ONE timesheet revision transition (from_revision → to_revision) after the
--   earlier revision was accounted in a LOCKED/EXPORTED batch or adjustment.
--   It is not a payment.
--
--   payroll_adjustments        header: timesheet, worker, revision transition,
--                              both priced revisions (composite FKs prove the
--                              same timesheet + currency), the ROOT original
--                              batch, the previous adjustment in the chain
--                              (FK proves previous.to_revision = from_revision),
--                              signed totals, lifecycle.
--   payroll_adjustment_lines   changed entries only. Old and new sides are each
--                              composite-FK-bound to the pay-side source key of
--                              an immutable priced line (or entirely NULL when
--                              the entry is absent on that side); deltas are
--                              checked = new − old. Append-only.
--   payroll_adjustment_claims  PK (timesheet, from_revision): one active/final
--                              adjustment per transition; released only by
--                              cancelling before lock.
--   payroll_adjustment_history append-only lifecycle history.
--
--   Totals: total_increase_minor (≥ 0) + total_decrease_minor (≥ 0, magnitude)
--   and the signed net_delta_minor = increase − decrease; lines carry signed
--   deltas. Verified at commit against the lines.
--
-- Verified by: supabase/tests/security/250_financial_adjustments.test.sql
-- =============================================================================

create table public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  reference text not null check (reference ~ '^[A-Z][A-Z0-9-]{0,19}-[0-9]{4}-[0-9]{6}$'),
  status public.payroll_batch_status not null default 'draft',
  timesheet_id uuid not null,
  agency_worker_id uuid not null,
  profile_id uuid not null,
  period_start date not null,
  period_end date not null,
  from_revision integer not null,
  to_revision integer not null,
  from_priced_timesheet_id uuid not null,
  to_priced_timesheet_id uuid not null,
  original_payroll_batch_id uuid not null,
  previous_adjustment_id uuid,
  currency text not null references public.currencies (code) on delete restrict,
  line_count integer not null check (line_count >= 1),
  delta_regular_minutes integer not null,
  delta_overtime_minutes integer not null,
  total_increase_minor bigint not null check (total_increase_minor >= 0),
  total_decrease_minor bigint not null check (total_decrease_minor >= 0),
  net_delta_minor bigint not null,
  worker_reference text,
  worker_name text not null,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  reviewed_by_membership_id uuid,
  reviewed_at timestamptz,
  approved_by_membership_id uuid,
  approved_at timestamptz,
  locked_by_membership_id uuid,
  locked_at timestamptz,
  exported_at timestamptz,
  cancelled_by_membership_id uuid,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) between 1 and 500),
  status_changed_at timestamptz not null default now(),
  foreign key (timesheet_id, agency_organisation_id, agency_worker_id, profile_id)
    references public.timesheets (id, agency_organisation_id, agency_worker_id, profile_id) on delete restrict,
  -- Both priced revisions belong to this timesheet, in this currency.
  foreign key (from_priced_timesheet_id, agency_organisation_id, timesheet_id, from_revision)
    references public.priced_timesheets (id, agency_organisation_id, timesheet_id, timesheet_revision) on delete restrict,
  foreign key (to_priced_timesheet_id, agency_organisation_id, timesheet_id, to_revision)
    references public.priced_timesheets (id, agency_organisation_id, timesheet_id, timesheet_revision) on delete restrict,
  foreign key (from_priced_timesheet_id, currency) references public.priced_timesheets (id, currency) on delete restrict,
  foreign key (to_priced_timesheet_id, currency) references public.priced_timesheets (id, currency) on delete restrict,
  foreign key (to_priced_timesheet_id, agency_organisation_id, period_start, period_end, currency)
    references public.priced_timesheets (id, agency_organisation_id, period_start, period_end, currency) on delete restrict,
  -- The original batch is this agency's, in this currency.
  foreign key (original_payroll_batch_id, agency_organisation_id, currency)
    references public.payroll_batches (id, agency_organisation_id, currency) on delete restrict,
  foreign key (created_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  foreign key (reviewed_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  foreign key (approved_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  foreign key (locked_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  foreign key (cancelled_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  unique (agency_organisation_id, reference),
  unique (id, agency_organisation_id),
  unique (id, agency_organisation_id, timesheet_id, from_revision),
  unique (id, agency_organisation_id, timesheet_id, to_revision, original_payroll_batch_id),
  unique (id, agency_organisation_id, timesheet_id, from_revision, to_revision, currency),
  unique (id, agency_organisation_id, period_start, period_end, currency),
  check (to_revision > from_revision),
  check (net_delta_minor = total_increase_minor - total_decrease_minor),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check ((status = 'cancelled') = (cancel_reason is not null)),
  check (status not in ('approved', 'locked', 'exported') or approved_at is not null),
  check (status not in ('locked', 'exported') or locked_at is not null),
  check (status <> 'exported' or exported_at is not null)
);

-- The chain: the previous adjustment ended exactly where this one starts.
alter table public.payroll_adjustments
  add constraint payroll_adjustments_previous_fkey
  foreign key (previous_adjustment_id, agency_organisation_id, timesheet_id, from_revision, original_payroll_batch_id)
  references public.payroll_adjustments (id, agency_organisation_id, timesheet_id, to_revision, original_payroll_batch_id)
  on delete restrict;

comment on table public.payroll_adjustments is
  'Delta-only payroll preparation adjustments for post-lock revisions. Not payments.';

create index payroll_adjustments_agency_idx on public.payroll_adjustments (agency_organisation_id, created_at desc);
create index payroll_adjustments_timesheet_idx on public.payroll_adjustments (timesheet_id, to_revision desc);

create function internal.protect_payroll_adjustment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_stamps text[] := array['status', 'status_changed_at', 'reviewed_by_membership_id', 'reviewed_at',
                           'approved_by_membership_id', 'approved_at', 'locked_by_membership_id', 'locked_at',
                           'exported_at', 'cancelled_by_membership_id', 'cancelled_at', 'cancel_reason'];
  v_key text;
begin
  if tg_op = 'DELETE' then
    raise exception 'payroll adjustments are never deleted' using errcode = 'CHY03';
  end if;
  if (to_jsonb(new) - v_stamps) is distinct from (to_jsonb(old) - v_stamps) then
    raise exception 'payroll adjustment contents are immutable' using errcode = 'CHY03';
  end if;
  foreach v_key in array v_stamps[3:] loop
    if to_jsonb(old) ->> v_key is not null and (to_jsonb(new) -> v_key) is distinct from (to_jsonb(old) -> v_key) then
      raise exception 'payroll adjustment history is immutable' using errcode = 'CHY03';
    end if;
  end loop;
  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status in ('reviewed', 'cancelled'))
    or (old.status = 'reviewed' and new.status in ('approved', 'cancelled'))
    or (old.status = 'approved' and new.status in ('locked', 'cancelled'))
    or (old.status = 'locked' and new.status = 'exported')
  ) then
    raise exception 'invalid payroll adjustment transition' using errcode = 'CHY04';
  end if;
  if new.status = old.status and old.status in ('locked', 'exported', 'cancelled')
     and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'a locked payroll adjustment is immutable' using errcode = 'CHY03';
  end if;
  new.status_changed_at := case when new.status is distinct from old.status then now() else old.status_changed_at end;
  return new;
end;
$$;

create trigger payroll_adjustments_protect
  before update or delete on public.payroll_adjustments
  for each row execute function internal.protect_payroll_adjustment();
create trigger payroll_adjustments_no_truncate
  before truncate on public.payroll_adjustments
  for each statement execute function internal.refuse_update_delete();

-- -----------------------------------------------------------------------------
-- Delta lines (changed entries only)
-- -----------------------------------------------------------------------------
create table public.payroll_adjustment_lines (
  id uuid primary key default gen_random_uuid(),
  payroll_adjustment_id uuid not null,
  agency_organisation_id uuid not null,
  timesheet_id uuid not null,
  from_revision integer not null,
  to_revision integer not null,
  currency text not null,
  line_number integer not null check (line_number >= 1),
  entry_id uuid not null,
  agency_worker_id uuid not null,
  profile_id uuid not null,
  agency_facility_id uuid not null,
  relationship_id uuid not null,
  discipline_key text not null,
  work_date date not null,
  old_priced_line_id uuid,
  old_priced_timesheet_id uuid,
  old_regular_minutes integer,
  old_overtime_minutes integer,
  old_pay_rate_minor bigint,
  old_pay_amount_minor bigint,
  old_calculation_version smallint,
  new_priced_line_id uuid,
  new_priced_timesheet_id uuid,
  new_regular_minutes integer,
  new_overtime_minutes integer,
  new_pay_rate_minor bigint,
  new_pay_amount_minor bigint,
  new_calculation_version smallint,
  delta_regular_minutes integer not null,
  delta_overtime_minutes integer not null,
  delta_pay_amount_minor bigint not null,
  worker_reference text,
  worker_name text not null,
  facility_name text not null,
  discipline_name text not null,
  foreign key (payroll_adjustment_id, agency_organisation_id, timesheet_id, from_revision, to_revision, currency)
    references public.payroll_adjustments (id, agency_organisation_id, timesheet_id, from_revision, to_revision, currency)
    on delete restrict,
  -- Old side: exactly a pay-side priced line of the FROM revision.
  foreign key (old_priced_line_id, old_priced_timesheet_id, agency_organisation_id, timesheet_id, from_revision, entry_id,
               agency_worker_id, profile_id, agency_facility_id, relationship_id, discipline_key, work_date, currency,
               old_regular_minutes, old_overtime_minutes, old_pay_rate_minor, old_pay_amount_minor, old_calculation_version)
    references public.priced_timesheet_lines (id, priced_timesheet_id, agency_organisation_id, timesheet_id,
               timesheet_revision, entry_id, agency_worker_id, profile_id, agency_facility_id, relationship_id,
               discipline_key, local_date, currency, pay_regular_minutes, pay_overtime_minutes, pay_rate_minor,
               pay_amount_minor, calculation_version) on delete restrict,
  -- New side: exactly a pay-side priced line of the TO revision.
  foreign key (new_priced_line_id, new_priced_timesheet_id, agency_organisation_id, timesheet_id, to_revision, entry_id,
               agency_worker_id, profile_id, agency_facility_id, relationship_id, discipline_key, work_date, currency,
               new_regular_minutes, new_overtime_minutes, new_pay_rate_minor, new_pay_amount_minor, new_calculation_version)
    references public.priced_timesheet_lines (id, priced_timesheet_id, agency_organisation_id, timesheet_id,
               timesheet_revision, entry_id, agency_worker_id, profile_id, agency_facility_id, relationship_id,
               discipline_key, local_date, currency, pay_regular_minutes, pay_overtime_minutes, pay_rate_minor,
               pay_amount_minor, calculation_version) on delete restrict,
  unique (payroll_adjustment_id, line_number),
  unique (payroll_adjustment_id, entry_id),
  -- A side is either wholly present or wholly absent (so the FK above always applies when present).
  check (num_nulls(old_priced_line_id, old_priced_timesheet_id, old_regular_minutes, old_overtime_minutes,
                   old_pay_rate_minor, old_pay_amount_minor, old_calculation_version) in (0, 7)),
  check (num_nulls(new_priced_line_id, new_priced_timesheet_id, new_regular_minutes, new_overtime_minutes,
                   new_pay_rate_minor, new_pay_amount_minor, new_calculation_version) in (0, 7)),
  check (old_priced_line_id is not null or new_priced_line_id is not null),
  check (delta_pay_amount_minor = coalesce(new_pay_amount_minor, 0) - coalesce(old_pay_amount_minor, 0)),
  check (delta_regular_minutes = coalesce(new_regular_minutes, 0) - coalesce(old_regular_minutes, 0)),
  check (delta_overtime_minutes = coalesce(new_overtime_minutes, 0) - coalesce(old_overtime_minutes, 0))
);

create index payroll_adjustment_lines_adjustment_idx on public.payroll_adjustment_lines (payroll_adjustment_id, line_number);

create trigger payroll_adjustment_lines_immutable
  before update or delete on public.payroll_adjustment_lines
  for each row execute function internal.refuse_update_delete();
create trigger payroll_adjustment_lines_no_truncate
  before truncate on public.payroll_adjustment_lines
  for each statement execute function internal.refuse_update_delete();

create function internal.guard_payroll_adjustment_child()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.payroll_adjustments a
      where a.id = new.payroll_adjustment_id and a.status = 'draft' and a.created_at = now()
    ) then
      raise exception 'adjustment lines and claims are added only when it is prepared' using errcode = 'CHY03';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'payroll adjustment claims are immutable' using errcode = 'CHY03';
  end if;
  if not exists (select 1 from public.payroll_adjustments a where a.id = old.payroll_adjustment_id and a.status = 'cancelled') then
    raise exception 'only a cancelled adjustment releases its transition' using errcode = 'CHY03';
  end if;
  return old;
end;
$$;

create trigger payroll_adjustment_lines_guard
  before insert on public.payroll_adjustment_lines
  for each row execute function internal.guard_payroll_adjustment_child();

create function internal.verify_payroll_adjustment_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  a public.payroll_adjustments;
begin
  select * into a from public.payroll_adjustments x where x.id = new.id;
  if not exists (
    select 1 from public.payroll_adjustment_lines l
    where l.payroll_adjustment_id = a.id
    having count(*) = a.line_count
       and sum(l.delta_regular_minutes) = a.delta_regular_minutes
       and sum(l.delta_overtime_minutes) = a.delta_overtime_minutes
       and coalesce(sum(l.delta_pay_amount_minor) filter (where l.delta_pay_amount_minor > 0), 0) = a.total_increase_minor
       and coalesce(-sum(l.delta_pay_amount_minor) filter (where l.delta_pay_amount_minor < 0), 0) = a.total_decrease_minor
  ) then
    raise exception 'payroll adjustment totals do not equal its lines' using errcode = 'CHY03';
  end if;
  return null;
end;
$$;

create constraint trigger payroll_adjustments_totals
  after insert on public.payroll_adjustments
  deferrable initially deferred
  for each row execute function internal.verify_payroll_adjustment_totals();

-- -----------------------------------------------------------------------------
-- Claims: one active/final adjustment per revision transition
-- -----------------------------------------------------------------------------
create table public.payroll_adjustment_claims (
  timesheet_id uuid not null,
  from_revision integer not null,
  payroll_adjustment_id uuid not null,
  agency_organisation_id uuid not null,
  claimed_at timestamptz not null default now(),
  primary key (timesheet_id, from_revision),
  foreign key (payroll_adjustment_id, agency_organisation_id, timesheet_id, from_revision)
    references public.payroll_adjustments (id, agency_organisation_id, timesheet_id, from_revision) on delete restrict
);

create index payroll_adjustment_claims_adjustment_idx on public.payroll_adjustment_claims (payroll_adjustment_id);

create trigger payroll_adjustment_claims_guard
  before insert or update or delete on public.payroll_adjustment_claims
  for each row execute function internal.guard_payroll_adjustment_child();
create trigger payroll_adjustment_claims_no_truncate
  before truncate on public.payroll_adjustment_claims
  for each statement execute function internal.refuse_update_delete();

-- -----------------------------------------------------------------------------
-- History
-- -----------------------------------------------------------------------------
create table public.payroll_adjustment_history (
  id uuid primary key default gen_random_uuid(),
  payroll_adjustment_id uuid not null,
  agency_organisation_id uuid not null,
  action text not null check (action in ('created', 'reviewed', 'approved', 'locked', 'exported', 'cancelled')),
  from_status public.payroll_batch_status,
  to_status public.payroll_batch_status not null,
  actor_membership_id uuid not null,
  note text check (note is null or char_length(note) <= 500),
  occurred_at timestamptz not null default now(),
  foreign key (payroll_adjustment_id, agency_organisation_id)
    references public.payroll_adjustments (id, agency_organisation_id) on delete restrict,
  foreign key (actor_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict
);

create index payroll_adjustment_history_idx on public.payroll_adjustment_history (payroll_adjustment_id, occurred_at);

create trigger payroll_adjustment_history_immutable
  before update or delete on public.payroll_adjustment_history
  for each row execute function internal.refuse_update_delete();
create trigger payroll_adjustment_history_no_truncate
  before truncate on public.payroll_adjustment_history
  for each statement execute function internal.refuse_update_delete();

-- -----------------------------------------------------------------------------
-- RLS: payroll.view only; no worker, facility or platform-admin path.
-- -----------------------------------------------------------------------------
alter table public.payroll_adjustments enable row level security;
alter table public.payroll_adjustment_lines enable row level security;
alter table public.payroll_adjustment_claims enable row level security;
alter table public.payroll_adjustment_history enable row level security;

grant select on public.payroll_adjustments, public.payroll_adjustment_lines, public.payroll_adjustment_claims,
  public.payroll_adjustment_history to authenticated;

create policy payroll_adjustments_select on public.payroll_adjustments for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'payroll.view'));
create policy payroll_adjustment_lines_select on public.payroll_adjustment_lines for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'payroll.view'));
create policy payroll_adjustment_claims_select on public.payroll_adjustment_claims for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'payroll.view'));
create policy payroll_adjustment_history_select on public.payroll_adjustment_history for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'payroll.view'));

revoke all on function
  internal.protect_payroll_adjustment(),
  internal.guard_payroll_adjustment_child(),
  internal.verify_payroll_adjustment_totals()
from public, anon, authenticated, service_role;
