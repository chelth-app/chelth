-- =============================================================================
-- Facility coverage projection (P0-E9-3K)
-- V visibility · I isolation (cross-facility / cross-agency / non-member)
-- F fields (no coordinates, pay or contact data) · W window · A audit
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql
\ir _attendance_helpers.psql

select plan(18);

-- Mercy (Alpha → Gamma): Wendy accepted today, and assigned again in 3 days.
-- Riverside (Alpha, NOT linked): Nora's shift today. Beta Client (Beta → Delta): Wendy today.
create temp table s as select
  pg_temp.shift_between((select sam from ids), (select mercy from f), (select mercy_main from loc), now() + interval '30 minutes', now() + interval '3 hours') as mercy_today,
  pg_temp.shift((select sam from ids), (select mercy from f), (select mercy_main from loc), 3, '07:00', '15:00', 2) as mercy_later,
  pg_temp.shift_between((select sam from ids), (select riverside from f), (select riverside_main from loc), now() + interval '30 minutes', now() + interval '3 hours') as riverside_today,
  pg_temp.shift_between((select bob from ids), (select beta_client from f), (select beta_main from loc), now() + interval '4 hours', now() + interval '6 hours') as beta_today,
  pg_temp.shift((select sam from ids), (select mercy from f), (select mercy_main from loc), 1, '07:00', '15:00', 1, false) as mercy_draft;
grant select on s to authenticated;

create temp table a as select
  (pg_temp.assign((select sam from ids), (select mercy_today from s), (select wendy from w)) ->> 'assignment_id')::uuid as wendy_mercy,
  (pg_temp.assign((select sam from ids), (select mercy_later from s), (select wendy from w)) ->> 'assignment_id')::uuid as wendy_mercy_later,
  (pg_temp.assign((select sam from ids), (select riverside_today from s), (select walt from w)) ->> 'assignment_id')::uuid as walt_riverside,
  (pg_temp.assign((select bob from ids), (select beta_today from s), (select wendy_beta from w)) ->> 'assignment_id')::uuid as wendy_beta;
grant select on a to authenticated;
select pg_temp.exec_as((select wendy from ids), 'aal1', format('select public.accept_shift_assignment(%L)', (select wendy_mercy from a)));
-- Attendance state for Wendy at Mercy (projection setup; clock-in itself is covered by 170/200/210).
select internal.ensure_attendance((select wendy_mercy from a));
update public.assignment_attendance set clock_state = 'clocked_in', clock_in_at = now() - interval '1 hour'
where assignment_id = (select wendy_mercy from a);

create function pg_temp.coverage(p_user uuid, p_org uuid, p_from integer default -1, p_to integer default 14)
returns jsonb language sql as $$
  select coalesce(pg_temp.query_as(p_user, 'aal1', format(
    'select * from public.list_facility_coverage(%L, current_date + %s, current_date + %s)', p_org, p_from, p_to)), '[]'::jsonb)
$$;
create function pg_temp.names(p_rows jsonb) returns text language sql as $$
  select coalesce(string_agg(r ->> 'worker_display_name' || '@' || (r ->> 'location_name'), ',' order by r ->> 'start_at', r ->> 'worker_display_name'), '')
  from jsonb_array_elements(p_rows) r
$$;
create function pg_temp.call(p_user uuid, p_org uuid, p_from text default 'current_date', p_to text default 'current_date + 7')
returns text language sql as $$
  select pg_temp.as_sql(p_user, format('select * from public.list_facility_coverage(%L, %s, %s)', p_org, p_from, p_to))
$$;

-- ---------------------------------------------------------------------------
-- V. The facility sees the workers serving its own shifts
-- ---------------------------------------------------------------------------
select is(jsonb_array_length(pg_temp.coverage((select fiona from ids), (select gamma from orgs))), 2,
  'V. Gamma admin sees both Mercy assignments');
select ok(pg_temp.names(pg_temp.coverage((select fiona from ids), (select gamma from orgs))) ~ '^[^,]+@Mercy Main,[^,]+@Mercy Main$',
  'V. … only at Mercy');
select is((select r ->> 'clock_state' from jsonb_array_elements(pg_temp.coverage((select fiona from ids), (select gamma from orgs))) r
           where (r ->> 'assignment_id')::uuid = (select wendy_mercy from a)),
  'clocked_in', 'V. attendance state is shown with attendance.view');
select is((select r ->> 'readiness' from jsonb_array_elements(pg_temp.coverage((select fiona from ids), (select gamma from orgs))) r
           where (r ->> 'assignment_id')::uuid = (select wendy_mercy from a)),
  'ready', 'V. readiness for this facility, as on the request page');
select is(jsonb_array_length(pg_temp.coverage((select fred from ids), (select gamma from orgs))), 2,
  'V. the facility supervisor (shift.view) sees the same coverage');
select is(jsonb_array_length(pg_temp.coverage((select fiona from ids), (select gamma from orgs), 3, 3)), 1,
  'V. the window is by shift local date');
select ok(not (pg_temp.names(pg_temp.coverage((select fiona from ids), (select gamma from orgs))) ~ 'Riverside'),
  'V. an unlinked facility of the same agency never appears');

-- ---------------------------------------------------------------------------
-- I. Isolation
-- ---------------------------------------------------------------------------
select is(pg_temp.names(pg_temp.coverage((select dora from ids), (select delta from orgs))),
  (select p.display_name from public.profiles p where p.id = (select wendy from ids)) || '@Beta Ward',
  'I. Delta sees only its own (Beta) shift, never Mercy');
select throws_ok(pg_temp.call((select dora from ids), (select gamma from orgs)), 'CH403', null,
  'I. Facility B cannot read Facility A coverage');
select throws_ok(pg_temp.call((select fiona from ids), (select delta from orgs)), 'CH403', null,
  'I. … nor the reverse');
select throws_ok(pg_temp.call((select alice from ids), (select alpha from orgs)), 'CH403', null,
  'I. an agency organisation is not a facility (agency staff use their own pages)');
select throws_ok(pg_temp.call((select wendy from ids), (select gamma from orgs)), 'CH403', null,
  'I. a worker cannot read facility coverage');
update public.agency_facility_relationships set status = 'suspended' where id = (select mercy from rel);
select is(jsonb_array_length(pg_temp.coverage((select fiona from ids), (select gamma from orgs))), 2,
  'I. a suspended relationship keeps its history visible (not ended)');
update public.agency_facility_relationships set status = 'active' where id = (select mercy from rel);

-- ---------------------------------------------------------------------------
-- F. Fields: nothing beyond the per-shift projections
-- ---------------------------------------------------------------------------
select ok(pg_get_function_result('public.list_facility_coverage(uuid,date,date)'::regprocedure)
            !~* '(latitude|longitude|lat|lon|coordinates|accuracy|geofence|pay|bill|rate|amount|email|phone|address|note)',
  'F. no coordinates, geofence evidence, pay/bill, contact or note fields');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.coverage((select fiona from ids), (select gamma from orgs))) r
                      where (r ->> 'shift_id')::uuid = (select mercy_draft from s)),
  'F. draft shifts are never shown');

-- ---------------------------------------------------------------------------
-- W. Window
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.call((select fiona from ids), (select gamma from orgs), 'current_date', 'current_date + 40'), 'CH400', null,
  'W. at most 31 days');
select throws_ok(pg_temp.call((select fiona from ids), (select gamma from orgs), 'current_date', 'current_date - 1'), 'CH400', null,
  'W. the end cannot precede the start');

-- ---------------------------------------------------------------------------
-- A. Audit (bounded)
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.audit_events
           where action = 'coverage.viewed_by_facility' and organisation_id = (select gamma from orgs)
             and actor_profile_id = (select fiona from ids)),
  1, 'A. repeated reads by one person are audited once per 15 minutes');

select * from finish();
rollback;
