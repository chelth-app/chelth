-- =============================================================================
-- Rates & pricing policies (P0-E7-S1)
-- A cross-agency rates · C/D facility · E worker · F scheduler cannot manage ·
-- G finance manages only its own agency · H historical versions immutable ·
-- I overlapping scopes refused · K ambiguity prevented structurally ·
-- T pay and bill distinct · X platform admin · Z direct writes
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql

select plan(46);

create temp table fin as select pg_temp.create_user('finn@example.test') as finn;
grant select on fin to authenticated;
select pg_temp.add_member((select alpha from orgs), (select finn from fin), 'agency.finance');

-- ---------------------------------------------------------------------------
-- Cards and draft versions
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.create_rate_card(%L, ''cna'')', (select alpha from orgs))),
  'CH403', null, 'F. a scheduler cannot create rates');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_rate_card(%L, ''cna'')', (select alpha from orgs))),
  'CH402', null, 'rates.manage is privileged: finance must step up to AAL2');
create temp table card as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_rate_card(%L, ''cna'', %L)', (select alpha from orgs), (select riverside from rel)))::uuid as riverside;
grant select on card to authenticated;
select is(pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_rate_card(%L, ''cna'', %L)', (select alpha from orgs), (select riverside from rel)))::uuid,
  (select riverside from card), 'a scope has exactly one card (creation is idempotent)');
select throws_ok(format($$ insert into public.rate_cards (agency_organisation_id, relationship_id, discipline_key, created_by_membership_id)
  values (%L, %L, 'cna', %L) $$, (select alpha from orgs), (select riverside from rel), pg_temp.membership_of((select alpha from orgs), (select finn from fin))),
  '23505', null, 'K. a duplicate scope is structurally impossible (even as owner)');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_rate_card(%L, ''cna'', %L)', (select beta from orgs), (select beta from rel)), 'aal2'),
  'CH403', null, 'G. finance cannot create rates in another agency');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_rate_card(%L, ''cna'', %L)', (select alpha from orgs), (select beta from rel)), 'aal2'),
  'CHR04', null, 'G. a card cannot target another agency''s relationship');

select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_rate_version(%L, ''USD'', 0, 5800, current_date)', (select riverside from card)), 'aal2'),
  'CHM10', null, 'zero is never a rate (missing ≠ zero)');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_rate_version(%L, ''XYZ'', 4250, 5800, current_date)', (select riverside from card)), 'aal2'),
  'CHM06', null, 'unknown currency is refused');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_rate_version(%L, ''USD'', 4250, 5800, current_date, current_date - 1)', (select riverside from card)), 'aal2'),
  'CHM11', null, 'an effective period cannot end before it starts');

create temp table v as select
  pg_temp.scalar_as((select finn from fin), 'aal2', format('select public.create_rate_version(%L, ''USD'', 4200, 5700, current_date - 60)', (select riverside from card)))::uuid as v1;
grant select on v to authenticated;
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.update_rate_version_draft(%L, ''USD'', 4250, 5800, current_date - 60)', (select v1 from v)));
select is((select pay_rate_minor || '/' || bill_rate_minor || '/' || status from public.rate_card_versions where id = (select v1 from v)),
  '4250/5800/draft', 'a draft can be edited; money is integer minor units');
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.activate_rate_version(%L)', (select v1 from v)));
select is((select status::text from public.rate_card_versions where id = (select v1 from v)), 'active', 'the version is activated');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.update_rate_version_draft(%L, ''USD'', 1, 1, current_date)', (select v1 from v)), 'aal2'),
  'CHM03', null, 'H. an active version cannot be edited through the API');
select throws_ok(format($$ update public.rate_card_versions set pay_rate_minor = 1 where id = %L $$, (select v1 from v)),
  'CH409', null, 'H. an active version''s terms are frozen (even as owner)');
select throws_ok(format($$ delete from public.rate_card_versions where id = %L $$, (select v1 from v)),
  'CH409', null, 'H. versions are never deleted');
select isnt((select pay_rate_minor from public.rate_card_versions where id = (select v1 from v)),
  (select bill_rate_minor from public.rate_card_versions where id = (select v1 from v)), 'T. pay and bill are independent values');

-- Future version: supersedes v1 from its start; history before that stays.
create temp table v2 as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_rate_version(%L, ''USD'', 4400, 6000, current_date + 30)', (select riverside from card)))::uuid as id;
grant select on v2 to authenticated;
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.activate_rate_version(%L)', (select id from v2)));
select is((select superseded_from from public.rate_card_versions where id = (select v1 from v limit 1)), current_date + 30,
  'an upcoming version supersedes the current one only from its start');
select is((select (effective_from, pay_rate_minor, bill_rate_minor)::text from public.rate_card_versions where id = (select v1 from v limit 1)),
  (current_date - 60, 4250, 5800)::text, 'H. the superseded version''s terms are unchanged');
select is((select count(*)::int from public.rate_card_versions
           where rate_card_id = (select riverside from card) and status = 'active' and effective_period @> current_date),
  1, 'exactly one version is current today');
select is((select count(*)::int from public.rate_card_versions
           where rate_card_id = (select riverside from card) and status = 'active' and effective_period @> current_date + 40),
  1, 'exactly one version applies after the change');

-- I. Overlaps
create temp table v3 as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_rate_version(%L, ''USD'', 4500, 6100, current_date - 90)', (select riverside from card)))::uuid as id;
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.activate_rate_version(%L)', (select id from v3)), 'aal2'),
  'CHM12', null, 'I. a version starting before an existing active version is refused (history is never rewritten)');
create temp table v4 as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_rate_version(%L, ''USD'', 4500, 6100, current_date + 10, current_date + 12)', (select riverside from card)))::uuid as id;
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.activate_rate_version(%L)', (select id from v4)), 'aal2'),
  'CHM12', null, 'I. a bounded version inside a longer one is refused (it would leave the rest ambiguous)');
select throws_ok(format($$ insert into public.rate_card_versions (rate_card_id, agency_organisation_id, version, status, currency,
    pay_rate_minor, bill_rate_minor, effective_from, created_by_membership_id, activated_by_membership_id, activated_at)
  values (%L, %L, 99, 'active', 'USD', 1, 1, current_date, %L, %L, now()) $$,
  (select riverside from card), (select alpha from orgs), pg_temp.membership_of((select alpha from orgs), (select finn from fin)),
  pg_temp.membership_of((select alpha from orgs), (select finn from fin))),
  '23P01', null, 'I. overlapping active periods are refused by an exclusion constraint (even as owner)');
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.discard_rate_version(%L)', (select id from v3)));
select is((select status::text from public.rate_card_versions where id = (select id from v3)), 'discarded', 'a draft can be discarded (kept, not deleted)');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.activate_rate_version(%L)', (select id from v3)), 'aal2'),
  'CHM03', null, 'a discarded draft cannot be activated');

-- ---------------------------------------------------------------------------
-- Rounding and overtime policies
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_rounding_policy(%L, ''nearest'', current_date, 7::smallint)', (select alpha from orgs)), 'aal2'),
  'CHM13', null, 'only documented rounding increments (5, 6, 10, 15) are accepted');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_rounding_policy(%L, ''none'', current_date, 15::smallint)', (select alpha from orgs)), 'aal2'),
  'CHM13', null, '"none" has no increment');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_overtime_policy(%L, ''pay'', ''weekly_threshold'', current_date, 2400, 2, 3)', (select alpha from orgs)), 'aal2'),
  'CHM14', null, 'an overtime multiplier below 1× is refused');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_overtime_policy(%L, ''pay'', ''weekly_threshold'', current_date, null, 3, 2)', (select alpha from orgs)), 'aal2'),
  'CHM14', null, 'a weekly threshold is required');
create temp table pol as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_rounding_policy(%L, ''nearest'', current_date, 15::smallint)', (select alpha from orgs)))::uuid as id;
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.set_pricing_policy_status(%L, ''active'')', (select id from pol)));
select throws_ok(format($$ update public.rounding_policy_versions set increment_minutes = 5 where id = %L $$, (select id from pol)),
  'CH409', null, 'an active rounding policy is frozen');
create temp table pol2 as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_rounding_policy(%L, ''none'', current_date)', (select alpha from orgs)))::uuid as id;
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.set_pricing_policy_status(%L, ''active'')', (select id from pol2)), 'aal2'),
  'CHM12', null, 'two active rounding policies cannot start on the same day');
select is(internal.round_half_up_div(455, 10), 46::bigint, 'rounding: 45.5 increments rounds half up');
select is(internal.round_half_up_div(453, 15) * 15, 450::bigint, 'rounding: 453 min to the nearest 15 is 450');
select is(internal.round_half_up_div(1925250, 60), 32088::bigint, 'money: 453 min × 4250 / 60 = 32087.5 → 32088 (half up)');
select is(internal.overtime_regular_minutes(0, 480, 2400), 480, 'overtime: threshold not reached');
select is(internal.overtime_regular_minutes(2160, 480, 2400), 240, 'overtime: threshold crossed inside an entry');
select is(internal.overtime_regular_minutes(1920, 480, 2400), 480, 'overtime: exactly at the threshold is regular');
select is(internal.overtime_regular_minutes(2400, 480, 2400), 0, 'overtime: after the threshold every minute is overtime');

-- ---------------------------------------------------------------------------
-- Shift classification
-- ---------------------------------------------------------------------------
create temp table sh as select
  pg_temp.shift((select sam from ids), (select riverside from f), (select riverside_main from loc), 5, '22:00', '06:00', 1, false) as draft,
  pg_temp.shift((select sam from ids), (select riverside from f), (select riverside_main from loc), 6, '22:00', '06:00', 1, true) as open;
select lives_ok(pg_temp.as_sql((select sam from ids), format('select public.set_shift_classification(%L, ''night'')', (select draft from sh))),
  'a draft shift''s classification can be set');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.set_shift_classification(%L, ''night'')', (select open from sh))),
  'CH409', null, 'the classification is fixed once a shift is open');

-- ---------------------------------------------------------------------------
-- A / C / D / E / X / Z. Visibility and direct writes
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select bob from ids), 'aal2', 'select * from public.rate_card_versions'), 0,
  'A. another agency reads no rates');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select * from public.list_rate_cards(%L)', (select alpha from orgs)), 'aal2'),
  'CH403', null, 'A. …nor through the projection');
select is(pg_temp.count_as((select fiona from ids), 'aal2', 'select * from public.rate_card_versions'), 0,
  'C. a facility reads no pay or bill rates');
select is(pg_temp.count_as((select wendy from ids), 'aal1', 'select * from public.rate_cards'), 0,
  'E. a worker reads no rates');
select is(pg_temp.count_as((select sam from ids), 'aal1', 'select * from public.rate_card_versions'), 0,
  'a scheduler has no pay-rate visibility');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.rate_card_versions'), 0,
  'X. a platform admin has no tenant rate path');
select throws_ok(pg_temp.as_sql((select finn from fin), format('insert into public.rate_card_versions (rate_card_id, agency_organisation_id, version, currency, pay_rate_minor, bill_rate_minor, effective_from, created_by_membership_id) values (%L, %L, 50, ''USD'', 1, 1, current_date, %L)',
  (select riverside from card), (select alpha from orgs), pg_temp.membership_of((select alpha from orgs), (select finn from fin))), 'aal2'),
  '42501', null, 'Z. no direct writes, even for finance');

select * from finish();
rollback;
