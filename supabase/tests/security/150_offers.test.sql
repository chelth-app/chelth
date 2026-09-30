-- =============================================================================
-- Shift offers (P0-E5-S2)
-- A own offers only · B facilities see no offers · C cross-agency
-- D no accepting another's offer · E expired · F cancelled
-- G acceptance re-runs compliance · H re-runs schedule · I no overfill
-- K filled shift closes remaining offers · structure · T · W · X
-- =============================================================================
begin;
\ir _helpers.psql
\ir _credential_helpers.psql
\ir _shift_fixture.psql

select plan(47);

create function pg_temp.offer(p_user uuid, p_shift uuid, p_workers uuid[], p_minutes integer default 1440)
returns jsonb language sql as $$
  select pg_temp.query_as(p_user, 'aal1', format(
    'select * from public.offer_shift_to_workers(%L, %L::uuid[], %s)', p_shift, p_workers, p_minutes))
$$;
create function pg_temp.accept_offer(p_user uuid, p_offer uuid)
returns jsonb language sql as $$
  select pg_temp.query_as(p_user, 'aal1', format('select * from public.accept_shift_offer(%L)', p_offer)) -> 0
$$;
create function pg_temp.offer_of(p_shift uuid, p_worker uuid)
returns uuid language sql as $$
  select id from public.shift_offers where shift_id = p_shift and agency_worker_id = p_worker
  order by (status = 'offered') desc, (status = 'accepted') desc, created_at desc, id limit 1
$$;

create temp table s as
select
  pg_temp.shift((select sam from ids), (select riverside from f), (select riverside_main from loc), 3, '07:00', '15:00', 1) as r_one,
  pg_temp.shift((select sam from ids), (select riverside from f), (select riverside_main from loc), 5, '07:00', '15:00', 2) as r_two,
  pg_temp.shift((select sam from ids), (select mercy from f), (select mercy_main from loc), 5, '08:00', '12:00', 1) as m_overlap,
  pg_temp.shift((select sam from ids), (select riverside from f), (select riverside_main from loc), 9, '07:00', '15:00', 1) as r_nine,
  pg_temp.shift((select bob from ids), (select beta_client from f), (select beta_main from loc), 4, '07:00', '15:00', 1) as beta;
grant select on s to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Creating offers (broadcast)
-- ---------------------------------------------------------------------------
create temp table o1 as
select pg_temp.offer((select sam from ids), (select r_one from s),
  array[(select wendy from w), (select walt from w), (select nora from w)]) as result;
select is((select jsonb_object_agg(x ->> 'agency_worker_id', coalesce(x ->> 'reason', x ->> 'outcome')) from o1, jsonb_array_elements(result) x),
  jsonb_build_object((select wendy from w)::text, 'offered', (select walt from w)::text, 'offered',
                     (select nora from w)::text, 'DISCIPLINE_MISMATCH'),
  'broadcast offers go only to eligible workers; others are skipped with a reason');
select ok((select expires_at <= (select start_at from public.shifts where id = (select r_one from s))
             from public.shift_offers where id = pg_temp.offer_of((select r_one from s), (select wendy from w))),
  'an offer never outlives the shift start');
select is((select v -> 0 ->> 'reason' from (select pg_temp.offer((select sam from ids), (select r_one from s), array[(select wendy from w)]) v) q),
  'OFFER_ALREADY_EXISTS', 'one live offer per worker and shift');
select is((select count(*)::int from internal.notification_outbox where event = 'shift_offered' and subject_id in
            (select id from public.shift_offers where shift_id = (select r_one from s))),
  2, 'each offered worker gets a shift_offered notification');
select is((select count(*)::int from public.audit_events where action = 'shift.offer_created'), 2, 'offers are audited');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select * from public.offer_shift_to_workers(%L, %L::uuid[])',
  (select r_two from s), array[(select wendy from w), (select wendy_beta from w)])),
  'CHW04', null, 'a foreign worker id rejects the whole batch');
select is((select count(*)::int from public.shift_offers where shift_id = (select r_two from s)), 0, '… with no partial offers');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.offer_shift_to_workers(%L, %L::uuid[])',
  (select r_two from s), array[(select wendy from w)])),
  'CHS04', null, 'a worker cannot create offers');
select throws_ok(pg_temp.as_sql((select rita from ids), format('select * from public.offer_shift_to_workers(%L, %L::uuid[])',
  (select r_two from s), array[(select wendy from w)])),
  'CHS04', null, 'a recruiter cannot create offers');
select throws_ok(pg_temp.as_sql((select bob from ids), format('select * from public.offer_shift_to_workers(%L, %L::uuid[])',
  (select r_two from s), array[(select wendy from w)]), 'aal2'),
  'CHS04', null, 'C. another agency cannot offer Alpha''s shift');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select * from public.offer_shift_to_workers(%L, %L::uuid[], 5)',
  (select r_two from s), array[(select wendy from w)])),
  'CH400', null, 'offer expiry is bounded');

-- ---------------------------------------------------------------------------
-- A / B / C / T. Visibility
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as((select wendy from ids), 'aal1', 'select * from public.shift_offers'), 1, 'A. a worker sees their own offer');
select is(pg_temp.count_as((select walt from ids), 'aal1', format('select * from public.shift_offers where agency_worker_id <> %L', (select walt from w))),
  0, 'A. a worker sees no one else''s offers');
select is(pg_temp.count_as((select sam from ids), 'aal1', 'select * from public.shift_offers'), 2, 'the agency sees its offers');
select is(pg_temp.count_as((select fiona from ids), 'aal1', 'select * from public.shift_offers'), 0, 'B. a facility sees no offers');
select is(pg_temp.count_as((select bob from ids), 'aal2', 'select * from public.shift_offers'), 0, 'C. another agency sees no offers');
select is(pg_temp.count_as((select erin from ids), 'aal2', 'select * from public.shift_offers'), 0, 'T. a platform admin sees no offers');
select is(pg_temp.query_as((select wendy from ids), 'aal1', format('select facility_name, can_respond from public.list_my_shift_offers(%L)', (select alpha from orgs))) -> 0,
  '{"facility_name": "Riverside", "can_respond": true}'::jsonb, 'the worker offer projection shows the shift basics');

-- ---------------------------------------------------------------------------
-- D. No spoofed acceptance; X. no direct writes
-- ---------------------------------------------------------------------------
select throws_ok(pg_temp.as_sql((select walt from ids), format('select * from public.accept_shift_offer(%L)', pg_temp.offer_of((select r_one from s), (select wendy from w)))),
  'CHO04', null, 'D. a worker cannot accept another worker''s offer');
select throws_ok(pg_temp.as_sql((select sam from ids), format('select * from public.accept_shift_offer(%L)', pg_temp.offer_of((select r_one from s), (select wendy from w)))),
  'CHO04', null, 'D. a scheduler cannot accept on a worker''s behalf');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('update public.shift_offers set status = ''accepted'' where id = %L', pg_temp.offer_of((select r_one from s), (select wendy from w)))),
  '42501', null, 'X. offers cannot be updated directly');
select throws_ok(pg_temp.as_sql((select sam from ids), 'insert into public.shift_offers (id) values (gen_random_uuid())'),
  '42501', null, 'X. offers cannot be inserted directly');

-- ---------------------------------------------------------------------------
-- I / K. Acceptance through the gate; the fill closes remaining offers
-- ---------------------------------------------------------------------------
create temp table acc as select pg_temp.accept_offer((select walt from ids), pg_temp.offer_of((select r_one from s), (select walt from w))) as r;
select is((select r ->> 'outcome' from acc), 'allowed', 'a worker accepts their own offer');
select is((select status::text || '/' || (assignment_id = (select (r ->> 'assignment_id')::uuid from acc))::text
           from public.shift_offers where id = pg_temp.offer_of((select r_one from s), (select walt from w))),
  'accepted/true', 'the accepted offer points at the new assignment');
select is((select assigned_by_membership_id from public.shift_assignments where id = (select (r ->> 'assignment_id')::uuid from acc)),
  pg_temp.membership_of((select alpha from orgs), (select sam from ids)), 'the assignment is attributed to the scheduler who offered');
select is((select status::text from public.shift_assignments where id = (select (r ->> 'assignment_id')::uuid from acc)),
  'accepted', 'an accepted offer yields an accepted assignment (the worker already consented)');
select is((select status::text || '/' || close_reason::text from public.shift_offers where id = pg_temp.offer_of((select r_one from s), (select wendy from w))),
  'cancelled/shift_filled', 'K. when headcount fills, remaining offers close');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.accept_shift_offer(%L)', pg_temp.offer_of((select r_one from s), (select wendy from w)))),
  'CHO09', null, 'K. a closed offer cannot be accepted');
select is((select count(*)::int from public.audit_events where action = 'shift.offer_accepted'), 1, 'acceptance is audited');

-- I. A live offer on a full shift (e.g. arranged by the owner) is refused SHIFT_FULL and closed.
insert into public.shift_offers (shift_id, agency_organisation_id, agency_worker_id, profile_id, expires_at, created_by_membership_id)
values ((select r_one from s), (select alpha from orgs), (select wendy from w), (select wendy from ids), now() + interval '1 hour',
        pg_temp.membership_of((select alpha from orgs), (select sam from ids)));
select is((select r ->> 'primary_reason' from (select pg_temp.accept_offer((select wendy from ids), pg_temp.offer_of((select r_one from s), (select wendy from w))) r) q),
  'SHIFT_FULL', 'I. acceptance re-checks capacity: a full shift is refused');
select is((select count(*)::int from public.shift_assignments where shift_id = (select r_one from s) and status in ('assigned', 'accepted')),
  1, 'I. headcount is never exceeded');
select is((select close_reason::text from public.shift_offers where id = pg_temp.offer_of((select r_one from s), (select wendy from w))),
  'shift_filled', 'the refused offer on a full shift is closed');

-- ---------------------------------------------------------------------------
-- G / H. Acceptance re-runs compliance and schedule
-- ---------------------------------------------------------------------------
select pg_temp.offer((select sam from ids), (select r_two from s), array[(select wendy from w), (select walt from w)]);
-- H: wendy is then directly assigned to an overlapping Mercy shift (New York 08–12 overlaps Chicago 07–15).
select pg_temp.assign((select sam from ids), (select m_overlap from s), (select wendy from w));
select is((select r ->> 'primary_reason' from (select pg_temp.accept_offer((select wendy from ids), pg_temp.offer_of((select r_two from s), (select wendy from w))) r) q),
  'WORKER_SCHEDULE_CONFLICT', 'H. acceptance re-checks the person''s schedule');
-- G: walt stops sharing BLS after being offered.
select pg_temp.exec_as((select walt from ids), 'aal1', format('select public.revoke_credential_share(%L)',
  (select id from public.credential_shares where credential_id = (select (walt_bls ->> 'credential_id')::uuid from ev) and status = 'active')));
create temp table g as select pg_temp.accept_offer((select walt from ids), pg_temp.offer_of((select r_two from s), (select walt from w))) as r;
select is((select (r ->> 'primary_reason') || '/' || (r -> 'compliance_reasons' ->> 0) from g),
  'WORKER_NOT_ELIGIBLE/CREDENTIAL_NOT_SHARED', 'G. acceptance re-runs compliance with safe reasons');
select is((select outcome::text || '/' || (actor_membership_id = pg_temp.membership_of((select alpha from orgs), (select walt from ids)))::text
           from public.assignment_eligibility_decisions order by sequence desc limit 1),
  'refused/true', 'the refused acceptance is recorded as a decision by the worker');
select is((select status::text from public.shift_offers where id = pg_temp.offer_of((select r_two from s), (select walt from w))),
  'offered', 'a compliance refusal leaves the offer open (the worker may fix it before expiry)');

-- ---------------------------------------------------------------------------
-- Decline, withdraw, expiry, shift cancellation, direct assignment
-- ---------------------------------------------------------------------------
select lives_ok(pg_temp.as_sql((select walt from ids), format('select public.decline_shift_offer(%L)', pg_temp.offer_of((select r_two from s), (select walt from w)))),
  'a worker declines their own offer');
select throws_ok(pg_temp.as_sql((select walt from ids), format('select public.decline_shift_offer(%L)', pg_temp.offer_of((select r_two from s), (select walt from w)))),
  'CHO09', null, 'a declined offer is closed');

select pg_temp.offer((select sam from ids), (select r_nine from s), array[(select wendy from w)]);
select lives_ok(pg_temp.as_sql((select sam from ids), format('select public.cancel_shift_offer(%L)', pg_temp.offer_of((select r_nine from s), (select wendy from w)))),
  'the agency withdraws an offer');
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.accept_shift_offer(%L)', pg_temp.offer_of((select r_nine from s), (select wendy from w)))),
  'CHO09', null, 'F. a cancelled offer cannot be accepted');

-- E. Expiry is deterministic server-side, even before the scheduled job runs.
insert into public.shift_offers (shift_id, agency_organisation_id, agency_worker_id, profile_id, offered_at, expires_at, created_by_membership_id)
values ((select r_nine from s), (select alpha from orgs), (select wendy from w), (select wendy from ids),
        now() - interval '2 hours', now() - interval '1 hour', pg_temp.membership_of((select alpha from orgs), (select sam from ids)));
select throws_ok(pg_temp.as_sql((select wendy from ids), format('select * from public.accept_shift_offer(%L)', pg_temp.offer_of((select r_nine from s), (select wendy from w)))),
  'CHO10', null, 'E. an expired offer cannot be accepted');
select is(internal.run_offer_expiry(), 1, 'the expiry job marks stale offers expired');
select is(internal.run_offer_expiry(), 0, 'the expiry job is idempotent');

select pg_temp.offer((select sam from ids), (select r_nine from s), array[(select wendy from w)]);
select pg_temp.exec_as((select sam from ids), 'aal1', format('select public.cancel_shift(%L, ''other'')', (select r_nine from s)));
select is((select count(*)::int from public.shift_offers where shift_id = (select r_nine from s) and status = 'offered'),
  0, 'cancelling a shift closes its live offers (reason shift_cancelled)');

-- ---------------------------------------------------------------------------
-- Structure (owner role)
-- ---------------------------------------------------------------------------
select throws_ok(format($$
  insert into public.shift_offers (shift_id, agency_organisation_id, agency_worker_id, profile_id, expires_at, created_by_membership_id)
  values (%L, %L, %L, %L, now() + interval '1 hour', %L) $$,
  (select r_two from s), (select alpha from orgs), (select wendy_beta from w), (select wendy from ids),
  pg_temp.membership_of((select alpha from orgs), (select sam from ids))),
  '23503', null, 'an offer''s worker must belong to the shift''s agency');
select throws_ok(format($$
  insert into public.shift_offers (shift_id, agency_organisation_id, agency_worker_id, profile_id, expires_at, created_by_membership_id)
  values (%L, %L, %L, %L, now() + interval '1 hour', %L) $$,
  (select r_two from s), (select alpha from orgs), (select nora from w), (select walt from ids),
  pg_temp.membership_of((select alpha from orgs), (select sam from ids))),
  '23503', null, 'an offer''s person must be the worker record''s person');
select throws_ok(format($$ update public.shift_offers set expires_at = now() + interval '9 days' where id = %L $$,
  pg_temp.offer_of((select r_one from s), (select walt from w))),
  'CH409', null, 'an offer''s expiry is immutable');

select * from finish();
rollback;
