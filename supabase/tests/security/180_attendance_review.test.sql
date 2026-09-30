-- =============================================================================
-- Attendance: missed clocks, corrections, review and projections (P0-E6-S1)
-- U idempotent scan · P requests never overwrite history · Q no self-approval
-- R cross-agency review refused · S approval appends history · I cross-agency
-- J/K facility projection narrow, no coordinates · L raw location restricted
-- settings · V platform admin · X anon
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql
\ir _attendance_helpers.psql

select plan(52);

-- Missed clock-in: accepted, started 40 minutes ago, never clocked.
-- Missed clock-out: clocked in 10 h ago, shift ended 2 h ago.
create temp table p as
select pg_temp.past_accepted((select mercy from f), (select mercy_main from loc), now() - interval '40 minutes',
  now() + interval '7 hours', (select wendy from w), (select wendy from ids), (select sam from ids), (select alpha from orgs)) as missed_in,
       pg_temp.past_accepted((select riverside from f), (select riverside_main from loc), now() - interval '10 hours',
  now() - interval '2 hours', (select walt from w), (select walt from ids), (select sam from ids), (select alpha from orgs)) as missed_out;
grant select on p to authenticated;
select pg_temp.past_clock_in((select missed_out from p), now() - interval '10 hours');

-- ---------------------------------------------------------------------------
-- Missed-clock scan
-- ---------------------------------------------------------------------------
select is(internal.run_attendance_scan(), '{"resolved": 0, "missed_clock_in": 1, "missed_clock_out": 1}'::jsonb,
  'the scan finds one missed clock-in and one missed clock-out');
select is(pg_temp.open_exceptions((select missed_in from p)), 'missed_clock_in', 'missed_clock_in is open');
select is((pg_temp.attendance_of((select missed_in from p))).clock_state::text, 'not_started',
  'no timestamp is manufactured for a missed clock-in');
select is(internal.run_attendance_scan(), '{"resolved": 0, "missed_clock_in": 0, "missed_clock_out": 0}'::jsonb,
  'U. a repeated scan changes nothing (idempotent)');
select is((select count(*)::int from public.attendance_exceptions where exception_type in ('missed_clock_in', 'missed_clock_out')),
  2, 'U. each exception exists once');
select is((select count(*)::int from internal.notification_outbox where event = 'attendance_missed_clock_in'),
  1, 'missed clock-in notifies agency reviewers once');
select is((select array_agg(recipient_profile_id order by recipient_profile_id) from internal.notification_outbox
            where event = 'attendance_missed_clock_out'),
  (select array_agg(x order by x) from unnest(array[(select alice from ids), (select walt from ids)]) x),
  'missed clock-out notifies reviewers and the worker');

-- ---------------------------------------------------------------------------
-- Corrections: request → review → corrected event appended
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select wendy from ids), format(
  'select public.request_attendance_correction(%L, ''clock_in'', now() + interval ''1 hour'', ''forgot_to_clock'')', (select missed_in from p))),
  'CHT16', null, 'a correction cannot claim a future time');
select throws_ok(pg_temp.as_sql((select wendy from ids), format(
  'select public.request_attendance_correction(%L, ''clock_out'', now() - interval ''5 minutes'', ''forgot_to_clock'')', (select missed_in from p))),
  'CHT16', null, 'a clock-out correction needs a clock-in first');
select throws_ok(pg_temp.as_sql((select walt from ids), format(
  'select public.request_attendance_correction(%L, ''clock_in'', now() - interval ''30 minutes'', ''forgot_to_clock'')', (select missed_in from p))),
  'CHA04', null, 'a worker cannot request corrections for another worker''s attendance');

create temp table c as
select pg_temp.scalar_as((select wendy from ids), 'aal1', format(
  'select public.request_attendance_correction(%L, ''clock_in'', now() - interval ''37 minutes'', ''forgot_to_clock'', ''Badge reader was down'')',
  (select missed_in from p)))::uuid as clock_in;
grant select on c to authenticated;
select is((select count(*)::int from public.attendance_events where assignment_id = (select missed_in from p)), 0,
  'P. a correction request writes no attendance event');
select is(pg_temp.open_exceptions((select missed_in from p)), 'manual_correction_requested,missed_clock_in',
  'the request is an open exception for review');
select throws_ok(pg_temp.as_sql((select wendy from ids), format(
  'select public.request_attendance_correction(%L, ''clock_in'', now() - interval ''36 minutes'', ''other'')', (select missed_in from p))),
  'CHT16', null, 'only one pending request per clock event');
select is((select count(*)::int from public.audit_events where metadata::text like '%Badge reader%'), 0,
  'the worker note never enters audit metadata');

select throws_ok(pg_temp.as_sql((select wendy from ids), format(
  'select public.review_attendance_correction(%L, true, ''approved_as_requested'')', (select clock_in from c))),
  'CHT04', null, 'Q. a worker cannot approve their own correction');
select throws_ok(pg_temp.as_sql((select sam from ids), format(
  'select public.review_attendance_correction(%L, true, ''approved_as_requested'')', (select clock_in from c))),
  'CH403', null, 'a scheduler (attendance.view only) cannot review');
select throws_ok(pg_temp.as_sql((select bob from ids), format(
  'select public.review_attendance_correction(%L, true, ''approved_as_requested'')', (select clock_in from c)), 'aal2'),
  'CHT04', null, 'R. a reviewer from another agency cannot review');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.review_attendance_correction(%L, true, ''rejected_other'')', (select clock_in from c))),
  'CH400', null, 'the resolution must match the decision');

select lives_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.review_attendance_correction(%L, true, ''approved_as_requested'')', (select clock_in from c))),
  'an agency reviewer approves the correction');
select is((select event_type::text || '/' || source::text || '/' || (occurred_at = now() - interval '37 minutes')::text
           from public.attendance_events where assignment_id = (select missed_in from p)),
  'corrected_clock_in/approved_correction/true', 'S. approval appends a corrected event at the requested time');
select is((select clock_state::text || '/' || (clock_in_at = now() - interval '37 minutes')::text
           from public.assignment_attendance where assignment_id = (select missed_in from p)),
  'clocked_in/true', 'S. the summary resolves from the corrected chronology');
select is(pg_temp.open_exceptions((select missed_in from p)), '', 'approval resolves missed_clock_in and the request');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.review_attendance_correction(%L, false, ''rejected_other'')', (select clock_in from c))),
  'CHT17', null, 'a reviewed correction cannot be reviewed again');
select is((select count(*)::int from internal.notification_outbox where event = 'attendance_correction_approved'
             and recipient_profile_id = (select wendy from ids)),
  1, 'the worker is told the outcome');

-- Missed clock-out: request → reject, then request again → approve
create temp table c2 as
select pg_temp.scalar_as((select walt from ids), 'aal1', format(
  'select public.request_attendance_correction(%L, ''clock_out'', now() - interval ''2 hours'', ''forgot_to_clock'')',
  (select missed_out from p)))::uuid as first;
select lives_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.review_attendance_correction(%L, false, ''rejected_time_not_supported'')', (select first from c2))),
  'a reviewer rejects a correction');
select is((pg_temp.attendance_of((select missed_out from p))).clock_state::text, 'clocked_in',
  'a rejection changes no attendance history');
select is(pg_temp.open_exceptions((select missed_out from p)), 'missed_clock_out', 'the missed clock-out stays open');
create temp table c3 as
select pg_temp.scalar_as((select walt from ids), 'aal1', format(
  'select public.request_attendance_correction(%L, ''clock_out'', now() - interval ''118 minutes'', ''forgot_to_clock'')',
  (select missed_out from p)))::uuid as second;
select pg_temp.exec_as((select alice from ids), 'aal1', format(
  'select public.review_attendance_correction(%L, true, ''approved_as_requested'')', (select second from c3)));
select is((select clock_state::text from public.assignment_attendance where assignment_id = (select missed_out from p)),
  'clocked_out', 'an approved clock-out correction completes the record');
select is((select count(*)::int from public.attendance_events where assignment_id = (select missed_out from p)),
  2, 'the original clock-in event remains; one corrected event was appended');
select is(internal.run_attendance_scan() ->> 'missed_clock_out', '0', 'the scan does not re-open a corrected record');

-- Exception review
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.review_attendance_exception(%L, ''dismissed'', ''not_applicable'')',
  (select id from public.attendance_exceptions where exception_type = 'manual_correction_requested' and status = 'resolved' limit 1))),
  'CH409', null, 'a closed exception cannot be reviewed again');
select throws_ok(format($$ update public.attendance_exceptions set status = 'open' where id = %L $$,
  (select id from public.attendance_exceptions where status = 'resolved' limit 1)),
  'CH409', null, 'closed exceptions are immutable (owner role)');

-- ---------------------------------------------------------------------------
-- Projections and restricted location
-- ---------------------------------------------------------------------------
select is((select array_agg(key order by key) from jsonb_object_keys(pg_temp.query_as((select fiona from ids), 'aal1',
            format('select * from public.list_facility_shift_attendance(%L)',
                   (select shift_id from public.shift_assignments where id = (select missed_in from p)))) -> 0) key),
  array['assignment_id', 'clock_in_at', 'clock_in_location', 'clock_out_at', 'clock_out_location', 'clock_state',
        'has_open_exception', 'worker_display_name'],
  'J/K. the facility projection has only narrow fields (location as a result code, no coordinates)');
select is((select count(*)::int from public.audit_events where action = 'attendance.viewed_by_facility'), 1,
  'facility reads are audited');
select throws_ok(pg_temp.as_sql((select dora from ids), format('select * from public.list_facility_shift_attendance(%L)',
  (select shift_id from public.shift_assignments where id = (select missed_in from p)))),
  'CHS04', null, 'J. another facility cannot read it');
select is(pg_temp.count_as((select fiona from ids), 'aal1', 'select * from public.assignment_attendance'), 0,
  'J. facilities cannot read attendance tables');
select is(pg_temp.count_as((select fiona from ids), 'aal1', 'select * from public.attendance_corrections'), 0,
  'facilities cannot read correction requests');

-- L. Raw location: add evidence via an inside clock-in at a geofenced location
select pg_temp.exec_as((select alice from ids), 'aal2', format(
  'select public.set_location_geofence(%L, true, %s, %s, 200, 100, ''allow_with_review'')',
  (select mercy_east from loc), pg_temp.site_lat(), pg_temp.site_lon()));
select is((select count(*)::int from public.location_geofences where enabled), 1, 'a geofence is configured per location');
select is(pg_temp.count_as((select sam from ids), 'aal1', 'select * from public.attendance_location_evidence'), 0,
  'L. a scheduler cannot read raw location evidence');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select * from public.list_attendance_location_evidence(%L)',
  (pg_temp.attendance_of((select missed_out from p))).id)),
  'CH403', null, 'L. … nor through the evidence RPC');
select throws_ok(pg_temp.as_sql((select alice from ids), format('select * from public.list_attendance_location_evidence(%L)',
  (pg_temp.attendance_of((select missed_out from p))).id)),
  'CH402', null, 'L. raw location needs a verified (AAL2) session');
select lives_ok(pg_temp.as_sql((select alice from ids), format('select * from public.list_attendance_location_evidence(%L)',
  (pg_temp.attendance_of((select missed_out from p))).id), 'aal2'),
  'an admin at AAL2 can read raw location evidence');
select is((select count(*)::int from public.audit_events where action = 'attendance.location_viewed'), 1,
  'raw location reads are audited');

-- Worker and agency projections
select is(pg_temp.count_as((select wendy from ids), 'aal1', format('select * from public.list_my_attendance(%L)', (select alpha from orgs))),
  1, 'the worker lists only their own attendance');
select is(pg_temp.query_as((select wendy from ids), 'aal1', format('select corrections -> 0 ->> ''status'' as s from public.list_my_attendance(%L)', (select alpha from orgs))) -> 0 ->> 's',
  'approved', 'the worker sees their correction outcome');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select * from public.list_agency_attendance(%L)', (select alpha from orgs)), 'aal2'),
  'CH403', null, 'I. another agency cannot list Alpha''s attendance');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select * from public.list_agency_attendance(%L, current_date, current_date + 30)', (select alpha from orgs))),
  'CH400', null, 'agency attendance is date-bounded (≤ 7 days)');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.assignment_attendance'), 0,
  'V. a platform admin reads no attendance');

-- Settings
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.set_agency_attendance_settings(%L, 30, 5, 15, 30, 15, 60, 240)', (select alpha from orgs))),
  'CH403', null, 'a scheduler cannot change attendance rules');
select throws_ok(pg_temp.as_sql((select alice from ids), format('select public.set_agency_attendance_settings(%L, 30, 5, 15, 30, 15, 60, 240)', (select alpha from orgs))),
  'CH402', null, 'changing attendance rules needs AAL2');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.set_location_geofence(%L, true, 40.7, -74.0, 5000, 100, ''block'')', (select mercy_main from loc)), 'aal2'),
  '23514', null, 'geofence radius is bounded (50–2000 m)');
select throws_ok(pg_temp.as_sql(null, format('select * from public.list_my_attendance(%L)', (select alpha from orgs))),
  '42501', null, 'X. anon cannot call attendance RPCs');

select * from finish();
rollback;
