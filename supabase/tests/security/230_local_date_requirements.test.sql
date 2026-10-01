-- =============================================================================
-- Local-date credential requirement effectiveness (P0-E7-S1A)
-- A New York / B Chicago: after midnight UTC, before local midnight ⇒ the local
-- (previous) date · C effective on the facility-local date · D not before ·
-- E exactly from effective_from · F existing dates untouched · G no implicit
-- date (agency-wide or facility) · H cross-tenant facility refused ·
-- I eligibility uses the shift's LOCAL date, never its UTC date · J writes and
-- authorization intact. All instants and dates are fixed (no wall clock).
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql

select plan(25);

-- ---------------------------------------------------------------------------
-- A / B. Local date at a fixed instant after midnight UTC
-- ---------------------------------------------------------------------------
select is(internal.local_date_at('America/New_York', '2030-03-12 02:30:00+00'), date '2030-03-11',
  'A. 02:30 UTC on Mar 12 is still Mar 11 in New York');
select is(internal.local_date_at('America/Chicago', '2030-03-12 04:30:00+00'), date '2030-03-11',
  'B. 04:30 UTC on Mar 12 is still Mar 11 in Chicago');
select is(internal.local_date_at('America/Chicago', '2030-03-12 05:30:00+00'), date '2030-03-12',
  'B. …and Mar 12 once local midnight has passed');
select is(internal.compliance_as_of(null, (select riverside from f)),
  internal.local_date_at('America/Chicago', now()), 'readiness "today" for a facility is its local date');
select is(internal.compliance_as_of(date '2030-01-05', (select riverside from f)), date '2030-01-05',
  'an explicit evaluation date always wins');

-- ---------------------------------------------------------------------------
-- G / J. The trusted boundary requires an explicit date
-- ---------------------------------------------------------------------------
select is((select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'credential_requirements' and column_name = 'effective_from'),
  null, 'G. effective_from has no implicit (UTC) default');
select throws_ok(format($$ insert into public.credential_requirements (agency_organisation_id, credential_type_key)
  values (%L, 'tb_screening') $$, (select alpha from orgs)),
  '23502', null, 'G. even the owner cannot create a requirement without a date');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.create_credential_requirement(p_agency_organisation_id => %L, p_credential_type_key => ''tb_screening'')', (select alpha from orgs)), 'aal2'),
  '42883', null, 'G. the API has no form without an effective date');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.create_credential_requirement(%L, ''tb_screening'', null)', (select alpha from orgs)), 'aal2'),
  'CH400', null, 'G. an agency-wide requirement cannot fall back to the UTC date');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.create_credential_requirement(%L, ''tb_screening'', ''2030-02-30'')', (select alpha from orgs)), 'aal2'),
  '22008', null, 'J. a malformed date is refused');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.create_credential_requirement(%L, ''tb_screening'', ''1899-01-01'')', (select alpha from orgs)), 'aal2'),
  'CH400', null, 'J. an implausible date is refused');
select throws_ok(pg_temp.as_sql((select sam from ids), format(
  'select public.create_credential_requirement(%L, ''tb_screening'', ''2030-03-11'')', (select alpha from orgs))),
  'CH403', null, 'J. authorization is unchanged (scheduler refused)');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'insert into public.credential_requirements (agency_organisation_id, credential_type_key, effective_from) values (%L, ''tb_screening'', ''2030-03-11'')',
  (select alpha from orgs)), 'aal2'),
  '42501', null, 'J. no direct writes');

-- ---------------------------------------------------------------------------
-- H. Cross-tenant facility (and so its timezone) cannot be used
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.create_credential_requirement(%L, ''facility_orientation'', ''2030-03-11'', %L)', (select alpha from orgs), (select beta_client from f)), 'aal2'),
  'CH403', null, 'H. another agency''s facility cannot scope a requirement');
select throws_ok(pg_temp.as_sql((select bob from ids), format(
  'select public.create_credential_requirement(%L, ''facility_orientation'', ''2030-03-11'', %L)', (select alpha from orgs), (select riverside from f)), 'aal2'),
  'CH403', null, 'H. another agency cannot create requirements here');
select throws_ok(pg_temp.as_sql((select bob from ids), format(
  'select * from public.worker_readiness(%L, %L)', (select wendy_beta from w), (select riverside from f)), 'aal2'),
  'CH403', null, 'H. another agency''s facility timezone cannot be borrowed for a readiness date');

-- ---------------------------------------------------------------------------
-- C / D / E. Effective on the facility-local date, not before
-- ---------------------------------------------------------------------------
create temp table req as select pg_temp.scalar_as((select alice from ids), 'aal2', format(
  'select public.create_credential_requirement(%L, ''facility_orientation'', ''2030-03-11'', %L)',
  (select alpha from orgs), (select riverside from f)))::uuid as id;
select is((select effective_from from public.credential_requirements where id = (select id from req)), date '2030-03-11',
  'C. the stored effective date is exactly the date supplied (a DATE, no time)');
select ok(exists (select 1 from internal.evaluate_compliance((select wendy from w), (select riverside from f), date '2030-03-11') e
                  where e.requirement_id = (select id from req)),
  'C/E. the requirement applies on its effective local date');
select ok(not exists (select 1 from internal.evaluate_compliance((select wendy from w), (select riverside from f), date '2030-03-10') e
                      where e.requirement_id = (select id from req)),
  'D. …and not on the previous local date');

-- Deactivation records an explicit last day, never the UTC date.
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.update_credential_requirement(%L, true, 0, 30, ''inactive'')', (select id from req)), 'aal2'),
  'CH400', null, 'deactivation requires an explicit last day');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.update_credential_requirement(%L, true, 0, 30, ''inactive'', ''2030-03-10'')', (select id from req)), 'aal2'),
  'CH400', null, 'the last day cannot precede the effective date');

-- F. Existing dates are not rewritten by later edits.
select pg_temp.exec_as((select alice from ids), 'aal2', format(
  'select public.update_credential_requirement(%L, true, 5, 20, ''active'')', (select id from req)));
select is((select effective_from from public.credential_requirements where id = (select id from req)), date '2030-03-11',
  'F. editing a requirement never changes its effective date');

-- ---------------------------------------------------------------------------
-- I. The exact failure window: an evening shift in Chicago whose UTC date is
-- already the next day is evaluated on its LOCAL date.
-- ---------------------------------------------------------------------------
-- 20:00–23:00 America/Chicago on day D ⇒ 01:00–04:00 UTC on day D + 1.
create temp table evening as
select pg_temp.shift((select sam from ids), (select riverside from f), (select riverside_main from loc), 20, '20:00', '23:00', 1, false) as id;
select is((select (start_at at time zone 'UTC')::date - (start_at at time zone timezone)::date
           from public.shifts where id = (select id from evening)),
  1, 'I. the shift''s UTC date is the day after its local date');
create temp table d as select (start_at at time zone timezone)::date as local_day from public.shifts where id = (select id from evening);
-- A riverside orientation requirement effective from the shift's UTC date (D + 1): must NOT apply.
select pg_temp.exec_as((select alice from ids), 'aal2', format(
  'select public.update_credential_requirement(%L, true, 5, 20, ''inactive'', ''2030-03-11'')', (select id from req)));
create temp table late as select pg_temp.scalar_as((select alice from ids), 'aal2', format(
  'select public.create_credential_requirement(%L, ''facility_orientation'', %L, %L)',
  (select alpha from orgs), (select local_day + 1 from d), (select riverside from f)))::uuid as id;
select ok(not ('WORKER_NOT_ELIGIBLE' = any (array(select unnest(e.block_reasons) from internal.assignment_eligibility((select id from evening), (select wendy from w), null) e))),
  'I. a requirement effective from the UTC date does not apply to the local-day shift');
select pg_temp.exec_as((select alice from ids), 'aal2', format(
  'select public.update_credential_requirement(%L, true, 0, 30, ''inactive'', %L)', (select id from late), (select local_day + 1 from d)));
select pg_temp.exec_as((select alice from ids), 'aal2', format(
  'select public.create_credential_requirement(%L, ''facility_orientation'', %L, %L)',
  (select alpha from orgs), (select local_day from d), (select riverside from f)));
select ok('WORKER_NOT_ELIGIBLE' = any (array(select unnest(e.block_reasons) from internal.assignment_eligibility((select id from evening), (select wendy from w), null) e)),
  'I. a requirement effective from the facility-local date applies to that shift');

select * from finish();
rollback;
