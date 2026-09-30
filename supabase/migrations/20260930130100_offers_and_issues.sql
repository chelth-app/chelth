-- =============================================================================
-- Migration: offers_and_issues
-- Stage:     P0-E5-S2
--
-- Purpose
--   shift_offers       an agency asks specific eligible workers to take a shift.
--                      An offer is NOT an assignment and reserves NO headcount:
--                      acceptance runs the full live assignment gate and
--                      creates the assignment only if it still passes.
--   assignment_issues  operational attention on an active assignment that is no
--                      longer eligible or whose relationship is not active.
--                      Separate from assignment.status (never overloaded).
--
--   Offer lifecycle: offered ──► accepted | declined | expired | cancelled
--   (terminal states immutable). One live offer per (shift, worker).
--   Issue lifecycle: open ──► resolved (terminal). One open issue per
--   (assignment, type).
--
--   Visibility: agency (assignment.view) sees offers; a worker sees only their
--   own offers; facilities see NO offer activity. Issues: agency only, and only
--   with compliance.view (they carry compliance reason codes).
--
-- Verified by: supabase/tests/security/150_offers.test.sql, 160_issues_and_relationships.test.sql
-- =============================================================================

create table public.shift_offers (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null,
  agency_organisation_id uuid not null,
  agency_worker_id uuid not null,
  profile_id uuid not null,
  status public.shift_offer_status not null default 'offered',
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  closed_at timestamptz,
  close_reason public.shift_offer_close_reason,
  assignment_id uuid,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (shift_id, agency_organisation_id)
    references public.shifts (id, agency_organisation_id) on delete restrict,
  foreign key (agency_worker_id, agency_organisation_id, profile_id)
    references public.agency_workers (id, agency_organisation_id, profile_id) on delete restrict,
  foreign key (created_by_membership_id, agency_organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict,
  foreign key (assignment_id, agency_organisation_id)
    references public.shift_assignments (id, agency_organisation_id) on delete restrict,
  unique (id, agency_organisation_id),
  check (expires_at > offered_at),
  check ((status = 'accepted') = (assignment_id is not null)),
  check ((status in ('accepted', 'declined')) = (responded_at is not null)),
  check ((status in ('expired', 'cancelled')) = (closed_at is not null)),
  check ((status = 'cancelled') = (close_reason is not null))
);

comment on table public.shift_offers is
  'Offer of a shift to one worker. Reserves no headcount; acceptance runs the full assignment gate.';

create unique index shift_offers_one_live_per_worker
  on public.shift_offers (shift_id, agency_worker_id) where status = 'offered';
create index shift_offers_shift_idx on public.shift_offers (shift_id, status);
create index shift_offers_worker_idx on public.shift_offers (agency_worker_id, status, expires_at);
create index shift_offers_expiry_idx on public.shift_offers (expires_at) where status = 'offered';

create trigger shift_offers_set_updated_at
  before update on public.shift_offers
  for each row execute function internal.set_updated_at();
create trigger shift_offers_ownership_immutable
  before update on public.shift_offers
  for each row execute function internal.enforce_immutable_columns(
    'shift_id', 'agency_organisation_id', 'agency_worker_id', 'profile_id', 'offered_at', 'expires_at',
    'created_by_membership_id', 'created_at');

create function internal.enforce_offer_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'offered' then
    raise exception 'offer is closed' using errcode = 'CHO09';
  end if;
  return new;
end;
$$;

create trigger shift_offers_transition
  before update on public.shift_offers
  for each row execute function internal.enforce_offer_transition();

alter table public.shift_offers enable row level security;
grant select on public.shift_offers to authenticated;
create policy shift_offers_select on public.shift_offers
  for select to authenticated
  using (
    authz.has_capability(agency_organisation_id, 'assignment.view')
    or authz.is_own_active_worker(agency_worker_id)
  );

-- -----------------------------------------------------------------------------
create table public.assignment_issues (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  assignment_id uuid not null,
  shift_id uuid not null,
  issue_type public.assignment_issue_type not null,
  status public.assignment_issue_status not null default 'open',
  severity public.assignment_issue_severity not null,
  block_reasons public.assignment_block_reason[] not null default '{}',
  compliance_reasons public.compliance_reason[] not null default '{}',
  detected_by public.assignment_issue_source not null,
  opened_at timestamptz not null default now(),
  last_evaluated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution public.assignment_issue_resolution,
  foreign key (assignment_id, agency_organisation_id)
    references public.shift_assignments (id, agency_organisation_id) on delete restrict,
  foreign key (shift_id, agency_organisation_id)
    references public.shifts (id, agency_organisation_id) on delete restrict,
  check ((status = 'resolved') = (resolved_at is not null and resolution is not null))
);

comment on table public.assignment_issues is
  'Operational attention on an active assignment. Reason codes only; never compliance evidence.';

create unique index assignment_issues_one_open
  on public.assignment_issues (assignment_id, issue_type) where status = 'open';
create index assignment_issues_agency_open_idx
  on public.assignment_issues (agency_organisation_id, opened_at desc) where status = 'open';

-- The assignment must belong to the stated shift.
create function internal.check_issue_context()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.shift_assignments a
    where a.id = new.assignment_id and a.shift_id = new.shift_id
  ) then
    raise exception 'issue assignment and shift do not match' using errcode = 'CH400';
  end if;
  return new;
end;
$$;

create trigger assignment_issues_context
  before insert on public.assignment_issues
  for each row execute function internal.check_issue_context();
create trigger assignment_issues_ownership_immutable
  before update on public.assignment_issues
  for each row execute function internal.enforce_immutable_columns(
    'agency_organisation_id', 'assignment_id', 'shift_id', 'issue_type', 'detected_by', 'opened_at');

create function internal.enforce_issue_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'resolved' then
    raise exception 'resolved issues are immutable' using errcode = 'CH409';
  end if;
  return new;
end;
$$;

create trigger assignment_issues_transition
  before update on public.assignment_issues
  for each row execute function internal.enforce_issue_transition();
create trigger assignment_issues_no_delete
  before delete on public.assignment_issues
  for each row execute function internal.refuse_update_delete();

alter table public.assignment_issues enable row level security;
grant select on public.assignment_issues to authenticated;
create policy assignment_issues_select on public.assignment_issues
  for select to authenticated
  using (
    authz.has_capability(agency_organisation_id, 'assignment.view')
    and authz.has_capability(agency_organisation_id, 'compliance.view')
  );

revoke all on function
  internal.enforce_offer_transition(),
  internal.check_issue_context(),
  internal.enforce_issue_transition()
from public, anon, authenticated;
