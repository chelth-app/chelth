-- =============================================================================
-- Assignment readiness monitoring & relationship operations (P0-E5-S2)
-- issues open once / update / resolve · scheduled scan idempotency
-- L issues never cross tenants · M suspension blocks new work
-- N suspension flags upcoming work · ending cancels not-yet-started work
-- pagination · scalable candidates · U structure
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql

select plan(50);

create temp table s as
select
  pg_temp.shift((select sam from ids), (select mercy from f), (select mercy_main from loc), 3, '07:00', '15:00', 2) as mercy,
  pg_temp.shift((select sam from ids), (select mercy from f), (select mercy_east from loc), 6, '07:00', '15:00', 2) as mercy_later,
  pg_temp.shift((select sam from ids), (select riverside from f), (select riverside_main from loc), 3, '07:00', '15:00', 1) as riverside;
grant select on s to authenticated, anon;
create temp table a as
select (pg_temp.assign((select sam from ids), (select mercy from s), (select wendy from w)) ->> 'assignment_id')::uuid as wendy,
       (pg_temp.assign((select sam from ids), (select riverside from s), (select walt from w)) ->> 'assignment_id')::uuid as walt;
grant select on a to authenticated;

create function pg_temp.open_issues(p_assignment uuid)
returns text language sql as $$
  select coalesce(string_agg(issue_type::text || ':' || severity::text, ',' order by issue_type), '')
  from public.assignment_issues where assignment_id = p_assignment and status = 'open'
$$;

-- ---------------------------------------------------------------------------
-- Monitoring
-- ---------------------------------------------------------------------------
select is(internal.run_assignment_readiness_scan() ->> 'opened', '0', 'ready assignments raise no issues');
select pg_temp.exec_as((select wendy from ids), 'aal1', format('select public.revoke_credential_share(%L)',
  (select id from public.credential_shares where credential_id = (select (wendy_bls ->> 'credential_id')::uuid from ev)
     and agency_organisation_id = (select alpha from orgs) and status = 'active')));
select is(internal.run_assignment_readiness_scan() ->> 'opened', '1', 'the scan finds the assignment that became non-compliant');
select is(pg_temp.open_issues((select wendy from a)), 'not_eligible:attention', 'an issue opens (attention: not yet accepted, more than 48h out)');
select is((select compliance_reasons::text || block_reasons::text from public.assignment_issues where assignment_id = (select wendy from a)),
  '{CREDENTIAL_NOT_SHARED}{WORKER_NOT_ELIGIBLE}', 'the issue carries reason codes only');
select is((select count(distinct recipient_profile_id)::int || '/' || count(*)::int from internal.notification_outbox
            where event = 'assignment_non_compliant' and subject_id = (select wendy from a)),
  '2/2', 'agency operations are notified once each');
select is(internal.run_assignment_readiness_scan() ->> 'opened', '0', 'a repeated scan opens nothing new (idempotent)');
select is((select count(*)::int from public.assignment_issues where assignment_id = (select wendy from a)),
  1, '… and never duplicates the issue');
select is((select count(*)::int from internal.notification_outbox where event = 'assignment_non_compliant' and subject_id = (select wendy from a)),
  2, '… or its notifications');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select public.accept_shift_assignment(%L)', (select wendy from a))),
  'CHS14', null, 'a worker cannot newly accept an assignment they are no longer eligible for');
select is((select count(*)::int from public.shift_assignments where id = (select wendy from a) and status = 'assigned'),
  1, 'the assignment itself is preserved (never silently cancelled)');
select is((select count(*)::int from public.audit_events where action = 'assignment.issue_opened'), 1, 'issue opening is audited');

select pg_temp.share_credential((select wendy from ids), (select (wendy_bls ->> 'credential_id')::uuid from ev), (select alpha from orgs));
select is(pg_temp.query_as((select sam from ids), 'aal1', format('select checked, opened, resolved from public.recheck_shift_readiness(%L)', (select mercy from s))) -> 0,
  '{"checked": 1, "opened": 0, "resolved": 1}'::jsonb, 'a manual re-check resolves the issue when readiness returns');
select is((select resolution::text from public.assignment_issues where assignment_id = (select wendy from a)),
  'eligible_again', 'the resolution is recorded');
select is((select count(*)::int from public.audit_events where action = 'assignment.readiness_rechecked'), 1, 'manual re-checks are audited');
select throws_ok(pg_temp.as_sql((select rita from ids), format('select * from public.recheck_shift_readiness(%L)', (select mercy from s))),
  'CHS04', null, 'a recruiter cannot re-check');
select ok((select count(*) >= 3 from internal.scheduled_job_runs where job = 'assignment_readiness_scan' and finished_at is not null),
  'scheduled runs are recorded');

-- ---------------------------------------------------------------------------
-- L. Tenancy of issues
-- ---------------------------------------------------------------------------
select pg_temp.exec_as((select wendy from ids), 'aal1', format('select public.revoke_credential_share(%L)',
  (select id from public.credential_shares where credential_id = (select (wendy_bls ->> 'credential_id')::uuid from ev)
     and agency_organisation_id = (select alpha from orgs) and status = 'active')));
select internal.run_assignment_readiness_scan();
select is(pg_temp.count_as((select sam from ids), 'aal1', 'select * from public.assignment_issues where status = ''open'''), 1, 'the agency sees its open issue');
select is(pg_temp.count_as((select sam from ids), 'aal1', format('select * from public.list_assignment_issues(%L)', (select alpha from orgs))),
  1, 'the operations projection lists it');
select is(pg_temp.count_as((select bob from ids), 'aal2', 'select * from public.assignment_issues'), 0, 'L. another agency sees no issues');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select * from public.list_assignment_issues(%L)', (select alpha from orgs)), 'aal2'),
  'CH403', null, 'L. another agency cannot list Alpha''s issues');
select is(pg_temp.count_as((select wendy from ids), 'aal1', 'select * from public.assignment_issues'), 0, 'workers do not read agency issue records');
select is(pg_temp.count_as((select fiona from ids), 'aal1', 'select * from public.assignment_issues'), 0, 'facilities do not read issues');
select is(pg_temp.count_as((select carl from ids), 'aal1', 'select * from public.assignment_issues'), 0, 'compliance.view alone is not enough (needs assignment.view)');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.assignment_issues'), 0, 'T. a platform admin reads no issues');
select throws_ok(pg_temp.as_sql((select sam from ids), 'update public.assignment_issues set status = ''resolved'''),
  '42501', null, 'W. issues cannot be tampered with directly');
select throws_ok($$ delete from public.assignment_issues $$, 'CH409', null, 'issues are never deleted (owner role)');
select throws_ok(format($$
  insert into public.assignment_issues (agency_organisation_id, assignment_id, shift_id, issue_type, severity, detected_by)
  values (%L, %L, %L, 'not_eligible', 'attention', 'manual_recheck') $$,
  (select alpha from orgs), (select wendy from a), (select riverside from s)),
  'CH400', null, 'U. an issue''s assignment must belong to its shift');
select throws_ok(format($$
  insert into public.assignment_issues (agency_organisation_id, assignment_id, shift_id, issue_type, severity, detected_by)
  values (%L, %L, %L, 'relationship_not_active', 'attention', 'manual_recheck') $$,
  (select beta from orgs), (select wendy from a), (select mercy from s)),
  '23503', null, 'U. an issue cannot be attached to another agency');


-- ---------------------------------------------------------------------------
-- Pagination (keyset) and scalable candidates
-- ---------------------------------------------------------------------------
create temp table p1 as select pg_temp.query_as((select sam from ids), 'aal1', format(
  'select shift_id, start_at from public.list_agency_shifts_page(%L, p_limit => 2)', (select alpha from orgs))) as rows;
create temp table p2 as select pg_temp.query_as((select sam from ids), 'aal1', format(
  'select shift_id from public.list_agency_shifts_page(%L, p_limit => 2, p_after_start_at => %L, p_after_id => %L)',
  (select alpha from orgs), (select rows -> 1 ->> 'start_at' from p1), (select rows -> 1 ->> 'shift_id' from p1))) as rows;
select is((select jsonb_array_length(rows) from p1) || '/' || (select jsonb_array_length(rows) from p2), '2/1',
  'keyset pages cover every shift once (2 + 1)');
select ok((select not (rows @> jsonb_build_array(jsonb_build_object('shift_id', (select rows -> 0 ->> 'shift_id' from p1)))) from p2),
  'pages do not overlap');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select * from public.list_agency_shifts_page(%L, p_after_id => %L)', (select alpha from orgs), gen_random_uuid())),
  'CH400', null, 'a half cursor is rejected');
select is(pg_temp.query_as((select sam from ids), 'aal1', format(
    'select display_name, readiness from public.list_shift_candidates_page(%L, true)', (select mercy_later from s))),
  '[{"display_name": "nora", "readiness": null}, {"display_name": "walt", "readiness": "not_eligible"}, {"display_name": "wendy", "readiness": "not_eligible"}]'::jsonb,
  'structurally blocked candidates (wrong discipline) skip the compliance engine; survivors are evaluated canonically');
select is(pg_temp.count_as((select sam from ids), 'aal1', format('select * from public.list_shift_candidates_page(%L)', (select mercy_later from s))),
  0, 'the default candidate view shows only assignable workers');

-- ---------------------------------------------------------------------------
-- M / N. Relationship suspension
-- ---------------------------------------------------------------------------
create temp table req as
select pg_temp.scalar_as((select fiona from ids), 'aal1', format(
  'select public.submit_facility_shift_request(%L, %L, ''cna'', current_date + 9, ''07:00'', ''15:00'', 1)',
  (select mercy from rel), (select mercy_main from loc)))::uuid as id;
grant select on req to authenticated;
-- A live offer under the relationship (arranged directly: wendy is currently not eligible).
insert into public.shift_offers (shift_id, agency_organisation_id, agency_worker_id, profile_id, expires_at, created_by_membership_id)
values ((select mercy_later from s), (select alpha from orgs), (select walt from w), (select walt from ids), now() + interval '1 day',
        pg_temp.membership_of((select alpha from orgs), (select sam from ids)));
update internal.notification_outbox set state = 'sent', sent_at = now(), processed_at = now() where state = 'pending';

select lives_ok(pg_temp.as_sql((select alice from ids), format('select public.set_facility_relationship_status(%L, ''suspended'')', (select mercy from rel)), 'aal2'),
  'the owner suspends the relationship (one transaction)');
select is(pg_temp.open_issues((select wendy from a)), 'not_eligible:attention,relationship_not_active:attention',
  'N. upcoming assignments are flagged relationship_not_active');
select is((select count(*)::int from public.shift_offers where shift_id = (select mercy_later from s) and status = 'offered'),
  0, 'N. live offers under the relationship are cancelled');
select is((select count(*)::int from public.shift_assignments where id = (select wendy from a) and status = 'assigned'),
  1, 'N. assignments are kept (flagged, not destroyed)');
select is((select metadata - 'to' from public.audit_events where action = 'relationship.operations_applied'),
  '{"cancelled_offers": 1, "cancelled_shifts": 0, "resolved_issues": 0, "upcoming_shifts": 3, "flagged_assignments": 1}'::jsonb,
  'the bulk operation is audited with counts only');
select is((select array_agg(recipient_profile_id) from internal.notification_outbox where event = 'relationship_suspended'),
  array[(select sam from ids)], 'agency operations are notified (the acting admin is not emailed about their own action)');
select is(pg_temp.count_as((select sam from ids), 'aal1', format('select * from public.list_relationship_affected_shifts(%L)', (select alpha from orgs))),
  3, 'affected upcoming shifts are surfaced');

select throws_ok(pg_temp.as_sql((select sam from ids), format(
  'select public.create_shift(%L, %L, ''cna'', current_date + 4, ''07:00'', ''15:00'', 1)', (select mercy from f), (select mercy_main from loc))),
  'CHS10', null, 'M. no new shifts');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select * from public.assign_worker_to_shift(%L, %L)', (select mercy_later from s), (select wendy from w))),
  'CHS10', null, 'M. no new assignments');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select * from public.offer_shift_to_workers(%L, %L::uuid[])', (select mercy_later from s), array[(select wendy from w)])),
  'CHS10', null, 'M. no new offers');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.open_shift(%L)', (select id from req))),
  'CHS10', null, 'M. submitted requests cannot be opened');
select throws_ok(pg_temp.as_sql((select fiona from ids), format(
  'select public.submit_facility_shift_request(%L, %L, ''cna'', current_date + 9, ''07:00'', ''15:00'', 1)', (select mercy from rel), (select mercy_main from loc))),
  'CHS10', null, 'M. the facility cannot submit new requests');

select pg_temp.exec_as((select alice from ids), 'aal2', format('select public.set_facility_relationship_status(%L, ''active'')', (select mercy from rel)));
select is(pg_temp.open_issues((select wendy from a)), 'not_eligible:attention', 'reactivation resolves relationship issues');

-- Ending: not-yet-started work is cancelled, history kept, facility loses access.
select pg_temp.exec_as((select alice from ids), 'aal2', format('select public.set_facility_relationship_status(%L, ''ended'')', (select mercy from rel)));
select is((select string_agg(distinct status::text || ':' || coalesce(cancellation_reason::text, ''), ',')
           from public.shifts where relationship_id = (select mercy from rel)),
  'cancelled:relationship_ended', 'ending cancels not-yet-started shifts with reason relationship_ended');
select is((select status::text || ':' || cancellation_reason::text from public.shift_assignments where id = (select wendy from a)),
  'cancelled:shift_cancelled', 'their assignments are cancelled');
select is(pg_temp.open_issues((select wendy from a)), '', 'and their issues are resolved (assignment closed)');
select is((select count(*)::int from internal.notification_outbox where event = 'shift_cancelled' and recipient_profile_id = (select wendy from ids)),
  1, 'the worker is told the shift is cancelled');

select * from finish();
rollback;
