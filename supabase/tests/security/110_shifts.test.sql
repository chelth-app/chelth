-- =============================================================================
-- Shifts (P0-E5-S1)
-- A cross-agency read · B cross-agency mutation · D facility requests only via
-- an explicit active relationship · capabilities · lifecycle · relationship
-- state · cancellation · internal notes · U structural integrity/immutability
-- X direct writes refused · W anon · shift time model (UTC, timezones,
-- overnight, DST)
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql

select plan(83);

create temp table s as
select
  pg_temp.shift((select alice from ids), (select mercy from f), (select mercy_main from loc), 5, '07:00', '15:00', 4, false) as mercy_draft,
  pg_temp.shift((select sam from ids), (select mercy from f), (select mercy_main from loc), 6, '07:00', '15:00', 2) as mercy_open,
  pg_temp.shift((select sam from ids), (select riverside from f), (select riverside_main from loc), 6, '07:00', '15:00') as riverside,
  pg_temp.shift((select bob from ids), (select beta_client from f), (select beta_main from loc), 6, '07:00', '15:00') as beta;
grant select on s to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Capabilities: who may create
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select rita from ids), format(
  'select public.create_shift(%L, %L, ''cna'', current_date + 3, ''07:00'', ''15:00'', 1)', (select mercy from f), (select mercy_main from loc))),
  'CH403', null, 'a recruiter cannot create shifts');
select throws_ok(pg_temp.as_sql((select carl from ids), format(
  'select public.create_shift(%L, %L, ''cna'', current_date + 3, ''07:00'', ''15:00'', 1)', (select mercy from f), (select mercy_main from loc))),
  'CH403', null, 'a credentialing officer cannot create shifts');
select throws_ok(pg_temp.as_sql((select wendy from ids), format(
  'select public.create_shift(%L, %L, ''cna'', current_date + 3, ''07:00'', ''15:00'', 1)', (select mercy from f), (select mercy_main from loc))),
  'CH403', null, 'a healthcare worker cannot create shifts');
select throws_ok(pg_temp.as_sql((select bob from ids), format(
  'select public.create_shift(%L, %L, ''cna'', current_date + 3, ''07:00'', ''15:00'', 1)', (select mercy from f), (select mercy_main from loc))),
  'CH403', null, 'B. another agency cannot create a shift at Alpha''s facility (organisation derived from the facility)');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.create_shift(%L, %L, ''cna'', current_date + 3, ''07:00'', ''15:00'', 1)', (select mercy from f), (select beta_main from loc))),
  'CHS11', null, 'a shift cannot use another agency''s location');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.create_shift(%L, %L, ''cna'', current_date + 3, ''07:00'', ''15:00'', 1)', (select mercy from f), (select riverside_main from loc))),
  'CHS11', null, 'a shift cannot use a location of a different facility');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.create_shift(%L, %L, ''surgeon'', current_date + 3, ''07:00'', ''15:00'', 1)', (select mercy from f), (select mercy_main from loc))),
  'CH400', null, 'the discipline must be reference data');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.create_shift(%L, %L, ''cna'', current_date + 3, ''07:00'', ''15:00'', 0)', (select mercy from f), (select mercy_main from loc))),
  '23514', null, 'requested headcount must be at least 1');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.create_shift(%L, %L, ''cna'', current_date - 2, ''07:00'', ''15:00'', 1)', (select mercy from f), (select mercy_main from loc))),
  'CH400', null, 'a shift must end in the future');

select is((select status::text || '/' || source::text from public.shifts where id = (select mercy_draft from s)),
  'draft/agency', 'an agency shift starts as a draft');
select is((select status::text from public.shifts where id = (select mercy_open from s)),
  'open', 'a scheduler can create and open a shift in one step');

-- ---------------------------------------------------------------------------
-- A / B. Cross-agency isolation
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select bob from ids), 'aal2', format('select * from public.shifts where agency_organisation_id = %L', (select alpha from orgs))),
  0, 'A. Beta cannot read Alpha shifts');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select * from public.list_agency_shifts(%L)', (select alpha from orgs))),
  'CH403', null, 'A. Beta cannot list Alpha shifts');
select is(pg_temp.count_as((select sam from ids), 'aal1', format('select * from public.list_agency_shifts(%L)', (select alpha from orgs))),
  3, 'Alpha''s scheduler lists Alpha''s shifts');
select is(pg_temp.count_as((select wendy from ids), 'aal1', 'select * from public.shifts'),
  0, 'a worker cannot read the shifts table');
select is(pg_temp.count_as((select rita from ids), 'aal1', 'select * from public.shifts'),
  0, 'a recruiter cannot read shifts');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select public.open_shift(%L)', (select mercy_draft from s))),
  'CHS04', null, 'B. Beta cannot open an Alpha shift (not found)');
select throws_ok(pg_temp.as_sql((select bob from ids), format(
  'select public.update_shift(%L, %L, ''cna'', current_date + 5, ''07:00'', ''15:00'', 9, null, null)', (select mercy_draft from s), (select mercy_main from loc))),
  'CHS04', null, 'B. Beta cannot update an Alpha shift');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select public.cancel_shift(%L, ''other'')', (select mercy_draft from s))),
  'CHS04', null, 'B. Beta cannot cancel an Alpha shift');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select public.add_shift_internal_note(%L, ''x'')', (select mercy_draft from s))),
  'CHS04', null, 'B. Beta cannot annotate an Alpha shift');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.open_shift(%L)', gen_random_uuid())),
  'CHS04', null, 'an unknown shift id is SHIFT_NOT_FOUND');
select throws_ok(pg_temp.as_sql((select rita from ids), format('select public.open_shift(%L)', (select mercy_draft from s))),
  'CHS04', null, 'a colleague without shift.view gets the same answer as for an unknown id');

-- ---------------------------------------------------------------------------
-- Lifecycle
-- ---------------------------------------------------------------------------
select lives_ok(pg_temp.as_sql((select sam from ids), format('select public.open_shift(%L)', (select mercy_draft from s))),
  'a scheduler opens a draft');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.open_shift(%L)', (select mercy_draft from s))),
  'CH409', null, 'an open shift cannot be opened again');
select throws_ok(pg_temp.as_sql((select sam from ids), format(
  'select public.update_shift(%L, %L, ''cna'', current_date + 5, ''08:00'', ''15:00'', 4, null, null)', (select mercy_draft from s), (select mercy_main from loc))),
  'CH409', null, 'scheduling details are fixed once a shift is open');
select lives_ok(pg_temp.as_sql((select sam from ids), format(
  'select public.update_shift(%L, %L, ''cna'', current_date + 5, ''07:00'', ''15:00'', 3, ''Report to 3rd floor'', null)', (select mercy_draft from s), (select mercy_main from loc))),
  'headcount and instructions can change while open');
select is((select metadata -> 'fields' from public.audit_events where action = 'shift.updated' and target_id = (select mercy_draft from s)),
  '["requested_headcount", "instructions"]'::jsonb, 'shift.updated records changed field names only');
select throws_ok(format($$ update public.shifts set status = 'draft' where id = %L $$, (select mercy_draft from s)),
  'CH409', null, 'open → draft is refused by the database (owner role)');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.complete_shift(%L)', (select mercy_draft from s))),
  'CH409', null, 'a shift cannot be completed before it ends');

-- ---------------------------------------------------------------------------
-- D. Facility requests through ONE explicit active relationship
-- ---------------------------------------------------------------------------
create temp table req as
select pg_temp.scalar_as((select fiona from ids), 'aal1', format(
  'select public.submit_facility_shift_request(%L, %L, ''cna'', current_date + 8, ''19:00'', ''07:00'', 2, ''Use staff entrance'', ''PO-77'')',
  (select mercy from rel), (select mercy_east from loc)))::uuid as a,
  pg_temp.scalar_as((select fiona from ids), 'aal1', format(
  'select public.submit_facility_shift_request(%L, %L, ''cna'', current_date + 9, ''07:00'', ''15:00'', 1)',
  (select mercy from rel), (select mercy_main from loc)))::uuid as b;
grant select on req to authenticated, anon;

select is((select status::text || '/' || source::text || '/' || (created_by_organisation_id = (select gamma from orgs))::text
           from public.shifts where id = (select a from req)),
  'submitted/facility/true', 'D. a linked facility submits a request (submitted, source facility, facility actor)');
select throws_ok(pg_temp.as_sql((select dora from ids), format(
  'select public.submit_facility_shift_request(%L, %L, ''cna'', current_date + 8, ''07:00'', ''15:00'', 1)', (select mercy from rel), (select mercy_main from loc))),
  'CH403', null, 'D. an unrelated facility cannot request through another facility''s relationship');
select throws_ok(pg_temp.as_sql((select fiona from ids), format(
  'select public.submit_facility_shift_request(%L, %L, ''cna'', current_date + 8, ''07:00'', ''15:00'', 1)', (select beta from rel), (select beta_main from loc))),
  'CH403', null, 'D. a facility cannot request through a relationship it is not linked to');
select throws_ok(pg_temp.as_sql((select fiona from ids), format(
  'select public.submit_facility_shift_request(%L, %L, ''cna'', current_date + 8, ''07:00'', ''15:00'', 1)', (select riverside from rel), (select riverside_main from loc))),
  'CH403', null, 'D. an unlinked client record grants nothing');
select throws_ok(pg_temp.as_sql((select fred from ids), format(
  'select public.submit_facility_shift_request(%L, %L, ''cna'', current_date + 8, ''07:00'', ''15:00'', 1)', (select mercy from rel), (select mercy_main from loc))),
  'CH403', null, 'D. a facility supervisor (no shift.request) cannot submit');
select throws_ok(pg_temp.as_sql((select fiona from ids), format(
  'select public.submit_facility_shift_request(%L, %L, ''cna'', current_date + 8, ''07:00'', ''15:00'', 1)', (select mercy from rel), (select riverside_main from loc))),
  'CHS11', null, 'D. a request must use a location of the relationship''s facility');
select is(pg_temp.count_as((select fiona from ids), 'aal1', format('select * from public.list_facility_request_options(%L)', (select mercy from rel))),
  2, 'the facility sees the active locations it may request for');
select throws_ok(pg_temp.as_sql((select dora from ids), format('select * from public.list_facility_request_options(%L)', (select mercy from rel))),
  'CH403', null, 'another facility cannot enumerate those locations');
select is((select count(*)::int from public.audit_events where action = 'shift.submitted' and target_id = (select a from req)
             and organisation_id in ((select gamma from orgs), (select alpha from orgs))),
  2, 'a submission is audited in the facility and in the agency');
select throws_ok(pg_temp.as_sql((select fiona from ids), format('select public.open_shift(%L)', (select a from req))),
  'CHS04', null, 'a facility cannot open its own request');
select throws_ok(pg_temp.as_sql((select fiona from ids), format('select public.cancel_shift(%L, ''other'')', (select b from req))),
  'CH400', null, 'a facility withdraws only with reason facility_cancelled');
select lives_ok(pg_temp.as_sql((select fiona from ids), format('select public.cancel_shift(%L, ''facility_cancelled'')', (select b from req))),
  'a facility can withdraw its own submitted request');
select lives_ok(pg_temp.as_sql((select sam from ids), format('select public.open_shift(%L)', (select a from req))),
  'the agency opens the facility''s request');
select is((select count(*)::int from internal.notification_outbox where event = 'facility_request_opened'
             and subject_id = (select a from req) and recipient_organisation_id = (select gamma from orgs)),
  1, 'opening a facility request enqueues a facility notification hook');
select throws_ok(pg_temp.as_sql((select fiona from ids), format('select public.cancel_shift(%L, ''facility_cancelled'')', (select a from req))),
  'CH409', null, 'a facility cannot cancel a request the agency has opened');

-- ---------------------------------------------------------------------------
-- Relationship state (R for shifts)
-- ---------------------------------------------------------------------------
create temp table d2 as
select pg_temp.shift((select alice from ids), (select mercy from f), (select mercy_main from loc), 12, '07:00', '15:00', 1, false) as draft;
grant select on d2 to authenticated, anon;
select pg_temp.exec_as((select alice from ids), 'aal2', format('select public.set_facility_relationship_status(%L, ''suspended'')', (select mercy from rel)));
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.create_shift(%L, %L, ''cna'', current_date + 3, ''07:00'', ''15:00'', 1)', (select mercy from f), (select mercy_main from loc))),
  'CHS10', null, 'no new shifts under a suspended relationship');
select throws_ok(pg_temp.as_sql((select fiona from ids), format(
  'select public.submit_facility_shift_request(%L, %L, ''cna'', current_date + 8, ''07:00'', ''15:00'', 1)', (select mercy from rel), (select mercy_main from loc))),
  'CHS10', null, 'no new facility requests under a suspended relationship');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.open_shift(%L)', (select draft from d2))),
  'CHS10', null, 'a draft cannot be opened under a suspended relationship');
select is((select count(*)::int from public.shifts where relationship_id = (select mercy from rel)),
  5, 'existing shifts remain when a relationship is suspended (nothing deleted)');
select pg_temp.exec_as((select alice from ids), 'aal2', format('select public.set_facility_relationship_status(%L, ''active'')', (select mercy from rel)));

-- ---------------------------------------------------------------------------
-- Cancellation
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.cancel_shift(%L, null)', (select mercy_open from s))),
  'CH400', null, 'a cancellation reason is required');
select lives_ok(pg_temp.as_sql((select sam from ids), format('select public.cancel_shift(%L, ''staffing_no_longer_needed'')', (select mercy_open from s))),
  'a scheduler cancels a shift with a controlled reason');
select throws_ok(pg_temp.as_sql((select sam from ids), format(
  'select public.update_shift(%L, %L, ''cna'', current_date + 6, ''07:00'', ''15:00'', 2, null, null)', (select mercy_open from s), (select mercy_main from loc))),
  'CHS09', null, 'a cancelled shift cannot be changed');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.cancel_shift(%L, ''other'')', (select mercy_open from s))),
  'CHS09', null, 'a cancelled shift cannot be cancelled again');
select throws_ok(format($$ update public.shifts set instructions = 'x' where id = %L $$, (select mercy_open from s)),
  'CHS09', null, 'cancelled shifts are immutable (owner role)');

-- ---------------------------------------------------------------------------
-- Internal notes: agency only
-- ---------------------------------------------------------------------------
select lives_ok(pg_temp.as_sql((select sam from ids), format('select public.add_shift_internal_note(%L, ''Facility often late with badge'')', (select riverside from s))),
  'a scheduler adds an internal note');
select is(pg_temp.count_as((select sam from ids), 'aal1', 'select * from public.shift_internal_notes'), 1, 'agency staff read internal notes');
select is(pg_temp.count_as((select fiona from ids), 'aal1', 'select * from public.shift_internal_notes'), 0, 'facilities never read internal notes');
select is(pg_temp.count_as((select wendy from ids), 'aal1', 'select * from public.shift_internal_notes'), 0, 'workers never read internal notes');
select is((select count(*)::int from public.audit_events where metadata::text like '%badge%'),
  0, 'note text is never copied into audit metadata');
select throws_ok($$ delete from public.shift_internal_notes $$, 'CH409', null, 'internal notes are append-only');

-- ---------------------------------------------------------------------------
-- U. Structural integrity (owner role: RLS bypassed, constraints still hold)
-- ---------------------------------------------------------------------------
create temp view shift_row as
select agency_organisation_id, agency_facility_id, relationship_id, facility_location_id, discipline_key, start_at, end_at,
       timezone, requested_headcount, status, source, created_by_organisation_id, created_by_membership_id, opened_at
from public.shifts where id = (select riverside from s);

select throws_ok(format($$
  insert into public.shifts (agency_organisation_id, agency_facility_id, relationship_id, facility_location_id, discipline_key,
    start_at, end_at, timezone, requested_headcount, status, source, created_by_organisation_id, created_by_membership_id, opened_at)
  select agency_organisation_id, %L, relationship_id, facility_location_id, discipline_key, start_at, end_at, timezone,
    requested_headcount, status, source, created_by_organisation_id, created_by_membership_id, opened_at from shift_row $$, (select beta_client from f)),
  '23503', null, 'U. an Alpha shift cannot reference Beta''s facility');
select throws_ok(format($$
  insert into public.shifts (agency_organisation_id, agency_facility_id, relationship_id, facility_location_id, discipline_key,
    start_at, end_at, timezone, requested_headcount, status, source, created_by_organisation_id, created_by_membership_id, opened_at)
  select agency_organisation_id, agency_facility_id, relationship_id, %L, discipline_key, start_at, end_at, 'America/New_York',
    requested_headcount, status, source, created_by_organisation_id, created_by_membership_id, opened_at from shift_row $$, (select mercy_main from loc)),
  '23503', null, 'U. a shift location must belong to the shift''s facility');
select throws_ok(format($$
  insert into public.shifts (agency_organisation_id, agency_facility_id, relationship_id, facility_location_id, discipline_key,
    start_at, end_at, timezone, requested_headcount, status, source, created_by_organisation_id, created_by_membership_id, opened_at)
  select agency_organisation_id, agency_facility_id, %L, facility_location_id, discipline_key, start_at, end_at, timezone,
    requested_headcount, status, source, created_by_organisation_id, created_by_membership_id, opened_at from shift_row $$, (select mercy from rel)),
  '23503', null, 'U. a shift''s relationship must be its own facility''s relationship');
select throws_ok(format($$
  insert into public.shifts (agency_organisation_id, agency_facility_id, relationship_id, facility_location_id, discipline_key,
    start_at, end_at, timezone, requested_headcount, status, source, created_by_organisation_id, created_by_membership_id, opened_at)
  select agency_organisation_id, agency_facility_id, relationship_id, facility_location_id, discipline_key, start_at, end_at, timezone,
    requested_headcount, status, source, %L, %L, opened_at from shift_row $$,
    (select beta from orgs), pg_temp.membership_of((select beta from orgs), (select bob from ids))),
  '23514', null, 'U. an agency shift''s creator must be a member of that agency');
select throws_ok(format($$
  insert into public.shifts (agency_organisation_id, agency_facility_id, relationship_id, facility_location_id, discipline_key,
    start_at, end_at, timezone, requested_headcount, status, source, created_by_organisation_id, created_by_membership_id)
  select agency_organisation_id, %L, %L, %L, discipline_key, start_at, end_at, 'America/New_York',
    requested_headcount, 'submitted', 'facility', %L, %L from shift_row $$,
    (select mercy from f), (select mercy from rel), (select mercy_main from loc),
    (select delta from orgs), pg_temp.membership_of((select delta from orgs), (select dora from ids))),
  'CH403', null, 'U. a facility request must come from the LINKED facility organisation');
select throws_ok(format($$
  insert into public.shifts (agency_organisation_id, agency_facility_id, relationship_id, facility_location_id, discipline_key,
    start_at, end_at, timezone, requested_headcount, status, source, created_by_organisation_id, created_by_membership_id, opened_at)
  select agency_organisation_id, agency_facility_id, relationship_id, facility_location_id, discipline_key, start_at, end_at, 'UTC',
    requested_headcount, status, source, created_by_organisation_id, created_by_membership_id, opened_at from shift_row $$),
  'CH400', null, 'U. the shift timezone must be the location''s timezone');
select throws_ok(format($$
  insert into public.shifts (agency_organisation_id, agency_facility_id, relationship_id, facility_location_id, discipline_key,
    start_at, end_at, timezone, requested_headcount, status, source, created_by_organisation_id, created_by_membership_id, opened_at)
  select agency_organisation_id, agency_facility_id, relationship_id, facility_location_id, discipline_key, end_at, start_at, timezone,
    requested_headcount, status, source, created_by_organisation_id, created_by_membership_id, opened_at from shift_row $$),
  '23514', null, 'U. end_at must be after start_at');
select throws_ok(format($$ update public.shifts set agency_organisation_id = %L where id = %L $$, (select beta from orgs), (select riverside from s)),
  'CH409', null, 'U. a shift''s agency is immutable');
select throws_ok(format($$ update public.shifts set relationship_id = %L where id = %L $$, (select mercy from rel), (select riverside from s)),
  'CH409', null, 'U. a shift''s relationship is immutable');

-- X / W. Direct writes and anonymous access
select throws_ok(pg_temp.as_sql((select alice from ids), 'insert into public.shifts (id) values (gen_random_uuid())', 'aal2'),
  '42501', null, 'X. shifts cannot be inserted directly');
select throws_ok(pg_temp.as_sql((select alice from ids), 'update public.shifts set requested_headcount = 99', 'aal2'),
  '42501', null, 'X. shifts cannot be updated directly');
select throws_ok(pg_temp.as_sql((select alice from ids), 'delete from public.shifts', 'aal2'),
  '42501', null, 'X. shifts cannot be deleted directly');
select throws_ok(pg_temp.as_sql(null, format(
  'select public.create_shift(%L, %L, ''cna'', current_date + 3, ''07:00'', ''15:00'', 1)', (select mercy from f), (select mercy_main from loc))),
  '42501', null, 'W. anon cannot call shift RPCs');
select throws_ok(pg_temp.as_sql(null, 'select * from public.shifts'),
  '42501', null, 'W. anon cannot read shifts');

-- ---------------------------------------------------------------------------
-- Time model: canonical UTC instants from local wall-clock + location timezone
-- ---------------------------------------------------------------------------
create function pg_temp.shift_on(p_facility uuid, p_location uuid, p_date date, p_start text, p_end text)
returns uuid language sql as $$
  select pg_temp.scalar_as((select alice from ids), 'aal1', format(
    'select public.create_shift(%L, %L, ''cna'', %L::date, %L::time, %L::time, 1)', p_facility, p_location, p_date, p_start, p_end))::uuid
$$;

create temp table t as
select
  pg_temp.shift_on((select mercy from f), (select mercy_main from loc), '2030-01-15', '07:00', '15:00') as ny_winter,
  pg_temp.shift_on((select riverside from f), (select riverside_main from loc), '2030-01-15', '07:00', '15:00') as chicago_winter,
  pg_temp.shift_on((select mercy from f), (select mercy_main from loc), '2030-07-15', '19:00', '07:00') as overnight,
  pg_temp.shift_on((select mercy from f), (select mercy_main from loc), '2030-11-02', '19:00', '07:00') as fall_back,
  pg_temp.shift_on((select mercy from f), (select mercy_main from loc), '2030-03-09', '19:00', '07:00') as spring_forward,
  pg_temp.shift_on((select mercy from f), (select mercy_main from loc), '2030-07-16', '07:00', '07:00') as full_day,
  pg_temp.shift_on((select mercy from f), (select mercy_main from loc), '2030-07-17', '16:00', '00:00') as to_midnight;

select is((select start_at from public.shifts where id = (select ny_winter from t)), '2030-01-15 12:00:00+00'::timestamptz,
  'UTC conversion: 07:00 New York (EST) is 12:00 UTC');
select is((select start_at from public.shifts where id = (select chicago_winter from t)), '2030-01-15 13:00:00+00'::timestamptz,
  'facility timezone: the same local time in Chicago is a different instant');
select is((select timezone from public.shifts where id = (select chicago_winter from t)), 'America/Chicago',
  'the location''s timezone is retained on the shift');
select is((select (end_at - start_at)::text || ' ' || ((end_at at time zone timezone)::date - (start_at at time zone timezone)::date)::text
           from public.shifts where id = (select overnight from t)),
  '12:00:00 1', 'overnight: 19:00–07:00 ends the next local day, 12 hours');
select is((select end_at - start_at from public.shifts where id = (select fall_back from t)), interval '13 hours',
  'DST fall-back: 19:00–07:00 lasts 13 hours');
select is((select end_at - start_at from public.shifts where id = (select spring_forward from t)), interval '11 hours',
  'DST spring-forward: 19:00–07:00 lasts 11 hours');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.create_shift(%L, %L, ''cna'', ''2030-03-10'', ''02:30'', ''08:00'', 1)', (select mercy from f), (select mercy_main from loc))),
  'CH400', null, 'a local time inside the DST gap does not exist and is refused');
select is((select end_at - start_at from public.shifts where id = (select full_day from t)), interval '24 hours',
  'equal start and end times mean a 24-hour shift');
select is((select internal.shift_local_dates(start_at, end_at, timezone)::text from public.shifts where id = (select overnight from t)),
  '{2030-07-15,2030-07-16}', 'an overnight shift touches two local dates (compliance is evaluated on both)');
select is((select internal.shift_local_dates(start_at, end_at, timezone)::text from public.shifts where id = (select to_midnight from t)),
  '{2030-07-17}', 'a shift ending exactly at midnight touches one local date');

select * from finish();
rollback;
