-- =============================================================================
-- Migration: credential_reference_data
-- Stage:     P0-E4-S1 (credentials & compliance foundations)
--
-- Purpose
--   Migration-managed reference vocabularies for credentials and compliance:
--     jurisdictions      ISO 3166-1 countries and ISO 3166-2 subdivisions
--     credential_types   what a credential IS (shape rules, not profession logic)
--     disciplines        minimal worker classification used by requirements
--   plus credential/compliance capabilities and least-privilege role mappings.
--
--   Credential types describe their own shape: whether they need an issue
--   date, an expiry date, a number, a jurisdiction (and at which level), a
--   document, and agency verification; whether they are renewable; a default
--   validity period when no expiry date exists (e.g. annual TB screening); and
--   their scope:
--     person    portable evidence the person holds (licences, BLS …)
--     facility  facility-specific (e.g. orientation) — satisfied only by an
--               agency verification scoped to that facility
--
-- Verified by: supabase/tests/security/090_credentials.test.sql, 100_compliance.test.sql
-- =============================================================================

create type public.credential_category as enum (
  'professional_license', 'certification', 'background_screening', 'health_screening',
  'training', 'identity_work_authorization', 'competency'
);
create type public.jurisdiction_level as enum ('country', 'subdivision');
create type public.credential_jurisdiction_rule as enum ('none', 'country', 'subdivision');
create type public.credential_scope as enum ('person', 'facility');

-- -----------------------------------------------------------------------------
-- Jurisdictions
-- -----------------------------------------------------------------------------
create table public.jurisdictions (
  code text primary key check (code ~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$'),
  name text not null,
  level public.jurisdiction_level not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  parent_code text references public.jurisdictions (code) on delete restrict,
  is_active boolean not null default true,
  check (
    (level = 'country' and code = country_code and parent_code is null)
    or (level = 'subdivision' and parent_code = country_code and code like country_code || '-%')
  )
);

insert into public.jurisdictions (code, name, level, country_code) values
  ('US', 'United States', 'country', 'US'),
  ('GB', 'United Kingdom', 'country', 'GB'),
  ('IE', 'Ireland', 'country', 'IE'),
  ('CA', 'Canada', 'country', 'CA'),
  ('AU', 'Australia', 'country', 'AU');

insert into public.jurisdictions (code, name, level, country_code, parent_code)
select 'US-' || s.code, s.name, 'subdivision', 'US', 'US'
from (values
  ('AL','Alabama'),('AK','Alaska'),('AZ','Arizona'),('AR','Arkansas'),('CA','California'),
  ('CO','Colorado'),('CT','Connecticut'),('DE','Delaware'),('DC','District of Columbia'),
  ('FL','Florida'),('GA','Georgia'),('HI','Hawaii'),('ID','Idaho'),('IL','Illinois'),
  ('IN','Indiana'),('IA','Iowa'),('KS','Kansas'),('KY','Kentucky'),('LA','Louisiana'),
  ('ME','Maine'),('MD','Maryland'),('MA','Massachusetts'),('MI','Michigan'),('MN','Minnesota'),
  ('MS','Mississippi'),('MO','Missouri'),('MT','Montana'),('NE','Nebraska'),('NV','Nevada'),
  ('NH','New Hampshire'),('NJ','New Jersey'),('NM','New Mexico'),('NY','New York'),
  ('NC','North Carolina'),('ND','North Dakota'),('OH','Ohio'),('OK','Oklahoma'),('OR','Oregon'),
  ('PA','Pennsylvania'),('RI','Rhode Island'),('SC','South Carolina'),('SD','South Dakota'),
  ('TN','Tennessee'),('TX','Texas'),('UT','Utah'),('VT','Vermont'),('VA','Virginia'),
  ('WA','Washington'),('WV','West Virginia'),('WI','Wisconsin'),('WY','Wyoming')
) as s (code, name);

insert into public.jurisdictions (code, name, level, country_code, parent_code) values
  ('GB-ENG', 'England', 'subdivision', 'GB', 'GB'),
  ('GB-SCT', 'Scotland', 'subdivision', 'GB', 'GB'),
  ('GB-WLS', 'Wales', 'subdivision', 'GB', 'GB'),
  ('GB-NIR', 'Northern Ireland', 'subdivision', 'GB', 'GB');

-- -----------------------------------------------------------------------------
-- Credential types
-- -----------------------------------------------------------------------------
create table public.credential_types (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  category public.credential_category not null,
  scope public.credential_scope not null default 'person',
  jurisdiction_rule public.credential_jurisdiction_rule not null default 'none',
  requires_issue_date boolean not null default false,
  requires_expiry_date boolean not null default false,
  requires_credential_number boolean not null default false,
  requires_document boolean not null default true,
  requires_verification boolean not null default true,
  is_renewable boolean not null default true,
  -- Validity when no expiry date is recorded (e.g. annual screening), from issue date.
  validity_months integer check (validity_months is null or validity_months between 1 and 120),
  is_active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  -- A default validity only makes sense when the issue date is captured.
  check (validity_months is null or requires_issue_date)
);

insert into public.credential_types
  (key, name, category, scope, jurisdiction_rule, requires_issue_date, requires_expiry_date,
   requires_credential_number, requires_document, requires_verification, is_renewable, validity_months, sort_order)
values
  ('rn_license',          'Registered Nurse (RN) licence',          'professional_license', 'person',   'subdivision', false, true,  true,  true,  true, true, null, 10),
  ('lpn_lvn_license',     'LPN / LVN licence',                      'professional_license', 'person',   'subdivision', false, true,  true,  true,  true, true, null, 20),
  ('cna_certification',   'Certified Nursing Assistant (CNA)',      'certification',        'person',   'subdivision', false, true,  true,  true,  true, true, null, 30),
  ('bls_certification',   'Basic Life Support (BLS)',               'certification',        'person',   'none',        true,  true,  false, true,  true, true, null, 40),
  ('acls_certification',  'Advanced Cardiovascular Life Support',   'certification',        'person',   'none',        true,  true,  false, true,  true, true, null, 50),
  ('pals_certification',  'Pediatric Advanced Life Support',        'certification',        'person',   'none',        true,  true,  false, true,  true, true, null, 60),
  ('cpr_certification',   'CPR certification',                      'certification',        'person',   'none',        true,  true,  false, true,  true, true, null, 70),
  ('tb_screening',        'TB screening',                           'health_screening',     'person',   'none',        true,  false, false, true,  true, true, 12,   80),
  ('background_check',    'Background check',                       'background_screening', 'person',   'country',     true,  false, false, true,  true, true, null, 90),
  ('drug_screening',      'Drug screening',                         'health_screening',     'person',   'none',        true,  false, false, true,  true, true, 12,   100),
  ('facility_orientation','Facility orientation',                   'training',             'facility', 'none',        true,  false, false, false, true, true, null, 110);

-- -----------------------------------------------------------------------------
-- Disciplines (minimal classification for requirements)
-- -----------------------------------------------------------------------------
create table public.disciplines (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null
);

insert into public.disciplines (key, name, sort_order) values
  ('rn', 'Registered Nurse (RN)', 10),
  ('lpn_lvn', 'LPN / LVN', 20),
  ('cna', 'Certified Nursing Assistant (CNA)', 30),
  ('ma', 'Medical Assistant (MA)', 40),
  ('hha', 'Home Health Aide (HHA)', 50),
  ('pt', 'Physical Therapist (PT)', 60),
  ('ot', 'Occupational Therapist (OT)', 70),
  ('rt', 'Respiratory Therapist (RT)', 80);

alter table public.jurisdictions enable row level security;
alter table public.credential_types enable row level security;
alter table public.disciplines enable row level security;
grant select on public.jurisdictions, public.credential_types, public.disciplines to authenticated;
create policy jurisdictions_select on public.jurisdictions for select to authenticated using (true);
create policy credential_types_select on public.credential_types for select to authenticated using (true);
create policy disciplines_select on public.disciplines for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- Capabilities
--   credential.view                  shared credential metadata + this agency's verification status (no documents, no numbers)
--   credential.review (AAL2)         open documents and numbers of shared credentials
--   credential.verify (AAL2)         record verification outcomes; present compliance to facilities
--   credential.requirements.view     view baseline/facility requirements
--   credential.requirements.manage (AAL2)
--   compliance.view                  derived readiness and reasons (no credential detail)
-- Self-management of one's own credentials is an IDENTITY rule, not a capability.
-- -----------------------------------------------------------------------------
insert into public.capabilities (key, description, is_privileged) values
  ('credential.view',                'View shared worker credentials and this agency''s verification status.', false),
  ('credential.review',              'Open documents and numbers of shared worker credentials.',               true),
  ('credential.verify',              'Record credential verification outcomes.',                               true),
  ('credential.requirements.view',   'View credential requirements.',                                          false),
  ('credential.requirements.manage', 'Create, change and deactivate credential requirements.',                 true),
  ('compliance.view',                'View derived worker readiness and its reasons.',                         false);

insert into public.role_capabilities (role_key, capability_key)
select role_key, capability_key
from (values
  ('agency.admin', 'credential.view'), ('agency.admin', 'credential.review'),
  ('agency.admin', 'credential.verify'), ('agency.admin', 'credential.requirements.view'),
  ('agency.admin', 'credential.requirements.manage'), ('agency.admin', 'compliance.view'),

  ('agency.credentialing_officer', 'credential.view'), ('agency.credentialing_officer', 'credential.review'),
  ('agency.credentialing_officer', 'credential.verify'), ('agency.credentialing_officer', 'credential.requirements.view'),
  ('agency.credentialing_officer', 'credential.requirements.manage'), ('agency.credentialing_officer', 'compliance.view'),

  ('agency.operations_manager', 'credential.view'), ('agency.operations_manager', 'credential.requirements.view'),
  ('agency.operations_manager', 'compliance.view'),

  ('agency.recruiter', 'credential.view'), ('agency.recruiter', 'compliance.view'),

  ('agency.scheduler', 'compliance.view'),

  -- Facility side: effective only through explicitly shared, relationship-scoped projections.
  ('facility.admin', 'credential.view'),
  ('facility.scheduler', 'credential.view')
) as mapping (role_key, capability_key);
