-- =============================================================================
-- K. Audit append-only behaviour · audit visibility · metadata hygiene
-- =============================================================================
begin;
\ir _helpers.psql

select plan(14);

create temp table ids as
select
  pg_temp.create_user('alice@example.test') as alice,   -- Alpha admin
  pg_temp.create_user('carol@example.test') as carol,   -- Alpha worker
  pg_temp.create_user('bob@example.test')   as bob;     -- Beta admin
grant select on ids to authenticated;

-- Correlation id forwarded by the server is captured when well-formed.
select set_config('request.headers', '{"x-chelth-request-id":"11111111-2222-4333-8444-555555555555"}', true);
create temp table orgs as
select
  pg_temp.create_org_as((select alice from ids), 'Alpha Agency', 'alpha-agency') as alpha,
  pg_temp.create_org_as((select bob from ids),   'Beta Agency',  'beta-agency')  as beta;
grant select on orgs to authenticated;
select set_config('request.headers', '{"x-chelth-request-id":"not-a-uuid"}', true);
select pg_temp.add_member((select alpha from orgs), (select carol from ids), 'agency.healthcare_worker');
select pg_temp.query_as((select alice from ids), 'aal2',
  format('select * from public.create_organisation_invite(%L, ''new@example.test'', ''agency.scheduler'')', (select alpha from orgs)));

select is(
  (select array_agg(action order by action) from public.audit_events where organisation_id = (select alpha from orgs)),
  array['invite.created', 'membership.created', 'organisation.created', 'role.assigned', 'worker.created'],
  'organisation creation, worker onboarding and invitation are audited');
select is(
  (select actor_membership_id from public.audit_events
    where organisation_id = (select alpha from orgs) and action = 'invite.created'),
  pg_temp.membership_of((select alpha from orgs), (select alice from ids)),
  'the acting membership is recorded');
select is(
  (select request_id::text from public.audit_events
    where organisation_id = (select alpha from orgs) and action = 'organisation.created'),
  '11111111-2222-4333-8444-555555555555', 'a well-formed request id is recorded');
select is(
  (select request_id from public.audit_events
    where organisation_id = (select alpha from orgs) and action = 'invite.created'),
  null, 'a malformed request id is ignored');
select is(
  (select count(*)::int from public.audit_events a, public.organisation_invites i
    where i.organisation_id = (select alpha from orgs) and a.metadata::text ilike '%' || i.email || '%'),
  0, 'audit metadata carries no invitee email');

-- Visibility
select is(pg_temp.count_as((select alice from ids), 'aal2',
    format('select id from public.audit_events where organisation_id = %L', (select alpha from orgs))),
  5, 'audit.view at AAL2 shows the organisation history');
select is(pg_temp.count_as((select alice from ids), 'aal2',
    format('select id from public.audit_events where organisation_id = %L', (select beta from orgs))),
  0, 'audit history never leaks across organisations');
select is(pg_temp.count_as((select carol from ids), 'aal2',
    format('select id from public.audit_events where organisation_id = %L', (select alpha from orgs))),
  0, 'members without audit.view cannot read organisation history');

-- Append-only for API roles …
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', 'insert into public.audit_events (action) values (''forged.event'')') $$,
    (select alice from ids)),
  '42501', null, 'audit events cannot be forged through the API');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', 'update public.audit_events set action = ''x.y''') $$,
    (select alice from ids)),
  '42501', null, 'audit events cannot be updated through the API');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', 'delete from public.audit_events') $$,
    (select alice from ids)),
  '42501', null, 'audit events cannot be deleted through the API');

-- … and for the owner role itself.
select throws_ok($$ update public.audit_events set action = 'x.y' $$,
  'CH409', null, 'audit events cannot be updated even by the owner role');
select throws_ok($$ delete from public.audit_events $$,
  'CH409', null, 'audit events cannot be deleted even by the owner role');
select throws_ok($$ truncate public.audit_events cascade $$,
  'CH409', null, 'the audit table cannot be truncated');

select * from finish();
rollback;
