-- =============================================================================
-- Migration: organisation_invites
-- Stage:     P0-E3-S2
--
-- Purpose
--   Invitations into an organisation with a server-defined role.
--
-- Properties
--   - Token: 256 bits from pgcrypto, base64url (43 chars). Returned ONCE to the
--     issuer; only its SHA-256 is stored. No API role can read the table.
--   - Expiry: 7 days. Single use (status pending → accepted).
--   - Resend rotates the token (old token stops working) and resets expiry.
--   - Organisation and role come from the invite row, never from the
--     redeeming client. Role must be within the issuer's capability ceiling
--     at issue time AND at redemption time (stale issuer authority is refused).
--   - Redemption requires an authenticated identity whose VERIFIED email
--     equals the invited email.
--   - No pre-authentication oracle: there is no anonymous validation RPC. The
--     invite landing page responds identically for any token; validity is
--     evaluated only after sign-in, throttled per identity (20 / 15 min).
--   - Invalid tokens return an EMPTY result (no raise) so the throttle
--     increment and the failure audit event commit. Invalid, expired,
--     revoked, used, wrong-email and stale-issuer cases are indistinguishable.
--
-- Verified by: supabase/tests/security/040_invitations.test.sql
-- =============================================================================

create table public.organisation_invites (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  organisation_type public.organisation_type not null,
  email text not null
    check (
      email = lower(btrim(email))
      and char_length(email) <= 320
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    ),
  role_key text not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  status public.invite_status not null default 'pending',
  expires_at timestamptz not null,
  send_count integer not null default 1 check (send_count between 1 and 5),
  last_sent_at timestamptz not null default now(),
  invited_by_profile_id uuid references public.profiles (id) on delete set null,
  issued_by_platform boolean not null default false,
  accepted_by_profile_id uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  revoked_by_profile_id uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organisation_id, organisation_type)
    references public.organisations (id, type) on delete restrict,
  foreign key (role_key, organisation_type)
    references public.roles (key, organisation_type) on delete restrict,
  check (status <> 'accepted' or accepted_at is not null),
  check (status <> 'revoked' or revoked_at is not null)
);

comment on table public.organisation_invites is
  'Invitations. Token stored only as SHA-256. No direct API access; RPCs only.';

-- One outstanding invitation per person per organisation.
create unique index organisation_invites_one_pending
  on public.organisation_invites (organisation_id, email) where status = 'pending';
create index organisation_invites_organisation_idx
  on public.organisation_invites (organisation_id, created_at desc);

create trigger organisation_invites_set_updated_at
  before update on public.organisation_invites
  for each row execute function internal.set_updated_at();

alter table public.organisation_invites enable row level security;
-- Intentionally no grants and no policies: token_hash must never be readable.

-- -----------------------------------------------------------------------------
-- Token helpers
-- -----------------------------------------------------------------------------
create function internal.new_invite_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_')
$$;

create function internal.hash_invite_token(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select sha256(convert_to(p_token, 'UTF8'))
$$;

-- Returns the redeemable invite for the CALLER, or NULL. Locks the row.
create function internal.resolve_invite_for_caller(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.organisation_invites;
  v_email text;
  v_confirmed_at timestamptz;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;

  select lower(u.email), u.email_confirmed_at
    into v_email, v_confirmed_at
  from auth.users u
  where u.id = auth.uid();

  if v_email is null or v_confirmed_at is null then
    return null;
  end if;

  select * into v_invite
  from public.organisation_invites i
  where i.token_hash = internal.hash_invite_token(p_token)
  for update;

  if not found
     or v_invite.status <> 'pending'
     or v_invite.expires_at <= now()
     or v_invite.email <> v_email then
    return null;
  end if;

  if not exists (
    select 1 from public.organisations o
    where o.id = v_invite.organisation_id and o.status = 'active'
  ) then
    return null;
  end if;

  -- The issuer must STILL hold the authority that allowed this invitation.
  if v_invite.issued_by_platform then
    if not exists (
      select 1
      from public.platform_admins pa
      join public.profiles p on p.id = pa.profile_id and p.status = 'active'
      where pa.profile_id = v_invite.invited_by_profile_id
        and pa.revoked_at is null
    ) then
      return null;
    end if;
  else
    if not exists (
      select 1
      from internal.profile_capabilities(v_invite.invited_by_profile_id, v_invite.organisation_id) held
      where held.capability_key = 'membership.invite'
    ) or exists (
      select rc.capability_key
      from public.role_capabilities rc
      where rc.role_key = v_invite.role_key
      except
      select held.capability_key
      from internal.profile_capabilities(v_invite.invited_by_profile_id, v_invite.organisation_id) held
    ) then
      return null;
    end if;
  end if;

  return v_invite.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Issue
-- -----------------------------------------------------------------------------
create function public.create_organisation_invite(
  p_organisation_id uuid,
  p_email text,
  p_role_key text
)
returns table (invite_id uuid, invite_token text, invite_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  v_email text := lower(btrim(p_email));
  v_organisation_type public.organisation_type;
  v_token text;
  v_invite_id uuid;
  v_expires_at timestamptz;
begin
  perform internal.require_capability(p_organisation_id, 'membership.invite');

  select o.type into v_organisation_type
  from public.organisations o
  where o.id = p_organisation_id;

  if not exists (
    select 1 from public.roles r
    where r.key = p_role_key and r.organisation_type = v_organisation_type
  ) then
    raise exception 'role is not valid for this organisation' using errcode = 'CH400';
  end if;

  if not internal.role_within_ceiling(p_organisation_id, p_role_key) then
    raise exception 'cannot invite with a role whose capabilities you do not hold'
      using errcode = 'CH403';
  end if;

  if exists (
    select 1
    from auth.users u
    join public.organisation_memberships m
      on m.profile_id = u.id
     and m.organisation_id = p_organisation_id
     and m.status in ('active', 'suspended')
    where lower(u.email) = v_email
  ) then
    raise exception 'this person is already a member' using errcode = 'CH409';
  end if;

  if not internal.consume_rate_limit('invite.create:' || p_organisation_id, 100, interval '1 day') then
    raise exception 'too many invitations issued' using errcode = 'CH429';
  end if;

  v_token := internal.new_invite_token();

  insert into public.organisation_invites as i
    (organisation_id, organisation_type, email, role_key, token_hash, expires_at,
     invited_by_profile_id)
  values
    (p_organisation_id, v_organisation_type, v_email, p_role_key,
     internal.hash_invite_token(v_token), now() + interval '7 days', v_profile_id)
  returning i.id, i.expires_at into v_invite_id, v_expires_at;

  perform internal.record_audit_event('invite.created', p_organisation_id,
    'invite', v_invite_id, jsonb_build_object('role_key', p_role_key));

  return query select v_invite_id, v_token, v_expires_at;
end;
$$;

-- Shared authority check for resend/revoke: organisation members with
-- membership.invite, or a platform admin for platform-issued invitations.
create function internal.require_invite_authority(p_invite_id uuid)
returns public.organisation_invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.organisation_invites;
begin
  select * into v_invite
  from public.organisation_invites i
  where i.id = p_invite_id
  for update;

  if found and v_invite.issued_by_platform and authz.is_platform_admin() then
    return v_invite;
  end if;

  perform internal.require_capability(v_invite.organisation_id, 'membership.invite');

  if not internal.role_within_ceiling(v_invite.organisation_id, v_invite.role_key) then
    raise exception 'cannot manage an invitation for a role whose capabilities you do not hold'
      using errcode = 'CH403';
  end if;

  return v_invite;
end;
$$;

create function public.resend_organisation_invite(p_invite_id uuid)
returns table (invite_id uuid, invite_token text, invite_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  v_invite public.organisation_invites := internal.require_invite_authority(p_invite_id);
  v_token text;
  v_expires_at timestamptz := now() + interval '7 days';
begin
  if v_invite.status <> 'pending' then
    raise exception 'only pending invitations can be resent' using errcode = 'CH409';
  end if;

  if v_invite.send_count >= 5 then
    raise exception 'invitation resend limit reached' using errcode = 'CH429';
  end if;

  v_token := internal.new_invite_token();

  -- Rotation: the previous token's hash is overwritten and can never match again.
  update public.organisation_invites i
     set token_hash = internal.hash_invite_token(v_token),
         expires_at = v_expires_at,
         send_count = i.send_count + 1,
         last_sent_at = now(),
         invited_by_profile_id = v_profile_id
   where i.id = p_invite_id;

  perform internal.record_audit_event('invite.resent', v_invite.organisation_id,
    'invite', p_invite_id, jsonb_build_object('send_count', v_invite.send_count + 1));

  return query select p_invite_id, v_token, v_expires_at;
end;
$$;

create function public.revoke_organisation_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_invite public.organisation_invites := internal.require_invite_authority(p_invite_id);
begin
  if v_invite.status <> 'pending' then
    raise exception 'only pending invitations can be revoked' using errcode = 'CH409';
  end if;

  update public.organisation_invites i
     set status = 'revoked', revoked_at = now(), revoked_by_profile_id = v_profile_id
   where i.id = p_invite_id;

  perform internal.record_audit_event('invite.revoked', v_invite.organisation_id,
    'invite', p_invite_id, '{}'::jsonb);
end;
$$;

create function public.list_organisation_invites(p_organisation_id uuid)
returns table (
  invite_id uuid,
  invitee_email text,
  invite_role_key text,
  invite_status public.invite_status,
  invite_expires_at timestamptz,
  invite_send_count integer,
  invited_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'membership.invite');

  return query
    select i.id, i.email, i.role_key, i.status, i.expires_at, i.send_count, i.created_at
    from public.organisation_invites i
    where i.organisation_id = p_organisation_id
      and (i.status = 'pending' or i.updated_at > now() - interval '30 days')
    order by i.created_at desc
    limit 200;
end;
$$;

-- -----------------------------------------------------------------------------
-- Redeem (authenticated invitee)
-- -----------------------------------------------------------------------------
create function public.preview_organisation_invite(p_token text)
returns table (
  organisation_id uuid,
  organisation_name text,
  organisation_type public.organisation_type,
  role_key text,
  role_name text,
  invite_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  v_invite_id uuid;
begin
  if not internal.consume_rate_limit('invite.redeem:' || v_profile_id, 20, interval '15 minutes') then
    raise exception 'too many invitation attempts' using errcode = 'CH429';
  end if;

  v_invite_id := internal.resolve_invite_for_caller(p_token);
  if v_invite_id is null then
    return;
  end if;

  return query
    select o.id, o.name, o.type, r.key, r.name, i.expires_at
    from public.organisation_invites i
    join public.organisations o on o.id = i.organisation_id
    join public.roles r on r.key = i.role_key
    where i.id = v_invite_id;
end;
$$;

create function public.accept_organisation_invite(p_token text)
returns table (organisation_id uuid, membership_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  v_invite_id uuid;
  v_invite public.organisation_invites;
  v_membership_id uuid;
  v_membership_status public.membership_status;
  v_role_assignment_id uuid;
begin
  if not internal.consume_rate_limit('invite.redeem:' || v_profile_id, 20, interval '15 minutes') then
    raise exception 'too many invitation attempts' using errcode = 'CH429';
  end if;

  v_invite_id := internal.resolve_invite_for_caller(p_token);
  if v_invite_id is null then
    -- Commits with the throttle increment: a visible security signal.
    perform internal.record_audit_event('invite.acceptance_failed', null, null, null, '{}'::jsonb);
    return;
  end if;

  select * into v_invite from public.organisation_invites i where i.id = v_invite_id;

  select m.id, m.status into v_membership_id, v_membership_status
  from public.organisation_memberships m
  where m.organisation_id = v_invite.organisation_id
    and m.profile_id = v_profile_id
  for update;

  if v_membership_id is null then
    insert into public.organisation_memberships as m (organisation_id, profile_id)
    values (v_invite.organisation_id, v_profile_id)
    returning m.id into v_membership_id;

    perform internal.record_audit_event('membership.created', v_invite.organisation_id,
      'membership', v_membership_id, jsonb_build_object('via', 'invite', 'invite_id', v_invite.id));
  elsif v_membership_status = 'suspended' then
    raise exception 'your membership is suspended; an administrator must reinstate it'
      using errcode = 'CH409';
  elsif v_membership_status = 'revoked' then
    update public.organisation_memberships m set status = 'active' where m.id = v_membership_id;

    perform internal.record_audit_event('membership.reactivated', v_invite.organisation_id,
      'membership', v_membership_id, jsonb_build_object('via', 'invite', 'invite_id', v_invite.id));
  end if;

  insert into public.membership_roles as mr
    (organisation_id, organisation_type, membership_id, role_key, granted_by_profile_id)
  values
    (v_invite.organisation_id, v_invite.organisation_type, v_membership_id,
     v_invite.role_key, v_invite.invited_by_profile_id)
  on conflict (membership_id, role_key) where revoked_at is null do nothing
  returning mr.id into v_role_assignment_id;

  if v_role_assignment_id is not null then
    perform internal.record_audit_event('role.assigned', v_invite.organisation_id,
      'membership', v_membership_id,
      jsonb_build_object('role_key', v_invite.role_key, 'via', 'invite', 'invite_id', v_invite.id));
  end if;

  update public.organisation_invites i
     set status = 'accepted', accepted_at = now(), accepted_by_profile_id = v_profile_id
   where i.id = v_invite.id;

  perform internal.record_audit_event('invite.accepted', v_invite.organisation_id,
    'invite', v_invite.id, jsonb_build_object('role_key', v_invite.role_key));

  return query select v_invite.organisation_id, v_membership_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function
  internal.new_invite_token(),
  internal.hash_invite_token(text),
  internal.resolve_invite_for_caller(text),
  internal.require_invite_authority(uuid)
from public, anon, authenticated;

revoke all on function
  public.create_organisation_invite(uuid, text, text),
  public.resend_organisation_invite(uuid),
  public.revoke_organisation_invite(uuid),
  public.list_organisation_invites(uuid),
  public.preview_organisation_invite(text),
  public.accept_organisation_invite(text)
from public, anon;

grant execute on function
  public.create_organisation_invite(uuid, text, text),
  public.resend_organisation_invite(uuid),
  public.revoke_organisation_invite(uuid),
  public.list_organisation_invites(uuid),
  public.preview_organisation_invite(text),
  public.accept_organisation_invite(text)
to authenticated;
