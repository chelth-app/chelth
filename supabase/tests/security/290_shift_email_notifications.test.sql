-- =============================================================================
-- Shift email notifications (P0-E9-3G) — all through the existing outbox
-- A assignment · T transactional · O offer · C change · X cancellation
-- R 24 h reminder · I idempotency · W tenant / recipient safety
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql

select plan(36);

-- Start clean: the fixture's own actions may already have queued events.
update internal.notification_outbox set state = 'sent', sent_at = now(), processed_at = now();

create function pg_temp.rows(p_event text, p_profile uuid) returns integer language sql as $$
  select count(*)::int from internal.notification_outbox where event::text = p_event and recipient_profile_id = p_profile
$$;

create temp table s as
select pg_temp.shift((select sam from ids), (select mercy from f), (select mercy_main from loc), 3, '07:00', '15:00', 3) as one,
       pg_temp.shift((select sam from ids), (select riverside from f), (select riverside_main from loc), 4, '07:00', '15:00', 3) as two,
       pg_temp.shift((select sam from ids), (select mercy from f), (select mercy_main from loc), 5, '07:00', '15:00', 3) as three;
grant select on s to authenticated;

-- ---------------------------------------------------------------------------
-- A. New assignment ⇒ exactly one email event, deep-linked to the assignment
-- ---------------------------------------------------------------------------
create temp table a1 as select (pg_temp.assign((select sam from ids), (select one from s), (select wendy from w)) ->> 'assignment_id')::uuid as id;
grant select on a1 to authenticated;
select is(pg_temp.rows('worker_assigned', (select wendy from ids)), 1, 'A. assignment ⇒ exactly one worker_assigned event');
select is((select dedupe_key from internal.notification_outbox where event = 'worker_assigned' and subject_id = (select id from a1)),
  'worker_assigned:' || (select id from a1) || ':' || (select wendy from ids), 'I. it carries a deterministic idempotency key');
select is((select internal.notification_template(id) ->> 'path' from internal.notification_outbox
            where event = 'worker_assigned' and subject_id = (select id from a1)),
  '/app/organisations/' || (select alpha from orgs) || '/my-shifts/' || (select id from a1),
  'A. deep link: the worker''s own assignment (authorisation still applies on open)');

-- I. Re-enqueueing the same event (a retry, a replay) never adds a second email — even after it was sent.
update internal.notification_outbox set state = 'sent', sent_at = now() where subject_id = (select id from a1);
select is(internal.enqueue_notification('worker_assigned', (select alpha from orgs), (select wendy from ids), null,
  'shift_assignment', (select id from a1)), 0, 'I. a replayed enqueue inserts nothing');
select is(pg_temp.rows('worker_assigned', (select wendy from ids)), 1, 'I. still exactly one');

-- T. A refused assignment (same worker twice) queues nothing.
select is(pg_temp.assign((select sam from ids), (select one from s), (select wendy from w)) ->> 'outcome', 'refused',
  'T. a duplicate assignment is refused');
select is(pg_temp.rows('worker_assigned', (select wendy from ids)), 1, 'T. … and queues no email');

-- Acceptance is the worker's own action: no second assignment email.
select pg_temp.exec_as((select wendy from ids), 'aal1', format('select public.accept_shift_assignment(%L)', (select id from a1)));
select is((select count(*)::int from internal.notification_outbox where recipient_profile_id = (select wendy from ids)), 1,
  'A. accepting does not send another email');

-- ---------------------------------------------------------------------------
-- O. Offer ⇒ one offer email; accepting it creates the assignment without a second email
-- ---------------------------------------------------------------------------
create temp table o1 as select (pg_temp.query_as((select sam from ids), 'aal1', format(
  'select * from public.offer_shift_to_workers(%L, array[%L]::uuid[])', (select two from s), (select walt from w))) -> 0 ->> 'offer_id')::uuid as id;
grant select on o1 to authenticated;
select is(pg_temp.rows('shift_offered', (select walt from ids)), 1, 'O. offer ⇒ one shift_offered event');
select pg_temp.exec_as((select walt from ids), 'aal1', format('select public.accept_shift_offer(%L)', (select id from o1)));
select is(pg_temp.rows('worker_assigned', (select walt from ids)), 0, 'O. accepting an offer does not duplicate an assignment email');
create temp table a2 as select id from public.shift_assignments where shift_id = (select two from s) and agency_worker_id = (select walt from w);
grant select on a2 to authenticated;

-- ---------------------------------------------------------------------------
-- C. Changes: meaningful ⇒ one versioned email per active assignment; irrelevant ⇒ none
-- ---------------------------------------------------------------------------
select pg_temp.exec_as((select sam from ids), 'aal1', format('select public.set_shift_unit(%L, ''ICU'')', (select one from s)));
select is(pg_temp.rows('shift_changed', (select wendy from ids)), 1, 'C. a unit change ⇒ one change email');
select is((select detail -> 'changes' from internal.notification_outbox where event = 'shift_changed'),
  '["unit"]'::jsonb, 'C. … that names only the unit');
select is((select dedupe_key from internal.notification_outbox where event = 'shift_changed'),
  'shift_changed:' || (select id from a1) || ':1', 'I. keyed by assignment and change version');
select pg_temp.exec_as((select sam from ids), 'aal1', format('select public.set_shift_unit(%L, ''ICU'')', (select one from s)));
select is(pg_temp.rows('shift_changed', (select wendy from ids)), 1, 'C. saving the same unit again ⇒ no email');
select pg_temp.exec_as((select sam from ids), 'aal1', format('select public.set_shift_unit(%L, ''Ward 4'')', (select one from s)));
select is(pg_temp.rows('shift_changed', (select wendy from ids)), 1,
  'C. a second change while the first email is still waiting ⇒ merged, not a second email');
select is((select internal.notification_template(id) ->> 'unitLabel' from internal.notification_outbox where event = 'shift_changed'),
  'Ward 4', 'C. … the email shows the latest value');
-- Once the first email was sent, a further change is a new, versioned email.
update internal.notification_outbox set state = 'sent', sent_at = now() where event = 'shift_changed';
select pg_temp.exec_as((select sam from ids), 'aal1', format('select public.set_shift_unit(%L, ''Ward 5'')', (select one from s)));
select is(pg_temp.rows('shift_changed', (select wendy from ids)), 2, 'C. after delivery, a new change ⇒ a new email (version 3)');
select is((select internal.notification_template(id) ->> 'previousUnitLabel' from internal.notification_outbox
            where dedupe_key = 'shift_changed:' || (select id from a1) || ':3'), 'Ward 4', 'C. previous value travels for the template');

-- Irrelevant / internal fields: headcount, external reference, instructions.
update public.shifts set requested_headcount = requested_headcount + 1, external_reference = 'PO-7', instructions = 'Internal note change'
 where id = (select one from s);
select is(pg_temp.rows('shift_changed', (select wendy from ids)), 2, 'C. internal metadata changes ⇒ no email');

-- Scheduling on an open shift is refused by the existing rule ⇒ the failed update queues nothing.
select throws_ok(format('update public.shifts set start_at = start_at + interval ''1 hour'', end_at = end_at + interval ''1 hour'' where id = %L', (select one from s)),
  'CH409', null, 'C. open-shift times cannot change (existing rule)');
select is(pg_temp.rows('shift_changed', (select wendy from ids)), 2, 'T. … and the refused change queues nothing');

-- Times are also pinned by the assignment → shift (start_at) foreign key while workers hold the shift.
select throws_ok(format('alter table public.shifts disable trigger shifts_transition; update public.shifts set start_at = start_at + interval ''1 hour'', end_at = end_at + interval ''1 hour'' where id = %L', (select one from s)),
  '23503', null, 'C. … and by the assignment foreign key (date / time cannot move under an assigned worker)');

-- W. Another agency cannot change Alpha's shift, so it cannot trigger Alpha's worker email.
select throws_ok(pg_temp.as_sql((select bob from ids), format('select public.set_shift_unit(%L, ''X'')', (select one from s)), 'aal2'),
  null, null, 'W. another agency cannot change the shift');
select is(pg_temp.rows('shift_changed', (select wendy from ids)), 2, 'W. … and no email is queued');

-- ---------------------------------------------------------------------------
-- R. 24-hour reminder
-- ---------------------------------------------------------------------------
create temp table st as select start_at from public.shifts where id = (select two from s);
create function pg_temp.reminders(p_assignment uuid) returns integer language sql as $$
  select count(*)::int from internal.notification_outbox where event = 'shift_reminder' and subject_id = p_assignment
$$;
select internal.run_shift_reminder_scan((select start_at from st) - interval '30 hours');
select is(pg_temp.reminders((select id from a2)), 0, 'R. 30 h before ⇒ not yet');
select internal.run_shift_reminder_scan((select start_at from st) - interval '20 hours');
select is(pg_temp.reminders((select id from a2)), 1, 'R. inside 24 h ⇒ one reminder (accepted assignment)');
select internal.run_shift_reminder_scan((select start_at from st) - interval '19 hours');
select is(pg_temp.reminders((select id from a2)), 1, 'I. a second scan ⇒ no duplicate reminder');
select is((select deliver_until from internal.notification_outbox where event = 'shift_reminder' and subject_id = (select id from a2)),
  (select start_at from st), 'R. a reminder is never delivered after the shift starts');

-- Not accepted (assigned only) ⇒ no reminder.
create temp table a3 as select (pg_temp.assign((select sam from ids), (select three from s), (select nora from w)) ->> 'assignment_id')::uuid as id;
grant select on a3 to authenticated;
select internal.run_shift_reminder_scan((select start_at from public.shifts where id = (select three from s)) - interval '20 hours');
select is(pg_temp.reminders((select id from a3)), 0, 'R. an assignment not yet accepted ⇒ no reminder');

-- Completed shift ⇒ no new reminder, and a queued one is not delivered.
update internal.notification_outbox set state = 'sent', sent_at = now() where event = 'shift_reminder' and subject_id = (select id from a2);
update public.shifts set status = 'completed', completed_at = now() where id = (select two from s);
update internal.notification_outbox set state = 'pending', sent_at = null where event = 'shift_reminder' and subject_id = (select id from a2);
select is(internal.notification_template((select id from internal.notification_outbox where event = 'shift_reminder' and subject_id = (select id from a2))), null,
  'R. completed shift ⇒ a queued reminder resolves to nothing (not sent)');
delete from internal.notification_outbox where event = 'shift_reminder' and subject_id = (select id from a2);
select internal.run_shift_reminder_scan((select start_at from st) - interval '18 hours');
select is(pg_temp.reminders((select id from a2)), 0, 'R. completed shift ⇒ no reminder');

-- ---------------------------------------------------------------------------
-- X. Cancellation ⇒ one email; pending change emails are no longer delivered
-- ---------------------------------------------------------------------------
select pg_temp.exec_as((select sam from ids), 'aal1', format('select public.cancel_shift(%L, ''staffing_no_longer_needed'')', (select one from s)));
select is(pg_temp.rows('shift_cancelled', (select wendy from ids)), 1, 'X. cancellation ⇒ one email to the assigned worker');
select is((select internal.notification_template(id) ->> 'path' from internal.notification_outbox
            where event = 'shift_cancelled' and recipient_profile_id = (select wendy from ids)),
  '/app/organisations/' || (select alpha from orgs) || '/my-shifts', 'X. cancellation links to My Shifts (no stale record link)');
select is((select count(*)::int from internal.notification_outbox o
            where o.event = 'shift_changed' and internal.notification_template(o.id) is not null), 0,
  'X. change emails for a cancelled shift are not delivered');
delete from internal.notification_outbox where event = 'shift_reminder' and subject_id = (select id from a1);
select internal.run_shift_reminder_scan((select start_at from public.shifts where id = (select one from s)) - interval '20 hours');
select is(pg_temp.reminders((select id from a1)), 0, 'R. cancelled shift ⇒ no reminder');

-- W. A worker email is only rendered for that worker's own assignment.
insert into internal.notification_outbox (event, organisation_id, recipient_profile_id, audience_organisation_id, subject_type, subject_id)
values ('shift_reminder', (select alpha from orgs), (select bob from ids), (select alpha from orgs), 'shift_assignment', (select id from a2));
select is(internal.notification_template((select id from internal.notification_outbox where recipient_profile_id = (select bob from ids) and event = 'shift_reminder')),
  null, 'W. someone else''s assignment never renders for another recipient');

select * from finish();
rollback;
