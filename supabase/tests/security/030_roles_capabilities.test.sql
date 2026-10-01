-- =============================================================================
-- E. No self-role escalation · J. AAL2 privileged enforcement
-- Capability resolution · capability ceiling · cross-tenant integrity (FKs)
-- Non-destructive role history · last-administrator protection
-- =============================================================================
begin;
\ir _helpers.psql

select plan(36);

create temp table ids as
select
  pg_temp.create_user('alice@example.test') as alice,   -- Alpha admin (owner)
  pg_temp.create_user('olly@example.test')  as olly,    -- Alpha operations manager
  pg_temp.create_user('rita@example.test')  as rita,    -- Alpha recruiter
  pg_temp.create_user('will@example.test')  as will,    -- Alpha healthcare worker
  pg_temp.create_user('bob@example.test')   as bob;     -- Beta admin
grant select on ids to authenticated;

create temp table orgs as
select
  pg_temp.create_org_as((select alice from ids), 'Alpha Agency', 'alpha-agency') as alpha,
  pg_temp.create_org_as((select bob from ids),   'Beta Agency',  'beta-agency')  as beta;
grant select on orgs to authenticated;

create temp table m as
select
  pg_temp.membership_of((select alpha from orgs), (select alice from ids)) as alice,
  pg_temp.add_member((select alpha from orgs), (select olly from ids), 'agency.operations_manager') as olly,
  pg_temp.add_member((select alpha from orgs), (select rita from ids), 'agency.recruiter') as rita,
  pg_temp.add_member((select alpha from orgs), (select will from ids), 'agency.healthcare_worker') as will,
  pg_temp.membership_of((select beta from orgs), (select bob from ids)) as bob;
grant select on m to authenticated;


-- ---------------------------------------------------------------------------
-- Vocabulary integrity
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.capabilities where key !~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  0, 'capability keys are namespaced');
select is((select count(*)::int from public.roles where split_part(key, '.', 1) <> organisation_type::text),
  0, 'role keys are namespaced by organisation type');
select is((select count(*)::int from public.roles where is_owner_role),
  2, 'exactly one owner role per organisation type');
select is(
  (select array_agg(key order by key) from public.capabilities where is_privileged),
  array['attendance.location.view', 'attendance.manage_settings', 'audit.view', 'credential.requirements.manage', 'credential.review', 'credential.verify',
        'facility.manage', 'invoice.approve', 'invoice.export', 'membership.invite', 'membership.manage', 'organisation.manage',
        'payroll.approve', 'payroll.export', 'rates.manage', 'relationship.manage', 'role.assign', 'worker.manage', 'worker.notes.manage'],
  'administrative capabilities are privileged (AAL2)');

-- ---------------------------------------------------------------------------
-- Capability resolution and AAL2
-- ---------------------------------------------------------------------------
select is(pg_temp.rpc((select alice from ids), 'aal1', 'select authz.has_capability(%L, %L)', (select alpha from orgs)::text, 'membership.view'),
  'true', 'a non-privileged capability works at AAL1');
select is(pg_temp.rpc((select alice from ids), 'aal1', 'select authz.has_capability(%L, %L)', (select alpha from orgs)::text, 'role.assign'),
  'false', 'a privileged capability is NOT effective at AAL1');
select is(pg_temp.rpc((select alice from ids), 'aal2', 'select authz.has_capability(%L, %L)', (select alpha from orgs)::text, 'role.assign'),
  'true', 'a privileged capability is effective at AAL2');

-- A JWT without an aal claim fails closed to AAL1.
select set_config('request.jwt.claims',
  json_build_object('sub', (select alice from ids), 'role', 'authenticated')::text, true);
select is(authz.current_aal(), 'aal1', 'a missing aal claim is treated as AAL1');
select set_config('request.jwt.claims', '', true);

select is(pg_temp.rpc((select bob from ids), 'aal2', 'select authz.has_capability(%L, %L)', (select alpha from orgs)::text, 'organisation.view'),
  'false', 'no capability in an organisation one does not belong to');
select is(pg_temp.rpc((select alice from ids), 'aal2', 'select authz.has_capability(%L, %L)', (select alpha from orgs)::text, 'no.such_capability'),
  'false', 'unknown capabilities are never granted');

select is(pg_temp.count_as((select alice from ids), 'aal1', format('select * from public.my_capabilities(%L)', (select alpha from orgs))),
  44, 'my_capabilities lists every held capability');
select is(pg_temp.count_as((select alice from ids), 'aal1', format('select * from public.my_capabilities(%L) where not is_satisfied', (select alpha from orgs))),
  19, 'my_capabilities flags privileged capabilities needing step-up at AAL1');
select is(pg_temp.count_as((select bob from ids), 'aal2', format('select * from public.my_capabilities(%L)', (select alpha from orgs))),
  0, 'my_capabilities is empty for non-members');

-- ---------------------------------------------------------------------------
-- Role assignment: step-up, no self-escalation, capability ceiling
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal1', 'select public.assign_membership_role(%%L, %%L)', %L, 'agency.scheduler') $$,
    (select alice from ids), (select will from m)),
  'CH402', null, 'role assignment at AAL1 requires step-up');
select lives_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.assign_membership_role(%%L, %%L)', %L, 'agency.scheduler') $$,
    (select alice from ids), (select will from m)),
  'an owner at AAL2 can assign a role');
select is(pg_temp.rpc((select will from ids), 'aal1', 'select authz.has_capability(%L, %L)', (select alpha from orgs)::text, 'membership.view'),
  'true', 'an assigned role''s capabilities take effect');

select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.assign_membership_role(%%L, %%L)', %L, 'agency.admin') $$,
    (select rita from ids), (select rita from m)),
  'CH403', null, 'a recruiter cannot grant themselves admin');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.assign_membership_role(%%L, %%L)', %L, 'agency.admin') $$,
    (select olly from ids), (select olly from m)),
  'CH403', null, 'a role manager cannot change their own roles');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.assign_membership_role(%%L, %%L)', %L, 'agency.admin') $$,
    (select olly from ids), (select will from m)),
  'CH403', null, 'capability ceiling: cannot grant a role with capabilities one lacks');
select lives_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.assign_membership_role(%%L, %%L)', %L, 'agency.recruiter') $$,
    (select olly from ids), (select will from m)),
  'a role manager can grant a role within their ceiling');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.revoke_membership_role(%%L, %%L)', %L, 'agency.admin') $$,
    (select olly from ids), (select alice from m)),
  'CH403', null, 'capability ceiling: cannot revoke a more powerful role');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.assign_membership_role(%%L, %%L)', %L, 'agency.scheduler') $$,
    (select bob from ids), (select will from m)),
  'CH403', null, 'cross-tenant: another organisation''s owner cannot assign roles');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.assign_membership_role(%%L, %%L)', %L, 'agency.scheduler') $$,
    (select alice from ids), gen_random_uuid()),
  'CH403', null, 'unknown membership ids are indistinguishable from forbidden ones');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.assign_membership_role(%%L, %%L)', %L, 'facility.admin') $$,
    (select alice from ids), (select will from m)),
  'CH400', null, 'a role of another organisation type cannot be assigned');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.assign_membership_role(%%L, %%L)', %L, 'agency.scheduler') $$,
    (select alice from ids), (select will from m)),
  '23505', null, 'the same role cannot be active twice on a membership');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', 'update public.membership_roles set role_key = ''agency.admin''') $$,
    (select alice from ids)),
  '42501', null, 'role assignments cannot be edited directly');

-- ---------------------------------------------------------------------------
-- Cross-tenant integrity is declarative (holds even for the owner role)
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ insert into public.membership_roles (organisation_id, organisation_type, membership_id, role_key)
            values (%L, 'agency', %L, 'agency.admin') $$, (select beta from orgs), (select will from m)),
  '23503', null, 'a role assignment cannot reference a membership of another organisation');
select throws_ok(
  format($$ insert into public.membership_roles (organisation_id, organisation_type, membership_id, role_key)
            values (%L, 'agency', %L, 'facility.admin') $$, (select alpha from orgs), (select will from m)),
  '23503', null, 'a role assignment cannot use a role of another organisation type');
select throws_ok(
  format($$ insert into public.membership_roles (organisation_id, organisation_type, membership_id, role_key)
            values (%L, 'facility', %L, 'facility.admin') $$, (select alpha from orgs), (select will from m)),
  '23503', null, 'a role assignment cannot misstate the organisation type');

-- ---------------------------------------------------------------------------
-- Revocation preserves history; revoked roles stop working
-- ---------------------------------------------------------------------------
select lives_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.revoke_membership_role(%%L, %%L)', %L, 'agency.scheduler') $$,
    (select alice from ids), (select will from m)),
  'an owner can revoke a role');
select is(
  (select count(*)::int from public.membership_roles
    where membership_id = (select will from m) and role_key = 'agency.scheduler' and revoked_at is not null),
  1, 'the revoked assignment is retained as history');
select throws_ok(
  format($$ delete from public.membership_roles where membership_id = %L $$, (select will from m)),
  'CH409', null, 'role history cannot be deleted (even by the owner role)');
select throws_ok(
  format($$ update public.membership_roles set revoked_at = null where membership_id = %L and role_key = 'agency.scheduler' $$,
    (select will from m)),
  'CH409', null, 'a revoked assignment cannot be un-revoked');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.revoke_membership_role(%%L, %%L)', %L, 'agency.finance') $$,
    (select alice from ids), (select will from m)),
  'CH404', null, 'revoking a role that is not held is reported as not found');

-- A suspended profile holds nothing anywhere.
update public.profiles set status = 'suspended' where id = (select olly from ids);
select is(pg_temp.rpc((select olly from ids), 'aal2', 'select authz.has_capability(%L, %L)', (select alpha from orgs)::text, 'membership.view'),
  'false', 'a suspended identity holds no capabilities');

-- Last administrator protection.
insert into public.organisations (type, name, slug) values ('agency', 'Ownerless Ltd', 'ownerless-ltd');
select throws_ok(
  $$ select internal.assert_owner_remains((select id from public.organisations where slug = 'ownerless-ltd')) $$,
  'CH409', null, 'an organisation without an administrator is rejected');

select * from finish();
rollback;
