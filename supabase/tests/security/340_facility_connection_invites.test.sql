-- =============================================================================
-- Agency-initiated facility connection & multi-agency facilities (P0-E9-4A.1)
-- I initiation · N new facility · R refusals · C connect existing (consent)
-- M multi-agency isolation & routing · L independent lifecycle · P privacy
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql

select plan(45);

create temp table extra as select
  pg_temp.create_user('owner@newclinic.test') as newowner,
  pg_temp.create_user('intruder@example.test') as intruder;
grant select on extra to authenticated;

create function pg_temp.invite(p_user uuid, p_facility uuid, p_email text) returns jsonb language sql as $$
  select pg_temp.query_as(p_user, 'aal2', format('select * from public.invite_facility_connection(%L, %L)', p_facility, p_email)) -> 0
$$;
create function pg_temp.accept_sql(p_user uuid, p_token text, p_mode text, p_org uuid default null, p_aal text default 'aal1')
returns text language sql as $$
  select pg_temp.as_sql(p_user, format('select * from public.accept_facility_connection_invite(%L, %L, %L)', p_token, p_mode, p_org), p_aal)
$$;
create function pg_temp.preview(p_user uuid, p_token text) returns jsonb language sql as $$
  select pg_temp.query_as(p_user, 'aal1', format('select public.preview_facility_connection_invite(%L) as p', p_token)) -> 0 -> 'p'
$$;

-- ---------------------------------------------------------------------------
-- I. Initiation: the agency's relationship.manage at AAL2, its own records only
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select sam from ids),
    format('select * from public.invite_facility_connection(%L, ''a@b.test'')', (select riverside from f)), 'aal2'),
  'CH403', null, 'I. a scheduler cannot invite a facility');
select throws_ok(pg_temp.as_sql((select alice from ids),
    format('select * from public.invite_facility_connection(%L, ''a@b.test'')', (select riverside from f)), 'aal1'),
  'CH402', null, 'I. an agency admin at AAL1 must step up');
select throws_ok(pg_temp.as_sql((select bob from ids),
    format('select * from public.invite_facility_connection(%L, ''a@b.test'')', (select riverside from f)), 'aal2'),
  'CH403', null, 'I. another agency cannot invite for Alpha''s record');
select throws_ok(pg_temp.as_sql((select alice from ids),
    format('select * from public.invite_facility_connection(%L, ''not-an-email'')', (select riverside from f)), 'aal2'),
  'CH400', null, 'I. an invalid email is refused');
select throws_ok(pg_temp.as_sql((select alice from ids),
    format('select * from public.invite_facility_connection(%L, ''x@mercy.test'')', (select mercy from f)), 'aal2'),
  'CHF09', null, 'I. an already-connected record cannot be invited again (no re-pointing)');

create temp table inv as select pg_temp.invite((select alice from ids), (select riverside from f), ' Owner@NewClinic.test ') as new_facility;
grant select on inv to authenticated;
select ok((select new_facility ->> 'invite_token' from inv) ~ '^[A-Za-z0-9_-]{43}$', 'I. the agency receives a token for the email link');
select throws_ok(pg_temp.as_sql((select alice from ids),
    format('select * from public.invite_facility_connection(%L, ''other@clinic.test'')', (select riverside from f)), 'aal2'),
  'CH409', null, 'I. one pending invitation per facility record');
select is((pg_temp.query_as((select alice from ids), 'aal2',
    format('select * from public.list_facility_connection_invites(%L)', (select riverside from f))) -> 0 ->> 'masked_email'),
  'o•••@newclinic.test', 'I. the agency sees a masked, normalised email');
select throws_ok(pg_temp.as_sql((select alice from ids), 'select * from public.facility_connection_invites', 'aal2'),
  '42501', null, 'I. no direct table access (RPC only)');
select ok(not exists (select 1 from public.facility_connection_invites
                      where token_hash = convert_to((select new_facility ->> 'invite_token' from inv), 'UTF8')),
  'I. the raw token is never stored');

-- ---------------------------------------------------------------------------
-- N. New facility: created only on valid acceptance; the acceptor is the owner
-- ---------------------------------------------------------------------------
select ok(coalesce(pg_temp.preview((select intruder from extra), (select new_facility ->> 'invite_token' from inv)), 'null'::jsonb) = 'null'::jsonb,
  'N. a different signed-in account sees nothing (email bound)');
select throws_ok(pg_temp.accept_sql((select intruder from extra), (select new_facility ->> 'invite_token' from inv), 'create'),
  'CH404', null, 'N. … and cannot accept');
select is((select count(*)::int from public.organisations where name = 'Riverside'), 0,
  'N. no facility organisation exists before acceptance');
select is(pg_temp.preview((select newowner from extra), (select new_facility ->> 'invite_token' from inv)) ->> 'agency_name',
  'Alpha Agency', 'N. the invited person sees the inviting agency');
select is(jsonb_array_length(pg_temp.preview((select newowner from extra), (select new_facility ->> 'invite_token' from inv)) -> 'options'),
  0, 'N. a new person administers no facility yet (create path)');
create temp table acc as select pg_temp.query_as((select newowner from extra), 'aal1', format(
  'select * from public.accept_facility_connection_invite(%L, ''create'')', (select new_facility ->> 'invite_token' from inv))) -> 0 as r;
grant select on acc to authenticated;
select is((select r ->> 'created' from acc), 'true', 'N. accepted: a new facility organisation');
select is((select o.type::text || ':' || o.name from public.organisations o where o.id = (select (r ->> 'facility_organisation_id')::uuid from acc)),
  'facility:Riverside', 'N. … named from the agency''s record');
select is((select string_agg(mr.role_key, ',') from public.membership_roles mr
           join public.organisation_memberships m on m.id = mr.membership_id
           where m.profile_id = (select newowner from extra)
             and m.organisation_id = (select (r ->> 'facility_organisation_id')::uuid from acc)),
  'facility.admin', 'N. the acceptor is the facility admin (owner)');
select is((select linked_facility_organisation_id from public.agency_facilities where id = (select riverside from f)),
  (select (r ->> 'facility_organisation_id')::uuid from acc), 'N. Alpha''s record is linked');
select is((select status::text from public.agency_facility_relationships where id = (select (r ->> 'relationship_id')::uuid from acc)),
  'active', 'N. the relationship is active');
select throws_ok(pg_temp.accept_sql((select newowner from extra), (select new_facility ->> 'invite_token' from inv), 'create'),
  'CH404', null, 'R. a used invitation cannot be replayed');

-- ---------------------------------------------------------------------------
-- R. Revoked and expired invitations
-- ---------------------------------------------------------------------------
create temp table harbor as select pg_temp.scalar_as((select alice from ids), 'aal2', format(
  'select public.create_agency_facility(%L, ''Harbor'', ''hospital'', ''UTC'')', (select alpha from orgs)))::uuid as id;
grant select on harbor to authenticated;
create temp table inv2 as select pg_temp.invite((select alice from ids), (select id from harbor), 'owner@newclinic.test') as i;
grant select on inv2 to authenticated;
select pg_temp.exec_as((select alice from ids), 'aal2', format('select public.revoke_facility_connection_invite(%L)', (select (i ->> 'invite_id')::uuid from inv2)));
select throws_ok(pg_temp.accept_sql((select newowner from extra), (select i ->> 'invite_token' from inv2), 'create'),
  'CH404', null, 'R. a revoked invitation is refused');
create temp table inv3 as select pg_temp.invite((select alice from ids), (select id from harbor), 'owner@newclinic.test') as i;
grant select on inv3 to authenticated;
update public.facility_connection_invites set expires_at = now() - interval '1 minute'
where id = (select (i ->> 'invite_id')::uuid from inv3);
select throws_ok(pg_temp.accept_sql((select newowner from extra), (select i ->> 'invite_token' from inv3), 'create'),
  'CH404', null, 'R. an expired invitation is refused');

-- ---------------------------------------------------------------------------
-- C. Connect an EXISTING facility: only its administrator may consent
-- ---------------------------------------------------------------------------
create temp table bg as select pg_temp.scalar_as((select bob from ids), 'aal2', format(
  'select public.create_agency_facility(%L, ''Gamma (Beta record)'', ''hospital'', ''UTC'')', (select beta from orgs)))::uuid as rec;
grant select on bg to authenticated;
create temp table invf as select pg_temp.invite((select bob from ids), (select rec from bg), 'fred@example.test') as i;
grant select on invf to authenticated;
select is(pg_temp.preview((select fred from ids), (select i ->> 'invite_token' from invf)) -> 'options' -> 0 ->> 'can_approve',
  'false', 'C. a facility supervisor sees their facility but cannot approve');
select throws_ok(pg_temp.accept_sql((select fred from ids), (select i ->> 'invite_token' from invf), 'connect', (select gamma from orgs)),
  'CH403', null, 'C. … and cannot connect the agency');
select throws_ok(pg_temp.accept_sql((select fred from ids), (select i ->> 'invite_token' from invf), 'connect', (select delta from orgs)),
  'CH403', null, 'C. nobody can connect a facility they do not administer');
select pg_temp.exec_as((select bob from ids), 'aal2', format('select public.revoke_facility_connection_invite(%L)', (select (i ->> 'invite_id')::uuid from invf)));
create temp table invg as select pg_temp.invite((select bob from ids), (select rec from bg), 'fiona@example.test') as i;
grant select on invg to authenticated;
select is(pg_temp.preview((select fiona from ids), (select i ->> 'invite_token' from invg)) -> 'options',
  jsonb_build_array(jsonb_build_object('organisation_id', (select gamma from orgs), 'name', 'Gamma Health',
                                       'can_approve', true, 'already_connected', false)),
  'C. the facility admin sees ONLY facilities they belong to');
select throws_ok(pg_temp.accept_sql((select fiona from ids), (select i ->> 'invite_token' from invg), 'connect', (select gamma from orgs), 'aal1'),
  'CH402', null, 'C. approving for an existing facility needs AAL2');
select lives_ok(pg_temp.accept_sql((select fiona from ids), (select i ->> 'invite_token' from invg), 'connect', (select gamma from orgs), 'aal2'),
  'C. the facility admin connects Beta to the existing Gamma');
select is((select count(*)::int from public.agency_facilities where linked_facility_organisation_id = (select gamma from orgs)),
  2, 'M. one facility organisation, two agencies'' records (Alpha Mercy + Beta)');
create temp table bg2 as select pg_temp.scalar_as((select bob from ids), 'aal2', format(
  'select public.create_agency_facility(%L, ''Gamma again'', ''hospital'', ''UTC'')', (select beta from orgs)))::uuid as rec;
grant select on bg2 to authenticated;
create temp table invh as select pg_temp.invite((select bob from ids), (select rec from bg2), 'fiona@example.test') as i;
grant select on invh to authenticated;
select is(pg_temp.preview((select fiona from ids), (select i ->> 'invite_token' from invh)) -> 'options' -> 0 ->> 'already_connected',
  'true', 'C. the same agency already connected is flagged');
select throws_ok(pg_temp.accept_sql((select fiona from ids), (select i ->> 'invite_token' from invh), 'connect', (select gamma from orgs), 'aal2'),
  'CH409', null, 'C. an agency cannot connect a second record to the same facility');

-- ---------------------------------------------------------------------------
-- M. Multi-agency isolation and request routing
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select alice from ids), 'aal2',
    format('select * from public.agency_facilities where id = %L', (select rec from bg))), 0,
  'M. Alpha cannot read Beta''s record of the shared facility');
select is(pg_temp.count_as((select bob from ids), 'aal2',
    format('select * from public.agency_facilities where id = %L', (select mercy from f))), 0,
  'M. Beta cannot read Alpha''s record');
select is(pg_temp.count_as((select alice from ids), 'aal2',
    format('select * from public.agency_facility_relationships where agency_facility_id = %L', (select rec from bg))), 0,
  'M. Alpha cannot read Beta''s relationship');
select is((select string_agg(r ->> 'agency_name', ',' order by r ->> 'agency_name')
           from jsonb_array_elements(pg_temp.query_as((select fiona from ids), 'aal2',
             format('select * from public.list_partner_agency_relationships(%L)', (select gamma from orgs)))) r),
  'Alpha Agency,Beta Agency', 'M. the facility sees both agency relationships');
create temp table brel as select id from public.agency_facility_relationships where agency_facility_id = (select rec from bg) and status <> 'ended';
grant select on brel to authenticated;
create temp table bloc as select pg_temp.scalar_as((select bob from ids), 'aal2', format(
  'select public.create_facility_location(%L, ''Gamma Ward'', ''UTC'')', (select rec from bg)))::uuid as id;
grant select on bloc to authenticated;
create temp table breq as select pg_temp.scalar_as((select fiona from ids), 'aal1', format(
  'select public.submit_facility_shift_request(%L, %L, ''cna'', current_date + 5, ''07:00'', ''15:00'', 1, null, null)',
  (select id from brel), (select id from bloc)))::uuid as id;
grant select on breq to authenticated;
select is(pg_temp.count_as((select bob from ids), 'aal1', format('select * from public.shifts where id = %L', (select id from breq))), 1,
  'M. a request to Beta reaches Beta');
select is(pg_temp.count_as((select alice from ids), 'aal2', format('select * from public.shifts where id = %L', (select id from breq))), 0,
  'M. … and never Alpha');
select throws_ok(pg_temp.as_sql((select dora from ids), format(
    'select public.submit_facility_shift_request(%L, %L, ''cna'', current_date + 5, ''07:00'', ''15:00'', 1, null, null)',
    (select id from brel), (select id from bloc))),
  'CH403', null, 'M. another facility cannot route a request through Beta''s relationship');

-- ---------------------------------------------------------------------------
-- L. Independent lifecycle
-- ---------------------------------------------------------------------------
select pg_temp.exec_as((select bob from ids), 'aal2', format('select public.set_facility_relationship_status(%L, ''ended'')', (select id from brel)));
select is((select status::text from public.agency_facility_relationships where agency_facility_id = (select mercy from f) and status <> 'ended'),
  'active', 'L. ending Beta''s relationship leaves Alpha''s active');
select is((select string_agg(r ->> 'agency_name' || ':' || (r ->> 'relationship_status'), ',' order by r ->> 'agency_name')
           from jsonb_array_elements(pg_temp.query_as((select fiona from ids), 'aal2',
             format('select * from public.list_partner_agency_relationships(%L)', (select gamma from orgs)))) r),
  'Alpha Agency:active', 'L. the facility loses Beta''s ended relationship; Alpha is unaffected');
select ok(exists (select 1 from public.agency_facility_relationships where id = (select id from brel) and status = 'ended'),
  'L. … the ended relationship is kept as history');

-- ---------------------------------------------------------------------------
-- P. Privacy: audit never holds the email or token; platform sees masked data
-- ---------------------------------------------------------------------------
select ok(not exists (select 1 from public.audit_events where action like 'facility.connection%'
                      and metadata::text ~* '(@newclinic|@example|token)'),
  'P. connection audit events carry no email or token');
select ok(exists (select 1 from jsonb_array_elements(pg_temp.query_as((select erin from ids), 'aal2',
                    'select * from public.platform_list_connection_invites()')) r
                  where r ->> 'masked_email' = 'f•••@example.test'),
  'P. the platform sees connection invitations with masked emails');
select throws_ok(pg_temp.as_sql((select alice from ids), 'select * from public.platform_list_connection_invites()', 'aal2'),
  'CH403', null, 'P. … and only the platform');

select * from finish();
rollback;
