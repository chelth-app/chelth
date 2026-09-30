-- =============================================================================
-- Credential documents & Storage (P0-E4-S1)
-- E scheduler no documents · M facility no documents · N history immutable
-- P Storage policies == table authorization (every actor, every trust state)
-- Q audited access gate · malware/trust gate · upload validation · private bucket
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql

select plan(47);

create temp table ids as
select
  pg_temp.create_user('alice@example.test') as alice,   -- Alpha admin
  pg_temp.create_user('carl@example.test')  as carl,    -- Alpha credentialing officer
  pg_temp.create_user('rita@example.test')  as rita,    -- Alpha recruiter
  pg_temp.create_user('sam@example.test')   as sam,     -- Alpha scheduler
  pg_temp.create_user('bob@example.test')   as bob,     -- Beta admin
  pg_temp.create_user('wendy@example.test') as wendy,   -- worker (owner)
  pg_temp.create_user('walt@example.test')  as walt,    -- other worker
  pg_temp.create_user('fiona@example.test') as fiona,   -- facility admin
  pg_temp.create_user('erin@example.test')  as erin;    -- platform admin
grant select on ids to authenticated;

create temp table orgs as
select
  pg_temp.create_org_as((select alice from ids), 'Alpha Agency', 'alpha-agency') as alpha,
  pg_temp.create_org_as((select bob from ids),   'Beta Agency',  'beta-agency')  as beta,
  pg_temp.create_facility_org('Gamma Hospital', 'gamma-hospital') as gamma;
grant select on orgs to authenticated;
select pg_temp.add_member((select alpha from orgs), (select carl from ids),  'agency.credentialing_officer');
select pg_temp.add_member((select alpha from orgs), (select rita from ids),  'agency.recruiter');
select pg_temp.add_member((select alpha from orgs), (select sam from ids),   'agency.scheduler');
select pg_temp.add_member((select alpha from orgs), (select wendy from ids), 'agency.healthcare_worker');
select pg_temp.add_member((select alpha from orgs), (select walt from ids),  'agency.healthcare_worker');
select pg_temp.add_member((select gamma from orgs), (select fiona from ids), 'facility.admin');
select internal.grant_platform_admin((select erin from ids), 'Test Operator', 'fixture');

create temp table c as
select pg_temp.new_credential((select wendy from ids), 'bls_certification', null, null, current_date - 10, current_date + 500) as bls;
select pg_temp.share_credential((select wendy from ids), (select bls ->> 'credential_id' from c)::uuid, (select alpha from orgs));
grant select on c to authenticated;

-- ---------------------------------------------------------------------------
-- Bucket and upload validation
-- ---------------------------------------------------------------------------
select is(
  (select jsonb_build_object('public', public, 'limit', file_size_limit, 'types', allowed_mime_types)
     from storage.buckets where id = 'credential-documents'),
  jsonb_build_object('public', false, 'limit', 10485760,
                     'types', array['application/pdf', 'image/jpeg', 'image/png']),
  'the credential bucket is private, 10 MiB, PDF/JPEG/PNG only');
select is((select count(*)::int from storage.buckets where public), 0, 'no public buckets exist');

select throws_ok(
  format($$ select pg_temp.query_as(%L, 'aal1', format('select * from public.begin_credential_document_upload(%%L, ''text/html'', 100)', %L)) $$,
    (select wendy from ids), (select bls ->> 'credential_version_id' from c)),
  '23514', null, 'disallowed MIME types are rejected in the database');
select throws_ok(
  format($$ select pg_temp.query_as(%L, 'aal1', format('select * from public.begin_credential_document_upload(%%L, ''application/pdf'', 10485761)', %L)) $$,
    (select wendy from ids), (select bls ->> 'credential_version_id' from c)),
  '23514', null, 'oversized files are rejected in the database');
select throws_ok(
  format($$ select pg_temp.query_as(%L, 'aal1', format('select * from public.begin_credential_document_upload(%%L, ''application/pdf'', 100)', %L)) $$,
    (select walt from ids), (select bls ->> 'credential_version_id' from c)),
  'CH403', null, 'only the owner can upload to their credential');

-- Upload: owner may write only into their own pending path.
create temp table d as
select (pg_temp.query_as((select wendy from ids), 'aal1', format(
  'select * from public.begin_credential_document_upload(%L, ''application/pdf'', 2048)', (select bls ->> 'credential_version_id' from c))) -> 0) as doc;
grant select on d to authenticated;

select is((select doc ->> 'object_path' from d),
  (select wendy from ids)::text || '/' || (select bls ->> 'credential_id' from c) || '/' || (select bls ->> 'credential_version_id' from c) || '/' || (select doc ->> 'document_id' from d),
  'object paths are opaque identifiers only (no names or PII)');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal1', format('insert into storage.objects (bucket_id, name, owner) values (''credential-documents'', %%L, auth.uid())', %L)) $$,
    (select walt from ids), (select doc ->> 'object_path' from d)),
  '42501', null, 'another user cannot upload into someone else''s document path');
select lives_ok(
  format($$ select pg_temp.exec_as(%L, 'aal1', format('insert into storage.objects (bucket_id, name, owner) values (''credential-documents'', %%L, auth.uid())', %L)) $$,
    (select wendy from ids), (select doc ->> 'object_path' from d)),
  'the owner can upload into their pending document path');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal1', 'insert into storage.objects (bucket_id, name, owner) values (''credential-documents'', ''guess/path'', auth.uid())') $$,
    (select wendy from ids)),
  '42501', null, 'uploads to arbitrary paths are refused');

select is(
  pg_temp.scalar_as((select wendy from ids), 'aal1', format('select public.complete_credential_document_upload(%L, %L, true)',
    (select doc ->> 'document_id' from d), repeat('b', 64))),
  'scanning', 'a completed upload is scanning — not trusted');
select throws_ok(
  format($$ select pg_temp.scalar_as(%L, 'aal1', format('select public.complete_credential_document_upload(%%L, %%L, true)', %L, %L)) $$,
    (select wendy from ids), (select doc ->> 'document_id' from d), repeat('b', 64)),
  'CH409', null, 'an upload cannot be completed twice');

-- ---------------------------------------------------------------------------
-- P. Storage == table, per actor, while SCANNING (untrusted)
-- ---------------------------------------------------------------------------
create function pg_temp.visibility(p_user uuid, p_aal text) returns text language sql as $$
  select pg_temp.count_as(p_user, p_aal, format('select id from public.credential_documents where id = %L', (select doc ->> 'document_id' from d)))
      || '/' ||
         pg_temp.count_as(p_user, p_aal, format('select id from storage.objects where bucket_id = ''credential-documents'' and name = %L', (select doc ->> 'object_path' from d)))
$$;

select is(pg_temp.visibility((select wendy from ids), 'aal1'), '1/1', 'scanning: owner sees table row and object');
select is(pg_temp.visibility((select carl from ids), 'aal2'), '0/0', 'scanning: reviewer sees neither (untrusted evidence)');
select is(pg_temp.visibility((select sam from ids), 'aal2'), '0/0', 'scanning: scheduler sees neither');

-- The scanner clears it.
select pg_temp.scan((select (doc ->> 'document_id')::uuid from d));

-- ---------------------------------------------------------------------------
-- P. Storage == table, per actor, once CLEAN
-- ---------------------------------------------------------------------------
select is(pg_temp.visibility((select wendy from ids), 'aal1'), '1/1', 'clean: owner');
select is(pg_temp.visibility((select carl from ids), 'aal2'), '1/1', 'clean: credentialing officer at AAL2');
select is(pg_temp.visibility((select carl from ids), 'aal1'), '0/0', 'clean: credentialing officer at AAL1 (review is privileged)');
select is(pg_temp.visibility((select alice from ids), 'aal2'), '1/1', 'clean: agency admin at AAL2');
select is(pg_temp.visibility((select rita from ids), 'aal2'), '0/0', 'clean: recruiter (credential.view is metadata only)');
select is(pg_temp.visibility((select sam from ids), 'aal2'), '0/0', 'E. clean: scheduler cannot access documents');
select is(pg_temp.visibility((select walt from ids), 'aal2'), '0/0', 'clean: another worker');
select is(pg_temp.visibility((select bob from ids), 'aal2'), '0/0', 'clean: another agency');
select is(pg_temp.visibility((select fiona from ids), 'aal2'), '0/0', 'M. clean: facility users cannot access documents');
select is(pg_temp.visibility((select erin from ids), 'aal2'), '0/0', 'S. clean: platform admin has no path');

-- ---------------------------------------------------------------------------
-- Q. The audited access gate
-- ---------------------------------------------------------------------------
select is(
  pg_temp.query_as((select carl from ids), 'aal2', format('select * from public.authorize_credential_document_access(%L, %L)',
    (select doc ->> 'document_id' from d), (select alpha from orgs))) -> 0 ->> 'object_path',
  (select doc ->> 'object_path' from d), 'an authorised reviewer receives the object path');
select is(
  (select count(*)::int from public.audit_events
    where action = 'credential.document_accessed' and actor_profile_id = (select carl from ids)
      and organisation_id = (select alpha from orgs)),
  1, 'document access is audited in the agency');
select is(
  pg_temp.query_as((select sam from ids), 'aal2', format('select * from public.authorize_credential_document_access(%L, %L)',
    (select doc ->> 'document_id' from d), (select alpha from orgs))),
  '[]'::jsonb, 'an unauthorised role receives nothing');
select is(
  (select count(*)::int from public.audit_events
    where action = 'credential.document_access_denied' and actor_profile_id = (select sam from ids)),
  1, 'denied document access is audited');
select is(
  pg_temp.query_as((select bob from ids), 'aal2', format('select * from public.authorize_credential_document_access(%L, %L)',
    (select doc ->> 'document_id' from d), (select beta from orgs))),
  '[]'::jsonb, 'another agency receives nothing (credential not shared with it)');
select is(
  pg_temp.query_as((select wendy from ids), 'aal1', format('select * from public.authorize_credential_document_access(%L)',
    (select doc ->> 'document_id' from d))) -> 0 ->> 'object_path',
  (select doc ->> 'object_path' from d), 'the owner may access their own document');
select is(
  (select count(*)::int from public.audit_events a where a.metadata::text like '%' || (select doc ->> 'object_path' from d) || '%'),
  0, 'object paths (and therefore URLs) never enter audit metadata');

-- ---------------------------------------------------------------------------
-- Malware / trust gate
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'internal.record_document_scan_result(uuid,public.document_status,text)', 'execute'),
  'no API role can mark a document clean');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', format('update public.credential_documents set status = ''clean'' where id = %%L', %L)) $$,
    (select wendy from ids), (select doc ->> 'document_id' from d)),
  '42501', null, 'documents cannot be marked clean through the API');

create temp table q as
select pg_temp.upload_document((select wendy from ids), (select (bls ->> 'credential_version_id')::uuid from c)) as doc_id;
select pg_temp.scan((select doc_id from q), 'quarantined');
select is(pg_temp.count_as((select wendy from ids), 'aal1',
    format('select id from public.credential_documents where id = %L', (select doc_id from q))),
  0, 'quarantined documents are hidden even from the owner');
select is(
  pg_temp.query_as((select wendy from ids), 'aal1', format('select * from public.authorize_credential_document_access(%L)', (select doc_id from q))),
  '[]'::jsonb, 'quarantined documents cannot be downloaded');

create temp table bad as
select pg_temp.upload_document((select wendy from ids), (select (bls ->> 'credential_version_id')::uuid from c), false) as doc_id;
select is((select status::text from public.credential_documents where id = (select doc_id from bad)),
  'rejected', 'content that fails the server check is rejected');
select is(
  pg_temp.count_as((select wendy from ids), 'aal1',
    format('select id from storage.objects where name = (select storage_path from public.credential_documents where id = %L)', (select doc_id from bad))),
  0, 'rejected objects are not readable, even by the owner');

-- ---------------------------------------------------------------------------
-- N. History cannot be overwritten or deleted
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ update public.credential_documents set status = 'scanning' where id = %L $$, (select doc ->> 'document_id' from d)),
  'CH409', null, 'a clean document cannot move back to scanning');
select throws_ok(
  format($$ update public.credential_documents set sha256 = %L where id = %L $$, repeat('c', 64), (select doc ->> 'document_id' from d)),
  'CH409', null, 'a recorded content hash cannot be changed');
select throws_ok(
  format($$ delete from public.credential_documents where id = %L $$, (select doc ->> 'document_id' from d)),
  'CH409', null, 'documents are never deleted');
select is(
  pg_temp.scalar_as((select wendy from ids), 'aal1', format(
    'with u as (update storage.objects set metadata = ''{}''::jsonb where name = %L returning 1) select count(*) from u',
    (select doc ->> 'object_path' from d))),
  '0', 'stored objects cannot be overwritten in place (no UPDATE policy)');
select throws_like(
  format($$ select pg_temp.exec_as(%L, 'aal1', format('delete from storage.objects where name = %%L', %L)) $$,
    (select wendy from ids), (select doc ->> 'object_path' from d)),
  '%Use the Storage API%', 'raw SQL deletion of stored objects is refused by Storage');
select is(
  pg_temp.scalar_as((select wendy from ids), 'aal1', format('select authz.can_delete_credential_object(%L)', (select doc ->> 'object_path' from d))),
  'false', 'the Storage delete policy refuses cleared evidence, even for the owner');
select is(
  pg_temp.scalar_as((select wendy from ids), 'aal1', format('select authz.can_delete_credential_object(storage_path) from public.credential_documents where id = %L',
    (select doc_id from bad))),
  null, 'rejected document rows are not even visible to the owner');
select is(
  pg_temp.scalar_as((select wendy from ids), 'aal1', format('select authz.can_delete_credential_object(%L)',
    (select storage_path from public.credential_documents where id = (select doc_id from bad)))),
  'true', 'the Storage delete policy allows the owner to remove a rejected upload');

-- Documents cannot be added once a version is submitted.
select pg_temp.submit((select wendy from ids), (select (bls ->> 'credential_version_id')::uuid from c));
select throws_ok(
  format($$ select pg_temp.query_as(%L, 'aal1', format('select * from public.begin_credential_document_upload(%%L, ''application/pdf'', 100)', %L)) $$,
    (select wendy from ids), (select bls ->> 'credential_version_id' from c)),
  'CH409', null, 'submitted versions accept no new documents');

-- H. Revoked share hides documents immediately (table and Storage).
select pg_temp.exec_as((select wendy from ids), 'aal1', format('select public.revoke_credential_share(%L)',
  (select id from public.credential_shares where credential_id = (select (bls ->> 'credential_id')::uuid from c))));
select is(pg_temp.visibility((select carl from ids), 'aal2'), '0/0', 'a revoked share removes document access in both layers');

select * from finish();
rollback;
