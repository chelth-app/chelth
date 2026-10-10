-- =============================================================================
-- Geofence settings + pilot readiness guard (P0-E9-3E.1)
-- S settings (defaults, bounds, AAL2, capability, tenant, audit)
-- O location overrides (independent; defaults never rewrite a location)
-- Q require-geofencing policy (CHT23, nothing recorded; optional mode unchanged)
-- P readiness listing · X clock-out never blocked by configuration
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql
\ir _attendance_helpers.psql

select plan(52);

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
create function pg_temp.shift_at(p_location uuid, p_worker uuid) returns uuid language sql as $$
  select pg_temp.accepted((select sam from ids),
    pg_temp.shift_between((select sam from ids), (select riverside from f), p_location,
      now() + interval '10 minutes', now() + interval '2 hours'),
    p_worker, pg_temp.user_of(p_worker))
$$;
create function pg_temp.policy_sql(p_require text, p_radius text, p_accuracy text, p_policy text default '''block''')
returns text language sql as $$
  select format('select public.set_geofence_policy(%L, %s, %s, %s, %s)', (select alpha from orgs), p_require, p_radius,
                p_accuracy, p_policy)
$$;
create function pg_temp.fence_sql(p_location uuid, p_enabled text, p_radius text, p_accuracy text, p_policy text default 'block',
  p_lat text default null)
returns text language sql as $$
  select format('select public.set_location_geofence(%L, %s, %s, %s, %s, %s, %L)', p_location, p_enabled,
                coalesce(p_lat, pg_temp.site_lat()::text), pg_temp.site_lon(), p_radius, p_accuracy, p_policy)
$$;
create function pg_temp.clock_in_sql(p_assignment uuid, p_lat text, p_lon text, p_acc text)
returns text language sql as $$
  select format('select * from public.clock_in_assignment(%L, %s, %s, %s, now())', p_assignment, p_lat, p_lon, p_acc)
$$;
create function pg_temp.lat(p_meters double precision) returns text language sql as $$
  select (pg_temp.site_lat() + pg_temp.lat_offset(p_meters))::text
$$;
create function pg_temp.events(p_assignment uuid) returns integer language sql as $$
  select count(*)::int from public.attendance_events where assignment_id = p_assignment
$$;

-- Riverside Main: ready (block) · East: not_blocking · Annex: none · North: disabled · South: made invalid
create temp table loc2 as
select pg_temp.scalar_as((select alice from ids), 'aal2', format(
         'select public.create_facility_location(%L, ''Riverside East'', ''America/Chicago'')', (select riverside from f)))::uuid as east,
       pg_temp.scalar_as((select alice from ids), 'aal2', format(
         'select public.create_facility_location(%L, ''Riverside Annex'', ''America/Chicago'')', (select riverside from f)))::uuid as annex,
       pg_temp.scalar_as((select alice from ids), 'aal2', format(
         'select public.create_facility_location(%L, ''Riverside North'', ''America/Chicago'')', (select riverside from f)))::uuid as north,
       pg_temp.scalar_as((select alice from ids), 'aal2', format(
         'select public.create_facility_location(%L, ''Riverside South'', ''America/Chicago'')', (select riverside from f)))::uuid as south;
grant select on loc2 to authenticated;

-- ---------------------------------------------------------------------------
-- S. Organisation geofence policy and defaults
-- ---------------------------------------------------------------------------
select is((select format('%s/%s/%s/%s', r.require_geofence, r.default_geofence_radius_meters,
                         r.default_geofence_max_accuracy_meters, r.default_geofence_outside_policy)
           from internal.attendance_rules((select alpha from orgs)) r),
  'f/150/100/block', 'S. defaults load: geofencing optional, 150 m radius, 100 m accuracy, block');
select is((select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'agency_attendance_settings' and column_name = 'require_geofence'),
  'false', 'S. new agencies do not require geofencing unless an operator turns it on');

select lives_ok(pg_temp.as_sql((select alice from ids), pg_temp.policy_sql('false', '120', '80'), 'aal2'),
  'S. defaults save (AAL2, attendance.manage_settings)');
select is((select format('%s/%s/%s', require_geofence, default_geofence_radius_meters, default_geofence_max_accuracy_meters)
           from public.agency_attendance_settings where agency_organisation_id = (select alpha from orgs)),
  'f/120/80', 'S. … and persist');
select lives_ok(pg_temp.as_sql((select alice from ids), pg_temp.policy_sql('false', '50', '10'), 'aal2'),
  'S. radius 50 m and accuracy 10 m are valid');
select lives_ok(pg_temp.as_sql((select alice from ids), pg_temp.policy_sql('false', '2000', '500'), 'aal2'),
  'S. radius 2000 m and accuracy 500 m are valid');
select throws_ok(pg_temp.as_sql((select alice from ids), pg_temp.policy_sql('false', '49', '100'), 'aal2'),
  'CH400', null, 'S. radius below 50 m is rejected');
select throws_ok(pg_temp.as_sql((select alice from ids), pg_temp.policy_sql('false', '2001', '100'), 'aal2'),
  'CH400', null, 'S. radius above 2000 m is rejected');
select throws_ok(pg_temp.as_sql((select alice from ids), pg_temp.policy_sql('false', '0', '100'), 'aal2'),
  'CH400', null, 'S. radius 0 is rejected');
select throws_ok(pg_temp.as_sql((select alice from ids), pg_temp.policy_sql('false', '-150', '100'), 'aal2'),
  'CH400', null, 'S. a negative radius is rejected');
select throws_ok(pg_temp.as_sql((select alice from ids), pg_temp.policy_sql('false', '150', '9'), 'aal2'),
  'CH400', null, 'S. accuracy below 10 m is rejected');
select throws_ok(pg_temp.as_sql((select alice from ids), pg_temp.policy_sql('false', '150', '501'), 'aal2'),
  'CH400', null, 'S. accuracy above 500 m is rejected');
select throws_ok(pg_temp.as_sql((select alice from ids), pg_temp.policy_sql('null', '150', '100'), 'aal2'),
  'CH400', null, 'S. the require setting must be explicit');
select lives_ok(pg_temp.as_sql((select alice from ids), pg_temp.policy_sql('false', '150', '100', '''allow_with_review'''), 'aal2'),
  'S. the default outside policy can change');
select is((select default_geofence_outside_policy::text from public.agency_attendance_settings
            where agency_organisation_id = (select alpha from orgs)), 'allow_with_review', 'S. … policy change persists');
select throws_ok(pg_temp.as_sql((select alice from ids), pg_temp.policy_sql('true', '150', '100')),
  'CH402', null, 'S. AAL1 session: step-up required');
select throws_ok(pg_temp.as_sql((select sam from ids), pg_temp.policy_sql('true', '150', '100'), 'aal2'),
  'CH403', null, 'S. a scheduler without attendance.manage_settings is denied');
select throws_ok(pg_temp.as_sql((select wendy from ids), pg_temp.policy_sql('true', '150', '100'), 'aal2'),
  'CH403', null, 'S. a worker is denied');
select throws_ok(pg_temp.as_sql((select fiona from ids), pg_temp.policy_sql('true', '150', '100'), 'aal2'),
  'CH403', null, 'S. a facility admin is denied');
select throws_ok(pg_temp.as_sql((select bob from ids), pg_temp.policy_sql('true', '150', '100'), 'aal2'),
  'CH403', null, 'S. another agency is denied (cross-tenant)');
select is((select require_geofence from public.agency_attendance_settings where agency_organisation_id = (select alpha from orgs)),
  false, 'S. … no denied call changed the policy');
select lives_ok(pg_temp.as_sql((select alice from ids), pg_temp.policy_sql('false', '150', '100'), 'aal2'),
  'S. back to 150 m / 100 m / block');
select ok((select bool_and(metadata -> 'changes' is not null and metadata::text !~ 'latitude|longitude')
             and count(*) >= 5
           from public.audit_events
           where organisation_id = (select alpha from orgs) and action = 'attendance.geofence_policy_updated'),
  'S. every policy change is audited (with what changed)');

-- ---------------------------------------------------------------------------
-- O. Location geofences: validation, overrides, audit
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select alice from ids), pg_temp.fence_sql((select riverside_main from loc), 'true', '49', '100'), 'aal2'),
  'CH400', null, 'O. a location radius below 50 m is rejected');
select throws_ok(pg_temp.as_sql((select alice from ids), pg_temp.fence_sql((select riverside_main from loc), 'true', '150', '100', 'block', '''NaN''::double precision'), 'aal2'),
  'CH400', null, 'O. a NaN site centre is rejected');
select throws_ok(pg_temp.as_sql((select alice from ids), pg_temp.fence_sql((select riverside_main from loc), 'true', '150', '100', 'block', 'null'), 'aal2'),
  'CH400', null, 'O. a missing site centre is rejected');
select throws_ok(pg_temp.as_sql((select bob from ids), pg_temp.fence_sql((select riverside_main from loc), 'true', '150', '100'), 'aal2'),
  'CH403', null, 'O. another agency cannot configure Alpha''s location');

select lives_ok(pg_temp.as_sql((select alice from ids), pg_temp.fence_sql((select riverside_main from loc), 'true', '150', '100'), 'aal2'),
  'O. Riverside Main: 150 m, blocking');
select lives_ok(pg_temp.as_sql((select alice from ids), pg_temp.fence_sql((select east from loc2), 'true', '300', '60', 'allow_with_review'), 'aal2'),
  'O. Riverside East overrides: 300 m radius, 60 m accuracy');
select pg_temp.exec_as((select alice from ids), 'aal2', pg_temp.fence_sql((select north from loc2), 'false', '75', '100'));
select pg_temp.exec_as((select alice from ids), 'aal2', pg_temp.fence_sql((select south from loc2), 'true', '75', '100'));
select is((select string_agg(format('%s:%s/%s', facility_location_id = (select riverside_main from loc), radius_meters, max_accuracy_meters), ',' order by radius_meters)
           from public.location_geofences
           where facility_location_id in ((select riverside_main from loc), (select east from loc2))),
  't:150/100,f:300/60', 'O. one location does not affect another');
select is((select count(*)::int from public.location_geofences where facility_location_id = (select annex from loc2)), 0,
  'O. a location without a configured geofence has no row (defaults never create one)');

select pg_temp.exec_as((select alice from ids), 'aal2', pg_temp.policy_sql('false', '400', '200', '''allow_with_review'''));
select is((select format('%s/%s/%s', radius_meters, max_accuracy_meters, outside_policy) from public.location_geofences
            where facility_location_id = (select riverside_main from loc)),
  '150/100/block', 'O. changing organisation defaults does not rewrite an existing geofence');
select pg_temp.exec_as((select alice from ids), 'aal2', pg_temp.policy_sql('false', '150', '100'));

select pg_temp.exec_as((select alice from ids), 'aal2', pg_temp.fence_sql((select riverside_main from loc), 'true', '150', '100', 'block', pg_temp.lat(1)));
select pg_temp.exec_as((select alice from ids), 'aal2', pg_temp.fence_sql((select riverside_main from loc), 'true', '150', '100'));
select is((select string_agg(metadata ->> 'changes', ' | ' order by metadata ->> 'changes') from public.audit_events
            where action = 'attendance.geofence_updated' and target_id = (select riverside_main from loc)),
  '["created"] | ["site_centre"] | ["site_centre"]', 'O. geofence changes are audited: created, then site centre changed');
select is((select count(*)::int from public.audit_events
            where action = 'attendance.geofence_updated' and metadata::text ~ '40\.71|latitude|longitude'), 0,
  'O. … the audit never contains the site coordinates');
select is((select string_agg(metadata ->> 'changes', ' | ' order by metadata ->> 'changes') from public.audit_events
            where action = 'attendance.geofence_updated' and target_id = (select east from loc2)),
  '["created"]', 'O. … per location');

-- ---------------------------------------------------------------------------
-- P. Readiness listing
-- ---------------------------------------------------------------------------
create temp table rd as select pg_temp.query_as((select alice from ids), 'aal2',
  format('select * from public.list_geofence_readiness(%L)', (select alpha from orgs))) as v;
select is((select string_agg(x ->> 'location_name' || '=' || (x ->> 'readiness'), ',' order by x ->> 'location_name')
           from rd, jsonb_array_elements(v) x where x ->> 'facility_name' = 'Riverside'),
  'Riverside Annex=not_configured,Riverside East=not_blocking,Riverside Main=ready,Riverside North=disabled,Riverside South=ready',
  'P. readiness per location: ready / not blocking / disabled / not configured');
select is((select count(*)::int from rd, jsonb_array_elements(v) x where x::text ~ 'latitude|longitude|40\.71'), 0,
  'P. the readiness listing carries no coordinates');
select is((select count(*)::int from rd, jsonb_array_elements(v) x where (x ->> 'readiness') = 'ready')
          || '/' || (select count(*)::int from rd, jsonb_array_elements(v) x where (x ->> 'location_active')::boolean),
  '2/7', 'P. pilot readiness counts: properly configured blocking geofences / active locations');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select * from public.list_geofence_readiness(%L)', (select alpha from orgs)), 'aal2'),
  'CH403', null, 'P. another agency cannot read Alpha''s readiness');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.list_geofence_readiness(%L)', (select alpha from orgs))),
  'CH403', null, 'P. a worker cannot read readiness');

-- ---------------------------------------------------------------------------
-- Q. Require geofencing ON
-- ---------------------------------------------------------------------------
create temp table q as
select pg_temp.ready_worker('q1@example.test') as q1, pg_temp.ready_worker('q2@example.test') as q2,
       pg_temp.ready_worker('q3@example.test') as q3, pg_temp.ready_worker('q4@example.test') as q4,
       pg_temp.ready_worker('q5@example.test') as q5, pg_temp.ready_worker('q6@example.test') as q6;
grant select on q to authenticated;
create temp table qa as
select pg_temp.shift_at((select riverside_main from loc), (select q1 from q)) as main,
       pg_temp.shift_at((select annex from loc2), (select q2 from q)) as annex,
       pg_temp.shift_at((select north from loc2), (select q3 from q)) as north,
       pg_temp.shift_at((select south from loc2), (select q4 from q)) as south,
       pg_temp.shift_at((select east from loc2), (select q5 from q)) as east,
       pg_temp.shift_at((select annex from loc2), (select q6 from q)) as annex_optional;
grant select on qa to authenticated;

select pg_temp.exec_as((select alice from ids), 'aal2', pg_temp.policy_sql('true', '150', '100'));

create temp table qm as select pg_temp.query_as(pg_temp.user_of((select q1 from q)), 'aal1',
  pg_temp.clock_in_sql((select main from qa), pg_temp.lat(40), pg_temp.site_lon()::text, '15')) -> 0 as v;
select is((select (v ->> 'outcome') || '/' || (v ->> 'geofence_result') from qm), 'recorded/inside',
  'Q-A. configured, enabled, blocking geofence: normal server evaluation (inside recorded)');
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select q1 from q)),
  pg_temp.clock_in_sql((select main from qa), pg_temp.lat(900), pg_temp.site_lon()::text, '10')),
  'CHT09', null, 'Q-A. … E9-3E rules still apply (duplicate refused)');

select throws_ok(pg_temp.as_sql(pg_temp.user_of((select q2 from q)), format('select * from public.clock_in_assignment(%L)', (select annex from qa))),
  'CHT23', null, 'Q-B. no geofence row: check-in refused (configuration error)');
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select q2 from q)),
  pg_temp.clock_in_sql((select annex from qa), pg_temp.lat(10), pg_temp.site_lon()::text, '10')),
  'CHT23', null, 'Q-B. … even with a precise location reading');
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select q3 from q)),
  pg_temp.clock_in_sql((select north from qa), pg_temp.lat(10), pg_temp.site_lon()::text, '10')),
  'CHT23', null, 'Q-C. geofence disabled: check-in refused');

-- Q-D. A malformed row (only reachable if a constraint were ever relaxed): owner arrangement.
alter table public.location_geofences drop constraint location_geofences_radius_meters_check;
update public.location_geofences set radius_meters = 5 where facility_location_id = (select south from loc2);
select is(internal.location_geofence_readiness((select south from loc2))::text, 'invalid',
  'Q-D. an out-of-bounds configuration is "invalid", never "configured"');
select throws_ok(pg_temp.as_sql(pg_temp.user_of((select q4 from q)),
  pg_temp.clock_in_sql((select south from qa), pg_temp.lat(1), pg_temp.site_lon()::text, '3')),
  'CHT23', null, 'Q-D. malformed configuration: check-in refused');

select is(pg_temp.events((select annex from qa)) + pg_temp.events((select north from qa)) + pg_temp.events((select south from qa)), 0,
  'Q-F. no attendance event was inserted for any configuration refusal');
select is((select count(*)::int from public.attendance_location_evidence
            where attendance_id in (select id from public.assignment_attendance
                                    where assignment_id in ((select annex from qa), (select north from qa), (select south from qa)))), 0,
  'Q-F. … and no location evidence was stored');

create temp table qe as select pg_temp.query_as(pg_temp.user_of((select q5 from q)), 'aal1',
  pg_temp.clock_in_sql((select east from qa), pg_temp.lat(20), pg_temp.site_lon()::text, '10')) -> 0 as v;
select is((select (v ->> 'outcome') || '/' || (v ->> 'geofence_result') from qe), 'recorded/inside',
  'Q. an enabled geofence that flags (not blocks) outside readings is configured: evaluated normally');

-- ---------------------------------------------------------------------------
-- X. Clock-out is never blocked by configuration
-- ---------------------------------------------------------------------------
select pg_temp.exec_as((select alice from ids), 'aal2', pg_temp.fence_sql((select riverside_main from loc), 'false', '150', '100'));
select is((pg_temp.clock_out(pg_temp.user_of((select q1 from q)), (select main from qa))) ->> 'outcome', 'recorded',
  'X. geofencing required, the location''s geofence then disabled: clock-out is still recorded');

-- ---------------------------------------------------------------------------
-- Q. Require geofencing OFF: documented optional behaviour
-- ---------------------------------------------------------------------------
select pg_temp.exec_as((select alice from ids), 'aal2', pg_temp.policy_sql('false', '150', '100'));
select is(pg_temp.clock_in(pg_temp.user_of((select q6 from q)), (select annex_optional from qa)) ->> 'geofence_result',
  'not_required', 'Q. optional mode: a location without a geofence records clock-in as "not_required"');

select * from finish();
rollback;
