-- =============================================================================
-- Custom credential / requirement types (P0-E9-3J)
-- K create & validate · T tenant isolation · R requirements (baseline + facility)
-- E engine states · S shift eligibility · L locking · X archive · A audit
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql

select plan(44);

create function pg_temp.create_type(p_user uuid, p_org uuid, p_name text, p_doc boolean default true,
  p_expiry boolean default true, p_verify boolean default true, p_aal text default 'aal2')
returns text language sql as $$
  select pg_temp.scalar_as(p_user, p_aal, format(
    'select public.create_custom_credential_type(%L, %L, ''training'', %L, %L, %L, false)',
    p_org, p_name, p_doc, p_expiry, p_verify))
$$;
create function pg_temp.create_type_sql(p_org uuid, p_name text) returns text language sql as $$
  select format('select public.create_custom_credential_type(%L, %L, ''training'', true, true, true, false)', p_org, p_name)
$$;
create function pg_temp.visible_types(p_user uuid) returns text language sql as $$
  select coalesce(string_agg(x ->> 'name', ',' order by x ->> 'name'), '')
  from jsonb_array_elements(pg_temp.query_as(p_user, 'aal1',
    'select name from public.credential_types where owner_organisation_id is not null')) x
$$;

-- ---------------------------------------------------------------------------
-- K. Create & validate (credential.requirements.manage, AAL2)
-- ---------------------------------------------------------------------------
create temp table ct as select pg_temp.create_type((select alice from ids), (select alpha from orgs), '  Dementia Care Training  ') as dementia;
grant select on ct to authenticated;
select ok((select dementia from ct) ~ '^custom_[0-9a-f]{32}$', 'K. an agency admin creates a custom type (stable key)');
select is((select format('%s/%s/%s/%s/%s', name, category, owner_organisation_id = (select alpha from orgs), requires_document, scope)
           from public.credential_types where key = (select dementia from ct)),
  'Dementia Care Training/training/t/t/person', 'K. trimmed name, category, owner and flags are saved');
select throws_ok(pg_temp.as_sql((select alice from ids), pg_temp.create_type_sql((select alpha from orgs), '   '), 'aal2'),
  'CH400', null, 'K. a blank name is refused');
select throws_ok(pg_temp.as_sql((select alice from ids), pg_temp.create_type_sql((select alpha from orgs), repeat('x', 121)), 'aal2'),
  'CH400', null, 'K. a name over 120 characters is refused');
select throws_ok(pg_temp.as_sql((select alice from ids), pg_temp.create_type_sql((select alpha from orgs), 'dementia care TRAINING'), 'aal2'),
  'CHC01', null, 'K. an exact duplicate (case / spaces) in the same agency is refused');
select lives_ok(pg_temp.as_sql((select alice from ids), pg_temp.create_type_sql((select alpha from orgs), 'Dementia Care Training – Level 2'), 'aal2'),
  'K. a similar but distinct name is allowed');
select throws_ok(pg_temp.as_sql((select alice from ids), pg_temp.create_type_sql((select alpha from orgs), 'Fire Safety')),
  'CH402', null, 'K. AAL1 ⇒ step-up required');
select throws_ok(pg_temp.as_sql((select sam from ids), pg_temp.create_type_sql((select alpha from orgs), 'Fire Safety'), 'aal2'),
  'CH403', null, 'K. a scheduler cannot create types');
select throws_ok(pg_temp.as_sql((select wendy from ids), pg_temp.create_type_sql((select alpha from orgs), 'Fire Safety'), 'aal2'),
  'CH403', null, 'K. a worker cannot create types');
select throws_ok(pg_temp.as_sql((select bob from ids), pg_temp.create_type_sql((select alpha from orgs), 'Fire Safety'), 'aal2'),
  'CH403', null, 'K. another agency cannot create types for Alpha');
select throws_ok(pg_temp.as_sql((select fiona from ids), pg_temp.create_type_sql((select gamma from orgs), 'Fire Safety'), 'aal2'),
  'CH403', null, 'K. facility organisations do not own custom types (agency-owned first)');

-- Beta's own custom type (a different tenant).
create temp table bt as select pg_temp.create_type((select bob from ids), (select beta from orgs), 'Beta Induction') as beta_type;
grant select on bt to authenticated;

-- ---------------------------------------------------------------------------
-- T. Tenant isolation (RLS + RPCs)
-- ---------------------------------------------------------------------------
select is(pg_temp.visible_types((select alice from ids)), 'Dementia Care Training,Dementia Care Training – Level 2',
  'T. Alpha sees its custom types only');
select is(pg_temp.visible_types((select bob from ids)), 'Beta Induction', 'T. Beta never sees Alpha''s custom types');
select is(pg_temp.visible_types((select fiona from ids)), '', 'T. a facility user sees no agency custom types');
select ok((select count(*) from public.credential_types where owner_organisation_id is null) >= 11,
  'T. standard types are unchanged and still global');
select is(pg_temp.count_as((select fiona from ids), 'aal1', 'select key from public.credential_types where owner_organisation_id is null') > 0,
  true, 'T. standard types remain visible to everyone');
select throws_ok(pg_temp.as_sql((select bob from ids), format(
  'select public.create_credential_requirement(%L, %L, current_date)', (select beta from orgs), (select dementia from ct)), 'aal2'),
  'CH400', null, 'T. another agency cannot require Alpha''s custom type');
select throws_ok(pg_temp.as_sql((select walt from ids), format(
  'select * from public.create_credential(%L, null, null, null, current_date, current_date + 300)', (select beta_type from bt))),
  'CH400', null, 'T. a worker of Alpha only cannot hold Beta''s custom type');

-- ---------------------------------------------------------------------------
-- R. Requirements: agency baseline and facility-specific
-- ---------------------------------------------------------------------------
create temp table req as select pg_temp.scalar_as((select alice from ids), 'aal2', format(
  'select public.create_credential_requirement(%L, %L, current_date - 1)', (select alpha from orgs), (select dementia from ct)))::uuid as baseline;
grant select on req to authenticated;
select isnt((select baseline from req), null, 'R. a custom type is used as an agency baseline requirement');
create temp table freq as select pg_temp.scalar_as((select alice from ids), 'aal2', format(
  'select public.create_credential_requirement(%L, %L, current_date - 1, %L)', (select alpha from orgs),
  (select key from public.credential_types where name = 'Dementia Care Training – Level 2'), (select riverside from f)))::uuid as facility_req;
grant select on freq to authenticated;
select isnt((select facility_req from freq), null, 'R. … and as a facility-specific requirement');

-- ---------------------------------------------------------------------------
-- E. Engine: the same states as a standard requirement
-- ---------------------------------------------------------------------------
select is(pg_temp.reasons((select alice from ids), (select wendy from w)) ->> (select dementia from ct), 'MISSING_CREDENTIAL',
  'E. missing ⇒ MISSING_CREDENTIAL');
select is(pg_temp.readiness((select alice from ids), (select wendy from w)), 'not_eligible', 'E. … the worker is not ready');

-- S. Shift eligibility: the custom requirement blocks assignment like any other.
create temp table s as select pg_temp.shift((select sam from ids), (select mercy from f), (select mercy_main from loc), 3, '07:00', '15:00', 3) as one;
grant select on s to authenticated;
create temp table a1 as select pg_temp.assign((select sam from ids), (select one from s), (select wendy from w)) as d;
select is((select d ->> 'outcome' from a1), 'refused', 'S. a missing custom requirement blocks assignment');

-- The worker records evidence through the existing pipeline (document + scan + submit + share).
create temp table ev1 as select pg_temp.evidence((select wendy from ids), (select dementia from ct), null, null,
  current_date - 10, current_date + 400) as v;
grant select on ev1 to authenticated;
select is(pg_temp.reasons((select alice from ids), (select wendy from w)) ->> (select dementia from ct), 'CREDENTIAL_NOT_SHARED',
  'E. evidence not yet shared ⇒ not counted');
select pg_temp.share_credential((select wendy from ids), ((select v from ev1) ->> 'credential_id')::uuid, (select alpha from orgs));
select is(pg_temp.reasons((select alice from ids), (select wendy from w)) ->> (select dementia from ct), 'UNVERIFIED_CREDENTIAL',
  'E. submitted but not verified ⇒ needs review');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select public.share_credential(%L, %L)',
  ((select v from ev1) ->> 'credential_id')::uuid, (select beta from orgs))),
  'CH403', null, 'T. a custom-typed credential cannot be shared with another agency');
select pg_temp.verify((select alice from ids), ((select v from ev1) ->> 'credential_version_id')::uuid, (select alpha from orgs));
select is(pg_temp.reasons((select alice from ids), (select wendy from w)) ->> (select dementia from ct), 'MET',
  'E. verified and valid ⇒ MET (up to date)');
select is(pg_temp.reasons((select alice from ids), (select wendy from w), null, current_date + 380) ->> (select dementia from ct),
  'EXPIRING_SOON', 'E. within the warning window ⇒ EXPIRING_SOON');
select is(pg_temp.reasons((select alice from ids), (select wendy from w), null, current_date + 401) ->> (select dementia from ct),
  'EXPIRED_CREDENTIAL', 'E. after its expiry ⇒ EXPIRED_CREDENTIAL');
create temp table a2 as select pg_temp.assign((select sam from ids), (select one from s), (select wendy from w)) as d;
select is((select (d ->> 'outcome') || ':' || coalesce(d ->> 'block_reasons', '') from a2), 'allowed:[]', 'S. the verified custom credential clears the blocker');

-- Verification required: an unscanned document is never verified (pipeline unchanged).
create temp table ev3 as select pg_temp.new_credential((select wendy from ids), (select dementia from ct), null, null,
  current_date, current_date + 500) as v;
grant select on ev3 to authenticated;
select pg_temp.upload_document((select wendy from ids), ((select v from ev3) ->> 'credential_version_id')::uuid);
select pg_temp.submit((select wendy from ids), ((select v from ev3) ->> 'credential_version_id')::uuid);
select pg_temp.share_credential((select wendy from ids), ((select v from ev3) ->> 'credential_id')::uuid, (select alpha from orgs));
select throws_ok(pg_temp.as_sql((select alice from ids), format('select public.record_credential_verification(%L, %L, ''verified'')',
  ((select v from ev3) ->> 'credential_version_id')::uuid, (select alpha from orgs)), 'aal2'),
  'CH409', null, 'E. a document not yet cleared by the scanner cannot be verified (scanner path unchanged)');

-- ---------------------------------------------------------------------------
-- L. Editing: name / instructions always; evidence rules locked once used
-- ---------------------------------------------------------------------------
select lives_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.update_custom_credential_type(%L, ''Dementia Care Training (annual)'', ''training'', true, true, true, false, ''none'', null, ''Bring your certificate.'')',
  (select dementia from ct)), 'aal2'), 'L. a used type can be renamed and get instructions');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.update_custom_credential_type(%L, ''Dementia Care Training (annual)'', ''training'', false, true, true, false)',
  (select dementia from ct)), 'aal2'), 'CHC02', null, 'L. a used type''s evidence rules are locked');
create temp table unused as select pg_temp.create_type((select alice from ids), (select alpha from orgs), 'Manual Handling') as k;
grant select on unused to authenticated;
select lives_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.update_custom_credential_type(%L, ''Manual Handling'', ''competency'', false, false, true, false)', (select k from unused)), 'aal2'),
  'L. an unused type can change its evidence rules');
select is((select format('%s/%s/%s', requires_document, requires_expiry_date, category) from public.credential_types where key = (select k from unused)),
  'f/f/competency', 'L. … saved (no-evidence, no-expiry type: verified by the agency)');
select throws_ok(pg_temp.as_sql((select bob from ids), format(
  'select public.update_custom_credential_type(%L, ''Hijack'', ''training'', true, true, true, false)', (select dementia from ct)), 'aal2'),
  'CH403', null, 'T. another agency cannot edit Alpha''s type');

-- ---------------------------------------------------------------------------
-- X. Archive: refused while an active requirement uses it; history stays valid
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select alice from ids), format('select public.set_custom_credential_type_active(%L, false)', (select dementia from ct)), 'aal2'),
  'CHC02', null, 'X. a type used by an active requirement cannot be archived');
select pg_temp.exec_as((select alice from ids), 'aal2', format(
  'select public.update_credential_requirement(%L, true, 0, 30, ''inactive'', current_date)', (select baseline from req)));
select lives_ok(pg_temp.as_sql((select alice from ids), format('select public.set_custom_credential_type_active(%L, false)', (select dementia from ct)), 'aal2'),
  'X. after deactivating its requirement it is archived');
select throws_ok(pg_temp.as_sql((select alice from ids), format(
  'select public.create_credential_requirement(%L, %L, current_date)', (select alpha from orgs), (select dementia from ct)), 'aal2'),
  'CH400', null, 'X. an archived type cannot be selected for a new requirement');
select is(pg_temp.count_as((select wendy from ids), 'aal1', format(
  'select c.id, t.name from public.credentials c join public.credential_types t on t.key = c.credential_type_key where t.key = %L',
  (select dementia from ct))), 2, 'X. the worker''s historical credentials still render with the archived type''s name');
select is((select count(*)::int from public.credential_types where key = (select dementia from ct)), 1, 'X. never deleted');
select lives_ok(pg_temp.as_sql((select alice from ids), format('select public.set_custom_credential_type_active(%L, true)', (select dementia from ct)), 'aal2'),
  'X. an archived type can be restored');

-- ---------------------------------------------------------------------------
-- A. Audit (ids, category, changed fields — no evidence)
-- ---------------------------------------------------------------------------
select is((select string_agg(action, ',' order by action) from (
            select distinct action from public.audit_events
            where organisation_id = (select alpha from orgs) and action like 'credential_type.custom_%') x),
  'credential_type.custom_archived,credential_type.custom_created,credential_type.custom_restored,credential_type.custom_updated',
  'A. created / updated / archived / restored are audited');
select is((select metadata -> 'changes' from public.audit_events
           where action = 'credential_type.custom_updated' and metadata ->> 'type_key' = (select dementia from ct)),
  '["name", "instructions"]'::jsonb, 'A. updates record which fields changed');

select * from finish();
rollback;
