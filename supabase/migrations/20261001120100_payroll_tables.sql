-- =============================================================================
-- Migration: payroll_tables
-- Stage:     P0-E7-S2
--
-- Purpose
--   Payroll PREPARATION from immutable pricing snapshots. Not payroll execution.
--
--   payroll_periods        agency calendar periods (weekly | biweekly, DATES);
--                          never overlap within an agency (exclusion constraint)
--   payroll_batches        agency + period + currency; lifecycle
--                          draft → reviewed → approved → locked → exported,
--                          or cancelled before lock. Never "paid".
--   payroll_batch_lines    one per included pay-side priced line. Every copied
--                          value (minutes, rate, amount, revision, calculation
--                          version, currency, work date …) is bound by a
--                          composite FK to the immutable priced line, so a line
--                          can never carry a value its source does not have.
--                          Append-only.
--   payroll_line_claims    the structural duplicate guard: primary key on the
--                          priced line ⇒ a pay-side line sits in at most ONE
--                          non-cancelled batch. Cancelling a batch (only
--                          possible before lock) deletes its claims.
--   payroll_batch_history  append-only lifecycle history.
--
-- Verified by: supabase/tests/security/240_payroll_invoices.test.sql
-- =============================================================================

-- Composite keys on the immutable sources (supersets of their primary keys).
alter table public.priced_timesheet_lines
  add constraint priced_timesheet_lines_payroll_source_key unique (
    id, priced_timesheet_id, agency_organisation_id, timesheet_id, timesheet_revision, entry_id,
    agency_worker_id, profile_id, agency_facility_id, relationship_id, discipline_key, local_date, currency,
    pay_regular_minutes, pay_overtime_minutes, pay_rate_minor, pay_amount_minor, calculation_version);

alter table public.agency_workers
  add constraint agency_workers_financial_key unique (id, agency_organisation_id, profile_id);

-- -----------------------------------------------------------------------------
-- Periods
-- -----------------------------------------------------------------------------
create table public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null references public.organisations (id) on delete restrict,
  period_type public.payroll_period_type not null,
  period_start date not null,
  period_end date not null,
  created_at timestamptz not null default now(),
  unique (agency_organisation_id, period_start, period_end),
  unique (id, agency_organisation_id, period_start, period_end),
  check (period_end = period_start + case period_type when 'weekly' then 6 else 13 end),
  constraint payroll_periods_no_overlap exclude using gist (
    agency_organisation_id with =, daterange(period_start, period_end, '[]') with &&)
);

create trigger payroll_periods_immutable
  before update or delete on public.payroll_periods
  for each row execute function internal.refuse_update_delete();
create trigger payroll_periods_no_truncate
  before truncate on public.payroll_periods
  for each statement execute function internal.refuse_update_delete();

-- -----------------------------------------------------------------------------
-- Batches
-- -----------------------------------------------------------------------------
create table public.payroll_batches (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  payroll_period_id uuid not null,
  period_start date not null,
  period_end date not null,
  currency text not null references public.currencies (code) on delete restrict,
  reference text not null check (reference ~ '^[A-Z][A-Z0-9-]{0,19}-[0-9]{4}-[0-9]{6}$'),
  status public.payroll_batch_status not null default 'draft',
  line_count integer not null check (line_count >= 1),
  worker_count integer not null check (worker_count >= 1 and worker_count <= line_count),
  total_regular_minutes bigint not null check (total_regular_minutes >= 0),
  total_overtime_minutes bigint not null check (total_overtime_minutes >= 0),
  total_pay_minor bigint not null check (total_pay_minor >= 0),
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
  foreign key (payroll_period_id, agency_organisation_id, period_start, period_end)
    references public.payroll_periods (id, agency_organisation_id, period_start, period_end) on delete restrict,
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
  unique (id, agency_organisation_id, period_start, period_end, currency),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check ((status = 'cancelled') = (cancel_reason is not null)),
  check (status not in ('approved', 'locked', 'exported') or approved_at is not null),
  check (status not in ('locked', 'exported') or locked_at is not null),
  check (status <> 'exported' or exported_at is not null)
);

comment on table public.payroll_batches is
  'Payroll PREPARATION batches. Approval and lock freeze them; nothing here pays anyone.';

create index payroll_batches_agency_idx on public.payroll_batches (agency_organisation_id, period_start desc, id desc);

-- Lifecycle + immutability. Totals, period, currency and lines never change;
-- lifecycle stamps are written once.
create function internal.protect_payroll_batch()
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
    raise exception 'payroll batches are never deleted' using errcode = 'CHY03';
  end if;
  if (to_jsonb(new) - v_stamps) is distinct from (to_jsonb(old) - v_stamps) then
    raise exception 'payroll batch contents are immutable' using errcode = 'CHY03';
  end if;
  foreach v_key in array v_stamps[3:] loop
    if to_jsonb(old) ->> v_key is not null and (to_jsonb(new) -> v_key) is distinct from (to_jsonb(old) -> v_key) then
      raise exception 'payroll batch history is immutable' using errcode = 'CHY03';
    end if;
  end loop;
  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status in ('reviewed', 'cancelled'))
    or (old.status = 'reviewed' and new.status in ('draft', 'approved', 'cancelled'))
    or (old.status = 'approved' and new.status in ('locked', 'cancelled'))
    or (old.status = 'locked' and new.status = 'exported')
  ) then
    raise exception 'invalid payroll batch transition' using errcode = 'CHY04';
  end if;
  if new.status = old.status and old.status in ('locked', 'exported', 'cancelled')
     and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'a locked payroll batch is immutable' using errcode = 'CHY03';
  end if;
  new.status_changed_at := case when new.status is distinct from old.status then now() else old.status_changed_at end;
  return new;
end;
$$;

create trigger payroll_batches_protect
  before update or delete on public.payroll_batches
  for each row execute function internal.protect_payroll_batch();
create trigger payroll_batches_no_truncate
  before truncate on public.payroll_batches
  for each statement execute function internal.refuse_update_delete();

-- -----------------------------------------------------------------------------
-- Lines (append-only; every copied value FK-bound to the priced line)
-- -----------------------------------------------------------------------------
create table public.payroll_batch_lines (
  id uuid primary key default gen_random_uuid(),
  payroll_batch_id uuid not null,
  agency_organisation_id uuid not null,
  period_start date not null,
  period_end date not null,
  currency text not null,
  line_number integer not null check (line_number >= 1),
  priced_line_id uuid not null,
  priced_timesheet_id uuid not null,
  timesheet_id uuid not null,
  timesheet_revision integer not null,
  entry_id uuid not null,
  agency_worker_id uuid not null,
  profile_id uuid not null,
  agency_facility_id uuid not null,
  relationship_id uuid not null,
  discipline_key text not null,
  work_date date not null,
  regular_minutes integer not null check (regular_minutes >= 0),
  overtime_minutes integer not null check (overtime_minutes >= 0),
  pay_rate_minor bigint not null,
  pay_amount_minor bigint not null check (pay_amount_minor >= 0),
  calculation_version smallint not null,
  -- Display snapshots at preparation time (names change; history must not).
  worker_reference text,
  worker_name text not null,
  facility_name text not null,
  discipline_name text not null,
  foreign key (payroll_batch_id, agency_organisation_id, period_start, period_end, currency)
    references public.payroll_batches (id, agency_organisation_id, period_start, period_end, currency)
    on delete restrict,
  foreign key (priced_line_id, priced_timesheet_id, agency_organisation_id, timesheet_id, timesheet_revision, entry_id,
               agency_worker_id, profile_id, agency_facility_id, relationship_id, discipline_key, work_date, currency,
               regular_minutes, overtime_minutes, pay_rate_minor, pay_amount_minor, calculation_version)
    references public.priced_timesheet_lines (id, priced_timesheet_id, agency_organisation_id, timesheet_id,
               timesheet_revision, entry_id, agency_worker_id, profile_id, agency_facility_id, relationship_id,
               discipline_key, local_date, currency, pay_regular_minutes, pay_overtime_minutes, pay_rate_minor,
               pay_amount_minor, calculation_version) on delete restrict,
  foreign key (agency_worker_id, agency_organisation_id, profile_id)
    references public.agency_workers (id, agency_organisation_id, profile_id) on delete restrict,
  unique (payroll_batch_id, line_number),
  unique (payroll_batch_id, priced_line_id),
  unique (id, payroll_batch_id, agency_organisation_id, priced_line_id, timesheet_id, timesheet_revision),
  check (work_date between period_start and period_end)
);

create index payroll_batch_lines_batch_idx on public.payroll_batch_lines (payroll_batch_id, line_number);
create index payroll_batch_lines_timesheet_idx on public.payroll_batch_lines (timesheet_id);

create trigger payroll_batch_lines_immutable
  before update or delete on public.payroll_batch_lines
  for each row execute function internal.refuse_update_delete();
create trigger payroll_batch_lines_no_truncate
  before truncate on public.payroll_batch_lines
  for each statement execute function internal.refuse_update_delete();

-- Lines may only be added while the batch is being created (draft, same transaction).
create function internal.guard_payroll_line_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.payroll_batches b
    where b.id = new.payroll_batch_id and b.status = 'draft' and b.created_at = now()
  ) then
    raise exception 'lines can only be added when a batch is prepared' using errcode = 'CHY03';
  end if;
  return new;
end;
$$;

create trigger payroll_batch_lines_guard
  before insert on public.payroll_batch_lines
  for each row execute function internal.guard_payroll_line_insert();

-- Totals are exactly the sum of the lines (checked at commit).
create function internal.verify_payroll_batch_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  b public.payroll_batches;
begin
  select * into b from public.payroll_batches x where x.id = new.id;
  if not exists (
    select 1 from public.payroll_batch_lines l
    where l.payroll_batch_id = b.id
    having count(*) = b.line_count
       and count(distinct l.agency_worker_id) = b.worker_count
       and sum(l.regular_minutes) = b.total_regular_minutes
       and sum(l.overtime_minutes) = b.total_overtime_minutes
       and sum(l.pay_amount_minor) = b.total_pay_minor
  ) then
    raise exception 'payroll batch totals do not equal its lines' using errcode = 'CHY03';
  end if;
  return null;
end;
$$;

create constraint trigger payroll_batches_totals
  after insert on public.payroll_batches
  deferrable initially deferred
  for each row execute function internal.verify_payroll_batch_totals();

-- -----------------------------------------------------------------------------
-- Claims: the one-batch-per-pay-line guard
-- -----------------------------------------------------------------------------
create table public.payroll_line_claims (
  priced_line_id uuid primary key,
  payroll_batch_id uuid not null,
  payroll_batch_line_id uuid not null,
  agency_organisation_id uuid not null,
  timesheet_id uuid not null,
  timesheet_revision integer not null,
  claimed_at timestamptz not null default now(),
  foreign key (payroll_batch_line_id, payroll_batch_id, agency_organisation_id, priced_line_id, timesheet_id,
               timesheet_revision)
    references public.payroll_batch_lines (id, payroll_batch_id, agency_organisation_id, priced_line_id, timesheet_id,
                                           timesheet_revision) on delete restrict
);

create index payroll_line_claims_timesheet_idx on public.payroll_line_claims (timesheet_id, timesheet_revision);
create index payroll_line_claims_batch_idx on public.payroll_line_claims (payroll_batch_id);

-- Claims are taken only when a batch is prepared and released only by
-- cancelling the batch (never after lock).
create function internal.protect_payroll_claim()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.payroll_batches b
      where b.id = new.payroll_batch_id and b.status = 'draft' and b.created_at = now()
    ) then
      raise exception 'lines can only be claimed when a batch is prepared' using errcode = 'CHY03';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'payroll claims are immutable' using errcode = 'CHY03';
  end if;
  if not exists (select 1 from public.payroll_batches b where b.id = old.payroll_batch_id and b.status = 'cancelled') then
    raise exception 'only a cancelled batch releases its lines' using errcode = 'CHY03';
  end if;
  return old;
end;
$$;

create trigger payroll_line_claims_protect
  before insert or update or delete on public.payroll_line_claims
  for each row execute function internal.protect_payroll_claim();
create trigger payroll_line_claims_no_truncate
  before truncate on public.payroll_line_claims
  for each statement execute function internal.refuse_update_delete();

-- -----------------------------------------------------------------------------
-- History (append-only)
-- -----------------------------------------------------------------------------
create table public.payroll_batch_history (
  id uuid primary key default gen_random_uuid(),
  payroll_batch_id uuid not null,
  agency_organisation_id uuid not null,
  action text not null check (action in ('created', 'reviewed', 'returned_to_draft', 'approved', 'locked',
                                         'exported', 'cancelled')),
  from_status public.payroll_batch_status,
  to_status public.payroll_batch_status not null,
  actor_membership_id uuid not null,
  note text check (note is null or char_length(note) <= 500),
  occurred_at timestamptz not null default now(),
  foreign key (payroll_batch_id, agency_organisation_id)
    references public.payroll_batches (id, agency_organisation_id) on delete restrict,
  foreign key (actor_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict
);

create index payroll_batch_history_batch_idx on public.payroll_batch_history (payroll_batch_id, occurred_at);

create trigger payroll_batch_history_immutable
  before update or delete on public.payroll_batch_history
  for each row execute function internal.refuse_update_delete();
create trigger payroll_batch_history_no_truncate
  before truncate on public.payroll_batch_history
  for each statement execute function internal.refuse_update_delete();

-- -----------------------------------------------------------------------------
-- RLS: agency members holding payroll.view only. No worker, facility or
-- platform-admin path. No direct writes (SELECT grant only).
-- -----------------------------------------------------------------------------
alter table public.payroll_periods enable row level security;
alter table public.payroll_batches enable row level security;
alter table public.payroll_batch_lines enable row level security;
alter table public.payroll_line_claims enable row level security;
alter table public.payroll_batch_history enable row level security;

grant select on public.payroll_periods, public.payroll_batches, public.payroll_batch_lines,
  public.payroll_line_claims, public.payroll_batch_history to authenticated;

create policy payroll_periods_select on public.payroll_periods for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'payroll.view'));
create policy payroll_batches_select on public.payroll_batches for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'payroll.view'));
create policy payroll_batch_lines_select on public.payroll_batch_lines for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'payroll.view'));
create policy payroll_line_claims_select on public.payroll_line_claims for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'payroll.view'));
create policy payroll_batch_history_select on public.payroll_batch_history for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'payroll.view'));

revoke all on function
  internal.protect_payroll_batch(),
  internal.guard_payroll_line_insert(),
  internal.verify_payroll_batch_totals(),
  internal.protect_payroll_claim()
from public, anon, authenticated, service_role;
