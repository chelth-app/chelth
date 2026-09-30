-- =============================================================================
-- Timesheets: derivation, submission, approval, facility sign-off, revisions
-- (P0-E6-S2)
-- A own timesheets only · B cross-agency · C facility sees only its entries
-- D no sign-off of unrelated entries · E worker cannot approve · F worker cannot
-- edit minutes · G reviewer cannot rewrite time · H duration derives from
-- attendance · I approved correction changes duration · J original event remains
-- K pending correction blocks · L missing clock blocks · M sign-off locks
-- N post-lock correction ⇒ revision + re-approval · O facility sees no
-- coordinates · X platform admin · Z anon / direct writes
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql
\ir _attendance_helpers.psql
\ir _timesheet_helpers.psql

select plan(79);

-- Riverside becomes a linked site of Delta Care: Wendy's Alpha timesheet spans
-- two facilities with two different client organisations.
select pg_temp.exec_as((select erin from ids), 'aal2', format('select public.platform_link_agency_facility(%L, %L)',
  (select riverside from f), (select delta from orgs)));

-- A closed weekly period (two weeks back).
create temp table per as select internal.period_start_for((select alpha from orgs), current_date - 14) as ps;
grant select on per to authenticated;

create temp table p as
select
  pg_temp.past_accepted((select mercy from f), (select mercy_main from loc),
    pg_temp.local_ts((select ps from per) + 1, '09:00', 'America/New_York'),
    pg_temp.local_ts((select ps from per) + 1, '17:00', 'America/New_York'),
    (select wendy from w), (select wendy from ids), (select sam from ids), (select alpha from orgs)) as m1,
  pg_temp.past_accepted((select riverside from f), (select riverside_main from loc),
    pg_temp.local_ts((select ps from per) + 2, '09:00', 'America/Chicago'),
    pg_temp.local_ts((select ps from per) + 2, '13:00', 'America/Chicago'),
    (select wendy from w), (select wendy from ids), (select sam from ids), (select alpha from orgs)) as r1,
  pg_temp.past_accepted((select riverside from f), (select riverside_main from loc),
    pg_temp.local_ts((select ps from per) + 3, '09:00', 'America/Chicago'),
    pg_temp.local_ts((select ps from per) + 3, '17:00', 'America/Chicago'),
    (select walt from w), (select walt from ids), (select sam from ids), (select alpha from orgs)) as w1,
  pg_temp.past_accepted((select riverside from f), (select riverside_main from loc),
    pg_temp.local_ts((select ps from per) + 4, '22:00', 'America/Chicago'),
    pg_temp.local_ts((select ps from per) + 5, '06:00', 'America/Chicago'),
    (select nora from w), (select nora from ids), (select sam from ids), (select alpha from orgs)) as n1;
grant select on p to authenticated;

-- Wendy M1: 09:02 in, break 12:00–12:30, 17:05 out ⇒ 483 − 30 = 453 min.
select pg_temp.past_event((select m1 from p), 'clock_in', pg_temp.local_ts((select ps from per) + 1, '09:02', 'America/New_York'));
select pg_temp.past_event((select m1 from p), 'break_start', pg_temp.local_ts((select ps from per) + 1, '12:00', 'America/New_York'));
select pg_temp.past_event((select m1 from p), 'break_end', pg_temp.local_ts((select ps from per) + 1, '12:30', 'America/New_York'));
select pg_temp.past_event((select m1 from p), 'clock_out', pg_temp.local_ts((select ps from per) + 1, '17:05', 'America/New_York'));
-- Wendy R1: 08:55–13:00 ⇒ 245. Walt W1: clocked in, never out. Nora N1 overnight 22:00–06:00 ⇒ 480.
select pg_temp.past_event((select r1 from p), 'clock_in', pg_temp.local_ts((select ps from per) + 2, '08:55', 'America/Chicago'));
select pg_temp.past_event((select r1 from p), 'clock_out', pg_temp.local_ts((select ps from per) + 2, '13:00', 'America/Chicago'));
select pg_temp.past_event((select w1 from p), 'clock_in', pg_temp.local_ts((select ps from per) + 3, '09:00', 'America/Chicago'));
select pg_temp.past_event((select n1 from p), 'clock_in', pg_temp.local_ts((select ps from per) + 4, '22:00', 'America/Chicago'));
select pg_temp.past_event((select n1 from p), 'clock_out', pg_temp.local_ts((select ps from per) + 5, '06:00', 'America/Chicago'));

create temp table ts as
select (pg_temp.timesheet_of((select m1 from p))).id as wendy,
       (pg_temp.timesheet_of((select w1 from p))).id as walt,
       (pg_temp.timesheet_of((select n1 from p))).id as nora;
grant select on ts to authenticated;

-- ---------------------------------------------------------------------------
-- H. Derived from attendance (one timesheet per worker + period)
-- ---------------------------------------------------------------------------
select is((select period_start from public.timesheets where id = (select wendy from ts)), (select ps from per),
  'entries land in the period containing the shift''s local date');
select is((pg_temp.timesheet_of((select r1 from p))).id, (select wendy from ts),
  'one timesheet per worker and period, spanning facilities');
select is((pg_temp.entry_of((select m1 from p))).worked_minutes, 453,
  'H. worked = (clock-out − clock-in) − breaks: 483 − 30 = 453 minutes');
select is((pg_temp.entry_of((select m1 from p))).break_minutes, 30, 'H. the recorded break is 30 minutes');
select is(jsonb_array_length((pg_temp.entry_of((select m1 from p))).breaks), 1, 'the entry lists its break');
select is((pg_temp.entry_of((select r1 from p))).worked_minutes, 245, 'an early clock-in counts from the actual time (245)');
select is((pg_temp.entry_of((select n1 from p))).worked_minutes, 480, 'overnight: 22:00 → 06:00 is 480 minutes');
select is((pg_temp.entry_of((select n1 from p))).local_date, (select ps from per) + 4,
  'overnight: the entry belongs to the shift''s start date');
select is((pg_temp.entry_of((select w1 from p))).worked_minutes, null::integer,
  'no clock-out ⇒ no worked time (an end is never invented)');
select is((pg_temp.entry_of((select w1 from p))).blocking_reasons, array['MISSING_CLOCK_OUT'],
  'the incomplete entry explains why');
select is(internal.whole_minutes('2030-11-03 00:00 America/New_York', '2030-11-03 08:00 America/New_York'), 540,
  'DST fall-back night: 8 wall-clock hours are 540 real minutes');
select is(internal.whole_minutes('2030-03-10 00:00 America/New_York', '2030-03-10 08:00 America/New_York'), 420,
  'DST spring-forward night: 8 wall-clock hours are 420 real minutes');
select ok(internal.period_closed((select ps from per) + 6) and not internal.period_closed(current_date),
  'a period is submittable only after its last local date has ended everywhere');

-- ---------------------------------------------------------------------------
-- A / B / X. Visibility
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select wendy from ids), 'aal1', 'select * from public.timesheets'), 1,
  'A. a worker sees only their own timesheet');
select is(pg_temp.count_as((select walt from ids), 'aal1', format('select * from public.timesheet_entries where timesheet_id = %L', (select wendy from ts))), 0,
  'A. …never another worker''s entries');
select throws_ok(pg_temp.as_sql((select walt from ids), format('select * from public.list_timesheet_entries(%L)', (select wendy from ts))),
  'CHP04', null, 'A. …not even through the projection');
select is(pg_temp.count_as((select bob from ids), 'aal2', 'select * from public.timesheets'), 0,
  'B. another agency reads no timesheets');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select * from public.get_timesheet(%L)', (select wendy from ts)), 'aal2'),
  'CHP04', null, 'B. …and cannot open one by id');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select * from public.list_agency_timesheets(%L)', (select alpha from orgs)), 'aal2'),
  'CH403', null, 'B. …or list them');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.timesheet_entries'), 0,
  'X. a platform admin has no tenant timesheet path');
select is(pg_temp.count_as((select sam from ids), 'aal1', format('select * from public.list_agency_timesheets(%L)', (select alpha from orgs))), 3,
  'a scheduler (timesheet.view) sees the agency''s timesheets');
select is(pg_temp.count_as((select rita from ids), 'aal1', 'select * from public.timesheets'), 0,
  'a recruiter has no timesheet access');

-- ---------------------------------------------------------------------------
-- F / G / Z. Nobody writes time directly
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select wendy from ids), format('update public.timesheet_entries set worked_minutes = 999 where assignment_id = %L', (select m1 from p))),
  '42501', null, 'F. a worker cannot edit worked minutes');
select throws_ok(pg_temp.as_sql((select alice from ids), format('update public.timesheet_entries set effective_end_at = now() where assignment_id = %L', (select m1 from p)), 'aal2'),
  '42501', null, 'G. an agency reviewer cannot rewrite time');
select throws_ok(format('update public.timesheet_entries set worked_minutes = 999 where assignment_id = %L', (select m1 from p)),
  'CH409', null, 'F/G. even the owner role cannot write derived time outside the calculation');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('insert into public.timesheets (agency_organisation_id, agency_worker_id, profile_id, period_start, period_end) values (%L, %L, %L, current_date, current_date + 6)',
  (select alpha from orgs), (select wendy from w), (select wendy from ids))),
  '42501', null, 'Z. no direct inserts');
select throws_ok(pg_temp.as_sql((select alice from ids), format('update public.timesheets set status = ''locked'' where id = %L', (select wendy from ts)), 'aal2'),
  '42501', null, 'Z. no direct status changes');

-- ---------------------------------------------------------------------------
-- K / L. Submission gating
-- ---------------------------------------------------------------------------
select is(pg_temp.outcome_as((select walt from ids), format('select * from public.submit_timesheet(%L)', (select walt from ts))),
  'blocked:MISSING_CLOCK_OUT', 'L. a missing clock-out blocks submission, with the reason');
create temp table wc as select pg_temp.scalar_as((select walt from ids), 'aal1', format(
  'select public.request_attendance_correction(%L, ''clock_out'', %L, ''forgot_to_clock'')',
  (select w1 from p), pg_temp.local_ts((select ps from per) + 3, '17:00', 'America/Chicago')))::uuid as id;
select is(pg_temp.outcome_as((select walt from ids), format('select * from public.submit_timesheet(%L)', (select walt from ts))),
  'blocked:MISSING_CLOCK_OUT,PENDING_CORRECTION', 'K. a pending correction blocks submission');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.submit_timesheet(%L)', (select walt from ts))),
  'CHP04', null, 'a worker cannot submit someone else''s timesheet');
select pg_temp.exec_as((select alice from ids), 'aal1', format(
  'select public.review_attendance_correction(%L, true, ''approved_as_requested'')', (select id from wc)));
select is((pg_temp.entry_of((select w1 from p))).worked_minutes, 480, 'the approved correction completes the entry (480)');
select is(pg_temp.outcome_as((select walt from ids), format('select * from public.submit_timesheet(%L)', (select walt from ts))),
  'submitted:', 'once complete, the worker submits');

-- ---------------------------------------------------------------------------
-- Wendy: submit, exception gating, approval
-- ---------------------------------------------------------------------------
select internal.open_attendance_exception(pg_temp.attendance_of((select m1 from p)), 'late_clock_in', 'attention', 'clock_action');
select internal.refresh_attendance((pg_temp.attendance_of((select m1 from p))).id);
select is(pg_temp.outcome_as((select wendy from ids), format('select * from public.submit_timesheet(%L)', (select wendy from ts))),
  'submitted:', 'a worker may submit with an unreviewed late clock-in (not theirs to resolve)');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.submit_timesheet(%L)', (select wendy from ts))),
  'CHP09', null, 'a submitted timesheet cannot be submitted again');
select is((select count(*)::int from internal.notification_outbox where event = 'timesheet_submitted' and subject_id = (select wendy from ts)),
  1, 'submission notifies agency approvers');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.approve_timesheet(%L, 1)', (select wendy from ts))),
  'CHP04', null, 'E. a worker cannot approve their own timesheet');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select * from public.approve_timesheet(%L, 1)', (select wendy from ts))),
  'CH403', null, 'a scheduler (view only) cannot approve');
select is(pg_temp.outcome_as((select alice from ids), format('select * from public.approve_timesheet(%L, 1)', (select wendy from ts))),
  'blocked:UNREVIEWED_EXCEPTION', 'approval requires every attendance exception to be reviewed');
select pg_temp.exec_as((select alice from ids), 'aal1', format('select public.review_attendance_exception(%L, ''resolved'', ''acknowledged'')',
  (select id from public.attendance_exceptions where assignment_id = (select m1 from p) and exception_type = 'late_clock_in')));
select throws_ok(pg_temp.as_sql((select alice from ids), format('select * from public.approve_timesheet(%L, 7)', (select wendy from ts))),
  'CHP14', null, 'approval names the revision it saw (stale approvals are refused)');
select is(pg_temp.outcome_as((select alice from ids), format('select * from public.approve_timesheet(%L, 1)', (select wendy from ts))),
  'agency_approved:', 'the agency approves');
select is((select total_worked_minutes from public.timesheet_approvals where timesheet_id = (select wendy from ts) and revision = 1),
  698, 'the approval snapshot totals 453 + 245 = 698 minutes');
select ok((select snapshot::text !~* 'latitude|longitude|note' from public.timesheet_approvals where timesheet_id = (select wendy from ts)),
  'the snapshot holds derived times and codes only');
select is((select array_agg(facility_state::text order by local_date) from public.timesheet_entries where timesheet_id = (select wendy from ts)),
  array['pending', 'pending'], 'each linked facility must sign off its own entry');
select is((select array_agg(distinct audience_organisation_id order by audience_organisation_id) from internal.notification_outbox
           where event = 'timesheet_facility_signoff_required' and subject_id = (select wendy from ts)),
  (select array_agg(x order by x) from unnest(array[(select gamma from orgs), (select delta from orgs)]) x),
  'one sign-off notice per facility organisation');

-- ---------------------------------------------------------------------------
-- C / D / O. Facility sign-off is per entry and relationship-scoped
-- ---------------------------------------------------------------------------
select is((pg_temp.query_as((select fiona from ids), 'aal1', format('select entry_id from public.list_facility_timesheet_entries(%L)', (select gamma from orgs))) -> 0 ->> 'entry_id')::uuid,
  (pg_temp.entry_of((select m1 from p))).id, 'C. Gamma sees only the Mercy entry');
select is(pg_temp.count_as((select fiona from ids), 'aal1', format('select * from public.list_facility_timesheet_entries(%L)', (select gamma from orgs))),
  1, 'C. …exactly one entry');
select is(pg_temp.count_as((select dora from ids), 'aal1', format('select * from public.list_facility_timesheet_entries(%L)', (select delta from orgs))),
  1, 'C. Delta sees only the Riverside entry (not Beta''s work, not Mercy)');
select throws_ok(pg_temp.as_sql((select fiona from ids), format('select * from public.list_facility_timesheet_entries(%L)', (select delta from orgs))),
  'CH403', null, 'C. a facility cannot list another facility''s entries');
select is(pg_temp.count_as((select fiona from ids), 'aal1', 'select * from public.timesheet_entries'), 0,
  'C. facilities have no table path to entries');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.query_as((select fiona from ids), 'aal1',
            format('select * from public.list_facility_timesheet_entries(%L)', (select gamma from orgs))) -> 0) k),
  array['agency_name', 'break_minutes', 'breaks', 'decided_at', 'dispute_reason', 'effective_end_at', 'effective_start_at',
        'entry_id', 'facility_name', 'facility_state', 'had_attendance_exception', 'local_date', 'location_name',
        'scheduled_end_at', 'scheduled_start_at', 'timesheet_revision', 'timezone', 'worked_minutes', 'worker_display_name'],
  'O. the facility projection is narrow: no coordinates, notes or credentials');
select throws_ok(pg_temp.as_sql((select fiona from ids), format('select public.facility_decide_timesheet_entry(%L, 1, true)', (pg_temp.entry_of((select r1 from p))).id)),
  'CHP12', null, 'D. Gamma cannot sign off Riverside''s entry');
select throws_ok(pg_temp.as_sql((select dora from ids), format('select public.facility_decide_timesheet_entry(%L, 1, true)', (pg_temp.entry_of((select m1 from p))).id)),
  'CHP12', null, 'D. Delta cannot sign off Mercy''s entry');
select is(pg_temp.scalar_as((select fiona from ids), 'aal1', format('select public.facility_decide_timesheet_entry(%L, 1, true)', (pg_temp.entry_of((select m1 from p))).id)),
  'agency_approved', 'Gamma signs off its entry; Riverside is still pending');
select is(pg_temp.scalar_as((select dora from ids), 'aal1', format('select public.facility_decide_timesheet_entry(%L, 1, true)', (pg_temp.entry_of((select r1 from p))).id)),
  'locked', 'M. the last sign-off locks the timesheet');
select throws_ok($$ select set_config('chelth.timesheet_write', 'on', true); update public.timesheet_entries set worked_minutes = 1 where timesheet_id = (select wendy from ts) $$,
  'CHP09', null, 'M. locked entries cannot change time, even through the trusted path');

-- ---------------------------------------------------------------------------
-- N / I / J. A correction after lock ⇒ explicit revision, re-approval, re-sign-off
-- ---------------------------------------------------------------------------
create temp table lc as select pg_temp.scalar_as((select wendy from ids), 'aal1', format(
  'select public.request_attendance_correction(%L, ''clock_out'', %L, ''recorded_wrong_time'')',
  (select m1 from p), pg_temp.local_ts((select ps from per) + 1, '17:35', 'America/New_York')))::uuid as id;
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.review_attendance_correction(%L, true, ''approved_as_requested'')', (select id from lc))),
  'CHT22', null, 'N. approving a change to a locked timesheet needs explicit confirmation');
select pg_temp.exec_as((select alice from ids), 'aal1', format(
  'select public.review_attendance_correction(%L, true, ''approved_as_requested'', null, null, null, true)', (select id from lc)));
select is((select status::text || '/' || revision from public.timesheets where id = (select wendy from ts)), 'submitted/2',
  'N. the change creates revision 2 awaiting agency re-approval');
select is((select superseded_at is not null from public.timesheet_approvals where timesheet_id = (select wendy from ts) and revision = 1),
  true, 'N. the previous approval is superseded, not edited');
select is((select count(*)::int from public.timesheet_facility_signoffs where timesheet_id = (select wendy from ts) and superseded_at is null),
  0, 'N. prior facility sign-offs are superseded');
select is((pg_temp.entry_of((select m1 from p))).worked_minutes, 483, 'I. the approved correction changes worked time (17:35 ⇒ 483)');
select is((select count(*)::int from public.attendance_events where assignment_id = (select m1 from p) and event_type = 'clock_out'),
  1, 'J. the original clock-out event remains');
select is((select count(*)::int from public.timesheet_history where timesheet_id = (select wendy from ts) and action = 'revised'),
  1, 'the revision is recorded in timesheet history');
select is(pg_temp.outcome_as((select alice from ids), format('select * from public.approve_timesheet(%L, 2)', (select wendy from ts))),
  'agency_approved:', 'revision 2 is re-approved');

-- Separation of duties across tenants: a worker who is also a facility supervisor cannot sign their own entry.
select pg_temp.add_member((select gamma from orgs), (select wendy from ids), 'facility.supervisor');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select public.facility_decide_timesheet_entry(%L, 2, true)', (pg_temp.entry_of((select m1 from p))).id)),
  'CH403', null, 'a worker cannot sign off their own entry as a facility member');

-- Facility discrepancy → agency confirms → sign-off → locked
select is(pg_temp.scalar_as((select fiona from ids), 'aal1', format(
  'select public.facility_decide_timesheet_entry(%L, 2, false, ''break_incorrect'', ''Break looked longer'')', (pg_temp.entry_of((select m1 from p))).id)),
  'agency_approved', 'a facility can raise a discrepancy instead of signing');
select is((pg_temp.entry_of((select m1 from p))).facility_state::text, 'disputed', 'the entry is disputed, times untouched');
select is((select count(*)::int from internal.notification_outbox where event = 'timesheet_disputed'), 1,
  'the agency is told about the discrepancy');
select pg_temp.exec_as((select alice from ids), 'aal1', format('select public.resolve_timesheet_dispute(%L, ''Supervisor confirmed'')',
  (pg_temp.entry_of((select m1 from p))).id));
select is((pg_temp.entry_of((select m1 from p))).facility_state::text, 'pending', 'confirming the times returns the entry to the facility');
select pg_temp.exec_as((select fiona from ids), 'aal1', format('select public.facility_decide_timesheet_entry(%L, 2, true)', (pg_temp.entry_of((select m1 from p))).id));
select is(pg_temp.scalar_as((select dora from ids), 'aal1', format('select public.facility_decide_timesheet_entry(%L, 2, true)', (pg_temp.entry_of((select r1 from p))).id)),
  'locked', 'both facilities sign revision 2: locked again');

-- Reject / reopen
select pg_temp.exec_as((select alice from ids), 'aal1', format('select public.reject_timesheet(%L, ''missing_information'', ''Add the handover time'')', (select walt from ts)));
select is((select status::text from public.timesheets where id = (select walt from ts)), 'rejected', 'the agency can return a timesheet');
select is((pg_temp.query_as((select walt from ids), 'aal1', format('select * from public.get_timesheet(%L)', (select walt from ts))) -> 0 ->> 'return_note'),
  'Add the handover time', 'the worker sees why it was returned');
select is(pg_temp.outcome_as((select walt from ids), format('select * from public.submit_timesheet(%L)', (select walt from ts))),
  'submitted:', 'and resubmits');
select pg_temp.exec_as((select alice from ids), 'aal1', format('select public.reopen_timesheet(%L, ''approved_in_error'')', (select wendy from ts)));
select is((select status::text || '/' || revision from public.timesheets where id = (select wendy from ts)), 'open/3',
  'reopening a locked timesheet is explicit and creates a new revision');

-- ---------------------------------------------------------------------------
-- History, immutability, settings
-- ---------------------------------------------------------------------------
select throws_ok($$ update public.timesheet_approvals set total_worked_minutes = 1 $$, 'CH409', null,
  'approval snapshots are immutable');
select throws_ok($$ delete from public.timesheet_history $$, 'CH409', null, 'timesheet history is append-only');
select throws_ok($$ update public.timesheet_facility_signoffs set decision = 'disputed', dispute_reason = 'other' $$, 'CH409', null,
  'facility decisions are immutable');
select is((pg_temp.query_as((select wendy from ids), 'aal1', format('select count(*) filter (where note is not null or actor_name is not null) as n from public.list_timesheet_history(%L)', (select wendy from ts))) -> 0 ->> 'n')::int,
  0, 'the worker sees actions, not facility notes or staff names');
select throws_ok(pg_temp.as_sql((select alice from ids), format('select public.set_agency_timesheet_settings(%L, 7::smallint)', (select alpha from orgs)), 'aal2'),
  'CHP15', null, 'the week start is fixed once timesheets exist (deterministic periods)');
select lives_ok(pg_temp.as_sql((select bob from ids), format('select public.set_agency_timesheet_settings(%L, 7::smallint)', (select beta from orgs)), 'aal2'),
  'an agency without timesheets can choose its week start');

select * from finish();
rollback;
