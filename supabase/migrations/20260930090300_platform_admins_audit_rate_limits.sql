-- =============================================================================
-- Migration: platform_admins_audit_rate_limits
-- Stage:     P0-E3-S2
--
-- Purpose
--   platform_admins   Platform privilege, deliberately SEPARATE from tenant
--                     membership. A platform admin is not a member of any
--                     tenant and gains no RLS read access to tenant data;
--                     platform operations are narrow, audited RPCs requiring
--                     AAL2 (see platform RPC migration).
--                     Grants/revocations are operator procedures
--                     (internal.grant_platform_admin), never an API call.
--
--   audit_events      Generic append-only audit log. Written only by
--                     internal.record_audit_event from inside RPCs. UPDATE,
--                     DELETE and TRUNCATE are refused by triggers for every
--                     role, including the table owner.
--
--   internal.rate_limit_counters
--                     Fixed-window counters for throttling (invite
--                     validation, organisation creation, invite issuance).
--
-- Verified by: supabase/tests/security/050_platform_admin.test.sql,
--              supabase/tests/security/060_audit_events.test.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- platform_admins
-- -----------------------------------------------------------------------------
create table public.platform_admins (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete restrict,
  granted_at timestamptz not null default now(),
  granted_by text not null check (char_length(granted_by) between 1 and 200),
  grant_reason text not null check (char_length(btrim(grant_reason)) between 3 and 500),
  revoked_at timestamptz,
  revoked_by text check (revoked_by is null or char_length(revoked_by) between 1 and 200),
  revoke_reason text check (revoke_reason is null or char_length(btrim(revoke_reason)) between 3 and 500),
  check (revoked_at is null or revoked_at >= granted_at),
  check ((revoked_at is null) = (revoked_by is null))
);

comment on table public.platform_admins is
  'Platform privilege grants (history preserved). Separate from organisation membership.';
comment on column public.platform_admins.granted_by is
  'Operator identity recorded by the grant procedure (database role / named operator).';

create unique index platform_admins_one_active_grant
  on public.platform_admins (profile_id) where revoked_at is null;

alter table public.platform_admins enable row level security;
-- Users may see only their own grant (used to show platform UI hints).
grant select on public.platform_admins to authenticated;

-- -----------------------------------------------------------------------------
-- audit_events
-- -----------------------------------------------------------------------------
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  -- No FK: audit history must outlive the identities it describes.
  actor_profile_id uuid,
  actor_membership_id uuid,
  actor_aal text check (actor_aal in ('aal1', 'aal2')),
  organisation_id uuid references public.organisations (id) on delete restrict,
  action text not null check (action ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  target_type text check (target_type ~ '^[a-z][a-z_]*$'),
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096),
  request_id uuid,
  -- The acting membership must belong to the organisation the event is about.
  foreign key (actor_membership_id, organisation_id)
    references public.organisation_memberships (id, organisation_id) on delete restrict
);

comment on table public.audit_events is
  'Append-only audit log. Written by internal.record_audit_event only. Never updated or deleted.';
comment on column public.audit_events.metadata is
  'Identifiers and codes only. Never secrets, tokens, emails or free-text personal data.';

create index audit_events_organisation_idx on public.audit_events (organisation_id, occurred_at desc);
create index audit_events_actor_idx on public.audit_events (actor_profile_id, occurred_at desc);

create function internal.refuse_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit events are append-only' using errcode = 'CH409';
end;
$$;

create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function internal.refuse_audit_mutation();

create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function internal.refuse_audit_mutation();

alter table public.audit_events enable row level security;
grant select on public.audit_events to authenticated;
-- No insert/update/delete grants: rows are written by internal.record_audit_event.

-- -----------------------------------------------------------------------------
-- Audit writer
-- -----------------------------------------------------------------------------
create function internal.request_id()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_raw text;
begin
  -- Correlation id forwarded by the Chelth server (x-chelth-request-id).
  -- Accepted only if it is a well-formed UUID; it is never trusted for authz.
  v_raw := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-chelth-request-id';
  if v_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v_raw::uuid;
  end if;
  return null;
exception
  when others then
    return null;
end;
$$;

create function internal.record_audit_event(
  p_action text,
  p_organisation_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_membership uuid;
begin
  if p_organisation_id is not null and v_actor is not null then
    select m.id into v_membership
    from public.organisation_memberships m
    where m.organisation_id = p_organisation_id
      and m.profile_id = v_actor;
  end if;

  insert into public.audit_events (
    actor_profile_id, actor_membership_id, actor_aal, organisation_id,
    action, target_type, target_id, metadata, request_id
  ) values (
    v_actor,
    v_membership,
    case when v_actor is null then null
         else coalesce(nullif(auth.jwt() ->> 'aal', ''), 'aal1') end,
    p_organisation_id,
    p_action,
    p_target_type,
    p_target_id,
    coalesce(p_metadata, '{}'::jsonb),
    internal.request_id()
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Rate limiting (fixed window)
-- -----------------------------------------------------------------------------
create table internal.rate_limit_counters (
  bucket text not null check (char_length(bucket) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (bucket, window_start)
);

alter table internal.rate_limit_counters enable row level security;

-- Returns true when the call is within the limit. The increment is part of
-- the caller's transaction: callers that must count FAILED attempts return
-- normally (they do not raise) so the increment commits.
create function internal.consume_rate_limit(p_bucket text, p_limit integer, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_seconds double precision := extract(epoch from p_window);
  v_window_start timestamptz :=
    to_timestamp(floor(extract(epoch from now()) / v_window_seconds) * v_window_seconds);
  v_hits integer;
begin
  -- Opportunistic cleanup of this bucket's expired windows.
  delete from internal.rate_limit_counters
  where bucket = p_bucket and window_start < v_window_start;

  insert into internal.rate_limit_counters as c (bucket, window_start, hits)
  values (p_bucket, v_window_start, 1)
  on conflict (bucket, window_start) do update set hits = c.hits + 1
  returning c.hits into v_hits;

  return v_hits <= p_limit;
end;
$$;
