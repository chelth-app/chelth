-- =============================================================================
-- Migration: local_date_requirements
-- Stage:     P0-E7-S1A (local-date compliance effectiveness hardening)
--
-- Root cause
--   credential_requirements.effective_from defaulted to the database's UTC
--   current_date and create_credential_requirement never supplied a value.
--   Compliance compares requirement dates with the shift's FACILITY-LOCAL
--   date, so a requirement created after midnight UTC but before local
--   midnight (US evening) was not yet effective for that local day's shifts.
--   Deactivation likewise stamped effective_until with the UTC date, and the
--   "readiness today" views defaulted to the UTC date.
--
-- Change (future behaviour only; existing rows are NOT rewritten)
--   * effective_from has no default: callers supply an explicit DATE.
--     create_credential_requirement gains a required p_effective_from.
--   * update_credential_requirement records an explicit p_effective_until
--     when deactivating (required then, refused otherwise).
--   * Readiness views with a facility evaluate the facility-local date when no
--     date is given (internal.compliance_as_of). Agency-wide views have no
--     agency timezone in Chelth and keep the documented UTC fallback (display
--     only; assignment eligibility always uses the shift's local dates).
--   * The canonical engine (internal.evaluate_compliance) is unchanged.
-- =============================================================================

alter table public.credential_requirements alter column effective_from drop default;

-- A facility-local calendar date for an instant (pure; testable with fixed instants).
create function internal.local_date_at(p_timezone text, p_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone p_timezone)::date
$$;

-- "Today" for a facility: its local calendar date. Without a facility (agency
-- baseline view) Chelth has no trustworthy agency timezone: UTC date, documented.
create function internal.compliance_as_of(p_as_of date, p_agency_facility_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_as_of,
    (select internal.local_date_at(f.timezone, now()) from public.agency_facilities f where f.id = p_agency_facility_id),
    current_date)
$$;

drop function public.create_credential_requirement(uuid, text, uuid, text, boolean, integer, integer, text);
drop function public.update_credential_requirement(uuid, boolean, integer, integer, public.requirement_status);


create function public.create_credential_requirement(
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

create function public.update_credential_requirement(
  p_requirement_id uuid,
  p_must_be_verified boolean,
  p_minimum_validity_days integer,
  p_expiry_warning_days integer,
  p_status public.requirement_status,
  p_effective_until date default null
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
  -- Deactivation records an explicit last day (never the UTC calendar date).
  if p_status = 'inactive' and (p_effective_until is null or p_effective_until < v_requirement.effective_from) then
    raise exception 'choose the last day this requirement applies' using errcode = 'CH400';
  end if;
  if p_status = 'active' and p_effective_until is not null then
    raise exception 'an end date is only recorded when deactivating' using errcode = 'CH400';
  end if;
  select t.requires_verification into v_requires_verification
  from public.credential_types t where t.key = v_requirement.credential_type_key;

  update public.credential_requirements r
     set must_be_verified = p_must_be_verified or v_requires_verification,
         minimum_validity_days = p_minimum_validity_days,
         expiry_warning_days = p_expiry_warning_days,
         status = p_status,
         effective_until = case when p_status = 'inactive' then p_effective_until else r.effective_until end
   where r.id = p_requirement_id;

  perform internal.record_audit_event('credential.requirement_updated', v_requirement.agency_organisation_id,
    'credential_requirement', p_requirement_id,
    jsonb_build_object('status', p_status, 'effective_until', p_effective_until,
                       'minimum_validity_days', p_minimum_validity_days,
                       'must_be_verified', p_must_be_verified or v_requires_verification));
end;
$$;

create or replace function public.evaluate_worker_compliance(
  p_agency_worker_id uuid,
  p_agency_facility_id uuid default null,
  p_as_of date default null
)
returns table (
  requirement_id uuid,
  requirement_scope text,
  credential_type_key text,
  credential_type_name text,
  reason public.compliance_reason,
  severity public.compliance_severity,
  credential_id uuid,
  effective_expiry_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.authorize_compliance_read(p_agency_worker_id, p_agency_facility_id);
  return query
    select e.requirement_id, e.requirement_scope, e.credential_type_key, t.name, e.reason, e.severity,
           e.credential_id, e.effective_expiry_date
    from internal.evaluate_compliance(p_agency_worker_id, p_agency_facility_id,
      internal.compliance_as_of(p_as_of, p_agency_facility_id)) e
    left join public.credential_types t on t.key = e.credential_type_key
    order by case e.severity when 'blocking' then 0 when 'warning' then 1 else 2 end, t.sort_order;
end;
$$;

create or replace function public.worker_readiness(
  p_agency_worker_id uuid,
  p_agency_facility_id uuid default null,
  p_as_of date default null
)
returns table (readiness public.readiness_status, blocking_count integer, warning_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_blocking integer;
  v_warning integer;
begin
  perform internal.authorize_compliance_read(p_agency_worker_id, p_agency_facility_id);
  select count(*) filter (where e.severity = 'blocking'), count(*) filter (where e.severity = 'warning')
    into v_blocking, v_warning
  from internal.evaluate_compliance(p_agency_worker_id, p_agency_facility_id,
      internal.compliance_as_of(p_as_of, p_agency_facility_id)) e;
  return query select internal.readiness_from(v_blocking, v_warning), v_blocking, v_warning;
end;
$$;

create or replace function public.list_shared_worker_compliance(p_relationship_id uuid)
returns table (
  agency_worker_id uuid,
  worker_display_name text,
  readiness public.readiness_status,
  credential_type_name text,
  reason public.compliance_reason,
  severity public.compliance_severity,
  effective_expiry_date date
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_relationship public.agency_facility_relationships;
  v_facility_org uuid;
  v_share record;
  v_blocking integer;
  v_warning integer;
begin
  perform internal.require_identity();
  if not authz.has_relationship_capability(p_relationship_id, 'credential.view') then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  select * into v_relationship from public.agency_facility_relationships r where r.id = p_relationship_id;
  if v_relationship.status <> 'active' then
    return;
  end if;
  select f.linked_facility_organisation_id into v_facility_org
  from public.agency_facilities f where f.id = v_relationship.agency_facility_id;

  perform internal.record_audit_event('compliance.viewed_by_facility', v_facility_org, 'relationship',
    p_relationship_id, '{}'::jsonb);

  for v_share in
    select s.agency_worker_id, p.display_name
    from public.relationship_worker_compliance_shares s
    join public.agency_workers w on w.id = s.agency_worker_id
    join public.profiles p on p.id = w.profile_id
    where s.relationship_id = p_relationship_id and s.status = 'active'
  loop
    select count(*) filter (where e.severity = 'blocking'), count(*) filter (where e.severity = 'warning')
      into v_blocking, v_warning
    from internal.evaluate_compliance(v_share.agency_worker_id, v_relationship.agency_facility_id,
      internal.compliance_as_of(null, v_relationship.agency_facility_id)) e;

    return query
      select v_share.agency_worker_id, v_share.display_name, internal.readiness_from(v_blocking, v_warning),
             coalesce(t.name, 'Worker status'), e.reason, e.severity, e.effective_expiry_date
      from internal.evaluate_compliance(v_share.agency_worker_id, v_relationship.agency_facility_id,
      internal.compliance_as_of(null, v_relationship.agency_facility_id)) e
      left join public.credential_types t on t.key = e.credential_type_key;
  end loop;
end;
$$;


revoke all on function internal.compliance_as_of(date, uuid), internal.local_date_at(text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function
  public.create_credential_requirement(uuid, text, date, uuid, text, boolean, integer, integer, text),
  public.update_credential_requirement(uuid, boolean, integer, integer, public.requirement_status, date)
from public, anon;
grant execute on function
  public.create_credential_requirement(uuid, text, date, uuid, text, boolean, integer, integer, text),
  public.update_credential_requirement(uuid, boolean, integer, integer, public.requirement_status, date)
to authenticated;
