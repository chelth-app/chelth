-- =============================================================================
-- Facility & relationship domain security (P0-E3-S3)
-- G cross-agency references · H invalid organisation types · I explicit
-- cross-org relationship access · K unauthorised creation · M platform admin
-- linking rules · lifecycle · audit hygiene · suspended membership (J)
-- =============================================================================
begin;
\ir _helpers.psql

select plan(52);

create temp table ids as
select
  pg_temp.create_user('alice@example.test') as alice,   -- Alpha admin
  pg_temp.create_user('bob@example.test')   as bob,     -- Beta admin
  pg_temp.create_user('olly@example.test')  as olly,    -- Alpha operations manager
  pg_temp.create_user('fin@example.test')   as fin,     -- Alpha finance
  pg_temp.create_user('rita@example.test')  as rita,    -- Alpha recruiter
  pg_temp.create_user('sam@example.test')   as sam,     -- Alpha scheduler
  pg_temp.create_user('fiona@example.test') as fiona,   -- Gamma facility admin
  pg_temp.create_user('fred@example.test')  as fred,    -- Gamma facility supervisor
  pg_temp.create_user('dora@example.test')  as dora,    -- Delta facility admin
  pg_temp.create_user('erin@example.test')  as erin;    -- platform admin
grant select on ids to authenticated;

create temp table orgs as
select
  pg_temp.create_org_as((select alice from ids), 'Alpha Agency', 'alpha-agency') as alpha,
  pg_temp.create_org_as((select bob from ids),   'Beta Agency',  'beta-agency')  as beta,
  pg_temp.create_facility_org('Gamma Hospital', 'gamma-hospital') as gamma,
  pg_temp.create_facility_org('Delta Care', 'delta-care') as delta;
grant select on orgs to authenticated;

select pg_temp.add_member((select alpha from orgs), (select olly from ids),  'agency.operations_manager');
select pg_temp.add_member((select alpha from orgs), (select fin from ids),   'agency.finance');
select pg_temp.add_member((select alpha from orgs), (select rita from ids),  'agency.recruiter');
select pg_temp.add_member((select alpha from orgs), (select sam from ids),   'agency.scheduler');
select pg_temp.add_member((select gamma from orgs), (select fiona from ids), 'facility.admin');
select pg_temp.add_member((select gamma from orgs), (select fred from ids),  'facility.supervisor');
select pg_temp.add_member((select delta from orgs), (select dora from ids),  'facility.admin');
select internal.grant_platform_admin((select erin from ids), 'Test Operator', 'fixture');

create function pg_temp.create_facility(p_user uuid, p_aal text, p_org uuid, p_name text, p_tz text default 'Europe/London')
returns uuid language sql as $$
  select pg_temp.scalar_as(p_user, p_aal, format(
    'select public.create_agency_facility(%L, %L, ''hospital'', %L, p_email => ''Ward.Office@Example.test'', p_external_reference => %L)',
    p_org, p_name, p_tz, p_name))::uuid
$$;

-- ---------------------------------------------------------------------------
-- K. Who may create client facilities
-- ---------------------------------------------------------------------------
select throws_ok(format($$ select pg_temp.create_facility(%L, 'aal2', %L, 'Recruiter Facility') $$,
  (select rita from ids), (select alpha from orgs)), 'CH403', null, 'a recruiter cannot create facilities');
select throws_ok(format($$ select pg_temp.create_facility(%L, 'aal2', %L, 'Scheduler Facility') $$,
  (select sam from ids), (select alpha from orgs)), 'CH403', null, 'a scheduler cannot create facilities');
select throws_ok(format($$ select pg_temp.create_facility(%L, 'aal2', %L, 'Finance Facility') $$,
  (select fin from ids), (select alpha from orgs)), 'CH403', null, 'finance cannot create facilities');
select throws_ok(format($$ select pg_temp.create_facility(%L, 'aal1', %L, 'Aal1 Facility') $$,
  (select alice from ids), (select alpha from orgs)), 'CH402', null, 'facility management requires AAL2');
select throws_ok(format($$ select pg_temp.create_facility(%L, 'aal2', %L, 'Gamma Own') $$,
  (select fiona from ids), (select gamma from orgs)), 'CH403', null, 'facility organisations cannot hold agency client records');
select throws_ok(format($$ select pg_temp.create_facility(%L, 'aal2', %L, 'Cross Tenant') $$,
  (select bob from ids), (select alpha from orgs)), 'CH403', null, 'Agency B cannot create facilities in Agency A');
select throws_ok(format($$ select pg_temp.create_facility(%L, 'aal2', %L, 'Bad Zone', 'Mars/Olympus') $$,
  (select alice from ids), (select alpha from orgs)), 'CH400', null, 'timezones must be valid IANA names');
select throws_ok(
  format($$ select pg_temp.scalar_as(%L, 'aal2', format('select public.create_agency_facility(%%L, ''Bad Type'', ''spaceport'', ''UTC'')', %L)) $$,
    (select alice from ids), (select alpha from orgs)),
  'CH400', null, 'facility types come from the controlled vocabulary');

create temp table f as
select
  pg_temp.create_facility((select alice from ids), 'aal2', (select alpha from orgs), 'St Mary''s') as alpha_marys,
  pg_temp.create_facility((select olly from ids),  'aal2', (select alpha from orgs), 'Riverside Care') as alpha_riverside,
  pg_temp.create_facility((select bob from ids),   'aal2', (select beta from orgs),  'Beta Client') as beta_client;
grant select on f to authenticated;

select is((select email from public.agency_facilities where id = (select alpha_marys from f)),
  'ward.office@example.test', 'contact emails are normalised');
select is((select metadata from public.audit_events where action = 'facility.created' and target_id = (select alpha_marys from f)),
  '{"facility_type": "hospital"}'::jsonb, 'facility creation is audited without contact details');

-- ---------------------------------------------------------------------------
-- Visibility
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select fin from ids), 'aal1', 'select id from public.agency_facilities'),
  2, 'finance can view the agency''s client facilities');
select is(pg_temp.count_as((select rita from ids), 'aal2', 'select id from public.agency_facilities'),
  0, 'a recruiter has no facility.view');
select is(pg_temp.count_as((select alice from ids), 'aal2',
    format('select id from public.agency_facilities where id = %L', (select beta_client from f))),
  0, 'Agency A cannot read Agency B client facilities');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select id from public.agency_facilities'),
  0, 'platform admins gain no RLS access to client facilities');

-- ---------------------------------------------------------------------------
-- G/H. Structural integrity
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ insert into public.agency_facilities (agency_organisation_id, name, facility_type_key, timezone) values (%L, 'Wrong Type', 'clinic', 'UTC') $$,
    (select gamma from orgs)),
  '23503', null, 'a client facility cannot belong to a facility organisation');
select throws_ok(
  format($$ insert into public.facility_locations (agency_organisation_id, agency_facility_id, name, timezone) values (%L, %L, 'Leak Ward', 'UTC') $$,
    (select beta from orgs), (select alpha_marys from f)),
  '23503', null, 'a location cannot attach Agency B to Agency A''s facility');
select throws_ok(
  format($$ insert into public.agency_facility_relationships (agency_organisation_id, agency_facility_id) values (%L, %L) $$,
    (select beta from orgs), (select alpha_marys from f)),
  '23503', null, 'a relationship cannot pair Agency B with Agency A''s client record');
select throws_ok(
  format($$ update public.agency_facilities set linked_facility_organisation_id = %L, linked_facility_organisation_type = 'agency' where id = %L $$,
    (select beta from orgs), (select alpha_marys from f)),
  '23514', null, 'a client facility can only link to a facility organisation');
select throws_ok(
  format($$ update public.agency_facilities set agency_organisation_id = %L where id = %L $$,
    (select beta from orgs), (select alpha_marys from f)),
  'CH409', null, 'client facility ownership is immutable');

-- ---------------------------------------------------------------------------
-- Updates and locations
-- ---------------------------------------------------------------------------
select lives_ok(
  format($$ select pg_temp.scalar_as(%L, 'aal2', format('select public.update_agency_facility(%%L, ''St Mary''''s Hospital'', ''hospital'', ''Europe/London'', p_phone => ''+44 20 7946 0000'')', %L)) $$,
    (select olly from ids), (select alpha_marys from f)),
  'an operations manager can update a facility');
select is(
  (select metadata -> 'fields' from public.audit_events where action = 'facility.updated' and target_id = (select alpha_marys from f)),
  '["email", "external_reference", "name", "phone"]'::jsonb,
  'facility updates audit which fields changed, never their values');
select is(pg_temp.rpc((select alice from ids), 'aal2', 'select public.create_facility_location(%L, %L)',
    (select alpha_marys from f)::text, 'Ward 7')::uuid is not null,
  true, 'an admin can add a location');
select is((select timezone from public.facility_locations where name = 'Ward 7'),
  'Europe/London', 'a location inherits the facility timezone explicitly');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.create_facility_location(%%L, %%L)', %L, 'ward 7') $$,
    (select alice from ids), (select alpha_marys from f)),
  '23505', null, 'location names are unique within a facility');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.create_facility_location(%%L, %%L)', %L, 'Sneaky Ward') $$,
    (select bob from ids), (select alpha_marys from f)),
  'CH403', null, 'Agency B cannot add locations to Agency A facilities');

-- ---------------------------------------------------------------------------
-- Relationships: authority and lifecycle
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.create_facility_relationship(%%L)', %L) $$,
    (select olly from ids), (select alpha_marys from f)),
  'CH403', null, 'relationship.manage is reserved (operations manager has view only)');

create temp table r as
select pg_temp.rpc((select alice from ids), 'aal2', 'select public.create_facility_relationship(%L)',
  (select alpha_marys from f)::text)::uuid as marys;
grant select on r to authenticated;

select is((select status::text from public.agency_facility_relationships where id = (select marys from r)),
  'pending', 'relationships start pending');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.create_facility_relationship(%%L)', %L) $$,
    (select alice from ids), (select alpha_marys from f)),
  '23505', null, 'one open relationship per client facility');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.set_facility_relationship_status(%%L, ''suspended'')', %L) $$,
    (select alice from ids), (select marys from r)),
  'CHR09', null, 'pending relationships cannot be suspended');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.set_facility_relationship_status(%%L, ''active'')', %L) $$,
    (select bob from ids), (select marys from r)),
  'CH403', null, 'Agency B cannot change Agency A relationships');
select lives_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.set_facility_relationship_status(%%L, ''active'')', %L) $$,
    (select alice from ids), (select marys from r)),
  'an admin can activate a relationship');
select is(pg_temp.count_as((select sam from ids), 'aal1', 'select id from public.agency_facility_relationships'),
  1, 'schedulers can view relationships');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.set_agency_facility_status(%%L, ''archived'')', %L) $$,
    (select alice from ids), (select alpha_marys from f)),
  'CHF09', null, 'a facility with an open relationship cannot be archived');

-- ---------------------------------------------------------------------------
-- Linking: explicit, verified, once
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.platform_link_agency_facility(%%L, %%L)', %L, %L) $$,
    (select alice from ids), (select alpha_marys from f), (select gamma from orgs)),
  'CH403', null, 'agency admins cannot self-link a facility organisation');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.platform_link_agency_facility(%%L, %%L)', %L, %L) $$,
    (select erin from ids), (select alpha_marys from f), (select beta from orgs)),
  'CH400', null, 'linking requires a facility organisation');

-- I (before link): the facility organisation sees nothing.
select is(pg_temp.count_as((select fiona from ids), 'aal2', 'select id from public.agency_facility_relationships'),
  0, 'an unlinked facility organisation sees no relationships');

select lives_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.platform_link_agency_facility(%%L, %%L)', %L, %L) $$,
    (select erin from ids), (select alpha_marys from f), (select gamma from orgs)),
  'a platform admin can link a client record to a facility organisation');
select throws_ok(
  format($$ select pg_temp.rpc(%L, 'aal2', 'select public.platform_link_agency_facility(%%L, %%L)', %L, %L) $$,
    (select erin from ids), (select alpha_marys from f), (select delta from orgs)),
  'CHF09', null, 'a link cannot be re-pointed');
select throws_ok(
  format($$ update public.agency_facilities set linked_facility_organisation_id = %L where id = %L $$,
    (select delta from orgs), (select alpha_marys from f)),
  'CH409', null, 'a link cannot be changed even by the owner role');

-- ---------------------------------------------------------------------------
-- I. Cross-organisation access is exactly the relationship
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select fiona from ids), 'aal1', 'select id from public.agency_facility_relationships'),
  1, 'the linked facility admin sees its relationship');
select is(
  pg_temp.query_as((select fiona from ids), 'aal1',
    format('select agency_name, relationship_status from public.list_partner_agency_relationships(%L)', (select gamma from orgs))),
  '[{"agency_name": "Alpha Agency", "relationship_status": "active"}]'::jsonb,
  'the facility sees the agency name and status through the narrow projection');
select is(pg_temp.count_as((select fiona from ids), 'aal2', 'select id from public.agency_facilities'),
  0, 'the linked facility still cannot read agency client records');
select is(pg_temp.count_as((select fiona from ids), 'aal2', 'select id from public.facility_locations'),
  0, 'the linked facility cannot read agency location records');
select is(pg_temp.count_as((select fiona from ids), 'aal2', 'select id from public.organisations'),
  1, 'the linked facility cannot read the agency organisation row');
select is(pg_temp.count_as((select fred from ids), 'aal2', 'select id from public.agency_facility_relationships'),
  0, 'facility members without relationship.view see nothing');
select is(pg_temp.count_as((select dora from ids), 'aal2', 'select id from public.agency_facility_relationships'),
  0, 'an unrelated facility organisation sees nothing');
select throws_ok(
  format($$ select pg_temp.query_as(%L, 'aal2', format('select * from public.list_partner_agency_relationships(%%L)', %L)) $$,
    (select dora from ids), (select gamma from orgs)),
  'CH403', null, 'another facility cannot query Gamma''s relationships');
select is(pg_temp.count_as((select fiona from ids), 'aal2',
    format('select id from public.audit_events where organisation_id = %L and action = ''facility.linked''', (select gamma from orgs))),
  1, 'linking is audited in the facility organisation too');

-- Ended relationships stop sharing; the ended row is immutable.
select pg_temp.rpc((select alice from ids), 'aal2', 'select public.set_facility_relationship_status(%L, ''ended'')',
  (select marys from r)::text);
select is(pg_temp.count_as((select fiona from ids), 'aal1', 'select id from public.agency_facility_relationships'),
  0, 'an ended relationship is no longer shared');
select throws_ok(
  format($$ update public.agency_facility_relationships set status = 'active' where id = %L $$, (select marys from r)),
  'CHR09', null, 'ended relationships are immutable (even for the owner role)');

-- J. A new relationship re-shares; a suspended facility membership does not.
select pg_temp.rpc((select alice from ids), 'aal2', 'select public.create_facility_relationship(%L)', (select alpha_marys from f)::text);
select is(pg_temp.count_as((select fiona from ids), 'aal1', 'select id from public.agency_facility_relationships'),
  1, 'a new relationship is shared again');
update public.organisation_memberships set status = 'suspended'
 where organisation_id = (select gamma from orgs) and profile_id = (select fiona from ids);
select is(pg_temp.count_as((select fiona from ids), 'aal1', 'select id from public.agency_facility_relationships'),
  0, 'a suspended facility membership loses relationship access immediately');

select * from finish();
rollback;
