-- =============================================================================
-- Pricing engine & S7 relationship end (P0-E7-S1)
-- B cross-agency pricing · D facility · E worker · J missing rate fails closed ·
-- L/M no client minutes or amounts · N locked only · O revision mismatch ·
-- P history survives rate change · Q new revision ⇒ new snapshot · R lines
-- immutable · S minutes equal the approval snapshot · T pay ≠ bill ·
-- U currency mismatch blocked · V/W relationship end resolves pending sign-offs
-- · X platform admin
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql
\ir _attendance_helpers.psql
\ir _timesheet_helpers.psql

select plan(44);

create temp table fin as select pg_temp.create_user('finn@example.test') as finn;
grant select on fin to authenticated;
select pg_temp.add_member((select alpha from orgs), (select finn from fin), 'agency.finance');

create temp table per as select internal.period_start_for((select alpha from orgs), current_date - 14) as ps;
grant select on per to authenticated;

-- Wendy (Riverside, unlinked ⇒ approval locks): 480 and 453 minutes.
-- Walt (Mercy, linked to Gamma): 240. Nora: Mercy 240 + Riverside 240.
create temp table p as
select
  pg_temp.past_accepted((select riverside from f), (select riverside_main from loc),
    pg_temp.local_ts((select ps from per) + 1, '09:00', 'America/Chicago'), pg_temp.local_ts((select ps from per) + 1, '17:00', 'America/Chicago'),
    (select wendy from w), (select wendy from ids), (select sam from ids), (select alpha from orgs)) as w1,
  pg_temp.past_accepted((select riverside from f), (select riverside_main from loc),
    pg_temp.local_ts((select ps from per) + 2, '09:00', 'America/Chicago'), pg_temp.local_ts((select ps from per) + 2, '17:00', 'America/Chicago'),
    (select wendy from w), (select wendy from ids), (select sam from ids), (select alpha from orgs)) as w2,
  pg_temp.past_accepted((select mercy from f), (select mercy_main from loc),
    pg_temp.local_ts((select ps from per) + 3, '09:00', 'America/New_York'), pg_temp.local_ts((select ps from per) + 3, '13:00', 'America/New_York'),
    (select walt from w), (select walt from ids), (select sam from ids), (select alpha from orgs)) as k1,
  pg_temp.past_accepted((select mercy from f), (select mercy_main from loc),
    pg_temp.local_ts((select ps from per) + 4, '09:00', 'America/New_York'), pg_temp.local_ts((select ps from per) + 4, '13:00', 'America/New_York'),
    (select nora from w), (select nora from ids), (select sam from ids), (select alpha from orgs)) as n1,
  pg_temp.past_accepted((select riverside from f), (select riverside_main from loc),
    pg_temp.local_ts((select ps from per) + 5, '09:00', 'America/Chicago'), pg_temp.local_ts((select ps from per) + 5, '13:00', 'America/Chicago'),
    (select nora from w), (select nora from ids), (select sam from ids), (select alpha from orgs)) as n2;
grant select on p to authenticated;

select pg_temp.past_event((select w1 from p), 'clock_in', pg_temp.local_ts((select ps from per) + 1, '09:00', 'America/Chicago'));
select pg_temp.past_event((select w1 from p), 'clock_out', pg_temp.local_ts((select ps from per) + 1, '17:00', 'America/Chicago'));
select pg_temp.past_event((select w2 from p), 'clock_in', pg_temp.local_ts((select ps from per) + 2, '09:00', 'America/Chicago'));
select pg_temp.past_event((select w2 from p), 'clock_out', pg_temp.local_ts((select ps from per) + 2, '16:33', 'America/Chicago'));
select pg_temp.past_event((select k1 from p), 'clock_in', pg_temp.local_ts((select ps from per) + 3, '09:00', 'America/New_York'));
select pg_temp.past_event((select k1 from p), 'clock_out', pg_temp.local_ts((select ps from per) + 3, '13:00', 'America/New_York'));
select pg_temp.past_event((select n1 from p), 'clock_in', pg_temp.local_ts((select ps from per) + 4, '09:00', 'America/New_York'));
select pg_temp.past_event((select n1 from p), 'clock_out', pg_temp.local_ts((select ps from per) + 4, '13:00', 'America/New_York'));
select pg_temp.past_event((select n2 from p), 'clock_in', pg_temp.local_ts((select ps from per) + 5, '09:00', 'America/Chicago'));
select pg_temp.past_event((select n2 from p), 'clock_out', pg_temp.local_ts((select ps from per) + 5, '13:00', 'America/Chicago'));

create temp table ts as
select (pg_temp.timesheet_of((select w1 from p))).id as wendy,
       (pg_temp.timesheet_of((select k1 from p))).id as walt,
       (pg_temp.timesheet_of((select n1 from p))).id as nora;
grant select on ts to authenticated;
select pg_temp.outcome_as((select wendy from ids), format('select * from public.submit_timesheet(%L)', (select wendy from ts)));
select pg_temp.outcome_as((select walt from ids), format('select * from public.submit_timesheet(%L)', (select walt from ts)));
select pg_temp.outcome_as((select nora from ids), format('select * from public.submit_timesheet(%L)', (select nora from ts)));
select pg_temp.outcome_as((select alice from ids), format('select * from public.approve_timesheet(%L, 1)', (select wendy from ts)));
select pg_temp.outcome_as((select alice from ids), format('select * from public.approve_timesheet(%L, 1)', (select walt from ts)));
select pg_temp.outcome_as((select alice from ids), format('select * from public.approve_timesheet(%L, 1)', (select nora from ts)));

-- Riverside rate (tier 2): $42.50 pay / $58.00 bill per hour.
create temp table rc as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_rate_card(%L, ''cna'', %L)', (select alpha from orgs), (select riverside from rel)))::uuid as riverside;
grant select on rc to authenticated;
create temp table rv as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_rate_version(%L, ''USD'', 4250, 5800, %L)', (select riverside from rc), (select ps from per) - 30))::uuid as v1;
grant select on rv to authenticated;
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.activate_rate_version(%L)', (select v1 from rv)));

create function pg_temp.price(p_user uuid, p_ts uuid, p_rev integer) returns jsonb language sql as $$
  select pg_temp.query_as(p_user, 'aal1', format('select * from public.price_timesheet(%L, %s)', p_ts, p_rev)) -> 0
$$;

-- ---------------------------------------------------------------------------
-- N / O. Only a locked revision, and only the expected one
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select finn from fin), format('select * from public.price_timesheet(%L, 1)', (select walt from ts))),
  'CHM07', null, 'N. a timesheet awaiting facility sign-off cannot be priced');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select * from public.price_timesheet(%L, 2)', (select wendy from ts))),
  'CHM08', null, 'O. pricing names the revision it expects');
create temp table pr as select pg_temp.price((select finn from fin), (select wendy from ts), 1) as r;
select is((select r ->> 'outcome' from pr), 'priced', 'the locked revision is priced');
select is((select total_pay_minor || '/' || total_bill_minor || '/' || currency from public.priced_timesheets where id = (select (r ->> 'priced_timesheet_id')::uuid from pr)),
  '66088/90190/USD', 'totals: pay $340.00 + $320.88, bill $464.00 + $437.90');
select is((select string_agg(raw_minutes || ':' || pay_amount_minor || ':' || bill_amount_minor, ',' order by line_number)
           from public.priced_timesheet_lines where priced_timesheet_id = (select (r ->> 'priced_timesheet_id')::uuid from pr)),
  '480:34000:46400,453:32088:43790', '480 min ⇒ $340.00 / $464.00; 453 min ⇒ $320.88 (half-cent up) / $437.90');
select is((select sum(raw_minutes)::int from public.priced_timesheet_lines where priced_timesheet_id = (select (r ->> 'priced_timesheet_id')::uuid from pr)),
  (select total_worked_minutes from public.timesheet_approvals where timesheet_id = (select wendy from ts) and revision = 1),
  'S. priced minutes come from the locked approval snapshot');
select is((select distinct rate_version_id from public.priced_timesheet_lines where priced_timesheet_id = (select (r ->> 'priced_timesheet_id')::uuid from pr)),
  (select v1 from rv), 'each line records the applied rate version');
select is((select distinct rate_precedence from public.priced_timesheet_lines where priced_timesheet_id = (select (r ->> 'priced_timesheet_id')::uuid from pr)),
  2::smallint, 'relationship + discipline card applies (precedence 2)');
select is(pg_temp.price((select finn from fin), (select wendy from ts), 1) ->> 'outcome', 'existing',
  'pricing is idempotent per revision');
select is((select count(*)::int from public.priced_timesheets where timesheet_id = (select wendy from ts)), 1,
  'no duplicate financial records');

-- ---------------------------------------------------------------------------
-- Access and immutability
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select fiona from ids), 'aal2', 'select * from public.priced_timesheet_lines'), 0,
  'D. a facility reads no pricing (no pay, no margin)');
select is(pg_temp.count_as((select wendy from ids), 'aal1', 'select * from public.priced_timesheets'), 0,
  'E. a worker reads no internal pricing');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.price_timesheet(%L, 1)', (select wendy from ts))),
  'CHM15', null, 'E. a worker cannot price their own timesheet');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select * from public.list_pricing_queue(%L, ''ready'')', (select alpha from orgs))),
  'CH403', null, 'a scheduler has no pricing access');
select is(pg_temp.count_as((select bob from ids), 'aal2', 'select * from public.priced_timesheet_lines'), 0,
  'B. another agency reads no pricing');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select * from public.get_priced_timesheet(%L)', (select (r ->> 'priced_timesheet_id')::uuid from pr)), 'aal2'),
  'CHM15', null, 'B. …nor by id');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.priced_timesheets'), 0,
  'X. a platform admin has no tenant pricing path');
select throws_ok(pg_temp.as_sql((select alice from ids), format('update public.priced_timesheet_lines set pay_amount_minor = 1 where priced_timesheet_id = %L', (select (r ->> 'priced_timesheet_id')::uuid from pr)), 'aal2'),
  '42501', null, 'M. no client can submit or change amounts');
select throws_ok(format($$ update public.priced_timesheet_lines set raw_minutes = 999 where priced_timesheet_id = %L $$, (select (r ->> 'priced_timesheet_id')::uuid from pr)),
  'CH409', null, 'R. priced lines are immutable (even as owner)');
select throws_ok($$ delete from public.priced_timesheets $$, 'CH409', null, 'R. priced timesheets are never deleted');

-- ---------------------------------------------------------------------------
-- V / W. S7: ending the relationship releases pending facility sign-offs
-- ---------------------------------------------------------------------------
select is((select status::text from public.timesheets where id = (select walt from ts)), 'agency_approved', 'Walt awaits Gamma''s sign-off');
select pg_temp.exec_as((select alice from ids), 'aal2', format('select public.set_facility_relationship_status(%L, ''ended'')', (select mercy from rel)));
select is((pg_temp.entry_of((select k1 from p))).facility_state::text, 'not_required', 'V. the pending sign-off is no longer required');
select is((select status::text from public.timesheets where id = (select walt from ts)), 'locked', 'V. with nothing left pending the timesheet locks');
select is((select status::text from public.timesheets where id = (select nora from ts)), 'locked', 'V. every affected timesheet is handled');
select is((select count(*)::int from public.timesheet_history where timesheet_id = (select walt from ts) and action = 'facility_signoff_not_required' and reason_code = 'relationship_ended'),
  1, 'V. the transition is in the timesheet history');
select is((select count(*)::int from public.audit_events where action = 'timesheet.signoff_not_required'), 2,
  'V. and audited per timesheet');
select throws_ok(pg_temp.as_sql((select fiona from ids), format('select public.facility_decide_timesheet_entry(%L, 1, true)', (pg_temp.entry_of((select k1 from p))).id)),
  'CHP12', null, 'W. the ended facility has no decision authority');
select is(pg_temp.count_as((select fiona from ids), 'aal1', format('select * from public.list_facility_timesheet_entries(%L)', (select gamma from orgs))), 0,
  'W. and no longer sees the entries');

-- ---------------------------------------------------------------------------
-- J. Missing rate fails closed; the queue and one notification show it
-- ---------------------------------------------------------------------------
select is(pg_temp.price((select finn from fin), (select walt from ts), 1) ->> 'outcome', 'blocked', 'J. no rate ⇒ nothing is priced');
select is((select issues -> 0 ->> 'code' from public.pricing_blocks where timesheet_id = (select walt from ts)), 'RATE_NOT_CONFIGURED',
  'J. the reason is explicit (no zero, no guess)');
select is((select count(*)::int from public.priced_timesheets where timesheet_id = (select walt from ts)), 0, 'J. no partial pricing');
select pg_temp.price((select finn from fin), (select walt from ts), 1);
select is((select attempts from public.pricing_blocks where timesheet_id = (select walt from ts)), 2, 'repeated attempts update one queue row');
select is((select array_agg(recipient_profile_id) from internal.notification_outbox where event = 'pricing_blocked_missing_rate'),
  array[(select alice from ids)], 'other pricing.run holders are notified once per blocked revision (never the person who ran it)');
select is(pg_temp.count_as((select finn from fin), 'aal1', format('select * from public.list_pricing_queue(%L, ''attention'')', (select alpha from orgs))), 1,
  'the blocked timesheet is in the needs-attention queue');

-- An agency-wide card (precedence 4) resolves it.
create temp table rc2 as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_rate_card(%L, ''cna'')', (select alpha from orgs)))::uuid as all_cna;
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.activate_rate_version(public.create_rate_version(%L, ''USD'', 4000, 5500, %L))',
  (select all_cna from rc2), (select ps from per) - 30));
create temp table pw as select pg_temp.price((select finn from fin), (select walt from ts), 1) as r;
select is((select total_pay_minor || '/' || total_bill_minor from public.priced_timesheets where id = (select (r ->> 'priced_timesheet_id')::uuid from pw)),
  '16000/22000', '240 min at the agency-wide rate: $160.00 / $220.00');
select is((select rate_precedence from public.priced_timesheet_lines where priced_timesheet_id = (select (r ->> 'priced_timesheet_id')::uuid from pw)),
  4::smallint, 'fallback to the agency-wide card is explicit (precedence 4)');
select isnt((select resolved_at from public.pricing_blocks where timesheet_id = (select walt from ts)), null, 'the block is resolved, not deleted');

-- U. Currency mismatch
create temp table rc3 as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_rate_card(%L, ''cna'', %L)', (select alpha from orgs), (select mercy from rel)))::uuid as mercy;
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.activate_rate_version(public.create_rate_version(%L, ''CAD'', 4100, 5600, %L))',
  (select mercy from rc3), (select ps from per) - 30));
select is(pg_temp.price((select finn from fin), (select nora from ts), 1) -> 'issues' -> 0 ->> 'code', 'RATE_CURRENCY_MISMATCH',
  'U. one priced timesheet never mixes currencies');

-- ---------------------------------------------------------------------------
-- P / Q. Rate change after pricing; new revision ⇒ new snapshot (with rounding + overtime)
-- ---------------------------------------------------------------------------
create temp table rv2 as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_rate_version(%L, ''USD'', 4400, 6000, %L)', (select riverside from rc), (select ps from per) + 2))::uuid as v2;
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.activate_rate_version(%L)', (select v2 from rv2)));
select is((select total_pay_minor || '/' || total_bill_minor from public.priced_timesheets where id = (select (r ->> 'priced_timesheet_id')::uuid from pr)),
  '66088/90190', 'P. existing pricing is unchanged by a later rate change');
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.set_pricing_policy_status(public.create_rounding_policy(%L, ''nearest'', %L, 15::smallint), ''active'')',
  (select alpha from orgs), (select ps from per) - 60));
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.set_pricing_policy_status(public.create_overtime_policy(%L, ''pay'', ''weekly_threshold'', %L, 600, 3, 2), ''active'')',
  (select alpha from orgs), (select ps from per) - 60));
select pg_temp.exec_as((select alice from ids), 'aal1', format('select public.reopen_timesheet(%L, ''approved_in_error'')', (select wendy from ts)));
select pg_temp.outcome_as((select wendy from ids), format('select * from public.submit_timesheet(%L)', (select wendy from ts)));
select pg_temp.outcome_as((select alice from ids), format('select * from public.approve_timesheet(%L, 2)', (select wendy from ts)));
create temp table pr2 as select pg_temp.price((select finn from fin), (select wendy from ts), 2) as r;
select isnt((select (r ->> 'priced_timesheet_id')::uuid from pr2), (select (r ->> 'priced_timesheet_id')::uuid from pr),
  'Q. the new locked revision gets its own pricing record');
select is((select count(*)::int from public.priced_timesheets where timesheet_id = (select wendy from ts)), 2,
  'Q. the old revision''s pricing is preserved');
select is((select string_agg(priced_minutes || ':' || pay_overtime_minutes || ':' || pay_amount_minor || ':' || bill_amount_minor, ',' order by line_number)
           from public.priced_timesheet_lines where priced_timesheet_id = (select (r ->> 'priced_timesheet_id')::uuid from pr2)),
  '480:0:34000:46400,450:330:45100:45000',
  'rounding 453→450; pay overtime past 600 min at 1.5× ($451.00 at the new rate); bill has no overtime');
select is((select distinct rate_version_id from public.priced_timesheet_lines
           where priced_timesheet_id = (select (r ->> 'priced_timesheet_id')::uuid from pr2) and line_number = 2),
  (select v2 from rv2), 'work on or after the new rate''s start uses the new version');
select is((select count(*)::int from public.audit_events where action = 'pricing.repriced_for_revision'), 1,
  'repricing for a new revision is audited');

select * from finish();
rollback;
