-- =============================================================================
-- Attendance: clocking, eligibility, timing and geofence (P0-E6-S1)
-- A own records only · B no clocking another's assignment · C accepted only
-- D cancelled shift · E too early · F duplicate clock-in · G clock-out without
-- clock-in · H duplicate clock-out · M server time only · N server-computed
-- geofence · O outside policy enforced · late/early · boundary/accuracy/missing
-- location · no location stored when not required · T append-only · Y direct writes
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql
\ir _attendance_helpers.psql

select plan(57);

-- Ready CNA workers at Alpha (eligible at Riverside: baseline BLS only).
create function pg_temp.ready_worker(p_email text)
returns uuid language plpgsql as $$
declare
  v_user uuid := pg_temp.create_user(p_email);
  v_worker uuid;
  v_ev jsonb;
begin
  perform pg_temp.add_member((select alpha from orgs), v_user, 'agency.healthcare_worker');
  v_worker := pg_temp.worker_of((select alpha from orgs), v_user);
  update public.agency_workers set status = 'active' where id = v_worker;
  perform pg_temp.exec_as((select alice from ids), 'aal2', format('select public.set_agency_worker_discipline(%L, ''cna'', true)', v_worker));
  v_ev := pg_temp.evidence(v_user, 'bls_certification', null, null, current_date - 30, current_date + 400);
  perform pg_temp.share_credential(v_user, (v_ev ->> 'credential_id')::uuid, (select alpha from orgs));
  perform pg_temp.verify((select alice from ids), (v_ev ->> 'credential_version_id')::uuid, (select alpha from orgs));
  return v_worker;
end;
$$;

create temp table g as
select pg_temp.ready_worker('g1@example.test') as g1, pg_temp.ready_worker('g2@example.test') as g2,
       pg_temp.ready_worker('g3@example.test') as g3, pg_temp.ready_worker('g4@example.test') as g4,
       pg_temp.ready_worker('g5@example.test') as g5;
grant select on g to authenticated;
create function pg_temp.user_of(p_worker uuid) returns uuid language sql as $$
  select profile_id from public.agency_workers where id = p_worker
$$;

create temp table s as
select
  pg_temp.shift_between((select sam from ids), (select mercy from f), (select mercy_main from loc), now() + interval '10 minutes', now() + interval '2 hours') as w1,
  pg_temp.shift_between((select sam from ids), (select mercy from f), (select mercy_main from loc), now() + interval '3 hours', now() + interval '4 hours') as w2,
  pg_temp.shift_between((select sam from ids), (select mercy from f), (select mercy_main from loc), now() + interval '5 hours', now() + interval '6 hours') as w3,
  pg_temp.shift_between((select sam from ids), (select riverside from f), (select riverside_main from loc), now() - interval '20 minutes', now() + interval '2 hours') as late,
  pg_temp.shift_between((select sam from ids), (select riverside from f), (select riverside_main from loc), now() + interval '150 minutes', now() + interval '170 minutes') as unaccepted,
  pg_temp.shift_between((select sam from ids), (select riverside from f), (select riverside_main from loc), now() + interval '3 hours', now() + interval '4 hours') as to_cancel,
  pg_temp.shift_between((select sam from ids), (select riverside from f), (select riverside_main from loc), now() + interval '10 minutes', now() + interval '2 hours', 6) as geo;
grant select on s to authenticated;

create temp table a as
select pg_temp.accepted((select sam from ids), (select w1 from s), (select wendy from w), (select wendy from ids)) as w1,
       pg_temp.accepted((select sam from ids), (select w2 from s), (select wendy from w), (select wendy from ids)) as w2,
       pg_temp.accepted((select sam from ids), (select w3 from s), (select wendy from w), (select wendy from ids)) as w3,
       pg_temp.accepted((select sam from ids), (select late from s), (select walt from w), (select walt from ids)) as late,
       (pg_temp.assign((select sam from ids), (select unaccepted from s), (select walt from w)) ->> 'assignment_id')::uuid as unaccepted,
       pg_temp.accepted((select sam from ids), (select to_cancel from s), (select walt from w), (select walt from ids)) as to_cancel;
grant select on a to authenticated;
create temp table ga as
select pg_temp.accepted((select sam from ids), (select geo from s), (select g1 from g), pg_temp.user_of((select g1 from g))) as g1,
       pg_temp.accepted((select sam from ids), (select geo from s), (select g2 from g), pg_temp.user_of((select g2 from g))) as g2,
       pg_temp.accepted((select sam from ids), (select geo from s), (select g3 from g), pg_temp.user_of((select g3 from g))) as g3,
       pg_temp.accepted((select sam from ids), (select geo from s), (select g4 from g), pg_temp.user_of((select g4 from g))) as g4,
       pg_temp.accepted((select sam from ids), (select geo from s), (select g5 from g), pg_temp.user_of((select g5 from g))) as g5;
grant select on ga to authenticated;

-- ---------------------------------------------------------------------------
-- Clock-in / clock-out lifecycle (no geofence at Mercy Main)
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select walt from ids), format('select * from public.clock_in_assignment(%L)', (select w1 from a))),
  'CHA04', null, 'B. a worker cannot clock in to another worker''s assignment');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select * from public.clock_in_assignment(%L)', (select w1 from a))),
  'CHA04', null, 'B. a scheduler cannot clock a worker in');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.clock_out_assignment(%L)', (select w3 from a))),
  'CHT10', null, 'G. clock-out without clock-in is refused');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.clock_in_assignment(%L)', (select w2 from a))),
  'CHT07', null, 'E. clocking in more than 30 minutes before the start is refused');

create temp table c1 as select pg_temp.clock_in((select wendy from ids), (select w1 from a), 40.0, -73.0, 5) as r;
select is((select r ->> 'outcome' || '/' || (r ->> 'geofence_result') from c1), 'recorded/not_required',
  'clock-in inside the window is recorded (no geofence here)');
select is((select occurred_at = now() and recorded_at = now() from public.attendance_events
           where attendance_id = (pg_temp.attendance_of((select w1 from a))).id and event_type = 'clock_in'),
  true, 'M. the event time is server time, not the device''s claimed time (2000-01-01 was sent)');
select is((select count(*)::int from public.attendance_location_evidence), 0,
  'no coordinates are stored when the location does not require a geofence');
select is((pg_temp.attendance_of((select w1 from a))).clock_state::text, 'clocked_in', 'the summary projection shows clocked in');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.clock_in_assignment(%L)', (select w1 from a))),
  'CHT09', null, 'F. a duplicate clock-in is refused');
select is(pg_temp.count_as((select walt from ids), 'aal1', format('select * from public.assignment_attendance where assignment_id = %L', (select w1 from a))),
  0, 'A. another worker cannot see this attendance');
select is(pg_temp.count_as((select walt from ids), 'aal1', format('select * from public.attendance_events where assignment_id = %L', (select w1 from a))),
  0, 'A. … or its events');
select is(pg_temp.count_as((select wendy from ids), 'aal1', format('select * from public.attendance_events where assignment_id = %L', (select w1 from a))),
  1, 'the worker sees their own events');

create temp table o1 as select pg_temp.clock_out((select wendy from ids), (select w1 from a)) as r;
select is((select (r ->> 'outcome') || '/' || (r -> 'exception_codes' ->> 0) from o1), 'recorded/early_clock_out',
  'clock-out is recorded; leaving well before the end opens early_clock_out');
select is((pg_temp.attendance_of((select w1 from a))).clock_state::text, 'clocked_out', 'the projection shows clocked out');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.clock_out_assignment(%L)', (select w1 from a))),
  'CHT11', null, 'H. a duplicate clock-out is refused');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.clock_in_assignment(%L)', (select w1 from a))),
  'CHT11', null, 'no second clock-in after clocking out (one segment in this stage)');

-- ---------------------------------------------------------------------------
-- C / D. Accepted assignments on open shifts only
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select walt from ids), format('select * from public.clock_in_assignment(%L)', (select unaccepted from a))),
  'CHT05', null, 'C. an assignment that is not accepted cannot be clocked');
select pg_temp.exec_as((select sam from ids), 'aal1', format('select public.cancel_shift(%L, ''other'')', (select to_cancel from s)));
select throws_ok(pg_temp.as_sql((select walt from ids), format('select * from public.clock_in_assignment(%L)', (select to_cancel from a))),
  'CHT06', null, 'D. a cancelled shift refuses clock-in');

-- ---------------------------------------------------------------------------
-- Late clock-in (server time vs shift start instant)
-- ---------------------------------------------------------------------------
create temp table cl as select pg_temp.clock_in((select walt from ids), (select late from a)) as r;
select is((select r -> 'exception_codes' from cl), '["late_clock_in"]'::jsonb,
  'clocking in 20 minutes after the start (threshold 5) opens late_clock_in');
select is((select count(*)::int from internal.notification_outbox where event = 'attendance_clock_in_late'
             and subject_id = (select late from a)),
  1, 'late clock-in notifies agency reviewers (attendance.review holders only)');
select is((select array_agg(recipient_profile_id) from internal.notification_outbox where event = 'attendance_clock_in_late'),
  array[(select alice from ids)], 'the scheduler (no attendance.review) is not emailed');

-- ---------------------------------------------------------------------------
-- Geofence: server-computed; optional; policy enforced (Riverside Main)
-- ---------------------------------------------------------------------------
select pg_temp.exec_as((select alice from ids), 'aal2', format(
  'select public.set_location_geofence(%L, true, %s, %s, 200, 100, ''allow_with_review'')',
  (select riverside_main from loc), pg_temp.site_lat(), pg_temp.site_lon()));

select is((internal.check_geofence((select riverside_main from loc), pg_temp.site_lat() + pg_temp.lat_offset(199.5), pg_temp.site_lon(), 10)).result::text,
  'inside', 'boundary: 199.5 m from the site is inside a 200 m geofence');
select is((internal.check_geofence((select riverside_main from loc), pg_temp.site_lat() + pg_temp.lat_offset(200.5), pg_temp.site_lon(), 10)).result::text,
  'outside', 'boundary: 200.5 m is outside');
select ok(abs(internal.distance_meters(pg_temp.site_lat(), pg_temp.site_lon(), pg_temp.site_lat() + pg_temp.lat_offset(1000), pg_temp.site_lon()) - 1000) < 0.01,
  'haversine distance is exact along a meridian (1000 m)');
select is((internal.check_geofence((select riverside_main from loc), pg_temp.site_lat(), pg_temp.site_lon(), 150)).result::text,
  'low_accuracy', 'accuracy worse than the configured 100 m is low_accuracy even at the site');
select is((internal.check_geofence((select mercy_main from loc), pg_temp.site_lat(), pg_temp.site_lon(), 10)).result::text,
  'not_required', 'geofences are location-scoped: another location is unaffected');
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select g1 from g)), format('select * from public.clock_in_assignment(%L, 91, 0, 5)', (select g1 from ga))),
  'CH400', null, 'invalid coordinates are rejected');
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select g1 from g)), format('select * from public.clock_in_assignment(%L, 40, -74, 1e9)', (select g1 from ga))),
  'CH400', null, 'an absurd accuracy value is rejected as invalid input, not a constraint error');

-- g1: inside
create temp table gi as select pg_temp.clock_in(pg_temp.user_of((select g1 from g)), (select g1 from ga),
  pg_temp.site_lat() + pg_temp.lat_offset(50), pg_temp.site_lon(), 12) as r;
select is((select r ->> 'geofence_result' from gi), 'inside', 'N. the server computes inside from coordinates');
select is((select result::text || '/' || round(distance_meters)::text || '/' || radius_meters from public.attendance_location_evidence
           where attendance_id = (pg_temp.attendance_of((select g1 from ga))).id),
  'inside/50/200', 'evidence stores the server-computed distance and the radius used');
select is((select count(*)::int from public.audit_events where metadata::text ~ '40\.71'), 0,
  'coordinates never appear in audit metadata');

-- g2: outside, allow_with_review → recorded + exception
create temp table go as select pg_temp.clock_in(pg_temp.user_of((select g2 from g)), (select g2 from ga),
  pg_temp.site_lat() + pg_temp.lat_offset(900), pg_temp.site_lon(), 12) as r;
select is((select (r ->> 'outcome') || '/' || (r ->> 'geofence_result') || '/' || (r -> 'exception_codes' ->> 0) from go),
  'recorded/outside/outside_geofence', 'O. outside with allow_with_review: recorded and flagged for review');

-- P0-E9-3E: UNKNOWN ≠ INSIDE under every policy — no location is refused even with allow_with_review.
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select g5 from g)), format('select * from public.clock_in_assignment(%L)', (select g5 from ga))),
  'CHT12', null, 'no location with allow_with_review: refused (fail closed), nothing recorded');

-- block policy
select pg_temp.exec_as((select alice from ids), 'aal2', format(
  'select public.set_location_geofence(%L, true, %s, %s, 200, 100, ''block'')',
  (select riverside_main from loc), pg_temp.site_lat(), pg_temp.site_lon()));
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select g3 from g)), format('select * from public.clock_in_assignment(%L)', (select g3 from ga))),
  'CHT12', null, 'O. block policy: a location is required');
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select g3 from g)), format('select * from public.clock_in_assignment(%L, %s, %s, 400, now())', (select g3 from ga), pg_temp.site_lat(), pg_temp.site_lon())),
  'CHT14', null, 'O. block policy: poor accuracy is refused (retry with a better fix)');
create temp table gb as select pg_temp.clock_in(pg_temp.user_of((select g3 from g)), (select g3 from ga),
  pg_temp.site_lat() + pg_temp.lat_offset(900), pg_temp.site_lon(), 12) as r;
select is((select (r ->> 'outcome') || '/' || (r ->> 'refusal_code') from gb), 'refused/OUTSIDE_GEOFENCE',
  'O. block policy: outside is refused server-side');
select is((select count(*)::int from public.attendance_events where assignment_id = (select g3 from ga)), 0,
  'O. … no clock-in event exists');
select is(pg_temp.open_exceptions((select g3 from ga)), 'outside_geofence', 'O. … but the refused attempt is an exception');
select is((select count(*)::int from internal.notification_outbox where event = 'attendance_clock_in_blocked' and subject_id = (select g3 from ga)),
  1, 'O. … and reviewers are notified');
create temp table gb2 as select pg_temp.clock_in(pg_temp.user_of((select g3 from g)), (select g3 from ga),
  pg_temp.site_lat(), pg_temp.site_lon(), 12) as r;
select is((select r ->> 'outcome' from gb2), 'recorded', 'inside the geofence the same worker can then clock in');
create temp table gbo as select pg_temp.clock_out(pg_temp.user_of((select g3 from g)), (select g3 from ga),
  pg_temp.site_lat() + pg_temp.lat_offset(5000), pg_temp.site_lon(), 12) as r;
select is((select (r ->> 'outcome') || '/' || (r ->> 'geofence_result') from gbo), 'recorded/outside',
  'clock-out is never blocked by location (flagged instead)');

-- Eligibility at clock-in (canonical gate)
select pg_temp.exec_as(pg_temp.user_of((select g4 from g)), 'aal1', format('select public.revoke_credential_share(%L)',
  (select sh.id from public.credential_shares sh join public.credentials cr on cr.id = sh.credential_id
    where cr.profile_id = pg_temp.user_of((select g4 from g)) and sh.status = 'active')));
create temp table ge as select pg_temp.clock_in(pg_temp.user_of((select g4 from g)), (select g4 from ga),
  pg_temp.site_lat(), pg_temp.site_lon(), 12) as r;
select is((select (r ->> 'outcome') || '/' || (r ->> 'refusal_code') from ge), 'refused/WORKER_NOT_ELIGIBLE',
  'a worker who is no longer eligible cannot start work');
select is(pg_temp.open_exceptions((select g4 from ga)), 'assignment_not_ready', '… the attempt becomes an urgent exception');

-- ---------------------------------------------------------------------------
-- Late clock-out / missed clock-out window (past shifts, owner-arranged)
-- ---------------------------------------------------------------------------
create temp table p as
select pg_temp.past_accepted((select riverside from f), (select riverside_main from loc), now() - interval '9 hours',
  now() - interval '1 hour', (select nora from w), (select nora from ids), (select sam from ids), (select alpha from orgs)) as late_out,
       pg_temp.past_accepted((select riverside from f), (select riverside_main from loc), now() - interval '14 hours',
  now() - interval '6 hours', (select g1 from g), pg_temp.user_of((select g1 from g)), (select sam from ids), (select alpha from orgs)) as closed;
update public.location_geofences set enabled = false;
select pg_temp.past_clock_in((select late_out from p), now() - interval '9 hours');
select pg_temp.past_clock_in((select closed from p), now() - interval '14 hours');
select is((select pg_temp.clock_out((select nora from ids), (select late_out from p)) -> 'exception_codes'),
  '["late_clock_out"]'::jsonb, 'clocking out an hour after the end (threshold 30 min) opens late_clock_out');
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select g1 from g)), format('select * from public.clock_out_assignment(%L)', (select closed from p))),
  'CHT18', null, 'after the 4-hour cutoff, clock-out needs a correction');

-- Overnight shift (22:00 → 06:00 local): the window is computed on instants, across midnight.
create temp table ovn as
select pg_temp.scalar_as((select sam from ids), 'aal1', format(
  'select public.create_shift(%L, %L, ''cna'', %L::date, ''22:00'', ''06:00'', 2, null, null, true)',
  (select riverside from f), (select riverside_main from loc),
  ((now() + interval '1 day') at time zone (select timezone from public.facility_locations where id = (select riverside_main from loc)))::date))::uuid as shift_id;
select pg_temp.accepted((select sam from ids), (select shift_id from ovn), (select g5 from g), pg_temp.user_of((select g5 from g)));
create temp table ovr as
select r from jsonb_array_elements(pg_temp.query_as(pg_temp.user_of((select g5 from g)), 'aal1', format(
  'select shift_id, start_at, end_at, timezone, earliest_clock_in_at, can_clock_in from public.list_my_attendance(%L)',
  (select alpha from orgs)))) r where (r ->> 'shift_id')::uuid = (select shift_id from ovn);
select is((select to_char(((r ->> 'earliest_clock_in_at')::timestamptz) at time zone (r ->> 'timezone'), 'HH24:MI') from ovr),
  '21:30', 'overnight: earliest clock-in is 30 minutes before the 22:00 local start');
select is((select (((r ->> 'end_at')::timestamptz at time zone (r ->> 'timezone'))::date
                  - ((r ->> 'start_at')::timestamptz at time zone (r ->> 'timezone'))::date) from ovr),
  1, 'overnight: the shift ends on the next local date, 8 hours later');
select is((select (r ->> 'can_clock_in')::boolean from ovr), false, 'overnight: a future overnight shift cannot be clocked yet');

-- ---------------------------------------------------------------------------
-- T / Y. History is immutable; no direct writes
-- ---------------------------------------------------------------------------
select throws_ok($$ update public.attendance_events set occurred_at = now() - interval '1 day' $$,
  'CH409', null, 'T. attendance events cannot be updated (owner role)');
select throws_ok($$ delete from public.attendance_events $$, 'CH409', null, 'T. attendance events cannot be deleted');
select throws_ok($$ delete from public.attendance_location_evidence $$, 'CH409', null, 'T. location evidence cannot be deleted');
select throws_ok($$ truncate public.attendance_events cascade $$, 'CH409', null, 'T. attendance events cannot be truncated, even by the owner');
select throws_ok($$ truncate public.attendance_location_evidence $$, 'CH409', null, 'T. location evidence cannot be truncated');
select throws_ok(format($$ insert into public.attendance_events (attendance_id, assignment_id, agency_organisation_id, event_type, occurred_at, recorded_at, source)
  values (%L, %L, %L, 'clock_in', now() - interval '1 hour', now(), 'worker_device') $$,
  (pg_temp.attendance_of((select w1 from a))).id, (select w1 from a), (select alpha from orgs)),
  '23514', null, 'M. a device clock event cannot carry a time other than its record time (owner role)');
select throws_ok(pg_temp.as_sql((select wendy from ids), format(
  'insert into public.attendance_events (attendance_id, assignment_id, agency_organisation_id, event_type, occurred_at, source) values (%L, %L, %L, ''clock_in'', now(), ''worker_device'')',
  (pg_temp.attendance_of((select w1 from a))).id, (select w1 from a), (select alpha from orgs))),
  '42501', null, 'Y. events cannot be written directly');
select throws_ok(pg_temp.as_sql((select alice from ids), 'update public.assignment_attendance set clock_state = ''not_started''', 'aal2'),
  '42501', null, 'Y. the attendance summary cannot be written directly');
select throws_ok(format($$ update public.assignment_attendance set assignment_id = %L where assignment_id = %L $$,
  (select w2 from a), (select w1 from a)),
  'CH409', null, 'the attendance owner (assignment) is immutable');

select * from finish();
rollback;
