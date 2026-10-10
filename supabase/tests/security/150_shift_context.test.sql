-- =============================================================================
-- Shift context (P0-E9-3D-S2)
-- M managers only (facility.manage at AAL2; shift.manage for units)
-- W the worker sees context only while their assignment is active
-- I facility-image storage policies (write / read)  · X cross-tenant denial
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql

select plan(28);

create temp table s as
select pg_temp.shift((select sam from ids), (select mercy from f), (select mercy_main from loc), 3, '07:00', '15:00', 2) as mercy;
grant select on s to authenticated, anon;
create temp table a as select pg_temp.assign((select sam from ids), (select mercy from s), (select wendy from w)) as wendy;
grant select on a to authenticated;

-- ---------------------------------------------------------------------------
-- M. Facility worker context
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select sam from ids), format(
  'select public.update_facility_worker_context(%L, ''Visitor garage'', null, null, null)', (select mercy from f))),
  'CH403', null, 'M. a scheduler (no facility.manage) cannot set arrival guidance');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.update_facility_worker_context(%L, ''Visitor garage'', null, null, null)', (select mercy from f))),
  'CH402', null, 'M. facility.manage needs step-up (AAL2)');
select throws_ok(pg_temp.as_sql((select bob from ids), format(
  'select public.update_facility_worker_context(%L, ''Visitor garage'', null, null, null)', (select mercy from f)), 'aal2'),
  'CH403', null, 'X. another agency cannot touch Alpha''s facility');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.update_facility_worker_context(%L, null, null, ''Nursing desk'', null)', (select mercy from f)), 'aal2'),
  'CH400', null, 'M. a worker contact needs both a label and a phone');
select lives_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.update_facility_worker_context(%L, ''Visitor garage, level 2'', ''East entrance, report to ward desk'', ''Nursing supervisor desk'', ''+1 404 555 0187'')',
  (select mercy from f)), 'aal2'), 'M. an admin at AAL2 sets arrival guidance and the worker contact');
select is((select jsonb_build_object('p', parking_instructions, 'c', worker_contact_label) from public.agency_facilities where id = (select mercy from f)),
  '{"p": "Visitor garage, level 2", "c": "Nursing supervisor desk"}'::jsonb, 'M. values are stored');
select is((select metadata -> 'fields' from public.audit_events where action = 'facility.updated'
             and target_id = (select mercy from f) order by occurred_at desc limit 1),
  '["arrival_instructions", "parking_instructions", "worker_contact_label", "worker_contact_phone"]'::jsonb,
  'M. the audit lists which fields changed, never their values');
update public.agency_facilities set address_line1 = '123 Healthway Drive', locality = 'Atlanta', region = 'GA',
  postal_code = '30309', country_code = 'US' where id = (select mercy from f);

-- Units
select lives_ok(pg_temp.as_sql((select sam from ids), format('select public.set_shift_unit(%L, ''ICU'')', (select mercy from s))),
  'M. a scheduler (shift.manage) sets the unit');
select is((select unit_label from public.shifts where id = (select mercy from s)), 'ICU', 'M. the unit is stored on the shift');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select public.set_shift_unit(%L, ''Ward 9'')', (select mercy from s))),
  'CHS04', null, 'M. a worker cannot set the unit (shift not found: no oracle)');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select public.set_shift_unit(%L, ''Ward 9'')', (select mercy from s)), 'aal2'),
  'CHS04', null, 'X. another agency cannot set Alpha''s unit (no oracle)');

-- ---------------------------------------------------------------------------
-- W. Worker projection
-- ---------------------------------------------------------------------------
select is(pg_temp.query_as((select wendy from ids), 'aal1', format(
  'select unit_label, address_line1, locality, region, postal_code, parking_instructions, arrival_instructions, worker_contact_label, worker_contact_phone
     from public.list_my_shift_assignments(%L)', (select alpha from orgs))) -> 0,
  '{"unit_label": "ICU", "address_line1": "123 Healthway Drive", "locality": "Atlanta", "region": "GA", "postal_code": "30309",
    "parking_instructions": "Visitor garage, level 2", "arrival_instructions": "East entrance, report to ward desk",
    "worker_contact_label": "Nursing supervisor desk", "worker_contact_phone": "+1 404 555 0187"}'::jsonb,
  'W. an actively assigned worker sees the shift context');
select is(pg_temp.scalar_as((select wendy from ids), 'aal1', format(
  'select local_date from public.list_my_shift_assignments(%L)', (select alpha from orgs))),
  ((select start_at at time zone timezone from public.shifts where id = (select mercy from s))::date)::text,
  'W. local_date is the facility-local calendar date');
select ok(pg_temp.query_as((select wendy from ids), 'aal1', format('select * from public.list_my_shift_assignments(%L)', (select alpha from orgs)))::text
  !~ 'facility@|phone_number|INTERNAL', 'W. no site e-mail, site phone or internal notes in the worker projection');
select is(pg_temp.count_as((select walt from ids), 'aal1', format('select * from public.list_my_shift_assignments(%L)', (select alpha from orgs))),
  0, 'W. another worker sees nothing of Wendy''s shift');
-- ---------------------------------------------------------------------------
-- I. Facility images
-- ---------------------------------------------------------------------------
create temp table img as
select (select alpha from orgs)::text || '/' || (select mercy from f)::text || '/' || gen_random_uuid()::text as path,
       (select beta from orgs)::text || '/' || (select mercy from f)::text || '/' || gen_random_uuid()::text as wrong_org;
grant select on img to authenticated;

select is(pg_temp.scalar_as((select alice from ids), 'aal2', format('select authz.can_write_facility_image(%L)', (select path from img))),
  'true', 'I. an admin at AAL2 may upload a facility image');
select is(pg_temp.scalar_as((select alice from ids), 'aal1', format('select authz.can_write_facility_image(%L)', (select path from img))),
  'false', 'I. not without step-up');
select is(pg_temp.scalar_as((select sam from ids), 'aal1', format('select authz.can_write_facility_image(%L)', (select path from img))),
  'false', 'I. a scheduler may not upload');
select is(pg_temp.scalar_as((select bob from ids), 'aal2', format('select authz.can_write_facility_image(%L)', (select wrong_org from img))),
  'false', 'X. a path naming another agency''s facility is refused');
select throws_ok(pg_temp.as_sql((select alice from ids), format('select public.set_facility_image(%L, %L)', (select mercy from f), (select path from img)), 'aal2'),
  'CH400', null, 'I. the image must exist in storage before it is attached');
insert into storage.objects (bucket_id, name, owner) values ('facility-images', (select path from img), (select alice from ids));
select lives_ok(pg_temp.as_sql((select alice from ids), format('select public.set_facility_image(%L, %L)', (select mercy from f), (select path from img)), 'aal2'),
  'I. an uploaded image is attached');
select is(pg_temp.scalar_as((select wendy from ids), 'aal1', format('select authz.can_read_facility_image(%L)', (select path from img))),
  'true', 'I. the assigned worker may read the facility''s current image');
select is(pg_temp.scalar_as((select walt from ids), 'aal1', format('select authz.can_read_facility_image(%L)', (select path from img))),
  'false', 'I. a worker without an assignment there may not');
select is(pg_temp.scalar_as((select fiona from ids), 'aal1', format('select authz.can_read_facility_image(%L)', (select path from img))),
  'false', 'X. the linked facility organisation does not read agency client records');
select is(pg_temp.scalar_as((select bob from ids), 'aal2', format('select authz.can_read_facility_image(%L)', (select path from img))),
  'false', 'X. another agency may not');

-- ---------------------------------------------------------------------------
-- W. Once the assignment is no longer active, the context is withheld
-- ---------------------------------------------------------------------------
select lives_ok(pg_temp.as_sql((select wendy from ids), format('select public.decline_shift_assignment(%L)', (select (wendy ->> 'assignment_id')::uuid from a))),
  'W. (setup) the worker declines');
select is(pg_temp.query_as((select wendy from ids), 'aal1', format(
  'select address_line1, parking_instructions, worker_contact_phone, image_path, instructions from public.list_my_shift_assignments(%L)', (select alpha from orgs))) -> 0,
  '{"address_line1": null, "parking_instructions": null, "worker_contact_phone": null, "image_path": null, "instructions": null}'::jsonb,
  'W. a declined assignment carries no address, guidance, contact or image');
select is(pg_temp.scalar_as((select wendy from ids), 'aal1', format('select authz.can_read_facility_image(%L)', (select path from img))),
  'false', 'I. the image is no longer readable once the assignment is not active');

select * from finish();
rollback;
