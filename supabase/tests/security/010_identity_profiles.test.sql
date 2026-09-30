-- =============================================================================
-- A. Profile isolation · profile impersonation · identity-only profiles
-- =============================================================================
begin;
\ir _helpers.psql

select plan(17);

create temp table ids as
select
  pg_temp.create_user('alice@example.test') as alice,
  pg_temp.create_user('bob@example.test')   as bob,
  pg_temp.create_user('carol@example.test') as carol,
  pg_temp.create_user('dave@example.test')  as dave;
grant select on ids to authenticated, anon;

-- Profiles are created by the auth trigger, with a sanitised display name.
select is(
  (select count(*)::int from public.profiles p join ids on p.id in (ids.alice, ids.bob, ids.carol, ids.dave)),
  4, 'a profile is created for every new auth user');

select is(
  (select display_name from public.profiles where id = (select alice from ids)),
  'alice', 'display name comes from sign-up metadata');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'ctrl@example.test', '',
        jsonb_build_object('display_name', E'evil\u0007name'), now(), now());
select is(
  (select display_name from public.profiles where id = '00000000-0000-4000-8000-000000000001'),
  null, 'control characters in metadata are discarded');

-- Identity only: no role / organisation columns on profiles.
select columns_are('public', 'profiles',
  array['id', 'display_name', 'status', 'created_at', 'updated_at'],
  'profiles carry identity only (no global role, no active organisation)');

-- Isolation: with no shared organisation, a user sees only their own profile.
select is(pg_temp.count_as((select alice from ids), 'aal1', 'select id from public.profiles'),
  1, 'a user sees only their own profile');
select is(pg_temp.count_as((select alice from ids), 'aal2',
  format('select id from public.profiles where id = %L', (select dave from ids))),
  0, 'a user cannot read an unrelated profile, even at AAL2');

-- Co-member visibility is capability-based.
select pg_temp.create_org_as((select bob from ids), 'Bravo Agency', 'bravo-agency');
select pg_temp.add_member(
  (select id from public.organisations where slug = 'bravo-agency'),
  (select carol from ids), 'agency.healthcare_worker');

select is(pg_temp.count_as((select bob from ids), 'aal1',
  format('select id from public.profiles where id = %L', (select carol from ids))),
  1, 'a member with membership.view sees co-member profiles');
select is(pg_temp.count_as((select carol from ids), 'aal1',
  format('select id from public.profiles where id = %L', (select bob from ids))),
  0, 'a member without membership.view cannot see co-member profiles');

-- Self-service: display name only.
select lives_ok(
  format($$ select pg_temp.exec_as(%L, 'aal1', 'update public.profiles set display_name = ''Alice A'' where id = auth.uid()') $$,
    (select alice from ids)),
  'a user can update their own display name');
select is((select display_name from public.profiles where id = (select alice from ids)),
  'Alice A', 'display name updated');

select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', 'update public.profiles set status = ''active'' where id = auth.uid()') $$,
    (select alice from ids)),
  '42501', null, 'a user cannot change their own profile status');

-- Impersonation: updating someone else's row silently matches nothing.
select pg_temp.exec_as((select alice from ids), 'aal2',
  format('update public.profiles set display_name = ''pwned'' where id = %L', (select dave from ids)));
select is((select display_name from public.profiles where id = (select dave from ids)),
  'dave', 'a user cannot update another user''s profile');

select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', 'insert into public.profiles (id) values (gen_random_uuid())') $$,
    (select alice from ids)),
  '42501', null, 'profiles cannot be inserted through the API');
select throws_ok(
  format($$ select pg_temp.exec_as(%L, 'aal2', 'delete from public.profiles where id = auth.uid()') $$,
    (select alice from ids)),
  '42501', null, 'profiles cannot be deleted through the API');

-- Anonymous denial.
select throws_ok(
  $$ select pg_temp.count_as(null, null, 'select id from public.profiles') $$,
  '42501', null, 'anonymous users cannot read profiles');

-- Suspended identity resolves to no profile.
update public.profiles set status = 'suspended' where id = (select dave from ids);
select is(pg_temp.scalar_as((select dave from ids), 'aal2', 'select authz.current_profile_id()'),
  null, 'a suspended profile has no active identity');
select is(pg_temp.scalar_as((select alice from ids), 'aal1', 'select authz.current_profile_id()')::uuid,
  (select alice from ids), 'an active profile resolves to itself');

select * from finish();
rollback;
