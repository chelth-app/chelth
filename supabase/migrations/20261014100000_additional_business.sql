-- =============================================================================
-- Migration: additional_business
-- Stage:     P0-E9-4A.2 (organisation gateway & billing-safe multi-business)
--
-- Product rule: ONE staffing business = ONE agency organisation (with many
-- facilities, workers, staff and, later, branches). A second agency is only
-- for a genuinely separate business, and each has its OWN commercial account.
--
-- 1. Ownership: "owns an agency" = holds the agency OWNER role (agency.admin,
--    roles.is_owner_role) on an active membership in a non-archived agency.
--    Membership alone (worker, recruiter, scheduler…) is NOT ownership.
-- 2. create_organisation (self-service): the FIRST owned agency is unchanged;
--    an owner calling it again is refused (CHB01). Enforced here, not in the UI.
-- 3. Additional business: an owner REQUESTS it (additional_business_requests);
--    a platform admin FULFILS the request, which in ONE transaction creates
--    the agency (requester as owner) AND its own customer_account with an
--    explicitly chosen status and plan. Nothing is inherited from another
--    agency. The approved request is a one-time commercial authorisation:
--    there is no path to a free active second agency.
-- 4. customer_accounts: now structurally agency-only (organisation_type FK)
--    and provider IDs are unique, so an account cannot be shared.
-- No existing organisation, membership or account is changed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Ownership
-- ---------------------------------------------------------------------------
create function internal.owned_agency_count(p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct o.id)::integer
  from public.organisations o
  join public.organisation_memberships m on m.organisation_id = o.id
    and m.profile_id = p_profile_id and m.status = 'active'
  join public.membership_roles mr on mr.membership_id = m.id and mr.revoked_at is null
  join public.roles r on r.key = mr.role_key and r.is_owner_role
  where o.type = 'agency' and o.status <> 'archived'
$$;

-- The caller's business ownership (presentation hint; the RPCs re-check).
create function public.my_business_ownership()
returns table (owned_agencies integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
begin
  return query select internal.owned_agency_count(v_profile_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Self-service creation: first owned agency only
-- ---------------------------------------------------------------------------
create or replace function public.create_organisation(
  p_type public.organisation_type,
  p_name text,
  p_slug text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_organisation_id uuid;
  v_membership_id uuid;
  v_owner_role text;
begin
  if not exists (
    select 1 from auth.users u
    where u.id = v_profile_id and u.email_confirmed_at is not null
  ) then
    raise exception 'email verification required' using errcode = 'CH403';
  end if;

  if p_type is distinct from 'agency'::public.organisation_type then
    raise exception 'this organisation type is created by platform administrators'
      using errcode = 'CH403';
  end if;

  -- P0-E9-4A.2: one self-service business. An owner's additional business goes
  -- through the commercial path (request → platform fulfilment with its own account).
  if internal.owned_agency_count(v_profile_id) > 0 then
    raise exception 'an additional business requires separate commercial setup' using errcode = 'CHB01';
  end if;

  if not internal.consume_rate_limit('organisation.create:' || v_profile_id, 5, interval '1 day') then
    raise exception 'too many organisations created' using errcode = 'CH429';
  end if;

  select r.key into strict v_owner_role
  from public.roles r
  where r.organisation_type = p_type and r.is_owner_role;

  insert into public.organisations (type, name, slug, created_by_profile_id)
  values (p_type, btrim(p_name), p_slug, v_profile_id)
  returning id into v_organisation_id;

  insert into public.organisation_memberships (organisation_id, profile_id)
  values (v_organisation_id, v_profile_id)
  returning id into v_membership_id;

  insert into public.membership_roles
    (organisation_id, organisation_type, membership_id, role_key, granted_by_profile_id)
  values
    (v_organisation_id, p_type, v_membership_id, v_owner_role, v_profile_id);

  perform internal.record_audit_event('organisation.created', v_organisation_id,
    'organisation', v_organisation_id, jsonb_build_object('type', p_type));
  perform internal.record_audit_event('membership.created', v_organisation_id,
    'membership', v_membership_id, jsonb_build_object('via', 'organisation_creation'));
  perform internal.record_audit_event('role.assigned', v_organisation_id,
    'membership', v_membership_id, jsonb_build_object('role_key', v_owner_role));

  return v_organisation_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- customer_accounts: structurally one account per AGENCY; no shared provider IDs
-- ---------------------------------------------------------------------------
alter table public.customer_accounts
  add column organisation_type public.organisation_type not null default 'agency'
    check (organisation_type = 'agency');
alter table public.customer_accounts
  add constraint customer_accounts_agency_fkey
    foreign key (organisation_id, organisation_type) references public.organisations (id, type) on delete restrict;
create unique index customer_accounts_provider_customer_unique
  on public.customer_accounts (provider, provider_customer_id) where provider_customer_id is not null;
create unique index customer_accounts_provider_subscription_unique
  on public.customer_accounts (provider, provider_subscription_id) where provider_subscription_id is not null;

-- ---------------------------------------------------------------------------
-- Additional business requests
-- ---------------------------------------------------------------------------
create table public.additional_business_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  business_name text not null check (char_length(btrim(business_name)) between 2 and 200
                                     and business_name !~ '[[:cntrl:]]'),
  billing_email text not null check (billing_email = lower(btrim(billing_email)) and char_length(billing_email) <= 254
                                     and billing_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  note text check (note is null or (char_length(btrim(note)) between 1 and 1000)),
  status text not null default 'pending' check (status in ('pending', 'fulfilled', 'declined', 'withdrawn')),
  decided_by_profile_id uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or char_length(btrim(decision_reason)) between 3 and 500),
  organisation_id uuid unique references public.organisations (id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null)),
  check ((status = 'fulfilled') = (organisation_id is not null))
);
comment on table public.additional_business_requests is
  'P0-E9-4A.2: an agency owner asks for a separate business; fulfilled by the platform with its own commercial account. RPC access only.';
create index additional_business_requests_requester_idx
  on public.additional_business_requests (requested_by_profile_id, created_at desc);
alter table public.additional_business_requests enable row level security;
revoke all on public.additional_business_requests from public, anon, authenticated;

create function public.request_additional_business(
  p_business_name text,
  p_billing_email text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_id uuid;
  v_name text := btrim(p_business_name);
  v_email text := lower(btrim(p_billing_email));
begin
  if internal.owned_agency_count(v_profile_id) = 0 then
    raise exception 'create your first staffing agency instead' using errcode = 'CHB02';
  end if;
  if v_name is null or char_length(v_name) not between 2 and 200 or v_name ~ '[[:cntrl:]]' then
    raise exception 'enter the business name' using errcode = 'CH400';
  end if;
  if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'enter a valid billing email' using errcode = 'CH400';
  end if;
  if (select count(*) from public.additional_business_requests r
      where r.requested_by_profile_id = v_profile_id and r.status = 'pending') >= 3 then
    raise exception 'you already have requests waiting' using errcode = 'CH409';
  end if;
  if not internal.consume_rate_limit('business.request:' || v_profile_id, 5, interval '1 day') then
    raise exception 'too many requests' using errcode = 'CH429';
  end if;
  insert into public.additional_business_requests as r (requested_by_profile_id, business_name, billing_email, note)
  values (v_profile_id, v_name, v_email, nullif(btrim(p_note), ''))
  returning r.id into v_id;
  perform internal.record_audit_event('additional_business.requested', null, 'additional_business_request', v_id, '{}'::jsonb);
  return v_id;
end;
$$;

create function public.list_my_additional_business_requests()
returns table (request_id uuid, business_name text, status text, created_at timestamptz, decided_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
begin
  return query
    select r.id, r.business_name, r.status, r.created_at, r.decided_at
    from public.additional_business_requests r
    where r.requested_by_profile_id = v_profile_id
    order by r.created_at desc
    limit 20;
end;
$$;

create function public.withdraw_additional_business_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
begin
  update public.additional_business_requests r
     set status = 'withdrawn', decided_at = now(), decided_by_profile_id = v_profile_id
   where r.id = p_request_id and r.requested_by_profile_id = v_profile_id and r.status = 'pending';
  if not found then
    raise exception 'request not found' using errcode = 'CH404';
  end if;
  perform internal.record_audit_event('additional_business.withdrawn', null, 'additional_business_request', p_request_id, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Platform: review and fulfil (the one commercial authorisation)
-- ---------------------------------------------------------------------------
create function public.platform_list_business_requests()
returns table (
  request_id uuid,
  business_name text,
  billing_email text,
  note text,
  status text,
  created_at timestamptz,
  decided_at timestamptz,
  decision_reason text,
  requester_name text,
  requester_email text,
  requester_owned_agencies text,
  organisation_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.platform_read('platform.business_requests_listed');
  return query
    select r.id, r.business_name, r.billing_email, r.note, r.status, r.created_at, r.decided_at,
           r.decision_reason, p.display_name, u.email::text,
           (select string_agg(o.name, ', ' order by o.name)
            from public.organisations o
            join public.organisation_memberships m on m.organisation_id = o.id
              and m.profile_id = r.requested_by_profile_id and m.status = 'active'
            join public.membership_roles mr on mr.membership_id = m.id and mr.revoked_at is null
            join public.roles ro on ro.key = mr.role_key and ro.is_owner_role
            where o.type = 'agency' and o.status <> 'archived'),
           r.organisation_id
    from public.additional_business_requests r
    join public.profiles p on p.id = r.requested_by_profile_id
    left join auth.users u on u.id = r.requested_by_profile_id
    order by (r.status = 'pending') desc, r.created_at desc
    limit 200;
end;
$$;

create function public.platform_fulfil_business_request(
  p_request_id uuid,
  p_status public.customer_account_status,
  p_reason text,
  p_plan_key text default null,
  p_trial_ends_on date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := internal.require_platform_admin();
  v_reason text := internal.require_platform_reason(p_reason);
  v_request public.additional_business_requests;
  v_org uuid;
  v_membership_id uuid;
  v_slug text;
begin
  if p_status is null or p_status not in ('trial', 'active') then
    raise exception 'choose trial or active for the new business' using errcode = 'CH400';
  end if;
  if p_plan_key is not null and not exists (
       select 1 from public.subscription_plans p where p.key = p_plan_key and p.status = 'active') then
    raise exception 'choose an active plan' using errcode = 'CH400';
  end if;
  select * into v_request from public.additional_business_requests r where r.id = p_request_id for update;
  if v_request.id is null then
    raise exception 'request not found' using errcode = 'CH404';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'this request has already been decided' using errcode = 'CH409';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_request.requested_by_profile_id and p.status = 'active') then
    raise exception 'the requester''s account is not active' using errcode = 'CH409';
  end if;

  v_slug := left(trim(both '-' from regexp_replace(lower(v_request.business_name), '[^a-z0-9]+', '-', 'g')), 50);
  if char_length(v_slug) < 2 then v_slug := 'agency'; end if;
  v_slug := v_slug || '-' || substr(md5(gen_random_uuid()::text), 1, 6);

  -- The business, its owner (the requester, who asked for it) and its OWN account: one transaction.
  insert into public.organisations (type, name, slug, created_by_profile_id)
  values ('agency', v_request.business_name, v_slug, v_request.requested_by_profile_id)
  returning id into v_org;
  insert into public.organisation_memberships (organisation_id, profile_id)
  values (v_org, v_request.requested_by_profile_id)
  returning id into v_membership_id;
  insert into public.membership_roles (organisation_id, organisation_type, membership_id, role_key, granted_by_profile_id)
  select v_org, 'agency', v_membership_id, r.key, v_actor
  from public.roles r where r.organisation_type = 'agency' and r.is_owner_role;

  insert into public.customer_accounts
    (organisation_id, status, plan_key, billing_name, billing_email, trial_started_at, trial_ends_on,
     subscription_started_at, updated_by_profile_id)
  values (v_org, p_status, p_plan_key, v_request.business_name, v_request.billing_email,
          case when p_status = 'trial' then now() end, p_trial_ends_on,
          case when p_status = 'active' then now() end, v_actor);

  update public.additional_business_requests r
     set status = 'fulfilled', decided_at = now(), decided_by_profile_id = v_actor,
         decision_reason = v_reason, organisation_id = v_org
   where r.id = p_request_id;

  perform internal.record_audit_event('organisation.created', v_org, 'organisation', v_org,
    jsonb_build_object('type', 'agency', 'via', 'platform', 'cause', 'additional_business'));
  perform internal.record_audit_event('membership.created', v_org, 'membership', v_membership_id,
    jsonb_build_object('via', 'additional_business'));
  perform internal.record_audit_event('additional_business.created', v_org, 'additional_business_request', p_request_id,
    jsonb_build_object('status', p_status, 'plan_key', p_plan_key, 'reason', v_reason));
  perform internal.record_audit_event('platform.customer_account_created', v_org, 'organisation', v_org,
    jsonb_build_object('status', p_status, 'plan_key', p_plan_key, 'reason', v_reason, 'cause', 'additional_business'));
  return v_org;
end;
$$;

create function public.platform_decline_business_request(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := internal.require_platform_admin();
  v_reason text := internal.require_platform_reason(p_reason);
begin
  update public.additional_business_requests r
     set status = 'declined', decided_at = now(), decided_by_profile_id = v_actor, decision_reason = v_reason
   where r.id = p_request_id and r.status = 'pending';
  if not found then
    raise exception 'request not found or already decided' using errcode = 'CH409';
  end if;
  perform internal.record_audit_event('additional_business.declined', null, 'additional_business_request', p_request_id,
    jsonb_build_object('reason', v_reason));
end;
$$;

-- Platform activity: allow-list the additional-business events (body otherwise unchanged).
create or replace function public.platform_list_activity(p_limit integer default 100, p_before timestamptz default null)
returns table (
  event_id uuid,
  occurred_at timestamptz,
  action text,
  actor_name text,
  organisation_id uuid,
  organisation_name text,
  details jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.platform_read('platform.activity_viewed');
  return query
    select e.id, e.occurred_at, e.action, p.display_name, o.id, o.name,
           (select coalesce(jsonb_object_agg(k.key, k.value), '{}'::jsonb)
            from jsonb_each(e.metadata) k
            where k.key in ('from', 'to', 'type', 'via', 'cause', 'reason', 'changes', 'status',
                            'plan_key', 'created', 'role_key', 'operator'))
    from public.audit_events e
    left join public.profiles p on p.id = e.actor_profile_id
    left join public.organisations o on o.id = e.organisation_id
    where (e.action in ('platform.admin_granted', 'platform.admin_revoked', 'platform.customer_account_created',
                        'platform.plan_changed', 'platform.trial_changed', 'platform.subscription_changed',
                        'platform.billing_contact_changed', 'platform.plan_saved', 'organisation.created',
                        'facility.connection_invited', 'facility.connection_resent', 'facility.connection_revoked',
                        'facility.connection_accepted', 'facility.organisation_created_from_invite',
                        'additional_business.requested', 'additional_business.created',
                        'additional_business.declined', 'additional_business.withdrawn')
           or (e.action in ('organisation.status_changed', 'facility.linked', 'invite.created',
                            'invite.resent', 'invite.revoked', 'profile.status_changed')
               and (e.metadata ->> 'via' in ('platform', 'invite') or exists (
                      select 1 from public.platform_admins pa where pa.profile_id = e.actor_profile_id))))
      and (p_before is null or e.occurred_at < p_before)
      and not (e.action in ('facility.linked', 'facility.connection_accepted') and o.type = 'facility')
    order by e.occurred_at desc, e.id
    limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function internal.owned_agency_count(uuid) from public, anon, authenticated;

revoke all on function
  public.my_business_ownership(),
  public.request_additional_business(text, text, text),
  public.list_my_additional_business_requests(),
  public.withdraw_additional_business_request(uuid),
  public.platform_list_business_requests(),
  public.platform_fulfil_business_request(uuid, public.customer_account_status, text, text, date),
  public.platform_decline_business_request(uuid, text)
from public, anon;

grant execute on function
  public.my_business_ownership(),
  public.request_additional_business(text, text, text),
  public.list_my_additional_business_requests(),
  public.withdraw_additional_business_request(uuid),
  public.platform_list_business_requests(),
  public.platform_fulfil_business_request(uuid, public.customer_account_status, text, text, date),
  public.platform_decline_business_request(uuid, text)
to authenticated;
