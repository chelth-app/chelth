-- =============================================================================
-- Migration: shift_vocabulary_and_engine_scope
-- Stage:     P0-E5-S1 (shift requests & assignment foundations)
--
-- Purpose
--   1. Shift/assignment capabilities and least-privilege role mappings.
--      None is privileged (AAL2): shift and assignment work is high-frequency
--      operational work that changes no person, client record, commercial
--      term or credential decision, and every assignment is independently
--      gated server-side by compliance, tenancy, capacity and schedule checks.
--
--        agency.admin, agency.operations_manager, agency.scheduler
--            shift.view · shift.create · shift.manage · assignment.view · assignment.manage
--        agency.recruiter, agency.credentialing_officer, agency.finance
--            none (recruiting/credentialing do not schedule; billing is a later stage)
--        agency.healthcare_worker
--            none — a worker's own assignments are an identity rule, not a capability
--        facility.admin, facility.scheduler
--            shift.view · shift.request — effective ONLY through an explicitly
--            linked relationship (authz.has_relationship_capability)
--        facility.supervisor
--            shift.view (who is coming) — relationship-scoped
--
--   2. Controlled vocabularies (enums) for shift status/source, assignment
--      status, cancellation reasons and assignment block reasons.
--
--   3. Compliance engine discipline scope: internal.evaluate_compliance gains a
--      4-argument form that evaluates requirements for ONE discipline (the
--      shift's requested discipline). The 3-argument form is redefined to
--      delegate to it, so there is still exactly one implementation of the
--      credential rules.
--
--   4. Supporting composite keys for shift/assignment integrity.
--
-- Verified by: supabase/tests/security/030_roles_capabilities.test.sql,
--              110_shifts.test.sql, 120_assignments.test.sql
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

insert into public.capabilities (key, description, is_privileged) values
  ('shift.view',        'View shifts and their fill progress.',                                    false),
  ('shift.create',      'Create shifts for the agency''s client facilities.',                      false),
  ('shift.manage',      'Open, update, cancel and complete shifts; add internal shift notes.',     false),
  ('shift.request',     'Submit staffing requests to a partner agency (facility side).',           false),
  ('assignment.view',   'View worker assignments and assignment decisions.',                       false),
  ('assignment.manage', 'Assign workers to shifts and cancel assignments.',                        false);

insert into public.role_capabilities (role_key, capability_key)
select role_key, capability_key
from (values
  ('agency.admin', 'shift.view'), ('agency.admin', 'shift.create'), ('agency.admin', 'shift.manage'),
  ('agency.admin', 'assignment.view'), ('agency.admin', 'assignment.manage'),

  ('agency.operations_manager', 'shift.view'), ('agency.operations_manager', 'shift.create'),
  ('agency.operations_manager', 'shift.manage'), ('agency.operations_manager', 'assignment.view'),
  ('agency.operations_manager', 'assignment.manage'),

  ('agency.scheduler', 'shift.view'), ('agency.scheduler', 'shift.create'), ('agency.scheduler', 'shift.manage'),
  ('agency.scheduler', 'assignment.view'), ('agency.scheduler', 'assignment.manage'),

  ('facility.admin', 'shift.view'), ('facility.admin', 'shift.request'),
  ('facility.scheduler', 'shift.view'), ('facility.scheduler', 'shift.request'),
  ('facility.supervisor', 'shift.view')
) as mapping (role_key, capability_key);

-- -----------------------------------------------------------------------------
-- Vocabularies
-- -----------------------------------------------------------------------------
-- Stored, business-authoritative states only. "unfilled / partially filled /
-- filled" are DERIVED from active assignments vs requested headcount.
create type public.shift_status as enum ('draft', 'submitted', 'open', 'cancelled', 'completed');
create type public.shift_source as enum ('agency', 'facility');
create type public.shift_cancellation_reason as enum (
  'facility_cancelled', 'staffing_no_longer_needed', 'entered_in_error', 'relationship_suspended', 'other'
);
create type public.assignment_status as enum ('assigned', 'accepted', 'declined', 'cancelled');
create type public.assignment_cancellation_reason as enum (
  'shift_cancelled', 'worker_unavailable', 'compliance_change', 'entered_in_error', 'relationship_suspended', 'other'
);
-- Declaration order = reporting priority (the first element is the primary code).
create type public.assignment_block_reason as enum (
  'ASSIGNMENT_ALREADY_EXISTS', 'SHIFT_FULL', 'WORKER_NOT_ACTIVE', 'DISCIPLINE_MISMATCH',
  'WORKER_NOT_ELIGIBLE', 'WORKER_SCHEDULE_CONFLICT'
);
create type public.assignment_decision_outcome as enum ('allowed', 'refused');

-- -----------------------------------------------------------------------------
-- Composite keys used by shift/assignment foreign keys
-- -----------------------------------------------------------------------------
alter table public.agency_facility_relationships
  add constraint agency_facility_relationships_id_agency_facility_key
  unique (id, agency_organisation_id, agency_facility_id);

alter table public.agency_workers
  add constraint agency_workers_id_agency_profile_key unique (id, agency_organisation_id, profile_id);

-- -----------------------------------------------------------------------------
-- Compliance engine: discipline-scoped evaluation
--
-- p_discipline_key NULL  → requirements for ALL of the worker's disciplines
--                          (worker/agency readiness views; unchanged behaviour)
-- p_discipline_key 'cna' → baseline/facility requirements with no discipline
--                          or discipline 'cna' only (assignment to a CNA shift).
--                          DISCIPLINE_NOT_SET is not emitted: the assignment
--                          gate checks the discipline itself (DISCIPLINE_MISMATCH).
-- -----------------------------------------------------------------------------
create function internal.evaluate_compliance(
  p_agency_worker_id uuid,
  p_agency_facility_id uuid,
  p_as_of date,
  p_discipline_key text
)
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

  if p_discipline_key is null
     and not exists (select 1 from public.agency_worker_disciplines d where d.agency_worker_id = w.id)
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
      and (
        q.discipline_key is null
        or (p_discipline_key is not null and q.discipline_key = p_discipline_key)
        or (p_discipline_key is null and exists (
          select 1 from public.agency_worker_disciplines d
          where d.agency_worker_id = w.id and d.discipline_key = q.discipline_key))
      )
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

-- The original 3-argument form now delegates: one implementation of the rules.
create or replace function internal.evaluate_compliance(
  p_agency_worker_id uuid,
  p_agency_facility_id uuid,
  p_as_of date
)
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
language sql
stable
security definer
set search_path = ''
as $$
  select * from internal.evaluate_compliance(p_agency_worker_id, p_agency_facility_id, p_as_of, null::text)
$$;

revoke all on function internal.evaluate_compliance(uuid, uuid, date, text) from public, anon, authenticated;
revoke all on function internal.evaluate_compliance(uuid, uuid, date) from public, anon, authenticated;
