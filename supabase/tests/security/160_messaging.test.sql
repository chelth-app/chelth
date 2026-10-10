-- =============================================================================
-- Operational messaging (P0-E9-3D-S3)
-- O open threads (context-bound) · S send (idempotent, validated) · R read state
-- X cross-tenant / other-worker / facility denial · F facility threads
-- I immutability and retention · V revocation · N notification (no body)
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql

select plan(48);

create temp table s as
select
  pg_temp.shift((select sam from ids), (select mercy from f), (select mercy_main from loc), 3, '07:00', '15:00', 2) as mercy,
  pg_temp.shift((select sam from ids), (select riverside from f), (select riverside_main from loc), 3, '07:00', '15:00') as riverside,
  pg_temp.shift((select alice from ids), (select mercy from f), (select mercy_main from loc), 5, '07:00', '15:00', 1, false) as mercy_draft;
grant select on s to authenticated, anon;
select pg_temp.assign((select sam from ids), (select mercy from s), (select wendy from w));

-- ---------------------------------------------------------------------------
-- O. Opening worker threads
-- ---------------------------------------------------------------------------
create temp table th as
select pg_temp.scalar_as((select wendy from ids), 'aal1', format('select public.open_worker_thread(%L)', (select wendy from w)))::uuid as general,
       pg_temp.scalar_as((select wendy from ids), 'aal1', format('select public.open_worker_thread(%L, %L)', (select wendy from w), (select mercy from s)))::uuid as shift;
grant select on th to authenticated, anon;

select isnt((select general from th), null, 'O. a worker opens their own agency thread');
select isnt((select shift from th), null, 'O. ...and a thread about a shift they are assigned to');
select is(pg_temp.scalar_as((select wendy from ids), 'aal1', format('select public.open_worker_thread(%L, %L)', (select wendy from w), (select mercy from s)))::uuid,
  (select shift from th), 'O. opening again returns the same thread');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select public.open_worker_thread(%L, %L)', (select wendy from w), (select riverside from s))),
  'CH403', null, 'O. not about a shift the worker is not assigned to');
select throws_ok(pg_temp.as_sql((select walt from ids), format('select public.open_worker_thread(%L)', (select wendy from w))),
  'CH403', null, 'X. another worker cannot open Wendy''s thread');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select public.open_worker_thread(%L)', (select wendy from w)), 'aal2'),
  'CH403', null, 'X. another agency cannot open a thread with Alpha''s worker record');
select lives_ok(pg_temp.as_sql((select sam from ids), format('select public.open_worker_thread(%L)', (select walt from w))),
  'O. a scheduler (message.send) can start a thread with a worker');
select lives_ok(pg_temp.as_sql((select carl from ids), format('select public.open_worker_thread(%L)', (select nora from w))),
  'O. a credentialing officer (message.send) can start a thread with a worker');

-- ---------------------------------------------------------------------------
-- S. Sending
-- ---------------------------------------------------------------------------
create temp table k as select gen_random_uuid() as one, gen_random_uuid() as two, gen_random_uuid() as three;
grant select on k to authenticated;

select is(pg_temp.query_as((select wendy from ids), 'aal1', format('select duplicate from public.send_message(%L, ''Running 10 minutes late'', %L)', (select shift from th), (select one from k))) -> 0,
  '{"duplicate": false}'::jsonb, 'S. the worker sends a message');
select is(pg_temp.query_as((select wendy from ids), 'aal1', format('select duplicate from public.send_message(%L, ''Running 10 minutes late'', %L)', (select shift from th), (select one from k))) -> 0,
  '{"duplicate": true}'::jsonb, 'S. a retried send with the same key is not duplicated');
select is((select count(*)::int from public.messages where thread_id = (select shift from th)), 1, 'S. exactly one message stored');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.send_message(%L, ''   '', %L)', (select shift from th), gen_random_uuid())),
  'CH400', null, 'S. an empty message is refused');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.send_message(%L, %L, %L)', (select shift from th), repeat('x', 2001), gen_random_uuid())),
  'CH400', null, 'S. a message over 2000 characters is refused');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.send_message(%L, ''hi'', null)', (select shift from th))),
  'CH400', null, 'S. a client key is required (idempotency)');
select lives_ok(pg_temp.as_sql((select sam from ids), format('select * from public.send_message(%L, ''Thanks — please report through the east entrance.'', %L)', (select shift from th), (select two from k))),
  'S. agency staff reply');
select is((select sender_side::text from public.messages where client_key = (select two from k)), 'agency', 'S. the server records the sender side');

-- ---------------------------------------------------------------------------
-- R. Read state and projections
-- ---------------------------------------------------------------------------
select is(pg_temp.scalar_as((select wendy from ids), 'aal1', format('select public.unread_message_count(%L)', (select alpha from orgs)))::int,
  1, 'R. the worker has one unread message (the reply)');
select is(pg_temp.query_as((select wendy from ids), 'aal1', format(
  'select facility_name, worker_name, viewer_side, unread_count, last_message_preview from public.list_my_threads(%L) where thread_id = %L',
  (select alpha from orgs), (select shift from th))) -> 0,
  '{"facility_name": "Mercy Rehab", "worker_name": null, "viewer_side": "worker", "unread_count": 1, "last_message_preview": "Thanks — please report through the east entrance."}'::jsonb,
  'R. the worker''s thread list: shift context, unread count, preview; no worker name shown to themself');
select isnt(pg_temp.scalar_as((select wendy from ids), 'aal1', format(
  'select my_assignment_id from public.get_thread(%L)', (select shift from th))), null,
  'R. the worker''s thread links back to their assignment (Shift Details)');
select is(pg_temp.query_as((select wendy from ids), 'aal1', format(
  'select sender_label, is_mine from public.list_thread_messages(%L) order by created_at', (select shift from th))),
  '[{"sender_label": "You", "is_mine": true}, {"sender_label": "Alpha Agency", "is_mine": false}]'::jsonb,
  'R. the worker sees the agency by name — never a staff member''s personal name');
select is(pg_temp.scalar_as((select sam from ids), 'aal1', format(
  'select sender_label from public.list_thread_messages(%L) where not is_mine', (select shift from th))),
  'wendy', 'R. agency staff see the worker''s name');
select is(pg_temp.scalar_as((select sam from ids), 'aal1', format(
  'select worker_name from public.list_my_threads(%L) where thread_id = %L', (select alpha from orgs), (select shift from th))),
  'wendy', 'R. agency staff see which worker a thread is with');
select lives_ok(pg_temp.as_sql((select wendy from ids), format('select public.mark_thread_read(%L)', (select shift from th))),
  'R. the worker marks the thread read');
select is(pg_temp.scalar_as((select wendy from ids), 'aal1', format('select public.unread_message_count(%L)', (select alpha from orgs)))::int,
  0, 'R. unread count clears');
select is(pg_temp.count_as((select wendy from ids), 'aal1', 'select * from public.message_receipts'),
  pg_temp.count_as((select wendy from ids), 'aal1', format('select * from public.message_receipts where profile_id = %L', (select wendy from ids))),
  'R. read receipts are visible only to their owner');
select is(pg_temp.count_as((select wendy from ids), 'aal1', format('select * from public.list_thread_messages(%L, null, null, 1)', (select shift from th))),
  1, 'R. pagination: a page of one');
select is(pg_temp.scalar_as((select wendy from ids), 'aal1', format(
  'select body from public.list_thread_messages(%L, (select created_at from public.messages where client_key = %L), (select id from public.messages where client_key = %L), 10)',
  (select shift from th), (select two from k), (select two from k))),
  'Running 10 minutes late', 'R. keyset pagination returns the older page');

-- ---------------------------------------------------------------------------
-- X. Denials
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select walt from ids), 'aal1', format('select * from public.messages where thread_id = %L', (select shift from th))),
  0, 'X. another worker cannot read Wendy''s messages');
select is(pg_temp.count_as((select walt from ids), 'aal1', format('select * from public.list_my_threads(%L) where thread_id = %L', (select alpha from orgs), (select shift from th))),
  0, 'X. ...nor list her thread');
select throws_ok(pg_temp.as_sql((select walt from ids), format('select * from public.send_message(%L, ''hi'', %L)', (select shift from th), gen_random_uuid())),
  'CH403', null, 'X. ...nor post into it');
select is(pg_temp.count_as((select walt from ids), 'aal1', format('select * from public.get_thread(%L)', (select shift from th))),
  0, 'X. get_thread hides it (no oracle)');
select is(pg_temp.count_as((select bob from ids), 'aal2', 'select * from public.messages'), 0, 'X. another agency reads no messages');
select is(pg_temp.count_as((select fiona from ids), 'aal1', 'select * from public.messages'), 0, 'X. the linked facility never sees worker threads');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.conversation_threads'), 0, 'X. platform admins read nothing');
select throws_ok(pg_temp.as_sql((select wendy from ids), format(
  'insert into public.messages (thread_id, agency_organisation_id, sender_profile_id, sender_side, body, client_key) values (%L, %L, %L, ''agency'', ''forged'', gen_random_uuid())',
  (select shift from th), (select alpha from orgs), (select wendy from ids))),
  '42501', null, 'X. no direct inserts: messages are written only by the RPC');

-- ---------------------------------------------------------------------------
-- F. Facility threads
-- ---------------------------------------------------------------------------
create temp table ft as
select pg_temp.scalar_as((select fiona from ids), 'aal1', format('select public.open_facility_thread(%L, %L)', (select mercy from rel), (select mercy from s)))::uuid as mercy;
grant select on ft to authenticated;
select isnt((select mercy from ft), null, 'F. the linked facility admin opens a thread about its request');
select lives_ok(pg_temp.as_sql((select fiona from ids), format('select * from public.send_message(%L, ''Please send someone with ICU experience.'', %L)', (select mercy from ft), (select three from k))),
  'F. the facility posts');
select is(pg_temp.scalar_as((select alice from ids), 'aal1', format(
  'select sender_label from public.list_thread_messages(%L) where not is_mine', (select mercy from ft))),
  'Gamma Health', 'F. the agency sees the facility by organisation name');
select is(pg_temp.count_as((select fred from ids), 'aal1', format('select * from public.messages where thread_id = %L', (select mercy from ft))),
  0, 'F. a facility supervisor without message.view cannot read it');
select is(pg_temp.count_as((select dora from ids), 'aal1', format('select * from public.messages where thread_id = %L', (select mercy from ft))),
  0, 'X. another facility cannot read it');
select is(pg_temp.count_as((select wendy from ids), 'aal1', format('select * from public.messages where thread_id = %L', (select mercy from ft))),
  0, 'X. workers are never in facility threads');
select throws_ok(pg_temp.as_sql((select fiona from ids), format('select public.open_facility_thread(%L, %L)', (select mercy from rel), (select riverside from s))),
  'CH403', null, 'F. not about a shift under another relationship');
select throws_ok(pg_temp.as_sql((select fiona from ids), format('select public.open_facility_thread(%L, %L)', (select mercy from rel), (select mercy_draft from s))),
  'CH403', null, 'F. not about an agency draft the facility cannot see');
select throws_ok(pg_temp.as_sql((select dora from ids), format('select public.open_facility_thread(%L)', (select mercy from rel))),
  'CH403', null, 'X. another facility cannot open a thread on Alpha–Gamma');

-- ---------------------------------------------------------------------------
-- N. Notification: the worker is told, without the message body
-- ---------------------------------------------------------------------------
select is((select count(*)::int from internal.notification_outbox
            where event = 'message_received' and subject_id = (select shift from th)
              and recipient_profile_id = (select wendy from ids)
              and detail::text !~ 'east entrance'),
  1, 'N. one message_received notice for the worker, with no body');

-- ---------------------------------------------------------------------------
-- I / V. Immutability, retention, revocation
-- ---------------------------------------------------------------------------
select throws_ok(format('update public.messages set body = ''edited'' where client_key = %L', (select one from k)),
  'CH409', null, 'I. messages cannot be edited (even by the owner role)');
select throws_ok(format('delete from public.conversation_threads where id = %L', (select shift from th)),
  'CH409', null, 'I. threads are never deleted');
update public.organisation_memberships set status = 'suspended'
 where organisation_id = (select alpha from orgs) and profile_id = (select wendy from ids);
select is(pg_temp.count_as((select wendy from ids), 'aal1', format('select * from public.messages where thread_id = %L', (select shift from th))),
  0, 'V. a suspended worker loses access at once (history kept)');

select * from finish();
rollback;
