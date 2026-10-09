-- =============================================================================
-- G. No unauthorized invite acceptance · H. Invite token privacy
-- Issue · ceiling · rotation · expiry · single use · stale issuer authority
-- Throttling · uniform invalid responses · payload manipulation
-- =============================================================================
begin;
\ir _helpers.psql

select plan(60);

create temp table ids as
select
  pg_temp.create_user('alice@example.test') as alice,          -- Alpha admin
  pg_temp.create_user('rita@example.test')  as rita,           -- Alpha recruiter
  pg_temp.create_user('bob@example.test')   as bob,            -- Beta admin
  pg_temp.create_user('ivy@example.test')   as ivy,            -- invitee
  pg_temp.create_user('eve@example.test')   as eve,            -- attacker holding ivy's token
  pg_temp.create_user('ray@example.test')   as ray,            -- rotation invitee
  pg_temp.create_user('sam@example.test')   as sam,            -- stale-issuer invitee
  pg_temp.create_user('uma@example.test', false) as uma,       -- unverified invitee
  pg_temp.create_user('fay@example.test')   as fay;            -- throttling
grant select on ids to authenticated;

create temp table orgs as
select
  pg_temp.create_org_as((select alice from ids), 'Alpha Agency', 'alpha-agency') as alpha,
  pg_temp.create_org_as((select bob from ids),   'Beta Agency',  'beta-agency')  as beta;
grant select on orgs to authenticated;
select pg_temp.add_member((select alpha from orgs), (select rita from ids), 'agency.recruiter');

create function pg_temp.invite(p_user uuid, p_aal text, p_org uuid, p_email text, p_role text)
returns jsonb language sql as $$
  select pg_temp.query_as(p_user, p_aal,
    format('select * from public.create_organisation_invite(%L, %L, %L)', p_org, p_email, p_role)) -> 0
$$;
create function pg_temp.preview(p_user uuid, p_token text) returns jsonb language sql as $$
  select pg_temp.query_as(p_user, 'aal1', format('select * from public.preview_organisation_invite(%L)', p_token))
$$;
create function pg_temp.accept(p_user uuid, p_token text) returns jsonb language sql as $$
  select pg_temp.query_as(p_user, 'aal1', format('select * from public.accept_organisation_invite(%L)', p_token))
$$;

-- ---------------------------------------------------------------------------
-- Token privacy
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.organisation_invites', 'select'),
  'authenticated users have no direct access to the invites table');
select ok(not has_table_privilege('anon', 'public.organisation_invites', 'select'),
  'anonymous users have no access to the invites table');
select hasnt_column('public', 'organisation_invites', 'token', 'the raw token is never stored');

-- ---------------------------------------------------------------------------
-- Issue
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ select pg_temp.invite(%L, 'aal1', %L, 'ivy@example.test', 'agency.healthcare_worker') $$,
    (select alice from ids), (select alpha from orgs)),
  'CH402', null, 'inviting at AAL1 requires step-up');

create temp table t as
select pg_temp.invite((select alice from ids), 'aal2', (select alpha from orgs), '  IVY@Example.test ', 'agency.healthcare_worker') as ivy;

select is(length((select ivy ->> 'invite_token' from t)), 43, 'the token is 256-bit base64url (43 chars)');
select is(
  (select token_hash from public.organisation_invites where id = (select (ivy ->> 'invite_id')::uuid from t)),
  sha256(convert_to((select ivy ->> 'invite_token' from t), 'UTF8')),
  'only the SHA-256 of the token is stored');
select is(
  (select email from public.organisation_invites where id = (select (ivy ->> 'invite_id')::uuid from t)),
  'ivy@example.test', 'the invited email is normalised');

select throws_ok(
  format($$ select pg_temp.invite(%L, 'aal2', %L, 'x@example.test', 'agency.admin') $$,
    (select rita from ids), (select alpha from orgs)),
  'CH403', null, 'capability ceiling: a recruiter cannot invite an admin');
select lives_ok(
  format($$ select pg_temp.invite(%L, 'aal2', %L, 'worker2@example.test', 'agency.healthcare_worker') $$,
    (select rita from ids), (select alpha from orgs)),
  'a recruiter can invite within their ceiling');
select throws_ok(
  format($$ select pg_temp.invite(%L, 'aal2', %L, 'x@example.test', 'agency.healthcare_worker') $$,
    (select bob from ids), (select alpha from orgs)),
  'CH403', null, 'cross-tenant: another organisation''s admin cannot invite');
select throws_ok(
  format($$ select pg_temp.invite(%L, 'aal2', %L, 'x@example.test', 'facility.admin') $$,
    (select alice from ids), (select alpha from orgs)),
  'CH400', null, 'a role of another organisation type cannot be offered');
select throws_ok(
  format($$ select pg_temp.invite(%L, 'aal2', %L, 'ivy@example.test', 'agency.scheduler') $$,
    (select alice from ids), (select alpha from orgs)),
  'CHI09', null, 'one pending invitation per person per organisation: a different role is refused, not added');
select throws_ok(
  format($$ select pg_temp.invite(%L, 'aal2', %L, 'rita@example.test', 'agency.scheduler') $$,
    (select alice from ids), (select alpha from orgs)),
  'CHI10', null, 'existing members cannot be invited again (specific error)');
select throws_ok(
  format($$ select pg_temp.invite(%L, 'aal2', %L, 'not-an-email', 'agency.scheduler') $$,
    (select alice from ids), (select alpha from orgs)),
  '23514', null, 'invalid email addresses are rejected');

-- ---------------------------------------------------------------------------
-- Redemption: uniform invalid responses, email binding
-- ---------------------------------------------------------------------------
select is(pg_temp.preview((select ivy from ids), 'A' || repeat('b', 42)), '[]'::jsonb,
  'an unknown token yields an empty result');
select is(pg_temp.preview((select ivy from ids), 'short'), '[]'::jsonb,
  'a malformed token yields the same empty result');
select is(pg_temp.preview((select eve from ids), (select ivy ->> 'invite_token' from t)), '[]'::jsonb,
  'a valid token presented by a different identity yields the same empty result');
select is(pg_temp.accept((select eve from ids), (select ivy ->> 'invite_token' from t)), '[]'::jsonb,
  'a different identity cannot accept the invitation');
select is(
  (select count(*)::int from public.audit_events
    where action = 'invite.acceptance_failed' and actor_profile_id = (select eve from ids)),
  1, 'failed acceptance attempts are audited');

select is(pg_temp.preview((select ivy from ids), (select ivy ->> 'invite_token' from t)) -> 0 ->> 'role_key',
  'agency.healthcare_worker', 'the invitee can preview organisation and server-defined role');
select is(pg_temp.preview((select ivy from ids), (select ivy ->> 'invite_token' from t)) -> 0 ? 'email',
  false, 'the preview discloses no email address');

select is(pg_temp.accept((select ivy from ids), (select ivy ->> 'invite_token' from t)) -> 0 ->> 'organisation_id',
  (select alpha from orgs)::text, 'the invitee accepts and joins the issuing organisation');
select is(
  (select array_agg(mr.role_key) from public.membership_roles mr
    where mr.membership_id = pg_temp.membership_of((select alpha from orgs), (select ivy from ids))
      and mr.revoked_at is null),
  array['agency.healthcare_worker'], 'the membership receives exactly the invited role');
select is(pg_temp.accept((select ivy from ids), (select ivy ->> 'invite_token' from t)), '[]'::jsonb,
  'an accepted invitation cannot be replayed');
select is(
  (select count(*)::int from public.audit_events
    where action = 'invite.accepted' and actor_profile_id = (select ivy from ids)
      and organisation_id = (select alpha from orgs)),
  1, 'acceptance is audited');

-- Unverified email
create temp table u as
select pg_temp.invite((select alice from ids), 'aal2', (select alpha from orgs), 'uma@example.test', 'agency.healthcare_worker') as inv;
select is(pg_temp.accept((select uma from ids), (select inv ->> 'invite_token' from u)), '[]'::jsonb,
  'an unverified email address cannot accept');

-- ---------------------------------------------------------------------------
-- Rotation, revocation, expiry
-- ---------------------------------------------------------------------------
create temp table r as
select pg_temp.invite((select alice from ids), 'aal2', (select alpha from orgs), 'ray@example.test', 'agency.scheduler') as first;
alter table r add column second jsonb;
update r set second = pg_temp.query_as((select alice from ids), 'aal2',
  format('select * from public.resend_organisation_invite(%L)', (select (first ->> 'invite_id')::uuid from r))) -> 0;

select isnt((select second ->> 'invite_token' from r), (select first ->> 'invite_token' from r),
  'resend issues a new token');
select is(pg_temp.preview((select ray from ids), (select first ->> 'invite_token' from r)), '[]'::jsonb,
  'the previous token stops working after resend');
select is(jsonb_array_length(pg_temp.preview((select ray from ids), (select second ->> 'invite_token' from r))), 1,
  'the rotated token works');

update public.organisation_invites set expires_at = now() - interval '1 minute'
 where id = (select (first ->> 'invite_id')::uuid from r);
select is(pg_temp.preview((select ray from ids), (select second ->> 'invite_token' from r)), '[]'::jsonb,
  'an expired invitation yields the same empty result');

select lives_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', format('select public.revoke_organisation_invite(%%L)', %L)) $$,
    (select alice from ids), (select (inv ->> 'invite_id') from u)),
  'an administrator can revoke a pending invitation');
select is(
  (select status::text from public.organisation_invites where id = (select (inv ->> 'invite_id')::uuid from u)),
  'revoked', 'the invitation is revoked');

-- ---------------------------------------------------------------------------
-- Stale issuer authority
-- ---------------------------------------------------------------------------
create temp table s as
select pg_temp.invite((select rita from ids), 'aal2', (select alpha from orgs), 'sam@example.test', 'agency.healthcare_worker') as inv;
select pg_temp.exec_as((select alice from ids), 'aal2',
  format('select public.set_membership_status(%L, ''suspended'')',
    pg_temp.membership_of((select alpha from orgs), (select rita from ids))));
select is(pg_temp.accept((select sam from ids), (select inv ->> 'invite_token' from s)), '[]'::jsonb,
  'an invitation dies with its issuer''s authority');

-- ---------------------------------------------------------------------------
-- Throttling and manipulation
-- ---------------------------------------------------------------------------
select pg_temp.preview((select fay from ids), 'A' || repeat('x', 42));
select is(
  (select hits from internal.rate_limit_counters where bucket = 'invite.redeem:' || (select fay from ids)),
  1, 'failed redemption attempts are counted (the counter commits)');
update internal.rate_limit_counters set hits = 20 where bucket = 'invite.redeem:' || (select fay from ids);
select throws_ok(
  format($$ select pg_temp.preview(%L, 'anything') $$, (select fay from ids)),
  'CH429', null, 'redemption attempts are throttled per identity');

select is(
  (select pronargs::int from pg_proc where oid = 'public.accept_organisation_invite(text)'::regprocedure),
  1, 'acceptance takes only the token: organisation and role cannot be supplied by the client');
select throws_ok(
  $$ select pg_temp.query_as(null, null, 'select * from public.accept_organisation_invite(''x'')') $$,
  '42501', null, 'anonymous users cannot redeem invitations');

-- ---------------------------------------------------------------------------
-- Re-invite while pending (Workforce conflict fix): the same email + role is
-- re-issued through rotation, never duplicated.
-- ---------------------------------------------------------------------------
create temp table re as
select pg_temp.create_user('rhea@example.test') as rhea,
       pg_temp.create_user('vic@example.test')  as vic;
grant select on re to authenticated;
create temp table ri as
select pg_temp.invite((select alice from ids), 'aal2', (select alpha from orgs), 'rhea@example.test', 'agency.healthcare_worker') as first;
grant select on ri to authenticated;
select is((select (first ->> 'invite_reissued')::boolean from ri), false, 'a first invitation is created (not re-issued)');

alter table ri add column second jsonb;
update ri set second = pg_temp.invite((select alice from ids), 'aal2', (select alpha from orgs), ' RHEA@example.test ', 'agency.healthcare_worker');
select is((select (second ->> 'invite_reissued')::boolean from ri), true,
  'inviting the same email + role while pending re-issues the existing invitation');
select is((select second ->> 'invite_id' from ri), (select first ->> 'invite_id' from ri),
  'the same invitation is re-issued (no second invitation)');
select is((select count(*)::int from public.organisation_invites
            where organisation_id = (select alpha from orgs) and email = 'rhea@example.test'),
  1, 'exactly one invitation row exists for the person');
select is((select send_count from public.organisation_invites where id = (select (first ->> 'invite_id')::uuid from ri)), 2,
  're-issue counts as a send (resend cap applies)');
select isnt((select second ->> 'invite_token' from ri), (select first ->> 'invite_token' from ri), 're-issue rotates the token');
select is((select count(*)::int from public.audit_events
            where action = 'invite.resent' and target_id = (select (first ->> 'invite_id')::uuid from ri)
              and metadata ->> 'via' = 'reinvite'),
  1, 'the re-issue is audited as a resend');
select is(pg_temp.preview((select rhea from re), (select first ->> 'invite_token' from ri)), '[]'::jsonb,
  'the old token no longer works');
select is(jsonb_array_length(pg_temp.accept((select rhea from re), (select second ->> 'invite_token' from ri))), 1,
  'the new token works for the bound email');
select throws_ok(
  format($$ select pg_temp.invite(%L, 'aal2', %L, 'rhea@example.test', 'agency.healthcare_worker') $$,
    (select alice from ids), (select alpha from orgs)),
  'CHI10', null, 'an accepted invitation cannot be re-created: the person is now a member');

-- Expired but never accepted (status stays pending): re-issue gives a fresh expiry.
create temp table ve as
select pg_temp.invite((select alice from ids), 'aal2', (select alpha from orgs), 'vic@example.test', 'agency.healthcare_worker') as first;
grant select on ve to authenticated;
update public.organisation_invites set expires_at = now() - interval '1 day'
 where id = (select (first ->> 'invite_id')::uuid from ve);
alter table ve add column second jsonb;
update ve set second = pg_temp.invite((select alice from ids), 'aal2', (select alpha from orgs), 'vic@example.test', 'agency.healthcare_worker');
select ok((select (second ->> 'invite_reissued')::boolean and (second ->> 'invite_expires_at')::timestamptz > now() + interval '6 days' from ve),
  'an expired pending invitation is re-issued with a fresh 7-day expiry');

-- Revoked: a new invitation is created (not re-issued).
select pg_temp.exec_as((select alice from ids), 'aal2',
  format('select public.revoke_organisation_invite(%L)', (select second ->> 'invite_id' from ve)));
select is(pg_temp.preview((select vic from re), (select second ->> 'invite_token' from ve)), '[]'::jsonb,
  'a revoked invitation''s token does not work');
select is((select (pg_temp.invite((select alice from ids), 'aal2', (select alpha from orgs), 'vic@example.test', 'agency.healthcare_worker') ->> 'invite_reissued')::boolean),
  false, 'after revocation a new invitation is created');

-- Resend cap still bounds re-issues.
update public.organisation_invites set send_count = 5
 where organisation_id = (select alpha from orgs) and email = 'vic@example.test' and status = 'pending';
select throws_ok(
  format($$ select pg_temp.invite(%L, 'aal2', %L, 'vic@example.test', 'agency.healthcare_worker') $$,
    (select alice from ids), (select alpha from orgs)),
  'CH429', null, 'the resend cap also limits re-issues');

-- Another agency's pending invitation for the same email is independent.
select is((select (pg_temp.invite((select bob from ids), 'aal2', (select beta from orgs), 'vic@example.test', 'agency.healthcare_worker') ->> 'invite_reissued')::boolean),
  false, 'tenant isolation: another agency creates its own invitation');

-- ---------------------------------------------------------------------------
-- Workforce Pending Invitations surface (P0-E9-3A): list / resend / cancel
-- authority and projection.
-- ---------------------------------------------------------------------------
select ok(pg_get_function_result('public.list_organisation_invites(uuid)'::regprocedure) !~ '(token|hash)',
  'the invitation list never returns a token or hash column');
select throws_ok(
  format($$ select pg_temp.query_as(%L, 'aal2', format('select * from public.list_organisation_invites(%%L)', %L)) $$,
    (select bob from ids), (select alpha from orgs)),
  'CH403', null, 'another agency cannot list Alpha''s invitations');
select throws_ok(
  format($$ select pg_temp.query_as(%L, 'aal1', format('select * from public.list_organisation_invites(%%L)', %L)) $$,
    (select rhea from re), (select alpha from orgs)),
  'CH403', null, 'a healthcare worker cannot list the agency''s invitations');
create temp table fac as
select pg_temp.create_facility_org('Gamma Hospital', 'gamma-hospital-inv') as gamma,
       pg_temp.create_user('gail@example.test') as gail;
grant select on fac to authenticated;
select pg_temp.add_member((select gamma from fac), (select gail from fac), 'facility.admin');
select throws_ok(
  format($$ select pg_temp.query_as(%L, 'aal2', format('select * from public.list_organisation_invites(%%L)', %L)) $$,
    (select gail from fac), (select alpha from orgs)),
  'CH403', null, 'a facility user cannot list an agency''s invitations');
create temp table pend as
select pg_temp.invite((select alice from ids), 'aal2', (select alpha from orgs), 'pat@example.test', 'agency.healthcare_worker') as p;
grant select on pend to authenticated;
select throws_ok(
  format($$ select pg_temp.query_as(%L, 'aal1', format('select * from public.resend_organisation_invite(%%L)', %L)) $$,
    (select rhea from re), (select p ->> 'invite_id' from pend)),
  'CH403', null, 'a healthcare worker cannot resend an invitation');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', format('select public.revoke_organisation_invite(%%L)', %L)) $$,
    (select bob from ids), (select p ->> 'invite_id' from pend)),
  'CH403', null, 'another agency cannot cancel an invitation');
select is((select count(*)::int from public.agency_workers
            where agency_organisation_id = (select alpha from orgs) and profile_id = (select rhea from re)),
  1, 'acceptance created exactly one agency worker record');
select is((select e ->> 'invite_status' from jsonb_array_elements(pg_temp.query_as((select alice from ids), 'aal2',
            format('select * from public.list_organisation_invites(%L)', (select alpha from orgs)))) e
            where e ->> 'invitee_email' = 'rhea@example.test'),
  'accepted', 'an accepted invitation is no longer pending in the list');

select * from finish();
rollback;
