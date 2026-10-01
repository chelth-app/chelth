-- =============================================================================
-- Migration: rate_tables
-- Stage:     P0-E7-S1
--
-- Purpose
--   The pricing configuration, separate from every operational table.
--
--   rate_cards                one pricing SCOPE: agency + (relationship | all
--                             facilities) + discipline + (classification | any).
--                             Unique per scope; never updated or deleted.
--   rate_card_versions        effective-dated HOURLY pay and bill rates in integer
--                             minor units with one currency. draft → active
--                             (terms frozen) | discarded. A later activation may
--                             only set `superseded_from` on an earlier version;
--                             an exclusion constraint forbids overlapping active
--                             periods for one card.
--   rounding_policy_versions  agency-wide per-entry rounding (none | nearest N min)
--   overtime_policy_versions  agency-wide weekly threshold × multiplier, separately
--                             for pay and bill. Disabled unless configured.
--
--   Money: integer minor units (bigint), never floating point. Zero or negative
--   rates are rejected (a legitimate zero-rate case needs a future rule type).
--
-- Verified by: supabase/tests/security/210_rates.test.sql
-- =============================================================================

create table public.rate_cards (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  agency_organisation_type public.organisation_type not null default 'agency'
    check (agency_organisation_type = 'agency'),
  relationship_id uuid,
  discipline_key text not null references public.disciplines (key) on delete restrict,
  classification public.shift_classification,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (agency_organisation_id, agency_organisation_type)
    references public.organisations (id, type) on delete restrict,
  foreign key (relationship_id, agency_organisation_id)
    references public.agency_facility_relationships (id, agency_organisation_id) on delete restrict,
  foreign key (created_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  constraint rate_cards_one_per_scope
    unique nulls not distinct (agency_organisation_id, relationship_id, discipline_key, classification),
  unique (id, agency_organisation_id),
  unique (id, agency_organisation_id, discipline_key)
);

create trigger rate_cards_immutable
  before update or delete on public.rate_cards
  for each row execute function internal.refuse_update_delete();
create trigger rate_cards_no_truncate
  before truncate on public.rate_cards
  for each statement execute function internal.refuse_update_delete();

alter table public.rate_cards enable row level security;
grant select on public.rate_cards to authenticated;
create policy rate_cards_select on public.rate_cards
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'rates.view'));

-- -----------------------------------------------------------------------------
-- Versions
-- -----------------------------------------------------------------------------
create table public.rate_card_versions (
  id uuid primary key default gen_random_uuid(),
  rate_card_id uuid not null,
  agency_organisation_id uuid not null,
  version integer not null check (version between 1 and 10000),
  status public.rate_version_status not null default 'draft',
  currency text not null references public.currencies (code) on delete restrict,
  pay_rate_minor bigint not null check (pay_rate_minor between 1 and 100000000),
  bill_rate_minor bigint not null check (bill_rate_minor between 1 and 100000000),
  effective_from date not null,
  effective_to date,
  superseded_from date,
  effective_period daterange generated always as (
    daterange(effective_from,
              least(coalesce(effective_to + 1, 'infinity'::date), coalesce(superseded_from, 'infinity'::date)),
              '[)')
  ) stored,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  activated_by_membership_id uuid,
  activated_at timestamptz,
  discarded_at timestamptz,
  foreign key (rate_card_id, agency_organisation_id)
    references public.rate_cards (id, agency_organisation_id) on delete restrict,
  foreign key (created_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  foreign key (activated_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  unique (rate_card_id, version),
  unique (id, rate_card_id, agency_organisation_id),
  -- Priced lines reference the exact applied terms: they cannot disagree with the version.
  unique (id, currency, pay_rate_minor, bill_rate_minor),
  check (effective_to is null or effective_to >= effective_from),
  check (superseded_from is null or (superseded_from > effective_from
                                     and (effective_to is null or superseded_from <= effective_to))),
  check ((status = 'active') = (activated_at is not null and activated_by_membership_id is not null)),
  check ((status = 'discarded') = (discarded_at is not null)),
  check (status = 'active' or superseded_from is null),
  constraint rate_card_versions_no_overlap
    exclude using gist (rate_card_id with =, effective_period with &&) where (status = 'active')
);

create index rate_card_versions_card_idx on public.rate_card_versions (rate_card_id, effective_from desc);

-- Drafts may be edited; active terms are frozen (only `superseded_from` may be
-- set, once); discarded versions are frozen. Nothing is ever deleted.
create function internal.enforce_rate_version_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.rate_card_id, new.agency_organisation_id, new.version, new.created_by_membership_id, new.created_at)
     is distinct from
     (old.id, old.rate_card_id, old.agency_organisation_id, old.version, old.created_by_membership_id, old.created_at) then
    raise exception 'rate version identity is immutable' using errcode = 'CH409';
  end if;
  if old.status = 'draft' then
    if new.status = 'draft' and (new.activated_at, new.discarded_at, new.superseded_from) is not distinct from (null, null, null) then
      return new;
    end if;
    if new.status in ('active', 'discarded') and new.superseded_from is null then
      return new;
    end if;
  elsif old.status = 'active' then
    if old.superseded_from is null and new.superseded_from is not null
       and (to_jsonb(new) - array['superseded_from', 'effective_period'])
           = (to_jsonb(old) - array['superseded_from', 'effective_period']) then
      return new;
    end if;
  end if;
  raise exception 'active rate versions are immutable; create a new version' using errcode = 'CH409';
end;
$$;

create trigger rate_card_versions_transition
  before update on public.rate_card_versions
  for each row execute function internal.enforce_rate_version_transition();
create trigger rate_card_versions_no_delete
  before delete on public.rate_card_versions
  for each row execute function internal.refuse_update_delete();
create trigger rate_card_versions_no_truncate
  before truncate on public.rate_card_versions
  for each statement execute function internal.refuse_update_delete();

alter table public.rate_card_versions enable row level security;
grant select on public.rate_card_versions to authenticated;
create policy rate_card_versions_select on public.rate_card_versions
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'rates.view'));

-- -----------------------------------------------------------------------------
-- Rounding policy (agency-wide, per timesheet entry)
-- -----------------------------------------------------------------------------
create table public.rounding_policy_versions (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  agency_organisation_type public.organisation_type not null default 'agency'
    check (agency_organisation_type = 'agency'),
  version integer not null check (version between 1 and 10000),
  status public.rate_version_status not null default 'draft',
  mode public.rounding_mode not null,
  increment_minutes smallint check (increment_minutes in (5, 6, 10, 15)),
  effective_from date not null,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  activated_by_membership_id uuid,
  activated_at timestamptz,
  discarded_at timestamptz,
  foreign key (agency_organisation_id, agency_organisation_type)
    references public.organisations (id, type) on delete restrict,
  foreign key (created_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  foreign key (activated_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  unique (agency_organisation_id, version),
  unique (id, agency_organisation_id),
  check ((mode = 'none') = (increment_minutes is null)),
  check ((status = 'active') = (activated_at is not null and activated_by_membership_id is not null)),
  check ((status = 'discarded') = (discarded_at is not null))
);

create unique index rounding_policy_versions_one_active_per_start
  on public.rounding_policy_versions (agency_organisation_id, effective_from) where status = 'active';

-- -----------------------------------------------------------------------------
-- Overtime policy (agency-wide weekly threshold × multiplier; pay and bill separately)
-- -----------------------------------------------------------------------------
create table public.overtime_policy_versions (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  agency_organisation_type public.organisation_type not null default 'agency'
    check (agency_organisation_type = 'agency'),
  side public.pricing_side not null,
  version integer not null check (version between 1 and 10000),
  status public.rate_version_status not null default 'draft',
  mode public.overtime_mode not null,
  weekly_threshold_minutes integer check (weekly_threshold_minutes between 60 and 10080),
  multiplier_numerator integer check (multiplier_numerator between 1 and 1000),
  multiplier_denominator integer check (multiplier_denominator between 1 and 100),
  effective_from date not null,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  activated_by_membership_id uuid,
  activated_at timestamptz,
  discarded_at timestamptz,
  foreign key (agency_organisation_id, agency_organisation_type)
    references public.organisations (id, type) on delete restrict,
  foreign key (created_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  foreign key (activated_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  unique (agency_organisation_id, side, version),
  unique (id, agency_organisation_id, side),
  check ((mode = 'none') = (weekly_threshold_minutes is null and multiplier_numerator is null
                            and multiplier_denominator is null)),
  check (mode = 'none' or multiplier_numerator >= multiplier_denominator),
  check ((status = 'active') = (activated_at is not null and activated_by_membership_id is not null)),
  check ((status = 'discarded') = (discarded_at is not null))
);

create unique index overtime_policy_versions_one_active_per_start
  on public.overtime_policy_versions (agency_organisation_id, side, effective_from) where status = 'active';

-- Policies: drafts editable, active and discarded frozen, never deleted.
create function internal.enforce_policy_version_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'draft'
     and (to_jsonb(new) ->> 'agency_organisation_id', to_jsonb(new) ->> 'version', to_jsonb(new) ->> 'created_at')
         is not distinct from
         (to_jsonb(old) ->> 'agency_organisation_id', to_jsonb(old) ->> 'version', to_jsonb(old) ->> 'created_at') then
    return new;
  end if;
  raise exception 'active or discarded policy versions are immutable' using errcode = 'CH409';
end;
$$;

create trigger rounding_policy_versions_transition
  before update on public.rounding_policy_versions
  for each row execute function internal.enforce_policy_version_transition();
create trigger rounding_policy_versions_no_delete
  before delete on public.rounding_policy_versions
  for each row execute function internal.refuse_update_delete();
create trigger rounding_policy_versions_no_truncate
  before truncate on public.rounding_policy_versions
  for each statement execute function internal.refuse_update_delete();
create trigger overtime_policy_versions_transition
  before update on public.overtime_policy_versions
  for each row execute function internal.enforce_policy_version_transition();
create trigger overtime_policy_versions_no_delete
  before delete on public.overtime_policy_versions
  for each row execute function internal.refuse_update_delete();
create trigger overtime_policy_versions_no_truncate
  before truncate on public.overtime_policy_versions
  for each statement execute function internal.refuse_update_delete();

alter table public.rounding_policy_versions enable row level security;
grant select on public.rounding_policy_versions to authenticated;
create policy rounding_policy_versions_select on public.rounding_policy_versions
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'rates.view'));

alter table public.overtime_policy_versions enable row level security;
grant select on public.overtime_policy_versions to authenticated;
create policy overtime_policy_versions_select on public.overtime_policy_versions
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'rates.view'));

revoke all on function
  internal.enforce_rate_version_transition(),
  internal.enforce_policy_version_transition()
from public, anon, authenticated;
