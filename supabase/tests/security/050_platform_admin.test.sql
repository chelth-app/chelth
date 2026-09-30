-- =============================================================================
-- I. Platform-admin privileged path
-- Separate from membership · AAL2 · audited · no RLS bypass · operator-only grants
-- =============================================================================
begin;
\ir _helpers.psql

select plan(20);

create temp table ids as
select
  pg_temp.create_user('alice@example.test') as alice,   -- Alpha admin
  pg_temp.create_user('erin@example.test')  as erin,    -- platform admin
  pg_temp.create_user('fiona@example.test') as fiona;   -- invited facility owner
grant select on ids to authenticated;

create temp table orgs as
select pg_temp.create_org_as((select alice from ids), 'Alpha Agency', 'alpha-agency') as alpha;
grant select on orgs to authenticated;

select throws_ok(
  format($$ select pg_temp.query_as(%L, 'aal2', 'select * from public.platform_list_organisations()') $$,
    (select erin from ids)),
  'CH403', null, 'without a platform grant, platform RPCs are forbidden');
select throws_ok(
  format($$ select pg_temp.query_as(%L, 'aal2', 'select * from public.platform_list_organisations()') $$,
    (select alice from ids)),
  'CH403', null, 'an organisation owner is not a platform admin');

-- Grants are operator procedures, unreachable from the API.
select ok(not has_function_privilege('authenticated', 'internal.grant_platform_admin(uuid,text,text)', 'execute'),
  'authenticated cannot execute the grant procedure');
select throws_ok(
  format($$ select pg_temp.scalar_as(%L, 'aal2', format('select internal.grant_platform_admin(%%L, ''me'', ''please'')', %L)) $$,
    (select alice from ids), (select alice from ids)),
  '42501', null, 'a user cannot grant themselves platform admin');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', format('insert into public.platform_admins (profile_id, granted_by, grant_reason) values (%%L, ''me'', ''please'')', %L)) $$,
    (select alice from ids), (select alice from ids)),
  '42501', null, 'platform_admins cannot be written through the API');

select internal.grant_platform_admin((select erin from ids), 'Test Operator', 'test fixture');
select is(
  (select count(*)::int from public.audit_events
    where action = 'platform.admin_granted' and target_id = (select erin from ids)),
  1, 'granting platform admin is audited');

select throws_ok(
  format($$ select pg_temp.query_as(%L, 'aal1', 'select * from public.platform_list_organisations()') $$,
    (select erin from ids)),
  'CH402', null, 'platform admin at AAL1 must step up');
select is(pg_temp.count_as((select erin from ids), 'aal2',
    format('select * from public.platform_list_organisations() where organisation_id = %L', (select alpha from orgs))),
  1, 'platform admin at AAL2 can list organisations');
select is(
  (select count(*)::int from public.audit_events
    where action = 'platform.organisations_listed' and actor_profile_id = (select erin from ids) and actor_aal = 'aal2'),
  1, 'platform reads are audited with the session assurance level');

-- No silent RLS bypass: tenant tables stay invisible to the platform admin.
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select id from public.organisations'),
  0, 'a platform admin gains no RLS access to tenant organisations');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select id from public.organisation_memberships'),
  0, 'a platform admin gains no RLS access to memberships');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select id from public.platform_admins'),
  1, 'a platform admin sees only their own grant');
select is(pg_temp.count_as((select alice from ids), 'aal2', 'select id from public.platform_admins'),
  0, 'others cannot enumerate platform admins');

-- Facility creation by platform: no membership for the admin, owner invited.
create temp table g as
select pg_temp.query_as((select erin from ids), 'aal2',
  'select * from public.platform_create_organisation(''facility'', ''Gamma Hospital'', ''gamma-hospital'', ''fiona@example.test'')') -> 0 as r;
select is(
  (select count(*)::int from public.organisation_memberships where organisation_id = (select (r ->> 'organisation_id')::uuid from g)),
  0, 'the platform admin does not become a member of the created organisation');
select is(
  pg_temp.query_as((select fiona from ids), 'aal1',
    format('select * from public.accept_organisation_invite(%L)', (select r ->> 'invite_token' from g))) -> 0 ->> 'organisation_id',
  (select r ->> 'organisation_id' from g), 'the invited owner accepts the platform-issued invitation');
select is(pg_temp.scalar_as((select fiona from ids), 'aal2',
    format('select authz.has_capability(%L, ''organisation.manage'')', (select r ->> 'organisation_id' from g))),
  'true', 'the invited owner holds the facility owner role');

-- Platform status changes are effective and audited.
select lives_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', format('select public.platform_set_organisation_status(%%L, ''suspended'')', %L)) $$,
    (select erin from ids), (select alpha from orgs)),
  'a platform admin can suspend an organisation');
select is(pg_temp.scalar_as((select alice from ids), 'aal2',
    format('select authz.has_capability(%L, ''organisation.view'')', (select alpha from orgs))),
  'false', 'members of a suspended organisation lose capabilities');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', format('select public.platform_set_profile_status(%%L, ''suspended'')', %L)) $$,
    (select erin from ids), (select erin from ids)),
  'CH403', null, 'a platform admin cannot change their own account status');

-- Revocation is immediate.
select internal.revoke_platform_admin((select erin from ids), 'Test Operator', 'test complete');
select throws_ok(
  format($$ select pg_temp.query_as(%L, 'aal2', 'select * from public.platform_list_organisations()') $$,
    (select erin from ids)),
  'CH403', null, 'a revoked platform admin loses access immediately');

select * from finish();
rollback;
