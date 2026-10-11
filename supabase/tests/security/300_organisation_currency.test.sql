-- =============================================================================
-- Organisation currency & language independence (P0-E9-3I)
-- C currency default · S safety (no FX, DATABASE-enforced) · I independence
-- A access / AAL2 / audit · E email locale
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql

select plan(23);

create function pg_temp.currency_of(p_org uuid) returns text language sql as $$
  select default_currency from public.organisations where id = p_org
$$;
create function pg_temp.in_use(p_user uuid, p_org uuid) returns text language sql as $$
  select (pg_temp.query_as(p_user, 'aal2', format('select * from public.get_organisation_currency(%L)', p_org)) -> 0 ->> 'currencies_in_use')
$$;

-- ---------------------------------------------------------------------------
-- C. A workspace with no financial records may set and change its default freely
-- ---------------------------------------------------------------------------
select is(pg_temp.currency_of((select alpha from orgs)), null, 'C. existing workspaces have no default yet (not rewritten)');
select is(pg_temp.in_use((select alice from ids), (select alpha from orgs)), '[]', 'C. no financial records yet');
select lives_ok(pg_temp.as_sql((select alice from ids), format('select public.set_organisation_currency(%L, ''GBP'')', (select alpha from orgs)), 'aal2'),
  'C. set GBP');
select lives_ok(pg_temp.as_sql((select alice from ids), format('select public.set_organisation_currency(%L, ''USD'')', (select alpha from orgs)), 'aal2'),
  'C. change to USD while nothing uses a currency');
select is(pg_temp.currency_of((select alpha from orgs)), 'USD', 'C. stored as the ISO 4217 code');
select throws_ok(pg_temp.as_sql((select alice from ids), format('select public.set_organisation_currency(%L, ''$'')', (select alpha from orgs)), 'aal2'),
  'CH400', null, 'C. a symbol is not a currency');
select throws_ok(pg_temp.as_sql((select alice from ids), format('select public.set_organisation_currency(%L, ''XYZ'')', (select alpha from orgs)), 'aal2'),
  'CH400', null, 'C. an unsupported code is refused');

-- ---------------------------------------------------------------------------
-- S. Once money exists in a currency, the default cannot move away from it
-- ---------------------------------------------------------------------------
create temp table rc as select pg_temp.scalar_as((select alice from ids), 'aal2', format(
  'select public.create_rate_card(%L, ''cna'')', (select alpha from orgs)))::uuid as card;
grant select on rc to authenticated;
create temp table rv as select pg_temp.scalar_as((select alice from ids), 'aal2', format(
  'select public.create_rate_version(%L, ''USD'', 3000, 4200, current_date)', (select card from rc)))::uuid as v;
grant select on rv to authenticated;
select is(pg_temp.in_use((select alice from ids), (select alpha from orgs)), '["USD"]', 'S. a USD rate is "in use"');
select throws_ok(pg_temp.as_sql((select alice from ids), format('select public.set_organisation_currency(%L, ''GBP'')', (select alpha from orgs)), 'aal2'),
  'CHY22', null, 'S. switching to GBP is refused by the DATABASE (no FX, no reinterpretation)');
select is(pg_temp.currency_of((select alpha from orgs)), 'USD', 'S. … the default is unchanged');
select is((select currency || ':' || pay_rate_minor || ':' || bill_rate_minor from public.rate_card_versions where id = (select v from rv)),
  'USD:3000:4200', 'S. the rate keeps its currency and amounts ($30.00 never becomes £30.00)');
select lives_ok(pg_temp.as_sql((select alice from ids), format('select public.set_organisation_currency(%L, ''USD'')', (select alpha from orgs)), 'aal2'),
  'S. confirming the currency already in use is allowed');
-- A discarded draft does not hold the currency.
select pg_temp.exec_as((select alice from ids), 'aal2', format('select public.discard_rate_version(%L)', (select v from rv)));
select is(pg_temp.in_use((select alice from ids), (select alpha from orgs)), '[]', 'S. a discarded draft is not "in use"');

-- ---------------------------------------------------------------------------
-- I. Language and currency are independent
-- ---------------------------------------------------------------------------
select pg_temp.exec_as((select alice from ids), 'aal2', format('select public.set_organisation_locale(%L, ''en-GB'')', (select alpha from orgs)));
select is((select coalesce(locale, '-') || '/' || coalesce(default_currency, '-') from public.organisations where id = (select alpha from orgs)),
  'en-GB/USD', 'I. en-GB + USD is a valid configuration; changing language did not change currency');
select pg_temp.exec_as((select alice from ids), 'aal2', format('select public.set_organisation_currency(%L, ''EUR'')', (select alpha from orgs)));
select is((select coalesce(locale, '-') || '/' || coalesce(default_currency, '-') from public.organisations where id = (select alpha from orgs)),
  'en-GB/EUR', 'I. changing currency did not change language');
select ok(not exists (
    select 1 from pg_proc p where p.proname in ('set_organisation_locale', 'set_organisation_currency')
      and p.prosrc ~* 'update public\.(rate_card_versions|priced_timesheets|payroll_batches|invoice_drafts|payroll_adjustments|invoice_adjustments)'),
  'I. neither setting can write any financial record (presentation / default only)');

-- ---------------------------------------------------------------------------
-- A. Access, AAL2, audit
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select alice from ids), format('select public.set_organisation_currency(%L, ''USD'')', (select alpha from orgs))),
  'CH402', null, 'A. AAL1 ⇒ step-up');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.set_organisation_currency(%L, ''USD'')', (select alpha from orgs)), 'aal2'),
  'CH403', null, 'A. a scheduler cannot change the currency');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select public.set_organisation_currency(%L, ''USD'')', (select alpha from orgs)), 'aal2'),
  'CH403', null, 'A. another agency cannot (cross-tenant)');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select * from public.get_organisation_currency(%L)', (select alpha from orgs)), 'aal2'),
  'CH403', null, 'A. another agency cannot read it');
select is((select string_agg(coalesce(metadata ->> 'from', 'null') || '>' || (metadata ->> 'to'), ',' order by metadata ->> 'to')
           from public.audit_events where action = 'organisation.currency_updated' and organisation_id = (select alpha from orgs)),
  'USD>EUR,null>GBP,GBP>USD', 'A. currency changes are audited (codes only); confirming the same value is not');
select is((select count(*)::int from public.audit_events where action = 'organisation.currency_updated' and metadata::text ~ 'pay_rate|amount|minor'),
  0, 'A. audit contains no financial record contents');

-- ---------------------------------------------------------------------------
-- E. Operational emails carry the recipient workspace's language
-- ---------------------------------------------------------------------------
update internal.notification_outbox set state = 'sent', sent_at = now();
create temp table s as select pg_temp.shift((select sam from ids), (select mercy from f), (select mercy_main from loc), 3, '07:00', '15:00', 2) as one;
grant select on s to authenticated;
select pg_temp.assign((select sam from ids), (select one from s), (select wendy from w));
select is((select internal.notification_template(id) ->> 'locale' from internal.notification_outbox
            where event = 'worker_assigned' and state = 'pending'),
  'en-GB', 'E. the assignment email renders in the workspace''s language');

select * from finish();
rollback;
