-- =============================================================================
-- Workforce domain security (P0-E3-S3)
-- A cross-agency reads · B cross-agency writes · C worker self-access
-- D no self status change · E capability boundaries · F facility users
-- J suspended/revoked memberships · L internal notes · M platform admin
-- N immutable ownership · structural integrity · lifecycle · multi-agency
-- =============================================================================
begin;
\ir _helpers.psql

select plan(47);

create temp table ids as
select
  pg_temp.create_user('alice@example.test') as alice,   -- Alpha admin
  pg_temp.create_user('bob@example.test')   as bob,     -- Beta admin
  pg_temp.create_user('wendy@example.test') as wendy,   -- worker in Alpha AND Beta
  pg_temp.create_user('walt@example.test')  as walt,    -- worker in Alpha
  pg_temp.create_user('rita@example.test')  as rita,    -- Alpha recruiter (+ later worker)
  pg_temp.create_user('sam@example.test')   as sam,     -- Alpha scheduler
  pg_temp.create_user('carl@example.test')  as carl,    -- Alpha credentialing officer
  pg_temp.create_user('fiona@example.test') as fiona,   -- facility admin (Gamma)
  pg_temp.create_user('erin@example.test')  as erin;    -- platform admin
grant select on ids to authenticated;

create temp table orgs as
select
  pg_temp.create_org_as((select alice from ids), 'Alpha Agency', 'alpha-agency') as alpha,
  pg_temp.create_org_as((select bob from ids),   'Beta Agency',  'beta-agency')  as beta,
  pg_temp.create_facility_org('Gamma Hospital', 'gamma-hospital') as gamma;
grant select on orgs to authenticated;

select pg_temp.add_member((select alpha from orgs), (select wendy from ids), 'agency.healthcare_worker');
select pg_temp.add_member((select beta from orgs),  (select wendy from ids), 'agency.healthcare_worker');
select pg_temp.add_member((select alpha from orgs), (select walt from ids),  'agency.healthcare_worker');
select pg_temp.add_member((select alpha from orgs), (select rita from ids),  'agency.recruiter');
select pg_temp.add_member((select alpha from orgs), (select sam from ids),   'agency.scheduler');
select pg_temp.add_member((select alpha from orgs), (select carl from ids),  'agency.credentialing_officer');
select pg_temp.add_member((select gamma from orgs), (select fiona from ids), 'facility.admin');
select internal.grant_platform_admin((select erin from ids), 'Test Operator', 'fixture');

create temp table w as
select
  (select id from public.agency_workers where profile_id = (select wendy from ids) and agency_organisation_id = (select alpha from orgs)) as wendy_alpha,
  (select id from public.agency_workers where profile_id = (select wendy from ids) and agency_organisation_id = (select beta from orgs))  as wendy_beta,
  (select id from public.agency_workers where profile_id = (select walt from ids)) as walt;
grant select on w to authenticated;

-- ---------------------------------------------------------------------------
-- Creation follows the role grant; one person, many agencies
-- ---------------------------------------------------------------------------
select isnt((select wendy_alpha from w), null, 'granting agency.healthcare_worker creates a worker record');
select is((select status::text from public.agency_workers where id = (select walt from w)), 'onboarding',
  'new worker records start in onboarding');
select is((select count(distinct agency_organisation_id)::int from public.agency_workers where profile_id = (select wendy from ids)),
  2, 'one person holds separate worker records in two agencies');
select is((select count(*)::int from public.profiles where id = (select wendy from ids)), 1,
  'the person is not duplicated');
select is((select count(*)::int from public.agency_workers where profile_id = (select rita from ids)), 0,
  'non-worker roles do not create worker records');
select is((select count(*)::int from public.audit_events where action = 'worker.created' and target_id = (select walt from w)),
  1, 'worker creation is audited');

-- ---------------------------------------------------------------------------
-- Structural tenant safety (holds for the owner role, i.e. even if RLS failed)
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ insert into public.agency_workers (agency_organisation_id, membership_id, profile_id) values (%L, %L, %L) $$,
    (select alpha from orgs), pg_temp.membership_of((select beta from orgs), (select bob from ids)), (select bob from ids)),
  '23503', null, 'an Alpha worker record cannot reference a Beta membership');
select throws_ok(
  format($$ insert into public.agency_workers (agency_organisation_id, membership_id, profile_id) values (%L, %L, %L) $$,
    (select alpha from orgs), pg_temp.membership_of((select alpha from orgs), (select rita from ids)), (select walt from ids)),
  '23503', null, 'a worker record cannot name a different person than its membership');
select throws_ok(
  format($$ insert into public.agency_workers (agency_organisation_id, agency_organisation_type, membership_id, profile_id) values (%L, 'facility', %L, %L) $$,
    (select gamma from orgs), pg_temp.membership_of((select gamma from orgs), (select fiona from ids)), (select fiona from ids)),
  '23514', null, 'worker records can only belong to agency organisations');
select throws_ok(
  format($$ update public.agency_workers set agency_organisation_id = %L where id = %L $$, (select beta from orgs), (select walt from w)),
  'CH409', null, 'worker ownership (agency) is immutable');
select throws_ok(
  format($$ update public.agency_workers set profile_id = %L where id = %L $$, (select wendy from ids), (select walt from w)),
  'CH409', null, 'worker ownership (person) is immutable');

-- ---------------------------------------------------------------------------
-- A/B. Cross-agency isolation
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select alice from ids), 'aal2', 'select id from public.agency_workers'),
  2, 'an agency admin sees exactly their agency''s workers');
select is(pg_temp.count_as((select alice from ids), 'aal2',
    format('select id from public.agency_workers where agency_organisation_id = %L', (select beta from orgs))),
  0, 'Agency A cannot read Agency B workers');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.set_agency_worker_status(%%L, ''active'')', %L) $$,
    (select alice from ids), (select wendy_beta from w)),
  'CH403', null, 'Agency A cannot change Agency B worker status');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.update_agency_worker(%%L, ''X-1'')', %L) $$,
    (select bob from ids), (select walt from w)),
  'CH403', null, 'Agency B cannot update Agency A workers');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.set_agency_worker_status(%%L, ''active'')', %L) $$,
    (select alice from ids), gen_random_uuid()),
  'CH403', null, 'unknown worker ids are indistinguishable from forbidden ones');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', 'update public.agency_workers set status = ''active''') $$,
    (select alice from ids)),
  '42501', null, 'worker records cannot be written directly');

-- ---------------------------------------------------------------------------
-- C/D. Worker self-access is least privilege
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select wendy from ids), 'aal2', 'select id from public.agency_workers'),
  2, 'a worker sees their own record in each agency');
select is(pg_temp.count_as((select wendy from ids), 'aal2',
    format('select id from public.agency_workers where id = %L', (select walt from w))),
  0, 'a worker cannot see other workers');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.set_agency_worker_status(%%L, ''active'')', %L) $$,
    (select wendy from ids), (select wendy_alpha from w)),
  'CH403', null, 'a worker cannot change their own status');
select is(pg_temp.count_as((select wendy from ids), 'aal2', 'select id from public.agency_facilities'),
  0, 'a worker sees no client facilities');

-- Admin who is also a worker cannot act on their own worker record.
select pg_temp.exec_as((select alice from ids), 'aal2', format(
  'select public.assign_membership_role(%L, ''agency.healthcare_worker'')',
  pg_temp.membership_of((select alpha from orgs), (select rita from ids))));
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.set_agency_worker_status(%%L, ''active'')', %L) $$,
    (select rita from ids), (select id::text from public.agency_workers where profile_id = (select rita from ids))),
  'CH403', null, 'a worker manager cannot change their own worker record');

-- ---------------------------------------------------------------------------
-- E. Capability boundaries
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select sam from ids), 'aal2', 'select id from public.agency_workers'),
  3, 'a scheduler can view workers');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.set_agency_worker_status(%%L, ''active'')', %L) $$,
    (select sam from ids), (select walt from w)),
  'CH403', null, 'a scheduler cannot manage workers');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal1', 'select public.set_agency_worker_status(%%L, ''active'')', %L) $$,
    (select alice from ids), (select walt from w)),
  'CH402', null, 'worker management requires AAL2');
select is(pg_temp.count_as((select sam from ids), 'aal1',
    format('select id from public.profiles where id = %L', (select walt from ids))),
  1, 'worker.view holders can see worker names (without membership.view)');

-- ---------------------------------------------------------------------------
-- F/M. Facility users and platform admins see no agency workers
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select fiona from ids), 'aal2', 'select id from public.agency_workers'),
  0, 'facility users cannot read agency workers');
select is(pg_temp.count_as((select fiona from ids), 'aal2',
    format('select id from public.profiles where id = %L', (select walt from ids))),
  0, 'facility users cannot read worker profiles');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select id from public.agency_workers'),
  0, 'platform admins gain no RLS access to workers');

-- ---------------------------------------------------------------------------
-- Lifecycle
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.set_agency_worker_status(%%L, ''inactive'')', %L) $$,
    (select alice from ids), (select walt from w)),
  'CHW09', null, 'onboarding workers cannot jump to inactive');
select lives_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.set_agency_worker_status(%%L, ''active'')', %L) $$,
    (select alice from ids), (select walt from w)),
  'an admin can activate a worker');
select is((select start_date from public.agency_workers where id = (select walt from w)), current_date,
  'activation records the start date');
select is(
  (select metadata from public.audit_events where action = 'worker.status_changed' and target_id = (select walt from w)),
  '{"to": "active", "from": "onboarding"}'::jsonb, 'status changes are audited with codes only');
select lives_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.update_agency_worker(%%L, %%L)', %L, 'W-001') $$,
    (select alice from ids), (select walt from w)),
  'an admin can set the worker reference');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.update_agency_worker(%%L, %%L)', %L, 'w-001') $$,
    (select alice from ids), (select wendy_alpha from w)),
  '23505', null, 'worker references are unique per agency (case-insensitive)');
select lives_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.set_agency_worker_status(%%L, ''terminated'')', %L) $$,
    (select alice from ids), (select walt from w)),
  'an admin can terminate a worker');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.set_agency_worker_status(%%L, ''active'')', %L) $$,
    (select alice from ids), (select walt from w)),
  'CHW09', null, 'termination is terminal');

-- Re-engagement creates a NEW record; history is preserved.
select pg_temp.exec_as((select alice from ids), 'aal2', format(
  'select public.revoke_membership_role(%L, ''agency.healthcare_worker'')', pg_temp.membership_of((select alpha from orgs), (select walt from ids))));
select pg_temp.exec_as((select alice from ids), 'aal2', format(
  'select public.assign_membership_role(%L, ''agency.healthcare_worker'')', pg_temp.membership_of((select alpha from orgs), (select walt from ids))));
select is(
  (select array_agg(status::text order by created_at) from public.agency_workers where profile_id = (select walt from ids)),
  array['terminated', 'onboarding'], 're-engagement creates a new record and keeps the terminated one');

-- ---------------------------------------------------------------------------
-- L. Internal notes never leak
-- ---------------------------------------------------------------------------
select pg_temp.rpc((select alice from ids), 'aal2', 'select public.add_agency_worker_note(%L, %L)',
  (select wendy_alpha from w)::text, 'Prefers night shifts. SECRET-NOTE-MARKER');
select pg_temp.rpc((select alice from ids), 'aal2', 'select public.add_agency_worker_note(%L, %L)',
  (select id::text from public.agency_workers where profile_id = (select rita from ids)), 'Note about rita');

select is(pg_temp.count_as((select rita from ids), 'aal2', 'select id from public.agency_worker_notes'),
  1, 'a recruiter reads notes, but never notes about themselves');
select is(pg_temp.count_as((select sam from ids), 'aal2', 'select id from public.agency_worker_notes'),
  0, 'a scheduler cannot read internal notes');
select is(pg_temp.count_as((select carl from ids), 'aal2', 'select id from public.agency_worker_notes'),
  0, 'a credentialing officer cannot read internal notes');
select is(pg_temp.count_as((select wendy from ids), 'aal2', 'select id from public.agency_worker_notes'),
  0, 'a worker cannot read notes about themselves');
select is((select count(*)::int from public.audit_events where metadata::text like '%SECRET-NOTE-MARKER%'),
  0, 'note bodies never enter audit metadata');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.add_agency_worker_note(%%L, %%L)', %L, 'x') $$,
    (select sam from ids), (select wendy_alpha from w)),
  'CH403', null, 'a scheduler cannot add notes');
select throws_ok($$ update public.agency_worker_notes set body = 'rewritten' $$,
  'CH409', null, 'notes are append-only (even for the owner role)');

-- ---------------------------------------------------------------------------
-- J. Suspended / revoked memberships lose domain access immediately
-- ---------------------------------------------------------------------------
select pg_temp.exec_as((select alice from ids), 'aal2', format(
  'select public.set_membership_status(%L, ''suspended'')', pg_temp.membership_of((select alpha from orgs), (select wendy from ids))));
select is(
  pg_temp.query_as((select wendy from ids), 'aal2', 'select agency_organisation_id from public.agency_workers'),
  jsonb_build_array(jsonb_build_object('agency_organisation_id', (select beta from orgs))),
  'a suspended membership hides that agency''s worker record from the worker');
select pg_temp.exec_as((select alice from ids), 'aal2', format(
  'select public.set_membership_status(%L, ''revoked'')', pg_temp.membership_of((select alpha from orgs), (select sam from ids))));
select is(pg_temp.count_as((select sam from ids), 'aal2', 'select id from public.agency_workers'),
  0, 'a revoked scheduler loses worker access immediately');

select * from finish();
rollback;
