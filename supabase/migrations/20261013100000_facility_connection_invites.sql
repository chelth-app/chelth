-- =============================================================================
-- Migration: facility_connection_invites
-- Stage:     P0-E9-4A.1 (agency-initiated facility onboarding, multi-agency)
--
-- Purpose
--   An agency invites a facility representative to connect with Chelth from
--   its OWN facility record. On acceptance, the representative either
--     A. creates the facility organisation (they become its owner), or
--     B. connects a facility organisation they ALREADY administer
--        (organisation.manage there),
--   and the agency's record is linked and its relationship becomes active,
--   atomically. Normal onboarding no longer needs a platform admin.
--
--   Two-party consent: the agency initiates (relationship.manage, AAL2); the
--   facility side consents (email-bound acceptance, plus organisation.manage
--   on an existing facility). Nothing is ever linked by name, email domain,
--   address or any other match; the agency never learns whether the facility
--   or the person already exists on Chelth (the response is the same).
--
--   Multi-agency: unchanged and relied upon. One facility organisation may be
--   linked from records in many agencies (one link per agency:
--   agency_facilities_one_link_per_agency; a record links once:
--   agency_facilities_link_once). Every relationship stays independent.
--
--   Security: tokens are hashed (sha256) and single use; invites are email
--   bound, expiring (7 days), revocable, rate limited, resend-capped and
--   audited. The table has RLS with NO policies and no grants: RPC access only.
--   No facility organisation is created before a valid acceptance.
--   Concurrency: the invite row and the agency record are locked (FOR UPDATE);
--   duplicate acceptance, accept-vs-revoke and double links resolve to one
--   result. The database constraints stay the final authority.
--   Platform fallback (platform_create_organisation /
--   platform_link_agency_facility) is unchanged.
-- =============================================================================

create table public.facility_connection_invites (
  id uuid primary key default gen_random_uuid(),
  agency_organisation_id uuid not null,
  agency_facility_id uuid not null,
  email text not null check (email = lower(btrim(email)) and char_length(email) <= 320
                             and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  contact_name text check (contact_name is null or (char_length(btrim(contact_name)) between 1 and 120
                                                    and contact_name !~ '[[:cntrl:]]')),
  token_hash bytea not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  expires_at timestamptz not null,
  send_count integer not null default 1 check (send_count between 1 and 5),
  last_sent_at timestamptz not null default now(),
  invited_by_profile_id uuid references public.profiles (id) on delete set null,
  delivery_status public.invite_delivery_status not null default 'not_attempted',
  delivery_provider text check (delivery_provider is null or char_length(delivery_provider) <= 40),
  delivery_error_code text check (delivery_error_code is null or char_length(delivery_error_code) <= 80),
  delivery_attempted_at timestamptz,
  accepted_by_profile_id uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  facility_organisation_id uuid references public.organisations (id) on delete restrict,
  relationship_id uuid references public.agency_facility_relationships (id) on delete restrict,
  revoked_by_profile_id uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (agency_facility_id, agency_organisation_id)
    references public.agency_facilities (id, agency_organisation_id) on delete restrict,
  check ((status = 'accepted') = (accepted_at is not null)),
  check ((status = 'revoked') = (revoked_at is not null)),
  check (status <> 'accepted' or (facility_organisation_id is not null and relationship_id is not null))
);
comment on table public.facility_connection_invites is
  'P0-E9-4A.1: agency-initiated facility connection invitations (two-party consent). RPC access only.';

-- One pending invitation per agency facility record.
create unique index facility_connection_invites_one_pending
  on public.facility_connection_invites (agency_facility_id) where status = 'pending';
create index facility_connection_invites_agency_idx
  on public.facility_connection_invites (agency_organisation_id, created_at desc);

alter table public.facility_connection_invites enable row level security;
revoke all on public.facility_connection_invites from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- "a•••@metro.org": enough to recognise, never the full address.
create function internal.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_email is null or position('@' in p_email) = 0 then null
              else left(p_email, 1) || '•••' || substr(p_email, position('@' in p_email)) end
$$;

-- The pending, unexpired invitation for the CALLER's verified email (locked), or null.
create function internal.resolve_connection_invite_for_caller(p_token text)
returns public.facility_connection_invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.facility_connection_invites;
  v_email text;
  v_confirmed_at timestamptz;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;
  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed_at
  from auth.users u where u.id = auth.uid();
  if v_email is null or v_confirmed_at is null then
    return null;
  end if;
  select * into v_invite from public.facility_connection_invites i
  where i.token_hash = internal.hash_invite_token(p_token)
  for update;
  if v_invite.id is null or v_invite.status <> 'pending' or v_invite.expires_at <= now()
     or v_invite.email <> v_email then
    return null;
  end if;
  -- The agency must still be active and still hold the authority that issued it.
  if not exists (select 1 from public.organisations o
                 where o.id = v_invite.agency_organisation_id and o.status = 'active') then
    return null;
  end if;
  return v_invite;
end;
$$;

-- ---------------------------------------------------------------------------
-- Agency side
-- ---------------------------------------------------------------------------
create function public.invite_facility_connection(
  p_facility_id uuid,
  p_email text,
  p_contact_name text default null
)
returns table (invite_id uuid, invite_token text, invite_expires_at timestamptz,
               facility_name text, agency_name text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  v_facility public.agency_facilities;
  v_email text := lower(btrim(p_email));
  v_token text := internal.new_invite_token();
  v_invite_id uuid;
  v_expires_at timestamptz := now() + interval '7 days';
  v_stale uuid;
begin
  select * into v_facility from public.agency_facilities f where f.id = p_facility_id for update;
  perform internal.require_capability(v_facility.agency_organisation_id, 'relationship.manage');
  if v_facility.id is null then
    raise exception 'facility not found' using errcode = 'CHF04';
  end if;
  if v_facility.status <> 'active' then
    raise exception 'invitations require an active facility record' using errcode = 'CHF09';
  end if;
  if v_facility.linked_facility_organisation_id is not null then
    raise exception 'this facility is already connected' using errcode = 'CHF09';
  end if;
  if v_email is null or char_length(v_email) > 320 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'enter a valid email address' using errcode = 'CH400';
  end if;
  if not internal.consume_rate_limit('facility_connection.create:' || v_facility.agency_organisation_id,
                                     50, interval '1 day') then
    raise exception 'too many invitations' using errcode = 'CH429';
  end if;

  -- An expired pending invitation is retired; a live one must be resent or revoked.
  update public.facility_connection_invites i
     set status = 'revoked', revoked_at = now(), revoked_by_profile_id = v_profile_id
   where i.agency_facility_id = p_facility_id and i.status = 'pending' and i.expires_at <= now()
  returning i.id into v_stale;
  if v_stale is not null then
    perform internal.record_audit_event('facility.connection_revoked', v_facility.agency_organisation_id,
      'facility_connection_invite', v_stale, jsonb_build_object('agency_facility_id', p_facility_id, 'cause', 'expired'));
  end if;
  if exists (select 1 from public.facility_connection_invites i
             where i.agency_facility_id = p_facility_id and i.status = 'pending') then
    raise exception 'an invitation is already pending for this facility' using errcode = 'CH409';
  end if;

  insert into public.facility_connection_invites as i
    (agency_organisation_id, agency_facility_id, email, contact_name, token_hash, expires_at, invited_by_profile_id)
  values (v_facility.agency_organisation_id, p_facility_id, v_email, nullif(btrim(p_contact_name), ''),
          internal.hash_invite_token(v_token), v_expires_at, v_profile_id)
  returning i.id into v_invite_id;

  perform internal.record_audit_event('facility.connection_invited', v_facility.agency_organisation_id,
    'facility_connection_invite', v_invite_id, jsonb_build_object('agency_facility_id', p_facility_id));

  return query
    select v_invite_id, v_token, v_expires_at, v_facility.name,
           (select o.name from public.organisations o where o.id = v_facility.agency_organisation_id);
end;
$$;

create function public.resend_facility_connection_invite(p_invite_id uuid)
returns table (invite_id uuid, invite_token text, invite_expires_at timestamptz, email text,
               facility_name text, agency_name text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_invite public.facility_connection_invites;
  v_token text := internal.new_invite_token();
  v_expires_at timestamptz := now() + interval '7 days';
begin
  perform internal.require_identity();
  select * into v_invite from public.facility_connection_invites i where i.id = p_invite_id for update;
  perform internal.require_capability(v_invite.agency_organisation_id, 'relationship.manage');
  if v_invite.status <> 'pending' then
    raise exception 'only pending invitations can be resent' using errcode = 'CH409';
  end if;
  if v_invite.send_count >= 5 then
    raise exception 'invitation resend limit reached' using errcode = 'CH429';
  end if;
  update public.facility_connection_invites i
     set token_hash = internal.hash_invite_token(v_token), expires_at = v_expires_at,
         send_count = i.send_count + 1, last_sent_at = now(), delivery_status = 'not_attempted'
   where i.id = p_invite_id;
  perform internal.record_audit_event('facility.connection_resent', v_invite.agency_organisation_id,
    'facility_connection_invite', p_invite_id,
    jsonb_build_object('agency_facility_id', v_invite.agency_facility_id, 'send_count', v_invite.send_count + 1));
  return query
    select p_invite_id, v_token, v_expires_at, v_invite.email,
           (select f.name from public.agency_facilities f where f.id = v_invite.agency_facility_id),
           (select o.name from public.organisations o where o.id = v_invite.agency_organisation_id);
end;
$$;

create function public.revoke_facility_connection_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_invite public.facility_connection_invites;
begin
  select * into v_invite from public.facility_connection_invites i where i.id = p_invite_id for update;
  perform internal.require_capability(v_invite.agency_organisation_id, 'relationship.manage');
  if v_invite.status <> 'pending' then
    raise exception 'only pending invitations can be revoked' using errcode = 'CH409';
  end if;
  update public.facility_connection_invites i
     set status = 'revoked', revoked_at = now(), revoked_by_profile_id = v_profile_id
   where i.id = p_invite_id;
  perform internal.record_audit_event('facility.connection_revoked', v_invite.agency_organisation_id,
    'facility_connection_invite', p_invite_id, jsonb_build_object('agency_facility_id', v_invite.agency_facility_id));
end;
$$;

create function public.record_facility_connection_delivery(
  p_invite_id uuid,
  p_status public.invite_delivery_status,
  p_provider text,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.facility_connection_invites;
begin
  perform internal.require_identity();
  select * into v_invite from public.facility_connection_invites i where i.id = p_invite_id for update;
  perform internal.require_capability(v_invite.agency_organisation_id, 'relationship.manage');
  if p_status = 'not_attempted' then
    raise exception 'a delivery outcome is required' using errcode = 'CH400';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'only pending invitations record delivery' using errcode = 'CH409';
  end if;
  update public.facility_connection_invites i
     set delivery_status = p_status, delivery_provider = left(p_provider, 40),
         delivery_error_code = left(p_error_code, 80), delivery_attempted_at = now()
   where i.id = p_invite_id;
end;
$$;

-- The agency's view: masked email and understandable state; never the token.
create function public.list_facility_connection_invites(p_facility_id uuid)
returns table (
  invite_id uuid,
  masked_email text,
  contact_name text,
  status text,
  expired boolean,
  send_count integer,
  last_sent_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz,
  accepted_at timestamptz,
  delivery_status public.invite_delivery_status,
  facility_organisation_name text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_agency uuid;
begin
  perform internal.require_identity();
  select f.agency_organisation_id into v_agency from public.agency_facilities f where f.id = p_facility_id;
  perform internal.require_capability(v_agency, 'relationship.view');
  return query
    select i.id, internal.mask_email(i.email), i.contact_name, i.status,
           i.status = 'pending' and i.expires_at <= now(), i.send_count, i.last_sent_at, i.expires_at,
           i.created_at, i.accepted_at, i.delivery_status,
           (select o.name from public.organisations o where o.id = i.facility_organisation_id)
    from public.facility_connection_invites i
    where i.agency_facility_id = p_facility_id and i.agency_organisation_id = v_agency
    order by i.created_at desc
    limit 20;
end;
$$;

-- ---------------------------------------------------------------------------
-- Facility representative side (email-bound)
-- ---------------------------------------------------------------------------
-- What the signed-in recipient may do: the inviting agency and record, and
-- ONLY the facility organisations the caller already belongs to (with whether
-- they may approve there). Never any other organisation.
create function public.preview_facility_connection_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_invite public.facility_connection_invites;
begin
  if not internal.consume_rate_limit('invite.redeem:' || v_profile_id, 20, interval '15 minutes') then
    raise exception 'too many invitation attempts' using errcode = 'CH429';
  end if;
  v_invite := internal.resolve_connection_invite_for_caller(p_token);
  if v_invite.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'agency_name', (select o.name from public.organisations o where o.id = v_invite.agency_organisation_id),
    'facility_name', (select f.name from public.agency_facilities f where f.id = v_invite.agency_facility_id),
    'contact_name', v_invite.contact_name,
    'expires_at', v_invite.expires_at,
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
               'organisation_id', o.id,
               'name', o.name,
               'can_approve', exists (select 1 from internal.profile_capabilities(v_profile_id, o.id) c
                                      where c.capability_key = 'organisation.manage'),
               'already_connected', exists (select 1 from public.agency_facilities f
                                            where f.agency_organisation_id = v_invite.agency_organisation_id
                                              and f.linked_facility_organisation_id = o.id))
             order by o.name)
      from public.organisations o
      join public.organisation_memberships m on m.organisation_id = o.id
        and m.profile_id = v_profile_id and m.status = 'active'
      where o.type = 'facility' and o.status = 'active'), '[]'::jsonb)
  );
end;
$$;

create function public.accept_facility_connection_invite(
  p_token text,
  p_mode text,
  p_facility_organisation_id uuid default null,
  p_facility_name text default null
)
returns table (facility_organisation_id uuid, relationship_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  v_invite public.facility_connection_invites;
  v_facility public.agency_facilities;
  v_org uuid;
  v_name text;
  v_slug text;
  v_membership_id uuid;
  v_owner_role text;
  v_relationship public.agency_facility_relationships;
  v_relationship_id uuid;
  v_created boolean := false;
begin
  if not internal.consume_rate_limit('invite.redeem:' || v_profile_id, 20, interval '15 minutes') then
    raise exception 'too many invitation attempts' using errcode = 'CH429';
  end if;
  if p_mode is null or p_mode not in ('create', 'connect') then
    raise exception 'choose how to connect' using errcode = 'CH400';
  end if;
  v_invite := internal.resolve_connection_invite_for_caller(p_token);
  if v_invite.id is null then
    perform internal.record_audit_event('facility.connection_acceptance_failed', null, null, null, '{}'::jsonb);
    raise exception 'invitation not available' using errcode = 'CH404';
  end if;

  select * into v_facility from public.agency_facilities f where f.id = v_invite.agency_facility_id for update;
  if v_facility.status <> 'active' or v_facility.linked_facility_organisation_id is not null then
    raise exception 'this facility is already connected' using errcode = 'CHF09';
  end if;

  if p_mode = 'connect' then
    -- Only an administrator of that facility may consent for it.
    if p_facility_organisation_id is null or not exists (
         select 1 from public.organisations o
         where o.id = p_facility_organisation_id and o.type = 'facility' and o.status = 'active') then
      raise exception 'choose a facility you administer' using errcode = 'CH400';
    end if;
    perform internal.require_capability(p_facility_organisation_id, 'organisation.manage');
    if exists (select 1 from public.agency_facilities f
               where f.agency_organisation_id = v_invite.agency_organisation_id
                 and f.linked_facility_organisation_id = p_facility_organisation_id) then
      raise exception 'this agency is already connected to that facility' using errcode = 'CH409';
    end if;
    v_org := p_facility_organisation_id;
  else
    if not internal.consume_rate_limit('organisation.create:' || v_profile_id, 5, interval '1 day') then
      raise exception 'too many organisations created' using errcode = 'CH429';
    end if;
    v_name := coalesce(nullif(btrim(p_facility_name), ''), v_facility.name);
    if char_length(v_name) not between 2 and 200 or v_name ~ '[[:cntrl:]]' then
      raise exception 'enter a facility name' using errcode = 'CH400';
    end if;
    v_slug := left(trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), 50);
    if char_length(v_slug) < 2 then v_slug := 'facility'; end if;
    v_slug := v_slug || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
    select r.key into strict v_owner_role from public.roles r
    where r.organisation_type = 'facility' and r.is_owner_role;

    insert into public.organisations (type, name, slug, created_by_profile_id)
    values ('facility', v_name, v_slug, v_profile_id)
    returning id into v_org;
    insert into public.organisation_memberships (organisation_id, profile_id)
    values (v_org, v_profile_id)
    returning id into v_membership_id;
    insert into public.membership_roles (organisation_id, organisation_type, membership_id, role_key, granted_by_profile_id)
    values (v_org, 'facility', v_membership_id, v_owner_role, v_profile_id);
    v_created := true;

    perform internal.record_audit_event('organisation.created', v_org, 'organisation', v_org,
      jsonb_build_object('type', 'facility', 'via', 'facility_connection'));
    perform internal.record_audit_event('facility.organisation_created_from_invite', v_org, 'organisation', v_org,
      jsonb_build_object('agency_organisation_id', v_invite.agency_organisation_id));
    perform internal.record_audit_event('membership.created', v_org, 'membership', v_membership_id,
      jsonb_build_object('via', 'facility_connection'));
    perform internal.record_audit_event('role.assigned', v_org, 'membership', v_membership_id,
      jsonb_build_object('role_key', v_owner_role, 'via', 'facility_connection'));
  end if;

  -- Link (agency_facilities_link_once and one_link_per_agency remain the final guard).
  update public.agency_facilities f
     set linked_facility_organisation_id = v_org, linked_facility_organisation_type = 'facility'
   where f.id = v_facility.id;
  perform internal.record_audit_event('facility.linked', v_invite.agency_organisation_id, 'facility', v_facility.id,
    jsonb_build_object('facility_organisation_id', v_org, 'via', 'invite'));
  perform internal.record_audit_event('facility.linked', v_org, 'facility', v_facility.id,
    jsonb_build_object('agency_organisation_id', v_invite.agency_organisation_id, 'via', 'invite'));

  -- Relationship: two-party consent activates it (a suspended one stays the agency's decision).
  select * into v_relationship from public.agency_facility_relationships r
  where r.agency_facility_id = v_facility.id and r.status <> 'ended'
  for update;
  if v_relationship.id is null then
    insert into public.agency_facility_relationships as r
      (agency_organisation_id, agency_facility_id, status, started_at, created_by_profile_id)
    values (v_invite.agency_organisation_id, v_facility.id, 'active', now(), v_invite.invited_by_profile_id)
    returning r.id into v_relationship_id;
  else
    v_relationship_id := v_relationship.id;
    if v_relationship.status = 'pending' then
      update public.agency_facility_relationships r
         set status = 'active', status_changed_at = now(), started_at = coalesce(r.started_at, now())
       where r.id = v_relationship_id;
    end if;
  end if;
  perform internal.record_audit_event('facility.relationship_connected', v_invite.agency_organisation_id,
    'relationship', v_relationship_id, jsonb_build_object('agency_facility_id', v_facility.id, 'facility_organisation_id', v_org));
  perform internal.record_audit_event('facility.relationship_connected', v_org,
    'relationship', v_relationship_id, jsonb_build_object('agency_organisation_id', v_invite.agency_organisation_id));

  update public.facility_connection_invites i
     set status = 'accepted', accepted_at = now(), accepted_by_profile_id = v_profile_id,
         facility_organisation_id = v_org, relationship_id = v_relationship_id
   where i.id = v_invite.id;
  perform internal.record_audit_event('facility.connection_accepted', v_invite.agency_organisation_id,
    'facility_connection_invite', v_invite.id,
    jsonb_build_object('agency_facility_id', v_facility.id, 'facility_organisation_id', v_org, 'created', v_created));
  perform internal.record_audit_event('facility.connection_accepted', v_org,
    'facility_connection_invite', v_invite.id,
    jsonb_build_object('agency_organisation_id', v_invite.agency_organisation_id, 'created', v_created));

  return query select v_org, v_relationship_id, v_created;
end;
$$;

-- ---------------------------------------------------------------------------
-- Platform support (diagnostics only; masked emails)
-- ---------------------------------------------------------------------------
create function public.platform_list_connection_invites(p_organisation_id uuid default null)
returns table (
  invite_id uuid,
  agency_organisation_id uuid,
  agency_name text,
  facility_record_name text,
  masked_email text,
  status text,
  expired boolean,
  send_count integer,
  created_at timestamptz,
  accepted_at timestamptz,
  facility_organisation_id uuid,
  facility_organisation_name text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.platform_read('platform.connection_invites_listed', p_organisation_id);
  return query
    select i.id, i.agency_organisation_id, a.name, f.name, internal.mask_email(i.email), i.status,
           i.status = 'pending' and i.expires_at <= now(), i.send_count, i.created_at, i.accepted_at,
           i.facility_organisation_id, fo.name
    from public.facility_connection_invites i
    join public.organisations a on a.id = i.agency_organisation_id
    join public.agency_facilities f on f.id = i.agency_facility_id
    left join public.organisations fo on fo.id = i.facility_organisation_id
    where p_organisation_id is null
       or i.agency_organisation_id = p_organisation_id
       or i.facility_organisation_id = p_organisation_id
    order by i.created_at desc
    limit 200;
end;
$$;

-- Platform activity: add the connection events to the allow-list (body otherwise unchanged).
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
                        'facility.connection_accepted', 'facility.organisation_created_from_invite')
           or (e.action in ('organisation.status_changed', 'facility.linked', 'invite.created',
                            'invite.resent', 'invite.revoked', 'profile.status_changed')
               and (e.metadata ->> 'via' in ('platform', 'invite') or exists (
                      select 1 from public.platform_admins pa where pa.profile_id = e.actor_profile_id))))
      and (p_before is null or e.occurred_at < p_before)
      -- Two-sided events are recorded on both organisations; show each once (agency side).
      and not (e.action in ('facility.linked', 'facility.connection_accepted') and o.type = 'facility')
    order by e.occurred_at desc, e.id
    limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function
  internal.mask_email(text),
  internal.resolve_connection_invite_for_caller(text)
from public, anon, authenticated;

revoke all on function
  public.invite_facility_connection(uuid, text, text),
  public.resend_facility_connection_invite(uuid),
  public.revoke_facility_connection_invite(uuid),
  public.record_facility_connection_delivery(uuid, public.invite_delivery_status, text, text),
  public.list_facility_connection_invites(uuid),
  public.preview_facility_connection_invite(text),
  public.accept_facility_connection_invite(text, text, uuid, text),
  public.platform_list_connection_invites(uuid)
from public, anon;

grant execute on function
  public.invite_facility_connection(uuid, text, text),
  public.resend_facility_connection_invite(uuid),
  public.revoke_facility_connection_invite(uuid),
  public.record_facility_connection_delivery(uuid, public.invite_delivery_status, text, text),
  public.list_facility_connection_invites(uuid),
  public.preview_facility_connection_invite(text),
  public.accept_facility_connection_invite(text, text, uuid, text),
  public.platform_list_connection_invites(uuid)
to authenticated;
