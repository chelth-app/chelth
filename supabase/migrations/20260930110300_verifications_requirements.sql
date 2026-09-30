-- =============================================================================
-- Migration: verifications_requirements
-- Stage:     P0-E4-S1
--
-- Purpose
--   credential_verifications   APPEND-ONLY agency verification events, per
--                              credential VERSION and per agency (optionally
--                              scoped to one of the agency's client facilities
--                              for facility-scoped types such as orientation).
--                              Agency A's verification never counts for Agency B;
--                              a renewal (new version) needs a new verification.
--   credential_requirements    agency BASELINE (agency_facility_id NULL) and
--                              FACILITY requirements, optionally per discipline,
--                              with verification, minimum-validity, warning and
--                              jurisdiction rules. Requirements are data, never
--                              UI logic; deactivated, never deleted.
--
--   RPCs: worker self-service (create credential/version, submit, share,
--   revoke share, withdraw), agency verification, requirement management,
--   discipline assignment, and an agency credential overview.
--
-- Verified by: supabase/tests/security/090_*.test.sql, 100_*.test.sql
-- =============================================================================

create type public.verification_outcome as enum ('under_review', 'verified', 'rejected');
create type public.verification_rejection_reason as enum (
  'document_illegible', 'details_mismatch', 'expired', 'wrong_credential_type',
  'not_authentic', 'incomplete', 'other'
);
create type public.requirement_status as enum ('active', 'inactive');

-- -----------------------------------------------------------------------------
-- Verification events
-- -----------------------------------------------------------------------------
create table public.credential_verifications (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null,
  credential_version_id uuid not null,
  profile_id uuid not null,
  agency_organisation_id uuid not null,
  -- Only for facility-scoped credential types; must be this agency's facility.
  agency_facility_id uuid,
  outcome public.verification_outcome not null,
  rejection_reason public.verification_rejection_reason,
  actor_membership_id uuid not null,
  -- Monotonic order of events: timestamps can tie within one transaction.
  sequence bigint generated always as identity,
  created_at timestamptz not null default now(),
  foreign key (credential_version_id, credential_id, profile_id)
    references public.credential_versions (id, credential_id, profile_id) on delete restrict,
  -- The verifying actor is a membership of the SAME agency.
  foreign key (actor_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  foreign key (agency_facility_id, agency_organisation_id)
    references public.agency_facilities (id, agency_organisation_id) on delete restrict,
  check ((outcome = 'rejected') = (rejection_reason is not null))
);

comment on table public.credential_verifications is
  'Append-only agency verification history per credential version. Highest sequence per (version, agency, facility) is current.';

create index credential_verifications_lookup
  on public.credential_verifications (credential_version_id, agency_organisation_id, sequence desc);

create trigger credential_verifications_append_only
  before update or delete on public.credential_verifications
  for each row execute function internal.refuse_update_delete();

alter table public.credential_verifications enable row level security;
grant select on public.credential_verifications to authenticated;

-- The person sees every agency's decision about their credential; an agency
-- sees only its OWN decisions, and only while the credential is shared with it.
create policy credential_verifications_select on public.credential_verifications
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (
      authz.has_capability(agency_organisation_id, 'credential.view')
      and exists (
        select 1 from public.credential_shares s
        join public.organisation_memberships m on m.id = s.membership_id and m.status = 'active'
        where s.credential_id = credential_verifications.credential_id
          and s.agency_organisation_id = credential_verifications.agency_organisation_id
          and s.status = 'active'
      )
    )
  );

-- -----------------------------------------------------------------------------
-- Requirements (agency baseline + facility)
-- -----------------------------------------------------------------------------
create table public.credential_requirements (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  agency_organisation_type public.organisation_type not null default 'agency'
    check (agency_organisation_type = 'agency'),
  -- NULL = agency baseline; otherwise one of this agency's client facilities.
  agency_facility_id uuid,
  -- NULL = applies to every worker; otherwise only workers with this discipline.
  discipline_key text references public.disciplines (key) on delete restrict,
  credential_type_key text not null references public.credential_types (key) on delete restrict,
  must_be_verified boolean not null default true,
  minimum_validity_days integer not null default 0 check (minimum_validity_days between 0 and 730),
  expiry_warning_days integer not null default 30 check (expiry_warning_days between 0 and 365),
  jurisdiction_code text references public.jurisdictions (code) on delete restrict,
  status public.requirement_status not null default 'active',
  effective_from date not null default current_date,
  effective_until date,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (agency_organisation_id, agency_organisation_type)
    references public.organisations (id, type) on delete restrict,
  foreign key (agency_facility_id, agency_organisation_id)
    references public.agency_facilities (id, agency_organisation_id) on delete restrict,
  check (effective_until is null or effective_until >= effective_from)
);

comment on table public.credential_requirements is
  'Agency baseline (facility NULL) and facility credential requirements. Deactivated, never deleted.';

create unique index credential_requirements_one_active
  on public.credential_requirements (
    agency_organisation_id,
    coalesce(agency_facility_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(discipline_key, ''),
    credential_type_key
  ) where status = 'active';

create trigger credential_requirements_set_updated_at
  before update on public.credential_requirements
  for each row execute function internal.set_updated_at();
create trigger credential_requirements_ownership_immutable
  before update on public.credential_requirements
  for each row execute function internal.enforce_immutable_columns(
    'agency_organisation_id', 'agency_organisation_type', 'agency_facility_id', 'discipline_key',
    'credential_type_key', 'created_at');
create trigger credential_requirements_no_delete
  before delete on public.credential_requirements
  for each row execute function internal.refuse_update_delete();

alter table public.credential_requirements enable row level security;
grant select on public.credential_requirements to authenticated;

create policy credential_requirements_select on public.credential_requirements
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'credential.requirements.view'));

-- -----------------------------------------------------------------------------
-- Worker self-service
-- -----------------------------------------------------------------------------
create function internal.require_valid_jurisdiction(p_type_key text, p_jurisdiction_code text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rule public.credential_jurisdiction_rule;
  v_level public.jurisdiction_level;
begin
  select t.jurisdiction_rule into v_rule from public.credential_types t where t.key = p_type_key;
  if v_rule = 'none' then
    if p_jurisdiction_code is not null then
      raise exception 'this credential type has no jurisdiction' using errcode = 'CH400';
    end if;
    return;
  end if;
  select j.level into v_level from public.jurisdictions j where j.code = p_jurisdiction_code and j.is_active;
  if v_level is null or v_level::text <> v_rule::text then
    raise exception 'a % jurisdiction is required for this credential type', v_rule using errcode = 'CH400';
  end if;
end;
$$;

create function internal.require_valid_version_dates(p_type_key text, p_issue_date date, p_expiry_date date)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_type public.credential_types;
begin
  select * into v_type from public.credential_types t where t.key = p_type_key;
  if v_type.requires_issue_date and p_issue_date is null then
    raise exception 'an issue date is required' using errcode = 'CH400';
  end if;
  if v_type.requires_expiry_date and p_expiry_date is null then
    raise exception 'an expiry date is required' using errcode = 'CH400';
  end if;
  if p_issue_date is not null and p_issue_date > current_date then
    raise exception 'the issue date cannot be in the future' using errcode = 'CH400';
  end if;
  if p_expiry_date is not null and p_issue_date is not null and p_expiry_date < p_issue_date then
    raise exception 'the expiry date must follow the issue date' using errcode = 'CH400';
  end if;
end;
$$;

create function public.create_credential(
  p_credential_type_key text,
  p_jurisdiction_code text default null,
  p_issuing_authority text default null,
  p_credential_number text default null,
  p_issue_date date default null,
  p_expiry_date date default null
)
returns table (credential_id uuid, credential_version_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  v_type public.credential_types;
  v_credential_id uuid;
  v_version_id uuid;
begin
  select * into v_type from public.credential_types t where t.key = p_credential_type_key and t.is_active;
  if v_type.key is null then
    raise exception 'unknown credential type' using errcode = 'CH400';
  end if;
  perform internal.require_valid_jurisdiction(p_credential_type_key, nullif(btrim(p_jurisdiction_code), ''));
  if v_type.requires_credential_number and nullif(btrim(p_credential_number), '') is null then
    raise exception 'a credential number is required' using errcode = 'CH400';
  end if;
  perform internal.require_valid_version_dates(p_credential_type_key, p_issue_date, p_expiry_date);
  if not internal.consume_rate_limit('credential.create:' || v_profile_id, 50, interval '1 day') then
    raise exception 'too many credentials created' using errcode = 'CH429';
  end if;

  insert into public.credentials as c (profile_id, credential_type_key, jurisdiction_code, issuing_authority)
  values (v_profile_id, p_credential_type_key, nullif(btrim(p_jurisdiction_code), ''), nullif(btrim(p_issuing_authority), ''))
  returning c.id into v_credential_id;

  if nullif(btrim(p_credential_number), '') is not null then
    insert into public.credential_identifiers (credential_id, profile_id, credential_number)
    values (v_credential_id, v_profile_id, btrim(p_credential_number));
  end if;

  insert into public.credential_versions as v (credential_id, profile_id, issue_date, expiry_date)
  values (v_credential_id, v_profile_id, p_issue_date, p_expiry_date)
  returning v.id into v_version_id;

  -- The number is never placed in audit metadata.
  perform internal.record_audit_event('credential.created', null, 'credential', v_credential_id,
    jsonb_build_object('credential_type', p_credential_type_key, 'version_id', v_version_id));

  return query select v_credential_id, v_version_id;
end;
$$;

-- Renewal: a NEW version; earlier versions are untouched.
create function public.create_credential_version(p_credential_id uuid, p_issue_date date default null, p_expiry_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_credential public.credentials;
  v_type public.credential_types;
  v_version_id uuid;
begin
  select * into v_credential from public.credentials c where c.id = p_credential_id;
  if v_credential.id is null or v_credential.profile_id <> v_profile_id then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  if v_credential.status <> 'active' then
    raise exception 'withdrawn credentials cannot be renewed' using errcode = 'CH409';
  end if;
  select * into v_type from public.credential_types t where t.key = v_credential.credential_type_key;
  if not v_type.is_renewable then
    raise exception 'this credential type is not renewable' using errcode = 'CH409';
  end if;
  perform internal.require_valid_version_dates(v_credential.credential_type_key, p_issue_date, p_expiry_date);

  insert into public.credential_versions as v (credential_id, profile_id, issue_date, expiry_date)
  values (p_credential_id, v_profile_id, p_issue_date, p_expiry_date)
  returning v.id into v_version_id;

  perform internal.record_audit_event('credential.version_created', null, 'credential', p_credential_id,
    jsonb_build_object('version_id', v_version_id));
  return v_version_id;
end;
$$;

create function public.submit_credential_version(p_credential_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_version public.credential_versions;
  v_type public.credential_types;
  v_share record;
begin
  select * into v_version from public.credential_versions v where v.id = p_credential_version_id for update;
  if v_version.id is null or v_version.profile_id <> v_profile_id then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  if v_version.status <> 'draft' then
    raise exception 'only draft versions can be submitted' using errcode = 'CH409';
  end if;
  select t.* into v_type from public.credential_types t
  join public.credentials c on c.credential_type_key = t.key
  where c.id = v_version.credential_id;

  if v_type.requires_document and not exists (
    select 1 from public.credential_documents d
    where d.credential_version_id = p_credential_version_id and d.status in ('scanning', 'clean')
  ) then
    raise exception 'upload a document before submitting' using errcode = 'CH409';
  end if;

  update public.credential_versions v set status = 'submitted', submitted_at = now()
   where v.id = p_credential_version_id;

  perform internal.record_audit_event('credential.version_submitted', null, 'credential', v_version.credential_id,
    jsonb_build_object('version_id', p_credential_version_id));

  -- Each agency the credential is shared with sees a pending review in its audit history.
  for v_share in
    select s.agency_organisation_id from public.credential_shares s
    where s.credential_id = v_version.credential_id and s.status = 'active'
  loop
    perform internal.record_audit_event('credential.verification_submitted', v_share.agency_organisation_id,
      'credential', v_version.credential_id, jsonb_build_object('version_id', p_credential_version_id));
  end loop;
end;
$$;

create function public.withdraw_credential_version(p_credential_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_version public.credential_versions;
begin
  select * into v_version from public.credential_versions v where v.id = p_credential_version_id for update;
  if v_version.id is null or v_version.profile_id <> v_profile_id then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  if v_version.status <> 'draft' then
    raise exception 'only draft versions can be withdrawn' using errcode = 'CH409';
  end if;
  update public.credential_versions v set status = 'withdrawn' where v.id = p_credential_version_id;
end;
$$;

create function public.withdraw_credential(p_credential_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_credential public.credentials;
begin
  select * into v_credential from public.credentials c where c.id = p_credential_id for update;
  if v_credential.id is null or v_credential.profile_id <> v_profile_id then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  if v_credential.status = 'withdrawn' then
    raise exception 'credential already withdrawn' using errcode = 'CH409';
  end if;
  update public.credentials c set status = 'withdrawn' where c.id = p_credential_id;
  perform internal.record_audit_event('credential.withdrawn', null, 'credential', p_credential_id, '{}'::jsonb);
end;
$$;

-- Explicit share with an agency the person currently works with.
create function public.share_credential(p_credential_id uuid, p_agency_organisation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_credential public.credentials;
  v_membership_id uuid;
  v_share_id uuid;
begin
  select * into v_credential from public.credentials c where c.id = p_credential_id;
  if v_credential.id is null or v_credential.profile_id <> v_profile_id then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  if v_credential.status <> 'active' then
    raise exception 'withdrawn credentials cannot be shared' using errcode = 'CH409';
  end if;

  -- The person must be a current (non-terminated) worker at that agency.
  select w.membership_id into v_membership_id
  from public.agency_workers w
  join public.organisation_memberships m on m.id = w.membership_id and m.status = 'active'
  where w.agency_organisation_id = p_agency_organisation_id
    and w.profile_id = v_profile_id
    and w.status <> 'terminated';
  if v_membership_id is null then
    raise exception 'you can only share credentials with agencies you work with' using errcode = 'CH403';
  end if;

  insert into public.credential_shares as s (credential_id, profile_id, agency_organisation_id, membership_id)
  values (p_credential_id, v_profile_id, p_agency_organisation_id, v_membership_id)
  returning s.id into v_share_id;

  perform internal.record_audit_event('credential.shared', p_agency_organisation_id, 'credential', p_credential_id,
    jsonb_build_object('share_id', v_share_id));
  return v_share_id;
end;
$$;

create function public.revoke_credential_share(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_share public.credential_shares;
begin
  select * into v_share from public.credential_shares s where s.id = p_share_id for update;
  if v_share.id is null or v_share.profile_id <> v_profile_id then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  if v_share.status <> 'active' then
    raise exception 'share already revoked' using errcode = 'CH409';
  end if;
  update public.credential_shares s set status = 'revoked', revoked_at = now() where s.id = p_share_id;
  perform internal.record_audit_event('credential.share_revoked', v_share.agency_organisation_id, 'credential',
    v_share.credential_id, jsonb_build_object('share_id', p_share_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- Agency verification
-- -----------------------------------------------------------------------------
create function public.record_credential_verification(
  p_credential_version_id uuid,
  p_agency_organisation_id uuid,
  p_outcome public.verification_outcome,
  p_rejection_reason public.verification_rejection_reason default null,
  p_agency_facility_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_version public.credential_versions;
  v_type public.credential_types;
  v_actor_membership_id uuid;
  v_verification_id uuid;
begin
  perform internal.require_capability(p_agency_organisation_id, 'credential.verify');

  select * into v_version from public.credential_versions v where v.id = p_credential_version_id;
  if v_version.id is null or not exists (
    select 1 from public.credential_shares s
    join public.organisation_memberships m on m.id = s.membership_id and m.status = 'active'
    where s.credential_id = v_version.credential_id
      and s.agency_organisation_id = p_agency_organisation_id
      and s.status = 'active'
  ) then
    -- Not shared with this agency: indistinguishable from "does not exist".
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  if v_version.profile_id = v_profile_id then
    raise exception 'you cannot verify your own credential' using errcode = 'CH403';
  end if;
  if v_version.status <> 'submitted' then
    raise exception 'only submitted versions can be reviewed' using errcode = 'CH409';
  end if;

  select t.* into v_type from public.credential_types t
  join public.credentials c on c.credential_type_key = t.key
  where c.id = v_version.credential_id;

  if v_type.scope = 'facility' and p_agency_facility_id is null then
    raise exception 'facility-specific credentials are verified for a facility' using errcode = 'CH400';
  end if;
  if v_type.scope = 'person' and p_agency_facility_id is not null then
    raise exception 'this credential is not facility-specific' using errcode = 'CH400';
  end if;
  if p_outcome = 'rejected' and p_rejection_reason is null then
    raise exception 'a rejection reason is required' using errcode = 'CH400';
  end if;
  if p_outcome <> 'rejected' and p_rejection_reason is not null then
    raise exception 'a rejection reason applies only to rejections' using errcode = 'CH400';
  end if;
  -- Evidence must be trusted before it can be verified.
  if p_outcome = 'verified' and v_type.requires_document and not exists (
    select 1 from public.credential_documents d
    where d.credential_version_id = p_credential_version_id and d.status = 'clean'
  ) then
    raise exception 'documents must be cleared by scanning before verification' using errcode = 'CH409';
  end if;

  select m.id into v_actor_membership_id
  from public.organisation_memberships m
  where m.organisation_id = p_agency_organisation_id and m.profile_id = v_profile_id;

  insert into public.credential_verifications as cv (
    credential_id, credential_version_id, profile_id, agency_organisation_id, agency_facility_id,
    outcome, rejection_reason, actor_membership_id
  ) values (
    v_version.credential_id, p_credential_version_id, v_version.profile_id, p_agency_organisation_id,
    p_agency_facility_id, p_outcome, p_rejection_reason, v_actor_membership_id
  )
  returning cv.id into v_verification_id;

  perform internal.record_audit_event(
    case p_outcome when 'verified' then 'credential.verified'
                   when 'rejected' then 'credential.rejected'
                   else 'credential.review_started' end,
    p_agency_organisation_id, 'credential', v_version.credential_id,
    jsonb_strip_nulls(jsonb_build_object('version_id', p_credential_version_id,
      'verification_id', v_verification_id, 'reason', p_rejection_reason,
      'facility_id', p_agency_facility_id)));

  return v_verification_id;
end;
$$;

-- Agency overview of a worker's SHARED credentials (no numbers, no documents).
create function public.list_agency_worker_credentials(p_agency_worker_id uuid)
returns table (
  credential_id uuid,
  credential_type_key text,
  credential_type_name text,
  jurisdiction_code text,
  latest_version_id uuid,
  latest_version_number integer,
  latest_version_status public.credential_version_status,
  effective_expiry_date date,
  documents_cleared boolean,
  agency_verification public.verification_outcome,
  shared_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_worker public.agency_workers;
begin
  perform internal.require_identity();
  select * into v_worker from public.agency_workers w where w.id = p_agency_worker_id;
  perform internal.require_capability(v_worker.agency_organisation_id, 'credential.view');

  return query
    select c.id, t.key, t.name, c.jurisdiction_code, v.id, v.version_number, v.status,
           coalesce(v.expiry_date, (v.issue_date + make_interval(months => t.validity_months))::date),
           exists (select 1 from public.credential_documents d
                   where d.credential_version_id = v.id and d.status = 'clean'),
           (select cv.outcome from public.credential_verifications cv
             where cv.credential_version_id = v.id and cv.agency_organisation_id = v_worker.agency_organisation_id
             order by cv.sequence desc limit 1),
           s.shared_at
    from public.credential_shares s
    join public.organisation_memberships m on m.id = s.membership_id and m.status = 'active'
    join public.credentials c on c.id = s.credential_id and c.status = 'active'
    join public.credential_types t on t.key = c.credential_type_key
    left join lateral (
      select * from public.credential_versions x
      where x.credential_id = c.id and x.status = 'submitted'
      order by x.version_number desc limit 1
    ) v on true
    where s.agency_organisation_id = v_worker.agency_organisation_id
      and s.status = 'active'
      and c.profile_id = v_worker.profile_id
    order by t.sort_order, c.created_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- Requirement management
-- -----------------------------------------------------------------------------
create function public.create_credential_requirement(
  p_agency_organisation_id uuid,
  p_credential_type_key text,
  p_agency_facility_id uuid default null,
  p_discipline_key text default null,
  p_must_be_verified boolean default true,
  p_minimum_validity_days integer default 0,
  p_expiry_warning_days integer default 30,
  p_jurisdiction_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_type public.credential_types;
  v_requirement_id uuid;
begin
  perform internal.require_capability(p_agency_organisation_id, 'credential.requirements.manage');

  select * into v_type from public.credential_types t where t.key = p_credential_type_key and t.is_active;
  if v_type.key is null then
    raise exception 'unknown credential type' using errcode = 'CH400';
  end if;
  if v_type.scope = 'facility' and p_agency_facility_id is null then
    raise exception 'facility-specific credentials can only be required by a facility' using errcode = 'CH400';
  end if;
  if p_jurisdiction_code is not null then
    perform internal.require_valid_jurisdiction(p_credential_type_key, p_jurisdiction_code);
  end if;
  if p_agency_facility_id is not null and not exists (
    select 1 from public.agency_facilities f
    where f.id = p_agency_facility_id and f.agency_organisation_id = p_agency_organisation_id and f.status <> 'archived'
  ) then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;

  insert into public.credential_requirements as r (
    agency_organisation_id, agency_facility_id, discipline_key, credential_type_key, must_be_verified,
    minimum_validity_days, expiry_warning_days, jurisdiction_code, created_by_profile_id
  ) values (
    p_agency_organisation_id, p_agency_facility_id, p_discipline_key, p_credential_type_key,
    p_must_be_verified or v_type.requires_verification, p_minimum_validity_days, p_expiry_warning_days,
    p_jurisdiction_code, v_profile_id
  )
  returning r.id into v_requirement_id;

  perform internal.record_audit_event('credential.requirement_created', p_agency_organisation_id,
    'credential_requirement', v_requirement_id,
    jsonb_strip_nulls(jsonb_build_object('credential_type', p_credential_type_key,
      'facility_id', p_agency_facility_id, 'discipline', p_discipline_key)));
  return v_requirement_id;
end;
$$;

create function public.update_credential_requirement(
  p_requirement_id uuid,
  p_must_be_verified boolean,
  p_minimum_validity_days integer,
  p_expiry_warning_days integer,
  p_status public.requirement_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requirement public.credential_requirements;
  v_requires_verification boolean;
begin
  perform internal.require_identity();
  select * into v_requirement from public.credential_requirements r where r.id = p_requirement_id for update;
  perform internal.require_capability(v_requirement.agency_organisation_id, 'credential.requirements.manage');

  if v_requirement.status = 'inactive' then
    raise exception 'inactive requirements are history; create a new one' using errcode = 'CH409';
  end if;
  select t.requires_verification into v_requires_verification
  from public.credential_types t where t.key = v_requirement.credential_type_key;

  update public.credential_requirements r
     set must_be_verified = p_must_be_verified or v_requires_verification,
         minimum_validity_days = p_minimum_validity_days,
         expiry_warning_days = p_expiry_warning_days,
         status = p_status,
         effective_until = case when p_status = 'inactive' then current_date else r.effective_until end
   where r.id = p_requirement_id;

  perform internal.record_audit_event('credential.requirement_updated', v_requirement.agency_organisation_id,
    'credential_requirement', p_requirement_id,
    jsonb_build_object('status', p_status, 'minimum_validity_days', p_minimum_validity_days,
                       'must_be_verified', p_must_be_verified or v_requires_verification));
end;
$$;

-- -----------------------------------------------------------------------------
-- Disciplines (worker.manage)
-- -----------------------------------------------------------------------------
create function public.set_agency_worker_discipline(p_agency_worker_id uuid, p_discipline_key text, p_assigned boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_worker public.agency_workers;
begin
  select * into v_worker from public.agency_workers w where w.id = p_agency_worker_id;
  perform internal.require_capability(v_worker.agency_organisation_id, 'worker.manage');
  if v_worker.profile_id = v_profile_id then
    raise exception 'you cannot change your own worker record' using errcode = 'CH403';
  end if;
  if not exists (select 1 from public.disciplines d where d.key = p_discipline_key and d.is_active) then
    raise exception 'unknown discipline' using errcode = 'CH400';
  end if;

  if p_assigned then
    insert into public.agency_worker_disciplines (agency_organisation_id, agency_worker_id, discipline_key, assigned_by_profile_id)
    values (v_worker.agency_organisation_id, p_agency_worker_id, p_discipline_key, v_profile_id)
    on conflict (agency_worker_id, discipline_key) do nothing;
  else
    delete from public.agency_worker_disciplines x
    where x.agency_worker_id = p_agency_worker_id and x.discipline_key = p_discipline_key;
  end if;

  perform internal.record_audit_event('worker.discipline_changed', v_worker.agency_organisation_id, 'worker',
    p_agency_worker_id, jsonb_build_object('discipline', p_discipline_key, 'assigned', p_assigned));
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function
  internal.require_valid_jurisdiction(text, text),
  internal.require_valid_version_dates(text, date, date)
from public, anon, authenticated;

revoke all on function
  public.create_credential(text, text, text, text, date, date),
  public.create_credential_version(uuid, date, date),
  public.submit_credential_version(uuid),
  public.withdraw_credential_version(uuid),
  public.withdraw_credential(uuid),
  public.share_credential(uuid, uuid),
  public.revoke_credential_share(uuid),
  public.record_credential_verification(uuid, uuid, public.verification_outcome, public.verification_rejection_reason, uuid),
  public.list_agency_worker_credentials(uuid),
  public.create_credential_requirement(uuid, text, uuid, text, boolean, integer, integer, text),
  public.update_credential_requirement(uuid, boolean, integer, integer, public.requirement_status),
  public.set_agency_worker_discipline(uuid, text, boolean)
from public, anon;

grant execute on function
  public.create_credential(text, text, text, text, date, date),
  public.create_credential_version(uuid, date, date),
  public.submit_credential_version(uuid),
  public.withdraw_credential_version(uuid),
  public.withdraw_credential(uuid),
  public.share_credential(uuid, uuid),
  public.revoke_credential_share(uuid),
  public.record_credential_verification(uuid, uuid, public.verification_outcome, public.verification_rejection_reason, uuid),
  public.list_agency_worker_credentials(uuid),
  public.create_credential_requirement(uuid, text, uuid, text, boolean, integer, integer, text),
  public.update_credential_requirement(uuid, boolean, integer, integer, public.requirement_status),
  public.set_agency_worker_discipline(uuid, text, boolean)
to authenticated;
