-- =============================================================================
-- Migration: operational_messaging
-- Stage:     P0-E9-3D-S3 (designed in P0-E9-3D-S1 §3 D5–D7, §4 M2)
--
-- Purpose
--   Retained, text-only operational messaging. Not a chat platform.
--
--   Threads
--     worker    worker ↔ agency, optionally about one shift (or request) the
--               worker is assigned to
--     facility  agency ↔ facility, about one relationship and optionally one
--               shift / staffing request under it. Workers are never in
--               facility threads; facility users never see worker threads.
--
--   Authorisation is DERIVED on every read and write (deny by default), never
--   copied into participant rows:
--     worker side    the thread's worker, while their membership and worker
--                    record are active
--     agency side    message.view (read) / message.send (write) in the agency
--     facility side  the same capabilities in the explicitly linked facility
--                    organisation for that relationship (the existing
--                    relationship-scoped cross-organisation rule)
--   Losing the membership, capability or relationship removes access at once.
--
--   Messages are append-only (no update, no delete), server-timestamped, and
--   idempotent per (thread, sender, client key). Threads are never deleted.
--   No message body is copied into audit events or notifications.
--
-- Verified by: supabase/tests/security/160_messaging.test.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.conversation_threads (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null references public.organisations (id) on delete restrict,
  kind public.conversation_kind not null,
  agency_worker_id uuid,
  worker_profile_id uuid,
  relationship_id uuid,
  shift_id uuid,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  foreign key (agency_worker_id, agency_organisation_id, worker_profile_id)
    references public.agency_workers (id, agency_organisation_id, profile_id) on delete restrict,
  foreign key (relationship_id, agency_organisation_id)
    references public.agency_facility_relationships (id, agency_organisation_id) on delete restrict,
  foreign key (shift_id, agency_organisation_id)
    references public.shifts (id, agency_organisation_id) on delete restrict,
  check (
    (kind = 'worker' and agency_worker_id is not null and worker_profile_id is not null and relationship_id is null)
    or (kind = 'facility' and relationship_id is not null and agency_worker_id is null and worker_profile_id is null)
  )
);

comment on table public.conversation_threads is
  'Operational message threads (worker ↔ agency, agency ↔ facility). Access is derived from context; never deleted.';

create unique index conversation_threads_one_worker_thread
  on public.conversation_threads (agency_worker_id, shift_id) nulls not distinct where kind = 'worker';
create unique index conversation_threads_one_facility_thread
  on public.conversation_threads (relationship_id, shift_id) nulls not distinct where kind = 'facility';
create index conversation_threads_agency_recent_idx
  on public.conversation_threads (agency_organisation_id, last_message_at desc nulls last);
create index conversation_threads_worker_idx on public.conversation_threads (worker_profile_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.conversation_threads (id) on delete restrict,
  agency_organisation_id uuid not null,
  -- No FK: the record must outlive the identities it names (as audit_events).
  sender_profile_id uuid not null,
  sender_side public.message_sender_side not null,
  body text not null
    check (char_length(btrim(body)) between 1 and 2000 and body !~ '[\x01-\x09\x0b-\x1f\x7f]'),
  client_key uuid not null,
  -- The server's clock at insert (not the transaction start), for exact ordering.
  created_at timestamptz not null default clock_timestamp(),
  unique (thread_id, sender_profile_id, client_key)
);

comment on table public.messages is 'Append-only operational messages (text only). Never edited or deleted.';

create index messages_thread_recent_idx on public.messages (thread_id, created_at desc, id desc);

create table public.message_receipts (
  thread_id uuid not null references public.conversation_threads (id) on delete restrict,
  profile_id uuid not null,
  last_read_at timestamptz not null,
  last_read_message_id uuid references public.messages (id) on delete restrict,
  primary key (thread_id, profile_id)
);

-- Append-only: history is never rewritten or removed.
create function internal.protect_message_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'operational messages are retained and cannot be changed or deleted' using errcode = 'CH409';
end;
$$;

create trigger messages_append_only
  before update or delete on public.messages
  for each row execute function internal.protect_message_history();
create trigger conversation_threads_retained
  before delete on public.conversation_threads
  for each row execute function internal.protect_message_history();

-- -----------------------------------------------------------------------------
-- Authorisation helpers
-- -----------------------------------------------------------------------------
-- The side the caller acts as on this thread for a capability, or null.
create function authz.thread_side(p_thread_id uuid, p_capability text)
returns public.message_sender_side
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when t.kind = 'worker' and t.worker_profile_id = auth.uid()
         and authz.is_own_active_worker(t.agency_worker_id) then 'worker'::public.message_sender_side
    when authz.has_capability(t.agency_organisation_id, p_capability) then 'agency'::public.message_sender_side
    when t.kind = 'facility' and authz.has_relationship_capability(t.relationship_id, p_capability)
      then 'facility'::public.message_sender_side
  end
  from public.conversation_threads t
  where t.id = p_thread_id
$$;

create function authz.can_read_thread(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select authz.thread_side(p_thread_id, 'message.view') is not null
$$;

revoke all on function
  authz.thread_side(uuid, text),
  authz.can_read_thread(uuid)
from public, anon;
grant execute on function
  authz.thread_side(uuid, text),
  authz.can_read_thread(uuid)
to authenticated;
revoke all on function internal.protect_message_history() from public, anon, authenticated;

alter table public.conversation_threads enable row level security;
alter table public.messages enable row level security;
alter table public.message_receipts enable row level security;
grant select on public.conversation_threads, public.messages, public.message_receipts to authenticated;

create policy conversation_threads_select on public.conversation_threads
  for select to authenticated using (authz.can_read_thread(id));
create policy messages_select on public.messages
  for select to authenticated using (authz.can_read_thread(thread_id));
create policy message_receipts_select on public.message_receipts
  for select to authenticated using (profile_id = auth.uid());
-- No insert / update / delete grants or policies: writes go through the RPCs below.

-- -----------------------------------------------------------------------------
-- Internal: thread projection for one viewer
-- -----------------------------------------------------------------------------
create function internal.thread_view(p_thread_id uuid, p_side public.message_sender_side)
returns table (
  thread_id uuid,
  kind public.conversation_kind,
  viewer_side public.message_sender_side,
  agency_organisation_id uuid,
  agency_name text,
  facility_name text,
  worker_name text,
  shift_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  discipline_name text,
  unit_label text,
  my_assignment_id uuid,
  last_message_at timestamptz,
  last_message_preview text,
  last_sender_side public.message_sender_side,
  unread_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.kind, p_side, t.agency_organisation_id, o.name,
         coalesce(sf.name, rf.name),
         -- The worker's name is shown to agency staff only.
         case when p_side = 'agency' then wp.display_name end,
         s.id, s.start_at, s.end_at, s.timezone, d.name, s.unit_label,
         case when p_side = 'worker' then (
           select a.id from public.shift_assignments a
           where a.shift_id = t.shift_id and a.agency_worker_id = t.agency_worker_id
           order by a.created_at desc limit 1) end,
         t.last_message_at,
         (select left(m.body, 140) from public.messages m where m.thread_id = t.id
           order by m.created_at desc, m.id desc limit 1),
         (select m.sender_side from public.messages m where m.thread_id = t.id
           order by m.created_at desc, m.id desc limit 1),
         (select count(*)::integer from public.messages m
           where m.thread_id = t.id and m.sender_profile_id <> auth.uid()
             and m.created_at > coalesce((select r.last_read_at from public.message_receipts r
                                          where r.thread_id = t.id and r.profile_id = auth.uid()), '-infinity'))
  from public.conversation_threads t
  join public.organisations o on o.id = t.agency_organisation_id
  left join public.shifts s on s.id = t.shift_id
  left join public.agency_facilities sf on sf.id = s.agency_facility_id
  left join public.disciplines d on d.key = s.discipline_key
  left join public.agency_facility_relationships r on r.id = t.relationship_id
  left join public.agency_facilities rf on rf.id = r.agency_facility_id
  left join public.profiles wp on wp.id = t.worker_profile_id
  where t.id = p_thread_id
$$;

revoke all on function internal.thread_view(uuid, public.message_sender_side) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- RPCs: open threads
-- -----------------------------------------------------------------------------
-- Worker ↔ agency thread for a worker record, optionally about a shift the
-- worker is (or was) assigned to. The worker themself, or agency staff with
-- message.send, may open it. Get-or-create.
create function public.open_worker_thread(p_agency_worker_id uuid, p_shift_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  w public.agency_workers;
  v_thread uuid;
begin
  select * into w from public.agency_workers x where x.id = p_agency_worker_id;
  if w.id is null or not (
    (w.profile_id = v_profile_id and authz.is_own_active_worker(w.id))
    or authz.has_capability(w.agency_organisation_id, 'message.send')
  ) then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  if p_shift_id is not null and not exists (
    select 1 from public.shift_assignments a
    where a.shift_id = p_shift_id and a.agency_worker_id = w.id
  ) then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;

  perform pg_advisory_xact_lock(hashtext('worker-thread:' || w.id::text || ':' || coalesce(p_shift_id::text, '-')));
  select t.id into v_thread from public.conversation_threads t
   where t.kind = 'worker' and t.agency_worker_id = w.id and t.shift_id is not distinct from p_shift_id;
  if v_thread is null then
    insert into public.conversation_threads
      (agency_organisation_id, kind, agency_worker_id, worker_profile_id, shift_id, created_by_profile_id)
    values (w.agency_organisation_id, 'worker', w.id, w.profile_id, p_shift_id, v_profile_id)
    returning id into v_thread;
    perform internal.record_audit_event('message.thread_opened', w.agency_organisation_id,
      'conversation_thread', v_thread, jsonb_build_object('kind', 'worker', 'shift', p_shift_id is not null));
  end if;
  return v_thread;
end;
$$;

-- Agency ↔ facility thread for a relationship, optionally about one shift or
-- staffing request under it (never a draft). Either side with message.send.
create function public.open_facility_thread(p_relationship_id uuid, p_shift_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  r public.agency_facility_relationships;
  v_thread uuid;
begin
  select * into r from public.agency_facility_relationships x where x.id = p_relationship_id;
  if r.id is null or not (
    authz.has_capability(r.agency_organisation_id, 'message.send')
    or authz.has_relationship_capability(r.id, 'message.send')
  ) then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  if p_shift_id is not null and not exists (
    select 1 from public.shifts s
    where s.id = p_shift_id and s.relationship_id = r.id and s.status <> 'draft'
  ) then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;

  perform pg_advisory_xact_lock(hashtext('facility-thread:' || r.id::text || ':' || coalesce(p_shift_id::text, '-')));
  select t.id into v_thread from public.conversation_threads t
   where t.kind = 'facility' and t.relationship_id = r.id and t.shift_id is not distinct from p_shift_id;
  if v_thread is null then
    insert into public.conversation_threads
      (agency_organisation_id, kind, relationship_id, shift_id, created_by_profile_id)
    values (r.agency_organisation_id, 'facility', r.id, p_shift_id, v_profile_id)
    returning id into v_thread;
    perform internal.record_audit_event('message.thread_opened', r.agency_organisation_id,
      'conversation_thread', v_thread, jsonb_build_object('kind', 'facility', 'shift', p_shift_id is not null));
  end if;
  return v_thread;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs: send, read
-- -----------------------------------------------------------------------------
create function public.send_message(p_thread_id uuid, p_body text, p_client_key uuid)
returns table (message_id uuid, created_at timestamptz, duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  v_side public.message_sender_side := authz.thread_side(p_thread_id, 'message.send');
  t public.conversation_threads;
  v_body text := btrim(p_body);
  m public.messages;
begin
  if v_side is null then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  if p_client_key is null or v_body is null or char_length(v_body) not between 1 and 2000
     or v_body ~ '[\x01-\x09\x0b-\x1f\x7f]' then
    raise exception 'invalid message' using errcode = 'CH400';
  end if;

  -- Idempotent: a retried or double-tapped send returns the original message.
  select * into m from public.messages x
   where x.thread_id = p_thread_id and x.sender_profile_id = v_profile_id and x.client_key = p_client_key;
  if m.id is not null then
    return query select m.id, m.created_at, true;
    return;
  end if;

  if not internal.consume_rate_limit('message.send:' || v_profile_id, 300, interval '1 day') then
    raise exception 'too many messages' using errcode = 'CH429';
  end if;

  select * into t from public.conversation_threads x where x.id = p_thread_id for update;
  insert into public.messages as x (thread_id, agency_organisation_id, sender_profile_id, sender_side, body, client_key)
  values (t.id, t.agency_organisation_id, v_profile_id, v_side, v_body, p_client_key)
  on conflict (thread_id, sender_profile_id, client_key) do nothing
  returning x.* into m;
  if m.id is null then
    select * into m from public.messages x
     where x.thread_id = p_thread_id and x.sender_profile_id = v_profile_id and x.client_key = p_client_key;
    return query select m.id, m.created_at, true;
    return;
  end if;

  update public.conversation_threads x set last_message_at = m.created_at where x.id = t.id;
  insert into public.message_receipts as r (thread_id, profile_id, last_read_at, last_read_message_id)
  values (t.id, v_profile_id, m.created_at, m.id)
  on conflict (thread_id, profile_id) do update
    set last_read_at = greatest(r.last_read_at, excluded.last_read_at),
        last_read_message_id = excluded.last_read_message_id;

  -- The worker is told there is a new message (no body; one open notice per thread).
  if t.kind = 'worker' and v_side <> 'worker' then
    perform internal.enqueue_notification('message_received', t.agency_organisation_id, t.worker_profile_id,
      null, 'conversation_thread', t.id);
  end if;

  return query select m.id, m.created_at, false;
end;
$$;

create function public.mark_thread_read(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_latest public.messages;
begin
  if not authz.can_read_thread(p_thread_id) then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  select * into v_latest from public.messages m where m.thread_id = p_thread_id
   order by m.created_at desc, m.id desc limit 1;
  if v_latest.id is null then
    return;
  end if;
  insert into public.message_receipts as r (thread_id, profile_id, last_read_at, last_read_message_id)
  values (p_thread_id, v_profile_id, v_latest.created_at, v_latest.id)
  on conflict (thread_id, profile_id) do update
    set last_read_at = greatest(r.last_read_at, excluded.last_read_at),
        last_read_message_id = case when excluded.last_read_at >= r.last_read_at
                                    then excluded.last_read_message_id else r.last_read_message_id end;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs: projections
-- -----------------------------------------------------------------------------
-- Threads the caller may read in one organisation (an agency, or a facility
-- organisation for its relationship threads), newest first.
create function public.list_my_threads(
  p_organisation_id uuid,
  p_unread_only boolean default false,
  p_limit integer default 50
)
returns table (
  thread_id uuid,
  kind public.conversation_kind,
  viewer_side public.message_sender_side,
  agency_organisation_id uuid,
  agency_name text,
  facility_name text,
  worker_name text,
  shift_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  discipline_name text,
  unit_label text,
  my_assignment_id uuid,
  last_message_at timestamptz,
  last_message_preview text,
  last_sender_side public.message_sender_side,
  unread_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  return query
    with candidates as (
      select t.id,
             case
               when t.agency_organisation_id = p_organisation_id then authz.thread_side(t.id, 'message.view')
               when t.kind = 'facility' and f.linked_facility_organisation_id = p_organisation_id
                    and authz.has_relationship_capability(t.relationship_id, 'message.view')
                 then 'facility'::public.message_sender_side
             end as side
      from public.conversation_threads t
      left join public.agency_facility_relationships r on r.id = t.relationship_id
      left join public.agency_facilities f on f.id = r.agency_facility_id
      where t.agency_organisation_id = p_organisation_id
         or (t.kind = 'facility' and f.linked_facility_organisation_id = p_organisation_id)
    )
    select v.*
    from candidates c
    cross join lateral internal.thread_view(c.id, c.side) v
    where c.side is not null
      and (not p_unread_only or v.unread_count > 0)
    order by coalesce(v.last_message_at, '-infinity'::timestamptz) desc, v.thread_id
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

create function public.get_thread(p_thread_id uuid)
returns table (
  thread_id uuid,
  kind public.conversation_kind,
  viewer_side public.message_sender_side,
  agency_organisation_id uuid,
  agency_name text,
  facility_name text,
  worker_name text,
  shift_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  discipline_name text,
  unit_label text,
  my_assignment_id uuid,
  last_message_at timestamptz,
  last_message_preview text,
  last_sender_side public.message_sender_side,
  unread_count integer,
  can_send boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_side public.message_sender_side := authz.thread_side(p_thread_id, 'message.view');
begin
  perform internal.require_identity();
  if v_side is null then
    -- Missing and invisible threads are indistinguishable.
    return;
  end if;
  return query
    select v.*, authz.thread_side(p_thread_id, 'message.send') is not null
    from internal.thread_view(p_thread_id, v_side) v;
end;
$$;

-- Keyset page of messages, newest first. Sender labels never expose staff
-- names across organisations: the other organisation appears by its name.
create function public.list_thread_messages(
  p_thread_id uuid,
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 30
)
returns table (
  message_id uuid,
  sender_side public.message_sender_side,
  sender_label text,
  is_mine boolean,
  body text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  v_side public.message_sender_side := authz.thread_side(p_thread_id, 'message.view');
  t public.conversation_threads;
  v_agency text;
  v_facility text;
begin
  if v_side is null then
    return;
  end if;
  select * into t from public.conversation_threads x where x.id = p_thread_id;
  select o.name into v_agency from public.organisations o where o.id = t.agency_organisation_id;
  select fo.name into v_facility
  from public.agency_facility_relationships r
  join public.agency_facilities f on f.id = r.agency_facility_id
  left join public.organisations fo on fo.id = f.linked_facility_organisation_id
  where r.id = t.relationship_id;

  return query
    select m.id, m.sender_side,
           case
             when m.sender_profile_id = v_profile_id then 'You'
             when m.sender_side = 'worker' then coalesce(p.display_name, 'Worker')
             when m.sender_side = v_side then coalesce(p.display_name, 'A colleague')
             when m.sender_side = 'agency' then v_agency
             else coalesce(v_facility, 'The facility')
           end,
           m.sender_profile_id = v_profile_id,
           m.body, m.created_at
    from public.messages m
    left join public.profiles p on p.id = m.sender_profile_id
    where m.thread_id = p_thread_id
      and (p_before_at is null or (m.created_at, m.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by m.created_at desc, m.id desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

create function public.unread_message_count(p_organisation_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(t.unread_count), 0)::integer
  from public.list_my_threads(p_organisation_id, true, 200) t
$$;

revoke all on function
  public.open_worker_thread(uuid, uuid),
  public.open_facility_thread(uuid, uuid),
  public.send_message(uuid, text, uuid),
  public.mark_thread_read(uuid),
  public.list_my_threads(uuid, boolean, integer),
  public.get_thread(uuid),
  public.list_thread_messages(uuid, timestamptz, uuid, integer),
  public.unread_message_count(uuid)
from public, anon;
grant execute on function
  public.open_worker_thread(uuid, uuid),
  public.open_facility_thread(uuid, uuid),
  public.send_message(uuid, text, uuid),
  public.mark_thread_read(uuid),
  public.list_my_threads(uuid, boolean, integer),
  public.get_thread(uuid),
  public.list_thread_messages(uuid, timestamptz, uuid, integer),
  public.unread_message_count(uuid)
to authenticated;

-- -----------------------------------------------------------------------------
-- Notification template: + conversation_thread (the latest definition from
-- 20261001100400_pricing_engine.sql, unchanged apart from the new branch).
-- -----------------------------------------------------------------------------
create or replace function internal.notification_template(p_notification_id uuid)
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
    when n.recipient_organisation_id is null then 'worker'
    when n.audience_organisation_id <> n.organisation_id then 'facility'
    else 'agency' end;

  if n.subject_type = 'conversation_thread' then
    -- P0-E9-3D-S3: a new message for the worker. Never the message body.
    if v_audience <> 'worker' then
      return null;
    end if;
    select jsonb_build_object('agencyName', o.name, 'facilityName', f.name,
                              'startAt', s.start_at, 'endAt', s.end_at, 'timezone', s.timezone)
      into v_data
    from public.conversation_threads t
    join public.organisations o on o.id = t.agency_organisation_id
    left join public.shifts s on s.id = t.shift_id
    left join public.agency_facilities f on f.id = s.agency_facility_id
    where t.id = n.subject_id and t.agency_organisation_id = n.organisation_id
      and t.worker_profile_id = n.recipient_profile_id;
    if v_data is null then
      return null;
    end if;
    v_path := '/app/organisations/' || n.organisation_id || '/messages/' || n.subject_id;
  elsif n.subject_type = 'relationship' then
    select jsonb_build_object('facilityName', f.name, 'agencyName', o.name)
      into v_data
    from public.agency_facility_relationships r
    join public.agency_facilities f on f.id = r.agency_facility_id
    join public.organisations o on o.id = r.agency_organisation_id
    where r.id = n.subject_id and r.agency_organisation_id = n.organisation_id;
    v_path := '/app/organisations/' || n.organisation_id || '/operations';
  elsif n.subject_type = 'timesheet' then
    -- Timesheet notices: agency, period and (agency audience only) the worker. No times, no totals.
    select jsonb_build_object('agencyName', o.name, 'periodStart', t.period_start, 'periodEnd', t.period_end,
                              'workerName', case when v_audience = 'agency' then p.display_name end)
      into v_data
    from public.timesheets t
    join public.organisations o on o.id = t.agency_organisation_id
    join public.profiles p on p.id = t.profile_id
    where t.id = n.subject_id and t.agency_organisation_id = n.organisation_id;
    if v_data is null then
      return null;
    end if;
    if v_audience = 'facility' and not exists (
      select 1 from public.timesheet_entries e
      where e.timesheet_id = n.subject_id and e.facility_organisation_id = n.audience_organisation_id) then
      return null;
    end if;
    v_path := case
      when n.event::text like 'pricing\_%' then '/app/organisations/' || n.organisation_id || '/pricing'
      when v_audience = 'facility' then '/app/organisations/' || n.audience_organisation_id || '/timesheets'
      else '/app/organisations/' || n.organisation_id || '/timesheets/' || n.subject_id end;
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
    if v_audience = 'facility' and v_facility_org is distinct from n.audience_organisation_id then
      return null;
    end if;

    v_path := case v_audience
      when 'worker' then '/app/organisations/' || n.organisation_id || '/my-shifts'
      when 'facility' then '/app/organisations/' || n.audience_organisation_id || '/staffing-requests/' || v_shift_id
      else '/app/organisations/' || n.organisation_id || '/shifts/' || v_shift_id end;

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
