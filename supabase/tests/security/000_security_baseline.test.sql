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
    'add_agency_worker_note(uuid,text)',
    'assign_membership_role(uuid,text)',
    'create_agency_facility(uuid,text,text,text,text,text,text,text,text,text,text,text,text)',
    'create_facility_location(uuid,text,text,text,text,text)',
    'create_facility_relationship(uuid)',
    'create_organisation(organisation_type,text,text)',
    'create_organisation_invite(uuid,text,text)',
    'list_organisation_invites(uuid)',
    'list_partner_agency_relationships(uuid)',
    'my_capabilities(uuid)',
    'platform_create_organisation(organisation_type,text,text,text)',
    'platform_link_agency_facility(uuid,uuid)',
    'platform_list_organisations()',
    'platform_set_organisation_status(uuid,organisation_status)',
    'platform_set_profile_status(uuid,profile_status)',
    'preview_organisation_invite(text)',
    'record_organisation_invite_delivery(uuid,invite_delivery_status,text,text,text)',
    'resend_organisation_invite(uuid)',
    'revoke_membership_role(uuid,text)',
    'revoke_organisation_invite(uuid)',
    'set_agency_facility_status(uuid,facility_status)',
    'set_agency_worker_status(uuid,worker_status)',
    'set_facility_relationship_status(uuid,relationship_status)',
    'set_membership_status(uuid,membership_status)',
    'update_agency_facility(uuid,text,text,text,text,text,text,text,text,text,text,text,text)',
    'update_agency_worker(uuid,text)'
  ],
  'authenticated can execute exactly the approved public RPCs'
);

select is(
  (select coalesce(array_agg(signature order by signature collate "C"), '{}') from app_functions
    where schema = 'authz' and has_function_privilege('authenticated', oid, 'execute')),
  array[
    'authz.can_view_profile(uuid)',
    'authz.current_aal()',
    'authz.current_profile_id()',
    'authz.has_capability(uuid,text)',
    'authz.has_relationship_capability(uuid,text)',
    'authz.is_org_member(uuid)',
    'authz.is_own_active_membership(uuid)',
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
