-- =============================================================================
-- Migration: invoice_adjustment_tables
-- Stage:     P0-E7-S3
--
-- Purpose
--   An invoice adjustment draft is a separate, delta-only BILL-SIDE draft for
--   ONE (timesheet, facility relationship) revision transition after the
--   earlier revision was accounted in a LOCKED/EXPORTED invoice draft or
--   adjustment. It is not a legal invoice or credit note, is never sent and
--   has no tax.
--
--   direction (generated from the signed net): additional_charge | credit |
--   no_net_change (minutes or rates changed but the net is zero).
--
--   No table here has a pay-side or margin column.
--
-- Verified by: supabase/tests/security/250_financial_adjustments.test.sql
-- =============================================================================

create table public.invoice_adjustments (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  reference text not null check (reference ~ '^[A-Z][A-Z0-9-]{0,19}-[0-9]{4}-[0-9]{6}$'),
  status public.invoice_draft_status not null default 'draft',
  timesheet_id uuid not null,
  relationship_id uuid not null,
  agency_facility_id uuid not null,
  period_start date not null,
  period_end date not null,
  from_revision integer not null,
  to_revision integer not null,
  from_priced_timesheet_id uuid not null,
  to_priced_timesheet_id uuid not null,
  original_invoice_draft_id uuid not null,
  previous_adjustment_id uuid,
  currency text not null references public.currencies (code) on delete restrict,
  line_count integer not null check (line_count >= 1),
  delta_priced_minutes integer not null,
  total_increase_minor bigint not null check (total_increase_minor >= 0),
  total_decrease_minor bigint not null check (total_decrease_minor >= 0),
  net_delta_minor bigint not null,
  direction text generated always as (
    case when net_delta_minor > 0 then 'additional_charge'
         when net_delta_minor < 0 then 'credit'
         else 'no_net_change' end) stored,
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
    references public.agency_facility_relationships (id, agency_organisation_id, agency_facility_id) on delete restrict,
  foreign key (from_priced_timesheet_id, agency_organisation_id, timesheet_id, from_revision)
    references public.priced_timesheets (id, agency_organisation_id, timesheet_id, timesheet_revision) on delete restrict,
  foreign key (to_priced_timesheet_id, agency_organisation_id, timesheet_id, to_revision)
    references public.priced_timesheets (id, agency_organisation_id, timesheet_id, timesheet_revision) on delete restrict,
  foreign key (from_priced_timesheet_id, currency) references public.priced_timesheets (id, currency) on delete restrict,
  foreign key (to_priced_timesheet_id, agency_organisation_id, period_start, period_end, currency)
    references public.priced_timesheets (id, agency_organisation_id, period_start, period_end, currency) on delete restrict,
  -- The original draft: same agency, relationship, facility, week and currency.
  foreign key (original_invoice_draft_id, agency_organisation_id, relationship_id, agency_facility_id, period_start,
               period_end, currency)
    references public.invoice_drafts (id, agency_organisation_id, relationship_id, agency_facility_id, period_start,
                                      period_end, currency) on delete restrict,
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
  unique (id, agency_organisation_id, timesheet_id, relationship_id, from_revision),
  unique (id, agency_organisation_id, timesheet_id, relationship_id, to_revision, original_invoice_draft_id),
  unique (id, agency_organisation_id, timesheet_id, relationship_id, agency_facility_id, from_revision, to_revision, currency),
  unique (id, agency_organisation_id, period_start, period_end, currency),
  check (to_revision > from_revision),
  check (net_delta_minor = total_increase_minor - total_decrease_minor),
  check ((status = 'voided') = (voided_at is not null)),
  check ((status = 'voided') = (void_reason is not null)),
  check (status not in ('approved', 'locked', 'exported') or approved_at is not null),
  check (status not in ('locked', 'exported') or locked_at is not null),
  check (status <> 'exported' or exported_at is not null)
);

alter table public.invoice_adjustments
  add constraint invoice_adjustments_previous_fkey
  foreign key (previous_adjustment_id, agency_organisation_id, timesheet_id, relationship_id, from_revision,
               original_invoice_draft_id)
  references public.invoice_adjustments (id, agency_organisation_id, timesheet_id, relationship_id, to_revision,
                                         original_invoice_draft_id) on delete restrict;

comment on table public.invoice_adjustments is
  'Internal bill-side adjustment DRAFTS for post-lock revisions. Not legal invoices or credit notes; never sent; no tax.';

create index invoice_adjustments_agency_idx on public.invoice_adjustments (agency_organisation_id, created_at desc);
create index invoice_adjustments_timesheet_idx on public.invoice_adjustments (timesheet_id, relationship_id, to_revision desc);

create function internal.protect_invoice_adjustment()
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
    raise exception 'invoice adjustments are never deleted' using errcode = 'CHY03';
  end if;
  -- `direction` is generated from net_delta_minor (compared below); it is not
  -- yet computed in NEW during a BEFORE trigger, so it is left out here.
  if (to_jsonb(new) - v_stamps - 'direction') is distinct from (to_jsonb(old) - v_stamps - 'direction') then
    raise exception 'invoice adjustment contents are immutable' using errcode = 'CHY03';
  end if;
  foreach v_key in array v_stamps[3:] loop
    if to_jsonb(old) ->> v_key is not null and (to_jsonb(new) -> v_key) is distinct from (to_jsonb(old) -> v_key) then
      raise exception 'invoice adjustment history is immutable' using errcode = 'CHY03';
    end if;
  end loop;
  -- Unlike original drafts, a locked adjustment cannot be voided: the chain
  -- after it would lose its base. Void before lock only.
  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status in ('reviewed', 'voided'))
    or (old.status = 'reviewed' and new.status in ('approved', 'voided'))
    or (old.status = 'approved' and new.status in ('locked', 'voided'))
    or (old.status = 'locked' and new.status = 'exported')
  ) then
    raise exception 'invalid invoice adjustment transition' using errcode = 'CHY04';
  end if;
  if new.status = old.status and old.status in ('locked', 'exported', 'voided')
     and (to_jsonb(new) - 'direction') is distinct from (to_jsonb(old) - 'direction') then
    raise exception 'a locked invoice adjustment is immutable' using errcode = 'CHY03';
  end if;
  new.status_changed_at := case when new.status is distinct from old.status then now() else old.status_changed_at end;
  return new;
end;
$$;

create trigger invoice_adjustments_protect
  before update or delete on public.invoice_adjustments
  for each row execute function internal.protect_invoice_adjustment();
create trigger invoice_adjustments_no_truncate
  before truncate on public.invoice_adjustments
  for each statement execute function internal.refuse_update_delete();

create table public.invoice_adjustment_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_adjustment_id uuid not null,
  agency_organisation_id uuid not null,
  timesheet_id uuid not null,
  relationship_id uuid not null,
  agency_facility_id uuid not null,
  from_revision integer not null,
  to_revision integer not null,
  currency text not null,
  line_number integer not null check (line_number >= 1),
  entry_id uuid not null,
  agency_worker_id uuid not null,
  profile_id uuid not null,
  discipline_key text not null,
  work_date date not null,
  old_priced_line_id uuid,
  old_priced_timesheet_id uuid,
  old_priced_minutes integer,
  old_bill_regular_minutes integer,
  old_bill_overtime_minutes integer,
  old_bill_rate_minor bigint,
  old_bill_amount_minor bigint,
  old_calculation_version smallint,
  new_priced_line_id uuid,
  new_priced_timesheet_id uuid,
  new_priced_minutes integer,
  new_bill_regular_minutes integer,
  new_bill_overtime_minutes integer,
  new_bill_rate_minor bigint,
  new_bill_amount_minor bigint,
  new_calculation_version smallint,
  delta_priced_minutes integer not null,
  delta_bill_amount_minor bigint not null,
  worker_reference text,
  worker_name text not null,
  discipline_name text not null,
  foreign key (invoice_adjustment_id, agency_organisation_id, timesheet_id, relationship_id, agency_facility_id,
               from_revision, to_revision, currency)
    references public.invoice_adjustments (id, agency_organisation_id, timesheet_id, relationship_id, agency_facility_id,
                                           from_revision, to_revision, currency) on delete restrict,
  foreign key (old_priced_line_id, old_priced_timesheet_id, agency_organisation_id, timesheet_id, from_revision, entry_id,
               agency_worker_id, profile_id, agency_facility_id, relationship_id, discipline_key, work_date, currency,
               old_priced_minutes, old_bill_regular_minutes, old_bill_overtime_minutes, old_bill_rate_minor,
               old_bill_amount_minor, old_calculation_version)
    references public.priced_timesheet_lines (id, priced_timesheet_id, agency_organisation_id, timesheet_id,
               timesheet_revision, entry_id, agency_worker_id, profile_id, agency_facility_id, relationship_id,
               discipline_key, local_date, currency, priced_minutes, bill_regular_minutes, bill_overtime_minutes,
               bill_rate_minor, bill_amount_minor, calculation_version) on delete restrict,
  foreign key (new_priced_line_id, new_priced_timesheet_id, agency_organisation_id, timesheet_id, to_revision, entry_id,
               agency_worker_id, profile_id, agency_facility_id, relationship_id, discipline_key, work_date, currency,
               new_priced_minutes, new_bill_regular_minutes, new_bill_overtime_minutes, new_bill_rate_minor,
               new_bill_amount_minor, new_calculation_version)
    references public.priced_timesheet_lines (id, priced_timesheet_id, agency_organisation_id, timesheet_id,
               timesheet_revision, entry_id, agency_worker_id, profile_id, agency_facility_id, relationship_id,
               discipline_key, local_date, currency, priced_minutes, bill_regular_minutes, bill_overtime_minutes,
               bill_rate_minor, bill_amount_minor, calculation_version) on delete restrict,
  unique (invoice_adjustment_id, line_number),
  unique (invoice_adjustment_id, entry_id),
  check (num_nulls(old_priced_line_id, old_priced_timesheet_id, old_priced_minutes, old_bill_regular_minutes,
                   old_bill_overtime_minutes, old_bill_rate_minor, old_bill_amount_minor, old_calculation_version) in (0, 8)),
  check (num_nulls(new_priced_line_id, new_priced_timesheet_id, new_priced_minutes, new_bill_regular_minutes,
                   new_bill_overtime_minutes, new_bill_rate_minor, new_bill_amount_minor, new_calculation_version) in (0, 8)),
  check (old_priced_line_id is not null or new_priced_line_id is not null),
  check (delta_bill_amount_minor = coalesce(new_bill_amount_minor, 0) - coalesce(old_bill_amount_minor, 0)),
  check (delta_priced_minutes = coalesce(new_priced_minutes, 0) - coalesce(old_priced_minutes, 0))
);

create index invoice_adjustment_lines_adjustment_idx on public.invoice_adjustment_lines (invoice_adjustment_id, line_number);

create trigger invoice_adjustment_lines_immutable
  before update or delete on public.invoice_adjustment_lines
  for each row execute function internal.refuse_update_delete();
create trigger invoice_adjustment_lines_no_truncate
  before truncate on public.invoice_adjustment_lines
  for each statement execute function internal.refuse_update_delete();

create function internal.guard_invoice_adjustment_child()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.invoice_adjustments a
      where a.id = new.invoice_adjustment_id and a.status = 'draft' and a.created_at = now()
    ) then
      raise exception 'adjustment lines and claims are added only when it is prepared' using errcode = 'CHY03';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'invoice adjustment claims are immutable' using errcode = 'CHY03';
  end if;
  if not exists (select 1 from public.invoice_adjustments a where a.id = old.invoice_adjustment_id and a.status = 'voided') then
    raise exception 'only a voided adjustment releases its transition' using errcode = 'CHY03';
  end if;
  return old;
end;
$$;

create trigger invoice_adjustment_lines_guard
  before insert on public.invoice_adjustment_lines
  for each row execute function internal.guard_invoice_adjustment_child();

create function internal.verify_invoice_adjustment_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  a public.invoice_adjustments;
begin
  select * into a from public.invoice_adjustments x where x.id = new.id;
  if not exists (
    select 1 from public.invoice_adjustment_lines l
    where l.invoice_adjustment_id = a.id
    having count(*) = a.line_count
       and sum(l.delta_priced_minutes) = a.delta_priced_minutes
       and coalesce(sum(l.delta_bill_amount_minor) filter (where l.delta_bill_amount_minor > 0), 0) = a.total_increase_minor
       and coalesce(-sum(l.delta_bill_amount_minor) filter (where l.delta_bill_amount_minor < 0), 0) = a.total_decrease_minor
  ) then
    raise exception 'invoice adjustment totals do not equal its lines' using errcode = 'CHY03';
  end if;
  return null;
end;
$$;

create constraint trigger invoice_adjustments_totals
  after insert on public.invoice_adjustments
  deferrable initially deferred
  for each row execute function internal.verify_invoice_adjustment_totals();

create table public.invoice_adjustment_claims (
  timesheet_id uuid not null,
  relationship_id uuid not null,
  from_revision integer not null,
  invoice_adjustment_id uuid not null,
  agency_organisation_id uuid not null,
  claimed_at timestamptz not null default now(),
  primary key (timesheet_id, relationship_id, from_revision),
  foreign key (invoice_adjustment_id, agency_organisation_id, timesheet_id, relationship_id, from_revision)
    references public.invoice_adjustments (id, agency_organisation_id, timesheet_id, relationship_id, from_revision)
    on delete restrict
);

create index invoice_adjustment_claims_adjustment_idx on public.invoice_adjustment_claims (invoice_adjustment_id);

create trigger invoice_adjustment_claims_guard
  before insert or update or delete on public.invoice_adjustment_claims
  for each row execute function internal.guard_invoice_adjustment_child();
create trigger invoice_adjustment_claims_no_truncate
  before truncate on public.invoice_adjustment_claims
  for each statement execute function internal.refuse_update_delete();

create table public.invoice_adjustment_history (
  id uuid primary key default gen_random_uuid(),
  invoice_adjustment_id uuid not null,
  agency_organisation_id uuid not null,
  action text not null check (action in ('created', 'reviewed', 'approved', 'locked', 'exported', 'voided')),
  from_status public.invoice_draft_status,
  to_status public.invoice_draft_status not null,
  actor_membership_id uuid not null,
  note text check (note is null or char_length(note) <= 500),
  occurred_at timestamptz not null default now(),
  foreign key (invoice_adjustment_id, agency_organisation_id)
    references public.invoice_adjustments (id, agency_organisation_id) on delete restrict,
  foreign key (actor_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict
);

create index invoice_adjustment_history_idx on public.invoice_adjustment_history (invoice_adjustment_id, occurred_at);

create trigger invoice_adjustment_history_immutable
  before update or delete on public.invoice_adjustment_history
  for each row execute function internal.refuse_update_delete();
create trigger invoice_adjustment_history_no_truncate
  before truncate on public.invoice_adjustment_history
  for each statement execute function internal.refuse_update_delete();

alter table public.invoice_adjustments enable row level security;
alter table public.invoice_adjustment_lines enable row level security;
alter table public.invoice_adjustment_claims enable row level security;
alter table public.invoice_adjustment_history enable row level security;

grant select on public.invoice_adjustments, public.invoice_adjustment_lines, public.invoice_adjustment_claims,
  public.invoice_adjustment_history to authenticated;

create policy invoice_adjustments_select on public.invoice_adjustments for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'invoice.view'));
create policy invoice_adjustment_lines_select on public.invoice_adjustment_lines for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'invoice.view'));
create policy invoice_adjustment_claims_select on public.invoice_adjustment_claims for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'invoice.view'));
create policy invoice_adjustment_history_select on public.invoice_adjustment_history for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'invoice.view'));

revoke all on function
  internal.protect_invoice_adjustment(),
  internal.guard_invoice_adjustment_child(),
  internal.verify_invoice_adjustment_totals()
from public, anon, authenticated, service_role;
