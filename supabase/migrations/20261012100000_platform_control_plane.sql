-- =============================================================================
-- Migration: platform_control_plane
-- Stage:     P0-E9-4A (platform control plane & customer administration)
--
-- Purpose
--   Chelth's own SaaS administration, kept apart from tenants:
--   - public.subscription_plans: Chelth plans (reference data; no invented
--     pricing: the seeded "pilot" plan has no price).
--   - public.customer_accounts: one commercial account per AGENCY
--     (Agency → Chelth). It never shares concepts or tables with tenant
--     operational finance (rate cards, pricing, payroll, facility invoices,
--     worker pay). No card or bank data: provider IDs only, and no provider is
--     connected (provider = 'manual').
--   - Narrow, audited platform RPCs: overview, customer directory and
--     detail, agency facility records for linking, plans, commercial account
--     changes, organisation lifecycle with a reason, system health, platform
--     admins (read-only) and a platform activity allow-list.
--
-- Boundaries (unchanged; database-enforced)
--   - A platform admin is NOT a tenant member and gains no tenant capability
--     or RLS read access. The new tables have RLS enabled with NO policies and
--     no table grants: they are reachable only through these functions.
--   - Every function: authenticated identity, an active platform_admins grant
--     AND an AAL2 session (internal.require_platform_admin, which raises
--     CH402/CH403), pinned search_path, PUBLIC/anon revoked, and an audit event
--     (reads de-duplicated per operator per 15 minutes).
--   - Projections return counts, names and statuses only: never member or
--     worker contact data, credentials, messages, locations, pay, rates,
--     payroll or invoices.
--   - Granting/revoking platform admins stays an operator (database owner)
--     procedure (internal.grant_platform_admin / revoke_platform_admin).
--   - Suspension: organisations.status is the ONE access authority. A
--     commercial suspension suspends the organisation in the same audited
--     transaction; resuming the account reactivates it. The lifecycle RPC
--     refuses to reactivate an organisation whose account is suspended.
--   - Existing agencies get NO account (no assumed plan or status). They show
--     "Commercial setup required" until an operator sets them up.
-- =============================================================================

create type public.customer_account_status as enum ('trial', 'active', 'past_due', 'suspended', 'cancelled');

create table public.subscription_plans (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  status text not null default 'active' check (status in ('active', 'retired')),
  monthly_price_minor integer check (monthly_price_minor is null or monthly_price_minor >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  included_seats integer check (included_seats is null or included_seats >= 0),
  included_facilities integer check (included_facilities is null or included_facilities >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((monthly_price_minor is null) = (currency is null))
);
comment on table public.subscription_plans is
  'P0-E9-4A: Chelth SaaS plans (Agency → Chelth). Unrelated to tenant rate cards or pricing.';

-- A neutral placeholder: no price until approved.
insert into public.subscription_plans (key, name) values ('pilot', 'Pilot');

create table public.customer_accounts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null unique references public.organisations (id) on delete restrict,
  status public.customer_account_status not null,
  plan_key text references public.subscription_plans (key) on delete restrict,
  billing_name text check (billing_name is null or char_length(btrim(billing_name)) between 1 and 120),
  billing_email text check (billing_email is null or (char_length(billing_email) <= 254
    and billing_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  provider text not null default 'manual' check (provider in ('manual')),
  provider_customer_id text check (provider_customer_id is null or char_length(provider_customer_id) <= 200),
  provider_subscription_id text check (provider_subscription_id is null or char_length(provider_subscription_id) <= 200),
  trial_started_at timestamptz,
  trial_ends_on date,
  subscription_started_at timestamptz,
  current_period_ends_on date,
  cancel_at_period_end boolean not null default false,
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_profile_id uuid references public.profiles (id) on delete set null,
  check ((status = 'suspended') = (suspended_at is not null))
);
comment on table public.customer_accounts is
  'P0-E9-4A: Chelth commercial account per agency (manually managed; no payment credentials). Separate from tenant finance.';

alter table public.subscription_plans enable row level security;
alter table public.customer_accounts enable row level security;
revoke all on public.subscription_plans, public.customer_accounts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- A paid "seat": an active membership holding at least one active role that is
-- not the self-service Healthcare Worker role. Workers are never seats.
create function internal.organisation_staff_seats(p_organisation_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct m.id)::integer
  from public.organisation_memberships m
  join public.membership_roles r on r.membership_id = m.id and r.revoked_at is null
  where m.organisation_id = p_organisation_id and m.status = 'active'
    and r.role_key <> 'agency.healthcare_worker'
$$;

create function internal.platform_read(p_action text, p_organisation_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_platform_admin();
begin
  perform internal.record_audit_event_once(p_action, p_organisation_id, 'profile', v_profile_id,
    interval '15 minutes');
  return v_profile_id;
end;
$$;

create function internal.require_platform_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 or p_reason ~ '[[:cntrl:]]' then
    raise exception 'a reason of 3 to 500 characters is required' using errcode = 'CH400';
  end if;
  return btrim(p_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- Overview
-- ---------------------------------------------------------------------------
create function public.platform_get_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cron jsonb := null;
begin
  perform internal.platform_read('platform.console_viewed');
  if to_regclass('cron.job_run_details') is not null then
    execute $q$
      select jsonb_build_object(
        'failed_24h', count(*) filter (where d.status <> 'succeeded' and d.start_time > now() - interval '24 hours'),
        'last_success', max(d.end_time) filter (where d.status = 'succeeded'))
      from cron.job_run_details d
    $q$ into v_cron;
  end if;
  return jsonb_build_object(
    'agencies', (select jsonb_build_object(
        'total', count(*), 'active', count(*) filter (where o.status = 'active'),
        'suspended', count(*) filter (where o.status = 'suspended'))
      from public.organisations o where o.type = 'agency'),
    'facilities', (select jsonb_build_object(
        'total', count(*),
        'linked', count(*) filter (where exists (select 1 from public.agency_facilities f
                                                 where f.linked_facility_organisation_id = o.id)),
        'unlinked', count(*) filter (where not exists (select 1 from public.agency_facilities f
                                                       where f.linked_facility_organisation_id = o.id)))
      from public.organisations o where o.type = 'facility'),
    'accounts', (select jsonb_build_object(
        'trial', count(*) filter (where a.status = 'trial'),
        'active', count(*) filter (where a.status = 'active'),
        'past_due', count(*) filter (where a.status = 'past_due'),
        'suspended', count(*) filter (where a.status = 'suspended'),
        'cancelled', count(*) filter (where a.status = 'cancelled'),
        'setup_required', (select count(*) from public.organisations o
                           where o.type = 'agency' and o.status <> 'archived'
                             and not exists (select 1 from public.customer_accounts x where x.organisation_id = o.id)))
      from public.customer_accounts a),
    'health', jsonb_build_object(
        'notifications_waiting', (select count(*) from internal.notification_outbox n
                                  where n.state in ('pending', 'retry', 'processing')
                                    and n.created_at < now() - interval '10 minutes'),
        'notifications_failed_24h', (select count(*) from internal.notification_outbox n
                                     where n.state = 'failed' and n.processed_at > now() - interval '24 hours'),
        'scans_stuck', (select count(*) from public.credential_documents d
                        where d.status = 'scanning' and d.created_at < now() - interval '1 hour'),
        'cron', v_cron),
    'attention', jsonb_build_object(
        'facility_owner_pending', (select count(*) from public.organisations o
                                   where o.type = 'facility' and o.status = 'active'
                                     and not exists (select 1 from public.organisation_memberships m
                                                     where m.organisation_id = o.id and m.status = 'active')),
        'facility_unlinked', (select count(*) from public.organisations o
                              where o.type = 'facility' and o.status = 'active'
                                and not exists (select 1 from public.agency_facilities f
                                                where f.linked_facility_organisation_id = o.id)))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer directory and detail
-- ---------------------------------------------------------------------------
create function public.platform_list_customers()
returns table (
  organisation_id uuid,
  organisation_type public.organisation_type,
  name text,
  slug text,
  status public.organisation_status,
  created_at timestamptz,
  locale text,
  default_currency text,
  active_members integer,
  staff_seats integer,
  facility_records integer,
  linked_facilities integer,
  account_status public.customer_account_status,
  plan_key text,
  plan_name text,
  trial_ends_on date,
  current_period_ends_on date,
  owner_invite_pending boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.platform_read('platform.customers_listed');
  return query
    select o.id, o.type, o.name, o.slug, o.status, o.created_at, o.locale, o.default_currency,
           (select count(*)::integer from public.organisation_memberships m
             where m.organisation_id = o.id and m.status = 'active'),
           internal.organisation_staff_seats(o.id),
           case when o.type = 'agency'
                then (select count(*)::integer from public.agency_facilities f where f.agency_organisation_id = o.id) end,
           case when o.type = 'agency'
                then (select count(*)::integer from public.agency_facilities f
                      where f.agency_organisation_id = o.id and f.linked_facility_organisation_id is not null)
                else (select count(*)::integer from public.agency_facilities f
                      where f.linked_facility_organisation_id = o.id) end,
           a.status, a.plan_key, p.name, a.trial_ends_on, a.current_period_ends_on,
           exists (select 1 from public.organisation_invites i
                   where i.organisation_id = o.id and i.issued_by_platform
                     and i.status = 'pending' and i.expires_at > now())
    from public.organisations o
    left join public.customer_accounts a on a.organisation_id = o.id
    left join public.subscription_plans p on p.key = a.plan_key
    order by o.created_at desc
    limit 1000;
end;
$$;

create function public.platform_get_customer(p_organisation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.organisations;
  a public.customer_accounts;
begin
  perform internal.require_platform_admin();
  select * into o from public.organisations x where x.id = p_organisation_id;
  if o.id is null then
    raise exception 'organisation not found' using errcode = 'CH404';
  end if;
  perform internal.platform_read('platform.organisation_viewed', o.id);
  select * into a from public.customer_accounts x where x.organisation_id = o.id;

  return jsonb_build_object(
    'identity', jsonb_build_object('id', o.id, 'type', o.type, 'name', o.name, 'slug', o.slug,
      'status', o.status, 'locale', o.locale, 'default_currency', o.default_currency,
      'created_at', o.created_at),
    'account', case when a.id is null then null else jsonb_build_object(
      'status', a.status, 'plan_key', a.plan_key,
      'plan_name', (select p.name from public.subscription_plans p where p.key = a.plan_key),
      'billing_name', a.billing_name, 'billing_email', a.billing_email, 'provider', a.provider,
      'provider_customer_id', a.provider_customer_id, 'provider_subscription_id', a.provider_subscription_id,
      'trial_started_at', a.trial_started_at, 'trial_ends_on', a.trial_ends_on,
      'subscription_started_at', a.subscription_started_at, 'current_period_ends_on', a.current_period_ends_on,
      'cancel_at_period_end', a.cancel_at_period_end, 'suspended_at', a.suspended_at,
      'updated_at', a.updated_at) end,
    'provisioning', jsonb_build_object(
      'active_members', (select count(*) from public.organisation_memberships m
                         where m.organisation_id = o.id and m.status = 'active'),
      'staff_seats', internal.organisation_staff_seats(o.id),
      'workers', (select count(*) from public.agency_workers w
                  where w.agency_organisation_id = o.id and w.status <> 'terminated'),
      'facility_records', (select count(*) from public.agency_facilities f where f.agency_organisation_id = o.id)),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
               'agency_facility_id', f.id, 'facility_record_name', f.name, 'timezone', f.timezone,
               'record_status', f.status,
               'agency_id', ag.id, 'agency_name', ag.name,
               'facility_organisation_id', fo.id, 'facility_organisation_name', fo.name,
               'relationship_status', (select r.status from public.agency_facility_relationships r
                                       where r.agency_facility_id = f.id order by r.created_at desc limit 1))
             order by ag.name, f.name)
      from public.agency_facilities f
      join public.organisations ag on ag.id = f.agency_organisation_id
      left join public.organisations fo on fo.id = f.linked_facility_organisation_id
      where f.agency_organisation_id = o.id or f.linked_facility_organisation_id = o.id), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'email', i.email, 'role_key', i.role_key, 'status', i.status,
               'expired', i.status = 'pending' and i.expires_at <= now(),
               'expires_at', i.expires_at, 'send_count', i.send_count,
               'delivery_status', i.delivery_status, 'created_at', i.created_at)
             order by i.created_at desc)
      from public.organisation_invites i
      where i.organisation_id = o.id and i.issued_by_platform), '[]'::jsonb),
    'system', jsonb_build_object(
      'notifications_failed_30d', (select count(*) from internal.notification_outbox n
                                   where n.audience_organisation_id = o.id and n.state = 'failed'
                                     and n.created_at > now() - interval '30 days'),
      'scans_stuck', (select count(*) from public.credential_documents d
                      join public.credential_shares s on s.credential_id = d.credential_id and s.status = 'active'
                      where s.agency_organisation_id = o.id and d.status = 'scanning'
                        and d.created_at < now() - interval '1 hour')),
    'events', coalesce((
      select jsonb_agg(e order by e ->> 'occurred_at' desc)
      from (select jsonb_build_object('occurred_at', ae.occurred_at, 'action', ae.action) as e
            from public.audit_events ae
            where ae.organisation_id = o.id
              and ae.action in ('organisation.created', 'organisation.status_changed', 'facility.linked',
                                'platform.customer_account_created', 'platform.plan_changed',
                                'platform.trial_changed', 'platform.subscription_changed',
                                'platform.billing_contact_changed', 'invite.created', 'invite.resent',
                                'invite.revoked', 'invite.accepted')
            order by ae.occurred_at desc
            limit 15) recent), '[]'::jsonb)
  );
end;
$$;

-- Agency facility records an agency holds, for an explicit link choice.
create function public.platform_list_agency_facility_records(p_agency_organisation_id uuid)
returns table (
  agency_facility_id uuid,
  name text,
  timezone text,
  status public.facility_status,
  linked_facility_organisation_id uuid,
  linked_facility_organisation_name text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.platform_read('platform.facility_records_listed', p_agency_organisation_id);
  if not exists (select 1 from public.organisations o where o.id = p_agency_organisation_id and o.type = 'agency') then
    raise exception 'agency not found' using errcode = 'CH404';
  end if;
  return query
    select f.id, f.name, f.timezone, f.status, fo.id, fo.name
    from public.agency_facilities f
    left join public.organisations fo on fo.id = f.linked_facility_organisation_id
    where f.agency_organisation_id = p_agency_organisation_id
    order by f.name collate "C", f.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
create function public.platform_list_plans()
returns table (
  key text, name text, status text, monthly_price_minor integer, currency text,
  included_seats integer, included_facilities integer, accounts integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.platform_read('platform.plans_listed');
  return query
    select p.key, p.name, p.status, p.monthly_price_minor, p.currency, p.included_seats,
           p.included_facilities,
           (select count(*)::integer from public.customer_accounts a where a.plan_key = p.key)
    from public.subscription_plans p
    order by p.status, p.name;
end;
$$;

create function public.platform_save_plan(
  p_key text,
  p_name text,
  p_status text default 'active',
  p_monthly_price_minor integer default null,
  p_currency text default null,
  p_included_seats integer default null,
  p_included_facilities integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existed boolean;
begin
  perform internal.require_platform_admin();
  if p_status not in ('active', 'retired') then
    raise exception 'invalid plan status' using errcode = 'CH400';
  end if;
  v_existed := exists (select 1 from public.subscription_plans p where p.key = p_key);
  insert into public.subscription_plans as p
    (key, name, status, monthly_price_minor, currency, included_seats, included_facilities)
  values (p_key, btrim(p_name), p_status, p_monthly_price_minor, upper(nullif(btrim(p_currency), '')),
          p_included_seats, p_included_facilities)
  on conflict (key) do update
    set name = excluded.name, status = excluded.status, monthly_price_minor = excluded.monthly_price_minor,
        currency = excluded.currency, included_seats = excluded.included_seats,
        included_facilities = excluded.included_facilities, updated_at = now();
  perform internal.record_audit_event('platform.plan_saved', null, 'subscription_plan', null,
    jsonb_build_object('plan_key', p_key, 'created', not v_existed, 'status', p_status));
end;
$$;

-- ---------------------------------------------------------------------------
-- Commercial account (manual; Agency → Chelth)
-- ---------------------------------------------------------------------------
create function public.platform_save_customer_account(
  p_organisation_id uuid,
  p_status public.customer_account_status,
  p_reason text,
  p_plan_key text default null,
  p_billing_name text default null,
  p_billing_email text default null,
  p_trial_ends_on date default null,
  p_current_period_ends_on date default null,
  p_cancel_at_period_end boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := internal.require_platform_admin();
  v_reason text := internal.require_platform_reason(p_reason);
  o public.organisations;
  a public.customer_accounts;
  v_changes text[] := '{}'::text[];
  v_name text := nullif(btrim(p_billing_name), '');
  v_email text := lower(nullif(btrim(p_billing_email), ''));
begin
  select * into o from public.organisations x where x.id = p_organisation_id for update;
  if o.id is null then
    raise exception 'organisation not found' using errcode = 'CH404';
  end if;
  if o.type <> 'agency' then
    raise exception 'commercial accounts are for agencies' using errcode = 'CH400';
  end if;
  if p_status is null then
    raise exception 'choose an account status' using errcode = 'CH400';
  end if;
  if p_plan_key is not null and not exists (
       select 1 from public.subscription_plans p where p.key = p_plan_key
         and (p.status = 'active' or p.key = (select x.plan_key from public.customer_accounts x
                                               where x.organisation_id = o.id))) then
    raise exception 'choose an active plan' using errcode = 'CH400';
  end if;

  select * into a from public.customer_accounts x where x.organisation_id = o.id for update;

  if a.id is null then
    insert into public.customer_accounts as c
      (organisation_id, status, plan_key, billing_name, billing_email, trial_started_at, trial_ends_on,
       subscription_started_at, current_period_ends_on, cancel_at_period_end, suspended_at, updated_by_profile_id)
    values (o.id, p_status, p_plan_key, v_name, v_email,
            case when p_status = 'trial' then now() end, p_trial_ends_on,
            case when p_status = 'active' then now() end, p_current_period_ends_on,
            coalesce(p_cancel_at_period_end, false),
            case when p_status = 'suspended' then now() end, v_actor);
    perform internal.record_audit_event('platform.customer_account_created', o.id, 'organisation', o.id,
      jsonb_build_object('status', p_status, 'plan_key', p_plan_key, 'reason', v_reason));
  else
    if a.plan_key is distinct from p_plan_key then
      perform internal.record_audit_event('platform.plan_changed', o.id, 'organisation', o.id,
        jsonb_build_object('from', a.plan_key, 'to', p_plan_key, 'reason', v_reason));
    end if;
    if a.trial_ends_on is distinct from p_trial_ends_on then
      perform internal.record_audit_event('platform.trial_changed', o.id, 'organisation', o.id,
        jsonb_build_object('from', a.trial_ends_on, 'to', p_trial_ends_on, 'reason', v_reason));
    end if;
    if a.status is distinct from p_status then v_changes := array_append(v_changes, 'status'); end if;
    if a.current_period_ends_on is distinct from p_current_period_ends_on then v_changes := array_append(v_changes, 'current_period_ends_on'); end if;
    if a.cancel_at_period_end is distinct from coalesce(p_cancel_at_period_end, false) then v_changes := array_append(v_changes, 'cancel_at_period_end'); end if;
    if cardinality(v_changes) > 0 then
      perform internal.record_audit_event('platform.subscription_changed', o.id, 'organisation', o.id,
        jsonb_build_object('changes', to_jsonb(v_changes), 'from', a.status, 'to', p_status, 'reason', v_reason));
    end if;
    if a.billing_name is distinct from v_name or a.billing_email is distinct from v_email then
      perform internal.record_audit_event('platform.billing_contact_changed', o.id, 'organisation', o.id,
        jsonb_build_object('changes', to_jsonb(array_remove(array[
          case when a.billing_name is distinct from v_name then 'billing_name' end,
          case when a.billing_email is distinct from v_email then 'billing_email' end], null)),
          'reason', v_reason));
    end if;

    update public.customer_accounts c
       set status = p_status, plan_key = p_plan_key, billing_name = v_name, billing_email = v_email,
           trial_started_at = case when p_status = 'trial' and a.status <> 'trial' then now() else c.trial_started_at end,
           trial_ends_on = p_trial_ends_on,
           subscription_started_at = case when p_status = 'active' and c.subscription_started_at is null then now()
                                          else c.subscription_started_at end,
           current_period_ends_on = p_current_period_ends_on,
           cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
           suspended_at = case when p_status = 'suspended' then coalesce(c.suspended_at, now()) end,
           updated_at = now(), updated_by_profile_id = v_actor
     where c.id = a.id;
  end if;

  -- One access authority: a commercial suspension suspends the organisation,
  -- and resuming the account reactivates it (same transaction, audited).
  if p_status = 'suspended' and o.status = 'active' then
    update public.organisations x set status = 'suspended' where x.id = o.id;
    perform internal.record_audit_event('organisation.status_changed', o.id, 'organisation', o.id,
      jsonb_build_object('from', 'active', 'to', 'suspended', 'via', 'platform', 'cause', 'commercial',
                         'reason', v_reason));
  elsif p_status <> 'suspended' and a.status = 'suspended' and o.status = 'suspended' then
    update public.organisations x set status = 'active' where x.id = o.id;
    perform internal.record_audit_event('organisation.status_changed', o.id, 'organisation', o.id,
      jsonb_build_object('from', 'suspended', 'to', 'active', 'via', 'platform', 'cause', 'commercial',
                         'reason', v_reason));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organisation lifecycle with a reason (facility organisations, or agencies
-- whose commercial account is not suspended).
-- ---------------------------------------------------------------------------
create function public.platform_set_organisation_lifecycle(
  p_organisation_id uuid,
  p_status public.organisation_status,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_current public.organisation_status;
begin
  perform internal.require_platform_admin();
  v_reason := internal.require_platform_reason(p_reason);
  if p_status not in ('active', 'suspended') then
    raise exception 'choose active or suspended' using errcode = 'CH400';
  end if;
  select o.status into v_current from public.organisations o where o.id = p_organisation_id for update;
  if v_current is null then
    raise exception 'organisation not found' using errcode = 'CH404';
  end if;
  if v_current = p_status then
    raise exception 'organisation already has this status' using errcode = 'CH409';
  end if;
  if p_status = 'active' and exists (select 1 from public.customer_accounts a
                                     where a.organisation_id = p_organisation_id and a.status = 'suspended') then
    raise exception 'resume the commercial account to reactivate this organisation' using errcode = 'CH409';
  end if;

  update public.organisations o set status = p_status where o.id = p_organisation_id;
  perform internal.record_audit_event('organisation.status_changed', p_organisation_id, 'organisation',
    p_organisation_id, jsonb_build_object('from', v_current, 'to', p_status, 'via', 'platform',
                                          'cause', 'lifecycle', 'reason', v_reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- System health (no secrets: names, counts and statuses only)
-- ---------------------------------------------------------------------------
create function public.platform_get_system_health()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jobs jsonb := '[]'::jsonb;
begin
  perform internal.platform_read('platform.system_viewed');
  if to_regclass('cron.job') is not null and to_regclass('cron.job_run_details') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
               'last_status', l.status, 'last_run', l.end_time,
               'last_success', (select max(d.end_time) from cron.job_run_details d
                                where d.jobid = j.jobid and d.status = 'succeeded'),
               'failed_24h', (select count(*) from cron.job_run_details d
                              where d.jobid = j.jobid and d.status <> 'succeeded'
                                and d.start_time > now() - interval '24 hours'))
             order by j.jobname), '[]'::jsonb)
      from cron.job j
      left join lateral (select d.status, d.end_time from cron.job_run_details d
                         where d.jobid = j.jobid order by d.start_time desc limit 1) l on true
      where j.jobname like 'chelth-%'
    $q$ into v_jobs;
  end if;
  return jsonb_build_object(
    'database', jsonb_build_object('now', now()),
    'notifications', (select jsonb_build_object(
        'pending', count(*) filter (where n.state = 'pending'),
        'processing', count(*) filter (where n.state = 'processing'),
        'retry', count(*) filter (where n.state = 'retry'),
        'sent', count(*) filter (where n.state = 'sent'),
        'failed', count(*) filter (where n.state = 'failed'),
        'failed_24h', count(*) filter (where n.state = 'failed' and n.processed_at > now() - interval '24 hours'),
        'oldest_waiting', min(n.created_at) filter (where n.state in ('pending', 'retry', 'processing')))
      from internal.notification_outbox n),
    'notification_failures', coalesce((select jsonb_agg(jsonb_build_object('event', f.event, 'code', f.code, 'count', f.n))
      from (select n.event::text as event, coalesce(n.last_error_code, 'unknown') as code, count(*) as n
            from internal.notification_outbox n where n.state = 'failed'
              and n.created_at > now() - interval '30 days'
            group by 1, 2 order by 3 desc limit 10) f), '[]'::jsonb),
    'scanner', (select jsonb_build_object(
        'scanning', count(*) filter (where d.status = 'scanning'),
        'stuck', count(*) filter (where d.status = 'scanning' and d.created_at < now() - interval '1 hour'),
        'clean', count(*) filter (where d.status = 'clean'),
        'last_document', max(d.created_at))
      from public.credential_documents d),
    'cron', v_jobs,
    'buckets', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'public', b.public,
                                                             'file_size_limit', b.file_size_limit) order by b.id)
                         from storage.buckets b), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Platform administrators (read-only; grants stay an operator procedure)
-- ---------------------------------------------------------------------------
create function public.platform_list_admins()
returns table (
  grant_id uuid,
  profile_id uuid,
  display_name text,
  email text,
  granted_at timestamptz,
  granted_by text,
  revoked_at timestamptz,
  revoked_by text,
  active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.platform_read('platform.admins_listed');
  return query
    select pa.id, pa.profile_id, p.display_name, u.email::text, pa.granted_at, pa.granted_by,
           pa.revoked_at, pa.revoked_by, pa.revoked_at is null and p.status = 'active'
    from public.platform_admins pa
    join public.profiles p on p.id = pa.profile_id
    left join auth.users u on u.id = pa.profile_id
    order by pa.revoked_at is not null, pa.granted_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Platform activity: an explicit allow-list of platform-level events
-- ---------------------------------------------------------------------------
create function public.platform_list_activity(p_limit integer default 100, p_before timestamptz default null)
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
           -- Safe keys only (never free-form tenant metadata).
           (select coalesce(jsonb_object_agg(k.key, k.value), '{}'::jsonb)
            from jsonb_each(e.metadata) k
            where k.key in ('from', 'to', 'type', 'via', 'cause', 'reason', 'changes', 'status',
                            'plan_key', 'created', 'role_key', 'operator'))
    from public.audit_events e
    left join public.profiles p on p.id = e.actor_profile_id
    left join public.organisations o on o.id = e.organisation_id
    where (e.action in ('platform.admin_granted', 'platform.admin_revoked', 'platform.customer_account_created',
                        'platform.plan_changed', 'platform.trial_changed', 'platform.subscription_changed',
                        'platform.billing_contact_changed', 'platform.plan_saved', 'organisation.created')
           or (e.action in ('organisation.status_changed', 'facility.linked', 'invite.created',
                            'invite.resent', 'invite.revoked', 'profile.status_changed')
               and (e.metadata ->> 'via' = 'platform' or exists (
                      select 1 from public.platform_admins pa where pa.profile_id = e.actor_profile_id))))
      and (p_before is null or e.occurred_at < p_before)
      -- facility.linked is recorded on both sides; show it once (agency side).
      and not (e.action = 'facility.linked' and o.type = 'facility')
    order by e.occurred_at desc, e.id
    limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function
  internal.organisation_staff_seats(uuid),
  internal.platform_read(text, uuid),
  internal.require_platform_reason(text)
from public, anon, authenticated;

revoke all on function
  public.platform_get_overview(),
  public.platform_list_customers(),
  public.platform_get_customer(uuid),
  public.platform_list_agency_facility_records(uuid),
  public.platform_list_plans(),
  public.platform_save_plan(text, text, text, integer, text, integer, integer),
  public.platform_save_customer_account(uuid, public.customer_account_status, text, text, text, text, date, date, boolean),
  public.platform_set_organisation_lifecycle(uuid, public.organisation_status, text),
  public.platform_get_system_health(),
  public.platform_list_admins(),
  public.platform_list_activity(integer, timestamptz)
from public, anon;

grant execute on function
  public.platform_get_overview(),
  public.platform_list_customers(),
  public.platform_get_customer(uuid),
  public.platform_list_agency_facility_records(uuid),
  public.platform_list_plans(),
  public.platform_save_plan(text, text, text, integer, text, integer, integer),
  public.platform_save_customer_account(uuid, public.customer_account_status, text, text, text, text, date, date, boolean),
  public.platform_set_organisation_lifecycle(uuid, public.organisation_status, text),
  public.platform_get_system_health(),
  public.platform_list_admins(),
  public.platform_list_activity(integer, timestamptz)
to authenticated;
