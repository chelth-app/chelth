-- =============================================================================
-- Financial adjustments & control hardening (P0-E7-S3)
-- A/B cross-agency · C worker · D facility · E scheduler · F finance scoped ·
-- G locked+priced newer revision required · H/I originals and their exports
-- unchanged · J delta = new priced − last accounted · K positive · L negative ·
-- M zero delta · N duplicates · P/Q side separation · R currency · S chain
-- 1→2→3 · T locked immutability · U private exports · V/W maker/checker ·
-- X audited denials (safe, deduplicated) · Y search_path · Z no anon/direct writes
-- (O, concurrency, is proven with real parallel sessions in the integration suite.)
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql
\ir _attendance_helpers.psql
\ir _timesheet_helpers.psql

select plan(91);

create temp table fin as
select pg_temp.create_user('finn@example.test') as finn,
       pg_temp.create_user('fran@example.test') as fran,
       pg_temp.create_user('olive@example.test') as olive;
grant select on fin to authenticated;
select pg_temp.add_member((select alpha from orgs), (select finn from fin), 'agency.finance');
select pg_temp.add_member((select alpha from orgs), (select fran from fin), 'agency.finance');
select pg_temp.add_member((select alpha from orgs), (select olive from fin), 'agency.operations_manager');

create temp table per as select internal.period_start_for((select alpha from orgs), current_date - 14) as ps;
grant select on per to authenticated;

-- Wendy: Riverside 480 + 453 min. Walt: Riverside 240 min.
create temp table p as
select
  pg_temp.past_accepted((select riverside from f), (select riverside_main from loc),
    pg_temp.local_ts((select ps from per) + 1, '09:00', 'America/Chicago'), pg_temp.local_ts((select ps from per) + 1, '17:00', 'America/Chicago'),
    (select wendy from w), (select wendy from ids), (select sam from ids), (select alpha from orgs)) as w1,
  pg_temp.past_accepted((select riverside from f), (select riverside_main from loc),
    pg_temp.local_ts((select ps from per) + 2, '09:00', 'America/Chicago'), pg_temp.local_ts((select ps from per) + 2, '17:00', 'America/Chicago'),
    (select wendy from w), (select wendy from ids), (select sam from ids), (select alpha from orgs)) as w2,
  pg_temp.past_accepted((select riverside from f), (select riverside_main from loc),
    pg_temp.local_ts((select ps from per) + 3, '09:00', 'America/Chicago'), pg_temp.local_ts((select ps from per) + 3, '13:00', 'America/Chicago'),
    (select walt from w), (select walt from ids), (select sam from ids), (select alpha from orgs)) as k1;
grant select on p to authenticated;
select pg_temp.past_event((select w1 from p), 'clock_in', pg_temp.local_ts((select ps from per) + 1, '09:00', 'America/Chicago'));
select pg_temp.past_event((select w1 from p), 'clock_out', pg_temp.local_ts((select ps from per) + 1, '17:00', 'America/Chicago'));
select pg_temp.past_event((select w2 from p), 'clock_in', pg_temp.local_ts((select ps from per) + 2, '09:00', 'America/Chicago'));
select pg_temp.past_event((select w2 from p), 'clock_out', pg_temp.local_ts((select ps from per) + 2, '16:33', 'America/Chicago'));
select pg_temp.past_event((select k1 from p), 'clock_in', pg_temp.local_ts((select ps from per) + 3, '09:00', 'America/Chicago'));
select pg_temp.past_event((select k1 from p), 'clock_out', pg_temp.local_ts((select ps from per) + 3, '13:00', 'America/Chicago'));

create temp table ts as
select (pg_temp.timesheet_of((select w1 from p))).id as wendy,
       (pg_temp.timesheet_of((select k1 from p))).id as walt;
grant select on ts to authenticated;
select pg_temp.outcome_as((select wendy from ids), format('select * from public.submit_timesheet(%L)', (select wendy from ts)));
select pg_temp.outcome_as((select walt from ids), format('select * from public.submit_timesheet(%L)', (select walt from ts)));
select pg_temp.outcome_as((select alice from ids), format('select * from public.approve_timesheet(%L, 1)', (select wendy from ts)));
select pg_temp.outcome_as((select alice from ids), format('select * from public.approve_timesheet(%L, 1)', (select walt from ts)));

create temp table rc as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_rate_card(%L, ''cna'', %L)', (select alpha from orgs), (select riverside from rel)))::uuid as riverside;
grant select on rc to authenticated;
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.activate_rate_version(public.create_rate_version(%L, ''USD'', 4250, 5800, %L))',
  (select riverside from rc), (select ps from per) - 30));
select pg_temp.query_as((select finn from fin), 'aal1', format('select * from public.price_timesheet(%L, 1)', (select wendy from ts)));
select pg_temp.query_as((select finn from fin), 'aal1', format('select * from public.price_timesheet(%L, 1)', (select walt from ts)));

-- Original documents: batch b and draft d, both locked and exported.
create temp table b as select pg_temp.scalar_as((select finn from fin), 'aal1', format(
  'select public.create_payroll_batch(%L, %L, ''USD'')', (select alpha from orgs), (select ps from per)))::uuid as id;
grant select on b to authenticated;
select pg_temp.exec_as((select finn from fin), 'aal1', format('select public.review_payroll_batch(%L)', (select id from b)));
select pg_temp.query_as((select finn from fin), 'aal2', format('select * from public.approve_payroll_batch(%L)', (select id from b)));
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.lock_payroll_batch(%L)', (select id from b)));
create temp table e1 as select pg_temp.scalar_as((select finn from fin), 'aal2', format('select public.create_payroll_export(%L)', (select id from b)))::uuid as id;
create temp table d as select pg_temp.scalar_as((select finn from fin), 'aal1', format(
  'select public.create_invoice_draft(%L, %L, %L, ''USD'')', (select alpha from orgs), (select riverside from rel), (select ps from per)))::uuid as id;
grant select on d, e1 to authenticated;
select pg_temp.exec_as((select finn from fin), 'aal1', format('select public.review_invoice_draft(%L)', (select id from d)));
select pg_temp.query_as((select finn from fin), 'aal2', format('select * from public.approve_invoice_draft(%L)', (select id from d)));
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.lock_invoice_draft(%L)', (select id from d)));
create temp table x1 as select pg_temp.scalar_as((select finn from fin), 'aal2', format('select public.create_invoice_export(%L, ''pdf'')', (select id from d)))::uuid as id;
grant select on x1 to authenticated;

-- Snapshot the originals (H/I).
create temp table before_ as
select (select to_jsonb(x) from public.payroll_batches x where x.id = (select id from b)) as batch,
       (select to_jsonb(x) from public.invoice_drafts x where x.id = (select id from d)) as draft,
       (select jsonb_agg(to_jsonb(l) order by l.line_number) from public.payroll_batch_lines l where l.payroll_batch_id = (select id from b)) as batch_lines,
       (select count(*) from public.payroll_batch_history where payroll_batch_id = (select id from b)) as batch_history,
       (select encode(extensions.digest(content, 'sha256'), 'hex') from internal.financial_export_files where export_id = (select id from e1)) as e1_sha,
       (select encode(extensions.digest(content, 'sha256'), 'hex') from internal.financial_export_files where export_id = (select id from x1)) as x1_sha;

create function pg_temp.reason(p_user uuid, p_aal text, p_sql text) returns text language sql as $$
  select pg_temp.query_as(p_user, p_aal, p_sql) -> 0 ->> 'reason_code'
$$;

-- ---------------------------------------------------------------------------
-- G. Only a locked, priced, newer revision of accounted work can be adjusted
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_payroll_adjustment(%L)', (select wendy from ts))),
  'CHY12', null, 'G. nothing to adjust while the accounted revision is current');
select pg_temp.exec_as((select alice from ids), 'aal1', format('select public.reopen_timesheet(%L, ''approved_in_error'')', (select wendy from ts)));
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_payroll_adjustment(%L)', (select wendy from ts))),
  'CHY14', null, 'G. the newer revision must be locked');
select pg_temp.outcome_as((select wendy from ids), format('select * from public.submit_timesheet(%L)', (select wendy from ts)));
select pg_temp.outcome_as((select alice from ids), format('select * from public.approve_timesheet(%L, 2)', (select wendy from ts)));
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_payroll_adjustment(%L)', (select wendy from ts))),
  'CHY15', null, 'G. the newer revision must be priced');
-- Revision 2: $44.00 / $60.00 from day 2 (day 1 unchanged).
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.activate_rate_version(public.create_rate_version(%L, ''USD'', 4400, 6000, %L))',
  (select riverside from rc), (select ps from per) + 2));
select pg_temp.query_as((select finn from fin), 'aal1', format('select * from public.price_timesheet(%L, 2)', (select wendy from ts)));
select is((select state from internal.payroll_adjustment_status((select wendy from ts))), 'required', 'the revision now requires an adjustment');
select is((select count(*)::int from internal.payroll_source_lines((select alpha from orgs)) where not adjustment_required), 0,
  'the newer revision is never offered as ordinary work (no double pay)');

-- E / F. Who may prepare
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.create_payroll_adjustment(%L)', (select wendy from ts))),
  'CHY19', null, 'E. a scheduler cannot prepare an adjustment');
select throws_ok(pg_temp.as_sql((select olive from fin), format('select public.create_payroll_adjustment(%L)', (select wendy from ts)), 'aal2'),
  'CH403', null, 'the operations manager cannot prepare an adjustment');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select public.create_payroll_adjustment(%L)', (select wendy from ts)), 'aal2'),
  'CHY19', null, 'F. another agency cannot adjust this timesheet');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select public.create_payroll_adjustment(%L)', (select wendy from ts))),
  'CHY19', null, 'C. a worker cannot adjust');

-- ---------------------------------------------------------------------------
-- K / J. Positive payroll adjustment
-- ---------------------------------------------------------------------------
create temp table a1 as select pg_temp.scalar_as((select finn from fin), 'aal1', format(
  'select public.create_payroll_adjustment(%L)', (select wendy from ts)))::uuid as id;
grant select on a1 to authenticated;
select matches((select reference from public.payroll_adjustments where id = (select id from a1)), '^PAY-ADJ-[0-9]{4}-000001$',
  'reference PAY-ADJ-YYYY-000001');
select is((select from_revision || '→' || to_revision || ' ' || line_count || ' lines ' || net_delta_minor || ' +' || total_increase_minor || ' -' || total_decrease_minor
           from public.payroll_adjustments where id = (select id from a1)),
  '1→2 1 lines 1132 +1132 -0', 'K. only the changed line: 453 min at $44.00 − $42.50 = +$11.32');
select is((select original_payroll_batch_id from public.payroll_adjustments where id = (select id from a1)), (select id from b),
  'linked to the original batch');
select is((select l.delta_pay_amount_minor = n.pay_amount_minor - bl.pay_amount_minor
           from public.payroll_adjustment_lines l
           join public.priced_timesheet_lines n on n.id = l.new_priced_line_id
           join public.payroll_batch_lines bl on bl.priced_line_id = l.old_priced_line_id and bl.payroll_batch_id = (select id from b)
           where l.payroll_adjustment_id = (select id from a1)),
  true, 'J. delta = new immutable priced amount − the amount in the locked batch');
select is((select old_pay_amount_minor || '→' || new_pay_amount_minor from public.payroll_adjustment_lines where payroll_adjustment_id = (select id from a1)),
  '32088→33220', 'both sides are snapshotted');
select is((select state from internal.payroll_adjustment_status((select wendy from ts))), 'in_progress', 'the transition is now in progress');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_payroll_adjustment(%L)', (select wendy from ts))),
  'CHY13', null, 'N. the same transition cannot be adjusted twice');
select throws_ok(format($$ insert into public.payroll_adjustment_claims (timesheet_id, from_revision, payroll_adjustment_id, agency_organisation_id)
  values (%L, 1, %L, %L) $$, (select wendy from ts), (select id from a1), (select alpha from orgs)),
  '23505', null, 'N. structurally: one claim per revision transition (even as owner)');
select is((select count(*)::int from pg_constraint c
           where c.conrelid = 'public.payroll_adjustment_lines'::regclass and c.contype = 'f'
             and c.confrelid = 'public.priced_timesheet_lines'::regclass
             and c.confkey @> array[(select attnum from pg_attribute where attrelid = 'public.priced_timesheet_lines'::regclass
                                     and attname = 'pay_amount_minor')]),
  2, 'J. both sides of every adjustment line are FK-bound to the exact priced pay amounts (old and new)');
select is((select count(*)::int from information_schema.columns where table_schema = 'public'
           and table_name in ('payroll_adjustments', 'payroll_adjustment_lines') and column_name like '%bill%'), 0,
  'P. payroll adjustments carry no bill-side values');
select is((select count(*)::int from information_schema.columns where table_schema = 'public'
           and table_name in ('invoice_adjustments', 'invoice_adjustment_lines', 'invoice_adjustment_claims')
           and (column_name like '%pay%' or column_name like '%margin%')), 0,
  'Q. invoice adjustments have no pay-side or margin column');

-- Lifecycle with audited denials (V: maker/checker off ⇒ the preparer may approve)
select pg_temp.exec_as((select finn from fin), 'aal1', format('select public.review_payroll_adjustment(%L)', (select id from a1)));
select is(pg_temp.reason((select finn from fin), 'aal1', format('select * from public.approve_payroll_adjustment(%L)', (select id from a1))),
  'MFA_REQUIRED', 'approval requires AAL2 (denied, audited)');
select is(pg_temp.reason((select olive from fin), 'aal2', format('select * from public.approve_payroll_adjustment(%L)', (select id from a1))),
  'NOT_PERMITTED', 'view-only members cannot approve (denied, audited)');
select is(pg_temp.reason((select sam from ids), 'aal2', format('select * from public.approve_payroll_adjustment(%L)', (select id from a1))),
  'NOT_FOUND', 'E. a scheduler cannot approve (denied, audited, no oracle)');
select is(pg_temp.reason((select finn from fin), 'aal2', format('select * from public.approve_payroll_adjustment(%L)', (select id from a1))),
  null, 'V. with maker/checker off the preparer may approve (existing workflow)');
select is((select status::text from public.payroll_adjustments where id = (select id from a1)), 'approved', 'approved');
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.lock_payroll_adjustment(%L)', (select id from a1)));
create temp table ae1 as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_payroll_adjustment_export(%L)', (select id from a1)))::uuid as id;
grant select on ae1 to authenticated;
select is((select split_part(convert_from(content, 'UTF8'), E'\r\n', 1) from internal.financial_export_files where export_id = (select id from ae1)),
  'adjustment_reference,original_batch_reference,previous_adjustment_reference,worker_reference,worker_name,work_date,facility,discipline,original_revision,revised_revision,original_regular_minutes,revised_regular_minutes,original_overtime_minutes,revised_overtime_minutes,original_pay_amount_minor,revised_pay_amount_minor,delta_pay_amount_minor,currency',
  'payroll adjustment CSV header');
select ok((select convert_from(content, 'UTF8') like '%,1,2,453,453,0,0,32088,33220,1132,"USD"' || E'\r\n'
           from internal.financial_export_files where export_id = (select id from ae1)),
  'the CSV row carries original, revised and signed delta amounts');
select is((select total_minor || '/' || source_type from public.financial_exports where id = (select id from ae1)), '1132/payroll_adjustment',
  'the export records the signed net');
select is((select encode(extensions.digest(content, 'sha256'), 'hex') from internal.financial_export_files where export_id = (select id from ae1)),
  (select sha256 from public.financial_exports where id = (select id from ae1)), 'U. checksum over the exact stored bytes');
select is((select status::text from public.payroll_adjustments where id = (select id from a1)), 'exported', 'the first export marks it exported');

-- T. A locked adjustment is immutable
select throws_ok(format($$ update public.payroll_adjustments set net_delta_minor = 0 where id = %L $$, (select id from a1)),
  'CHY03', null, 'T. locked adjustment totals cannot change');
select throws_ok(format($$ update public.payroll_adjustment_lines set delta_pay_amount_minor = 0 where payroll_adjustment_id = %L $$, (select id from a1)),
  'CH409', null, 'T. adjustment lines are immutable');
select throws_ok(format($$ delete from public.payroll_adjustment_claims where payroll_adjustment_id = %L $$, (select id from a1)),
  'CHY03', null, 'T. a locked adjustment never releases its transition');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.cancel_payroll_adjustment(%L, ''late'')', (select id from a1))),
  'CHY03', null, 'T. a locked adjustment cannot be cancelled');

-- H / I. The originals never changed
select is((select to_jsonb(x) from public.payroll_batches x where x.id = (select id from b)), (select batch from before_),
  'H. the original batch row is unchanged (status, totals, reference, timestamps)');
select is((select jsonb_agg(to_jsonb(l) order by l.line_number) from public.payroll_batch_lines l where l.payroll_batch_id = (select id from b)),
  (select batch_lines from before_), 'H. the original batch lines are unchanged');
select is((select count(*) from public.payroll_batch_history where payroll_batch_id = (select id from b)), (select batch_history from before_),
  'H. the original batch history is unchanged');
select is((select encode(extensions.digest(content, 'sha256'), 'hex') from internal.financial_export_files where export_id = (select id from e1)),
  (select e1_sha from before_), 'I. the original payroll export bytes are unchanged');
select is(internal.payroll_batch_attention((select id from b)), 'REVISION_RESOLVED', 'the original batch shows the revision as resolved');

-- ---------------------------------------------------------------------------
-- Invoice adjustment (bill side) — additional charge
-- ---------------------------------------------------------------------------
create temp table i1 as select pg_temp.scalar_as((select finn from fin), 'aal1', format(
  'select public.create_invoice_adjustment(%L, %L)', (select wendy from ts), (select riverside from rel)))::uuid as id;
grant select on i1 to authenticated;
select is((select reference ~ '^INV-ADJ-[0-9]{4}-000001$' and direction = 'additional_charge' and net_delta_minor = 1510
           from public.invoice_adjustments where id = (select id from i1)),
  true, 'INV-ADJ reference, additional charge of +$15.10 (453 min at $60.00 − $58.00)');
select is((select original_invoice_draft_id from public.invoice_adjustments where id = (select id from i1)), (select id from d),
  'linked to the original draft');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_invoice_adjustment(%L, %L)', (select wendy from ts), (select riverside from rel))),
  'CHY13', null, 'N. the same bill-side transition cannot be adjusted twice');
select pg_temp.exec_as((select finn from fin), 'aal1', format('select public.review_invoice_adjustment(%L)', (select id from i1)));
select pg_temp.query_as((select finn from fin), 'aal2', format('select * from public.approve_invoice_adjustment(%L)', (select id from i1)));
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.lock_invoice_adjustment(%L)', (select id from i1)));
create temp table ix as
select pg_temp.scalar_as((select finn from fin), 'aal2', format('select public.create_invoice_adjustment_export(%L, ''pdf'')', (select id from i1)))::uuid as pdf,
       pg_temp.scalar_as((select finn from fin), 'aal2', format('select public.create_invoice_adjustment_export(%L, ''csv'')', (select id from i1)))::uuid as csv;
grant select on ix to authenticated;
select ok((select convert_from(content, 'UTF8') like '%(DRAFT INVOICE ADJUSTMENT)%(Additional charge)%Not a tax invoice, credit note%'
           from internal.financial_export_files where export_id = (select pdf from ix)),
  'the PDF is marked DRAFT INVOICE ADJUSTMENT — Additional charge, not a tax invoice or credit note');
select ok((select convert_from(content, 'UTF8') !~ '(4250|4400|32088|33220|1132)' from internal.financial_export_files where export_id = (select csv from ix)),
  'Q. the invoice adjustment CSV contains no pay values');
select ok((select convert_from(content, 'UTF8') like '%,43790,45300,1510,"USD"%' from internal.financial_export_files where export_id = (select csv from ix)),
  'the invoice adjustment CSV carries original, revised and delta bill amounts');
select is((select encode(extensions.digest(content, 'sha256'), 'hex') from internal.financial_export_files where export_id = (select id from x1)),
  (select x1_sha from before_), 'I. the original draft invoice PDF bytes are unchanged');
select is((select to_jsonb(x) from public.invoice_drafts x where x.id = (select id from d)), (select draft from before_),
  'H. the original invoice draft is unchanged');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.void_invoice_draft(%L, ''oops'')', (select id from d)), 'aal2'),
  'CHY21', null, 'an original draft that roots an adjustment chain cannot be voided');

-- ---------------------------------------------------------------------------
-- S / L / W. Revision 3 (negative) adjusts against revision 2, with maker/checker on
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.set_financial_maker_checker(%L, true)', (select alpha from orgs))),
  'CH402', null, 'enabling maker/checker requires AAL2');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.set_financial_maker_checker(%L, true)', (select alpha from orgs)), 'aal2'),
  'CH403', null, 'a scheduler cannot change financial controls');
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.set_financial_maker_checker(%L, true)', (select alpha from orgs)));
select is((select count(*)::int from public.audit_events where action = 'financial.maker_checker_updated'), 1, 'the setting change is audited');

-- A more specific card (relationship + discipline + regular shifts): $40.00 / $55.00 for all work.
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.activate_rate_version(public.create_rate_version(public.create_rate_card(%L, ''cna'', %L, ''regular''), ''USD'', 4000, 5500, %L))',
  (select alpha from orgs), (select riverside from rel), (select ps from per) - 30));
select pg_temp.exec_as((select alice from ids), 'aal1', format('select public.reopen_timesheet(%L, ''approved_in_error'')', (select wendy from ts)));
select pg_temp.outcome_as((select wendy from ids), format('select * from public.submit_timesheet(%L)', (select wendy from ts)));
select pg_temp.outcome_as((select alice from ids), format('select * from public.approve_timesheet(%L, 3)', (select wendy from ts)));
select pg_temp.query_as((select finn from fin), 'aal1', format('select * from public.price_timesheet(%L, 3)', (select wendy from ts)));
select is(internal.payroll_batch_attention((select id from b)), 'ADJUSTMENT_REQUIRED', 'a further revision reopens the need for adjustment');

create temp table a2 as select pg_temp.scalar_as((select finn from fin), 'aal1', format(
  'select public.create_payroll_adjustment(%L)', (select wendy from ts)))::uuid as id;
grant select on a2 to authenticated;
select is((select from_revision || '→' || to_revision from public.payroll_adjustments where id = (select id from a2)), '2→3',
  'S. the next step compares against the last accounted revision (2), not revision 1');
select is((select previous_adjustment_id from public.payroll_adjustments where id = (select id from a2)), (select id from a1),
  'S. the chain links the previous adjustment');
select is((select original_payroll_batch_id from public.payroll_adjustments where id = (select id from a2)), (select id from b),
  'S. and still the root original batch');
select is((select line_count || ' lines ' || net_delta_minor || ' +' || total_increase_minor || ' -' || total_decrease_minor
           from public.payroll_adjustments where id = (select id from a2)),
  '2 lines -5020 +0 -5020', 'L. negative: 480 min $340.00→$320.00 and 453 min $332.20→$302.00');
select is((select string_agg(old_pay_amount_minor || '→' || new_pay_amount_minor || '=' || delta_pay_amount_minor, ',' order by line_number)
           from public.payroll_adjustment_lines where payroll_adjustment_id = (select id from a2)),
  '34000→32000=-2000,33220→30200=-3020', 'signed line deltas against the previously accounted values');
select pg_temp.exec_as((select finn from fin), 'aal1', format('select public.review_payroll_adjustment(%L)', (select id from a2)));
select is(pg_temp.reason((select finn from fin), 'aal2', format('select * from public.approve_payroll_adjustment(%L)', (select id from a2))),
  'MAKER_CHECKER', 'W. with maker/checker on, the preparer cannot approve');
select is(pg_temp.reason((select finn from fin), 'aal2', format('select * from public.approve_payroll_adjustment(%L)', (select id from a2))),
  'MAKER_CHECKER', 'W. …however often they try');
select is((select status::text from public.payroll_adjustments where id = (select id from a2)), 'reviewed', 'W. nothing changed');
select is(pg_temp.reason((select fran from fin), 'aal2', format('select * from public.approve_payroll_adjustment(%L)', (select id from a2))),
  null, 'W. a second finance member approves');
select is((select approved_by_membership_id <> created_by_membership_id from public.payroll_adjustments where id = (select id from a2)), true,
  'W. preparer ≠ approver is recorded');
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.lock_payroll_adjustment(%L)', (select id from a2)));


-- X. Denials are audited safely and deduplicated
select is((select count(*)::int from public.audit_events where action = 'financial.action_denied'
           and target_id = (select id from a2) and metadata ->> 'reason_code' = 'MAKER_CHECKER'), 1,
  'X. two identical denials within 15 minutes produce one audit row');
select is((select array_agg(k order by k) from public.audit_events e, jsonb_object_keys(e.metadata) k
           where e.action = 'financial.action_denied' and e.target_id = (select id from a2)),
  array['attempted_action', 'reason_code'], 'X. denial metadata is the attempted action and a reason code only');
select is((select organisation_id from public.audit_events where action = 'financial.action_denied'
           and target_id = (select id from a2)), (select alpha from orgs), 'X. recorded in the agency''s history');
select is((select count(*)::int from public.audit_events where action = 'financial.action_denied'
           and metadata ->> 'reason_code' in ('MFA_REQUIRED', 'NOT_PERMITTED', 'NOT_FOUND')
           and metadata ->> 'attempted_action' = 'payroll.adjustment_approve'), 3, 'X. AAL, capability and visibility denials are audited');
select is(pg_temp.query_as((select bob from ids), 'aal2', format('select * from public.download_financial_export(%L)', (select id from ae1))) -> 0 ->> 'denied_reason',
  'NOT_FOUND', 'U. another agency cannot download an adjustment export');
select is((select organisation_id from public.audit_events where action = 'financial.action_denied'
           and target_id = (select id from ae1) and metadata ->> 'attempted_action' = 'financial.export_download'), null,
  'X. a non-member''s denial is audited without entering the agency''s history');
select is(pg_temp.query_as((select wendy from ids), 'aal1', format('select * from public.download_financial_export(%L)', (select id from ae1))) -> 0 ->> 'denied_reason',
  'NOT_FOUND', 'C. a worker cannot download an adjustment export');

-- Invoice credit for revision 3 (approved by the second person).
create temp table i2 as select pg_temp.scalar_as((select finn from fin), 'aal1', format(
  'select public.create_invoice_adjustment(%L, %L)', (select wendy from ts), (select riverside from rel)))::uuid as id;
grant select on i2 to authenticated;
select is((select direction || ' ' || net_delta_minor || ' ' || from_revision || '→' || to_revision from public.invoice_adjustments where id = (select id from i2)),
  'credit -6175 2→3', 'L. credit: 480 min $464.00→$440.00 and 453 min $453.00→$415.25');
select pg_temp.exec_as((select finn from fin), 'aal1', format('select public.review_invoice_adjustment(%L)', (select id from i2)));
select is(pg_temp.reason((select finn from fin), 'aal2', format('select * from public.approve_invoice_adjustment(%L)', (select id from i2))),
  'MAKER_CHECKER', 'W. maker/checker applies to invoice adjustments');
select is(pg_temp.reason((select fran from fin), 'aal2', format('select * from public.approve_invoice_adjustment(%L)', (select id from i2))),
  null, 'W. a second person approves the credit');
select pg_temp.exec_as((select fran from fin), 'aal2', format('select public.lock_invoice_adjustment(%L)', (select id from i2)));
select is((select previous_adjustment_id from public.invoice_adjustments where id = (select id from i2)), (select id from i1),
  'S. the invoice chain links the previous adjustment');

-- ---------------------------------------------------------------------------
-- M. A revision with no financial change creates no document and is resolved
-- ---------------------------------------------------------------------------
select pg_temp.exec_as((select alice from ids), 'aal1', format('select public.reopen_timesheet(%L, ''approved_in_error'')', (select wendy from ts)));
select pg_temp.outcome_as((select wendy from ids), format('select * from public.submit_timesheet(%L)', (select wendy from ts)));
select pg_temp.outcome_as((select alice from ids), format('select * from public.approve_timesheet(%L, 4)', (select wendy from ts)));
select pg_temp.query_as((select finn from fin), 'aal1', format('select * from public.price_timesheet(%L, 4)', (select wendy from ts)));
select is((select state from internal.payroll_adjustment_status((select wendy from ts))), 'no_change', 'M. revision 4 is financially identical');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_payroll_adjustment(%L)', (select wendy from ts))),
  'CHY18', null, 'M. no meaningless zero-delta document');
select is((select count(*)::int from internal.payroll_source_lines((select alpha from orgs)) s
           where s.timesheet_id = (select wendy from ts)), 0, 'M. and its work is not offered again (no double pay)');
select is(internal.payroll_batch_attention((select id from b)), 'REVISION_RESOLVED', 'M. the original shows the revision resolved');
select is((select array_agg((x ->> 'state') || ':' || (x ->> 'line_count') || ':' || (x ->> 'amount_minor') order by x ->> 'state')
           from jsonb_array_elements(pg_temp.query_as((select finn from fin), 'aal1',
             format('select * from public.financial_reconciliation(%L, ''pay'')', (select alpha from orgs)))) x),
  array['adjusted:3:-3888', 'exported:3:83088'], 'reconciliation: originals exported, adjustments adjusted (+1132 − 5020), nothing unresolved');

-- ---------------------------------------------------------------------------
-- R. Currency is structural
-- ---------------------------------------------------------------------------
select throws_ok(format($$ insert into public.payroll_adjustments
    (agency_organisation_id, reference, timesheet_id, agency_worker_id, profile_id, period_start, period_end, from_revision,
     to_revision, from_priced_timesheet_id, to_priced_timesheet_id, original_payroll_batch_id, currency, line_count,
     delta_regular_minutes, delta_overtime_minutes, total_increase_minor, total_decrease_minor, net_delta_minor,
     worker_name, created_by_membership_id)
  select agency_organisation_id, 'PAY-ADJ-2099-999999', timesheet_id, agency_worker_id, profile_id, period_start, period_end,
     3, 4, to_priced_timesheet_id, (select id from public.priced_timesheets where timesheet_id = %L and timesheet_revision = 4),
     original_payroll_batch_id, 'CAD', 1, 0, 0, 0, 0, 0, worker_name, created_by_membership_id
  from public.payroll_adjustments where id = %L $$, (select wendy from ts), (select id from a2)),
  '23503', null, 'R. an adjustment in another currency than its sources and original cannot exist');

-- ---------------------------------------------------------------------------
-- A / B / C / D / X reads
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select bob from ids), 'aal2', 'select * from public.payroll_adjustments'), 0, 'A. another agency reads no payroll adjustments');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select * from public.get_payroll_adjustment(%L)', (select id from a1)), 'aal2'),
  'CHY19', null, 'A. …nor by id');
select is(pg_temp.count_as((select bob from ids), 'aal2', 'select * from public.invoice_adjustment_lines'), 0, 'B. another agency reads no invoice adjustments');
select is(pg_temp.count_as((select wendy from ids), 'aal1', 'select * from public.payroll_adjustment_lines'), 0, 'C. a worker reads no adjustments');
select is(pg_temp.count_as((select fiona from ids), 'aal2', 'select * from public.invoice_adjustments'), 0, 'D. a facility reads no invoice adjustments');
select throws_ok(pg_temp.as_sql((select fiona from ids), format('select * from public.list_invoice_adjustments(%L)', (select alpha from orgs)), 'aal2'),
  'CH403', null, 'D. …or adjustment projections');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.payroll_adjustments'), 0, 'X. a platform admin has no tenant path');
select is(pg_temp.count_as((select olive from fin), 'aal1', 'select * from public.payroll_adjustments'), 2, 'view-only members see adjustments');

-- ---------------------------------------------------------------------------
-- Y / Z
-- ---------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'internal') and p.prosecdef
             and p.proname ~ '(adjustment|financial|maker_checker)'
             and not ('search_path=""' = any (coalesce(p.proconfig, '{}')))), 0,
  'Y. every SECURITY DEFINER adjustment/control function pins an empty search_path');
select is((select count(*)::int from information_schema.role_table_grants
           where table_schema = 'public' and grantee in ('anon', 'PUBLIC') and table_name ~ 'adjustment'), 0,
  'Z. anon holds nothing on adjustment tables');
select throws_ok(pg_temp.as_sql((select finn from fin), format($$ update public.payroll_adjustments set status = 'cancelled' where id = %L $$, (select id from a2)), 'aal2'),
  '42501', null, 'Z. no direct writes, even for finance');
select throws_ok(pg_temp.as_sql((select finn from fin), format($$ delete from public.invoice_adjustment_claims where invoice_adjustment_id = %L $$, (select id from i2)), 'aal2'),
  '42501', null, 'Z. no direct claim release');

select * from finish();
rollback;
