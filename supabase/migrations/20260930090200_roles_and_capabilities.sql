-- =============================================================================
-- Migration: roles_and_capabilities
-- Stage:     P0-E3-S2
--
-- Purpose
--   Capability-based authorization:
--     capabilities        namespaced permission keys (organisation.view …)
--     roles               named bundles, each bound to ONE organisation type
--     role_capabilities   which capabilities each role grants
--     membership_roles    role assignments on a membership (history-preserving)
--
--   Code and policies check CAPABILITIES, never role names. Roles exist so
--   administrators can grant sensible bundles.
--
--   is_privileged capabilities require an AAL2 (MFA) session to be exercised;
--   enforcement lives in authz.has_capability().
--
--   Reference rows are defined here (versioned), never in seed.sql.
--   Only capabilities needed by this stage are created; future domain
--   capabilities (shift.create, timesheet.approve …) are added by the stage
--   that implements them.
--
-- Cross-tenant integrity (declarative, not RLS-dependent):
--   membership_roles (membership_id, organisation_id)   → memberships (id, organisation_id)
--   membership_roles (organisation_id, organisation_type) → organisations (id, type)
--   membership_roles (role_key, organisation_type)       → roles (key, organisation_type)
--   ⇒ a role assignment can only reference a membership of the same
--     organisation, and only a role defined for that organisation's type.
--
-- Verified by: supabase/tests/security/030_roles_capabilities.test.sql
-- =============================================================================

create table public.capabilities (
  key text primary key check (key ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  description text not null,
  is_privileged boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.capabilities is
  'Namespaced permission vocabulary. Privileged capabilities require an AAL2 session.';

create table public.roles (
  key text primary key check (key ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  organisation_type public.organisation_type not null,
  name text not null,
  description text not null,
  -- The role granted to the creator of a new organisation of this type.
  is_owner_role boolean not null default false,
  created_at timestamptz not null default now(),
  unique (key, organisation_type),
  -- The key's namespace must match the organisation type (agency.*, facility.*).
  check (split_part(key, '.', 1) = organisation_type::text)
);

create unique index roles_one_owner_role_per_type
  on public.roles (organisation_type) where is_owner_role;

comment on table public.roles is
  'Named capability bundles, each valid for exactly one organisation type.';

create table public.role_capabilities (
  role_key text not null references public.roles (key) on delete restrict,
  capability_key text not null references public.capabilities (key) on delete restrict,
  primary key (role_key, capability_key)
);

-- Reference data is readable by any signed-in user (needed for role pickers).
alter table public.capabilities enable row level security;
alter table public.roles enable row level security;
alter table public.role_capabilities enable row level security;
grant select on public.capabilities, public.roles, public.role_capabilities to authenticated;

-- -----------------------------------------------------------------------------
-- Reference data
-- -----------------------------------------------------------------------------
insert into public.capabilities (key, description, is_privileged) values
  ('organisation.view',   'View the organisation profile.',                          false),
  ('organisation.manage', 'Change organisation settings and status.',                true),
  ('membership.view',     'View members of the organisation and their roles.',       false),
  ('membership.invite',   'Invite people to join the organisation.',                 true),
  ('membership.manage',   'Suspend, reinstate or revoke memberships.',               true),
  ('role.assign',         'Assign and revoke roles on memberships.',                 true),
  ('audit.view',          'View the organisation audit history.',                    true);

insert into public.roles (key, organisation_type, name, description, is_owner_role) values
  ('agency.admin',                 'agency',   'Agency Admin',          'Full administration of the agency.',                 true),
  ('agency.operations_manager',    'agency',   'Operations Manager',    'Manages people and access for agency operations.',   false),
  ('agency.recruiter',             'agency',   'Recruiter',             'Recruits and invites people to the agency.',         false),
  ('agency.scheduler',             'agency',   'Scheduler',             'Coordinates staffing schedules.',                    false),
  ('agency.credentialing_officer', 'agency',   'Credentialing Officer', 'Reviews professional credentials and compliance.',   false),
  ('agency.finance',               'agency',   'Finance',               'Manages rates, invoicing and payroll exports.',      false),
  ('agency.healthcare_worker',     'agency',   'Healthcare Worker',     'A healthcare professional working with the agency.', false),
  ('facility.admin',               'facility', 'Facility Admin',        'Full administration of the facility.',               true),
  ('facility.scheduler',           'facility', 'Facility Scheduler',    'Requests and coordinates staffing for the facility.', false),
  ('facility.supervisor',          'facility', 'Facility Supervisor',   'Supervises staff on shift at the facility.',         false);

insert into public.role_capabilities (role_key, capability_key)
select role_key, capability_key
from (values
  -- Owner roles hold every organisation-scoped capability.
  ('agency.admin', 'organisation.view'), ('agency.admin', 'organisation.manage'),
  ('agency.admin', 'membership.view'),   ('agency.admin', 'membership.invite'),
  ('agency.admin', 'membership.manage'), ('agency.admin', 'role.assign'),
  ('agency.admin', 'audit.view'),
  ('facility.admin', 'organisation.view'), ('facility.admin', 'organisation.manage'),
  ('facility.admin', 'membership.view'),   ('facility.admin', 'membership.invite'),
  ('facility.admin', 'membership.manage'), ('facility.admin', 'role.assign'),
  ('facility.admin', 'audit.view'),
  -- People administration without organisation settings.
  ('agency.operations_manager', 'organisation.view'), ('agency.operations_manager', 'membership.view'),
  ('agency.operations_manager', 'membership.invite'), ('agency.operations_manager', 'membership.manage'),
  ('agency.operations_manager', 'role.assign'),       ('agency.operations_manager', 'audit.view'),
  -- Recruiters may invite, bounded by the capability ceiling (only roles
  -- whose capabilities they themselves hold).
  ('agency.recruiter', 'organisation.view'), ('agency.recruiter', 'membership.view'),
  ('agency.recruiter', 'membership.invite'),
  ('agency.scheduler', 'organisation.view'), ('agency.scheduler', 'membership.view'),
  ('agency.credentialing_officer', 'organisation.view'), ('agency.credentialing_officer', 'membership.view'),
  ('agency.finance', 'organisation.view'), ('agency.finance', 'membership.view'),
  ('agency.healthcare_worker', 'organisation.view'),
  ('facility.scheduler', 'organisation.view'), ('facility.scheduler', 'membership.view'),
  ('facility.supervisor', 'organisation.view'), ('facility.supervisor', 'membership.view')
) as mapping (role_key, capability_key);

-- -----------------------------------------------------------------------------
-- membership_roles — role assignments with preserved history
-- -----------------------------------------------------------------------------
create table public.membership_roles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  organisation_type public.organisation_type not null,
  membership_id uuid not null,
  role_key text not null,
  granted_at timestamptz not null default now(),
  granted_by_profile_id uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  revoked_by_profile_id uuid references public.profiles (id) on delete set null,
  foreign key (membership_id, organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  foreign key (organisation_id, organisation_type)
    references public.organisations (id, type) on delete restrict,
  foreign key (role_key, organisation_type)
    references public.roles (key, organisation_type) on delete restrict,
  check (revoked_at is null or revoked_at >= granted_at),
  check (revoked_by_profile_id is null or revoked_at is not null)
);

comment on table public.membership_roles is
  'Role assignments. Revocation sets revoked_at; rows are never deleted or rewritten.';

-- At most one ACTIVE assignment of a given role per membership.
create unique index membership_roles_one_active_role
  on public.membership_roles (membership_id, role_key) where revoked_at is null;
create index membership_roles_organisation_id_idx on public.membership_roles (organisation_id);

-- History protection: the only permitted update is revoking an active
-- assignment (revoked_at/revoked_by from NULL to a value). Deletes are refused.
create function internal.protect_membership_role_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'role assignments are never deleted; revoke instead' using errcode = 'CH409';
  end if;

  if old.revoked_at is not null then
    raise exception 'revoked role assignments are immutable' using errcode = 'CH409';
  end if;

  if new.id is distinct from old.id
     or new.organisation_id is distinct from old.organisation_id
     or new.organisation_type is distinct from old.organisation_type
     or new.membership_id is distinct from old.membership_id
     or new.role_key is distinct from old.role_key
     or new.granted_at is distinct from old.granted_at
     or new.granted_by_profile_id is distinct from old.granted_by_profile_id then
    raise exception 'role assignments may only be revoked' using errcode = 'CH409';
  end if;

  return new;
end;
$$;

create trigger membership_roles_protect_history
  before update or delete on public.membership_roles
  for each row execute function internal.protect_membership_role_history();

alter table public.membership_roles enable row level security;
grant select on public.membership_roles to authenticated;
