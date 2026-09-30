-- =============================================================================
-- Notification delivery (P0-E5-S2)
-- recipient policy / fan-out · O no client access · worker role least privilege
-- P duplicate claims prevented · Q lease + claim token · retries, backoff,
-- final failure · R safe error codes only · S no addresses/bodies in audit
-- delivery status projection · scheduler wiring
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql

select plan(41);

-- Test-only (rolled back): let the runner impersonate the dispatcher role.
grant chelth_notification_worker to postgres with set true, inherit false;

-- Run SQL as the dispatcher role (owner switches role inside, like query_as).
create function pg_temp.as_worker(p_sql text)
returns jsonb language plpgsql as $$
declare
  v_result jsonb;
begin
  execute 'set local role chelth_notification_worker';
  execute format('select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) from (%s) q', p_sql) into v_result;
  execute 'reset role';
  return v_result;
end;
$$;

-- Start clean: the fixture's own actions may already have queued events.
update internal.notification_outbox set state = 'sent', sent_at = now(), processed_at = now();

create temp table s as
select pg_temp.shift((select sam from ids), (select mercy from f), (select mercy_main from loc), 3, '07:00', '15:00', 2) as mercy;
grant select on s to authenticated;
select pg_temp.assign((select sam from ids), (select mercy from s), (select wendy from w));

-- ---------------------------------------------------------------------------
-- Recipient policy (fan-out at enqueue; identifiers only)
-- ---------------------------------------------------------------------------
select is((select array_agg(recipient_profile_id) from internal.notification_outbox where state = 'pending' and event = 'worker_assigned'),
  array[(select wendy from ids)], 'worker_assigned goes to the assigned worker only');

create temp table req as
select pg_temp.scalar_as((select fiona from ids), 'aal1', format(
  'select public.submit_facility_shift_request(%L, %L, ''cna'', current_date + 8, ''07:00'', ''15:00'', 1)',
  (select mercy from rel), (select mercy_main from loc)))::uuid as id;
grant select on req to authenticated;
select is((select array_agg(recipient_profile_id order by recipient_profile_id) from internal.notification_outbox
            where event = 'facility_request_submitted'),
  (select array_agg(x order by x) from unnest(array[(select alice from ids), (select sam from ids)]) x),
  'facility_request_submitted goes to agency users holding assignment.manage (not recruiters, credentialing or workers)');
select pg_temp.exec_as((select sam from ids), 'aal1', format('select public.open_shift(%L)', (select id from req)));
select is((select array_agg(recipient_profile_id) from internal.notification_outbox where event = 'facility_request_opened'),
  array[(select fiona from ids)], 'facility_request_opened goes to the linked facility''s requesters (not supervisors)');
select is((select count(*)::int from internal.notification_outbox
            where event = 'facility_request_opened' and audience_organisation_id <> (select gamma from orgs)),
  0, 'facility deliveries belong to the facility tenant');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'internal' and table_name = 'notification_outbox' and column_name ~ '(email|address|body|html|invite)'),
  0, 'the outbox has no column for addresses, bodies or tokens');

-- ---------------------------------------------------------------------------
-- O. No client access; the dispatcher role is least privilege
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select alice from ids), 'select * from internal.notification_outbox', 'aal2'),
  '42501', null, 'O. authenticated cannot read the outbox');
select throws_ok(pg_temp.as_sql(null, 'select * from internal.notification_outbox'),
  '42501', null, 'O. anon cannot read the outbox');
select throws_ok(pg_temp.as_sql((select alice from ids), 'select * from internal.claim_notifications(10, 60)', 'aal2'),
  '42501', null, 'O. authenticated cannot claim notifications');
select is(
  (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text collate "C")
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'authz', 'internal')
      and has_function_privilege('chelth_notification_worker', p.oid, 'execute')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  array['internal.claim_notifications(integer,integer)', 'internal.complete_notification(uuid,uuid,text,text,text,text)'],
  'the dispatcher role can execute exactly claim and complete');
select is((select count(*)::int from information_schema.role_table_grants where grantee = 'chelth_notification_worker'),
  0, 'the dispatcher role holds no table privileges');
select throws_ok($$ select pg_temp.as_worker('select * from internal.notification_outbox') $$,
  '42501', null, 'the dispatcher role cannot read the outbox directly');
select throws_ok($$ select pg_temp.as_worker('select * from public.shifts') $$,
  '42501', null, 'the dispatcher role cannot read tenant tables');
select ok(not (select rolcanlogin from pg_roles where rolname = 'chelth_notification_worker'),
  'the dispatcher role itself cannot log in (per-environment login roles are operator-created)');

-- ---------------------------------------------------------------------------
-- Claim: address + template resolved at delivery; SKIP LOCKED + lease
-- ---------------------------------------------------------------------------
create temp table c1 as select pg_temp.as_worker('select * from internal.claim_notifications(10, 120)') as rows;
select is((select jsonb_array_length(rows) from c1), 4, 'claim returns every due notification (bounded batch)');
select ok((select bool_and(x ->> 'recipient_email' like '%@example.test') from c1, jsonb_array_elements(rows) x),
  'the address is resolved at claim time from the identity');
select is((select x -> 'template' ->> 'facilityName' from c1, jsonb_array_elements(rows) x where x ->> 'event' = 'worker_assigned'),
  'Mercy Rehab', 'template data is resolved from current records');
select is((select x -> 'template' ->> 'path' from c1, jsonb_array_elements(rows) x where x ->> 'event' = 'worker_assigned'),
  format('/app/organisations/%s/my-shifts', (select alpha from orgs)), 'links are canonical application routes');
select is((select x -> 'template' ->> 'path' from c1, jsonb_array_elements(rows) x where x ->> 'event' = 'facility_request_opened'),
  format('/app/organisations/%s/staffing-requests/%s', (select gamma from orgs), (select id from req)),
  'facility links point to the facility''s own route');
select is(pg_temp.as_worker('select * from internal.claim_notifications(10, 120)'), '[]'::jsonb,
  'P. claimed rows cannot be claimed again while the lease holds');
select is((select count(*)::int from internal.notification_outbox where state = 'processing' and claim_token is not null),
  4, 'Q. every claimed row is processing with a claim token');

create temp table ids2 as
select (select (x ->> 'notification_id')::uuid from c1, jsonb_array_elements(rows) x where x ->> 'event' = 'worker_assigned') as assigned,
       (select (x ->> 'claim_token')::uuid from c1, jsonb_array_elements(rows) x where x ->> 'event' = 'worker_assigned') as assigned_token,
       (select (x ->> 'notification_id')::uuid from c1, jsonb_array_elements(rows) x where x ->> 'event' = 'facility_request_opened') as opened,
       (select (x ->> 'claim_token')::uuid from c1, jsonb_array_elements(rows) x where x ->> 'event' = 'facility_request_opened') as opened_token,
       (select array_agg((x ->> 'notification_id')::uuid) from c1, jsonb_array_elements(rows) x where x ->> 'event' = 'facility_request_submitted') as submitted,
       (select array_agg((x ->> 'claim_token')::uuid) from c1, jsonb_array_elements(rows) x where x ->> 'event' = 'facility_request_submitted') as submitted_tokens;

select is(pg_temp.as_worker(format($q$ select internal.complete_notification(%L, gen_random_uuid(), 'sent', 'resend', 'x') as r $q$, (select assigned from ids2))) -> 0 ->> 'r',
  'stale_claim', 'Q. a completion with the wrong claim token is ignored');
select is(pg_temp.as_worker(format($q$ select internal.complete_notification(%L, %L, 'sent', 'resend', 'msg_123') as r $q$,
    (select assigned from ids2), (select assigned_token from ids2))) -> 0 ->> 'r',
  'sent', 'a successful send is recorded');
select is((select state::text || '/' || provider || '/' || provider_message_id || '/' || attempts from internal.notification_outbox where id = (select assigned from ids2)),
  'sent/resend/msg_123/1', 'provider, provider message id and attempt count are stored');
select is(pg_temp.as_worker(format($q$ select internal.complete_notification(%L, %L, 'sent', 'resend', 'again') as r $q$,
    (select assigned from ids2), (select assigned_token from ids2))) -> 0 ->> 'r',
  'stale_claim', 'P. a sent notification cannot be completed twice');

-- Transient failure → retry with backoff
select is(pg_temp.as_worker(format($q$ select internal.complete_notification(%L, %L, 'transient_failure', 'resend', null, 'provider_unavailable') as r $q$,
    (select opened from ids2), (select opened_token from ids2))) -> 0 ->> 'r',
  'retry', 'a temporary provider failure is retried');
select ok((select next_attempt_at between now() + interval '55 seconds' and now() + interval '65 seconds'
             and last_error_code = 'provider_unavailable' from internal.notification_outbox where id = (select opened from ids2)),
  'the first retry waits one minute');
select is(pg_temp.as_worker('select * from internal.claim_notifications(10, 120)'), '[]'::jsonb,
  'a retry is not claimed before its backoff');
update internal.notification_outbox set next_attempt_at = now() - interval '1 second' where id = (select opened from ids2);
create temp table c2 as select pg_temp.as_worker('select * from internal.claim_notifications(10, 120)') as rows;
select is((select (rows -> 0 ->> 'attempt')::int from c2), 2, 'after the backoff it is claimed again (attempt 2)');
-- Exhaust: attempts 5 then a transient failure is final
update internal.notification_outbox set attempts = 5 where id = (select opened from ids2);
select is(pg_temp.as_worker(format($q$ select internal.complete_notification(%L, %L, 'transient_failure', 'resend', null, 'provider_unavailable') as r $q$,
    (select opened from ids2), (select (rows -> 0 ->> 'claim_token') from c2))) -> 0 ->> 'r',
  'failed', 'retries are bounded: the last attempt fails permanently');

-- Permanent failure and R. unsafe error text is never stored
select is(pg_temp.as_worker(format($q$ select internal.complete_notification(%L, %L, 'permanent_failure', 'resend', null, 'Rejected <alice@example.test>') as r $q$,
    (select submitted[1] from ids2), (select submitted_tokens[1] from ids2))) -> 0 ->> 'r',
  'failed', 'a permanent provider error fails immediately');
select is((select last_error_code from internal.notification_outbox where id = (select submitted[1] from ids2)),
  'unknown_error', 'R. only a safe error code is stored, never provider text');
select is((select array_agg(k order by k) from public.audit_events, jsonb_object_keys(metadata) k
            where action = 'notification.failed' and target_id = (select submitted[1] from ids2)),
  array['attempts', 'error_code', 'event'], 'final failures are audited with codes only');

-- Lease expiry (crashed dispatcher) → reclaimable; old token is stale
update internal.notification_outbox set claimed_until = now() - interval '1 second' where id = (select submitted[2] from ids2);
select is((select (x ->> 'notification_id')::uuid from jsonb_array_elements(pg_temp.as_worker('select * from internal.claim_notifications(10, 120)')) x),
  (select submitted[2] from ids2), 'an expired lease makes the row reclaimable');
select is(pg_temp.as_worker(format($q$ select internal.complete_notification(%L, %L, 'sent', 'resend', 'late') as r $q$,
    (select submitted[2] from ids2), (select submitted_tokens[2] from ids2))) -> 0 ->> 'r',
  'stale_claim', 'Q. the crashed dispatcher''s late completion cannot overwrite the new claim');

-- Undeliverable rows fail safely at claim time
select pg_temp.assign((select sam from ids), (select mercy from s), (select nora from w));
select pg_temp.exec_as((select sam from ids), 'aal1', format('select public.cancel_shift(%L, ''other'')', (select id from req)));
update public.profiles set status = 'suspended' where id = (select fiona from ids);
select pg_temp.as_worker('select * from internal.claim_notifications(50, 120)');
select is((select last_error_code from internal.notification_outbox where event = 'shift_cancelled' and recipient_profile_id = (select fiona from ids)),
  'recipient_unavailable', 'a recipient who is no longer active is never emailed');
update public.profiles set status = 'active' where id = (select fiona from ids);
insert into internal.notification_outbox (event, organisation_id, recipient_profile_id, audience_organisation_id, subject_type, subject_id, deliver_until)
values ('worker_assigned', (select alpha from orgs), (select walt from ids), (select alpha from orgs), 'shift', (select mercy from s), now() - interval '1 minute');
select pg_temp.as_worker('select * from internal.claim_notifications(50, 120)');
select is((select last_error_code from internal.notification_outbox where recipient_profile_id = (select walt from ids) and event = 'worker_assigned'),
  'expired_before_delivery', 'a notification past its delivery window is failed, not sent late');

-- ---------------------------------------------------------------------------
-- S. No addresses in audit; status projection
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.audit_events where metadata::text like '%@%'),
  0, 'S. no email address appears in any audit metadata');
select ok(pg_temp.count_as((select sam from ids), 'aal1', format('select * from public.list_notification_deliveries(%L)', (select alpha from orgs))) >= 1,
  'agency operations see failed/retrying deliveries of their own tenant');
select ok(pg_temp.query_as((select sam from ids), 'aal1', format('select * from public.list_notification_deliveries(%L, false)', (select alpha from orgs)))::text !~ '@',
  'the status projection contains no addresses');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select * from public.list_notification_deliveries(%L)', (select alpha from orgs)), 'aal2'),
  'CH403', null, 'another agency cannot see Alpha''s delivery status');

-- Scheduler wiring (no clock waits: job logic is called directly elsewhere)
select is((select array_agg(jobname order by jobname) from cron.job where jobname like 'chelth-%'),
  array['chelth-attendance-scan', 'chelth-location-evidence-purge', 'chelth-notification-kick', 'chelth-offer-expiry', 'chelth-readiness-scan'],
  'the scheduled jobs are defined by migration');

select * from finish();
rollback;
