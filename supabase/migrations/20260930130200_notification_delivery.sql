-- =============================================================================
-- Migration: notification_delivery
-- Stage:     P0-E5-S2
--
-- Purpose
--   Turns internal.notification_outbox (P0-E5-S1) into a reliable delivery
--   queue. Docs: docs/architecture/NOTIFICATION_DELIVERY.md.
--
--   One outbox row = one event for ONE recipient profile (fan-out happens at
--   enqueue time, by an explicit recipient policy). The row holds identifiers
--   only — never an email address, body or token. The address and template
--   data are resolved at CLAIM time (close to delivery), from current data.
--
--   State machine:
--     pending ──claim──► processing ──complete(sent)──► sent
--                            │   └─complete(transient)──► retry ──claim──► …
--                            │   └─complete(permanent) / attempts exhausted──► failed
--                            └─ lease expired (crashed worker) ──► reclaimable
--   Claiming uses FOR UPDATE SKIP LOCKED plus a per-claim token, so two
--   dispatchers never hold the same row and a stale dispatcher cannot
--   overwrite a newer outcome.
--
--   Retry schedule (after failed attempt n): 1 min, 5 min, 30 min, 2 h; the
--   5th failed attempt is final. Permanent provider errors fail immediately.
--   Rows past `deliver_until` (e.g. the shift already ended) are failed as
--   `expired_before_delivery` instead of being sent late.
--
--   Runtime access: the dispatcher (a Next.js route, see
--   src/app/api/internal/notifications/dispatch) connects as a login role
--   that is a member of chelth_notification_worker. That role can EXECUTE
--   exactly internal.claim_notifications and internal.complete_notification —
--   no table access, no other function, no RLS bypass. No service-role key.
--
-- Verified by: supabase/tests/security/140_notification_delivery.test.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Operational settings (singleton; no API access)
-- -----------------------------------------------------------------------------
create table internal.operations_settings (
  id boolean primary key default true check (id),
  readiness_horizon interval not null default interval '14 days'
    check (readiness_horizon between interval '1 hour' and interval '60 days'),
  max_notification_attempts integer not null default 5 check (max_notification_attempts between 1 and 10),
  notification_retry_schedule interval[] not null
    default array[interval '1 minute', interval '5 minutes', interval '30 minutes', interval '2 hours'],
  max_ops_recipients integer not null default 25 check (max_ops_recipients between 1 and 100),
  updated_at timestamptz not null default now()
);
insert into internal.operations_settings (id) values (true);
alter table internal.operations_settings enable row level security;

-- -----------------------------------------------------------------------------
-- Outbox: delivery columns
-- -----------------------------------------------------------------------------
drop index if exists internal.notification_outbox_one_pending_non_compliant;

alter table internal.notification_outbox
  add column state internal.notification_state not null default 'pending',
  add column attempts integer not null default 0 check (attempts between 0 and 20),
  add column next_attempt_at timestamptz not null default now(),
  add column claim_token uuid,
  add column claimed_until timestamptz,
  add column sent_at timestamptz,
  add column last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_]{1,40}$'),
  add column provider text check (provider is null or provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  add column provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  add column deliver_until timestamptz,
  -- The tenant that "owns" this delivery: the recipient's organisation.
  add column audience_organisation_id uuid references public.organisations (id) on delete restrict,
  -- Small, non-personal facts for the template (e.g. counts). Never addresses or text.
  add column detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 512);

-- Rows written by P0-E5-S1 were never deliverable (organisation-level, no
-- recipient). They are closed, not sent late.
update internal.notification_outbox
   set state = 'failed', last_error_code = 'legacy_undelivered', processed_at = coalesce(processed_at, now()),
       audience_organisation_id = coalesce(recipient_organisation_id, organisation_id);

alter table internal.notification_outbox
  alter column audience_organisation_id set not null,
  add constraint notification_outbox_recipient_required
    check (recipient_profile_id is not null or last_error_code = 'legacy_undelivered'),
  add constraint notification_outbox_sent_consistent
    check ((state = 'sent') = (sent_at is not null)),
  add constraint notification_outbox_processing_claimed
    check (state <> 'processing' or (claim_token is not null and claimed_until is not null));

create index notification_outbox_due_idx
  on internal.notification_outbox (next_attempt_at) where state in ('pending', 'retry');
create index notification_outbox_processing_idx
  on internal.notification_outbox (claimed_until) where state = 'processing';
create index notification_outbox_audience_idx
  on internal.notification_outbox (audience_organisation_id, created_at desc);
-- The same event is never queued twice for the same recipient and subject.
create unique index notification_outbox_one_open_per_recipient
  on internal.notification_outbox (event, subject_id, recipient_profile_id)
  where state in ('pending', 'processing', 'retry');

-- -----------------------------------------------------------------------------
-- Recipient policy (narrowest safe default; no preference centre yet)
--   worker events            → the worker's profile only
--   agency operational events → active members of the agency holding
--                                assignment.manage (capped), excluding the actor
--   facility events           → active members of the linked facility holding
--                                shift.request (capped), excluding the actor
-- All current events are REQUIRED operational notifications.
-- -----------------------------------------------------------------------------
create function internal.notification_recipients(p_organisation_id uuid, p_capability text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.profile_id
  from public.organisation_memberships m
  where m.organisation_id = p_organisation_id
    and m.status = 'active'
    and m.profile_id is distinct from auth.uid()
    and exists (
      select 1 from internal.profile_capabilities(m.profile_id, p_organisation_id) c
      where c.capability_key = p_capability
    )
  order by m.created_at, m.id
  limit (select s.max_ops_recipients from internal.operations_settings s)
$$;

drop function internal.enqueue_notification(internal.notification_event, uuid, uuid, uuid, text, uuid);

-- p_organisation_id:           the agency the event belongs to (context)
-- p_recipient_profile_id:      a specific person (worker events), or NULL
-- p_recipient_organisation_id: an organisation whose operational users are notified
create function internal.enqueue_notification(
  p_event internal.notification_event,
  p_organisation_id uuid,
  p_recipient_profile_id uuid,
  p_recipient_organisation_id uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_detail jsonb default '{}'::jsonb,
  p_deliver_until timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audience uuid := coalesce(p_recipient_organisation_id, p_organisation_id);
  v_capability text;
  v_count integer := 0;
  v_deliver_until timestamptz := coalesce(p_deliver_until, now() + interval '7 days');
begin
  if p_recipient_profile_id is not null then
    insert into internal.notification_outbox
      (event, organisation_id, recipient_profile_id, recipient_organisation_id, audience_organisation_id,
       subject_type, subject_id, detail, deliver_until)
    values (p_event, p_organisation_id, p_recipient_profile_id, null, v_audience,
            p_subject_type, p_subject_id, coalesce(p_detail, '{}'::jsonb), v_deliver_until)
    on conflict do nothing;
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  v_capability := case when v_audience = p_organisation_id then 'assignment.manage' else 'shift.request' end;
  insert into internal.notification_outbox
    (event, organisation_id, recipient_profile_id, recipient_organisation_id, audience_organisation_id,
     subject_type, subject_id, detail, deliver_until)
  select p_event, p_organisation_id, r, v_audience, v_audience, p_subject_type, p_subject_id,
         coalesce(p_detail, '{}'::jsonb), v_deliver_until
  from internal.notification_recipients(v_audience, v_capability) r
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Template data: display strings only, resolved from CURRENT data at claim
-- time. No ids in display fields; `path` is a canonical application route.
-- -----------------------------------------------------------------------------
create function internal.notification_template(p_notification_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n internal.notification_outbox;
  v_shift_id uuid;
  v_worker_id uuid;
  v_offer public.shift_offers;
  v_data jsonb;
  v_facility_org uuid;
  v_audience text;
  v_path text;
begin
  select * into n from internal.notification_outbox x where x.id = p_notification_id;
  if n.id is null then
    return null;
  end if;

  if n.subject_type = 'shift_assignment' then
    select a.shift_id, a.agency_worker_id into v_shift_id, v_worker_id
    from public.shift_assignments a where a.id = n.subject_id;
  elsif n.subject_type = 'shift' then
    v_shift_id := n.subject_id;
  elsif n.subject_type = 'shift_offer' then
    select * into v_offer from public.shift_offers o where o.id = n.subject_id;
    v_shift_id := v_offer.shift_id;
    v_worker_id := v_offer.agency_worker_id;
  end if;

  v_audience := case
    when n.event in ('worker_assigned', 'assignment_cancelled', 'shift_offered')
      or (n.event = 'shift_cancelled' and n.subject_type = 'shift_assignment') then 'worker'
    when n.audience_organisation_id <> n.organisation_id then 'facility'
    else 'agency' end;

  if n.subject_type = 'relationship' then
    select jsonb_build_object('facilityName', f.name, 'agencyName', o.name)
      into v_data
    from public.agency_facility_relationships r
    join public.agency_facilities f on f.id = r.agency_facility_id
    join public.organisations o on o.id = r.agency_organisation_id
    where r.id = n.subject_id and r.agency_organisation_id = n.organisation_id;
    v_path := '/app/organisations/' || n.organisation_id || '/operations';
  else
    select jsonb_build_object(
             'agencyName', o.name,
             'facilityName', f.name,
             'locationName', l.name,
             'disciplineName', d.name,
             'startAt', s.start_at,
             'endAt', s.end_at,
             'timezone', s.timezone,
             'shiftStatus', s.status,
             'cancellationReason', s.cancellation_reason),
           f.linked_facility_organisation_id
      into v_data, v_facility_org
    from public.shifts s
    join public.organisations o on o.id = s.agency_organisation_id
    join public.agency_facilities f on f.id = s.agency_facility_id
    join public.facility_locations l on l.id = s.facility_location_id
    join public.disciplines d on d.key = s.discipline_key
    where s.id = v_shift_id and s.agency_organisation_id = n.organisation_id;

    if v_data is null then
      return null;
    end if;
    -- Facility recipients must be the shift's linked facility (tenant check at delivery).
    if v_audience = 'facility' and v_facility_org is distinct from n.audience_organisation_id then
      return null;
    end if;

    v_path := case v_audience
      when 'worker' then '/app/organisations/' || n.organisation_id || '/my-shifts'
      when 'facility' then '/app/organisations/' || n.audience_organisation_id || '/staffing-requests/' || v_shift_id
      else '/app/organisations/' || n.organisation_id || '/shifts/' || v_shift_id end;

    -- Agency-facing assignment events name the worker (a colleague record in the same agency).
    if v_audience = 'agency' and v_worker_id is not null then
      v_data := v_data || jsonb_build_object('workerName', (
        select p.display_name from public.agency_workers w join public.profiles p on p.id = w.profile_id
        where w.id = v_worker_id and w.agency_organisation_id = n.organisation_id));
    end if;
    if n.subject_type = 'shift_offer' then
      v_data := v_data || jsonb_build_object('offerExpiresAt', v_offer.expires_at, 'offerStatus', v_offer.status);
    end if;
  end if;

  return coalesce(v_data, '{}'::jsonb) || n.detail || jsonb_build_object(
    'event', n.event,
    'audience', v_audience,
    'path', v_path,
    'recipientName', (select p.display_name from public.profiles p where p.id = n.recipient_profile_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- Claim: bounded, concurrency-safe (SKIP LOCKED), lease-based.
-- Returns the recipient address and template data for each claimed row.
-- -----------------------------------------------------------------------------
create function internal.fail_notification(p_notification_id uuid, p_error_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n internal.notification_outbox;
begin
  update internal.notification_outbox x
     set state = 'failed', last_error_code = p_error_code, processed_at = now(),
         claim_token = null, claimed_until = null
   where x.id = p_notification_id
  returning * into n;
  -- Final failures are audited (identifiers and codes only; never addresses).
  perform internal.record_audit_event('notification.failed', n.audience_organisation_id, 'notification', n.id,
    jsonb_build_object('event', n.event, 'error_code', p_error_code, 'attempts', n.attempts));
end;
$$;

create function internal.claim_notifications(p_limit integer default 25, p_lease_seconds integer default 120)
returns table (
  notification_id uuid,
  event text,
  attempt integer,
  claim_token uuid,
  recipient_email text,
  template jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_lease interval := make_interval(secs => least(greatest(coalesce(p_lease_seconds, 120), 30), 900));
  v_max integer := (select s.max_notification_attempts from internal.operations_settings s);
  v_row internal.notification_outbox;
  v_email text;
  v_template jsonb;
  v_token uuid;
begin
  for v_row in
    select o.* from internal.notification_outbox o
    where (o.state in ('pending', 'retry') and o.next_attempt_at <= now())
       or (o.state = 'processing' and o.claimed_until < now())
    order by o.next_attempt_at, o.created_at, o.id
    limit v_limit
    for update of o skip locked
  loop
    -- A dispatcher that crashed mid-send used an attempt.
    if v_row.state = 'processing' and v_row.attempts >= v_max then
      perform internal.fail_notification(v_row.id, 'lease_expired');
      continue;
    end if;
    if v_row.deliver_until is not null and v_row.deliver_until < now() then
      perform internal.fail_notification(v_row.id, 'expired_before_delivery');
      continue;
    end if;

    -- Address resolved now, from auth, for an active, confirmed identity that
    -- still belongs to the audience organisation.
    select u.email into v_email
    from auth.users u
    join public.profiles p on p.id = u.id and p.status = 'active'
    join public.organisation_memberships m
      on m.profile_id = u.id and m.organisation_id = v_row.audience_organisation_id and m.status = 'active'
    where u.id = v_row.recipient_profile_id
      and u.email is not null
      and u.email_confirmed_at is not null;
    if v_email is null then
      perform internal.fail_notification(v_row.id, 'recipient_unavailable');
      continue;
    end if;

    v_template := internal.notification_template(v_row.id);
    if v_template is null then
      perform internal.fail_notification(v_row.id, 'subject_unavailable');
      continue;
    end if;

    v_token := gen_random_uuid();
    update internal.notification_outbox x
       set state = 'processing', attempts = x.attempts + 1, claim_token = v_token,
           claimed_until = now() + v_lease
     where x.id = v_row.id;

    return query select v_row.id, v_row.event::text, v_row.attempts + 1, v_token, v_email, v_template;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Complete: applies only to the CURRENT claim (token match).
--   p_outcome: 'sent' | 'transient_failure' | 'permanent_failure'
-- -----------------------------------------------------------------------------
create function internal.complete_notification(
  p_notification_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_provider text,
  p_provider_message_id text default null,
  p_error_code text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  n internal.notification_outbox;
  v_settings internal.operations_settings;
  v_code text := case when p_error_code ~ '^[a-z][a-z0-9_]{1,40}$' then p_error_code else 'unknown_error' end;
  v_provider text := case when p_provider ~ '^[a-z][a-z0-9_]{1,30}$' then p_provider else 'unknown' end;
  v_delay interval;
begin
  if p_outcome not in ('sent', 'transient_failure', 'permanent_failure') then
    raise exception 'invalid outcome' using errcode = 'CH400';
  end if;
  select * into n from internal.notification_outbox x
  where x.id = p_notification_id and x.claim_token = p_claim_token and x.state = 'processing'
  for update;
  if n.id is null then
    return 'stale_claim';
  end if;
  select * into v_settings from internal.operations_settings s;

  if p_outcome = 'sent' then
    update internal.notification_outbox x
       set state = 'sent', sent_at = now(), processed_at = now(), provider = v_provider,
           provider_message_id = left(p_provider_message_id, 200), last_error_code = null,
           claim_token = null, claimed_until = null
     where x.id = n.id;
    return 'sent';
  end if;

  update internal.notification_outbox x set provider = v_provider where x.id = n.id;
  if p_outcome = 'permanent_failure' or n.attempts >= v_settings.max_notification_attempts then
    perform internal.fail_notification(n.id, v_code);
    return 'failed';
  end if;

  v_delay := coalesce(
    v_settings.notification_retry_schedule[least(n.attempts, cardinality(v_settings.notification_retry_schedule))],
    interval '2 hours');
  update internal.notification_outbox x
     set state = 'retry', last_error_code = v_code, next_attempt_at = now() + v_delay,
         claim_token = null, claimed_until = null
   where x.id = n.id;
  return 'retry';
end;
$$;

-- -----------------------------------------------------------------------------
-- Dispatcher role: EXECUTE on two functions, nothing else.
-- A LOGIN role is created per environment by the operator (never in a
-- migration: it carries a password) — see NOTIFICATION_DELIVERY.md §7.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'chelth_notification_worker') then
    create role chelth_notification_worker nologin;
  end if;
end;
$$;

grant usage on schema internal to chelth_notification_worker;

revoke all on function
  internal.notification_recipients(uuid, text),
  internal.enqueue_notification(internal.notification_event, uuid, uuid, uuid, text, uuid, jsonb, timestamptz),
  internal.notification_template(uuid),
  internal.fail_notification(uuid, text),
  internal.claim_notifications(integer, integer),
  internal.complete_notification(uuid, uuid, text, text, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  internal.claim_notifications(integer, integer),
  internal.complete_notification(uuid, uuid, text, text, text, text)
to chelth_notification_worker;

-- -----------------------------------------------------------------------------
-- Delivery status for agency operations (no addresses, no bodies).
-- Only deliveries whose recipient belongs to the caller's organisation.
-- -----------------------------------------------------------------------------
create function public.list_notification_deliveries(
  p_organisation_id uuid,
  p_problems_only boolean default true,
  p_limit integer default 50
)
returns table (
  notification_id uuid,
  event text,
  state text,
  attempts integer,
  last_error_code text,
  recipient_name text,
  shift_id uuid,
  created_at timestamptz,
  next_attempt_at timestamptz,
  sent_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'assignment.view');
  return query
    select n.id, n.event::text, n.state::text, n.attempts, n.last_error_code, p.display_name,
           case n.subject_type
             when 'shift' then n.subject_id
             when 'shift_assignment' then (select a.shift_id from public.shift_assignments a where a.id = n.subject_id)
             when 'shift_offer' then (select o.shift_id from public.shift_offers o where o.id = n.subject_id)
           end,
           n.created_at, n.next_attempt_at, n.sent_at
    from internal.notification_outbox n
    left join public.profiles p on p.id = n.recipient_profile_id
    where n.audience_organisation_id = p_organisation_id
      and n.last_error_code is distinct from 'legacy_undelivered'
      and (not coalesce(p_problems_only, true) or n.state in ('failed', 'retry'))
    order by n.created_at desc, n.id
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.list_notification_deliveries(uuid, boolean, integer) from public, anon;
grant execute on function public.list_notification_deliveries(uuid, boolean, integer) to authenticated;
