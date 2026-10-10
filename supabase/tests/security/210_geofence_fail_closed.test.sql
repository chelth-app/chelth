-- =============================================================================
-- Geofence fail-closed (P0-E9-3E production remediation)
-- D distance in metres · R classification (boundary, accuracy vs radius)
-- A inside → recorded · C outside → refused · U unknown (missing / stale /
-- imprecise / invalid) → refused under EVERY policy, nothing recorded
-- J duplicate · K/L clock-out never blocked · M cross-tenant · N not required
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql
\ir _attendance_helpers.psql

select plan(36);

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
create function pg_temp.user_of(p_worker uuid) returns uuid language sql as $$
  select profile_id from public.agency_workers where id = p_worker
$$;
create function pg_temp.at_riverside(p_worker uuid) returns uuid language sql as $$
  select pg_temp.accepted((select sam from ids),
    pg_temp.shift_between((select sam from ids), (select riverside from f), (select riverside_main from loc),
      now() + interval '10 minutes', now() + interval '2 hours'),
    p_worker, pg_temp.user_of(p_worker))
$$;
-- A clock-in call with an explicit capture instant (the app always sends one).
create function pg_temp.clock_in_sql(p_assignment uuid, p_lat text, p_lon text, p_acc text, p_captured text default 'now()')
returns text language sql as $$
  select format('select * from public.clock_in_assignment(%L, %s, %s, %s, %s)', p_assignment, p_lat, p_lon, p_acc, p_captured)
$$;
create function pg_temp.lat(p_meters double precision) returns text language sql as $$
  select (pg_temp.site_lat() + pg_temp.lat_offset(p_meters))::text
$$;

create temp table loc2 as
select pg_temp.scalar_as((select alice from ids), 'aal2', format(
         'select public.create_facility_location(%L, ''Riverside East'', ''America/Chicago'')', (select riverside from f)))::uuid as east,
       pg_temp.scalar_as((select alice from ids), 'aal2', format(
         'select public.create_facility_location(%L, ''Riverside Annex'', ''America/Chicago'')', (select riverside from f)))::uuid as annex;
grant select on loc2 to authenticated;

create temp table r as
select pg_temp.ready_worker('r1@example.test') as r1, pg_temp.ready_worker('r2@example.test') as r2,
       pg_temp.ready_worker('r3@example.test') as r3, pg_temp.ready_worker('r4@example.test') as r4,
       pg_temp.ready_worker('r5@example.test') as r5, pg_temp.ready_worker('r6@example.test') as r6,
       pg_temp.ready_worker('r7@example.test') as r7, pg_temp.ready_worker('r8@example.test') as r8;
grant select on r to authenticated;
create temp table ra as
select pg_temp.at_riverside((select r1 from r)) as r1, pg_temp.at_riverside((select r2 from r)) as r2,
       pg_temp.at_riverside((select r3 from r)) as r3, pg_temp.at_riverside((select r4 from r)) as r4,
       pg_temp.at_riverside((select r5 from r)) as r5, pg_temp.at_riverside((select r6 from r)) as r6;
grant select on ra to authenticated;

-- ---------------------------------------------------------------------------
-- D. Distance (haversine, metres, latitude then longitude)
-- ---------------------------------------------------------------------------
select is(internal.distance_meters(pg_temp.site_lat(), pg_temp.site_lon(), pg_temp.site_lat(), pg_temp.site_lon()),
  0::double precision, 'D. same point: 0 m');
select ok(abs(internal.distance_meters(pg_temp.site_lat(), pg_temp.site_lon(), pg_temp.lat(25)::double precision, pg_temp.site_lon()) - 25) < 0.01, 'D. 25 m');
select ok(abs(internal.distance_meters(pg_temp.site_lat(), pg_temp.site_lon(), pg_temp.lat(100)::double precision, pg_temp.site_lon()) - 100) < 0.01, 'D. 100 m');
select ok(abs(internal.distance_meters(pg_temp.site_lat(), pg_temp.site_lon(), pg_temp.lat(149)::double precision, pg_temp.site_lon()) - 149) < 0.01, 'D. 149 m');
select ok(abs(internal.distance_meters(pg_temp.site_lat(), pg_temp.site_lon(), pg_temp.lat(500)::double precision, pg_temp.site_lon()) - 500) < 0.01, 'D. 500 m');
select ok(abs(internal.distance_meters(pg_temp.site_lat(), pg_temp.site_lon(), pg_temp.lat(7500)::double precision, pg_temp.site_lon()) - 7500) < 0.05, 'D. 7.5 km');
-- Longitude contributes too (not swapped): ~1 km east at 40.7° N.
select ok(internal.distance_meters(pg_temp.site_lat(), pg_temp.site_lon(), pg_temp.site_lat(), pg_temp.site_lon() + 0.0118) between 990 and 1000,
  'D. longitude offset (east) is measured, latitude and longitude are not swapped');

-- ---------------------------------------------------------------------------
-- Configuration: blocking is now the default; site coordinates are required
-- ---------------------------------------------------------------------------
select is((select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'location_geofences' and column_name = 'outside_policy'),
  '''block''::geofence_outside_policy', 'new geofences block outside clock-ins by default');
select is((select string_agg(column_name, ',' order by column_name) from information_schema.columns
            where table_schema = 'public' and table_name = 'location_geofences'
              and column_name in ('latitude', 'longitude', 'radius_meters') and is_nullable = 'NO'),
  'latitude,longitude,radius_meters', 'E. an enabled geofence always has site coordinates and a radius (NOT NULL)');

-- Riverside Main: 150 m fence, 100 m max accuracy, blocking. Riverside East: 50 m fence, allow_with_review.
-- Riverside Annex: no geofence.
select pg_temp.exec_as((select alice from ids), 'aal2', format(
  'select public.set_location_geofence(%L, true, %s, %s, 150, 100, ''block'')',
  (select riverside_main from loc), pg_temp.site_lat(), pg_temp.site_lon()));
select pg_temp.exec_as((select alice from ids), 'aal2', format(
  'select public.set_location_geofence(%L, true, %s, %s, 50, 100, ''allow_with_review'')',
  (select east from loc2), pg_temp.site_lat(), pg_temp.site_lon()));

-- ---------------------------------------------------------------------------
-- R. Classification
-- ---------------------------------------------------------------------------
select is((internal.check_geofence((select riverside_main from loc), pg_temp.lat(149)::double precision, pg_temp.site_lon(), 10)).result::text,
  'inside', 'R. 149 m with 10 m accuracy is inside a 150 m fence');
select is((internal.check_geofence((select riverside_main from loc), pg_temp.lat(149.99)::double precision, pg_temp.site_lon(), 10)).result::text,
  'inside', 'B. at the boundary (149.99 m of a 150 m fence) is inside: the rule is distance ≤ radius');
select is((internal.check_geofence((select riverside_main from loc), pg_temp.lat(150.5)::double precision, pg_temp.site_lon(), 10)).result::text,
  'outside', 'R. just outside the boundary is outside');
select is((internal.check_geofence((select riverside_main from loc), pg_temp.site_lat(), pg_temp.site_lon(), 2000)).result::text,
  'low_accuracy', 'G. 2000 m accuracy at the very centre cannot place the worker inside');
select is((internal.check_geofence((select east from loc2), pg_temp.site_lat(), pg_temp.site_lon(), 60)).result::text,
  'low_accuracy', 'G. accuracy wider than the fence itself (60 m vs 50 m radius) is not trusted');
select throws_ok(format('select internal.check_geofence(%L, ''NaN'', -74, 10)', (select riverside_main from loc)),
  'CH400', null, 'F. NaN coordinates are invalid input');

-- ---------------------------------------------------------------------------
-- A / C. Inside recorded; outside refused
-- ---------------------------------------------------------------------------
create temp table ok1 as select pg_temp.query_as(pg_temp.user_of((select r1 from r)), 'aal1',
  pg_temp.clock_in_sql((select r1 from ra), pg_temp.lat(40), pg_temp.site_lon()::text, '15')) -> 0 as v;
select is((select (v ->> 'outcome') || '/' || (v ->> 'geofence_result') from ok1), 'recorded/inside',
  'A. inside with good accuracy: recorded');
select is((select count(*)::int from public.attendance_location_evidence
            where attendance_id = (pg_temp.attendance_of((select r1 from ra))).id and result = 'inside'), 1,
  'A. … with server-computed evidence');

create temp table out1 as select pg_temp.query_as(pg_temp.user_of((select r2 from r)), 'aal1',
  pg_temp.clock_in_sql((select r2 from ra), pg_temp.lat(900), pg_temp.site_lon()::text, '10')) -> 0 as v;
select is((select (v ->> 'outcome') || '/' || (v ->> 'refusal_code') from out1), 'refused/OUTSIDE_GEOFENCE',
  'C. outside: refused');
select is((select count(*)::int from public.attendance_events where assignment_id = (select r2 from ra)), 0,
  'C. … no clock-in event');

-- ---------------------------------------------------------------------------
-- U. Unknown ≠ inside: refused, nothing recorded
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select r3 from r)), format('select * from public.clock_in_assignment(%L)', (select r3 from ra))),
  'CHT12', null, 'D/H. no coordinates (permission denied or unavailable): refused');
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select r3 from r)),
  pg_temp.clock_in_sql((select r3 from ra), pg_temp.lat(10), pg_temp.site_lon()::text, '10', 'null')),
  'CHT13', null, 'U. coordinates without a capture time: refused');
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select r3 from r)),
  pg_temp.clock_in_sql((select r3 from ra), pg_temp.lat(10), pg_temp.site_lon()::text, '10', $$now() - interval '10 minutes'$$)),
  'CHT13', null, 'U. a stale (cached) reading: refused');
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select r3 from r)),
  pg_temp.clock_in_sql((select r3 from ra), pg_temp.lat(10), pg_temp.site_lon()::text, '10', $$now() + interval '10 minutes'$$)),
  'CHT13', null, 'U. a reading from the future: refused');
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select r3 from r)),
  pg_temp.clock_in_sql((select r3 from ra), pg_temp.site_lat()::text, pg_temp.site_lon()::text, '2000')),
  'CHT14', null, 'G. poor accuracy (2000 m) at the centre: refused');
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select r3 from r)),
  pg_temp.clock_in_sql((select r3 from ra), '91', '0', '5')),
  'CH400', null, 'F. invalid coordinates: refused');
select is((select count(*)::int from public.attendance_events where assignment_id = (select r3 from ra)), 0,
  'U. none of the unknown cases recorded a clock-in');

-- Under allow_with_review too: unknown is still refused (only a precise outside reading is reviewable).
create temp table me as select pg_temp.accepted((select sam from ids),
  pg_temp.shift_between((select sam from ids), (select riverside from f), (select east from loc2),
    now() + interval '10 minutes', now() + interval '2 hours'),
  (select r7 from r), pg_temp.user_of((select r7 from r))) as a;
grant select on me to authenticated;
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select r7 from r)), format('select * from public.clock_in_assignment(%L)', (select a from me))),
  'CHT12', null, 'U. allow_with_review: no location is refused');
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select r7 from r)),
  pg_temp.clock_in_sql((select a from me), pg_temp.site_lat()::text, pg_temp.site_lon()::text, '90')),
  'CHT14', null, 'U. allow_with_review: accuracy wider than the fence is refused');
create temp table me2 as select pg_temp.query_as(pg_temp.user_of((select r7 from r)), 'aal1',
  pg_temp.clock_in_sql((select a from me), pg_temp.lat(400), pg_temp.site_lon()::text, '10')) -> 0 as v;
select is((select (v ->> 'outcome') || '/' || (v ->> 'geofence_result') || '/' || (v -> 'exception_codes' ->> 0) from me2),
  'recorded/outside/outside_geofence',
  'allow_with_review (explicit agency choice): a PRECISE outside reading is recorded and flagged for review');

-- ---------------------------------------------------------------------------
-- J. Duplicate; K / L. Clock-out never blocked; M. cross-tenant; N. not required
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select r1 from r)),
  pg_temp.clock_in_sql((select r1 from ra), pg_temp.lat(40), pg_temp.site_lon()::text, '15')),
  'CHT09', null, 'J. a duplicate clock-in is refused');
create temp table ko as select pg_temp.clock_out(pg_temp.user_of((select r1 from r)), (select r1 from ra),
  pg_temp.lat(5000)::double precision, pg_temp.site_lon(), 10) as v;
select is((select (v ->> 'outcome') || '/' || (v ->> 'geofence_result') from ko), 'recorded/outside',
  'K. clock-out outside the fence: recorded (never blocked)');
create temp table r5in as select pg_temp.clock_in(pg_temp.user_of((select r5 from r)), (select r5 from ra),
  pg_temp.lat(20)::double precision, pg_temp.site_lon(), 10) as v;
create temp table lo as select pg_temp.clock_out(pg_temp.user_of((select r5 from r)), (select r5 from ra)) as v;
select is((select (v ->> 'outcome') || '/' || (v ->> 'geofence_result') from lo), 'recorded/unavailable',
  'L. clock-out without any location: recorded (never blocked)');
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select r1 from r)),
  pg_temp.clock_in_sql((select r6 from ra), pg_temp.lat(10), pg_temp.site_lon()::text, '10')),
  null, null, 'M. a worker cannot clock in on another worker''s assignment');
select throws_ok(pg_temp.as_sql((select bob from ids),
  pg_temp.clock_in_sql((select r6 from ra), pg_temp.lat(10), pg_temp.site_lon()::text, '10'), 'aal2'),
  null, null, 'M. another agency cannot clock in on Alpha''s assignment');
select is((select count(*)::int from public.attendance_events where assignment_id = (select r6 from ra)), 0,
  'M. … nothing recorded');

-- Not required: a location without an enabled geofence does not check location (documented).
create temp table nr as select pg_temp.accepted((select sam from ids),
  pg_temp.shift_between((select sam from ids), (select riverside from f), (select annex from loc2),
    now() + interval '10 minutes', now() + interval '2 hours'),
  (select r8 from r), pg_temp.user_of((select r8 from r))) as a;
grant select on nr to authenticated;
select is(pg_temp.clock_in(pg_temp.user_of((select r8 from r)), (select a from nr)) ->> 'geofence_result',
  'not_required', 'N. a site without a geofence records clock-in as "not_required" (location not checked)');

select * from finish();
rollback;
