-- =============================================================================
-- Credential document malware scanning (P0-E9-2)
-- S1 scanner principal is least-privilege (suspended profile, registry-gated)
-- S2 only a scanner can claim / complete / read health; app identities cannot
-- S3 one claim at a time (lease), stale lease recovery, stale tokens refused
-- S4 scanner reads ONLY documents it holds a live claim on (table == Storage)
-- S5 fail-closed result mapping (integrity, malicious, unscannable, missing)
-- S6 transient retry with backoff → failed (still scanning) → requeue
-- S7 reviewers / facility never see scanning or quarantined documents
-- S8 readiness: only scanner-cleared (clean) evidence counts
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql

select plan(54);

create temp table ids as
select
  pg_temp.create_user('alice@example.test') as alice,     -- Alpha admin
  pg_temp.create_user('carl@example.test')  as carl,      -- Alpha credentialing officer
  pg_temp.create_user('wendy@example.test') as wendy,     -- worker (owner)
  pg_temp.create_user('walt@example.test')  as walt,      -- second worker
  pg_temp.create_user('fiona@example.test') as fiona,     -- facility admin
  pg_temp.create_user('scan@example.test')  as scanner,   -- scanner principal
  pg_temp.create_user('mallory@example.test') as mallory; -- ordinary user, not a scanner
grant select on ids to authenticated;

create temp table orgs as
select
  pg_temp.create_org_as((select alice from ids), 'Alpha Agency', 'alpha-agency') as alpha,
  pg_temp.create_facility_org('Gamma Hospital', 'gamma-hospital') as gamma;
grant select on orgs to authenticated;
select pg_temp.add_member((select alpha from orgs), (select carl from ids),  'agency.credentialing_officer');
select pg_temp.add_member((select alpha from orgs), (select wendy from ids), 'agency.healthcare_worker');
select pg_temp.add_member((select alpha from orgs), (select walt from ids),  'agency.healthcare_worker');
select pg_temp.add_member((select gamma from orgs), (select fiona from ids), 'facility.admin');

-- Alpha baseline requirement: BLS (document required).
select pg_temp.scalar_as((select alice from ids), 'aal2', format(
  'select public.create_credential_requirement(%L, ''bls_certification'', current_date - 30, null, null, true, 0, 30, null)',
  (select alpha from orgs)));

create temp table c as
select
  pg_temp.new_credential((select wendy from ids), 'bls_certification', null, null, current_date - 10, current_date + 500) as w_bls,
  pg_temp.new_credential((select walt from ids),  'bls_certification', null, null, current_date - 10, current_date + 500) as t_bls;
grant select on c to authenticated;
select pg_temp.share_credential((select wendy from ids), (select w_bls ->> 'credential_id' from c)::uuid, (select alpha from orgs));
select pg_temp.share_credential((select walt from ids),  (select t_bls ->> 'credential_id' from c)::uuid, (select alpha from orgs));

-- Helpers -------------------------------------------------------------------
create function pg_temp.claim(p_user uuid, p_limit integer default 5)
returns jsonb language sql as $$
  select pg_temp.query_as(p_user, 'aal1', format('select * from public.claim_document_scans(%s, 300)', p_limit))
$$;
create function pg_temp.complete(p_user uuid, p_doc uuid, p_token uuid, p_outcome text,
  p_sha text default repeat('a', 64), p_code text default null)
returns text language sql as $$
  select pg_temp.scalar_as(p_user, 'aal1', format(
    'select public.complete_document_scan(%L, %L, %L, %L, ''test_engine'', %L)',
    p_doc, p_token, p_outcome, p_sha, p_code))
$$;
create function pg_temp.status(p_doc uuid) returns text language sql as $$
  select status::text || coalesce('/' || status_reason, '') from public.credential_documents where id = p_doc
$$;
create function pg_temp.sees_doc(p_user uuid, p_doc uuid, p_aal text default 'aal1') returns integer language sql as $$
  select (pg_temp.scalar_as(p_user, p_aal, format('select count(*) from public.credential_documents where id = %L', p_doc)))::int
$$;
create function pg_temp.sees_object(p_user uuid, p_doc uuid, p_aal text default 'aal1') returns integer language sql as $$
  select (pg_temp.scalar_as(p_user, p_aal, format(
    'select count(*) from storage.objects where bucket_id = ''credential-documents'' and name = %L',
    (select storage_path from public.credential_documents where id = p_doc))))::int
$$;
-- Owner shortcuts that move the clock for one queue row (test-only time travel).
create function pg_temp.make_due(p_doc uuid) returns void language sql as $$
  update internal.document_scan_queue set next_attempt_at = now() - interval '1 second' where document_id = p_doc
$$;
create function pg_temp.expire_lease(p_doc uuid) returns void language sql as $$
  update internal.document_scan_queue set claimed_until = now() - interval '1 second' where document_id = p_doc
$$;

-- ---------------------------------------------------------------------------
-- S1 scanner principal
-- ---------------------------------------------------------------------------
select internal.register_document_scanner((select scanner from ids), 'pgTAP scanner');

select is((select status::text from public.profiles where id = (select scanner from ids)), 'suspended',
  'registering a scanner suspends its application profile');
select is(pg_temp.scalar_as((select scanner from ids), 'aal1', 'select authz.current_profile_id()'), null,
  'the scanner has no application identity');
select throws_ok(format($$ select pg_temp.exec_as(%L, 'aal1', 'select public.create_organisation(''agency'', ''Scanner Co'', ''scanner-co'')') $$,
  (select scanner from ids)), 'CH401', null, 'the scanner cannot use application RPCs (e.g. create an agency)');
select throws_ok(format($$ select internal.register_document_scanner(%L, 'member') $$, (select carl from ids)),
  'CH409', null, 'an organisation member cannot be registered as a scanner');

-- ---------------------------------------------------------------------------
-- S2 only scanners can use the scanner API
-- ---------------------------------------------------------------------------
create temp table d as
select pg_temp.upload_document((select wendy from ids), (select w_bls ->> 'credential_version_id' from c)::uuid) as d1;
grant select on d to authenticated;

select is((select state from internal.document_scan_queue where document_id = (select d1 from d)), 'pending',
  'entering scanning enqueues the document');

select throws_ok(format($$ select pg_temp.claim(%L) $$, (select wendy from ids)), 'CH403', null,
  'the owner cannot claim scans');
select throws_ok(format($$ select pg_temp.query_as(%L, 'aal2', 'select * from public.claim_document_scans(5, 300)') $$, (select carl from ids)),
  'CH403', null, 'a credential reviewer (AAL2) cannot claim scans');
select throws_ok(format($$ select pg_temp.claim(%L) $$, (select mallory from ids)), 'CH403', null,
  'an ordinary user cannot claim scans');
select throws_ok(format($$ select pg_temp.complete(%L, %L, gen_random_uuid(), 'clean') $$, (select wendy from ids), (select d1 from d)),
  'CH403', null, 'the owner cannot report a scan result');
select throws_ok(format($$ select pg_temp.query_as(%L, 'aal1', 'select * from public.document_scan_health()') $$, (select mallory from ids)),
  'CH403', null, 'scan health is scanner-only');
select ok(not has_function_privilege('anon', 'public.claim_document_scans(integer,integer)', 'execute')
      and not has_function_privilege('anon', 'public.complete_document_scan(uuid,uuid,text,text,text,text)', 'execute'),
  'anon cannot execute the scanner API');
select ok(not has_function_privilege('authenticated', 'internal.record_document_scan_result(uuid,public.document_status,text)', 'execute')
      and not has_function_privilege('authenticated', 'internal.requeue_document_scan(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'internal.register_document_scanner(uuid,text)', 'execute'),
  'no API role can execute the internal scan / operator procedures');
select is(pg_temp.sees_object((select scanner from ids), (select d1 from d)), 0,
  'before claiming, the scanner cannot read the object');

-- ---------------------------------------------------------------------------
-- S3 / S4 claim, lease, visibility
-- ---------------------------------------------------------------------------
create temp table k1 as select pg_temp.claim((select scanner from ids)) as j;
grant select on k1 to authenticated;
select is(jsonb_array_length((select j from k1)), 1, 'the scanner claims the waiting document');
select is((select j -> 0 ->> 'sha256' from k1), repeat('a', 64), 'the claim carries the validated SHA-256');
select is(jsonb_array_length(pg_temp.claim((select scanner from ids))), 0,
  'a document under a live lease is not claimed twice');
select is(pg_temp.sees_doc((select scanner from ids), (select d1 from d)), 1, 'the claimed document row is readable by the scanner');
select is(pg_temp.sees_object((select scanner from ids), (select d1 from d)), 1, 'the claimed object is readable by the scanner (Storage)');
select is(pg_temp.sees_object((select carl from ids), (select d1 from d), 'aal2'), 0, 'a reviewer cannot read a scanning object');
select is(pg_temp.sees_object((select fiona from ids), (select d1 from d)), 0, 'a facility cannot read a scanning object');

select is(pg_temp.complete((select scanner from ids), (select d1 from d), gen_random_uuid(), 'clean'), 'stale_claim',
  'a wrong claim token is refused');

-- Stale lease: the next claim takes it over; the old token is dead.
select pg_temp.expire_lease((select d1 from d));
create temp table k2 as select pg_temp.claim((select scanner from ids)) as j;
grant select on k2 to authenticated;
select is((select (j -> 0 ->> 'attempt')::int from k2), 2, 'an expired lease is reclaimed and counts an attempt');
select is(pg_temp.complete((select scanner from ids), (select d1 from d), (select (j -> 0 ->> 'claim_token')::uuid from k1), 'clean'),
  'stale_claim', 'the superseded claim token can no longer report');

-- ---------------------------------------------------------------------------
-- S5 result mapping
-- ---------------------------------------------------------------------------
select throws_ok(format($$ select pg_temp.complete(%L, %L, %L, 'probably_fine') $$,
  (select scanner from ids), (select d1 from d), (select (j -> 0 ->> 'claim_token')::uuid from k2)),
  'CH400', null, 'arbitrary provider strings are refused');

select is(pg_temp.complete((select scanner from ids), (select d1 from d), (select (j -> 0 ->> 'claim_token')::uuid from k2), 'clean', repeat('b', 64)),
  'quarantined', 'a clean verdict about different bytes (SHA-256 mismatch) quarantines');
select is(pg_temp.status((select d1 from d)), 'quarantined/integrity_mismatch', 'integrity mismatch is recorded');
select is(pg_temp.sees_doc((select wendy from ids), (select d1 from d)), 0, 'the owner cannot read a quarantined document');
select is((select state from internal.document_scan_queue where document_id = (select d1 from d)), 'completed',
  'the queue row closes with the terminal result');
select is(pg_temp.complete((select scanner from ids), (select d1 from d), (select (j -> 0 ->> 'claim_token')::uuid from k2), 'clean'),
  'stale_claim', 'a duplicate result after completion is refused');

-- Malicious / unscannable / missing (fresh documents on Wendy's draft).
create temp table more as
select pg_temp.upload_document((select wendy from ids), (select w_bls ->> 'credential_version_id' from c)::uuid) as m,
       pg_temp.upload_document((select wendy from ids), (select w_bls ->> 'credential_version_id' from c)::uuid) as u,
       pg_temp.upload_document((select wendy from ids), (select w_bls ->> 'credential_version_id' from c)::uuid) as x;
grant select on more to authenticated;
create temp table k3 as select pg_temp.claim((select scanner from ids)) as j;
grant select on k3 to authenticated;
create function pg_temp.token_for(p_doc uuid) returns uuid language sql as $$
  select (e ->> 'claim_token')::uuid from jsonb_array_elements((select j from k3)) e where (e ->> 'document_id')::uuid = p_doc
$$;
select is(jsonb_array_length((select j from k3)), 3, 'a bounded batch claims several waiting documents');
select is(pg_temp.complete((select scanner from ids), (select m from more), pg_temp.token_for((select m from more)), 'malicious'),
  'quarantined', 'malware → quarantined');
select is(pg_temp.status((select m from more)), 'quarantined/malware_detected', 'the quarantine reason is recorded');
select is(pg_temp.complete((select scanner from ids), (select u from more), pg_temp.token_for((select u from more)), 'unscannable'),
  'rejected', 'definitively unscannable → rejected');
select is(pg_temp.complete((select scanner from ids), (select x from more), pg_temp.token_for((select x from more)), 'object_missing'),
  'rejected', 'object missing after upload → rejected');
select is((select count(*)::int from public.audit_events
            where action = 'credential.document_scanned' and metadata ->> 'document_id' = (select m::text from more)
              and metadata ->> 'result' = 'quarantined'),
  1, 'the quarantine is audited (no path, URL or bytes)');
select is(pg_temp.sees_object((select scanner from ids), (select m from more)), 0,
  'after the result, the scanner loses access to the object');

-- ---------------------------------------------------------------------------
-- S6 transient failures: retry, backoff, exhaustion, requeue
-- ---------------------------------------------------------------------------
create temp table t as
select pg_temp.upload_document((select walt from ids), (select t_bls ->> 'credential_version_id' from c)::uuid) as d2;
grant select on t to authenticated;

create function pg_temp.fail_once(p_doc uuid) returns text language plpgsql as $$
declare v_j jsonb;
begin
  perform pg_temp.make_due(p_doc);
  v_j := pg_temp.claim((select scanner from ids));
  return pg_temp.complete((select scanner from ids), p_doc, (v_j -> 0 ->> 'claim_token')::uuid, 'transient_failure', null, 'provider_unavailable');
end;
$$;

select is(pg_temp.fail_once((select d2 from t)), 'retry', 'a transient failure is retried');
select ok((select next_attempt_at > now() and state = 'pending' from internal.document_scan_queue where document_id = (select d2 from t)),
  'the retry is scheduled in the future (backoff)');
select is(pg_temp.status((select d2 from t)), 'scanning', 'a transient failure never changes trust state');
select is(jsonb_array_length(pg_temp.claim((select scanner from ids))), 0, 'a backed-off document is not claimed early');
select pg_temp.fail_once((select d2 from t));
select pg_temp.fail_once((select d2 from t));
select pg_temp.fail_once((select d2 from t));
select is(pg_temp.fail_once((select d2 from t)), 'failed', 'after the maximum attempts the scan fails terminally');
select is(pg_temp.status((select d2 from t)), 'scanning/scan_failed', 'a failed scan stays untrusted (scanning) and is flagged for the owner');
select is((select count(*)::int from public.audit_events
            where action = 'credential.document_scan_failed' and metadata ->> 'document_id' = (select d2::text from t)),
  1, 'the terminal failure is audited');
select is((select failed from internal.document_scan_health()), 1, 'scan health reports the failed scan');
select is((select count(*)::int from internal.list_stuck_document_scans() where document_id = (select d2 from t)), 1,
  'the operator query lists the stuck document');
select internal.requeue_document_scan((select d2 from t));
select is((select state || '/' || attempts from internal.document_scan_queue where document_id = (select d2 from t)), 'pending/0',
  'the operator can requeue a failed scan after an outage');
select is(internal.request_document_scan_dispatch(), 'not_configured',
  'the cron kick is a no-op until Vault holds the scanner URL and secret');
select internal.run_document_scan_watchdog();
select is((select result ->> 'pending_due' from internal.scheduled_job_runs
            where job = 'document_scan_watchdog' order by id desc limit 1), '1',
  'the watchdog records a machine-observable backlog snapshot');

-- ---------------------------------------------------------------------------
-- S8 readiness: only scanner-cleared evidence counts
-- ---------------------------------------------------------------------------
create temp table w as
select pg_temp.worker_of((select alpha from orgs), (select wendy from ids)) as wendy_w,
       pg_temp.worker_of((select alpha from orgs), (select walt from ids))  as walt_w;
grant select on w to authenticated;

select pg_temp.submit((select walt from ids), (select t_bls ->> 'credential_version_id' from c)::uuid);
select is(pg_temp.reasons((select alice from ids), (select walt_w from w)) ->> 'bls_certification', 'DOCUMENT_NOT_CLEARED',
  'a scanning document does not satisfy the requirement');

-- Walt's document is scanned clean through the real scanner path, then verified.
create temp table k4 as select pg_temp.claim((select scanner from ids)) as j;
grant select on k4 to authenticated;
select is(pg_temp.complete((select scanner from ids), (select d2 from t), (select (j -> 0 ->> 'claim_token')::uuid from k4), 'clean'),
  'clean', 'a positive clean verdict on the validated bytes → clean');
select is(pg_temp.reasons((select alice from ids), (select walt_w from w)) ->> 'bls_certification', 'UNVERIFIED_CREDENTIAL',
  'clean evidence does not auto-verify the credential');
select pg_temp.verify((select carl from ids), (select t_bls ->> 'credential_version_id' from c)::uuid, (select alpha from orgs));
select is(pg_temp.reasons((select alice from ids), (select walt_w from w)) ->> 'bls_certification', 'MET',
  'clean + verified evidence satisfies the requirement');

-- Wendy has only quarantined / rejected documents: they are not evidence at all.
select throws_ok(format($$ select pg_temp.submit(%L, %L) $$, (select wendy from ids), (select w_bls ->> 'credential_version_id' from c)),
  'CH409', null, 'quarantined and rejected documents cannot even back a submission');
select isnt(pg_temp.reasons((select alice from ids), (select wendy_w from w)) ->> 'bls_certification', 'MET',
  'a credential with only quarantined / rejected documents never satisfies the requirement');

select * from finish();
rollback;
