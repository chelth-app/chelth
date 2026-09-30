-- =============================================================================
-- Migration: agency_workers
-- Stage:     P0-E3-S3
--
-- Purpose
--   Healthcare worker records as an AGENCY-SPECIFIC layer over a person:
--
--     profile (human identity, shared)
--       └─ organisation_membership (per agency)
--             └─ agency_workers (per agency: status, reference, dates)
--
--   One person can be a worker with any number of agencies, each with its own
--   status and data. Nothing about the person is duplicated here.
--
--   Structural tenant safety: (membership_id, agency_organisation_id,
--   profile_id) is a composite FK to the membership, and the organisation is
--   bound to type 'agency'. A worker record cannot point at another agency's
--   membership or another person, even if RLS or application code fails.
--
--   Creation: a worker record is created automatically when a membership is
--   granted the agency.healthcare_worker role (invitation acceptance or role
--   assignment) — see internal.ensure_worker_record. There is no separate
--   "create worker" write path to drift from membership.
--
--   agency_workers contains ONLY worker-visible columns. Agency-internal data
--   lives in separate tables (agency_worker_notes) with separate capabilities.
--
--   Lifecycle (worker_status):
--     onboarding  record exists; not yet available for work
--     active      available for work
--     inactive    temporarily unavailable (not disciplinary)
--     suspended   agency-imposed hold (compliance/conduct); not available
--     terminated  engagement ended — terminal; re-engagement creates a NEW
--                 record (history preserved)
--
-- Verified by: supabase/tests/security/070_workforce.test.sql
-- =============================================================================

create type public.worker_status as enum ('onboarding', 'active', 'inactive', 'suspended', 'terminated');

-- Generic guards reused by domain tables ------------------------------------
create function internal.enforce_immutable_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_column text;
begin
  foreach v_column in array tg_argv loop
    if (to_jsonb(new) -> v_column) is distinct from (to_jsonb(old) -> v_column) then
      raise exception '% is immutable', v_column using errcode = 'CH409';
    end if;
  end loop;
  return new;
end;
$$;

create function internal.refuse_update_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are append-only', tg_table_name using errcode = 'CH409';
end;
$$;

-- -----------------------------------------------------------------------------
create table public.agency_workers (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  agency_organisation_type public.organisation_type not null default 'agency'
    check (agency_organisation_type = 'agency'),
  membership_id uuid not null,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  status public.worker_status not null default 'onboarding',
  worker_reference text
    check (
      worker_reference is null
      or (char_length(btrim(worker_reference)) between 1 and 50 and worker_reference !~ '[[:cntrl:]]')
    ),
  start_date date,
  end_date date,
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_organisation_id, agency_organisation_type)
    references public.organisations (id, type) on delete restrict,
  foreign key (membership_id, agency_organisation_id, profile_id)
    references public.organisation_memberships (id, organisation_id, profile_id) on delete restrict,
  -- Target for future composite FKs (credentials, assignments, timesheets).
  unique (id, agency_organisation_id),
  check (end_date is null or start_date is null or end_date >= start_date),
  check (status <> 'terminated' or end_date is not null)
);

comment on table public.agency_workers is
  'Per-agency worker record for a person. Worker-visible columns only; internal data lives elsewhere.';

-- One current (non-terminated) record per membership; terminated history is kept.
create unique index agency_workers_one_current_per_membership
  on public.agency_workers (membership_id) where status <> 'terminated';
create unique index agency_workers_reference_per_agency
  on public.agency_workers (agency_organisation_id, lower(worker_reference))
  where worker_reference is not null;
create index agency_workers_agency_idx on public.agency_workers (agency_organisation_id, status);
create index agency_workers_profile_idx on public.agency_workers (profile_id);

create trigger agency_workers_set_updated_at
  before update on public.agency_workers
  for each row execute function internal.set_updated_at();

create trigger agency_workers_ownership_immutable
  before update on public.agency_workers
  for each row execute function internal.enforce_immutable_columns(
    'agency_organisation_id', 'agency_organisation_type', 'membership_id', 'profile_id');

alter table public.agency_workers enable row level security;
grant select on public.agency_workers to authenticated;

-- -----------------------------------------------------------------------------
-- Internal notes: agency-only, append-only, separate capability.
-- -----------------------------------------------------------------------------
create table public.agency_worker_notes (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  worker_id uuid not null,
  author_profile_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (worker_id, agency_organisation_id)
    references public.agency_workers (id, agency_organisation_id) on delete restrict
);

comment on table public.agency_worker_notes is
  'Internal agency notes about a worker. Never visible to the worker. No clinical or credential data.';

create index agency_worker_notes_worker_idx on public.agency_worker_notes (worker_id, created_at desc);

create trigger agency_worker_notes_append_only
  before update or delete on public.agency_worker_notes
  for each row execute function internal.refuse_update_delete();

alter table public.agency_worker_notes enable row level security;
grant select on public.agency_worker_notes to authenticated;

-- -----------------------------------------------------------------------------
-- Worker record follows the healthcare-worker role grant.
-- -----------------------------------------------------------------------------
create function internal.ensure_worker_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_worker_id uuid;
begin
  select m.profile_id into v_profile_id
  from public.organisation_memberships m
  where m.id = new.membership_id;

  insert into public.agency_workers (agency_organisation_id, membership_id, profile_id)
  values (new.organisation_id, new.membership_id, v_profile_id)
  on conflict (membership_id) where status <> 'terminated' do nothing
  returning id into v_worker_id;

  if v_worker_id is not null then
    perform internal.record_audit_event('worker.created', new.organisation_id, 'worker', v_worker_id,
      jsonb_build_object('membership_id', new.membership_id, 'via', 'role_grant'));
  end if;

  return new;
end;
$$;

create trigger membership_roles_ensure_worker_record
  after insert on public.membership_roles
  for each row
  when (new.role_key = 'agency.healthcare_worker')
  execute function internal.ensure_worker_record();

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
-- The membership belongs to the caller AND is live (active membership, active
-- profile, non-archived organisation). Used for self-access to domain rows.
create function authz.is_own_active_membership(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organisation_memberships m
    join public.profiles p on p.id = m.profile_id and p.status = 'active'
    join public.organisations o on o.id = m.organisation_id and o.status <> 'archived'
    where m.id = p_membership_id
      and m.profile_id = auth.uid()
      and m.status = 'active'
  )
$$;

-- Profile visibility gains one path: worker.view holders see the names of
-- that agency's workers (schedulers/credentialing officers lack membership.view).
create or replace function authz.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id = auth.uid()
    or exists (
      select 1
      from public.organisation_memberships target
      where target.profile_id = p_profile_id
        and authz.has_capability(target.organisation_id, 'membership.view')
    )
    or exists (
      select 1
      from public.agency_workers w
      where w.profile_id = p_profile_id
        and authz.has_capability(w.agency_organisation_id, 'worker.view')
    )
$$;

revoke all on function authz.is_own_active_membership(uuid) from public, anon;
grant execute on function authz.is_own_active_membership(uuid) to authenticated;
revoke all on function
  internal.enforce_immutable_columns(),
  internal.refuse_update_delete(),
  internal.ensure_worker_record()
from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
-- Agency staff with worker.view see their agency's workers; a worker sees only
-- their own record, and only while their membership is live.
create policy agency_workers_select on public.agency_workers
  for select to authenticated
  using (
    authz.has_capability(agency_organisation_id, 'worker.view')
    or authz.is_own_active_membership(membership_id)
  );

-- Notes: worker.notes.view, and never notes about oneself.
create policy agency_worker_notes_select on public.agency_worker_notes
  for select to authenticated
  using (
    authz.has_capability(agency_organisation_id, 'worker.notes.view')
    and not exists (
      select 1 from public.agency_workers w
      where w.id = worker_id and w.profile_id = (select auth.uid())
    )
  );
