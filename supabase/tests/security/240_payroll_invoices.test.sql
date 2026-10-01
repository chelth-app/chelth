-- =============================================================================
-- Payroll preparation & invoice drafting (P0-E7-S2)
-- A/B cross-agency · C/D worker · E/F facility · G/H scheduler · I finance
-- scoped to its agency · J/K immutable source lines (pay / bill side) · L/M no
-- client amounts · N/O duplicate inclusion · P/Q locked immutability · R/S
-- revisions · T/U private exports · V download authorisation · W CSV formula
-- injection · X platform admin · Y pinned search_path · Z no anon / direct writes
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql
\ir _attendance_helpers.psql
\ir _timesheet_helpers.psql

select plan(117);

create temp table fin as
select pg_temp.create_user('finn@example.test') as finn,
       pg_temp.create_user('olive@example.test') as olive;
grant select on fin to authenticated;
select pg_temp.add_member((select alpha from orgs), (select finn from fin), 'agency.finance');
select pg_temp.add_member((select alpha from orgs), (select olive from fin), 'agency.operations_manager');

create temp table per as select internal.period_start_for((select alpha from orgs), current_date - 14) as ps;
grant select on per to authenticated;

-- W setup: names and references that look like spreadsheet formulas.
update public.profiles set display_name = '=HYPERLINK("http://x","Wendy, ""W""")' where id = (select wendy from ids);
update public.agency_workers set worker_reference = '+W-001' where id = (select wendy from w);

-- Wendy: Riverside 480 + 453 min. Walt: Riverside 240 min. Riverside is unlinked ⇒ approval locks.
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

-- Riverside: $42.50 pay / $58.00 bill per hour.
create temp table rc as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_rate_card(%L, ''cna'', %L)', (select alpha from orgs), (select riverside from rel)))::uuid as riverside;
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.activate_rate_version(public.create_rate_version(%L, ''USD'', 4250, 5800, %L))',
  (select riverside from rc), (select ps from per) - 30));
select pg_temp.query_as((select finn from fin), 'aal1', format('select * from public.price_timesheet(%L, 1)', (select wendy from ts)));
select pg_temp.query_as((select finn from fin), 'aal1', format('select * from public.price_timesheet(%L, 1)', (select walt from ts)));

-- ---------------------------------------------------------------------------
-- Capabilities, periods, settings
-- ---------------------------------------------------------------------------
select is((select array_agg(capability_key order by capability_key) from public.role_capabilities
           where role_key = 'agency.operations_manager' and capability_key ~ '^(payroll|invoice)\.'),
  array['invoice.view', 'payroll.view'], 'the operations manager can only view payroll and invoices');
select is((select count(*)::int from public.role_capabilities
           where role_key in ('agency.scheduler', 'agency.recruiter', 'agency.credentialing_officer', 'agency.healthcare_worker')
             and capability_key ~ '^(payroll|invoice)\.'),
  0, 'schedulers, recruiters, credentialing and workers hold no financial capability');
select is((select count(*)::int from public.role_capabilities where role_key like 'facility.%' and capability_key ~ '^(payroll|invoice)\.'),
  0, 'facility roles hold no financial capability');
select is((select array_agg(key order by key) from public.capabilities where is_privileged and key ~ '^(payroll|invoice)\.'),
  array['invoice.approve', 'invoice.export', 'payroll.approve', 'payroll.export'], 'approve and export require AAL2');
select is((select period_start || '/' || period_end from internal.payroll_period_for((select alpha from orgs), (select ps from per) + 3)),
  (select ps || '/' || ps + 6 from per), 'default payroll period: the timesheet week (dates only)');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.set_agency_financial_settings(%L, ''biweekly'', %L)',
  (select alpha from orgs), (select ps from per))), 'CH402', null, 'payroll settings require AAL2');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_payroll_batch(%L, %L, ''USD'')',
  (select alpha from orgs), (select ps from per) + 1)), 'CHY05', null, 'a batch must start on a payroll period boundary');

-- ---------------------------------------------------------------------------
-- G / H / I / L / M. Who can prepare, and what they can send
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.create_payroll_batch(%L, %L, ''USD'')',
  (select alpha from orgs), (select ps from per))), 'CH403', null, 'G. a scheduler cannot prepare payroll');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select public.create_invoice_draft(%L, %L, %L, ''USD'')',
  (select alpha from orgs), (select riverside from rel), (select ps from per))), 'CH403', null, 'H. a scheduler cannot draft invoices');
select throws_ok(pg_temp.as_sql((select olive from fin), format('select public.create_payroll_batch(%L, %L, ''USD'')',
  (select alpha from orgs), (select ps from per))), 'CH403', null, 'the operations manager cannot prepare payroll');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_payroll_batch(%L, %L, ''USD'')',
  (select beta from orgs), (select ps from per)), 'aal2'), 'CH403', null, 'I. finance cannot prepare another agency''s payroll');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select * from public.list_invoice_drafts(%L)', (select beta from orgs)), 'aal2'),
  'CH403', null, 'I. finance cannot read another agency''s invoices');
select is((select array_agg(a order by a) from unnest((select proargnames from pg_proc where proname = 'create_payroll_batch')) a),
  array['p_currency', 'p_organisation_id', 'p_period_start'], 'L. preparing payroll takes identifiers only — no pay amount');
select is((select array_agg(a order by a) from unnest((select proargnames from pg_proc where proname = 'create_invoice_draft')) a),
  array['p_currency', 'p_organisation_id', 'p_period_start', 'p_relationship_id'], 'M. drafting an invoice takes identifiers only — no bill amount');

-- ---------------------------------------------------------------------------
-- Payroll batch: prepare (released on cancel), exact totals
-- ---------------------------------------------------------------------------
create temp table b0 as select pg_temp.scalar_as((select finn from fin), 'aal1', format(
  'select public.create_payroll_batch(%L, %L, ''USD'')', (select alpha from orgs), (select ps from per)))::uuid as id;
grant select on b0 to authenticated;
select matches((select reference from public.payroll_batches where id = (select id from b0)), '^PAY-[0-9]{4}-000001$',
  'human-readable reference PAY-YYYY-000001');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_payroll_batch(%L, %L, ''USD'')',
  (select alpha from orgs), (select ps from per))), 'CHY01', null, 'N. the same work cannot be prepared twice');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.cancel_payroll_batch(%L, '' '')', (select id from b0))),
  'CH400', null, 'cancelling needs a reason');
select pg_temp.exec_as((select finn from fin), 'aal1', format('select public.cancel_payroll_batch(%L, ''Prepared too early'')', (select id from b0)));
select is((select count(*)::int from public.payroll_line_claims where payroll_batch_id = (select id from b0)), 0,
  'a batch cancelled before lock releases its lines');
select is((select count(*)::int from public.payroll_batch_lines where payroll_batch_id = (select id from b0)), 3,
  'the cancelled batch keeps its lines as history');

create temp table b as select pg_temp.scalar_as((select finn from fin), 'aal1', format(
  'select public.create_payroll_batch(%L, %L, ''USD'')', (select alpha from orgs), (select ps from per)))::uuid as id;
grant select on b to authenticated;
select matches((select reference from public.payroll_batches where id = (select id from b)), '^PAY-[0-9]{4}-000002$',
  'references are monotonic per agency');
select is((select line_count || '/' || worker_count || '/' || total_pay_minor from public.payroll_batches where id = (select id from b)),
  '3/2/83088', 'batch totals: 3 lines, 2 workers, $830.88 ($340.00 + $320.88 + $170.00)');
select is((select total_pay_minor from public.payroll_batches where id = (select id from b)),
  (select sum(total_pay_minor)::bigint from public.priced_timesheets), 'money: the batch total equals the priced pay totals exactly');
select is((select count(*)::int from public.payroll_batch_lines l join public.priced_timesheet_lines s on s.id = l.priced_line_id
           where l.payroll_batch_id = (select id from b)
             and (l.pay_amount_minor, l.pay_rate_minor, l.regular_minutes, l.overtime_minutes, l.timesheet_revision, l.calculation_version)
               = (s.pay_amount_minor, s.pay_rate_minor, s.pay_regular_minutes, s.pay_overtime_minutes, s.timesheet_revision, s.calculation_version)),
  3, 'J. every line is an exact copy of an immutable priced line');
select is((select sum((x ->> 'total_pay_minor')::bigint) from jsonb_array_elements(pg_temp.query_as((select finn from fin), 'aal1',
           format('select * from public.list_payroll_batch_workers(%L)', (select id from b)))) x)::bigint, 83088::bigint,
  'worker totals add up to the batch total');
-- J / L / N structurally (as owner, bypassing every RPC): a scratch draft batch.
insert into public.payroll_batches (agency_organisation_id, payroll_period_id, period_start, period_end, currency, reference,
  line_count, worker_count, total_regular_minutes, total_overtime_minutes, total_pay_minor, created_by_membership_id)
select agency_organisation_id, payroll_period_id, period_start, period_end, currency, 'PAY-2099-999999', 1, 1, 0, 0, 1, created_by_membership_id
from public.payroll_batches where id = (select id from b);
create temp table scratch as select id from public.payroll_batches where reference = 'PAY-2099-999999';
create function pg_temp.copy_line(p_target uuid, p_extra bigint) returns void language sql as $$
  insert into public.payroll_batch_lines
    (payroll_batch_id, agency_organisation_id, period_start, period_end, currency, line_number, priced_line_id, priced_timesheet_id,
     timesheet_id, timesheet_revision, entry_id, agency_worker_id, profile_id, agency_facility_id, relationship_id, discipline_key,
     work_date, regular_minutes, overtime_minutes, pay_rate_minor, pay_amount_minor, calculation_version, worker_name, facility_name, discipline_name)
  select p_target, agency_organisation_id, period_start, period_end, currency, 1, priced_line_id, priced_timesheet_id,
     timesheet_id, timesheet_revision, entry_id, agency_worker_id, profile_id, agency_facility_id, relationship_id, discipline_key,
     work_date, regular_minutes, overtime_minutes, pay_rate_minor, pay_amount_minor + p_extra, calculation_version, worker_name, facility_name, discipline_name
  from public.payroll_batch_lines where payroll_batch_id = (select id from b) order by line_number limit 1
$$;
select throws_ok($$ select pg_temp.copy_line((select id from scratch), 1) $$,
  '23503', null, 'J/L. a line whose amount differs from its priced source cannot exist (even as owner)');
select pg_temp.copy_line((select id from scratch), 0);
select throws_ok($$ insert into public.payroll_line_claims
    (priced_line_id, payroll_batch_id, payroll_batch_line_id, agency_organisation_id, timesheet_id, timesheet_revision)
  select priced_line_id, payroll_batch_id, id, agency_organisation_id, timesheet_id, timesheet_revision
  from public.payroll_batch_lines where payroll_batch_id = (select id from scratch) $$,
  '23505', null, 'N. structurally: a pay line can sit in only one active batch');
update public.payroll_batches set status = 'cancelled', cancelled_at = now(), cancel_reason = 'scratch' where id = (select id from scratch);

-- Lifecycle
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.approve_payroll_batch(%L)', (select id from b)), 'aal2'),
  'CHY04', null, 'a batch is reviewed before approval');
select pg_temp.exec_as((select finn from fin), 'aal1', format('select public.review_payroll_batch(%L)', (select id from b)));
select is(pg_temp.query_as((select finn from fin), 'aal1', format('select * from public.approve_payroll_batch(%L)', (select id from b))) -> 0 ->> 'reason_code',
  'MFA_REQUIRED', 'approval requires AAL2 (denied and audited)');
select is(pg_temp.query_as((select olive from fin), 'aal2', format('select * from public.approve_payroll_batch(%L)', (select id from b))) -> 0 ->> 'reason_code',
  'NOT_PERMITTED', 'the operations manager cannot approve (denied and audited)');
select is(pg_temp.query_as((select sam from ids), 'aal2', format('select * from public.approve_payroll_batch(%L)', (select id from b))) -> 0 ->> 'reason_code',
  'NOT_FOUND', 'G. a scheduler cannot approve payroll (not even see it) (denied and audited)');
select lives_ok(pg_temp.as_sql((select finn from fin), format('select public.approve_payroll_batch(%L)', (select id from b)), 'aal2'),
  'finance approves at AAL2');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_payroll_export(%L)', (select id from b)), 'aal2'),
  'CHY04', null, 'only a locked batch can be exported');
select lives_ok(pg_temp.as_sql((select finn from fin), format('select public.lock_payroll_batch(%L)', (select id from b)), 'aal2'),
  'approval → lock');
select is((select array_agg(action order by to_status) from public.payroll_batch_history where payroll_batch_id = (select id from b)),
  array['created', 'reviewed', 'approved', 'locked'], 'append-only lifecycle history');

-- P. Locked batches are immutable
select throws_ok(format($$ update public.payroll_batches set total_pay_minor = 1 where id = %L $$, (select id from b)),
  'CHY03', null, 'P. locked totals cannot change (even as owner)');
select throws_ok(format($$ update public.payroll_batches set status = 'draft' where id = %L $$, (select id from b)),
  'CHY04', null, 'P. a locked batch cannot go back');
select throws_ok(format($$ update public.payroll_batch_lines set pay_amount_minor = 0 where payroll_batch_id = %L $$, (select id from b)),
  'CH409', null, 'P. batch lines are immutable');
select throws_ok(format($$ delete from public.payroll_line_claims where payroll_batch_id = %L $$, (select id from b)),
  'CHY03', null, 'P. a locked batch never releases its lines');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.cancel_payroll_batch(%L, ''late'')', (select id from b))),
  'CHY03', null, 'P. a locked batch cannot be cancelled');
select throws_ok($$ delete from public.payroll_batches $$, 'CHY03', null, 'P. batches are never deleted');

-- Export
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_payroll_export(%L)', (select id from b))),
  'CH402', null, 'exporting requires AAL2');
create temp table e1 as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_payroll_export(%L)', (select id from b)))::uuid as id;
grant select on e1 to authenticated;
select is((select status::text from public.payroll_batches where id = (select id from b)), 'exported', 'the first export marks the batch exported');
select is((select row_count || '/' || total_minor || '/' || currency || '/' || format || '/' || export_version || '/' || source_status
           from public.financial_exports where id = (select id from e1)),
  '3/83088/USD/csv/1/locked', 'the export snapshot records rows, total, currency, format, version and source status');
select is((select encode(extensions.digest(f.content, 'sha256'), 'hex') from internal.financial_export_files f where f.export_id = (select id from e1)),
  (select sha256 from public.financial_exports where id = (select id from e1)), 'the SHA-256 is computed over the stored bytes');
select is((select split_part(convert_from(content, 'UTF8'), E'\r\n', 1) from internal.financial_export_files where export_id = (select id from e1)),
  'batch_reference,worker_reference,worker_name,period_start,period_end,work_date,facility,discipline,regular_minutes,overtime_minutes,pay_rate_minor,pay_amount_minor,currency',
  'payroll CSV header (exact columns)');
create temp table e2 as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_payroll_export(%L)', (select id from b)))::uuid as id;
select is((select sha256 from public.financial_exports where id = (select id from e2)),
  (select sha256 from public.financial_exports where id = (select id from e1)), 'exports are deterministic: same bytes, same checksum');
select is((select export_number from public.financial_exports where id = (select id from e2)), 2, 're-exports are numbered');
select is((select count(*)::int from public.audit_events where action = 'payroll.export_created'), 2, 'every export is audited');

-- W. CSV formula injection
select ok((select convert_from(content, 'UTF8') from internal.financial_export_files where export_id = (select id from e1))
          like '%"''=HYPERLINK(""http://x"",""Wendy, """"W"""""")"%',
  'W. a formula-like name is prefixed with a quote, its quotes doubled and the field quoted');
select ok((select convert_from(content, 'UTF8') from internal.financial_export_files where export_id = (select id from e1))
          like '%"''+W-001"%', 'W. a reference starting with + is neutralised');
select is(internal.csv_text('-1+2') || internal.csv_text('@SUM(A1)') || internal.csv_text(E'\tx') || internal.csv_text('  =1')
          || internal.csv_text('safe, "quoted"') || internal.csv_text(E'two\nlines') || internal.csv_text(null) || internal.csv_text('José'),
  E'"''-1+2""''@SUM(A1)""''\tx""''  =1""safe, ""quoted""""two\nlines""""José"',
  'W. = + - @ TAB CR (after optional spaces) are neutralised; commas, quotes, newlines, empty and non-ASCII are preserved');
select is((select count(*)::int from regexp_split_to_table((select convert_from(content, 'UTF8') from internal.financial_export_files
           where export_id = (select id from e1)), E'\r\n') x where x <> ''), 4, 'one header and one row per line, CRLF-terminated');

-- T / V. Private storage and download authorisation
select ok(not has_table_privilege('authenticated', 'internal.financial_export_files', 'select'), 'T. export bytes are not readable by any API role');
select ok(not has_schema_privilege('authenticated', 'internal', 'usage'), 'T. the private schema is not reachable');
select is((select sum(byte_size)::int from public.financial_exports where id = (select id from e1)),
  (select octet_length(content) from internal.financial_export_files where export_id = (select id from e1)), 'byte size recorded exactly');
select is(pg_temp.count_as((select olive from fin), 'aal1', 'select * from public.financial_exports'), 2,
  'payroll.view sees export metadata (no bytes)');
select is((select convert_from(decode(pg_temp.query_as((select finn from fin), 'aal2', format(
  'select * from public.download_financial_export(%L)', (select id from e1))) -> 0 ->> 'content_base64', 'base64'), 'UTF8')),
  (select convert_from(content, 'UTF8') from internal.financial_export_files where export_id = (select id from e1)),
  'V. finance downloads the exact bytes at AAL2');
select is((select count(*)::int from public.audit_events where action = 'payroll.export_downloaded' and target_id = (select id from e1)), 1,
  'V. the download is audited');
select is(pg_temp.query_as((select finn from fin), 'aal1', format('select * from public.download_financial_export(%L)', (select id from e1))) -> 0 ->> 'denied_reason',
  'MFA_REQUIRED', 'V. downloading requires AAL2 (denied and audited)');
select is(pg_temp.query_as((select olive from fin), 'aal2', format('select * from public.download_financial_export(%L)', (select id from e1))) -> 0 ->> 'denied_reason',
  'NOT_PERMITTED', 'V. view-only members cannot download (denied and audited)');
select is(pg_temp.query_as((select bob from ids), 'aal2', format('select * from public.download_financial_export(%L)', (select id from e1))) -> 0 ->> 'denied_reason',
  'NOT_FOUND', 'V. another agency cannot download (no oracle) (denied and audited)');
select is(pg_temp.query_as((select wendy from ids), 'aal1', format('select * from public.download_financial_export(%L)', (select id from e1))) -> 0 ->> 'denied_reason',
  'NOT_FOUND', 'V. a worker cannot download (denied and audited)');
select is(pg_temp.query_as((select fiona from ids), 'aal2', format('select * from public.download_financial_export(%L)', (select id from e1))) -> 0 ->> 'denied_reason',
  'NOT_FOUND', 'V. a facility cannot download (denied and audited)');

-- A / C / E / X. Reads
select is(pg_temp.count_as((select bob from ids), 'aal2', 'select * from public.payroll_batches'), 0, 'A. another agency reads no payroll batches');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select * from public.get_payroll_batch(%L)', (select id from b)), 'aal2'),
  'CHY06', null, 'A. …nor by id');
select is(pg_temp.count_as((select wendy from ids), 'aal1', 'select * from public.payroll_batch_lines'), 0, 'C. a worker reads no payroll lines');
select is(pg_temp.count_as((select wendy from ids), 'aal1', 'select * from public.payroll_batches'), 0, 'C. …or batches');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.list_payroll_batches(%L)', (select alpha from orgs))),
  'CH403', null, 'C. …or payroll projections');
select is(pg_temp.count_as((select fiona from ids), 'aal2', 'select * from public.payroll_batch_lines'), 0, 'E. a facility reads no payroll');
select is(pg_temp.count_as((select fiona from ids), 'aal2', 'select * from public.financial_exports'), 0, 'E. …or exports');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.payroll_batches'), 0, 'X. a platform admin has no tenant payroll path');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.invoice_drafts'), 0, 'X. …or invoice path');

-- ---------------------------------------------------------------------------
-- Invoice drafts (bill side only)
-- ---------------------------------------------------------------------------
select is((select count(*)::int from information_schema.columns
           where table_schema = 'public' and table_name in ('invoice_drafts', 'invoice_draft_lines', 'invoice_line_claims')
             and (column_name like '%pay%' or column_name like '%margin%')),
  0, 'K. invoice tables have no pay-side or margin column');
create temp table d as select pg_temp.scalar_as((select finn from fin), 'aal1', format(
  'select public.create_invoice_draft(%L, %L, %L, ''USD'')', (select alpha from orgs), (select riverside from rel), (select ps from per)))::uuid as id;
grant select on d to authenticated;
select matches((select reference from public.invoice_drafts where id = (select id from d)), '^INV-DRAFT-[0-9]{4}-000001$',
  'human-readable draft reference INV-DRAFT-YYYY-000001');
select is((select line_count || '/' || total_bill_minor || '/' || total_priced_minutes from public.invoice_drafts where id = (select id from d)),
  '3/113390/1173', 'draft totals: $1,133.90 bill for 1,173 minutes');
select is((select total_bill_minor from public.invoice_drafts where id = (select id from d)),
  (select sum(total_bill_minor)::bigint from public.priced_timesheets), 'money: the draft total equals the priced bill totals exactly');
select is((select count(*)::int from public.invoice_draft_lines l join public.priced_timesheet_lines s on s.id = l.priced_line_id
           where l.invoice_draft_id = (select id from d)
             and (l.bill_amount_minor, l.bill_rate_minor, l.priced_minutes) = (s.bill_amount_minor, s.bill_rate_minor, s.priced_minutes)),
  3, 'K. every draft line is an exact copy of the bill side of a priced line');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_invoice_draft(%L, %L, %L, ''USD'')',
  (select alpha from orgs), (select riverside from rel), (select ps from per))), 'CHY09', null, 'O. the same bill lines cannot be drafted twice');
select throws_ok(format($$ insert into public.invoice_line_claims
    (priced_line_id, invoice_draft_id, invoice_draft_line_id, agency_organisation_id, timesheet_id, timesheet_revision)
  select priced_line_id, invoice_draft_id, id, agency_organisation_id, timesheet_id, timesheet_revision
  from public.invoice_draft_lines where invoice_draft_id = %L limit 1 $$, (select id from d)),
  '23505', null, 'O. structurally: a bill line can sit in only one active draft');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select public.create_invoice_draft(%L, %L, %L, ''USD'')',
  (select beta from orgs), (select riverside from rel), (select ps from per)), 'aal2'), 'CH403', null, 'another agency cannot draft from this relationship');
select pg_temp.exec_as((select finn from fin), 'aal1', format('select public.review_invoice_draft(%L)', (select id from d)));

select is(pg_temp.count_as((select bob from ids), 'aal2', 'select * from public.invoice_drafts'), 0, 'B. another agency reads no invoice drafts');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select * from public.get_invoice_draft(%L)', (select id from d)), 'aal2'),
  'CHY07', null, 'B. …nor by id');
select is(pg_temp.count_as((select wendy from ids), 'aal1', 'select * from public.invoice_draft_lines'), 0, 'D. a worker reads no invoice lines');
select is(pg_temp.count_as((select fiona from ids), 'aal2', 'select * from public.invoice_drafts'), 0, 'F. a facility reads no internal invoice drafts');
select throws_ok(pg_temp.as_sql((select fiona from ids), format('select * from public.list_billable_work(%L)', (select alpha from orgs)), 'aal2'),
  'CH403', null, 'F. …or billable work');

-- ---------------------------------------------------------------------------
-- R / S. A new priced revision after preparation
-- ---------------------------------------------------------------------------
select pg_temp.exec_as((select alice from ids), 'aal1', format('select public.reopen_timesheet(%L, ''approved_in_error'')', (select wendy from ts)));
select pg_temp.outcome_as((select wendy from ids), format('select * from public.submit_timesheet(%L)', (select wendy from ts)));
select pg_temp.outcome_as((select alice from ids), format('select * from public.approve_timesheet(%L, 2)', (select wendy from ts)));
-- Revision 2 is priced after a later rate version ($44.00 / $60.00 from day 2): a material change on day 2.
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.activate_rate_version(public.create_rate_version(%L, ''USD'', 4400, 6000, %L))',
  (select riverside from rc), (select ps from per) + 2));
select pg_temp.query_as((select finn from fin), 'aal1', format('select * from public.price_timesheet(%L, 2)', (select wendy from ts)));

select is((select count(*)::int from internal.payroll_source_lines((select alpha from orgs)) where timesheet_revision = 1), 0,
  'R. a superseded priced revision is never offered as current');
select is((select bool_and(adjustment_required) from internal.payroll_source_lines((select alpha from orgs))), true,
  'R. the new revision is held back as an adjustment');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_payroll_batch(%L, %L, ''USD'')',
  (select alpha from orgs), (select ps from per))), 'CHY01', null, 'R. it cannot be prepared as ordinary work');
select is((select total_pay_minor || '/' || line_count || '/' || status from public.payroll_batches where id = (select id from b)),
  '83088/3/exported', 'S. the exported batch is unchanged');
select is(internal.payroll_batch_attention((select id from b)), 'ADJUSTMENT_REQUIRED', 'S. and flagged "Adjustment required"');
select is((select x -> 'document_references' ->> 0 from jsonb_array_elements(pg_temp.query_as((select finn from fin), 'aal1',
           format('select * from public.list_payroll_issues(%L)', (select alpha from orgs)))) x where x ->> 'issue_code' = 'ADJUSTMENT_REQUIRED'),
  (select reference || ' (exported)' from public.payroll_batches where id = (select id from b)),
  'S. the adjustment references the earlier batch');
select is((select sha256 from public.financial_exports where id = (select id from e1)),
  (select encode(extensions.digest(content, 'sha256'), 'hex') from internal.financial_export_files where export_id = (select id from e1)),
  'S. earlier exports are untouched');

-- The open (reviewed) invoice draft now includes revised work: blocked, fail closed.
select is(internal.invoice_draft_attention((select id from d)), 'SOURCE_SUPERSEDED', 'an open draft with revised work is flagged');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.approve_invoice_draft(%L)', (select id from d)), 'aal2'),
  'CHY02', null, 'approval fails closed while a source is superseded');
select pg_temp.exec_as((select finn from fin), 'aal1', format('select public.void_invoice_draft(%L, ''Timesheet corrected'')', (select id from d)));
select is((select status || '/' || total_bill_minor from public.invoice_drafts where id = (select id from d)), 'voided/113390',
  'voiding keeps the draft unchanged');

create temp table d2 as select pg_temp.scalar_as((select finn from fin), 'aal1', format(
  'select public.create_invoice_draft(%L, %L, %L, ''USD'')', (select alpha from orgs), (select riverside from rel), (select ps from per)))::uuid as id;
grant select on d2 to authenticated;
select is((select array_agg(distinct timesheet_revision) from public.invoice_draft_lines
           where invoice_draft_id = (select id from d2) and timesheet_id = (select wendy from ts)), array[2],
  'the corrected revision is drafted after the void releases the earlier lines');
select pg_temp.exec_as((select finn from fin), 'aal1', format('select public.review_invoice_draft(%L)', (select id from d2)));
select is(pg_temp.query_as((select finn from fin), 'aal1', format('select * from public.approve_invoice_draft(%L)', (select id from d2))) -> 0 ->> 'reason_code',
  'MFA_REQUIRED', 'invoice approval requires AAL2 (denied and audited)');
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.approve_invoice_draft(%L)', (select id from d2)));
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.lock_invoice_draft(%L)', (select id from d2)));

-- Q. Locked drafts are immutable
select throws_ok(format($$ update public.invoice_drafts set total_bill_minor = 1 where id = %L $$, (select id from d2)),
  'CHY03', null, 'Q. locked draft totals cannot change');
select throws_ok(format($$ update public.invoice_draft_lines set bill_amount_minor = 0 where invoice_draft_id = %L $$, (select id from d2)),
  'CH409', null, 'Q. draft lines are immutable');
select throws_ok(format($$ update public.invoice_drafts set status = 'approved' where id = %L $$, (select id from d2)),
  'CHY04', null, 'Q. a locked draft cannot go back');

-- U. Invoice exports
create temp table x1 as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_invoice_export(%L, ''pdf'')', (select id from d2)))::uuid as id;
create temp table x2 as select pg_temp.scalar_as((select finn from fin), 'aal2', format(
  'select public.create_invoice_export(%L, ''csv'')', (select id from d2)))::uuid as id;
grant select on x1, x2 to authenticated;
select ok((select convert_from(content, 'UTF8') from internal.financial_export_files where export_id = (select id from x1)) like '%PDF-1.4%DRAFT INVOICE%Not a tax invoice%',
  'the PDF is clearly marked DRAFT INVOICE and not a tax invoice');
select ok((select convert_from(content, 'UTF8') !~ '(/URI|/JavaScript|/JS |/Launch|/EmbeddedFile|/XObject|/Annots|/AA )' from internal.financial_export_files where export_id = (select id from x1)),
  'the PDF loads no remote asset and carries no links or scripts');
select ok((select convert_from(content, 'UTF8') like '%=HYPERLINK\(""http://x"",""Wendy, ""W""""\)%' from internal.financial_export_files where export_id = (select id from x1))
          or (select convert_from(content, 'UTF8') like '%HYPERLINK\\(%' from internal.financial_export_files where export_id = (select id from x1)),
  'PDF text is escaped');
select is((select split_part(convert_from(content, 'UTF8'), E'\r\n', 1) from internal.financial_export_files where export_id = (select id from x2)),
  'invoice_draft_reference,facility,relationship_reference,period_start,period_end,work_date,worker_reference,worker_name,discipline,priced_minutes,bill_rate_minor,bill_amount_minor,currency',
  'invoice CSV header (exact columns)');
select ok((select convert_from(content, 'UTF8') !~ '(,4250,|,34000,|,32088,|,10625,)' from internal.financial_export_files where export_id = (select id from x2)),
  'U. the invoice CSV contains no pay rate or pay amount');
select is((select file_name from public.financial_exports where id = (select id from x2)),
  (select reference || '-DRAFT-INVOICE.csv' from public.invoice_drafts where id = (select id from d2)), 'the file name marks it a draft invoice');
select is(pg_temp.count_as((select fiona from ids), 'aal2', 'select * from public.financial_exports'), 0, 'U. facilities cannot see invoice exports');
select is(pg_temp.query_as((select wendy from ids), 'aal1', format('select * from public.download_financial_export(%L)', (select id from x1))) -> 0 ->> 'denied_reason',
  'NOT_FOUND', 'U. a worker cannot download a draft invoice (denied and audited)');
select is((select count(*)::int from public.audit_events where action in ('invoice.draft_created', 'invoice.draft_approved',
           'invoice.draft_locked', 'invoice.export_created', 'invoice.voided')), 7, 'invoice steps are audited');

-- ---------------------------------------------------------------------------
-- Reconciliation and periods
-- ---------------------------------------------------------------------------
select is((select array_agg((x ->> 'state') || ':' || (x ->> 'line_count') order by x ->> 'state') from jsonb_array_elements(pg_temp.query_as(
           (select finn from fin), 'aal1', format('select * from public.financial_reconciliation(%L, ''pay'')', (select alpha from orgs)))) x),
  array['adjustment_required:1', 'exported:3'], 'payroll reconciliation: 3 exported, 1 changed line awaiting adjustment');
select is((select array_agg((x ->> 'state') || ':' || (x ->> 'line_count') order by x ->> 'state') from jsonb_array_elements(pg_temp.query_as(
           (select finn from fin), 'aal1', format('select * from public.financial_reconciliation(%L, ''bill'')', (select alpha from orgs)))) x),
  array['exported:3'], 'invoice reconciliation: 3 exported');
select pg_temp.exec_as((select finn from fin), 'aal2', format('select public.set_agency_financial_settings(%L, ''biweekly'', %L)',
  (select alpha from orgs), (select ps from per) - 7));
select is((select period_start || '/' || period_end from internal.payroll_period_for((select alpha from orgs), (select ps from per) + 3)),
  (select (ps - 7) || '/' || (ps + 6) from per), 'biweekly periods follow the anchor date');
select throws_ok(pg_temp.as_sql((select finn from fin), format('select public.create_payroll_batch(%L, %L, ''USD'')',
  (select alpha from orgs), (select ps from per) - 7)), 'CHY05', null, 'a new period may not overlap one already used');

-- ---------------------------------------------------------------------------
-- Y / Z. Function hygiene, no anon, no direct writes
-- ---------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'internal') and p.prosecdef
             and p.proname ~ '(payroll|invoice|financial)'
             and not ('search_path=""' = any (coalesce(p.proconfig, '{}')))), 0,
  'Y. every SECURITY DEFINER financial function pins an empty search_path');
select is((select count(*)::int from information_schema.role_table_grants
           where table_schema = 'public' and grantee in ('anon', 'PUBLIC')
             and table_name ~ '(payroll|invoice|financial)'), 0, 'Z. anon holds nothing on financial tables');
select throws_ok(pg_temp.as_sql((select finn from fin), format($$ insert into public.payroll_periods (agency_organisation_id, period_type, period_start, period_end)
  values (%L, 'weekly', %L, %L) $$, (select alpha from orgs), (select ps from per) + 70, (select ps from per) + 76), 'aal2'),
  '42501', null, 'Z. no direct writes, even for finance');
select throws_ok(pg_temp.as_sql((select finn from fin), format($$ update public.invoice_drafts set status = 'voided' where id = %L $$, (select id from d2)), 'aal2'),
  '42501', null, 'Z. no direct status changes');

select * from finish();
rollback;
