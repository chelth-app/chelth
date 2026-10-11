-- =============================================================================
-- Attendance review hardening (P0-E6-S2)
-- breaks · reviewer-adjusted corrections · correction history · not worked
-- U refused clock-in rate limit · V bounded audit on the rate-limit path
-- W facility view audit dedupe · P/Q raw evidence viewer (AAL2, audited)
-- R purge keeps events/results · S legal hold · T purge per tenant
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql
\ir _attendance_helpers.psql
\ir _timesheet_helpers.psql

select plan(63);

-- ---------------------------------------------------------------------------
-- Breaks (Walt, Riverside, started 10 minutes ago)
-- ---------------------------------------------------------------------------
create temp table b as
select pg_temp.accepted((select sam from ids),
  pg_temp.shift_between((select sam from ids), (select riverside from f), (select riverside_main from loc),
    now() - interval '10 minutes', now() + interval '2 hours'),
  (select walt from w), (select walt from ids)) as a;
grant select on b to authenticated;

select is(pg_temp.clock_in((select walt from ids), (select a from b)) ->> 'outcome', 'recorded', 'Walt clocks in');
select is((pg_temp.query_as((select walt from ids), 'aal1', format('select * from public.start_break_assignment(%L)', (select a from b))) -> 0 ->> 'segment')::int,
  1, 'a break starts (segment 1), server-timed, no location');
select throws_ok(pg_temp.as_sql((select walt from ids), format('select * from public.start_break_assignment(%L)', (select a from b))),
  'CHT19', null, 'a second break cannot start while on a break');
select throws_ok(pg_temp.as_sql((select walt from ids), format('select * from public.clock_out_assignment(%L)', (select a from b))),
  'CHT21', null, 'clock-out is refused while on a break');
select is((pg_temp.attendance_of((select a from b))).clock_state::text, 'on_break', 'the projection shows on_break');
select is((pg_temp.query_as((select walt from ids), 'aal1', format('select can_end_break from public.list_my_attendance(%L)', (select alpha from orgs))) -> 0 ->> 'can_end_break')::boolean,
  true, 'the worker is offered "End break"');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.end_break_assignment(%L)', (select a from b))),
  'CHA04', null, 'nobody else can end the worker''s break');
select lives_ok(pg_temp.as_sql((select walt from ids), format('select * from public.end_break_assignment(%L)', (select a from b))),
  'the break ends');
select throws_ok(pg_temp.as_sql((select walt from ids), format('select * from public.end_break_assignment(%L)', (select a from b))),
  'CHT20', null, 'break_end without an open break is refused');
select is((pg_temp.query_as((select walt from ids), 'aal1', format('select * from public.start_break_assignment(%L)', (select a from b))) -> 0 ->> 'segment')::int,
  2, 'a second break is segment 2');
select pg_temp.exec_as((select walt from ids), 'aal1', format('select * from public.end_break_assignment(%L)', (select a from b)));
select is(pg_temp.clock_out((select walt from ids), (select a from b)) ->> 'outcome', 'recorded', 'clock-out after the breaks');
select is((select string_agg(event_type::text || segment, ',' order by sequence) from public.attendance_events where assignment_id = (select a from b)),
  'clock_in1,break_start1,break_end1,break_start2,break_end2,clock_out1', 'the full segment history is appended in order');
select is((pg_temp.entry_of((select a from b))).complete, true, 'the timesheet entry is complete');

-- ---------------------------------------------------------------------------
-- Reviewer-adjusted correction (Nora: clocked in 10 h ago, never out)
-- ---------------------------------------------------------------------------
create temp table n as
select pg_temp.past_accepted((select riverside from f), (select riverside_main from loc), now() - interval '10 hours',
  now() - interval '2 hours', (select nora from w), (select nora from ids), (select sam from ids), (select alpha from orgs)) as a;
grant select on n to authenticated;
select pg_temp.past_clock_in((select a from n), now() - interval '10 hours');
create temp table nc as select pg_temp.scalar_as((select nora from ids), 'aal1', format(
  'select public.request_attendance_correction(%L, ''clock_out'', now() - interval ''2 hours'', ''forgot_to_clock'', ''Left at handover'')',
  (select a from n)))::uuid as id;
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.review_attendance_correction(%L, true, ''approved_with_adjustment'', now() - interval ''150 minutes'')', (select id from nc))),
  'CH400', null, 'an adjusted approval requires a structured reason');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.review_attendance_correction(%L, true, ''approved_with_adjustment'', now() - interval ''2 hours'', ''supervisor_observation'')', (select id from nc))),
  'CH400', null, 'an "adjustment" equal to the request is not an adjustment');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.review_attendance_correction(%L, true, ''approved_with_adjustment'', now() + interval ''1 hour'', ''supervisor_observation'')', (select id from nc))),
  'CHT16', null, 'an adjusted time cannot be in the future');
select lives_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.review_attendance_correction(%L, true, ''approved_with_adjustment'', now() - interval ''150 minutes'', ''supervisor_observation'', ''Handover finished earlier'')', (select id from nc))),
  'the reviewer approves a different time with a reason and note');
select is((select resolution::text || '/' || (approved_time = now() - interval '150 minutes') || '/' || reviewer_note from public.attendance_corrections where id = (select id from nc)),
  'approved_with_adjustment/true/Handover finished earlier', 'the decision records the adjusted time, reason and note');
select is((select occurred_at from public.attendance_events where assignment_id = (select a from n) and event_type = 'corrected_clock_out'),
  now() - interval '150 minutes', 'a corrected event is appended at the adjusted time');
select is((select count(*)::int from internal.notification_outbox where event = 'attendance_time_adjusted' and recipient_profile_id = (select nora from ids)),
  1, 'the worker is told their time was adjusted');
select is((pg_temp.entry_of((select a from n))).worked_minutes, 450, 'the timesheet recalculates (10 h − 2.5 h = 450 min)');
select ok((select metadata::text !~ '(Handover|T[0-9]{2}:)' from public.audit_events where action = 'attendance.correction_approved' and target_id = (select id from nc)),
  'audit carries codes, not the note or times');

-- History: original → request → decision → corrected event
select is((select string_agg((r ->> 'item_kind') || ':' || (r ->> 'event_type'), ',')
           from jsonb_array_elements(pg_temp.query_as((select nora from ids), 'aal1', format('select * from public.list_attendance_history(%L)', (pg_temp.attendance_of((select a from n))).id))) r),
  'event:clock_in,event:corrected_clock_out,correction:clock_out,exception:manual_correction_requested',
  'the worker sees the original event, their request, the corrected event and the exception lifecycle');
select is((select count(*)::int from jsonb_array_elements(pg_temp.query_as((select nora from ids), 'aal1', format('select * from public.list_attendance_history(%L)', (pg_temp.attendance_of((select a from n))).id))) r
           where r -> 'detail' ->> 'reviewer_name' is not null or r -> 'detail' ->> 'actor_name' is not null),
  0, 'the worker''s history has no staff names');
select is((select count(*)::int from jsonb_array_elements(pg_temp.query_as((select alice from ids), 'aal1', format('select * from public.list_attendance_history(%L)', (pg_temp.attendance_of((select a from n))).id))) r
           where r -> 'detail' ->> 'reviewer_name' is not null),
  2, 'the agency sees who reviewed the correction and closed its exception');

-- Reviewer-originated adjustment: add a recorded break
select throws_ok(pg_temp.as_sql((select sam from ids), format(
  'select public.adjust_attendance_time(%L, ''break_start'', now() - interval ''6 hours'', ''break_not_recorded'')', (pg_temp.attendance_of((select a from n))).id)),
  'CH403', null, 'a scheduler (view only) cannot adjust attendance');
select throws_ok(pg_temp.as_sql((select nora from ids), format(
  'select public.adjust_attendance_time(%L, ''break_start'', now() - interval ''6 hours'', ''break_not_recorded'')', (pg_temp.attendance_of((select a from n))).id)),
  'CHT04', null, 'a worker cannot adjust their own attendance');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.adjust_attendance_time(%L, ''break_start'', now() - interval ''6 hours'', null)', (pg_temp.attendance_of((select a from n))).id)),
  'CH400', null, 'a reviewer adjustment requires a reason');
select pg_temp.exec_as((select alice from ids), 'aal1', format(
  'select public.adjust_attendance_time(%L, ''break_start'', now() - interval ''6 hours'', ''break_not_recorded'', ''Lunch per rota'')', (pg_temp.attendance_of((select a from n))).id));
select pg_temp.exec_as((select alice from ids), 'aal1', format(
  'select public.adjust_attendance_time(%L, ''break_end'', now() - interval ''330 minutes'', ''break_not_recorded'')', (pg_temp.attendance_of((select a from n))).id));
select is((pg_temp.entry_of((select a from n))).break_minutes || '/' || (pg_temp.entry_of((select a from n))).worked_minutes, '30/420',
  'the added break reduces worked time (450 − 30 = 420)');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.adjust_attendance_time(%L, ''break_end'', now() - interval ''7 hours'', ''device_or_app_problem'')', (pg_temp.attendance_of((select a from n))).id)),
  'CHT16', null, 'an adjustment that would put times out of order is refused (nothing appended)');
select is((select count(*)::int from public.attendance_corrections where attendance_id = (pg_temp.attendance_of((select a from n))).id and origin = 'reviewer_adjustment'),
  2, 'reviewer adjustments are recorded as approved corrections');

-- Not worked (a no-show is closed explicitly, never invented as time)
create temp table ns as
select pg_temp.past_accepted((select mercy from f), (select mercy_main from loc), now() - interval '30 hours',
  now() - interval '22 hours', (select wendy from w), (select wendy from ids), (select sam from ids), (select alpha from orgs)) as a;
select internal.run_attendance_scan();
select pg_temp.exec_as((select alice from ids), 'aal1', format('select public.review_attendance_exception(%L, ''resolved'', ''not_worked'')',
  (select id from public.attendance_exceptions where assignment_id = (select a from ns) and exception_type = 'missed_clock_in')));
select is((select not_worked::text || '/' || worked_minutes || '/' || complete from public.timesheet_entries where assignment_id = (select a from ns)),
  'true/0/true', 'a no-show becomes a complete, zero-minute "not worked" entry');

-- ---------------------------------------------------------------------------
-- U / V. Refused clock-in rate limit (Wendy outside a blocking geofence)
-- ---------------------------------------------------------------------------
select pg_temp.exec_as((select alice from ids), 'aal2', format(
  'select public.set_location_geofence(%L, true, %s, %s, 200, 100, ''block'')', (select mercy_east from loc), pg_temp.site_lat(), pg_temp.site_lon()));
create temp table rl as
select pg_temp.accepted((select sam from ids),
  pg_temp.shift_between((select sam from ids), (select mercy from f), (select mercy_east from loc),
    now() + interval '10 minutes', now() + interval '2 hours'),
  (select wendy from w), (select wendy from ids)) as a;
grant select on rl to authenticated;
create temp table tries as
select pg_temp.clock_in((select wendy from ids), (select a from rl), pg_temp.site_lat() + pg_temp.lat_offset(1000), pg_temp.site_lon(), 10) ->> 'outcome' as outcome
from generate_series(1, 10);
select is((select string_agg(distinct outcome, ',') from tries), 'refused', 'ten outside attempts are each refused and recorded');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.clock_in_assignment(%L, %s, %s, 10, now())',
  (select a from rl), pg_temp.site_lat() + pg_temp.lat_offset(1000), pg_temp.site_lon())),
  'CH429', null, 'U. the eleventh refusal in 10 minutes is rate limited');
select is((select count(*)::int from public.audit_events where action = 'attendance.clock_in_refused'), 10,
  'V. the rate-limited attempt writes no audit row (bounded at 10)');
select is((select count(*)::int from public.attendance_exceptions where assignment_id = (select a from rl)), 1,
  'V. one exception, not one per attempt');
select is((select count(*)::int from internal.notification_outbox where event = 'attendance_clock_in_blocked'), 1,
  'V. one agency notification, not one per attempt');
select throws_ok(pg_temp.as_sql((select alice from ids), format('select public.review_attendance_exception(%L, ''resolved'', ''not_worked'')',
  (select id from public.attendance_exceptions where assignment_id = (select a from rl) and exception_type = 'outside_geofence'))),
  'CH400', null, '"not worked" applies only to a missed clock-in');
select is(pg_temp.clock_in((select wendy from ids), (select a from rl), pg_temp.site_lat(), pg_temp.site_lon(), 10) ->> 'outcome',
  'recorded', 'a legitimate clock-in from inside still works after the limit');

-- ---------------------------------------------------------------------------
-- W. Facility view audit dedupe (one per viewer + shift per 15 minutes)
-- ---------------------------------------------------------------------------
select pg_temp.count_as((select fiona from ids), 'aal1', format('select * from public.list_facility_shift_attendance(%L)', (select shift_id from public.shift_assignments where id = (select a from rl))));
select pg_temp.count_as((select fiona from ids), 'aal1', format('select * from public.list_facility_shift_attendance(%L)', (select shift_id from public.shift_assignments where id = (select a from rl))));
select is((select count(*)::int from public.audit_events where action = 'attendance.viewed_by_facility'), 1,
  'W. repeated views of the same shift are audited once per window');
select pg_temp.count_as((select fred from ids), 'aal1', format('select * from public.list_facility_shift_attendance(%L)', (select shift_id from public.shift_assignments where id = (select a from rl))));
select is((select count(*)::int from public.audit_events where action = 'attendance.viewed_by_facility'), 2,
  'W. a different viewer is still audited (traceability kept per person)');

-- ---------------------------------------------------------------------------
-- P / Q. Raw evidence viewer
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select sam from ids), format('select * from public.list_attendance_location_evidence(%L)', (pg_temp.attendance_of((select a from rl))).id)),
  'CH403', null, 'P. a scheduler cannot open raw evidence');
select throws_ok(pg_temp.as_sql((select alice from ids), format('select * from public.list_attendance_location_evidence(%L)', (pg_temp.attendance_of((select a from rl))).id)),
  'CH402', null, 'P. the admin must step up to AAL2');
select throws_ok(pg_temp.as_sql((select fiona from ids), format('select * from public.list_attendance_location_evidence(%L)', (pg_temp.attendance_of((select a from rl))).id), 'aal2'),
  'CHT04', null, 'a facility never reaches raw evidence');
select is((pg_temp.query_as((select alice from ids), 'aal2', format('select state, retention_days from public.list_attendance_location_evidence(%L)', (pg_temp.attendance_of((select a from rl))).id)) -> 0 ->> 'state'),
  'retained', 'P. at AAL2 the admin sees retained evidence');
select is((select count(*)::int from public.audit_events where action = 'attendance.location_viewed'), 1,
  'Q. every raw evidence read is audited');

-- ---------------------------------------------------------------------------
-- Retention, purge, legal hold
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select alice from ids), format('select public.set_location_evidence_retention(%L, 3)', (select alpha from orgs)), 'aal2'),
  'CH400', null, 'retention is bounded (7–365 days)');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.set_location_evidence_retention(%L, 30)', (select alpha from orgs))),
  'CH403', null, 'only attendance.manage_settings changes retention');

-- Old evidence, arranged as owner: A1/A2 Alpha 100 days, A3 Alpha 30 days, B1 Beta 31 days.
create function pg_temp.old_evidence(p_assignment uuid, p_at timestamptz) returns uuid language plpgsql as $$
declare
  att public.assignment_attendance := internal.ensure_attendance(p_assignment);
  v_event uuid;
begin
  insert into public.attendance_events (attendance_id, assignment_id, agency_organisation_id, event_type, occurred_at,
    recorded_at, source, geofence_result)
  values (att.id, att.assignment_id, att.agency_organisation_id, 'clock_in', p_at, p_at, 'worker_device', 'inside')
  returning id into v_event;
  insert into public.attendance_location_evidence (event_id, attendance_id, agency_organisation_id, latitude, longitude,
    accuracy_meters, device_captured_at, distance_meters, radius_meters, result, recorded_at)
  values (v_event, att.id, att.agency_organisation_id, 40.7128, -74.006, 12, p_at, 10, 200, 'inside', p_at);
  perform internal.refresh_attendance(att.id);
  return att.id;
end;
$$;
create temp table oe as
select pg_temp.old_evidence(pg_temp.past_accepted((select riverside from f), (select riverside_main from loc), now() - interval '100 days',
         now() - interval '100 days' + interval '8 hours', (select walt from w), (select walt from ids), (select sam from ids), (select alpha from orgs)),
         now() - interval '100 days') as a1,
       pg_temp.old_evidence(pg_temp.past_accepted((select riverside from f), (select riverside_main from loc), now() - interval '100 days',
         now() - interval '100 days' + interval '8 hours', (select nora from w), (select nora from ids), (select sam from ids), (select alpha from orgs)),
         now() - interval '100 days') as a2,
       pg_temp.old_evidence(pg_temp.past_accepted((select mercy from f), (select mercy_main from loc), now() - interval '30 days',
         now() - interval '30 days' + interval '8 hours', (select wendy from w), (select wendy from ids), (select sam from ids), (select alpha from orgs)),
         now() - interval '30 days') as a3,
       pg_temp.old_evidence(pg_temp.past_accepted((select beta_client from f), (select beta_main from loc), now() - interval '31 days',
         now() - interval '31 days' + interval '8 hours', (select wendy_beta from w), (select wendy from ids), (select bob from ids), (select beta from orgs)),
         now() - interval '31 days') as b1;
grant select on oe to authenticated;

select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.place_location_evidence_hold(%L, ''Grievance 42'')', (select a2 from oe))),
  'CH403', null, 'only raw-evidence holders can place a legal hold');
create temp table hold as select pg_temp.scalar_as((select alice from ids), 'aal2', format(
  'select public.place_location_evidence_hold(%L, ''Grievance 42'')', (select a2 from oe)))::uuid as id;
select ok((select metadata::text !~ 'Grievance' from public.audit_events where action = 'attendance.location_hold_placed'),
  'the hold reason is never audited');
select pg_temp.exec_as((select bob from ids), 'aal2', format('select public.set_location_evidence_retention(%L, 7)', (select beta from orgs)));

select is(internal.run_location_evidence_purge() ->> 'purged', '2', 'the purge removes coordinates past retention (Alpha 100 d, Beta 31 d)');
select is((select (latitude is null and longitude is null and device_captured_at is null and purged_at is not null)::text
                  || '/' || result || '/' || distance_meters
           from public.attendance_location_evidence where attendance_id = (select a1 from oe)),
  'true/inside/10', 'R. coordinates are gone; the result and distance classification remain');
select is((select geofence_result::text from public.attendance_events where attendance_id = (select a1 from oe) and event_type = 'clock_in'),
  'inside', 'R. the attendance event and its result are untouched');
select is((select latitude from public.attendance_location_evidence where attendance_id = (select a2 from oe)), 40.7128::double precision,
  'S. evidence on legal hold is not purged');
select is((select latitude from public.attendance_location_evidence where attendance_id = (select a3 from oe)), 40.7128::double precision,
  'T. Alpha''s 30-day evidence is kept (Alpha retains 90 days)');
select is((select purged_at is not null from public.attendance_location_evidence where attendance_id = (select b1 from oe)), true,
  'T. Beta''s own 7-day policy applies only to Beta''s evidence');
select is((select string_agg(organisation_id::text || '=' || (metadata ->> 'purged'), ',' order by organisation_id::text)
           from public.audit_events where action = 'attendance.location_purged'),
  (select string_agg(x::text || '=1', ',' order by x::text) from unnest(array[(select alpha from orgs), (select beta from orgs)]) x),
  'each tenant''s purge is audited as a count only');
select is(internal.run_location_evidence_purge() ->> 'purged', '0', 'the purge is idempotent');
select pg_temp.exec_as((select alice from ids), 'aal2', format('select public.release_location_evidence_hold(%L)', (select id from hold)));
select is(internal.run_location_evidence_purge() ->> 'purged', '1', 'after release, held evidence follows the policy');
select is((pg_temp.query_as((select alice from ids), 'aal2', format('select state from public.list_attendance_location_evidence(%L)', (select a1 from oe))) -> 0 ->> 'state'),
  'purged', 'the viewer shows purged evidence as purged');
select throws_ok($$ update public.attendance_location_evidence set latitude = 1, longitude = 1 where purged_at is not null $$,
  'CH409', null, 'purged evidence cannot be restored or edited');
select throws_ok($$ update public.attendance_location_evidence set accuracy_meters = 1 $$,
  'CH409', null, 'retained evidence stays append-only apart from the purge');
select throws_ok($$ delete from public.attendance_evidence_legal_holds $$, 'CH409', null, 'legal holds are never deleted');

select * from finish();
rollback;
