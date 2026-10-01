-- =============================================================================
-- Migration: invoice_tables
-- Stage:     P0-E7-S2
--
-- Purpose
--   Invoice DRAFTING from immutable bill-side pricing. Not invoicing, sending
--   or collecting payment. No tax.
--
--   invoice_drafts         agency + facility relationship + weekly period
--                          (the priced timesheet week) + currency; lifecycle
--                          draft → reviewed → approved → locked → exported,
--                          voided from any of them. Never sent/paid/overdue.
--   invoice_draft_lines    one per included BILL-side priced line. The table
--                          has no pay-side column at all, so pay and margin
--                          cannot leak into a draft. Every copied value is
--                          FK-bound to the immutable priced line. Append-only.
--   invoice_line_claims    primary key on the priced line ⇒ a bill-side line
--                          sits in at most ONE non-voided draft. Voiding
--                          releases the claims; the voided draft is unchanged.
--   invoice_draft_history  append-only lifecycle history.
--
-- Verified by: supabase/tests/security/240_payroll_invoices.test.sql
-- =============================================================================

alter table public.priced_timesheet_lines
  add constraint priced_timesheet_lines_invoice_source_key unique (
    id, priced_timesheet_id, agency_organisation_id, timesheet_id, timesheet_revision, entry_id,
    agency_worker_id, profile_id, agency_facility_id, relationship_id, discipline_key, local_date, currency,
    priced_minutes, bill_regular_minutes, bill_overtime_minutes, bill_rate_minor, bill_amount_minor,
    calculation_version);

alter table public.priced_timesheets
  add constraint priced_timesheets_period_key unique (id, agency_organisation_id, period_start, period_end, currency);

-- -----------------------------------------------------------------------------
-- Drafts
-- -----------------------------------------------------------------------------
create table public.invoice_drafts (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  relationship_id uuid not null,
  agency_facility_id uuid not null,
  period_start date not null,
  period_end date not null,
  currency text not null references public.currencies (code) on delete restrict,
  reference text not null check (reference ~ '^[A-Z][A-Z0-9-]{0,19}-[0-9]{4}-[0-9]{6}$'),
  status public.invoice_draft_status not null default 'draft',
  line_count integer not null check (line_count >= 1),
  total_priced_minutes bigint not null check (total_priced_minutes >= 0),
  total_bill_minor bigint not null check (total_bill_minor >= 0),
  agency_name text not null,
  facility_name text not null,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  reviewed_by_membership_id uuid,
  reviewed_at timestamptz,
  approved_by_membership_id uuid,
  approved_at timestamptz,
  locked_by_membership_id uuid,
  locked_at timestamptz,
  exported_at timestamptz,
  voided_by_membership_id uuid,
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) between 1 and 500),
  status_changed_at timestamptz not null default now(),
  foreign key (relationship_id, agency_organisation_id, agency_facility_id)
    references public.agency_facility_relationships (id, agency_organisation_id, agency_facility_id)
    on delete restrict,
  foreign key (created_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  foreign key (reviewed_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  foreign key (approved_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  foreign key (locked_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  foreign key (voided_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  unique (agency_organisation_id, reference),
  unique (id, agency_organisation_id),
  unique (id, agency_organisation_id, relationship_id, agency_facility_id, period_start, period_end, currency),
  unique (id, agency_organisation_id, period_start, period_end, currency),
  check (period_end = period_start + 6),
  check ((status = 'voided') = (voided_at is not null)),
  check ((status = 'voided') = (void_reason is not null)),
  check (status not in ('approved', 'locked', 'exported') or approved_at is not null),
  check (status not in ('locked', 'exported') or locked_at is not null),
  check (status <> 'exported' or exported_at is not null)
);

comment on table public.invoice_drafts is
  'Internal invoice DRAFTS (bill side only). Not sent, not a request for payment, no tax.';

create index invoice_drafts_agency_idx on public.invoice_drafts (agency_organisation_id, period_start desc, id desc);

create function internal.protect_invoice_draft()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_stamps text[] := array['status', 'status_changed_at', 'reviewed_by_membership_id', 'reviewed_at',
                           'approved_by_membership_id', 'approved_at', 'locked_by_membership_id', 'locked_at',
                           'exported_at', 'voided_by_membership_id', 'voided_at', 'void_reason'];
  v_key text;
begin
  if tg_op = 'DELETE' then
    raise exception 'invoice drafts are never deleted' using errcode = 'CHY03';
  end if;
  if (to_jsonb(new) - v_stamps) is distinct from (to_jsonb(old) - v_stamps) then
    raise exception 'invoice draft contents are immutable' using errcode = 'CHY03';
  end if;
  foreach v_key in array v_stamps[3:] loop
    if to_jsonb(old) ->> v_key is not null and (to_jsonb(new) -> v_key) is distinct from (to_jsonb(old) -> v_key) then
      raise exception 'invoice draft history is immutable' using errcode = 'CHY03';
    end if;
  end loop;
  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status in ('reviewed', 'voided'))
    or (old.status = 'reviewed' and new.status in ('draft', 'approved', 'voided'))
    or (old.status = 'approved' and new.status in ('locked', 'voided'))
    or (old.status = 'locked' and new.status in ('exported', 'voided'))
    or (old.status = 'exported' and new.status = 'voided')
  ) then
    raise exception 'invalid invoice draft transition' using errcode = 'CHY04';
  end if;
  if new.status = old.status and old.status in ('locked', 'exported', 'voided')
     and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'a locked invoice draft is immutable' using errcode = 'CHY03';
  end if;
  new.status_changed_at := case when new.status is distinct from old.status then now() else old.status_changed_at end;
  return new;
end;
$$;

create trigger invoice_drafts_protect
  before update or delete on public.invoice_drafts
  for each row execute function internal.protect_invoice_draft();
create trigger invoice_drafts_no_truncate
  before truncate on public.invoice_drafts
  for each statement execute function internal.refuse_update_delete();

-- -----------------------------------------------------------------------------
-- Lines (bill side ONLY; append-only; FK-bound to the priced line)
-- -----------------------------------------------------------------------------
create table public.invoice_draft_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_draft_id uuid not null,
  agency_organisation_id uuid not null,
  relationship_id uuid not null,
  agency_facility_id uuid not null,
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
  discipline_key text not null,
  work_date date not null,
  priced_minutes integer not null check (priced_minutes >= 0),
  bill_regular_minutes integer not null check (bill_regular_minutes >= 0),
  bill_overtime_minutes integer not null check (bill_overtime_minutes >= 0),
  bill_rate_minor bigint not null,
  bill_amount_minor bigint not null check (bill_amount_minor >= 0),
  calculation_version smallint not null,
  worker_reference text,
  worker_name text not null,
  discipline_name text not null,
  foreign key (invoice_draft_id, agency_organisation_id, relationship_id, agency_facility_id, period_start, period_end,
               currency)
    references public.invoice_drafts (id, agency_organisation_id, relationship_id, agency_facility_id, period_start,
                                      period_end, currency) on delete restrict,
  foreign key (priced_line_id, priced_timesheet_id, agency_organisation_id, timesheet_id, timesheet_revision, entry_id,
               agency_worker_id, profile_id, agency_facility_id, relationship_id, discipline_key, work_date, currency,
               priced_minutes, bill_regular_minutes, bill_overtime_minutes, bill_rate_minor, bill_amount_minor,
               calculation_version)
    references public.priced_timesheet_lines (id, priced_timesheet_id, agency_organisation_id, timesheet_id,
               timesheet_revision, entry_id, agency_worker_id, profile_id, agency_facility_id, relationship_id,
               discipline_key, local_date, currency, priced_minutes, bill_regular_minutes, bill_overtime_minutes,
               bill_rate_minor, bill_amount_minor, calculation_version) on delete restrict,
  -- The line's priced timesheet week IS the draft's period.
  foreign key (priced_timesheet_id, agency_organisation_id, period_start, period_end, currency)
    references public.priced_timesheets (id, agency_organisation_id, period_start, period_end, currency)
    on delete restrict,
  unique (invoice_draft_id, line_number),
  unique (invoice_draft_id, priced_line_id),
  unique (id, invoice_draft_id, agency_organisation_id, priced_line_id, timesheet_id, timesheet_revision),
  check (work_date between period_start and period_end)
);

create index invoice_draft_lines_draft_idx on public.invoice_draft_lines (invoice_draft_id, line_number);
create index invoice_draft_lines_timesheet_idx on public.invoice_draft_lines (timesheet_id);

create trigger invoice_draft_lines_immutable
  before update or delete on public.invoice_draft_lines
  for each row execute function internal.refuse_update_delete();
create trigger invoice_draft_lines_no_truncate
  before truncate on public.invoice_draft_lines
  for each statement execute function internal.refuse_update_delete();

create function internal.guard_invoice_line_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.invoice_drafts d
    where d.id = new.invoice_draft_id and d.status = 'draft' and d.created_at = now()
  ) then
    raise exception 'lines can only be added when a draft is prepared' using errcode = 'CHY03';
  end if;
  return new;
end;
$$;

create trigger invoice_draft_lines_guard
  before insert on public.invoice_draft_lines
  for each row execute function internal.guard_invoice_line_insert();

create function internal.verify_invoice_draft_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  d public.invoice_drafts;
begin
  select * into d from public.invoice_drafts x where x.id = new.id;
  if not exists (
    select 1 from public.invoice_draft_lines l
    where l.invoice_draft_id = d.id
    having count(*) = d.line_count
       and sum(l.priced_minutes) = d.total_priced_minutes
       and sum(l.bill_amount_minor) = d.total_bill_minor
  ) then
    raise exception 'invoice draft totals do not equal its lines' using errcode = 'CHY03';
  end if;
  return null;
end;
$$;

create constraint trigger invoice_drafts_totals
  after insert on public.invoice_drafts
  deferrable initially deferred
  for each row execute function internal.verify_invoice_draft_totals();

-- -----------------------------------------------------------------------------
-- Claims: the one-draft-per-bill-line guard
-- -----------------------------------------------------------------------------
create table public.invoice_line_claims (
  priced_line_id uuid primary key,
  invoice_draft_id uuid not null,
  invoice_draft_line_id uuid not null,
  agency_organisation_id uuid not null,
  timesheet_id uuid not null,
  timesheet_revision integer not null,
  claimed_at timestamptz not null default now(),
  foreign key (invoice_draft_line_id, invoice_draft_id, agency_organisation_id, priced_line_id, timesheet_id,
               timesheet_revision)
    references public.invoice_draft_lines (id, invoice_draft_id, agency_organisation_id, priced_line_id, timesheet_id,
                                           timesheet_revision) on delete restrict
);

create index invoice_line_claims_timesheet_idx on public.invoice_line_claims (timesheet_id, timesheet_revision);
create index invoice_line_claims_draft_idx on public.invoice_line_claims (invoice_draft_id);

create function internal.protect_invoice_claim()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.invoice_drafts d
      where d.id = new.invoice_draft_id and d.status = 'draft' and d.created_at = now()
    ) then
      raise exception 'lines can only be claimed when a draft is prepared' using errcode = 'CHY03';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'invoice claims are immutable' using errcode = 'CHY03';
  end if;
  if not exists (select 1 from public.invoice_drafts d where d.id = old.invoice_draft_id and d.status = 'voided') then
    raise exception 'only a voided draft releases its lines' using errcode = 'CHY03';
  end if;
  return old;
end;
$$;

create trigger invoice_line_claims_protect
  before insert or update or delete on public.invoice_line_claims
  for each row execute function internal.protect_invoice_claim();
create trigger invoice_line_claims_no_truncate
  before truncate on public.invoice_line_claims
  for each statement execute function internal.refuse_update_delete();

-- -----------------------------------------------------------------------------
-- History (append-only)
-- -----------------------------------------------------------------------------
create table public.invoice_draft_history (
  id uuid primary key default gen_random_uuid(),
  invoice_draft_id uuid not null,
  agency_organisation_id uuid not null,
  action text not null check (action in ('created', 'reviewed', 'returned_to_draft', 'approved', 'locked',
                                         'exported', 'voided')),
  from_status public.invoice_draft_status,
  to_status public.invoice_draft_status not null,
  actor_membership_id uuid not null,
  note text check (note is null or char_length(note) <= 500),
  occurred_at timestamptz not null default now(),
  foreign key (invoice_draft_id, agency_organisation_id)
    references public.invoice_drafts (id, agency_organisation_id) on delete restrict,
  foreign key (actor_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict
);

create index invoice_draft_history_draft_idx on public.invoice_draft_history (invoice_draft_id, occurred_at);

create trigger invoice_draft_history_immutable
  before update or delete on public.invoice_draft_history
  for each row execute function internal.refuse_update_delete();
create trigger invoice_draft_history_no_truncate
  before truncate on public.invoice_draft_history
  for each statement execute function internal.refuse_update_delete();

-- -----------------------------------------------------------------------------
-- RLS: agency members holding invoice.view only. Facilities have NO path to
-- these internal tables.
-- -----------------------------------------------------------------------------
alter table public.invoice_drafts enable row level security;
alter table public.invoice_draft_lines enable row level security;
alter table public.invoice_line_claims enable row level security;
alter table public.invoice_draft_history enable row level security;

grant select on public.invoice_drafts, public.invoice_draft_lines, public.invoice_line_claims,
  public.invoice_draft_history to authenticated;

create policy invoice_drafts_select on public.invoice_drafts for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'invoice.view'));
create policy invoice_draft_lines_select on public.invoice_draft_lines for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'invoice.view'));
create policy invoice_line_claims_select on public.invoice_line_claims for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'invoice.view'));
create policy invoice_draft_history_select on public.invoice_draft_history for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'invoice.view'));

revoke all on function
  internal.protect_invoice_draft(),
  internal.guard_invoice_line_insert(),
  internal.verify_invoice_draft_totals(),
  internal.protect_invoice_claim()
from public, anon, authenticated, service_role;
