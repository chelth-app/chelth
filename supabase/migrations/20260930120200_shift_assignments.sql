-- =============================================================================
-- Migration: shift_assignments
-- Stage:     P0-E5-S1
--
-- Purpose
--   shift_assignments                 a worker's assignment to a shift
--   assignment_eligibility_decisions  APPEND-ONLY record of every assignment
--                                     decision (allowed or refused) and why
--   internal.notification_outbox      domain-event hooks for later delivery
--
--   Lifecycle: assigned ──► accepted ──► cancelled
--                       ├─► declined        (worker)
--                       └─► cancelled       (agency, or shift cancellation)
--   Active (consumes headcount, blocks the person's time) = assigned | accepted.
--
--   Structural guarantees (hold for every writer, including the table owner):
--     * the worker belongs to the shift's agency and IS the stated person:
--       (agency_worker_id, agency_organisation_id, profile_id) → agency_workers
--     * the assignment's period is the shift's period:
--       (shift_id, agency_organisation_id, start_at, end_at) → shifts
--     * the assigning actor is a membership of the same agency
--     * one active assignment per (shift, worker) — unique partial index
--     * NO PERSON can hold two overlapping active assignments, across ALL
--       agencies — exclusion constraint on (profile_id, [start_at, end_at))
--       (half-open: 08:00–12:00 and 12:00–16:00 do not overlap)
--     * active assignments never exceed requested headcount — the capacity
--       trigger locks the shift row (SELECT … FOR UPDATE) before counting,
--       so concurrent writers serialise on the shift
--
-- Verified by: supabase/tests/security/120_assignments.test.sql
-- =============================================================================

create table public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null,
  agency_organisation_id uuid not null,
  agency_worker_id uuid not null,
  profile_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  period tstzrange generated always as (tstzrange(start_at, end_at, '[)')) stored,
  status public.assignment_status not null default 'assigned',
  assigned_by_membership_id uuid not null,
  assigned_at timestamptz not null default now(),
  accepted_at timestamptz,
  declined_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason public.assignment_cancellation_reason,
  cancelled_by_profile_id uuid references public.profiles (id) on delete set null,
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (shift_id, agency_organisation_id, start_at, end_at)
    references public.shifts (id, agency_organisation_id, start_at, end_at) on delete restrict,
  foreign key (agency_worker_id, agency_organisation_id, profile_id)
    references public.agency_workers (id, agency_organisation_id, profile_id) on delete restrict,
  foreign key (assigned_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  unique (id, agency_organisation_id),
  check (status <> 'accepted' or accepted_at is not null),
  check ((status = 'declined') = (declined_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null and cancellation_reason is not null)),
  constraint shift_assignments_no_overlap_per_person
    exclude using gist (profile_id with =, period with &&)
    where (status in ('assigned', 'accepted'))
);

comment on table public.shift_assignments is
  'Worker assignment to a shift. Active (assigned/accepted) rows consume headcount and block the person''s time across all agencies.';

create unique index shift_assignments_one_active_per_worker
  on public.shift_assignments (shift_id, agency_worker_id) where status in ('assigned', 'accepted');
create index shift_assignments_shift_idx on public.shift_assignments (shift_id, status);
create index shift_assignments_worker_idx on public.shift_assignments (agency_worker_id, start_at);
create index shift_assignments_agency_start_idx on public.shift_assignments (agency_organisation_id, start_at);

create trigger shift_assignments_set_updated_at
  before update on public.shift_assignments
  for each row execute function internal.set_updated_at();
create trigger shift_assignments_ownership_immutable
  before update on public.shift_assignments
  for each row execute function internal.enforce_immutable_columns(
    'shift_id', 'agency_organisation_id', 'agency_worker_id', 'profile_id', 'start_at', 'end_at',
    'assigned_by_membership_id', 'assigned_at', 'created_at');

create function internal.enforce_assignment_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if (old.status, new.status) not in (
      ('assigned'::public.assignment_status, 'accepted'::public.assignment_status),
      ('assigned', 'declined'),
      ('assigned', 'cancelled'),
      ('accepted', 'cancelled')
    ) then
      raise exception 'assignment status change not allowed' using errcode = 'CHA09';
    end if;
    new.status_changed_at := now();
  elsif old.status in ('declined', 'cancelled') then
    raise exception 'assignment is closed' using errcode = 'CHA09';
  end if;
  return new;
end;
$$;

create trigger shift_assignments_transition
  before update on public.shift_assignments
  for each row execute function internal.enforce_assignment_transition();

-- Capacity backstop: serialise on the shift row, then count. New rows are
-- always active (assigned), so only INSERT can consume headcount.
create function internal.enforce_assignment_capacity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_shift public.shifts;
  v_active integer;
begin
  select * into v_shift from public.shifts s where s.id = new.shift_id for update;
  if v_shift.status <> 'open' then
    raise exception 'shift is not open' using errcode = 'CHS09';
  end if;
  if new.status <> 'assigned' then
    raise exception 'new assignments start as assigned' using errcode = 'CHA09';
  end if;
  select count(*) into v_active from public.shift_assignments a
  where a.shift_id = new.shift_id and a.status in ('assigned', 'accepted');
  if v_active >= v_shift.requested_headcount then
    raise exception 'shift is full' using errcode = 'CHS16';
  end if;
  return new;
end;
$$;

create trigger shift_assignments_capacity
  before insert on public.shift_assignments
  for each row execute function internal.enforce_assignment_capacity();

-- -----------------------------------------------------------------------------
-- Self-access helper: the caller is this worker record's person, with a live
-- membership in the agency.
-- -----------------------------------------------------------------------------
create function authz.is_own_active_worker(p_agency_worker_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.agency_workers w
    join public.organisation_memberships m on m.id = w.membership_id
    where w.id = p_agency_worker_id
      and w.profile_id = auth.uid()
      and m.profile_id = auth.uid()
      and m.status = 'active'
  )
$$;

revoke all on function authz.is_own_active_worker(uuid) from public, anon;
grant execute on function authz.is_own_active_worker(uuid) to authenticated;

alter table public.shift_assignments enable row level security;
grant select on public.shift_assignments to authenticated;
create policy shift_assignments_select on public.shift_assignments
  for select to authenticated
  using (
    authz.has_capability(agency_organisation_id, 'assignment.view')
    or authz.is_own_active_worker(agency_worker_id)
  );

-- -----------------------------------------------------------------------------
-- Assignment decisions (append-only). Proves why an assignment was allowed or
-- refused at a point in time. NOT a compliance flag: it never replaces live
-- re-evaluation. Holds codes only — no credential numbers, documents or
-- details of any other agency's schedule.
-- -----------------------------------------------------------------------------
create table public.assignment_eligibility_decisions (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  shift_id uuid not null,
  agency_worker_id uuid not null,
  assignment_id uuid,
  actor_membership_id uuid not null,
  outcome public.assignment_decision_outcome not null,
  block_reasons public.assignment_block_reason[] not null default '{}',
  readiness public.readiness_status not null,
  compliance_reasons public.compliance_reason[] not null default '{}',
  compliance_findings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(compliance_findings) = 'array' and pg_column_size(compliance_findings) <= 8192),
  evaluation_dates date[] not null check (cardinality(evaluation_dates) between 1 and 3),
  engine_version text not null check (engine_version ~ '^[a-z0-9._-]{1,40}$'),
  sequence bigint generated always as identity,
  decided_at timestamptz not null default now(),
  foreign key (shift_id, agency_organisation_id)
    references public.shifts (id, agency_organisation_id) on delete restrict,
  foreign key (agency_worker_id, agency_organisation_id)
    references public.agency_workers (id, agency_organisation_id) on delete restrict,
  foreign key (assignment_id, agency_organisation_id)
    references public.shift_assignments (id, agency_organisation_id) on delete restrict,
  foreign key (actor_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  check ((outcome = 'allowed') = (cardinality(block_reasons) = 0)),
  check ((outcome = 'allowed') = (assignment_id is not null)),
  check (outcome = 'refused' or readiness = 'ready')
);

comment on table public.assignment_eligibility_decisions is
  'Append-only assignment decisions: outcome, block codes, readiness and compliance reason codes at decision time.';

create index assignment_eligibility_decisions_shift_idx
  on public.assignment_eligibility_decisions (shift_id, sequence desc);
create index assignment_eligibility_decisions_worker_idx
  on public.assignment_eligibility_decisions (agency_worker_id, sequence desc);

create trigger assignment_eligibility_decisions_append_only
  before update or delete on public.assignment_eligibility_decisions
  for each row execute function internal.refuse_update_delete();

alter table public.assignment_eligibility_decisions enable row level security;
grant select on public.assignment_eligibility_decisions to authenticated;
-- Findings are compliance data: both capabilities are required.
create policy assignment_eligibility_decisions_select on public.assignment_eligibility_decisions
  for select to authenticated
  using (
    authz.has_capability(agency_organisation_id, 'assignment.view')
    and authz.has_capability(agency_organisation_id, 'compliance.view')
  );

-- -----------------------------------------------------------------------------
-- Notification hooks: a transactional outbox. Rows are written in the same
-- transaction as the domain change; a later delivery stage (email/push)
-- consumes them. No API role can read or write it.
-- -----------------------------------------------------------------------------
create type internal.notification_event as enum (
  'worker_assigned', 'assignment_cancelled', 'assignment_declined', 'facility_request_submitted',
  'facility_request_opened', 'shift_cancelled', 'assignment_non_compliant'
);

create table internal.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event internal.notification_event not null,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  recipient_profile_id uuid references public.profiles (id) on delete cascade,
  recipient_organisation_id uuid references public.organisations (id) on delete restrict,
  subject_type text not null check (subject_type ~ '^[a-z][a-z_]*$'),
  subject_id uuid not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  check (recipient_profile_id is not null or recipient_organisation_id is not null)
);

create index notification_outbox_pending_idx on internal.notification_outbox (created_at) where processed_at is null;
-- One pending "no longer compliant" alert per assignment.
create unique index notification_outbox_one_pending_non_compliant
  on internal.notification_outbox (subject_id)
  where processed_at is null and event = 'assignment_non_compliant';

alter table internal.notification_outbox enable row level security;

create function internal.enqueue_notification(
  p_event internal.notification_event,
  p_organisation_id uuid,
  p_recipient_profile_id uuid,
  p_recipient_organisation_id uuid,
  p_subject_type text,
  p_subject_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into internal.notification_outbox
    (event, organisation_id, recipient_profile_id, recipient_organisation_id, subject_type, subject_id)
  values (p_event, p_organisation_id, p_recipient_profile_id, p_recipient_organisation_id, p_subject_type, p_subject_id)
  on conflict do nothing
$$;

revoke all on function
  internal.enforce_assignment_transition(),
  internal.enforce_assignment_capacity(),
  internal.enqueue_notification(internal.notification_event, uuid, uuid, uuid, text, uuid)
from public, anon, authenticated;
