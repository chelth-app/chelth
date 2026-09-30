-- =============================================================================
-- Credentials: person ownership, explicit sharing, verification (P0-E4-S1)
-- A own metadata · B other workers · C cross-agency · D reviewer access
-- F no self-verification · G no cross-agency verification · H share revocation
-- O verification append-only · R immutable ownership · S platform admin
-- versioning/renewal · number secrecy · structural integrity
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql

select plan(46);

create temp table ids as
select
  pg_temp.create_user('alice@example.test') as alice,   -- Alpha admin
  pg_temp.create_user('carl@example.test')  as carl,    -- Alpha credentialing officer (+ worker)
  pg_temp.create_user('rita@example.test')  as rita,    -- Alpha recruiter (credential.view only)
  pg_temp.create_user('sam@example.test')   as sam,     -- Alpha scheduler (compliance.view only)
  pg_temp.create_user('bob@example.test')   as bob,     -- Beta admin
  pg_temp.create_user('wendy@example.test') as wendy,   -- worker at Alpha AND Beta
  pg_temp.create_user('walt@example.test')  as walt,    -- worker at Alpha
  pg_temp.create_user('erin@example.test')  as erin;    -- platform admin
grant select on ids to authenticated;

create temp table orgs as
select
  pg_temp.create_org_as((select alice from ids), 'Alpha Agency', 'alpha-agency') as alpha,
  pg_temp.create_org_as((select bob from ids),   'Beta Agency',  'beta-agency')  as beta;
grant select on orgs to authenticated;

select pg_temp.add_member((select alpha from orgs), (select carl from ids),  'agency.credentialing_officer');
select pg_temp.add_member((select alpha from orgs), (select rita from ids),  'agency.recruiter');
select pg_temp.add_member((select alpha from orgs), (select sam from ids),   'agency.scheduler');
select pg_temp.add_member((select alpha from orgs), (select wendy from ids), 'agency.healthcare_worker');
select pg_temp.add_member((select beta from orgs),  (select wendy from ids), 'agency.healthcare_worker');
select pg_temp.add_member((select alpha from orgs), (select walt from ids),  'agency.healthcare_worker');
insert into public.membership_roles (organisation_id, organisation_type, membership_id, role_key)
values ((select alpha from orgs), 'agency', pg_temp.membership_of((select alpha from orgs), (select carl from ids)), 'agency.healthcare_worker');
select internal.grant_platform_admin((select erin from ids), 'Test Operator', 'fixture');

create temp table c as
select pg_temp.new_credential((select wendy from ids), 'rn_license', 'US-GA', 'RN-SECRET-4411', null, current_date + 400) as rn;
alter table c add column bls jsonb;
update c set bls = pg_temp.evidence((select wendy from ids), 'bls_certification', null, null, current_date - 30, current_date + 700);
grant select on c to authenticated;

-- ---------------------------------------------------------------------------
-- A. Person ownership
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select wendy from ids), 'aal1', 'select id from public.credentials'),
  2, 'a worker sees their own credentials');
select is(pg_temp.count_as((select wendy from ids), 'aal1', 'select credential_id from public.credential_identifiers'),
  1, 'a worker sees their own credential numbers');
select is((select count(*)::int from public.credentials where profile_id = (select wendy from ids)),
  2, 'one person-owned record per credential (not duplicated per agency)');
select throws_ok(
  format($$ select pg_temp.new_credential(%L, 'rn_license', 'US', 'X-1', null, current_date + 10) $$, (select wendy from ids)),
  'CH400', null, 'licence jurisdictions must be at the subdivision level');
select throws_ok(
  format($$ select pg_temp.new_credential(%L, 'rn_license', 'US-GA', null, null, current_date + 10) $$, (select wendy from ids)),
  'CH400', null, 'a licence requires a credential number');
select throws_ok(
  format($$ select pg_temp.new_credential(%L, 'bls_certification', null, null, current_date - 1, null) $$, (select wendy from ids)),
  'CH400', null, 'BLS requires an expiry date');

-- ---------------------------------------------------------------------------
-- B/C/S. Nobody else sees unshared credentials
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select walt from ids), 'aal2', 'select id from public.credentials'),
  0, 'Worker B cannot read Worker A credentials');
select is(pg_temp.count_as((select carl from ids), 'aal2', 'select id from public.credentials'),
  0, 'an unshared credential is invisible even to the agency credentialing officer');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select id from public.credentials'),
  0, 'platform admins have no RLS path to credentials');

select pg_temp.share_credential((select wendy from ids), (select bls ->> 'credential_id' from c)::uuid, (select alpha from orgs));
select pg_temp.share_credential((select wendy from ids), (select rn ->> 'credential_id' from c)::uuid, (select alpha from orgs));

select is(pg_temp.count_as((select bob from ids), 'aal2', 'select id from public.credentials'),
  0, 'Agency B does not see credentials shared only with Agency A (same worker)');
select throws_ok(
  format($$ select pg_temp.share_credential(%L, %L, %L) $$, (select walt from ids), (select bls ->> 'credential_id' from c), (select alpha from orgs)),
  'CH403', null, 'only the owner can share a credential');
select throws_ok(
  format($$ select pg_temp.share_credential(%L, %L, %L) $$, (select wendy from ids), (select bls ->> 'credential_id' from c),
    pg_temp.create_org_as((select alice from ids), 'Gamma Agency', 'gamma-agency')),
  'CH403', null, 'credentials can only be shared with agencies the person works with');
select throws_ok(
  format($$ select pg_temp.share_credential(%L, %L, %L) $$, (select wendy from ids), (select bls ->> 'credential_id' from c), (select alpha from orgs)),
  '23505', null, 'one active share per credential per agency');

-- ---------------------------------------------------------------------------
-- D. Capability-scoped agency access
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select carl from ids), 'aal1', 'select id from public.credentials'),
  2, 'a credentialing officer sees shared credentials');
select is(pg_temp.count_as((select rita from ids), 'aal1', 'select id from public.credentials'),
  2, 'a recruiter sees shared credential metadata');
select is(pg_temp.count_as((select rita from ids), 'aal2', 'select credential_id from public.credential_identifiers'),
  0, 'a recruiter never sees credential numbers');
select is(pg_temp.count_as((select carl from ids), 'aal1', 'select credential_id from public.credential_identifiers'),
  0, 'credential numbers require an AAL2 review session');
select is(pg_temp.count_as((select carl from ids), 'aal2', 'select credential_id from public.credential_identifiers'),
  1, 'a reviewer at AAL2 sees shared credential numbers');
select is(pg_temp.count_as((select sam from ids), 'aal2', 'select id from public.credentials'),
  0, 'a scheduler cannot read credentials (compliance outcome only)');
select is((select count(*)::int from public.audit_events where metadata::text like '%RN-SECRET-4411%'),
  0, 'credential numbers never enter audit metadata');

-- ---------------------------------------------------------------------------
-- F/G. Verification trust boundaries
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ select pg_temp.verify(%L, %L, %L) $$, (select wendy from ids), (select bls ->> 'credential_version_id' from c), (select alpha from orgs)),
  'CH403', null, 'a worker cannot verify their own credential');
create temp table own as select pg_temp.evidence((select carl from ids), 'cpr_certification', null, null, current_date - 5, current_date + 300) as cpr;
select pg_temp.share_credential((select carl from ids), (select cpr ->> 'credential_id' from own)::uuid, (select alpha from orgs));
select throws_ok(
  format($$ select pg_temp.verify(%L, %L, %L) $$, (select carl from ids), (select cpr ->> 'credential_version_id' from own), (select alpha from orgs)),
  'CH403', null, 'a credentialing officer cannot verify their own credential');
select throws_ok(
  format($$ select pg_temp.verify(%L, %L, %L) $$, (select bob from ids), (select bls ->> 'credential_version_id' from c), (select alpha from orgs)),
  'CH403', null, 'Agency B cannot record a verification for Agency A');
select throws_ok(
  format($$ select pg_temp.verify(%L, %L, %L) $$, (select bob from ids), (select bls ->> 'credential_version_id' from c), (select beta from orgs)),
  'CH403', null, 'Agency B cannot verify a credential not shared with it');
select throws_ok(
  format($$ select pg_temp.scalar_as(%L, 'aal1', format('select public.record_credential_verification(%%L, %%L, ''verified'')', %L, %L)) $$,
    (select carl from ids), (select bls ->> 'credential_version_id' from c), (select alpha from orgs)),
  'CH402', null, 'verification requires AAL2');
select throws_ok(
  format($$ select pg_temp.verify(%L, %L, %L) $$, (select carl from ids), (select rn ->> 'credential_version_id' from c), (select alpha from orgs)),
  'CH409', null, 'draft versions cannot be verified');
select throws_ok(
  format($$ select pg_temp.verify(%L, %L, %L, 'rejected') $$, (select carl from ids), (select bls ->> 'credential_version_id' from c), (select alpha from orgs)),
  'CH400', null, 'rejections require a structured reason');
select lives_ok(
  format($$ select pg_temp.verify(%L, %L, %L) $$, (select carl from ids), (select bls ->> 'credential_version_id' from c), (select alpha from orgs)),
  'a credentialing officer verifies a shared, submitted, cleared credential');
select is(
  (select actor_membership_id from public.credential_verifications where credential_version_id = (select (bls ->> 'credential_version_id')::uuid from c)),
  pg_temp.membership_of((select alpha from orgs), (select carl from ids)),
  'the verifying membership is recorded');
select throws_ok(
  format($$ insert into public.credential_verifications (credential_id, credential_version_id, profile_id, agency_organisation_id, outcome, actor_membership_id)
            values (%L, %L, %L, %L, 'verified', %L) $$,
    (select bls ->> 'credential_id' from c), (select bls ->> 'credential_version_id' from c), (select wendy from ids),
    (select alpha from orgs), pg_temp.membership_of((select beta from orgs), (select bob from ids))),
  '23503', null, 'a verification actor must be a membership of the verifying agency (structural)');

-- The worker sees the outcome; Beta sees nothing of Alpha's decision.
select pg_temp.share_credential((select wendy from ids), (select bls ->> 'credential_id' from c)::uuid, (select beta from orgs));
select is(pg_temp.count_as((select wendy from ids), 'aal1', 'select id from public.credential_verifications'),
  1, 'the worker sees verification outcomes about their credential');
select is(pg_temp.count_as((select bob from ids), 'aal2', 'select id from public.credential_verifications'),
  0, 'Agency B never sees Agency A''s verification decisions');

-- ---------------------------------------------------------------------------
-- O. Verification history is append-only
-- ---------------------------------------------------------------------------
select throws_ok($$ update public.credential_verifications set outcome = 'rejected' $$,
  'CH409', null, 'verification history cannot be rewritten (owner role)');
select throws_ok($$ delete from public.credential_verifications $$,
  'CH409', null, 'verification history cannot be deleted (owner role)');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', 'update public.credential_verifications set outcome = ''verified''') $$, (select carl from ids)),
  '42501', null, 'verification history cannot be written through the API');

-- ---------------------------------------------------------------------------
-- Versioning and renewal
-- ---------------------------------------------------------------------------
create temp table rv as
select pg_temp.scalar_as((select wendy from ids), 'aal1', format(
  'select public.create_credential_version(%L, %L::date, %L::date)',
  (select bls ->> 'credential_id' from c), current_date, current_date + 730))::uuid as v2;
select is(
  (select array_agg(version_number order by version_number) from public.credential_versions
    where credential_id = (select (bls ->> 'credential_id')::uuid from c)),
  array[1, 2], 'renewal creates version 2 and preserves version 1');
select throws_ok(
  format($$ select pg_temp.scalar_as(%L, 'aal1', format('select public.create_credential_version(%%L, current_date, current_date + 30)', %L)) $$,
    (select wendy from ids), (select bls ->> 'credential_id' from c)),
  '23505', null, 'only one draft version at a time');
select throws_ok(
  format($$ select pg_temp.submit(%L, %L) $$, (select wendy from ids), (select v2 from rv)),
  'CH409', null, 'a version requiring a document cannot be submitted without one');
select throws_ok(
  format($$ update public.credential_versions set expiry_date = current_date + 9999 where id = %L $$, (select bls ->> 'credential_version_id' from c)),
  'CH409', null, 'submitted versions are immutable (owner role)');
select throws_ok(
  format($$ delete from public.credential_versions where id = %L $$, (select bls ->> 'credential_version_id' from c)),
  'CH409', null, 'versions are never deleted');

-- ---------------------------------------------------------------------------
-- R. Immutable ownership / structure
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ update public.credentials set profile_id = %L where id = %L $$, (select walt from ids), (select bls ->> 'credential_id' from c)),
  'CH409', null, 'credential ownership is immutable');
select throws_ok(
  format($$ update public.credentials set credential_type_key = 'acls_certification' where id = %L $$, (select bls ->> 'credential_id' from c)),
  'CH409', null, 'credential type is immutable');
select throws_ok(
  format($$ insert into public.credential_shares (credential_id, profile_id, agency_organisation_id, membership_id) values (%L, %L, %L, %L) $$,
    (select rn ->> 'credential_id' from c), (select wendy from ids), (select beta from orgs), pg_temp.membership_of((select beta from orgs), (select bob from ids))),
  '23503', null, 'a share cannot bind another person''s membership');

-- ---------------------------------------------------------------------------
-- H. Revocation removes access immediately
-- ---------------------------------------------------------------------------
select pg_temp.exec_as((select wendy from ids), 'aal1', format('select public.revoke_credential_share(%L)',
  (select id from public.credential_shares where credential_id = (select (rn ->> 'credential_id')::uuid from c) and agency_organisation_id = (select alpha from orgs))));
select is(pg_temp.count_as((select carl from ids), 'aal2',
    format('select id from public.credentials where id = %L', (select rn ->> 'credential_id' from c))),
  0, 'a revoked share removes agency access');
select is(pg_temp.count_as((select carl from ids), 'aal2', 'select credential_id from public.credential_identifiers'),
  0, 'a revoked share hides the number');
select pg_temp.exec_as((select alice from ids), 'aal2', format('select public.set_membership_status(%L, ''suspended'')',
  pg_temp.membership_of((select alpha from orgs), (select wendy from ids))));
select is(pg_temp.count_as((select carl from ids), 'aal2', 'select id from public.credentials where profile_id <> auth.uid()'),
  0, 'a suspended worker membership removes agency access to all their credentials');

select * from finish();
rollback;
