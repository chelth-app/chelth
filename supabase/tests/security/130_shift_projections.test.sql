-- =============================================================================
-- Shift projections (P0-E5-S1)
-- C facility sees only its relationship's shifts · S narrow projections
-- T platform admin gets nothing · worker projection · ended relationships
-- V SECURITY DEFINER hygiene for every new function · W anon
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql

select plan(30);

create temp table s as
select
  pg_temp.shift((select sam from ids), (select mercy from f), (select mercy_main from loc), 3, '07:00', '15:00', 2) as mercy,
  pg_temp.shift((select alice from ids), (select mercy from f), (select mercy_main from loc), 4, '07:00', '15:00', 1, false) as mercy_draft,
  pg_temp.shift((select sam from ids), (select riverside from f), (select riverside_main from loc), 3, '07:00', '15:00') as riverside,
  pg_temp.shift((select bob from ids), (select beta_client from f), (select beta_main from loc), 6, '07:00', '15:00') as beta;
grant select on s to authenticated, anon;
update public.shifts set instructions = 'Report to ward 3' where id = (select mercy from s);
select pg_temp.exec_as((select sam from ids), 'aal1', format('select public.add_shift_internal_note(%L, ''INTERNAL-ONLY-TEXT'')', (select mercy from s)));
create temp table a as select pg_temp.assign((select sam from ids), (select mercy from s), (select wendy from w)) as wendy;
grant select on a to authenticated;

-- ---------------------------------------------------------------------------
-- C / S. Facility shift projection
-- ---------------------------------------------------------------------------
select is(pg_temp.query_as((select fiona from ids), 'aal1', format('select shift_id from public.list_facility_shifts(%L)', (select gamma from orgs))),
  jsonb_build_array(jsonb_build_object('shift_id', (select mercy from s))),
  'C. the linked facility sees its relationship''s shifts only (no drafts, no other facility, no other agency)');
select is((select array_agg(key order by key) from jsonb_object_keys(pg_temp.query_as((select fiona from ids), 'aal1',
            format('select * from public.list_facility_shifts(%L)', (select gamma from orgs))) -> 0) key),
  array['accepted_count', 'active_count', 'agency_name', 'cancellation_reason', 'discipline_key', 'discipline_name', 'end_at',
        'external_reference', 'fill_state', 'instructions', 'location_name', 'relationship_id', 'relationship_status',
        'requested_headcount', 'shift_id', 'source', 'start_at', 'status', 'timezone'],
  'S. the facility shift projection has exactly the allowed fields (no notes, rates or worker records)');
select is(pg_temp.query_as((select fiona from ids), 'aal1', format('select active_count, fill_state from public.list_facility_shifts(%L)', (select gamma from orgs))) -> 0,
  '{"active_count": 1, "fill_state": "partially_filled"}'::jsonb, 'S. fill progress is derived (1 of 2)');
select ok(pg_temp.query_as((select fiona from ids), 'aal1', format('select * from public.list_facility_shifts(%L)', (select gamma from orgs)))::text !~ 'INTERNAL-ONLY-TEXT',
  'S. internal notes never appear in the facility projection');
select is(pg_temp.count_as((select fred from ids), 'aal1', format('select * from public.list_facility_shifts(%L)', (select gamma from orgs))),
  1, 'a facility supervisor sees the relationship''s shifts (who is coming)');
select throws_ok(pg_temp.as_sql((select dora from ids), format('select * from public.list_facility_shifts(%L)', (select gamma from orgs))),
  'CH403', null, 'C. another facility cannot read Gamma''s shift projection');
select is(pg_temp.query_as((select dora from ids), 'aal1', format('select shift_id from public.list_facility_shifts(%L)', (select delta from orgs))),
  jsonb_build_array(jsonb_build_object('shift_id', (select beta from s))),
  'C. Delta sees only Beta''s shift under its own relationship');
select is(pg_temp.count_as((select fiona from ids), 'aal1', 'select * from public.shifts'), 0, 'C. facilities cannot read the shifts table');
select is(pg_temp.count_as((select fiona from ids), 'aal1', 'select * from public.shift_assignments'), 0, 'C. facilities cannot read the assignments table');

-- ---------------------------------------------------------------------------
-- S. Assigned-worker projection
-- ---------------------------------------------------------------------------
select is(pg_temp.query_as((select fiona from ids), 'aal1', format('select * from public.list_facility_shift_assignments(%L)', (select mercy from s))),
  jsonb_build_array(jsonb_build_object('assignment_id', (select (wendy ->> 'assignment_id')::uuid from a), 'worker_display_name', 'wendy',
    'discipline_name', 'Certified Nursing Assistant (CNA)', 'status', 'assigned', 'readiness', 'ready')),
  'S. the facility sees who is coming: id, display name, discipline, state, readiness — nothing else');
select is((select count(*)::int from public.audit_events where action = 'shift.assignments_viewed_by_facility'
             and organisation_id = (select gamma from orgs)),
  1, 'S. assigned-worker reads are audited in the facility organisation');
select throws_ok(pg_temp.as_sql((select dora from ids), format('select * from public.list_facility_shift_assignments(%L)', (select mercy from s))),
  'CHS04', null, 'C. another facility cannot see who is assigned');
select throws_ok(pg_temp.as_sql((select fiona from ids), format('select * from public.list_facility_shift_assignments(%L)', (select mercy_draft from s))),
  'CHS04', null, 'agency drafts are invisible to the facility');
select throws_ok(pg_temp.as_sql((select fiona from ids), format('select * from public.list_facility_shift_assignments(%L)', (select riverside from s))),
  'CHS04', null, 'C. a facility sees nothing of other client facilities');

-- ---------------------------------------------------------------------------
-- Worker projection
-- ---------------------------------------------------------------------------
select is((select array_agg(key order by key) from jsonb_object_keys(pg_temp.query_as((select wendy from ids), 'aal1',
            format('select * from public.list_my_shift_assignments(%L)', (select alpha from orgs))) -> 0) key),
  array['accepted_at', 'address_line1', 'address_line2', 'agency_facility_id', 'arrival_instructions', 'assigned_at',
        'assignment_id', 'can_respond', 'cancellation_reason', 'country_code', 'discipline_name', 'end_at',
        'facility_name', 'image_path', 'instructions', 'local_date', 'locality', 'location_name',
        'parking_instructions', 'postal_code', 'region', 'shift_id', 'shift_status', 'start_at', 'status', 'timezone',
        'unit_label', 'worker_contact_label', 'worker_contact_phone'],
  'the worker projection has exactly the worker-safe fields');
select is(pg_temp.query_as((select wendy from ids), 'aal1', format('select facility_name, instructions, can_respond from public.list_my_shift_assignments(%L)', (select alpha from orgs))) -> 0,
  '{"facility_name": "Mercy Rehab", "instructions": "Report to ward 3", "can_respond": true}'::jsonb,
  'an actively assigned worker sees the facility and its instructions');
select ok(pg_temp.query_as((select wendy from ids), 'aal1', format('select * from public.list_my_shift_assignments(%L)', (select alpha from orgs)))::text !~ 'INTERNAL-ONLY-TEXT',
  'workers never see internal notes');
select is(pg_temp.count_as((select walt from ids), 'aal1', format('select * from public.list_my_shift_assignments(%L)', (select alpha from orgs))),
  0, 'another worker sees none of wendy''s assignments');
select pg_temp.exec_as((select sam from ids), 'aal1', format('select public.cancel_shift_assignment(%L, ''worker_unavailable'')', (select (wendy ->> 'assignment_id')::uuid from a)));
select is(pg_temp.query_as((select wendy from ids), 'aal1', format('select status, instructions, cancellation_reason from public.list_my_shift_assignments(%L)', (select alpha from orgs))) -> 0,
  '{"status": "cancelled", "instructions": null, "cancellation_reason": "worker_unavailable"}'::jsonb,
  'instructions are withdrawn once the assignment is no longer active');

-- ---------------------------------------------------------------------------
-- Ended relationship: facility visibility stops
-- ---------------------------------------------------------------------------
select pg_temp.exec_as((select alice from ids), 'aal2', format('select public.set_facility_relationship_status(%L, ''ended'')', (select mercy from rel)));
select is(pg_temp.count_as((select fiona from ids), 'aal1', format('select * from public.list_facility_shifts(%L)', (select gamma from orgs))),
  0, 'an ended relationship ends facility visibility');
select is((select count(*)::int from public.shifts where relationship_id = (select mercy from rel)),
  2, 'history is retained for the agency');

-- ---------------------------------------------------------------------------
-- T. Platform admin: no tenant data through RLS or projections
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.shifts'), 0, 'T. a platform admin reads no shifts');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.shift_assignments'), 0, 'T. a platform admin reads no assignments');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.assignment_eligibility_decisions'), 0, 'T. a platform admin reads no decisions');
select throws_ok(pg_temp.as_sql((select erin from ids), format('select * from public.list_agency_shifts(%L)', (select alpha from orgs)), 'aal2'),
  'CH403', null, 'T. a platform admin cannot list an agency''s shifts');
select throws_ok(pg_temp.as_sql((select erin from ids), format('select * from public.list_facility_shifts(%L)', (select delta from orgs)), 'aal2'),
  'CH403', null, 'T. a platform admin cannot read a facility projection');

-- ---------------------------------------------------------------------------
-- V / W. Function hygiene for every function added in this stage
-- ---------------------------------------------------------------------------
create temp view stage_functions as
select p.oid, n.nspname, p.proname, p.prosecdef, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'internal', 'authz')
  and (p.proname ~ '(shift|assignment)' or p.proname in ('local_to_instant', 'require_discipline', 'require_active_relationship',
       'active_membership_id', 'clean_text', 'enqueue_notification', 'profile_schedule_lock', 'is_own_active_worker'));

select ok((select count(*) >= 30 from stage_functions), 'the stage''s functions are all inspected');
select is((select count(*)::int from stage_functions
            where prosecdef and not coalesce('search_path=""' = any (proconfig), false)),
  0, 'V. every SECURITY DEFINER function pins an empty search_path');
select is((select count(*)::int from stage_functions where has_function_privilege('anon', oid, 'execute')),
  0, 'W. anon can execute none of them');
select is((select count(*)::int from stage_functions
            where nspname = 'internal' and has_function_privilege('authenticated', oid, 'execute')),
  0, 'no internal shift/assignment function is callable by API roles');

select * from finish();
rollback;
