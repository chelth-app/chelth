-- =============================================================================
-- Security baseline invariants (docs/security/SECURITY_INVARIANTS.md).
--
-- Schema-wide rules that must hold for every current AND future object:
--   RLS on every table · no anon access · pinned search_path on every function
--   explicit allow-lists for every function an API role may execute
--   no direct writes except the profile display name · no public buckets
--   deny-by-default privileges for new objects
--
-- Adding an RPC or helper REQUIRES updating the allow-lists below in the same
-- pull request — that is the review checkpoint. A failure here blocks release.
-- =============================================================================
begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

-- Application functions (excludes extension-owned functions).
create temp view app_functions as
select p.oid, n.nspname as schema, p.proname as name,
       p.oid::regprocedure::text as signature, p.prosecdef, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'authz', 'internal')
  and not exists (
    select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
  );

-- ---------------------------------------------------------------------------
-- O / 4 / 5 — tables
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'authz', 'internal')
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity),
  0,
  'every application table has row level security enabled'
);

select is(
  (select count(*)::int
     from information_schema.role_table_grants
    where table_schema in ('public', 'authz', 'internal')
      and grantee in ('anon', 'PUBLIC')),
  0,
  'anon and PUBLIC hold no table privileges'
);

select is(
  (select coalesce(array_agg(distinct privilege_type::text order by privilege_type::text), '{}')
     from information_schema.role_table_grants
    where table_schema in ('public', 'authz', 'internal')
      and grantee = 'authenticated'),
  array['SELECT'],
  'authenticated holds only SELECT at table level (all writes go through RPCs)'
);

select is(
  (select coalesce(array_agg(table_name || '.' || column_name order by table_name, column_name), '{}')
     from information_schema.column_privileges
    where table_schema in ('public', 'authz', 'internal')
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  array['profiles.display_name'],
  'the only direct write is a user editing their own display name'
);

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema in ('authz', 'internal') and grantee in ('authenticated', 'anon')),
  0,
  'no API role holds privileges on tables in private schemas'
);

-- ---------------------------------------------------------------------------
-- N — schemas
-- ---------------------------------------------------------------------------
select ok(not has_schema_privilege('anon', 'authz', 'usage'), 'anon cannot use schema authz');
select ok(not has_schema_privilege('anon', 'internal', 'usage'), 'anon cannot use schema internal');
select ok(not has_schema_privilege('authenticated', 'internal', 'usage'), 'authenticated cannot use schema internal');

-- ---------------------------------------------------------------------------
-- M — every application function pins search_path
-- ---------------------------------------------------------------------------
select is(
  (select coalesce(array_agg(signature order by signature collate "C"), '{}') from app_functions
    where not exists (
      select 1 from unnest(coalesce(proconfig, '{}')) cfg where cfg like 'search_path=%'
    )),
  '{}'::text[],
  'every application function sets an explicit search_path'
);

select is(
  (select coalesce(array_agg(signature order by signature collate "C"), '{}') from app_functions
    where prosecdef
      and not exists (select 1 from unnest(proconfig) cfg where cfg = 'search_path=""')),
  '{}'::text[],
  'every SECURITY DEFINER function uses an empty search_path'
);

-- ---------------------------------------------------------------------------
-- L — function execute grants (explicit allow-lists)
-- ---------------------------------------------------------------------------
select is(
  (select coalesce(array_agg(signature order by signature collate "C"), '{}') from app_functions
    where has_function_privilege('anon', oid, 'execute')),
  '{}'::text[],
  'anon can execute no application function'
);

select is(
  (select coalesce(array_agg(signature order by signature collate "C"), '{}') from app_functions
    where schema = 'public' and has_function_privilege('authenticated', oid, 'execute')),
  array[
    'accept_organisation_invite(text)',
    'accept_shift_assignment(uuid)',
    'add_agency_worker_note(uuid,text)',
    'add_shift_internal_note(uuid,text)',
    'assign_membership_role(uuid,text)',
    'assign_worker_to_shift(uuid,uuid)',
    'authorize_credential_document_access(uuid,uuid)',
    'begin_credential_document_upload(uuid,text,integer)',
    'cancel_shift(uuid,shift_cancellation_reason)',
    'cancel_shift_assignment(uuid,assignment_cancellation_reason)',
    'complete_credential_document_upload(uuid,text,boolean)',
    'complete_shift(uuid)',
    'create_agency_facility(uuid,text,text,text,text,text,text,text,text,text,text,text,text)',
    'create_credential(text,text,text,text,date,date)',
    'create_credential_requirement(uuid,text,uuid,text,boolean,integer,integer,text)',
    'create_credential_version(uuid,date,date)',
    'create_facility_location(uuid,text,text,text,text,text)',
    'create_facility_relationship(uuid)',
    'create_organisation(organisation_type,text,text)',
    'create_organisation_invite(uuid,text,text)',
    'create_shift(uuid,uuid,text,date,time without time zone,time without time zone,integer,text,text,boolean)',
    'decline_shift_assignment(uuid)',
    'evaluate_worker_compliance(uuid,uuid,date)',
    'list_agency_shifts(uuid,shift_status,uuid,date,date)',
    'list_agency_worker_credentials(uuid)',
    'list_assignment_readiness(uuid,uuid,timestamp with time zone,timestamp with time zone)',
    'list_facility_request_options(uuid)',
    'list_facility_shift_assignments(uuid)',
    'list_facility_shifts(uuid,uuid)',
    'list_my_shift_assignments(uuid)',
    'list_organisation_invites(uuid)',
    'list_partner_agency_relationships(uuid)',
    'list_shared_worker_compliance(uuid)',
    'list_shift_candidates(uuid)',
    'my_capabilities(uuid)',
    'open_shift(uuid)',
    'platform_create_organisation(organisation_type,text,text,text)',
    'platform_link_agency_facility(uuid,uuid)',
    'platform_list_organisations()',
    'platform_set_organisation_status(uuid,organisation_status)',
    'platform_set_profile_status(uuid,profile_status)',
    'preview_organisation_invite(text)',
    'record_credential_verification(uuid,uuid,verification_outcome,verification_rejection_reason,uuid)',
    'record_organisation_invite_delivery(uuid,invite_delivery_status,text,text,text)',
    'resend_organisation_invite(uuid)',
    'revoke_credential_share(uuid)',
    'revoke_membership_role(uuid,text)',
    'revoke_organisation_invite(uuid)',
    'revoke_worker_compliance_share(uuid)',
    'set_agency_facility_status(uuid,facility_status)',
    'set_agency_worker_discipline(uuid,text,boolean)',
    'set_agency_worker_status(uuid,worker_status)',
    'set_facility_relationship_status(uuid,relationship_status)',
    'set_membership_status(uuid,membership_status)',
    'share_credential(uuid,uuid)',
    'share_worker_compliance(uuid,uuid)',
    'submit_credential_version(uuid)',
    'submit_facility_shift_request(uuid,uuid,text,date,time without time zone,time without time zone,integer,text,text)',
    'update_agency_facility(uuid,text,text,text,text,text,text,text,text,text,text,text,text)',
    'update_agency_worker(uuid,text)',
    'update_credential_requirement(uuid,boolean,integer,integer,requirement_status)',
    'update_shift(uuid,uuid,text,date,time without time zone,time without time zone,integer,text,text)',
    'withdraw_credential(uuid)',
    'withdraw_credential_version(uuid)',
    'worker_readiness(uuid,uuid,date)'
  ],
  'authenticated can execute exactly the approved public RPCs'
);

select is(
  (select coalesce(array_agg(signature order by signature collate "C"), '{}') from app_functions
    where schema = 'authz' and has_function_privilege('authenticated', oid, 'execute')),
  array[
    'authz.can_access_shared_credential(uuid,text)',
    'authz.can_delete_credential_object(text)',
    'authz.can_read_credential_document(uuid)',
    'authz.can_read_credential_object(text)',
    'authz.can_upload_credential_object(text)',
    'authz.can_view_profile(uuid)',
    'authz.current_aal()',
    'authz.current_profile_id()',
    'authz.has_capability(uuid,text)',
    'authz.has_relationship_capability(uuid,text)',
    'authz.is_org_member(uuid)',
    'authz.is_own_active_membership(uuid)',
    'authz.is_own_active_worker(uuid)',
    'authz.is_own_membership(uuid)',
    'authz.is_platform_admin()'
  ],
  'authenticated can execute exactly the approved policy helpers'
);

select is(
  (select coalesce(array_agg(signature order by signature collate "C"), '{}') from app_functions
    where schema = 'internal'
      and (has_function_privilege('authenticated', oid, 'execute')
           or has_function_privilege('service_role', oid, 'execute'))),
  '{}'::text[],
  'no API role can execute internal functions'
);

-- ---------------------------------------------------------------------------
-- 12 — storage
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from storage.buckets where public),
  0,
  'no storage bucket is public'
);

-- ---------------------------------------------------------------------------
-- 4 — default privileges (migration 20260929232049_security_baseline)
-- ---------------------------------------------------------------------------
create table public.__baseline_probe (id int primary key);
create sequence public.__baseline_probe_seq;
create function public.__baseline_probe_fn() returns int
  language sql as 'select 1';

select ok(
  not has_table_privilege('anon', 'public.__baseline_probe', 'select'),
  'new tables are not readable by anon by default'
);
select ok(
  not has_table_privilege('authenticated', 'public.__baseline_probe', 'select,insert,update,delete'),
  'new tables are not accessible to authenticated by default'
);
select ok(
  not has_sequence_privilege('authenticated', 'public.__baseline_probe_seq', 'usage'),
  'new sequences are not usable by authenticated by default'
);
select ok(
  not has_function_privilege('anon', 'public.__baseline_probe_fn()', 'execute'),
  'new functions are not executable by anon by default'
);
select ok(
  not has_function_privilege('authenticated', 'public.__baseline_probe_fn()', 'execute'),
  'new functions are not executable by authenticated by default'
);

select * from finish();
rollback;
