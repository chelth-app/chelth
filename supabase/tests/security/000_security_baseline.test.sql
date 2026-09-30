-- =============================================================================
-- Security baseline invariants (docs/security/SECURITY_INVARIANTS.md).
--
-- These tests are schema-agnostic: they hold for the empty foundation schema
-- and must continue to hold as domain tables are added. A failure here blocks
-- release (invariant 15).
-- =============================================================================
begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

-- Invariant 4/5: every table in public has RLS enabled.
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity),
  0,
  'every table in public has row level security enabled'
);

-- Invariant 1/5: anonymous users hold no table privileges in public.
-- (If a genuinely public lookup table is ever approved, list it explicitly here.)
select is(
  (select count(*)::int
     from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'anon'),
  0,
  'anon has no table privileges in public'
);

-- Invariant 3: SECURITY DEFINER functions in public must pin search_path.
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%'
      )),
  0,
  'security definer functions in public set an explicit search_path'
);

-- Invariant 12: no public storage buckets.
select is(
  (select count(*)::int from storage.buckets where public),
  0,
  'no storage bucket is public'
);

-- Default privileges (migration 20260929232049_security_baseline): objects
-- created by the migration role are not exposed until deliberately granted.
create table public.__baseline_probe (id int primary key);
create sequence public.__baseline_probe_seq;
create function public.__baseline_probe_fn() returns int
  language sql as 'select 1';

select ok(
  not has_table_privilege('anon', 'public.__baseline_probe', 'select'),
  'new tables are not readable by anon by default'
);
select ok(
  not has_table_privilege('authenticated', 'public.__baseline_probe', 'select,insert,update,delete'),
  'new tables are not accessible to authenticated by default'
);
select ok(
  not has_sequence_privilege('authenticated', 'public.__baseline_probe_seq', 'usage'),
  'new sequences are not usable by authenticated by default'
);
select ok(
  not has_function_privilege('anon', 'public.__baseline_probe_fn()', 'execute'),
  'new functions are not executable by anon by default'
);
select ok(
  not has_function_privilege('authenticated', 'public.__baseline_probe_fn()', 'execute'),
  'new functions are not executable by authenticated by default'
);

select * from finish();
rollback;
