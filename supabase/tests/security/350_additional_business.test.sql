-- =============================================================================
-- One business per self-service owner; billing-safe additional business (P0-E9-4A.2)
-- O ownership vs membership · B server-side block · R request · F platform
-- fulfilment (own account, no inheritance) · C commercial invariants · P privacy
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql

select plan(33);

create function pg_temp.owned(p_user uuid) returns integer language sql as $$
  select (pg_temp.query_as(p_user, 'aal1', 'select * from public.my_business_ownership()') -> 0 ->> 'owned_agencies')::int
$$;
create function pg_temp.create_sql(p_user uuid, p_name text) returns text language sql as $$
  select pg_temp.as_sql(p_user, format('select public.create_organisation(''agency'', %L, %L)', p_name,
    lower(regexp_replace(p_name, '[^A-Za-z0-9]+', '-', 'g')) || '-x'))
$$;

-- ---------------------------------------------------------------------------
-- O. Ownership = the agency owner role, not membership
-- ---------------------------------------------------------------------------
select is(pg_temp.owned((select alice from ids)), 1, 'O. an agency admin owns one agency');
select is(pg_temp.owned((select wendy from ids)), 0, 'O. a healthcare worker (member of two agencies) owns none');
select is(pg_temp.owned((select sam from ids)), 0, 'O. a scheduler owns none');
select is(pg_temp.owned((select fiona from ids)), 0, 'O. a facility admin owns no agency (facility ownership is separate)');

-- ---------------------------------------------------------------------------
-- B. Self-service: first owned agency only (database-enforced)
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.create_sql((select alice from ids), 'Alice Second Agency'),
  'CHB01', null, 'B. an owner cannot self-create a second agency (direct RPC)');
select lives_ok(pg_temp.create_sql((select wendy from ids), 'Wendy Own Staffing'),
  'B. a worker can create their own first agency');
select is(pg_temp.owned((select wendy from ids)), 1, 'B. … and now owns it');
select throws_ok(pg_temp.create_sql((select wendy from ids), 'Wendy Second Staffing'),
  'CHB01', null, 'B. … but not a second one');
select lives_ok(pg_temp.create_sql((select sam from ids), 'Sam Own Staffing'),
  'B. a scheduler elsewhere can create their own first agency');
select throws_ok(pg_temp.as_sql((select fiona from ids), 'select public.create_organisation(''facility'', ''Fiona Clinic'', ''fiona-clinic'')'),
  'CH403', null, 'B. facility organisations are never self-service (unchanged)');

-- ---------------------------------------------------------------------------
-- R. Requesting an additional business
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select dora from ids), 'select public.request_additional_business(''Dora Staffing'', ''billing@dora.test'')'),
  'CHB02', null, 'R. someone who owns no agency creates their first one instead');
select throws_ok(pg_temp.as_sql((select alice from ids), 'select public.request_additional_business(''X'', ''billing@acme.test'')'),
  'CH400', null, 'R. a business name is required');
select throws_ok(pg_temp.as_sql((select alice from ids), 'select public.request_additional_business(''Acme Medical Staffing'', ''nope'')'),
  'CH400', null, 'R. a valid billing email is required');
create temp table req as select pg_temp.scalar_as((select alice from ids), 'aal1',
  'select public.request_additional_business(''Acme Medical Staffing LLC'', '' Billing@Acme.test '', ''Separate legal entity'')')::uuid as id;
grant select on req to authenticated;
select is((pg_temp.query_as((select alice from ids), 'aal1', 'select * from public.list_my_additional_business_requests()') -> 0 ->> 'status'),
  'pending', 'R. the owner sees their request as pending');
select is(pg_temp.count_as((select bob from ids), 'aal1', 'select * from public.list_my_additional_business_requests()'), 0,
  'R. nobody else sees it');
select throws_ok(pg_temp.as_sql((select alice from ids), 'select * from public.additional_business_requests'),
  '42501', null, 'R. no direct table access');
select is((select count(*)::int from public.organisations where name = 'Acme Medical Staffing LLC'), 0,
  'R. a request creates no organisation');

-- ---------------------------------------------------------------------------
-- F. Platform fulfilment: its own account, explicit status/plan, no inheritance
-- ---------------------------------------------------------------------------
-- Alpha's own account (plan "growth"), to prove nothing is inherited.
insert into public.subscription_plans (key, name) values ('growth', 'Growth');
select pg_temp.exec_as((select erin from ids), 'aal2', format(
  'select public.platform_save_customer_account(%L, ''active'', ''alpha contract'', ''growth'', ''Alpha Billing'', ''billing@alpha.test'')',
  (select alpha from orgs)));
select throws_ok(pg_temp.as_sql((select alice from ids),
    format('select public.platform_fulfil_business_request(%L, ''active'', ''self approve'')', (select id from req)), 'aal2'),
  'CH403', null, 'F. the requester cannot approve their own request');
select throws_ok(pg_temp.as_sql((select erin from ids),
    format('select public.platform_fulfil_business_request(%L, ''active'', ''ok'')', (select id from req)), 'aal1'),
  'CH402', null, 'F. fulfilment needs the platform admin at AAL2');
select throws_ok(pg_temp.as_sql((select erin from ids),
    format('select public.platform_fulfil_business_request(%L, ''past_due'', ''bad status'')', (select id from req)), 'aal2'),
  'CH400', null, 'F. a new business starts as trial or active only');
create temp table acme as select pg_temp.scalar_as((select erin from ids), 'aal2', format(
  'select public.platform_fulfil_business_request(%L, ''trial'', ''separate legal entity verified'', ''pilot'', current_date + 30)',
  (select id from req)))::uuid as id;
grant select on acme to authenticated;
select is((select type::text || ':' || name from public.organisations where id = (select id from acme)),
  'agency:Acme Medical Staffing LLC', 'F. the business is a separate agency organisation');
select is(pg_temp.owned((select alice from ids)), 2, 'F. the requester owns it (now two businesses)');
select is((select status::text || '/' || plan_key || '/' || billing_email from public.customer_accounts where organisation_id = (select id from acme)),
  'trial/pilot/billing@acme.test', 'F. it has its OWN account: chosen status and plan, its own billing contact');
select is((select status::text || '/' || plan_key from public.customer_accounts where organisation_id = (select alpha from orgs)),
  'active/growth', 'F. the first agency''s account is unchanged (nothing inherited either way)');
select isnt((select id from public.customer_accounts where organisation_id = (select id from acme)),
  (select id from public.customer_accounts where organisation_id = (select alpha from orgs)), 'F. two accounts, not one shared');
select throws_ok(pg_temp.as_sql((select erin from ids),
    format('select public.platform_fulfil_business_request(%L, ''active'', ''again'')', (select id from req)), 'aal2'),
  'CH409', null, 'F. a request is fulfilled once (one-time commercial authorisation)');
select throws_ok(pg_temp.create_sql((select alice from ids), 'Alice Third Agency'),
  'CHB01', null, 'F. self-service stays blocked for the owner');
create temp table req2 as select pg_temp.scalar_as((select alice from ids), 'aal1',
  'select public.request_additional_business(''Another Co'', ''billing@another.test'')')::uuid as id;
grant select on req2 to authenticated;
select lives_ok(pg_temp.as_sql((select erin from ids),
    format('select public.platform_decline_business_request(%L, ''same business as Alpha; use branches later'')', (select id from req2)), 'aal2'),
  'F. the platform can decline with a reason');

-- ---------------------------------------------------------------------------
-- C. Commercial invariants (structural)
-- ---------------------------------------------------------------------------
select throws_ok(format('insert into public.customer_accounts (organisation_id, status) values (%L, ''trial'')', (select gamma from orgs)),
  '23503', null, 'C. a facility organisation cannot have a customer account');
select throws_ok(format('insert into public.customer_accounts (organisation_id, status) values (%L, ''trial'')', (select alpha from orgs)),
  '23505', null, 'C. one account per agency');
update public.customer_accounts set provider_customer_id = 'cus_shared' where organisation_id = (select alpha from orgs);
select throws_ok(format('update public.customer_accounts set provider_customer_id = ''cus_shared'' where organisation_id = %L', (select id from acme)),
  '23505', null, 'C. a provider customer ID cannot be reused by another agency');

-- ---------------------------------------------------------------------------
-- P. Privacy: audit holds no email; the activity allow-list includes the events
-- ---------------------------------------------------------------------------
select ok(not exists (select 1 from public.audit_events where action like 'additional_business.%' and metadata::text ~* '@'),
  'P. additional-business audit carries no email');
select ok(exists (select 1 from jsonb_array_elements(pg_temp.query_as((select erin from ids), 'aal2', 'select * from public.platform_list_activity(200)')) e
                  where e ->> 'action' = 'additional_business.created'),
  'P. the platform activity lists the fulfilment');

select * from finish();
rollback;
