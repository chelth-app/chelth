-- =============================================================================
-- B. Organisation isolation · C. Membership isolation · D. Cross-tenant denial
-- F. No unauthorized membership creation · multi-organisation identities
-- Membership lifecycle and AAL2 step-up for membership administration.
-- =============================================================================
begin;
\ir _helpers.psql

select plan(40);

create temp table ids as
select
  pg_temp.create_user('alice@example.test') as alice,          -- owner of Alpha
  pg_temp.create_user('bob@example.test')   as bob,            -- owner of Beta
  pg_temp.create_user('carol@example.test') as carol,          -- Alpha recruiter + Beta worker
  pg_temp.create_user('dave@example.test')  as dave,           -- no memberships
  pg_temp.create_user('una@example.test', false) as una,       -- unverified email
  pg_temp.create_user('nora@example.test') as nora;             -- never joins anything
grant select on ids to authenticated, anon;

create temp table orgs as
select
  pg_temp.create_org_as((select alice from ids), 'Alpha Agency', 'alpha-agency') as alpha,
  pg_temp.create_org_as((select bob from ids),   'Beta Agency',  'beta-agency')  as beta;
grant select on orgs to authenticated, anon;

select pg_temp.add_member((select alpha from orgs), (select carol from ids), 'agency.recruiter');
select pg_temp.add_member((select beta from orgs),  (select carol from ids), 'agency.healthcare_worker');

-- ---------------------------------------------------------------------------
-- Creation primitive
-- ---------------------------------------------------------------------------
select is(
  (select status::text from public.organisation_memberships
    where organisation_id = (select alpha from orgs) and profile_id = (select alice from ids)),
  'active', 'the creator receives an active membership');
select is(
  (select array_agg(role_key) from public.membership_roles
    where membership_id = pg_temp.membership_of((select alpha from orgs), (select alice from ids))
      and revoked_at is null),
  array['agency.admin'], 'the creator receives exactly the server-derived owner role');

select throws_ok(
  format($$ select pg_temp.scalar_as(%L, 'aal2', 'select public.create_organisation(''agency'', ''Nope Ltd'', ''nope-ltd'')') $$,
    (select una from ids)),
  'CH403', null, 'an unverified email cannot create an organisation');
select throws_ok(
  format($$ select pg_temp.scalar_as(%L, 'aal2', 'select public.create_organisation(''facility'', ''Self Facility'', ''self-facility'')') $$,
    (select dave from ids)),
  'CH403', null, 'facility organisations cannot be self-created');
select throws_ok(
  format($$ select pg_temp.scalar_as(%L, 'aal1', 'select public.create_organisation(''agency'', ''Dup'', ''alpha-agency'')') $$,
    (select dave from ids)),
  '23505', null, 'organisation slugs are unique');
select throws_ok(
  format($$ select pg_temp.scalar_as(%L, 'aal1', 'select public.create_organisation(''agency'', ''X'', ''valid-slug'')') $$,
    (select dave from ids)),
  '23514', null, 'organisation names are validated');
select throws_ok(
  $$ select pg_temp.scalar_as(null, null, 'select public.create_organisation(''agency'', ''Anon Ltd'', ''anon-ltd'')') $$,
  '42501', null, 'anonymous users cannot create organisations');

-- Rate limit: 5 per identity per day.
select pg_temp.create_org_as((select dave from ids), 'Dave One', 'dave-one');
select pg_temp.create_org_as((select dave from ids), 'Dave Two', 'dave-two');
select pg_temp.create_org_as((select dave from ids), 'Dave Three', 'dave-three');
select pg_temp.create_org_as((select dave from ids), 'Dave Four', 'dave-four');
select pg_temp.create_org_as((select dave from ids), 'Dave Five', 'dave-five');
select throws_ok(
  format($$ select pg_temp.create_org_as(%L, 'Dave Six', 'dave-six') $$, (select dave from ids)),
  'CH429', null, 'organisation creation is rate limited per identity');

-- ---------------------------------------------------------------------------
-- Multi-organisation identity
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select carol from ids), 'aal1', 'select id from public.organisations'),
  2, 'one identity can belong to several organisations');
select is(
  pg_temp.query_as((select carol from ids), 'aal1',
    'select o.slug, mr.role_key
       from public.membership_roles mr
       join public.organisations o on o.id = mr.organisation_id
      where authz.is_own_membership(mr.membership_id)
      order by o.slug'),
  '[{"slug": "alpha-agency", "role_key": "agency.recruiter"},
    {"slug": "beta-agency", "role_key": "agency.healthcare_worker"}]'::jsonb,
  'the same identity holds different roles in different organisations');
select is(pg_temp.scalar_as((select carol from ids), 'aal1',
    format('select authz.has_capability(%L, ''membership.view'')', (select alpha from orgs))),
  'true', 'capabilities are evaluated per organisation (Alpha: recruiter)');
select is(pg_temp.scalar_as((select carol from ids), 'aal1',
    format('select authz.has_capability(%L, ''membership.view'')', (select beta from orgs))),
  'false', 'capabilities are evaluated per organisation (Beta: worker)');

-- ---------------------------------------------------------------------------
-- Organisation isolation
-- ---------------------------------------------------------------------------
select is(pg_temp.query_as((select alice from ids), 'aal2', 'select slug from public.organisations'),
  '[{"slug": "alpha-agency"}]'::jsonb, 'an owner sees only their own organisation');
select is(pg_temp.count_as((select bob from ids), 'aal2',
    format('select id from public.organisations where id = %L', (select alpha from orgs))),
  0, 'an owner of another organisation cannot see it (cross-tenant)');
select is(pg_temp.count_as((select nora from ids), 'aal2', 'select id from public.organisations'),
  0, 'an identity with no memberships sees no organisations');

-- ---------------------------------------------------------------------------
-- Membership isolation
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select alice from ids), 'aal1',
    format('select id from public.organisation_memberships where organisation_id = %L', (select alpha from orgs))),
  2, 'membership.view shows all memberships in that organisation');
select is(pg_temp.count_as((select alice from ids), 'aal2',
    format('select id from public.organisation_memberships where organisation_id = %L', (select beta from orgs))),
  0, 'memberships of another organisation never leak');
select is(pg_temp.count_as((select carol from ids), 'aal1',
    format('select id from public.organisation_memberships where organisation_id = %L', (select beta from orgs))),
  1, 'without membership.view a member sees only their own membership');
select is(pg_temp.count_as((select alice from ids), 'aal2',
    format('select id from public.membership_roles where organisation_id = %L', (select beta from orgs))),
  0, 'role assignments of another organisation never leak');
select is(pg_temp.count_as((select dave from ids), 'aal2',
    format('select id from public.organisation_memberships where organisation_id in (%L, %L)',
      (select alpha from orgs), (select beta from orgs))),
  0, 'a non-member sees no memberships');

-- ---------------------------------------------------------------------------
-- No unauthorized membership creation / direct writes
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', format('insert into public.organisation_memberships (organisation_id, profile_id) values (%%L, auth.uid())', %L)) $$,
    (select dave from ids), (select alpha from orgs)),
  '42501', null, 'a user cannot insert themselves into an organisation');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', format('insert into public.membership_roles (organisation_id, organisation_type, membership_id, role_key) values (%%L, ''agency'', %%L, ''agency.admin'')', %L, %L)) $$,
    (select carol from ids), (select alpha from orgs),
    pg_temp.membership_of((select alpha from orgs), (select carol from ids))),
  '42501', null, 'a user cannot insert role assignments directly');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', 'update public.organisation_memberships set status = ''active''') $$,
    (select alice from ids)),
  '42501', null, 'memberships cannot be updated directly');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', 'update public.organisations set name = ''Renamed''') $$,
    (select alice from ids)),
  '42501', null, 'organisations cannot be updated directly');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', 'delete from public.organisations') $$,
    (select alice from ids)),
  '42501', null, 'organisations cannot be deleted directly');

-- ---------------------------------------------------------------------------
-- Membership lifecycle (membership.manage is privileged → AAL2)
-- ---------------------------------------------------------------------------
create temp table m as select pg_temp.membership_of((select alpha from orgs), (select carol from ids)) as carol_alpha;
grant select on m to authenticated;

select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal1', %L) $$,
    (select alice from ids),
    format('select public.set_membership_status(%L, %L)', (select carol_alpha from m), 'suspended')),
  'CH402', null, 'membership administration at AAL1 requires step-up');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', %L) $$,
    (select bob from ids),
    format('select public.set_membership_status(%L, %L)', (select carol_alpha from m), 'suspended')),
  'CH403', null, 'another organisation''s owner cannot manage the membership (cross-tenant)');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', %L) $$,
    (select carol from ids),
    format('select public.set_membership_status(%L, %L)', pg_temp.membership_of((select alpha from orgs), (select alice from ids)), 'suspended')),
  'CH403', null, 'a member without membership.manage cannot suspend others');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', %L) $$,
    (select alice from ids),
    format('select public.set_membership_status(%L, %L)', pg_temp.membership_of((select alpha from orgs), (select alice from ids)), 'suspended')),
  'CH403', null, 'a user cannot change their own membership');

select lives_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', %L) $$,
    (select alice from ids),
    format('select public.set_membership_status(%L, %L)', (select carol_alpha from m), 'suspended')),
  'an owner at AAL2 can suspend a membership');
select is(pg_temp.query_as((select carol from ids), 'aal1', 'select slug from public.organisations'),
  '[{"slug": "beta-agency"}]'::jsonb, 'a suspended membership loses organisation access immediately');
select is(pg_temp.count_as((select carol from ids), 'aal2',
    format('select * from public.my_capabilities(%L)', (select alpha from orgs))),
  0, 'a suspended membership holds no capabilities');

select lives_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', %L) $$,
    (select alice from ids),
    format('select public.set_membership_status(%L, %L)', (select carol_alpha from m), 'active')),
  'a suspended membership can be reinstated');
select is(pg_temp.count_as((select carol from ids), 'aal1', 'select id from public.organisations'),
  2, 'reinstatement restores access');

select lives_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', %L) $$,
    (select alice from ids),
    format('select public.set_membership_status(%L, %L)', (select carol_alpha from m), 'revoked')),
  'a membership can be revoked');
select is(
  (select count(*)::int from public.membership_roles
    where membership_id = (select carol_alpha from m) and revoked_at is null),
  0, 'revocation ends every role assignment (no stale privileges on re-admission)');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', %L) $$,
    (select alice from ids),
    format('select public.set_membership_status(%L, %L)', (select carol_alpha from m), 'active')),
  'CH409', null, 'a revoked membership cannot be reinstated directly (re-invite required)');

-- ---------------------------------------------------------------------------
-- Integrity guards
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ update public.organisation_memberships set organisation_id = %L where id = %L $$,
    (select beta from orgs), (select carol_alpha from m)),
  'CH409', null, 'a membership cannot be moved to another organisation');
select throws_ok(
  format($$ update public.organisations set type = 'facility' where id = %L $$, (select alpha from orgs)),
  'CH409', null, 'organisation type is immutable');

-- Suspended organisation: still visible to members, but no capabilities.
update public.organisations set status = 'suspended' where id = (select beta from orgs);
select is(pg_temp.scalar_as((select bob from ids), 'aal2',
    format('select authz.has_capability(%L, ''organisation.view'')', (select beta from orgs))),
  'false', 'a suspended organisation grants no capabilities');

select * from finish();
rollback;
