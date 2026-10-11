-- =============================================================================
-- Migration: shift_email_notifications
-- Stage:     P0-E9-3G
--
-- Purpose (all through the EXISTING outbox → dispatcher → template → Resend;
-- docs/architecture/NOTIFICATION_DELIVERY.md):
--   1. Permanent idempotency: internal.notification_outbox.dedupe_key (unique).
--      - Worker lifecycle events get a deterministic key automatically
--        (<event>:<subject>:<recipient>), so a retried or repeated enqueue
--        never creates a second email — in any state, not only while pending.
--      - Change and reminder events carry an explicit versioned key.
--   2. shift_changed: a trigger on public.shifts. A worker-relevant change
--      (date / start / end, location, role (discipline), unit) of an OPEN
--      shift increments shifts.worker_change_version and queues ONE email per
--      active assignment, keyed shift_changed:<assignment>:<version>, in the
--      same transaction as the change (a failed update queues nothing). A
--      further change while that email is still waiting is merged into it
--      (one email, net change). Note: date / time / location / role cannot
--      change today while workers hold assignments (shifts_transition and the
--      assignment → shift (start_at) foreign key); the trigger covers them if
--      that rule is ever relaxed. The unit can change.
--      Headcount, references, classification, notes and other internal fields
--      never email. Cancellation keeps its own event.
--   3. shift_reminder: internal.run_shift_reminder_scan (pg_cron, every 15 min)
--      queues one reminder for each ACCEPTED assignment on an OPEN shift that
--      starts within the next 24 hours (absolute time; the template words it
--      in the facility's local calendar), keyed
--      shift_reminder:<assignment>:<start epoch>. Assignments made inside the
--      window are skipped (they were just notified).
--   4. internal.notification_template: worker deep link to the assignment
--      (/my-shifts/<assignment>), unit, short arrival guidance and change
--      detail; change and reminder rows are NOT delivered if, at claim time,
--      the assignment or shift is no longer active (subject_unavailable).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Idempotency key
-- -----------------------------------------------------------------------------
alter table internal.notification_outbox
  add column dedupe_key text check (dedupe_key is null or dedupe_key ~ '^[a-z_]{3,40}:[0-9a-f:-]{36,120}$');

create unique index notification_outbox_dedupe_key on internal.notification_outbox (dedupe_key)
  where dedupe_key is not null;

create function internal.set_notification_dedupe_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.dedupe_key is null and new.recipient_profile_id is not null
     and new.event in ('worker_assigned', 'shift_offered', 'assignment_cancelled', 'shift_cancelled') then
    new.dedupe_key := new.event::text || ':' || new.subject_id || ':' || new.recipient_profile_id;
  end if;
  return new;
end;
$$;

create trigger notification_outbox_dedupe_key
  before insert on internal.notification_outbox
  for each row execute function internal.set_notification_dedupe_key();

-- One worker email for one explicit, versioned key.
create function internal.enqueue_worker_notification_once(
  p_event internal.notification_event,
  p_organisation_id uuid,
  p_recipient_profile_id uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_dedupe_key text,
  p_detail jsonb,
  p_deliver_until timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into internal.notification_outbox
    (event, organisation_id, recipient_profile_id, recipient_organisation_id, audience_organisation_id,
     subject_type, subject_id, detail, deliver_until, dedupe_key)
  values (p_event, p_organisation_id, p_recipient_profile_id, null, p_organisation_id,
          p_subject_type, p_subject_id, coalesce(p_detail, '{}'::jsonb), p_deliver_until, p_dedupe_key)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Shift changes
-- -----------------------------------------------------------------------------
alter table public.shifts add column worker_change_version integer not null default 0;
comment on column public.shifts.worker_change_version is
  'Increments when a worker-relevant field of an open shift changes (P0-E9-3G); keys the change email.';

-- Named to run after shifts_transition (which refuses closed shifts and most
-- open-shift scheduling changes).
create function internal.bump_worker_change_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'open' and new.status = 'open'
     and (new.start_at, new.end_at, new.facility_location_id, new.discipline_key, new.unit_label)
         is distinct from (old.start_at, old.end_at, old.facility_location_id, old.discipline_key, old.unit_label) then
    new.worker_change_version := old.worker_change_version + 1;
  else
    new.worker_change_version := old.worker_change_version;
  end if;
  return new;
end;
$$;

create trigger shifts_worker_change_version
  before update on public.shifts
  for each row execute function internal.bump_worker_change_version();

create function internal.notify_worker_shift_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '[]'::jsonb;
  v_detail jsonb := '{}'::jsonb;
  a record;
begin
  if new.worker_change_version <= old.worker_change_version then
    return null;
  end if;
  if (new.start_at at time zone new.timezone)::date is distinct from (old.start_at at time zone old.timezone)::date then
    v_changes := v_changes || '"date"'::jsonb;
  end if;
  if new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at then
    v_changes := v_changes || '"time"'::jsonb;
    v_detail := v_detail || jsonb_build_object('previousStartAt', old.start_at, 'previousEndAt', old.end_at);
  end if;
  if new.facility_location_id is distinct from old.facility_location_id then
    v_changes := v_changes || '"location"'::jsonb;
    v_detail := v_detail || jsonb_build_object('previousLocationId', old.facility_location_id);
  end if;
  if new.discipline_key is distinct from old.discipline_key then
    v_changes := v_changes || '"role"'::jsonb;
    v_detail := v_detail || jsonb_build_object('previousDisciplineKey', old.discipline_key);
  end if;
  if new.unit_label is distinct from old.unit_label then
    v_changes := v_changes || '"unit"'::jsonb;
    v_detail := v_detail || jsonb_build_object('previousUnitLabel', left(old.unit_label, 60));
  end if;
  v_detail := v_detail || jsonb_build_object('changes', v_changes);

  for a in
    select x.id, x.profile_id from public.shift_assignments x
    where x.shift_id = new.id and x.status in ('assigned', 'accepted')
  loop
    -- A change email for this assignment is still waiting: merge into it (one
    -- email with the net change: the union of changed fields, the ORIGINAL
    -- previous values) instead of queuing a second one.
    update internal.notification_outbox o
       set detail = (v_detail - 'changes') || (o.detail - 'changes') || jsonb_build_object('changes', (
             select coalesce(jsonb_agg(distinct c), '[]'::jsonb)
             from jsonb_array_elements(coalesce(o.detail -> 'changes', '[]'::jsonb) || (v_detail -> 'changes')) c)),
           deliver_until = new.end_at
     where o.event = 'shift_changed' and o.subject_id = a.id and o.recipient_profile_id = a.profile_id
       and o.state in ('pending', 'retry');
    if not found then
      perform internal.enqueue_worker_notification_once('shift_changed', new.agency_organisation_id, a.profile_id,
        'shift_assignment', a.id, 'shift_changed:' || a.id || ':' || new.worker_change_version, v_detail, new.end_at);
    end if;
  end loop;
  return null;
end;
$$;

create trigger shifts_notify_worker_change
  after update on public.shifts
  for each row execute function internal.notify_worker_shift_change();

-- -----------------------------------------------------------------------------
-- 3. 24-hour reminder
-- -----------------------------------------------------------------------------
create function internal.run_shift_reminder_scan(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run bigint;
  v_count integer := 0;
  r record;
begin
  insert into internal.scheduled_job_runs (job) values ('shift_reminder_scan') returning id into v_run;
  for r in
    select a.id, a.profile_id, s.agency_organisation_id, s.start_at
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
    where a.status = 'accepted'
      and s.status = 'open'
      and s.start_at > p_now
      and s.start_at <= p_now + interval '24 hours'
      -- Assigned inside the window: the worker was just notified; no reminder on top.
      and a.created_at <= s.start_at - interval '24 hours'
    order by s.start_at, a.id
    limit 2000
  loop
    v_count := v_count + internal.enqueue_worker_notification_once('shift_reminder', r.agency_organisation_id,
      r.profile_id, 'shift_assignment', r.id,
      'shift_reminder:' || r.id || ':' || extract(epoch from r.start_at)::bigint, '{}'::jsonb, r.start_at);
  end loop;
  update internal.scheduled_job_runs set finished_at = now(), result = jsonb_build_object('queued', v_count)
   where id = v_run;
  return v_count;
end;
$$;

-- cron.schedule upserts by job name, so re-applying is safe.
select cron.schedule('chelth-shift-reminder-scan', '*/15 * * * *', 'select internal.run_shift_reminder_scan()');

-- -----------------------------------------------------------------------------
-- 4. Template data (latest P0-E9-3D-S3 resolver, extended)
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
  v_assignment public.shift_assignments;
  v_offer public.shift_offers;
  v_data jsonb;
  v_facility_org uuid;
  v_audience text;
  v_path text;
  v_shift_status public.shift_status;
  v_start_at timestamptz;
begin
  select * into n from internal.notification_outbox x where x.id = p_notification_id;
  if n.id is null then
    return null;
  end if;

  if n.subject_type = 'shift_assignment' then
    select * into v_assignment from public.shift_assignments a where a.id = n.subject_id;
    v_shift_id := v_assignment.shift_id;
    v_worker_id := v_assignment.agency_worker_id;
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
    -- P0-E9-3G: a worker's assignment email is only for that worker's own assignment.
    if v_audience = 'worker' and n.subject_type = 'shift_assignment'
       and v_assignment.profile_id is distinct from n.recipient_profile_id then
      return null;
    end if;

    select jsonb_build_object(
             'agencyName', o.name,
             'facilityName', f.name,
             'locationName', l.name,
             'disciplineName', d.name,
             'startAt', s.start_at,
             'endAt', s.end_at,
             'timezone', s.timezone,
             'shiftStatus', s.status,
             'cancellationReason', s.cancellation_reason,
             'unitLabel', s.unit_label,
             'arrivalInstructions', case
               when v_audience = 'worker' and n.event in ('worker_assigned', 'shift_reminder')
               then left(f.arrival_instructions, 280) end),
           f.linked_facility_organisation_id, s.status, s.start_at
      into v_data, v_facility_org, v_shift_status, v_start_at
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

    -- P0-E9-3G: never deliver a change or a reminder for work that is no
    -- longer active (cancelled, declined, completed, or already started).
    if n.event = 'shift_changed'
       and (v_assignment.status not in ('assigned', 'accepted') or v_shift_status <> 'open') then
      return null;
    end if;
    if n.event = 'shift_reminder'
       and (v_assignment.status <> 'accepted' or v_shift_status <> 'open' or v_start_at <= now()) then
      return null;
    end if;

    v_path := case
      when v_audience = 'worker' and n.subject_type = 'shift_assignment'
           and n.event in ('worker_assigned', 'shift_changed', 'shift_reminder')
        then '/app/organisations/' || n.organisation_id || '/my-shifts/' || n.subject_id
      when v_audience = 'worker' then '/app/organisations/' || n.organisation_id || '/my-shifts'
      when v_audience = 'facility' then '/app/organisations/' || n.audience_organisation_id || '/staffing-requests/' || v_shift_id
      else '/app/organisations/' || n.organisation_id || '/shifts/' || v_shift_id end;

    if v_audience = 'agency' and v_worker_id is not null then
      v_data := v_data || jsonb_build_object('workerName', (
        select p.display_name from public.agency_workers w join public.profiles p on p.id = w.profile_id
        where w.id = v_worker_id and w.agency_organisation_id = n.organisation_id));
    end if;
    if n.subject_type = 'shift_offer' then
      v_data := v_data || jsonb_build_object('offerExpiresAt', v_offer.expires_at, 'offerStatus', v_offer.status);
    end if;
    -- Change detail: previous location / role resolved to display names, same agency only.
    if n.event = 'shift_changed' then
      v_data := v_data || jsonb_build_object(
        'previousLocationName', (select l.name from public.facility_locations l
                                 where l.id = (n.detail ->> 'previousLocationId')::uuid
                                   and l.agency_organisation_id = n.organisation_id),
        'previousDisciplineName', (select d.name from public.disciplines d
                                   where d.key = n.detail ->> 'previousDisciplineKey'));
    end if;
  end if;

  return coalesce(v_data, '{}'::jsonb) || (n.detail - 'previousLocationId' - 'previousDisciplineKey')
    || jsonb_build_object(
    'event', n.event,
    'audience', v_audience,
    'path', v_path,
    'recipientName', (select p.display_name from public.profiles p where p.id = n.recipient_profile_id));
end;
$$;

revoke all on function
  internal.set_notification_dedupe_key(),
  internal.enqueue_worker_notification_once(internal.notification_event, uuid, uuid, text, uuid, text, jsonb, timestamptz),
  internal.bump_worker_change_version(),
  internal.notify_worker_shift_change(),
  internal.run_shift_reminder_scan(timestamptz),
  internal.notification_template(uuid)
from public, anon, authenticated, service_role;
