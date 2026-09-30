-- =============================================================================
-- Migration: domain_capabilities
-- Stage:     P0-E3-S3 (workforce, facility & relationship foundations)
--
-- Purpose
--   First healthcare-domain capabilities and their least-privilege role
--   mappings. Only capabilities used by this stage are added; shift.*,
--   credential.*, timesheet.*, invoice.* etc. are added by the stages that
--   implement them.
--
--   Privileged (AAL2) = changes to people, client records or commercial
--   relationships. Viewing is not privileged.
--
--   Mapping rationale (docs/architecture/AUTHORIZATION_MODEL.md §3):
--     agency.admin                 everything
--     agency.operations_manager    workers + notes + facilities; relationships view-only
--                                  (commercial state is an owner decision)
--     agency.recruiter             workers + notes (onboarding); no client data
--     agency.scheduler             view workers, facilities, relationships
--     agency.credentialing_officer view workers only (credentials arrive later)
--     agency.finance               view facilities and relationships (billing later)
--     agency.healthcare_worker     NO domain capabilities — self-access is a
--                                  separate identity rule, not a capability
--     facility.admin/.scheduler    relationship.view, effective only through
--                                  explicitly linked relationships
--     facility.supervisor          none yet
--
-- Also adds unique (id, organisation_id, profile_id) on memberships so domain
-- rows can bind membership, organisation AND person with one composite FK.
--
-- Verified by: supabase/tests/security/070_workforce.test.sql,
--              080_facilities_relationships.test.sql
-- =============================================================================

insert into public.capabilities (key, description, is_privileged) values
  ('worker.view',         'View agency worker records (status, reference, dates).',          false),
  ('worker.manage',       'Change worker records and worker status.',                        true),
  ('worker.notes.view',   'Read internal agency notes about workers.',                       false),
  ('worker.notes.manage', 'Add internal agency notes about workers.',                        true),
  ('facility.view',       'View client facility records and their locations.',               false),
  ('facility.manage',     'Create and update client facility records and locations.',        true),
  ('relationship.view',   'View agency–facility relationships.',                             false),
  ('relationship.manage', 'Create and change the state of agency–facility relationships.',   true);

insert into public.role_capabilities (role_key, capability_key)
select role_key, capability_key
from (values
  ('agency.admin', 'worker.view'), ('agency.admin', 'worker.manage'),
  ('agency.admin', 'worker.notes.view'), ('agency.admin', 'worker.notes.manage'),
  ('agency.admin', 'facility.view'), ('agency.admin', 'facility.manage'),
  ('agency.admin', 'relationship.view'), ('agency.admin', 'relationship.manage'),

  ('agency.operations_manager', 'worker.view'), ('agency.operations_manager', 'worker.manage'),
  ('agency.operations_manager', 'worker.notes.view'), ('agency.operations_manager', 'worker.notes.manage'),
  ('agency.operations_manager', 'facility.view'), ('agency.operations_manager', 'facility.manage'),
  ('agency.operations_manager', 'relationship.view'),

  ('agency.recruiter', 'worker.view'), ('agency.recruiter', 'worker.manage'),
  ('agency.recruiter', 'worker.notes.view'), ('agency.recruiter', 'worker.notes.manage'),

  ('agency.scheduler', 'worker.view'), ('agency.scheduler', 'facility.view'),
  ('agency.scheduler', 'relationship.view'),

  ('agency.credentialing_officer', 'worker.view'),

  ('agency.finance', 'facility.view'), ('agency.finance', 'relationship.view'),

  ('facility.admin', 'relationship.view'),
  ('facility.scheduler', 'relationship.view')
) as mapping (role_key, capability_key);

alter table public.organisation_memberships
  add constraint organisation_memberships_id_org_profile_key unique (id, organisation_id, profile_id);
