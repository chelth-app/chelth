-- =============================================================================
-- Migration: person_credentials
-- Stage:     P0-E4-S1
--
-- Purpose
--   Person-owned credentials and explicit agency sharing:
--
--     profiles
--       └─ credentials               "this person holds credential type X" (+ jurisdiction)
--             ├─ credential_identifiers   the credential number (restricted table)
--             ├─ credential_versions      immutable evidence periods (issue/expiry dates);
--             │                           a renewal is a NEW version — history is never overwritten
--             └─ credential_shares        explicit share of the credential with one agency,
--                                         bound to the person's membership there
--
--   Credentials are never duplicated per agency. An agency sees a credential
--   only through an ACTIVE share whose membership is ACTIVE, and only with a
--   capability: credential.view for metadata, credential.review (AAL2) for
--   numbers and documents.
--
--   Evidence lifecycle (this migration) is separate from agency verification
--   (next migrations): credentials are active|withdrawn; versions are
--   draft|submitted|withdrawn. "Expired" is never stored — it is derived.
--
--   agency_worker_disciplines: the minimal classification requirements use.
--
-- Verified by: supabase/tests/security/090_credentials.test.sql
-- =============================================================================

create type public.credential_status as enum ('active', 'withdrawn');
create type public.credential_version_status as enum ('draft', 'submitted', 'withdrawn');
create type public.credential_share_status as enum ('active', 'revoked');

-- -----------------------------------------------------------------------------
-- Worker disciplines (agency-assigned classification)
-- -----------------------------------------------------------------------------
create table public.agency_worker_disciplines (
  agency_organisation_id uuid not null,
  agency_worker_id uuid not null,
  discipline_key text not null references public.disciplines (key) on delete restrict,
  assigned_by_profile_id uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (agency_worker_id, discipline_key),
  foreign key (agency_worker_id, agency_organisation_id)
    references public.agency_workers (id, agency_organisation_id) on delete restrict
);

alter table public.agency_worker_disciplines enable row level security;
grant select on public.agency_worker_disciplines to authenticated;

create policy agency_worker_disciplines_select on public.agency_worker_disciplines
  for select to authenticated
  using (
    authz.has_capability(agency_organisation_id, 'worker.view')
    or authz.has_capability(agency_organisation_id, 'compliance.view')
    or exists (
      select 1 from public.agency_workers w
      where w.id = agency_worker_id and authz.is_own_active_membership(w.membership_id)
    )
  );

-- -----------------------------------------------------------------------------
-- Credentials (person-owned assertion)
-- -----------------------------------------------------------------------------
create table public.credentials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete restrict,
  credential_type_key text not null references public.credential_types (key) on delete restrict,
  jurisdiction_code text references public.jurisdictions (code) on delete restrict,
  issuing_authority text
    check (issuing_authority is null or (char_length(btrim(issuing_authority)) between 1 and 200
           and issuing_authority !~ '[[:cntrl:]]')),
  status public.credential_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, profile_id)
);

comment on table public.credentials is
  'Person-owned credential assertion. Dates live on immutable versions; numbers in credential_identifiers.';

create index credentials_profile_idx on public.credentials (profile_id, credential_type_key);

create trigger credentials_set_updated_at
  before update on public.credentials
  for each row execute function internal.set_updated_at();
-- The assertion itself never changes; to correct it, withdraw and add a new one.
create trigger credentials_core_immutable
  before update on public.credentials
  for each row execute function internal.enforce_immutable_columns(
    'id', 'profile_id', 'credential_type_key', 'jurisdiction_code', 'issuing_authority', 'created_at');

create function internal.credential_status_forward_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'withdrawn' and new.status is distinct from old.status then
    raise exception 'withdrawn credentials cannot be reactivated' using errcode = 'CH409';
  end if;
  return new;
end;
$$;

create trigger credentials_status_forward_only
  before update on public.credentials
  for each row execute function internal.credential_status_forward_only();

-- Numbers: separate table so general credential visibility never exposes them.
create table public.credential_identifiers (
  credential_id uuid primary key,
  profile_id uuid not null,
  credential_number text not null
    check (char_length(btrim(credential_number)) between 1 and 100 and credential_number !~ '[[:cntrl:]]'),
  created_at timestamptz not null default now(),
  foreign key (credential_id, profile_id) references public.credentials (id, profile_id) on delete restrict
);

create trigger credential_identifiers_immutable
  before update or delete on public.credential_identifiers
  for each row execute function internal.refuse_update_delete();

-- -----------------------------------------------------------------------------
-- Versions (evidence periods)
-- -----------------------------------------------------------------------------
create table public.credential_versions (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null,
  profile_id uuid not null,
  version_number integer not null check (version_number >= 1),
  issue_date date,
  expiry_date date,
  status public.credential_version_status not null default 'draft',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (credential_id, profile_id) references public.credentials (id, profile_id) on delete restrict,
  unique (credential_id, version_number),
  unique (id, credential_id, profile_id),
  check (expiry_date is null or issue_date is null or expiry_date >= issue_date),
  check ((status = 'submitted') = (submitted_at is not null) or status = 'withdrawn')
);

comment on table public.credential_versions is
  'Immutable evidence periods. Drafts may only be submitted or withdrawn; submitted versions never change.';

create unique index credential_versions_one_draft
  on public.credential_versions (credential_id) where status = 'draft';

create trigger credential_versions_set_updated_at
  before update on public.credential_versions
  for each row execute function internal.set_updated_at();

-- Version numbers are sequential per credential (1, 2, 3 …) and assigned by the DB.
create function internal.assign_credential_version_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.credentials c where c.id = new.credential_id for update;
  select coalesce(max(v.version_number), 0) + 1 into new.version_number
  from public.credential_versions v
  where v.credential_id = new.credential_id;
  return new;
end;
$$;

create trigger credential_versions_number
  before insert on public.credential_versions
  for each row execute function internal.assign_credential_version_number();

-- History protection: only draft → submitted|withdrawn; everything else frozen.
create function internal.protect_credential_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'credential versions are never deleted' using errcode = 'CH409';
  end if;
  if old.status <> 'draft' then
    raise exception 'submitted or withdrawn versions are immutable' using errcode = 'CH409';
  end if;
  if new.status = 'draft'
     or new.id is distinct from old.id
     or new.credential_id is distinct from old.credential_id
     or new.profile_id is distinct from old.profile_id
     or new.version_number is distinct from old.version_number
     or new.issue_date is distinct from old.issue_date
     or new.expiry_date is distinct from old.expiry_date
     or new.created_at is distinct from old.created_at then
    raise exception 'draft versions may only be submitted or withdrawn' using errcode = 'CH409';
  end if;
  return new;
end;
$$;

create trigger credential_versions_protect_history
  before update or delete on public.credential_versions
  for each row execute function internal.protect_credential_version();

-- -----------------------------------------------------------------------------
-- Shares (credential → agency, via the person's membership there)
-- -----------------------------------------------------------------------------
create table public.credential_shares (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null,
  profile_id uuid not null,
  agency_organisation_id uuid not null,
  agency_organisation_type public.organisation_type not null default 'agency'
    check (agency_organisation_type = 'agency'),
  membership_id uuid not null,
  status public.credential_share_status not null default 'active',
  shared_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (credential_id, profile_id) references public.credentials (id, profile_id) on delete restrict,
  -- The share binds the SAME person's membership in the SAME agency.
  foreign key (membership_id, agency_organisation_id, profile_id)
    references public.organisation_memberships (id, organisation_id, profile_id) on delete restrict,
  foreign key (agency_organisation_id, agency_organisation_type)
    references public.organisations (id, type) on delete restrict,
  check ((status = 'revoked') = (revoked_at is not null))
);

create unique index credential_shares_one_active
  on public.credential_shares (credential_id, agency_organisation_id) where status = 'active';
create index credential_shares_agency_idx on public.credential_shares (agency_organisation_id, status);

create function internal.protect_credential_share()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'credential shares are never deleted; revoke instead' using errcode = 'CH409';
  end if;
  if old.status = 'revoked'
     or new.status <> 'revoked'
     or new.id is distinct from old.id
     or new.credential_id is distinct from old.credential_id
     or new.profile_id is distinct from old.profile_id
     or new.agency_organisation_id is distinct from old.agency_organisation_id
     or new.membership_id is distinct from old.membership_id
     or new.shared_at is distinct from old.shared_at then
    raise exception 'credential shares may only be revoked' using errcode = 'CH409';
  end if;
  return new;
end;
$$;

create trigger credential_shares_protect_history
  before update or delete on public.credential_shares
  for each row execute function internal.protect_credential_share();

-- -----------------------------------------------------------------------------
-- Visibility helper (used by RLS, Storage policies and RPCs — one source)
-- -----------------------------------------------------------------------------
-- True when the credential is ACTIVELY shared with an agency in which the
-- person's membership is ACTIVE and the caller holds p_capability.
create function authz.can_access_shared_credential(p_credential_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.credential_shares s
    join public.organisation_memberships m
      on m.id = s.membership_id and m.status = 'active'
    where s.credential_id = p_credential_id
      and s.status = 'active'
      and authz.has_capability(s.agency_organisation_id, p_capability)
  )
$$;

revoke all on function authz.can_access_shared_credential(uuid, text) from public, anon;
grant execute on function authz.can_access_shared_credential(uuid, text) to authenticated;
revoke all on function
  internal.credential_status_forward_only(),
  internal.assign_credential_version_number(),
  internal.protect_credential_version(),
  internal.protect_credential_share()
from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.credentials enable row level security;
alter table public.credential_identifiers enable row level security;
alter table public.credential_versions enable row level security;
alter table public.credential_shares enable row level security;
grant select on public.credentials, public.credential_identifiers, public.credential_versions,
  public.credential_shares to authenticated;

create policy credentials_select on public.credentials
  for select to authenticated
  using (profile_id = (select auth.uid()) or authz.can_access_shared_credential(id, 'credential.view'));

-- Numbers: owner, or reviewers (credential.review is AAL2).
create policy credential_identifiers_select on public.credential_identifiers
  for select to authenticated
  using (profile_id = (select auth.uid()) or authz.can_access_shared_credential(credential_id, 'credential.review'));

create policy credential_versions_select on public.credential_versions
  for select to authenticated
  using (profile_id = (select auth.uid()) or authz.can_access_shared_credential(credential_id, 'credential.view'));

-- Shares: the owner sees all of theirs; an agency sees only shares made to it.
create policy credential_shares_select on public.credential_shares
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or authz.has_capability(agency_organisation_id, 'credential.view')
  );
