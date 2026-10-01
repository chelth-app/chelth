-- =============================================================================
-- Compliance engine & facility visibility (P0-E4-S1)
-- I expired ≠ compliant · J missing fails · K facility requirement scope
-- L facility gets only the narrow projection · requirement tampering
-- every reason code · renewal / stale verification · multi-agency trust
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql

select plan(52);

create temp table ids as
select
  pg_temp.create_user('alice@example.test') as alice,   -- Alpha admin
  pg_temp.create_user('carl@example.test')  as carl,    -- Alpha credentialing officer
  pg_temp.create_user('sam@example.test')   as sam,     -- Alpha scheduler
  pg_temp.create_user('bob@example.test')   as bob,     -- Beta admin
  pg_temp.create_user('wendy@example.test') as wendy,   -- worker at Alpha and Beta
  pg_temp.create_user('walt@example.test')  as walt,    -- other Alpha worker
  pg_temp.create_user('fiona@example.test') as fiona,   -- Gamma facility admin (linked to Mercy)
  pg_temp.create_user('fred@example.test')  as fred,    -- Gamma supervisor (no credential.view)
  pg_temp.create_user('dora@example.test')  as dora,    -- Delta facility admin (unrelated)
  pg_temp.create_user('erin@example.test')  as erin;    -- platform admin
grant select on ids to authenticated;

create temp table orgs as
select
  pg_temp.create_org_as((select alice from ids), 'Alpha Agency', 'alpha-agency') as alpha,
  pg_temp.create_org_as((select bob from ids),   'Beta Agency',  'beta-agency')  as beta,
  pg_temp.create_facility_org('Gamma Health', 'gamma-health') as gamma,
  pg_temp.create_facility_org('Delta Care', 'delta-care') as delta;
grant select on orgs to authenticated;
select pg_temp.add_member((select alpha from orgs), (select carl from ids),  'agency.credentialing_officer');
select pg_temp.add_member((select alpha from orgs), (select sam from ids),   'agency.scheduler');
select pg_temp.add_member((select alpha from orgs), (select wendy from ids), 'agency.healthcare_worker');
select pg_temp.add_member((select beta from orgs),  (select wendy from ids), 'agency.healthcare_worker');
select pg_temp.add_member((select alpha from orgs), (select walt from ids),  'agency.healthcare_worker');
select pg_temp.add_member((select gamma from orgs), (select fiona from ids), 'facility.admin');
select pg_temp.add_member((select gamma from orgs), (select fred from ids),  'facility.supervisor');
select pg_temp.add_member((select delta from orgs), (select dora from ids),  'facility.admin');
select internal.grant_platform_admin((select erin from ids), 'Test Operator', 'fixture');

create temp table w as
select pg_temp.worker_of((select alpha from orgs), (select wendy from ids)) as alpha_w,
       pg_temp.worker_of((select beta from orgs),  (select wendy from ids)) as beta_w;
grant select on w to authenticated;

-- Client facilities (Alpha: Mercy, Riverside; Beta: Beta Client).
create temp table f as
select
  pg_temp.scalar_as((select alice from ids), 'aal2', format('select public.create_agency_facility(%L, ''Mercy Rehab'', ''rehabilitation'', ''America/New_York'')', (select alpha from orgs)))::uuid as mercy,
  pg_temp.scalar_as((select alice from ids), 'aal2', format('select public.create_agency_facility(%L, ''Riverside'', ''hospital'', ''America/New_York'')', (select alpha from orgs)))::uuid as riverside,
  pg_temp.scalar_as((select bob from ids), 'aal2', format('select public.create_agency_facility(%L, ''Beta Client'', ''clinic'', ''UTC'')', (select beta from orgs)))::uuid as beta_client;
grant select on f to authenticated;

-- Requirements: Alpha baseline BLS (all) + CNA licence for CNAs in Georgia; Mercy adds orientation and 60-day BLS validity.
create function pg_temp.requirement(p_user uuid, p_org uuid, p_type text, p_facility uuid default null,
  p_discipline text default null, p_min integer default 0, p_jurisdiction text default null)
returns uuid language sql as $$
  select pg_temp.scalar_as(p_user, 'aal2', format(
    'select public.create_credential_requirement(%L, %L, current_date - 30, %L, %L, true, %s, 30, %L)',
    p_org, p_type, p_facility, p_discipline, p_min, p_jurisdiction))::uuid
$$;

select pg_temp.requirement((select alice from ids), (select alpha from orgs), 'bls_certification');
select pg_temp.requirement((select carl from ids),  (select alpha from orgs), 'cna_certification', null, 'cna', 0, 'US-GA');
select pg_temp.requirement((select carl from ids),  (select alpha from orgs), 'facility_orientation', (select mercy from f));
select pg_temp.requirement((select carl from ids),  (select alpha from orgs), 'bls_certification', (select mercy from f), null, 60);
select pg_temp.requirement((select bob from ids),   (select beta from orgs),  'bls_certification');

-- ---------------------------------------------------------------------------
-- Requirement tampering
-- ---------------------------------------------------------------------------
select throws_ok(format($$ select pg_temp.requirement(%L, %L, 'acls_certification') $$, (select sam from ids), (select alpha from orgs)),
  'CH403', null, 'a scheduler cannot create requirements');
select throws_ok(format($$ select pg_temp.requirement(%L, %L, 'acls_certification') $$, (select bob from ids), (select alpha from orgs)),
  'CH403', null, 'another agency cannot create requirements for Alpha');
select throws_ok(format($$ select pg_temp.requirement(%L, %L, 'acls_certification', %L) $$, (select alice from ids), (select alpha from orgs), (select beta_client from f)),
  'CH403', null, 'K. a facility requirement cannot target another agency''s facility');
select throws_ok(format($$ select pg_temp.requirement(%L, %L, 'facility_orientation') $$, (select alice from ids), (select alpha from orgs)),
  'CH400', null, 'facility-specific credentials can only be required by a facility');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', 'update public.credential_requirements set minimum_validity_days = 0') $$, (select alice from ids)),
  '42501', null, 'requirements cannot be edited directly');
select throws_ok($$ delete from public.credential_requirements $$,
  'CH409', null, 'requirements are never deleted (owner role)');

-- ---------------------------------------------------------------------------
-- Worker-level and missing evidence
-- ---------------------------------------------------------------------------
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w)) ->> 'worker:WORKER_NOT_ACTIVE',
  'WORKER_NOT_ACTIVE', 'an onboarding worker is not deployable');
update public.agency_workers set status = 'active' where id in ((select alpha_w from w), (select beta_w from w));

select is(pg_temp.reasons((select alice from ids), (select alpha_w from w)),
  '{"bls_certification": "MISSING_CREDENTIAL", "worker:DISCIPLINE_NOT_SET": "DISCIPLINE_NOT_SET"}'::jsonb,
  'J. missing credentials fail; discipline-specific requirements prompt for a discipline');
select is(pg_temp.readiness((select alice from ids), (select alpha_w from w)), 'not_eligible',
  'J. missing credential ⇒ not eligible');

select pg_temp.exec_as((select alice from ids), 'aal2', format('select public.set_agency_worker_discipline(%L, ''cna'', true)', (select alpha_w from w)));
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w)),
  '{"bls_certification": "MISSING_CREDENTIAL", "cna_certification": "MISSING_CREDENTIAL"}'::jsonb,
  'discipline requirements apply once the discipline is set');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', format('select public.set_agency_worker_discipline(%%L, ''rn'', true)', %L)) $$,
    (select sam from ids), (select alpha_w from w)),
  'CH403', null, 'a scheduler cannot change disciplines');

-- ---------------------------------------------------------------------------
-- Evidence progression: not shared → not submitted → not cleared → unverified → met
-- ---------------------------------------------------------------------------
create temp table c as
select pg_temp.new_credential((select wendy from ids), 'bls_certification', null, null, current_date - 30, current_date + 400) as bls;
grant select on c to authenticated;

select is(pg_temp.reasons((select alice from ids), (select alpha_w from w)) ->> 'bls_certification',
  'CREDENTIAL_NOT_SHARED', 'a credential the worker has not shared does not count');
select pg_temp.share_credential((select wendy from ids), (select (bls ->> 'credential_id')::uuid from c), (select alpha from orgs));
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w)) ->> 'bls_certification',
  'NOT_SUBMITTED', 'a draft does not count');

create temp table doc as select pg_temp.upload_document((select wendy from ids), (select (bls ->> 'credential_version_id')::uuid from c)) as id;
select pg_temp.submit((select wendy from ids), (select (bls ->> 'credential_version_id')::uuid from c));
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w)) ->> 'bls_certification',
  'DOCUMENT_NOT_CLEARED', 'an unscanned document is not trusted evidence');
select throws_ok(
  format($$ select pg_temp.verify(%L, %L, %L) $$, (select carl from ids), (select bls ->> 'credential_version_id' from c), (select alpha from orgs)),
  'CH409', null, 'unscanned evidence cannot be verified');

select pg_temp.scan((select id from doc));
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w)) ->> 'bls_certification',
  'UNVERIFIED_CREDENTIAL', 'cleared but unverified evidence does not satisfy a verified requirement');

select pg_temp.verify((select carl from ids), (select (bls ->> 'credential_version_id')::uuid from c), (select alpha from orgs), 'rejected', 'document_illegible');
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w)) ->> 'bls_certification',
  'VERIFICATION_REJECTED', 'a rejected verification is reported as such');
select pg_temp.verify((select carl from ids), (select (bls ->> 'credential_version_id')::uuid from c), (select alpha from orgs));
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w)) ->> 'bls_certification',
  'MET', 'a later verification supersedes the rejection (history kept)');
select is((select count(*)::int from public.credential_verifications where credential_version_id = (select (bls ->> 'credential_version_id')::uuid from c)),
  2, 'both verification events are preserved');

-- ---------------------------------------------------------------------------
-- I. Expiry: evaluated by date, never stored
-- ---------------------------------------------------------------------------
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w), null, current_date + 380) ->> 'bls_certification',
  'EXPIRING_SOON', 'within the warning window the credential is met-with-warning');
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w), null, current_date + 400) ->> 'bls_certification',
  'EXPIRING_SOON', 'valid through the expiry date itself');
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w), null, current_date + 401) ->> 'bls_certification',
  'EXPIRED_CREDENTIAL', 'I. the day after expiry the credential is expired');
select is(pg_temp.readiness((select alice from ids), (select alpha_w from w), null, current_date + 401), 'not_eligible',
  'I. an expired credential is never compliant');

-- Default validity from type (TB screening: 12 months from issue).
create temp table tb as select pg_temp.evidence((select wendy from ids), 'tb_screening', null, null, current_date - 380, null) as ev;
select pg_temp.share_credential((select wendy from ids), (select (ev ->> 'credential_id')::uuid from tb), (select alpha from orgs));
select pg_temp.requirement((select alice from ids), (select alpha from orgs), 'tb_screening');
select pg_temp.verify((select carl from ids), (select (ev ->> 'credential_version_id')::uuid from tb), (select alpha from orgs));
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w)) ->> 'tb_screening',
  'EXPIRED_CREDENTIAL', 'a screening older than its validity period is expired');

-- ---------------------------------------------------------------------------
-- Renewal: new version, old evidence kept; stale verification never carries over
-- ---------------------------------------------------------------------------
create temp table rv as
select pg_temp.scalar_as((select wendy from ids), 'aal1', format(
  'select public.create_credential_version(%L, current_date, current_date + 730)', (select bls ->> 'credential_id' from c)))::uuid as v2;
select pg_temp.scan(pg_temp.upload_document((select wendy from ids), (select v2 from rv)));
select pg_temp.submit((select wendy from ids), (select v2 from rv));
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w)) ->> 'bls_certification',
  'MET', 'the verified version 1 still satisfies the requirement while version 2 awaits review');
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w), null, current_date + 450) ->> 'bls_certification',
  'UNVERIFIED_CREDENTIAL', 'after v1 expires, v2 does NOT inherit v1''s verification');
select pg_temp.verify((select carl from ids), (select v2 from rv), (select alpha from orgs));
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w), null, current_date + 450) ->> 'bls_certification',
  'MET', 'verifying the renewal restores compliance');

-- ---------------------------------------------------------------------------
-- Jurisdiction and minimum validity
-- ---------------------------------------------------------------------------
create temp table cna as select pg_temp.evidence((select wendy from ids), 'cna_certification', 'US-FL', 'CNA-FL-1', null, current_date + 500) as ev;
select pg_temp.share_credential((select wendy from ids), (select (ev ->> 'credential_id')::uuid from cna), (select alpha from orgs));
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w)) ->> 'cna_certification',
  'WRONG_JURISDICTION', 'a licence from another state does not satisfy a Georgia requirement');

create temp table cna_ga as select pg_temp.evidence((select wendy from ids), 'cna_certification', 'US-GA', 'CNA-GA-1', null, current_date + 500) as ev;
select pg_temp.share_credential((select wendy from ids), (select (ev ->> 'credential_id')::uuid from cna_ga), (select alpha from orgs));
select pg_temp.verify((select carl from ids), (select (ev ->> 'credential_version_id')::uuid from cna_ga), (select alpha from orgs));
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w)) ->> 'cna_certification',
  'MET', 'the Georgia licence satisfies the Georgia requirement');

-- ---------------------------------------------------------------------------
-- K. Facility requirements apply only to their facility
-- ---------------------------------------------------------------------------
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w), (select mercy from f)) ->> 'facility:facility_orientation',
  'MISSING_CREDENTIAL', 'Mercy requires orientation');
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w), (select riverside from f)) ? 'facility:facility_orientation',
  false, 'K. Mercy''s requirement does not apply at Riverside');
select is(pg_temp.readiness((select alice from ids), (select alpha_w from w)), 'not_eligible',
  'agency readiness is independent of facility add-ons (TB expired)');

create temp table ori as select pg_temp.evidence((select wendy from ids), 'facility_orientation', null, null, current_date - 2, null) as ev;
select pg_temp.share_credential((select wendy from ids), (select (ev ->> 'credential_id')::uuid from ori), (select alpha from orgs));
select pg_temp.verify((select carl from ids), (select (ev ->> 'credential_version_id')::uuid from ori), (select alpha from orgs), 'verified', null, (select riverside from f));
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w), (select mercy from f)) ->> 'facility:facility_orientation',
  'UNVERIFIED_CREDENTIAL', 'an orientation verified for Riverside does not count at Mercy');
select pg_temp.verify((select carl from ids), (select (ev ->> 'credential_version_id')::uuid from ori), (select alpha from orgs), 'verified', null, (select mercy from f));
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w), (select mercy from f)) ->> 'facility:facility_orientation',
  'MET', 'an orientation verified for Mercy counts at Mercy');
select is(pg_temp.reasons((select alice from ids), (select alpha_w from w), (select mercy from f), current_date + 700) ->> 'facility:bls_certification',
  'INSUFFICIENT_VALIDITY', 'Mercy''s 60-day minimum validity is enforced');
select throws_ok(
  format($$ select pg_temp.reasons(%L, %L, %L) $$, (select alice from ids), (select alpha_w from w), (select beta_client from f)),
  'CH403', null, 'a worker cannot be evaluated against another agency''s facility');

-- ---------------------------------------------------------------------------
-- Multi-agency trust: Beta does not inherit Alpha's verification
-- ---------------------------------------------------------------------------
select pg_temp.share_credential((select wendy from ids), (select (bls ->> 'credential_id')::uuid from c), (select beta from orgs));
select is(pg_temp.reasons((select bob from ids), (select beta_w from w)) ->> 'bls_certification',
  'UNVERIFIED_CREDENTIAL', 'Agency B must verify independently; Agency A''s verification does not count');

-- ---------------------------------------------------------------------------
-- Who may read compliance
-- ---------------------------------------------------------------------------
select is(pg_temp.readiness((select sam from ids), (select alpha_w from w)), 'not_eligible',
  'a scheduler can read readiness (compliance.view)');
select is(pg_temp.readiness((select wendy from ids), (select alpha_w from w)), 'not_eligible',
  'the worker can read their own readiness');
select throws_ok(format($$ select pg_temp.readiness(%L, %L) $$, (select walt from ids), (select alpha_w from w)),
  'CH403', null, 'another worker cannot read someone''s readiness');
select throws_ok(format($$ select pg_temp.readiness(%L, %L) $$, (select bob from ids), (select alpha_w from w)),
  'CH403', null, 'another agency cannot read the readiness of Alpha''s worker record');
select throws_ok(format($$ select pg_temp.readiness(%L, %L) $$, (select erin from ids), (select alpha_w from w)),
  'CH403', null, 'platform admins cannot read tenant compliance');

-- ---------------------------------------------------------------------------
-- L/M. Facility sees only an explicit, narrow, relationship-scoped projection
-- ---------------------------------------------------------------------------
create temp table rel as
select pg_temp.scalar_as((select alice from ids), 'aal2', format('select public.create_facility_relationship(%L)', (select mercy from f)))::uuid as id;
grant select on rel to authenticated;
select pg_temp.exec_as((select erin from ids), 'aal2', format('select public.platform_link_agency_facility(%L, %L)', (select mercy from f), (select gamma from orgs)));

select throws_ok(
  format($$ select pg_temp.scalar_as(%L, 'aal2', format('select public.share_worker_compliance(%%L, %%L)', %L, %L)) $$,
    (select carl from ids), (select id from rel), (select alpha_w from w)),
  'CHR09', null, 'compliance is shared only under an active relationship');
select pg_temp.exec_as((select alice from ids), 'aal2', format('select public.set_facility_relationship_status(%L, ''active'')', (select id from rel)));
select throws_ok(
  format($$ select pg_temp.scalar_as(%L, 'aal2', format('select public.share_worker_compliance(%%L, %%L)', %L, %L)) $$,
    (select sam from ids), (select id from rel), (select alpha_w from w)),
  'CH403', null, 'a scheduler cannot present compliance to a facility');
select is(pg_temp.count_as((select fiona from ids), 'aal2', format('select * from public.list_shared_worker_compliance(%L)', (select id from rel))),
  0, 'nothing is visible to the facility before an explicit share');
create temp table cs as
select pg_temp.scalar_as((select carl from ids), 'aal2', format('select public.share_worker_compliance(%L, %L)', (select id from rel), (select alpha_w from w)))::uuid as id;

select is(
  (select array_agg(distinct (key collate "C") order by (key collate "C")) from jsonb_array_elements(
     pg_temp.query_as((select fiona from ids), 'aal2', format('select * from public.list_shared_worker_compliance(%L)', (select id from rel)))) x,
   jsonb_object_keys(x) key),
  array['agency_worker_id', 'credential_type_name', 'effective_expiry_date', 'readiness', 'reason', 'severity', 'worker_display_name'],
  'L. the facility projection has no documents, numbers, verification detail or notes');
select is(
  (select count(distinct x ->> 'agency_worker_id')::int from jsonb_array_elements(
     pg_temp.query_as((select fiona from ids), 'aal2', format('select * from public.list_shared_worker_compliance(%L)', (select id from rel)))) x),
  1, 'L. only explicitly shared workers appear');
select throws_ok(
  format($$ select pg_temp.query_as(%L, 'aal2', format('select * from public.list_shared_worker_compliance(%%L)', %L)) $$, (select dora from ids), (select id from rel)),
  'CH403', null, 'an unrelated facility sees nothing');
select throws_ok(
  format($$ select pg_temp.query_as(%L, 'aal2', format('select * from public.list_shared_worker_compliance(%%L)', %L)) $$, (select fred from ids), (select id from rel)),
  'CH403', null, 'facility members without credential.view see nothing');
select is(pg_temp.count_as((select fiona from ids), 'aal2', 'select id from public.credentials'),
  0, 'M. the facility cannot read credential tables');
select is(
  (select count(*)::int from public.audit_events where action = 'compliance.viewed_by_facility' and organisation_id = (select gamma from orgs)),
  3, 'every facility read of shared compliance is audited in the facility organisation');

select pg_temp.exec_as((select carl from ids), 'aal2', format('select public.revoke_worker_compliance_share(%L)', (select id from cs)));
select is(pg_temp.count_as((select fiona from ids), 'aal2', format('select * from public.list_shared_worker_compliance(%L)', (select id from rel))),
  0, 'revoking the share removes facility visibility');

select * from finish();
rollback;
