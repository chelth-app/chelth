-- =============================================================================
-- Platform control plane (P0-E9-4A)
-- U authority · P privacy (structural) · F tenant-finance separation
-- C commercial account · S one suspension authority · L lifecycle reason
-- K facility provisioning + link · A activity allow-list · H health
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql

select plan(48);

create function pg_temp.erin_q(p_sql text) returns jsonb language sql as $$
  select pg_temp.query_as((select erin from ids), 'aal2', p_sql)
$$;
create function pg_temp.erin_s(p_sql text) returns text language sql as $$
  select pg_temp.scalar_as((select erin from ids), 'aal2', p_sql)
$$;
create function pg_temp.as_erin(p_sql text) returns text language sql as $$
  select pg_temp.as_sql((select erin from ids), p_sql, 'aal2')
$$;
create function pg_temp.save_account(p_org uuid, p_status text, p_plan text, p_email text, p_reason text,
  p_trial date default null)
returns text language sql as $$
  select format('select public.platform_save_customer_account(%L, %L, %L, %L, %L, %L, %L, null, false)',
    p_org, p_status, p_reason, p_plan, 'Billing Contact', p_email, p_trial)
$$;

-- ---------------------------------------------------------------------------
-- U. Authority: only an active platform grant at AAL2; no tenant authority
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select alice from ids), 'select public.platform_get_overview()', 'aal2'),
  'CH403', null, 'U. an agency admin is not a platform admin');
select throws_ok(pg_temp.as_sql((select fiona from ids), 'select public.platform_get_overview()', 'aal2'),
  'CH403', null, 'U. a facility admin is not a platform admin');
select throws_ok(pg_temp.as_sql((select wendy from ids), 'select public.platform_get_overview()', 'aal2'),
  'CH403', null, 'U. a worker is not a platform admin');
select throws_ok(pg_temp.as_sql((select erin from ids), 'select public.platform_get_overview()', 'aal1'),
  'CH402', null, 'U. a platform admin at AAL1 must step up');
select lives_ok(pg_temp.as_erin('select public.platform_get_overview()'), 'U. platform admin at AAL2 reads the overview');
select is(pg_temp.count_as((select erin from ids), 'aal2',
    format('select * from public.organisation_memberships where organisation_id = %L', (select alpha from orgs))),
  0, 'U. the platform admin gains no tenant read access (memberships)');
select throws_ok(pg_temp.as_erin(format(
    'select public.create_shift(%L, %L, ''cna'', current_date + 3, ''07:00'', ''15:00'', 1, null, null, true)',
    (select mercy from f), (select mercy_main from loc))),
  'CH403', null, 'U. … and no tenant operational authority');
select ok(not exists (select 1 from public.organisation_memberships m where m.profile_id = (select erin from ids)),
  'U. the platform admin is a member of no organisation');
-- Revoked ⇒ immediately refused.
select internal.grant_platform_admin((select bob from ids), 'Test Operator', 'temporary operator');
select lives_ok(pg_temp.as_sql((select bob from ids), 'select public.platform_get_overview()', 'aal2'),
  'U. a newly granted admin has access');
select internal.revoke_platform_admin((select bob from ids), 'Test Operator', 'temporary operator ends');
select throws_ok(pg_temp.as_sql((select bob from ids), 'select public.platform_get_overview()', 'aal2'),
  'CH403', null, 'U. a revoked admin loses access at once');
select ok(not has_function_privilege('authenticated', 'internal.grant_platform_admin(uuid,text,text)', 'execute'),
  'U. granting stays an operator procedure (not callable through the API)');

-- ---------------------------------------------------------------------------
-- P. Privacy: projections carry no sensitive fields (structural)
-- ---------------------------------------------------------------------------
select ok(pg_get_function_result('public.platform_list_customers()'::regprocedure)
            !~* '(phone|address|latitude|longitude|pay|rate|payroll|invoice|message|document|note|email)',
  'P. the directory has no contact, location, pay, document or message fields');
select ok(pg_get_function_result('public.platform_list_activity(integer,timestamp with time zone)'::regprocedure)
            !~* '(phone|address|latitude|longitude|pay_|payroll|invoice|message|document|email)',
  'P. activity has no sensitive fields');
select ok(not (pg_temp.erin_s(format('select public.platform_get_customer(%L)::text', (select alpha from orgs)))
               ~* '(wendy@|walt@|nora@|sam@|latitude|longitude|pay_rate|bill_rate|storage_path|body)'),
  'P. customer detail exposes no member emails, locations, rates, documents or message bodies');
select ok(not (pg_temp.erin_s('select public.platform_get_system_health()::text') ~* '(secret|api_key|token|https?://)'),
  'P. system health exposes no secrets or URLs');
select ok((select c.relrowsecurity and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
           from pg_class c where c.oid = 'public.customer_accounts'::regclass),
  'P. customer_accounts: RLS on, no policies (RPC access only)');
select ok(not has_table_privilege('authenticated', 'public.customer_accounts', 'select')
          and not has_table_privilege('authenticated', 'public.subscription_plans', 'select'),
  'P. no table grants on the commercial tables');

-- ---------------------------------------------------------------------------
-- F. Tenant finance stays invisible to the platform admin
-- ---------------------------------------------------------------------------
create temp table rc as select pg_temp.scalar_as((select alice from ids), 'aal2', format(
  'select public.create_rate_card(%L, ''cna'')', (select alpha from orgs)))::uuid as card;
grant select on rc to authenticated;
select pg_temp.scalar_as((select alice from ids), 'aal2', format(
  'select public.create_rate_version(%L, ''USD'', 3000, 4200, current_date)', (select card from rc)));
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.rate_cards'), 0,
  'F. rate cards: none visible');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.rate_card_versions'), 0,
  'F. rate versions (pay/bill): none visible');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.priced_timesheets'), 0,
  'F. priced timesheets: none visible');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.payroll_batches'), 0,
  'F. payroll: none visible');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.invoice_drafts'), 0,
  'F. agency invoices: none visible');
select throws_ok(pg_temp.as_erin(format('select * from public.list_rate_cards(%L)', (select alpha from orgs))),
  'CH403', null, 'F. tenant finance RPCs refuse the platform admin');
select ok(not exists (select 1 from pg_proc p where p.proname like 'platform\_%'
                        and p.prosrc ~* '(rate_card|priced_timesheet|payroll_|invoice_draft|pay_rate|bill_rate)'),
  'F. no platform function reads tenant finance tables');

-- ---------------------------------------------------------------------------
-- C. Commercial account (manual; agencies only; no assumed defaults)
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.customer_accounts), 0, 'C. existing agencies get no account automatically');
select is((pg_temp.erin_q('select * from public.platform_list_customers()') -> 0 ->> 'account_status'), null,
  'C. … they show as commercial setup required');
select throws_ok(pg_temp.as_erin(pg_temp.save_account((select alpha from orgs), 'trial', 'pilot', 'billing@alpha.test', '')),
  'CH400', null, 'C. a reason is required');
select throws_ok(pg_temp.as_erin(pg_temp.save_account((select gamma from orgs), 'trial', 'pilot', 'billing@gamma.test', 'pilot start')),
  'CH400', null, 'C. facility organisations have no commercial account');
select throws_ok(pg_temp.as_sql((select alice from ids),
    pg_temp.save_account((select alpha from orgs), 'active', 'pilot', 'x@alpha.test', 'self upgrade'), 'aal2'),
  'CH403', null, 'C. an agency admin cannot change its own commercial account');
select lives_ok(pg_temp.as_erin(pg_temp.save_account((select alpha from orgs), 'trial', 'pilot', 'Billing@Alpha.test',
    'pilot onboarding', current_date + 30)), 'C. trial account created');
select is((select status::text || '/' || plan_key || '/' || billing_email || '/' || provider from public.customer_accounts
           where organisation_id = (select alpha from orgs)),
  'trial/pilot/billing@alpha.test/manual', 'C. stored: status, plan, billing contact (normalised), manual provider');
select lives_ok(pg_temp.as_erin(pg_temp.save_account((select alpha from orgs), 'active', 'pilot', 'finance@alpha.test',
    'pilot converted', current_date + 30)), 'C. trial → active, billing contact changed');
select is((select string_agg(action, ',' order by action) from public.audit_events
           where organisation_id = (select alpha from orgs) and action like 'platform.%' and action not like 'platform.%viewed'),
  'platform.billing_contact_changed,platform.customer_account_created,platform.subscription_changed',
  'C. creation, status and billing-contact changes are audited');
select ok((select bool_and(metadata ? 'reason') from public.audit_events
           where organisation_id = (select alpha from orgs) and action like 'platform.%' and action not like 'platform.%viewed'),
  'C. every commercial audit event carries the reason');
select ok(not exists (select 1 from public.audit_events where action like 'platform.%' and metadata::text ~* 'card|iban|cvc'),
  'C. no payment credentials in audit');

-- ---------------------------------------------------------------------------
-- S. One suspension authority: organisations.status
-- ---------------------------------------------------------------------------
select lives_ok(pg_temp.as_erin(pg_temp.save_account((select alpha from orgs), 'suspended', 'pilot', 'finance@alpha.test',
    'unpaid pilot invoice')), 'S. commercial suspension');
select is((select status::text from public.organisations where id = (select alpha from orgs)), 'suspended',
  'S. … suspends the organisation in the same step');
select throws_ok(pg_temp.as_erin(format('select public.platform_set_organisation_lifecycle(%L, ''active'', ''manual reactivation'')',
    (select alpha from orgs))),
  'CH409', null, 'S. the lifecycle path cannot reactivate a commercially suspended agency');
select lives_ok(pg_temp.as_erin(pg_temp.save_account((select alpha from orgs), 'active', 'pilot', 'finance@alpha.test',
    'invoice paid')), 'S. resuming the account');
select is((select status::text from public.organisations where id = (select alpha from orgs)), 'active',
  'S. … reactivates the same organisation (no data touched)');

-- ---------------------------------------------------------------------------
-- L. Lifecycle with a reason (facility organisation)
-- ---------------------------------------------------------------------------
select lives_ok(pg_temp.as_erin(format('select public.platform_set_organisation_lifecycle(%L, ''suspended'', ''contract paused'')',
    (select delta from orgs))), 'L. suspend a facility organisation with a reason');
select is((select metadata ->> 'reason' from public.audit_events where action = 'organisation.status_changed'
           and organisation_id = (select delta from orgs) order by occurred_at desc limit 1),
  'contract paused', 'L. the reason is audited');

-- ---------------------------------------------------------------------------
-- K. Provisioning: a facility organisation via the existing RPC; the admin is never a member
-- ---------------------------------------------------------------------------
create temp table nf as select (pg_temp.erin_q(
  'select * from public.platform_create_organisation(''facility'', ''Omega Clinic'', ''omega-clinic'', ''owner@omega.test'')') -> 0) as r;
grant select on nf to authenticated;
select is((pg_temp.erin_q(format('select public.platform_get_customer(%L) as c', (select (r ->> 'organisation_id')::uuid from nf)))
           -> 0 -> 'c' -> 'invites' -> 0 ->> 'status'),
  'pending', 'K. the owner invitation is visible to the platform (status only)');
select is((pg_temp.erin_q('select * from public.platform_list_agency_facility_records(''' || (select alpha from orgs) || ''')')
           #>> '{1,name}') is not null, true, 'K. an agency''s facility records can be listed for an explicit link');
select lives_ok(pg_temp.as_erin(format('select public.platform_link_agency_facility(%L, %L)',
    (select riverside from f), (select (r ->> 'organisation_id')::uuid from nf))),
  'K. link an agency facility record to the new facility organisation');

-- ---------------------------------------------------------------------------
-- A. Activity: platform events only
-- ---------------------------------------------------------------------------
select ok(exists (select 1 from jsonb_array_elements(pg_temp.erin_q('select * from public.platform_list_activity(200)')) e
                  where e ->> 'action' = 'facility.linked'),
  'A. links appear in platform activity');
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.erin_q('select * from public.platform_list_activity(200)')) e
                      where e ->> 'action' in ('shift.created', 'credential.verified', 'assignment.created', 'rate_card.created')),
  'A. tenant operational events are never listed');

-- ---------------------------------------------------------------------------
-- H. Health
-- ---------------------------------------------------------------------------
select ok(jsonb_array_length(pg_temp.erin_q('select public.platform_get_system_health() as h') -> 0 -> 'h' -> 'buckets') >= 2,
  'H. system health lists the storage buckets (no secrets)');

select * from finish();
rollback;
