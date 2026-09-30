-- =============================================================================
-- Assignments (P0-E5-S1)
-- E worker sees own · F no self-assignment · G no accepting another's
-- H/I/J/K compliance gate (non-compliant, expiry on shift date, discipline,
-- facility requirement) · L overlap · M cross-agency overlap · N no leak
-- O headcount · P duplicates · Q inactive worker/membership · R relationship
-- decisions append-only · re-evaluation · cancellation · U structure
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql

select plan(77);

create temp table s as
select
  pg_temp.shift((select sam from ids), (select mercy from f), (select mercy_main from loc), 3, '07:00', '15:00', 3) as m1,
  pg_temp.shift((select sam from ids), (select mercy from f), (select mercy_main from loc), 3, '15:00', '23:00', 2) as m_b2b,
  pg_temp.shift((select sam from ids), (select mercy from f), (select mercy_east from loc), 3, '06:00', '07:01', 2) as m_1min,
  pg_temp.shift((select sam from ids), (select riverside from f), (select riverside_main from loc), 3, '07:00', '15:00', 2) as r_ok,
  pg_temp.shift((select sam from ids), (select riverside from f), (select riverside_main from loc), 20, '07:00', '15:00', 2) as r_soon,
  pg_temp.shift((select sam from ids), (select riverside from f), (select riverside_main from loc), 45, '07:00', '15:00', 2) as r_expired,
  pg_temp.shift((select sam from ids), (select riverside from f), (select riverside_main from loc), 5, '07:00', '15:00', 1) as r_one,
  pg_temp.shift((select bob from ids), (select beta_client from f), (select beta_main from loc), 3, '12:00', '13:00', 2) as beta_overlap,
  pg_temp.shift((select bob from ids), (select beta_client from f), (select beta_main from loc), 3, '03:30', '05:00', 2) as beta_ok;
grant select on s to authenticated, anon;

create temp table r (k text primary key, v jsonb);
grant select on r to authenticated;

-- ---------------------------------------------------------------------------
-- F. No self-assignment; no direct writes
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.assign_worker_to_shift(%L, %L)', (select m1 from s), (select wendy from w))),
  'CHS04', null, 'F. a worker cannot assign themselves (the shift is not visible to them)');
select throws_ok(pg_temp.as_sql((select wendy from ids), format(
  'insert into public.shift_assignments (shift_id, agency_organisation_id, agency_worker_id, profile_id, start_at, end_at, assigned_by_membership_id) values (%L, %L, %L, %L, now(), now() + interval ''1 hour'', %L)',
  (select m1 from s), (select alpha from orgs), (select wendy from w), (select wendy from ids), pg_temp.membership_of((select alpha from orgs), (select wendy from ids)))),
  '42501', null, 'F/X. assignments cannot be inserted directly');
select throws_ok(pg_temp.as_sql((select rita from ids), format('select * from public.assign_worker_to_shift(%L, %L)', (select m1 from s), (select wendy from w))),
  'CHS04', null, 'a recruiter cannot assign');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select * from public.assign_worker_to_shift(%L, %L)', (select m1 from s), (select wendy from w))),
  'CHS04', null, 'another agency cannot assign to Alpha''s shift');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select * from public.assign_worker_to_shift(%L, %L)', (select m1 from s), (select wendy_beta from w))),
  'CHW04', null, 'a worker record of another agency cannot be assigned');

-- ---------------------------------------------------------------------------
-- Allowed path
-- ---------------------------------------------------------------------------
insert into r values ('wendy_m1', pg_temp.assign((select sam from ids), (select m1 from s), (select wendy from w)));
select is((select v ->> 'outcome' from r where k = 'wendy_m1'), 'allowed', 'a ready worker with the right discipline is assigned');
select is((select status::text from public.shift_assignments where id = (select (v ->> 'assignment_id')::uuid from r where k = 'wendy_m1')),
  'assigned', 'the assignment starts as assigned (worker acceptance is explicit)');
select is((select outcome::text || '/' || readiness::text || '/' || engine_version from public.assignment_eligibility_decisions
           where id = (select (v ->> 'decision_id')::uuid from r where k = 'wendy_m1')),
  'allowed/ready/compliance-engine.p0-e5-s1', 'an allowed decision is recorded with readiness and engine version');
select is((select count(*)::int from public.audit_events where action = 'assignment.created'
             and target_id = (select (v ->> 'assignment_id')::uuid from r where k = 'wendy_m1')),
  1, 'assignment.created is audited');
select is((select count(*)::int from internal.notification_outbox where event = 'worker_assigned' and recipient_profile_id = (select wendy from ids)),
  1, 'worker_assigned notification hook enqueued');

-- ---------------------------------------------------------------------------
-- H / I / J / K. The compliance gate
-- ---------------------------------------------------------------------------
insert into r values ('nora_m1', pg_temp.assign((select sam from ids), (select m1 from s), (select nora from w)));
select is((select v ->> 'outcome' || '/' || (v ->> 'primary_reason') from r where k = 'nora_m1'),
  'refused/DISCIPLINE_MISMATCH', 'J. an RN cannot be assigned to a CNA shift');

insert into r values ('walt_m1', pg_temp.assign((select sam from ids), (select m1 from s), (select walt from w)));
select is((select v ->> 'primary_reason' from r where k = 'walt_m1'), 'WORKER_NOT_ELIGIBLE',
  'K/H. a worker missing a facility requirement is not assignable');
select ok((select (v -> 'compliance_findings') @> '[{"scope": "facility", "credential_type_key": "facility_orientation", "reason": "MISSING_CREDENTIAL"}]' from r where k = 'walt_m1'),
  'K. the refusal explains the facility-specific missing credential');

insert into r values ('walt_r_ok', pg_temp.assign((select sam from ids), (select r_ok from s), (select walt from w)));
select is((select v ->> 'outcome' from r where k = 'walt_r_ok'), 'allowed',
  'the same worker is assignable where the facility has no such requirement');

select is(pg_temp.readiness((select sam from ids), (select walt from w)), 'ready', 'I. walt is ready today …');
insert into r values ('walt_r_expired', pg_temp.assign((select sam from ids), (select r_expired from s), (select walt from w)));
select is((select (v ->> 'primary_reason') || '/' || (v -> 'compliance_reasons' ->> 0) from r where k = 'walt_r_expired'),
  'WORKER_NOT_ELIGIBLE/EXPIRED_CREDENTIAL', 'I. … but a credential expiring before the shift date blocks that future shift');
insert into r values ('walt_r_soon', pg_temp.assign((select sam from ids), (select r_soon from s), (select walt from w)));
select is((select (v ->> 'primary_reason') || '/' || (v -> 'compliance_reasons' ->> 0) from r where k = 'walt_r_soon'),
  'WORKER_NOT_ELIGIBLE/EXPIRING_SOON', 'policy: action_required (expiring soon on the shift date) blocks assignment');

select is((select count(*)::int from public.assignment_eligibility_decisions where outcome = 'refused' and agency_organisation_id = (select alpha from orgs)),
  4, 'refusals are recorded as decisions (they commit; the RPC returns rather than raises)');
select is((select count(*)::int from public.audit_events where action = 'assignment.rejected_by_compliance' and organisation_id = (select alpha from orgs)),
  4, 'assignment.rejected_by_compliance is audited');
select is((select count(*)::int from public.shift_assignments where agency_worker_id in ((select nora from w), (select walt from w)) and shift_id <> (select r_ok from s)),
  0, 'H. no assignment row exists for any refused attempt');
select throws_ok(format($$ update public.assignment_eligibility_decisions set outcome = 'allowed' where id = %L $$,
  (select (v ->> 'decision_id')::uuid from r where k = 'walt_m1')),
  'CH409', null, 'decisions are append-only (owner role)');

-- ---------------------------------------------------------------------------
-- L / M / N. Schedule conflicts by PERSON, across agencies, without leaks
-- ---------------------------------------------------------------------------
insert into r values ('wendy_b2b', pg_temp.assign((select sam from ids), (select m_b2b from s), (select wendy from w)));
select is((select v ->> 'outcome' from r where k = 'wendy_b2b'), 'allowed', 'L. back-to-back shifts (07–15, 15–23) do not conflict');
insert into r values ('wendy_1min', pg_temp.assign((select sam from ids), (select m_1min from s), (select wendy from w)));
select is((select v ->> 'primary_reason' from r where k = 'wendy_1min'), 'WORKER_SCHEDULE_CONFLICT', 'L. a one-minute overlap conflicts');
select is((select count(*)::int from public.audit_events where action = 'assignment.rejected_by_conflict' and organisation_id = (select alpha from orgs)),
  1, 'assignment.rejected_by_conflict is audited');

insert into r values ('beta_overlap', pg_temp.assign((select bob from ids), (select beta_overlap from s), (select wendy_beta from w)));
select is((select v ->> 'outcome' || '/' || (v ->> 'primary_reason') from r where k = 'beta_overlap'),
  'refused/WORKER_SCHEDULE_CONFLICT', 'M. the same person cannot be double-booked through another agency');
select is((select array_agg(key order by key) from r, jsonb_object_keys(v) key where k = 'beta_overlap'),
  array['assignment_id', 'block_reasons', 'compliance_findings', 'compliance_reasons', 'decision_id', 'outcome', 'primary_reason'],
  'N. the result has a fixed, code-only shape');
select ok((select v::text !~ (select alpha::text from orgs) and v::text !~ 'Mercy'
             and v::text !~ (select m1::text from s) and v::text !~ (select m_b2b::text from s) from r where k = 'beta_overlap'),
  'N. the conflict result reveals no other agency, facility or shift');
select is((select array_agg(key order by key) from public.audit_events, jsonb_object_keys(metadata) key
            where action = 'assignment.rejected_by_conflict' and organisation_id = (select beta from orgs)),
  array['agency_worker_id', 'decision_id'], 'N. the conflict audit event holds only Beta''s own identifiers');
select ok((select compliance_findings::text !~ 'Mercy' and block_reasons = '{WORKER_SCHEDULE_CONFLICT}'
             from public.assignment_eligibility_decisions where id = (select (v ->> 'decision_id')::uuid from r where k = 'beta_overlap')),
  'N. Beta''s decision record holds only the generic conflict code');
select is(pg_temp.count_as((select bob from ids), 'aal2', 'select * from public.shift_assignments where agency_organisation_id <> (select beta from orgs)'),
  0, 'N. Beta cannot read Alpha''s assignments');
insert into r values ('beta_ok', pg_temp.assign((select bob from ids), (select beta_ok from s), (select wendy_beta from w)));
select is((select v ->> 'outcome' from r where k = 'beta_ok'), 'allowed', 'M. a non-overlapping shift at another agency is fine');
select throws_ok(format($$
  insert into public.shift_assignments (shift_id, agency_organisation_id, agency_worker_id, profile_id, start_at, end_at, assigned_by_membership_id)
  select id, agency_organisation_id, %L, %L, start_at, end_at, %L from public.shifts where id = %L $$,
  (select wendy_beta from w), (select wendy from ids), pg_temp.membership_of((select beta from orgs), (select bob from ids)), (select beta_overlap from s)),
  '23P01', null, 'M. the exclusion constraint forbids overlapping active assignments for one person (owner role)');

-- ---------------------------------------------------------------------------
-- O / P. Headcount and duplicates
-- ---------------------------------------------------------------------------
insert into r values ('wendy_one', pg_temp.assign((select sam from ids), (select r_one from s), (select wendy from w)));
select is((select v ->> 'outcome' from r where k = 'wendy_one'), 'allowed', 'O. the last slot is filled');
insert into r values ('full', pg_temp.assign((select sam from ids), (select r_one from s), (select walt from w)));
select is((select v ->> 'primary_reason' from r where k = 'full'), 'SHIFT_FULL', 'O. headcount cannot be exceeded');
select throws_ok(format($$
  insert into public.shift_assignments (shift_id, agency_organisation_id, agency_worker_id, profile_id, start_at, end_at, assigned_by_membership_id)
  select id, agency_organisation_id, %L, %L, start_at, end_at, %L from public.shifts where id = %L $$,
  (select walt from w), (select walt from ids), pg_temp.membership_of((select alpha from orgs), (select sam from ids)), (select r_one from s)),
  'CHS16', null, 'O. the capacity trigger refuses overfill even for the owner role');
insert into r values ('dup', pg_temp.assign((select sam from ids), (select m1 from s), (select wendy from w)));
select is((select v ->> 'primary_reason' from r where k = 'dup'), 'ASSIGNMENT_ALREADY_EXISTS', 'P. a duplicate active assignment is refused');
select throws_ok(format($$
  insert into public.shift_assignments (shift_id, agency_organisation_id, agency_worker_id, profile_id, start_at, end_at, assigned_by_membership_id)
  select id, agency_organisation_id, %L, %L, start_at, end_at, %L from public.shifts where id = %L $$,
  (select wendy from w), (select wendy from ids), pg_temp.membership_of((select alpha from orgs), (select sam from ids)), (select m1 from s)),
  '23P01', null, 'P. a duplicate active assignment is structurally impossible (owner role; exclusion constraint, backed by a unique index)');

-- ---------------------------------------------------------------------------
-- Q. Inactive worker / membership
-- ---------------------------------------------------------------------------
update public.organisation_memberships set status = 'suspended'
 where id = pg_temp.membership_of((select alpha from orgs), (select wendy from ids));
insert into r values ('suspended_member', pg_temp.assign((select sam from ids), (select r_soon from s), (select wendy from w)));
select is((select v ->> 'primary_reason' from r where k = 'suspended_member'), 'WORKER_NOT_ACTIVE', 'Q. a suspended membership prevents assignment');
select is(pg_temp.count_as((select wendy from ids), 'aal1', format('select * from public.shift_assignments where agency_organisation_id = %L', (select alpha from orgs))),
  0, 'Q. a suspended member no longer sees that agency''s assignments');
update public.organisation_memberships set status = 'active'
 where id = pg_temp.membership_of((select alpha from orgs), (select wendy from ids));
update public.agency_workers set status = 'suspended' where id = (select wendy from w);
insert into r values ('suspended_worker', pg_temp.assign((select sam from ids), (select r_soon from s), (select wendy from w)));
select is((select v ->> 'primary_reason' from r where k = 'suspended_worker'), 'WORKER_NOT_ACTIVE', 'Q. a suspended worker record prevents assignment');
update public.agency_workers set status = 'active' where id = (select wendy from w);

-- ---------------------------------------------------------------------------
-- E / G. Own assignments only; acceptance
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select wendy from ids), 'aal1', 'select * from public.shift_assignments'),
  4, 'E. a worker sees exactly their own assignments (at every agency)');
select is(pg_temp.count_as((select walt from ids), 'aal1', 'select * from public.shift_assignments where profile_id <> (select walt from ids)'),
  0, 'E. a worker sees no one else''s assignments');
select is(pg_temp.count_as((select wendy from ids), 'aal1', format('select * from public.list_my_shift_assignments(%L)', (select alpha from orgs))),
  3, 'E. my-shifts lists own assignments at this agency');
select throws_ok(pg_temp.as_sql((select walt from ids), format('select public.accept_shift_assignment(%L)', (select (v ->> 'assignment_id')::uuid from r where k = 'wendy_m1'))),
  'CHA04', null, 'G. a worker cannot accept another worker''s assignment');
select throws_ok(pg_temp.as_sql((select walt from ids), format('select public.decline_shift_assignment(%L)', (select (v ->> 'assignment_id')::uuid from r where k = 'wendy_m1'))),
  'CHA04', null, 'G. a worker cannot decline another worker''s assignment');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.accept_shift_assignment(%L)', (select (v ->> 'assignment_id')::uuid from r where k = 'wendy_m1'))),
  'CHA04', null, 'G. a scheduler cannot accept on a worker''s behalf');

-- R. Relationship suspended: no acceptance, no new assignments
select pg_temp.exec_as((select alice from ids), 'aal2', format('select public.set_facility_relationship_status(%L, ''suspended'')', (select mercy from rel)));
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select public.accept_shift_assignment(%L)', (select (v ->> 'assignment_id')::uuid from r where k = 'wendy_m1'))),
  'CHS10', null, 'R. an assignment cannot be accepted while the relationship is suspended');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select * from public.assign_worker_to_shift(%L, %L)', (select m1 from s), (select nora from w))),
  'CHS10', null, 'R. no new assignments while the relationship is suspended');
select pg_temp.exec_as((select alice from ids), 'aal2', format('select public.set_facility_relationship_status(%L, ''active'')', (select mercy from rel)));

select lives_ok(pg_temp.as_sql((select wendy from ids), format('select public.accept_shift_assignment(%L)', (select (v ->> 'assignment_id')::uuid from r where k = 'wendy_m1'))),
  'a worker accepts their own assignment');
select is((select status::text from public.shift_assignments where id = (select (v ->> 'assignment_id')::uuid from r where k = 'wendy_m1')),
  'accepted', 'the assignment is accepted');
select is((select count(*)::int from public.audit_events where action = 'assignment.accepted'), 1, 'acceptance is audited');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select public.decline_shift_assignment(%L)', (select (v ->> 'assignment_id')::uuid from r where k = 'wendy_m1'))),
  'CHA09', null, 'an accepted assignment cannot be declined');
select lives_ok(pg_temp.as_sql((select walt from ids), format('select public.decline_shift_assignment(%L)', (select (v ->> 'assignment_id')::uuid from r where k = 'walt_r_ok'))),
  'a worker declines their own assignment');
select is((select count(distinct recipient_profile_id)::int from internal.notification_outbox where event = 'assignment_declined'),
  2, 'assignment_declined is queued once for each agency user with assignment.manage (admin, scheduler)');
select throws_ok(pg_temp.as_sql((select walt from ids), format('select public.accept_shift_assignment(%L)', (select (v ->> 'assignment_id')::uuid from r where k = 'walt_r_ok'))),
  'CHA09', null, 'a declined assignment is not actionable');

-- ---------------------------------------------------------------------------
-- Re-evaluation: eligibility changes after assignment
-- ---------------------------------------------------------------------------
select pg_temp.exec_as((select wendy from ids), 'aal1', format('select public.revoke_credential_share(%L)',
  (select s2.id from public.credential_shares s2 where s2.credential_id = (select (wendy_bls ->> 'credential_id')::uuid from ev)
     and s2.agency_organisation_id = (select alpha from orgs) and s2.status = 'active')));
select is(pg_temp.query_as((select sam from ids), 'aal1', format(
    'select eligible, compliance_reasons from public.list_assignment_readiness(%L, %L)', (select alpha from orgs), (select m_b2b from s))) -> 0,
  '{"eligible": false, "compliance_reasons": ["CREDENTIAL_NOT_SHARED"]}'::jsonb,
  're-evaluation: an assigned worker who stopped sharing BLS is flagged');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select public.accept_shift_assignment(%L)', (select (v ->> 'assignment_id')::uuid from r where k = 'wendy_b2b'))),
  'CHS14', null, 'acceptance re-checks eligibility live');
select ok(internal.scan_assignment_readiness() >= 1, 'the readiness scan hook finds affected upcoming assignments');
select is((select count(*)::int - count(distinct recipient_profile_id)::int from internal.notification_outbox
            where event = 'assignment_non_compliant'
              and subject_id = (select (v ->> 'assignment_id')::uuid from r where k = 'wendy_b2b')),
  0, 'assignment_non_compliant is enqueued once per assignment and recipient');
select throws_ok(pg_temp.as_sql((select rita from ids), format('select * from public.list_assignment_readiness(%L)', (select alpha from orgs))),
  'CH403', null, 'readiness re-evaluation requires assignment.view');

-- ---------------------------------------------------------------------------
-- Cancellation
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.cancel_shift_assignment(%L, ''shift_cancelled'')', (select (v ->> 'assignment_id')::uuid from r where k = 'wendy_b2b'))),
  'CH400', null, 'shift_cancelled is reserved for shift cancellation');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select public.cancel_shift_assignment(%L, ''other'')', (select (v ->> 'assignment_id')::uuid from r where k = 'wendy_b2b'))),
  'CHA04', null, 'a worker cannot use the agency cancellation command');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select public.cancel_shift_assignment(%L, ''other'')', (select (v ->> 'assignment_id')::uuid from r where k = 'wendy_b2b'))),
  'CHA04', null, 'another agency cannot cancel Alpha''s assignment');
select lives_ok(pg_temp.as_sql((select sam from ids), format('select public.cancel_shift_assignment(%L, ''compliance_change'')', (select (v ->> 'assignment_id')::uuid from r where k = 'wendy_b2b'))),
  'a scheduler cancels an assignment with a controlled reason');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.cancel_shift_assignment(%L, ''other'')', (select (v ->> 'assignment_id')::uuid from r where k = 'wendy_b2b'))),
  'CHA09', null, 'a cancelled assignment is not actionable');
select lives_ok(pg_temp.as_sql((select sam from ids), format('select public.cancel_shift(%L, ''entered_in_error'')', (select r_one from s))),
  'cancelling a shift …');
select is((select cancellation_reason::text from public.shift_assignments where shift_id = (select r_one from s)),
  'shift_cancelled', '… cancels its active assignments');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select * from public.assign_worker_to_shift(%L, %L)', (select r_one from s), (select walt from w))),
  'CHS09', null, 'a cancelled shift accepts no further assignments');

-- ---------------------------------------------------------------------------
-- Candidates: capability-gated, no ranking
-- ---------------------------------------------------------------------------
select is(pg_temp.query_as((select sam from ids), 'aal1', format(
    'select display_name, assignable, primary_reason from public.list_shift_candidates(%L)', (select m1 from s))),
  '[{"display_name": "nora", "assignable": false, "primary_reason": "DISCIPLINE_MISMATCH"},
    {"display_name": "walt", "assignable": false, "primary_reason": "WORKER_NOT_ELIGIBLE"}]'::jsonb,
  'candidates: every non-assigned worker, alphabetical, with block reasons (already-assigned excluded)');
select throws_ok(pg_temp.as_sql((select rita from ids), format('select * from public.list_shift_candidates(%L)', (select m1 from s))),
  'CHS04', null, 'a recruiter cannot list candidates');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select * from public.list_shift_candidates(%L)', (select m1 from s))),
  'CHS04', null, 'another agency cannot list candidates');

-- ---------------------------------------------------------------------------
-- Decision visibility and U. structure
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select wendy from ids), 'aal1', 'select * from public.assignment_eligibility_decisions'), 0, 'workers cannot read decisions');
select is(pg_temp.count_as((select fiona from ids), 'aal1', 'select * from public.assignment_eligibility_decisions'), 0, 'facilities cannot read decisions');
select throws_ok(format($$ update public.shift_assignments set profile_id = %L where id = %L $$,
  (select walt from ids), (select (v ->> 'assignment_id')::uuid from r where k = 'wendy_m1')),
  'CH409', null, 'U. an assignment''s person is immutable');
select throws_ok(format($$ update public.shift_assignments set status = 'assigned' where id = %L $$,
  (select (v ->> 'assignment_id')::uuid from r where k = 'walt_r_ok')),
  'CHA09', null, 'U. a declined assignment cannot be revived');
select throws_ok(format($$
  insert into public.shift_assignments (shift_id, agency_organisation_id, agency_worker_id, profile_id, start_at, end_at, assigned_by_membership_id)
  select id, agency_organisation_id, %L, %L, start_at, end_at, %L from public.shifts where id = %L $$,
  (select nora from w), (select walt from ids), pg_temp.membership_of((select alpha from orgs), (select sam from ids)), (select r_soon from s)),
  '23503', null, 'U. an assignment''s person must be the worker record''s person');
select throws_ok(format($$
  insert into public.shift_assignments (shift_id, agency_organisation_id, agency_worker_id, profile_id, start_at, end_at, assigned_by_membership_id)
  select id, agency_organisation_id, %L, %L, start_at + interval '1 hour', end_at, %L from public.shifts where id = %L $$,
  (select nora from w), (select nora from ids), pg_temp.membership_of((select alpha from orgs), (select sam from ids)), (select r_soon from s)),
  '23503', null, 'U. an assignment''s period must be its shift''s period');

select * from finish();
rollback;
