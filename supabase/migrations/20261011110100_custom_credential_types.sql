-- =============================================================================
-- Migration: custom_credential_types
-- Stage:     P0-E9-3J (custom certifications & requirements)
--
-- Purpose
--   Agency-defined credential / requirement types in the SAME catalog as
--   Chelth's standard types (public.credential_types), so requirements,
--   person credentials, documents, verification, the compliance engine and
--   shift eligibility work unchanged (one logical type identity: `key`).
--   - owner_organisation_id NULL  ⇒ Chelth standard (global, unchanged)
--   - owner_organisation_id = X   ⇒ agency X's custom type
--   Tenant isolation (database-enforced):
--   - RLS: standard types, types of organisations the caller belongs to, and
--     types of credentials the caller holds (history) — never another agency's;
--   - create_credential: a custom type only for the owning agency's workers;
--   - create_credential_requirement: standard or the requiring agency's own;
--   - share_credential: a custom-typed credential only to its owning agency.
--   Lifecycle: active ⇄ archived (is_active). Never deleted. Archiving needs
--   no active requirement to use it. Once used (requirements or credentials),
--   structural fields are LOCKED; name, category and instructions stay
--   editable (they never change compliance meaning).
--   Management: credential.requirements.manage (privileged ⇒ AAL2), audited.
-- =============================================================================

alter table public.credential_types
  add column owner_organisation_id uuid references public.organisations (id) on delete restrict,
  add column instructions text check (instructions is null or char_length(instructions) <= 1000),
  add column created_by_profile_id uuid references public.profiles (id) on delete set null,
  add column updated_at timestamptz not null default now(),
  add column archived_at timestamptz;

alter table public.credential_types
  add constraint credential_types_custom_shape check (
    owner_organisation_id is null
    or (key ~ '^custom_[0-9a-f]{32}$'
        and char_length(btrim(name)) between 2 and 120 and name !~ '[[:cntrl:]]'
        and scope = 'person')),
  add constraint credential_types_archived_consistent check ((archived_at is null) = is_active or owner_organisation_id is null);

-- No two ACTIVE custom types with the same name in one agency (case/space-insensitive).
create unique index credential_types_custom_name_unique
  on public.credential_types (owner_organisation_id, lower(btrim(name)))
  where owner_organisation_id is not null and is_active;
create index credential_types_owner_idx on public.credential_types (owner_organisation_id)
  where owner_organisation_id is not null;

-- RLS: never another agency's custom types.
drop policy credential_types_select on public.credential_types;
create policy credential_types_select on public.credential_types
  for select to authenticated
  using (
    owner_organisation_id is null
    or authz.is_org_member(owner_organisation_id)
    or exists (select 1 from public.credentials c
               where c.credential_type_key = credential_types.key and c.profile_id = auth.uid())
  );

-- Used = referenced by any requirement or credential (history included).
create function internal.custom_credential_type_used(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.credential_requirements r where r.credential_type_key = p_key)
      or exists (select 1 from public.credentials c where c.credential_type_key = p_key)
$$;

create function internal.require_custom_type_shape(
  p_name text, p_category public.credential_category, p_jurisdiction_rule public.credential_jurisdiction_rule,
  p_validity_months integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := btrim(p_name);
begin
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 or v_name ~ '[[:cntrl:]]' then
    raise exception 'requirement name must be 2–120 characters' using errcode = 'CH400';
  end if;
  if p_category is null or p_jurisdiction_rule is null then
    raise exception 'category is required' using errcode = 'CH400';
  end if;
  if p_validity_months is not null and p_validity_months not between 1 and 120 then
    raise exception 'renewal interval must be 1–120 months' using errcode = 'CH400';
  end if;
  return v_name;
end;
$$;

create function public.create_custom_credential_type(
  p_organisation_id uuid,
  p_name text,
  p_category public.credential_category,
  p_requires_document boolean,
  p_requires_expiry_date boolean,
  p_requires_verification boolean,
  p_requires_credential_number boolean,
  p_jurisdiction_rule public.credential_jurisdiction_rule default 'none',
  p_validity_months integer default null,
  p_instructions text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_name text;
  v_key text := 'custom_' || replace(gen_random_uuid()::text, '-', '');
begin
  perform internal.require_capability(p_organisation_id, 'credential.requirements.manage');
  if not exists (select 1 from public.organisations o where o.id = p_organisation_id and o.type = 'agency') then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  v_name := internal.require_custom_type_shape(p_name, p_category, p_jurisdiction_rule, p_validity_months);
  if exists (select 1 from public.credential_types t
             where t.owner_organisation_id = p_organisation_id and t.is_active
               and lower(btrim(t.name)) = lower(v_name)) then
    raise exception 'a custom requirement with this name already exists' using errcode = 'CHC01';
  end if;
  insert into public.credential_types (
    key, name, category, scope, jurisdiction_rule, requires_issue_date, requires_expiry_date,
    requires_credential_number, requires_document, requires_verification, is_renewable, validity_months,
    is_active, sort_order, owner_organisation_id, instructions, created_by_profile_id
  ) values (
    v_key, v_name, p_category, 'person', p_jurisdiction_rule, p_validity_months is not null,
    coalesce(p_requires_expiry_date, false), coalesce(p_requires_credential_number, false),
    coalesce(p_requires_document, true), coalesce(p_requires_verification, true), true, p_validity_months,
    true, 1000, p_organisation_id, nullif(btrim(p_instructions), ''), v_profile_id
  );
  perform internal.record_audit_event('credential_type.custom_created', p_organisation_id, 'credential_type', null,
    jsonb_build_object('type_key', v_key, 'category', p_category));
  return v_key;
end;
$$;

-- Name, category and instructions are always editable; the structural fields
-- only until the type is used (otherwise CHC02: history keeps its meaning).
create function public.update_custom_credential_type(
  p_key text,
  p_name text,
  p_category public.credential_category,
  p_requires_document boolean,
  p_requires_expiry_date boolean,
  p_requires_verification boolean,
  p_requires_credential_number boolean,
  p_jurisdiction_rule public.credential_jurisdiction_rule default 'none',
  p_validity_months integer default null,
  p_instructions text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.credential_types;
  v_name text;
  v_changes text[] := '{}'::text[];
  v_structural boolean;
begin
  perform internal.require_identity();
  select * into v_type from public.credential_types t where t.key = p_key and t.owner_organisation_id is not null;
  if v_type.key is null then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  perform internal.require_capability(v_type.owner_organisation_id, 'credential.requirements.manage');
  v_name := internal.require_custom_type_shape(p_name, p_category, p_jurisdiction_rule, p_validity_months);

  v_structural := (coalesce(p_requires_document, true), coalesce(p_requires_expiry_date, false),
                   coalesce(p_requires_verification, true), coalesce(p_requires_credential_number, false),
                   p_jurisdiction_rule, p_validity_months)
               is distinct from
                  (v_type.requires_document, v_type.requires_expiry_date, v_type.requires_verification,
                   v_type.requires_credential_number, v_type.jurisdiction_rule, v_type.validity_months);
  if v_structural and internal.custom_credential_type_used(p_key) then
    raise exception 'this requirement type is in use; its evidence rules can no longer change' using errcode = 'CHC02';
  end if;
  if v_type.is_active and lower(v_name) <> lower(btrim(v_type.name)) and exists (
    select 1 from public.credential_types t
    where t.owner_organisation_id = v_type.owner_organisation_id and t.is_active and t.key <> p_key
      and lower(btrim(t.name)) = lower(v_name)) then
    raise exception 'a custom requirement with this name already exists' using errcode = 'CHC01';
  end if;

  if v_name is distinct from v_type.name then v_changes := v_changes || 'name'::text; end if;
  if p_category is distinct from v_type.category then v_changes := v_changes || 'category'::text; end if;
  if nullif(btrim(p_instructions), '') is distinct from v_type.instructions then v_changes := v_changes || 'instructions'::text; end if;
  if v_structural then v_changes := v_changes || 'evidence_rules'::text; end if;

  update public.credential_types t set
    name = v_name, category = p_category, instructions = nullif(btrim(p_instructions), ''),
    requires_document = coalesce(p_requires_document, true),
    requires_expiry_date = coalesce(p_requires_expiry_date, false),
    requires_verification = coalesce(p_requires_verification, true),
    requires_credential_number = coalesce(p_requires_credential_number, false),
    jurisdiction_rule = p_jurisdiction_rule, validity_months = p_validity_months,
    requires_issue_date = p_validity_months is not null, updated_at = now()
  where t.key = p_key;
  perform internal.record_audit_event('credential_type.custom_updated', v_type.owner_organisation_id,
    'credential_type', null, jsonb_build_object('type_key', p_key, 'category', p_category, 'changes', to_jsonb(v_changes)));
end;
$$;

-- Archive (no new requirements or credentials; history stays valid) / restore.
create function public.set_custom_credential_type_active(p_key text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.credential_types;
begin
  perform internal.require_identity();
  select * into v_type from public.credential_types t where t.key = p_key and t.owner_organisation_id is not null;
  if v_type.key is null or p_active is null then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  perform internal.require_capability(v_type.owner_organisation_id, 'credential.requirements.manage');
  if v_type.is_active = p_active then
    return;
  end if;
  if not p_active and exists (
    select 1 from public.credential_requirements r where r.credential_type_key = p_key and r.status = 'active') then
    raise exception 'deactivate the requirements that use this type first' using errcode = 'CHC02';
  end if;
  if p_active and exists (
    select 1 from public.credential_types t
    where t.owner_organisation_id = v_type.owner_organisation_id and t.is_active and t.key <> p_key
      and lower(btrim(t.name)) = lower(btrim(v_type.name))) then
    raise exception 'a custom requirement with this name already exists' using errcode = 'CHC01';
  end if;
  update public.credential_types t
     set is_active = p_active, archived_at = case when p_active then null else now() end, updated_at = now()
   where t.key = p_key;
  perform internal.record_audit_event(
    case when p_active then 'credential_type.custom_restored' else 'credential_type.custom_archived' end,
    v_type.owner_organisation_id, 'credential_type', null,
    jsonb_build_object('type_key', p_key, 'category', v_type.category));
end;
$$;

-- Management list with usage counts (no worker data).
create function public.list_custom_credential_types(p_organisation_id uuid)
returns table (
  key text, name text, category public.credential_category, requires_document boolean,
  requires_expiry_date boolean, requires_verification boolean, requires_credential_number boolean,
  jurisdiction_rule public.credential_jurisdiction_rule, validity_months integer, instructions text,
  is_active boolean, requirement_count integer, active_requirement_count integer, credential_count integer,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'credential.requirements.view');
  return query
    select t.key, t.name, t.category, t.requires_document, t.requires_expiry_date, t.requires_verification,
           t.requires_credential_number, t.jurisdiction_rule, t.validity_months, t.instructions, t.is_active,
           (select count(*)::int from public.credential_requirements r where r.credential_type_key = t.key),
           (select count(*)::int from public.credential_requirements r where r.credential_type_key = t.key and r.status = 'active'),
           (select count(*)::int from public.credentials c where c.credential_type_key = t.key),
           t.updated_at
    from public.credential_types t
    where t.owner_organisation_id = p_organisation_id
    order by t.is_active desc, lower(t.name), t.key;
end;
$$;

-- -----------------------------------------------------------------------------
-- Ownership in the existing write paths (same signatures)
-- -----------------------------------------------------------------------------
create or replace function public.create_credential(
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
  -- P0-E9-3J: an agency's custom type is usable only by that agency's current
  -- workers (indistinguishable from "unknown" for anyone else).
  if v_type.key is null or (v_type.owner_organisation_id is not null and not exists (
    select 1 from public.agency_workers w
    join public.organisation_memberships m on m.id = w.membership_id and m.status = 'active'
    where w.agency_organisation_id = v_type.owner_organisation_id
      and w.profile_id = v_profile_id and w.status <> 'terminated')) then
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

create or replace function public.share_credential(p_credential_id uuid, p_agency_organisation_id uuid)
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
  -- P0-E9-3J: an agency's custom type never reaches another agency.
  if exists (select 1 from public.credential_types t
             where t.key = v_credential.credential_type_key
               and t.owner_organisation_id is not null
               and t.owner_organisation_id <> p_agency_organisation_id) then
    raise exception 'this credential belongs to another agency''s requirements' using errcode = 'CH403';
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

create or replace function public.create_credential_requirement(
  p_agency_organisation_id uuid,
  p_credential_type_key text,
  p_effective_from date,
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

  -- The effective date is an explicit calendar date chosen by the caller
  -- (the UI defaults it to the facility's local date). It is never derived
  -- from the database's UTC calendar.
  if p_effective_from is null then
    raise exception 'choose the date this requirement applies from' using errcode = 'CH400';
  end if;
  if p_effective_from not between date '2000-01-01' and date '2099-12-31' then
    raise exception 'effective date out of range' using errcode = 'CH400';
  end if;

  select * into v_type from public.credential_types t where t.key = p_credential_type_key and t.is_active;
  -- P0-E9-3J: standard types, or THIS agency's active custom types only.
  if v_type.key is null
     or (v_type.owner_organisation_id is not null and v_type.owner_organisation_id <> p_agency_organisation_id) then
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
    minimum_validity_days, expiry_warning_days, jurisdiction_code, effective_from, created_by_profile_id
  ) values (
    p_agency_organisation_id, p_agency_facility_id, p_discipline_key, p_credential_type_key,
    p_must_be_verified or v_type.requires_verification, p_minimum_validity_days, p_expiry_warning_days,
    p_jurisdiction_code, p_effective_from, v_profile_id
  )
  returning r.id into v_requirement_id;

  perform internal.record_audit_event('credential.requirement_created', p_agency_organisation_id,
    'credential_requirement', v_requirement_id,
    jsonb_strip_nulls(jsonb_build_object('credential_type', p_credential_type_key,
      'facility_id', p_agency_facility_id, 'discipline', p_discipline_key, 'effective_from', p_effective_from)));
  return v_requirement_id;
end;
$$;

revoke all on function
  internal.custom_credential_type_used(text),
  internal.require_custom_type_shape(text, public.credential_category, public.credential_jurisdiction_rule, integer)
from public, anon, authenticated, service_role;
revoke all on function
  public.create_custom_credential_type(uuid, text, public.credential_category, boolean, boolean, boolean, boolean,
                                       public.credential_jurisdiction_rule, integer, text),
  public.update_custom_credential_type(text, text, public.credential_category, boolean, boolean, boolean, boolean,
                                       public.credential_jurisdiction_rule, integer, text),
  public.set_custom_credential_type_active(text, boolean),
  public.list_custom_credential_types(uuid)
from public, anon;
grant execute on function
  public.create_custom_credential_type(uuid, text, public.credential_category, boolean, boolean, boolean, boolean,
                                       public.credential_jurisdiction_rule, integer, text),
  public.update_custom_credential_type(text, text, public.credential_category, boolean, boolean, boolean, boolean,
                                       public.credential_jurisdiction_rule, integer, text),
  public.set_custom_credential_type_active(text, boolean),
  public.list_custom_credential_types(uuid)
to authenticated;
