-- =============================================================================
-- Migration: compliance_engine
-- Stage:     P0-E4-S1
--
-- Purpose
--   DERIVED, EXPLAINABLE compliance. Nothing stores "compliant = true".
--
--   internal.evaluate_compliance(worker, facility?, as_of) evaluates every
--   applicable requirement (agency baseline + the facility's, filtered by the
--   worker's disciplines and effective dates) against the person's credentials
--   that are SHARED with that agency, and returns one row per requirement with
--   a reason code and severity, plus worker-level rows. All callers — agency,
--   worker self-view, facility projection — use this single function.
--
--   Per requirement, the best candidate version wins (rank):
--     MET (0) · EXPIRING_SOON (1) · UNVERIFIED_CREDENTIAL (2) ·
--     VERIFICATION_REJECTED (3) · DOCUMENT_NOT_CLEARED (4) · DOCUMENT_MISSING (5) ·
--     INSUFFICIENT_VALIDITY (6) · EXPIRED_CREDENTIAL (7)
--   and when no candidate exists: MISSING_CREDENTIAL · CREDENTIAL_NOT_SHARED ·
--   WRONG_JURISDICTION · NOT_SUBMITTED.
--   Worker-level: WORKER_NOT_ACTIVE (blocking), DISCIPLINE_NOT_SET (warning).
--
--   Readiness: not_eligible if any blocking reason; action_required if only
--   warnings; ready otherwise.
--
--   Dates: effective expiry = expiry_date, or issue_date + type validity_months.
--   A credential is valid THROUGH its expiry date. Evaluation is "as of" a date
--   (default today, UTC) so future scheduling can evaluate on the shift date.
--
--   Facility-side visibility: relationship_worker_compliance_shares is the
--   explicit, per-worker, per-relationship share; list_shared_worker_compliance
--   returns only readiness + reason rows for shared workers (no documents,
--   numbers, notes or verification detail).
--
-- Verified by: supabase/tests/security/100_compliance.test.sql
-- =============================================================================

create type public.compliance_reason as enum (
  'MET', 'EXPIRING_SOON', 'MISSING_CREDENTIAL', 'CREDENTIAL_NOT_SHARED', 'WRONG_JURISDICTION',
  'NOT_SUBMITTED', 'DOCUMENT_MISSING', 'DOCUMENT_NOT_CLEARED', 'UNVERIFIED_CREDENTIAL',
  'VERIFICATION_REJECTED', 'EXPIRED_CREDENTIAL', 'INSUFFICIENT_VALIDITY', 'WORKER_NOT_ACTIVE',
  'DISCIPLINE_NOT_SET'
);
create type public.compliance_severity as enum ('ok', 'warning', 'blocking');
create type public.readiness_status as enum ('ready', 'action_required', 'not_eligible');

-- -----------------------------------------------------------------------------
-- Core evaluator (internal: no authorization — callers authorize)
-- -----------------------------------------------------------------------------
create function internal.evaluate_compliance(p_agency_worker_id uuid, p_agency_facility_id uuid, p_as_of date)
returns table (
  requirement_id uuid,
  requirement_scope text,
  credential_type_key text,
  reason public.compliance_reason,
  severity public.compliance_severity,
  credential_id uuid,
  credential_version_id uuid,
  effective_expiry_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  w public.agency_workers;
  v_membership_active boolean;
  r public.credential_requirements;
  t public.credential_types;
  v record;
  v_expiry date;
  v_latest public.verification_outcome;
  v_reason public.compliance_reason;
  v_rank integer;
  v_best_rank integer;
  v_best_reason public.compliance_reason;
  v_best_credential uuid;
  v_best_version uuid;
  v_best_expiry date;
begin
  select * into w from public.agency_workers x where x.id = p_agency_worker_id;
  if w.id is null then
    return;
  end if;

  select m.status = 'active' into v_membership_active
  from public.organisation_memberships m where m.id = w.membership_id;

  if w.status <> 'active' or not coalesce(v_membership_active, false) then
    return query select null::uuid, 'worker'::text, null::text, 'WORKER_NOT_ACTIVE'::public.compliance_reason,
      'blocking'::public.compliance_severity, null::uuid, null::uuid, null::date;
  end if;

  if not exists (select 1 from public.agency_worker_disciplines d where d.agency_worker_id = w.id)
     and exists (
       select 1 from public.credential_requirements q
       where q.agency_organisation_id = w.agency_organisation_id and q.status = 'active'
         and q.discipline_key is not null
         and (q.agency_facility_id is null or q.agency_facility_id = p_agency_facility_id)
     ) then
    return query select null::uuid, 'worker'::text, null::text, 'DISCIPLINE_NOT_SET'::public.compliance_reason,
      'warning'::public.compliance_severity, null::uuid, null::uuid, null::date;
  end if;

  for r in
    select q.* from public.credential_requirements q
    where q.agency_organisation_id = w.agency_organisation_id
      and q.status = 'active'
      and q.effective_from <= p_as_of
      and (q.effective_until is null or q.effective_until >= p_as_of)
      and (q.agency_facility_id is null or q.agency_facility_id = p_agency_facility_id)
      and (q.discipline_key is null or exists (
        select 1 from public.agency_worker_disciplines d
        where d.agency_worker_id = w.id and d.discipline_key = q.discipline_key))
    order by (q.agency_facility_id is not null), q.credential_type_key
  loop
    select * into t from public.credential_types ct where ct.key = r.credential_type_key;
    v_best_rank := 1000;
    v_best_reason := null;
    v_best_credential := null;
    v_best_version := null;
    v_best_expiry := null;

    if not exists (
      select 1 from public.credentials c
      where c.profile_id = w.profile_id and c.credential_type_key = r.credential_type_key and c.status = 'active'
    ) then
      v_best_reason := 'MISSING_CREDENTIAL';
    elsif not exists (
      select 1 from public.credentials c
      join public.credential_shares s on s.credential_id = c.id and s.status = 'active'
        and s.agency_organisation_id = w.agency_organisation_id
      where c.profile_id = w.profile_id and c.credential_type_key = r.credential_type_key and c.status = 'active'
    ) then
      v_best_reason := 'CREDENTIAL_NOT_SHARED';
    elsif r.jurisdiction_code is not null and not exists (
      select 1 from public.credentials c
      join public.credential_shares s on s.credential_id = c.id and s.status = 'active'
        and s.agency_organisation_id = w.agency_organisation_id
      where c.profile_id = w.profile_id and c.credential_type_key = r.credential_type_key and c.status = 'active'
        and c.jurisdiction_code = r.jurisdiction_code
    ) then
      v_best_reason := 'WRONG_JURISDICTION';
    else
      for v in
        select cv.id, cv.credential_id, cv.issue_date, cv.expiry_date
        from public.credentials c
        join public.credential_shares s on s.credential_id = c.id and s.status = 'active'
          and s.agency_organisation_id = w.agency_organisation_id
        join public.credential_versions cv on cv.credential_id = c.id and cv.status = 'submitted'
        where c.profile_id = w.profile_id
          and c.credential_type_key = r.credential_type_key
          and c.status = 'active'
          and (r.jurisdiction_code is null or c.jurisdiction_code = r.jurisdiction_code)
      loop
        v_expiry := coalesce(v.expiry_date, (v.issue_date + make_interval(months => t.validity_months))::date);

        v_latest := null;
        if r.must_be_verified then
          select x.outcome into v_latest
          from public.credential_verifications x
          where x.credential_version_id = v.id
            and x.agency_organisation_id = w.agency_organisation_id
            and (case when t.scope = 'facility' then x.agency_facility_id = p_agency_facility_id
                      else x.agency_facility_id is null end)
          order by x.sequence desc
          limit 1;
        end if;

        if v_expiry is not null and v_expiry < p_as_of then
          v_reason := 'EXPIRED_CREDENTIAL'; v_rank := 7;
        elsif v_expiry is not null and v_expiry < p_as_of + r.minimum_validity_days then
          v_reason := 'INSUFFICIENT_VALIDITY'; v_rank := 6;
        elsif t.requires_document and not exists (
          select 1 from public.credential_documents d where d.credential_version_id = v.id and d.status = 'clean'
        ) then
          if exists (
            select 1 from public.credential_documents d
            where d.credential_version_id = v.id and d.status in ('upload_pending', 'scanning')
          ) then
            v_reason := 'DOCUMENT_NOT_CLEARED'; v_rank := 4;
          else
            v_reason := 'DOCUMENT_MISSING'; v_rank := 5;
          end if;
        elsif r.must_be_verified and v_latest is distinct from 'verified'::public.verification_outcome then
          if v_latest = 'rejected' then
            v_reason := 'VERIFICATION_REJECTED'; v_rank := 3;
          else
            v_reason := 'UNVERIFIED_CREDENTIAL'; v_rank := 2;
          end if;
        elsif v_expiry is not null and v_expiry < p_as_of + r.expiry_warning_days then
          v_reason := 'EXPIRING_SOON'; v_rank := 1;
        else
          v_reason := 'MET'; v_rank := 0;
        end if;

        if v_rank < v_best_rank then
          v_best_rank := v_rank;
          v_best_reason := v_reason;
          v_best_credential := v.credential_id;
          v_best_version := v.id;
          v_best_expiry := v_expiry;
        end if;
      end loop;

      if v_best_reason is null then
        v_best_reason := 'NOT_SUBMITTED';
      end if;
    end if;

    return query select
      r.id,
      case when r.agency_facility_id is null then 'agency' else 'facility' end,
      r.credential_type_key,
      v_best_reason,
      case v_best_reason when 'MET' then 'ok'::public.compliance_severity
                         when 'EXPIRING_SOON' then 'warning'::public.compliance_severity
                         else 'blocking'::public.compliance_severity end,
      v_best_credential,
      v_best_version,
      v_best_expiry;
  end loop;
end;
$$;

create function internal.readiness_from(p_blocking integer, p_warning integer)
returns public.readiness_status
language sql
immutable
set search_path = ''
as $$
  select case when p_blocking > 0 then 'not_eligible'::public.readiness_status
              when p_warning > 0 then 'action_required'::public.readiness_status
              else 'ready'::public.readiness_status end
$$;

-- Caller may read a worker's compliance: the worker themselves (live
-- membership) or agency staff with compliance.view. A facility id must be one
-- of the worker's agency's client facilities.
create function internal.authorize_compliance_read(p_agency_worker_id uuid, p_agency_facility_id uuid)
returns public.agency_workers
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.agency_workers;
begin
  perform internal.require_identity();
  select * into w from public.agency_workers x where x.id = p_agency_worker_id;
  if w.id is null or not (
    authz.is_own_active_membership(w.membership_id)
    or authz.has_capability(w.agency_organisation_id, 'compliance.view')
  ) then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  if p_agency_facility_id is not null and not exists (
    select 1 from public.agency_facilities f
    where f.id = p_agency_facility_id and f.agency_organisation_id = w.agency_organisation_id
  ) then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  return w;
end;
$$;

create function public.evaluate_worker_compliance(
  p_agency_worker_id uuid,
  p_agency_facility_id uuid default null,
  p_as_of date default current_date
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
    from internal.evaluate_compliance(p_agency_worker_id, p_agency_facility_id, p_as_of) e
    left join public.credential_types t on t.key = e.credential_type_key
    order by case e.severity when 'blocking' then 0 when 'warning' then 1 else 2 end, t.sort_order;
end;
$$;

create function public.worker_readiness(
  p_agency_worker_id uuid,
  p_agency_facility_id uuid default null,
  p_as_of date default current_date
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
  from internal.evaluate_compliance(p_agency_worker_id, p_agency_facility_id, p_as_of) e;
  return query select internal.readiness_from(v_blocking, v_warning), v_blocking, v_warning;
end;
$$;

-- Future notification hook (not exposed): versions whose effective expiry falls
-- within the window. A later notifications stage will consume this.
create function internal.credential_versions_expiring(p_within_days integer, p_as_of date default current_date)
returns table (profile_id uuid, credential_id uuid, credential_version_id uuid, effective_expiry_date date)
language sql
stable
security definer
set search_path = ''
as $$
  select v.profile_id, v.credential_id, v.id,
         coalesce(v.expiry_date, (v.issue_date + make_interval(months => t.validity_months))::date)
  from public.credential_versions v
  join public.credentials c on c.id = v.credential_id and c.status = 'active'
  join public.credential_types t on t.key = c.credential_type_key
  where v.status = 'submitted'
    and coalesce(v.expiry_date, (v.issue_date + make_interval(months => t.validity_months))::date)
        between p_as_of and p_as_of + p_within_days
$$;

-- -----------------------------------------------------------------------------
-- Explicit facility-side compliance sharing
-- -----------------------------------------------------------------------------
create type public.compliance_share_status as enum ('active', 'revoked');

create table public.relationship_worker_compliance_shares (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  relationship_id uuid not null,
  agency_worker_id uuid not null,
  status public.compliance_share_status not null default 'active',
  shared_by_profile_id uuid references public.profiles (id) on delete set null,
  shared_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (relationship_id, agency_organisation_id)
    references public.agency_facility_relationships (id, agency_organisation_id) on delete restrict,
  foreign key (agency_worker_id, agency_organisation_id)
    references public.agency_workers (id, agency_organisation_id) on delete restrict,
  check ((status = 'revoked') = (revoked_at is not null))
);

create unique index relationship_worker_compliance_shares_one_active
  on public.relationship_worker_compliance_shares (relationship_id, agency_worker_id) where status = 'active';

create trigger relationship_worker_compliance_shares_immutable
  before update on public.relationship_worker_compliance_shares
  for each row execute function internal.enforce_immutable_columns(
    'id', 'agency_organisation_id', 'relationship_id', 'agency_worker_id', 'shared_at');
create trigger relationship_worker_compliance_shares_no_delete
  before delete on public.relationship_worker_compliance_shares
  for each row execute function internal.refuse_update_delete();

alter table public.relationship_worker_compliance_shares enable row level security;
grant select on public.relationship_worker_compliance_shares to authenticated;
-- Agency side only. Facilities read through list_shared_worker_compliance.
create policy relationship_worker_compliance_shares_select on public.relationship_worker_compliance_shares
  for select to authenticated
  using (authz.has_capability(agency_organisation_id, 'compliance.view'));

create function public.share_worker_compliance(p_relationship_id uuid, p_agency_worker_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_relationship public.agency_facility_relationships;
  v_worker public.agency_workers;
  v_share_id uuid;
begin
  select * into v_relationship from public.agency_facility_relationships r where r.id = p_relationship_id;
  perform internal.require_capability(v_relationship.agency_organisation_id, 'credential.verify');

  select * into v_worker from public.agency_workers w
  where w.id = p_agency_worker_id and w.agency_organisation_id = v_relationship.agency_organisation_id;
  if v_worker.id is null then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  if v_relationship.status <> 'active' then
    raise exception 'compliance can only be shared under an active relationship' using errcode = 'CHR09';
  end if;
  if v_worker.status = 'terminated' then
    raise exception 'terminated workers cannot be shared' using errcode = 'CHW09';
  end if;

  insert into public.relationship_worker_compliance_shares as s
    (agency_organisation_id, relationship_id, agency_worker_id, shared_by_profile_id)
  values (v_relationship.agency_organisation_id, p_relationship_id, p_agency_worker_id, v_profile_id)
  returning s.id into v_share_id;

  perform internal.record_audit_event('compliance.shared', v_relationship.agency_organisation_id, 'worker',
    p_agency_worker_id, jsonb_build_object('relationship_id', p_relationship_id, 'share_id', v_share_id));
  return v_share_id;
end;
$$;

create function public.revoke_worker_compliance_share(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.relationship_worker_compliance_shares;
begin
  perform internal.require_identity();
  select * into v_share from public.relationship_worker_compliance_shares s where s.id = p_share_id for update;
  perform internal.require_capability(v_share.agency_organisation_id, 'credential.verify');
  if v_share.status <> 'active' then
    raise exception 'share already revoked' using errcode = 'CH409';
  end if;
  update public.relationship_worker_compliance_shares s set status = 'revoked', revoked_at = now()
   where s.id = p_share_id;
  perform internal.record_audit_event('compliance.share_revoked', v_share.agency_organisation_id, 'worker',
    v_share.agency_worker_id, jsonb_build_object('relationship_id', v_share.relationship_id, 'share_id', p_share_id));
end;
$$;

-- Facility projection: readiness and reasons for explicitly shared workers
-- under an ACTIVE relationship the caller's facility is linked to. Every read
-- is audited in the facility organisation.
create function public.list_shared_worker_compliance(p_relationship_id uuid)
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
    from internal.evaluate_compliance(v_share.agency_worker_id, v_relationship.agency_facility_id, current_date) e;

    return query
      select v_share.agency_worker_id, v_share.display_name, internal.readiness_from(v_blocking, v_warning),
             coalesce(t.name, 'Worker status'), e.reason, e.severity, e.effective_expiry_date
      from internal.evaluate_compliance(v_share.agency_worker_id, v_relationship.agency_facility_id, current_date) e
      left join public.credential_types t on t.key = e.credential_type_key;
  end loop;
end;
$$;

revoke all on function
  internal.evaluate_compliance(uuid, uuid, date),
  internal.readiness_from(integer, integer),
  internal.authorize_compliance_read(uuid, uuid),
  internal.credential_versions_expiring(integer, date)
from public, anon, authenticated;

revoke all on function
  public.evaluate_worker_compliance(uuid, uuid, date),
  public.worker_readiness(uuid, uuid, date),
  public.share_worker_compliance(uuid, uuid),
  public.revoke_worker_compliance_share(uuid),
  public.list_shared_worker_compliance(uuid)
from public, anon;

grant execute on function
  public.evaluate_worker_compliance(uuid, uuid, date),
  public.worker_readiness(uuid, uuid, date),
  public.share_worker_compliance(uuid, uuid),
  public.revoke_worker_compliance_share(uuid),
  public.list_shared_worker_compliance(uuid)
to authenticated;
