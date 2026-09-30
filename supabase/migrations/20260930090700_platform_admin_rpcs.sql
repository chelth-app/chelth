-- =============================================================================
-- Migration: platform_admin_rpcs
-- Stage:     P0-E3-S2
--
-- Purpose
--   Platform administration through NARROW, AUDITED functions. Platform admins:
--     - are not members of any tenant;
--     - gain no RLS read access to tenant tables;
--     - must hold an active platform_admins grant AND an AAL2 session;
--     - see only the summary data each function returns;
--     - leave an audit event for every call, reads included.
--
--   Grants are operator procedures (internal.grant_platform_admin /
--   internal.revoke_platform_admin), executable only by the database owner
--   role — never through the Data API. See
--   docs/architecture/AUTHORIZATION_MODEL.md#platform-administration.
--
-- Verified by: supabase/tests/security/050_platform_admin.test.sql
-- =============================================================================

create function public.platform_list_organisations()
returns table (
  organisation_id uuid,
  organisation_type public.organisation_type,
  organisation_name text,
  organisation_slug text,
  organisation_status public.organisation_status,
  organisation_created_at timestamptz,
  active_member_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_platform_admin();
  perform internal.record_audit_event('platform.organisations_listed', null, null, null, '{}'::jsonb);

  return query
    select o.id, o.type, o.name, o.slug, o.status, o.created_at,
           (select count(*) from public.organisation_memberships m
             where m.organisation_id = o.id and m.status = 'active')
    from public.organisations o
    order by o.created_at desc
    limit 500;
end;
$$;

create function public.platform_create_organisation(
  p_type public.organisation_type,
  p_name text,
  p_slug text,
  p_owner_email text
)
returns table (
  organisation_id uuid,
  invite_id uuid,
  invite_token text,
  invite_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_platform_admin();
  v_organisation_id uuid;
  v_owner_role text;
  v_token text := internal.new_invite_token();
  v_invite_id uuid;
  v_expires_at timestamptz;
begin
  select r.key into strict v_owner_role
  from public.roles r
  where r.organisation_type = p_type and r.is_owner_role;

  -- The platform admin does NOT become a member. The first administrator is
  -- invited and joins through the normal, verified invitation path.
  insert into public.organisations as o (type, name, slug, created_by_profile_id)
  values (p_type, btrim(p_name), p_slug, v_profile_id)
  returning o.id into v_organisation_id;

  insert into public.organisation_invites as i
    (organisation_id, organisation_type, email, role_key, token_hash, expires_at,
     invited_by_profile_id, issued_by_platform)
  values
    (v_organisation_id, p_type, lower(btrim(p_owner_email)), v_owner_role,
     internal.hash_invite_token(v_token), now() + interval '7 days', v_profile_id, true)
  returning i.id, i.expires_at into v_invite_id, v_expires_at;

  perform internal.record_audit_event('organisation.created', v_organisation_id,
    'organisation', v_organisation_id, jsonb_build_object('type', p_type, 'via', 'platform'));
  perform internal.record_audit_event('invite.created', v_organisation_id,
    'invite', v_invite_id, jsonb_build_object('role_key', v_owner_role, 'via', 'platform'));

  return query select v_organisation_id, v_invite_id, v_token, v_expires_at;
end;
$$;

create function public.platform_set_organisation_status(
  p_organisation_id uuid,
  p_status public.organisation_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.organisation_status;
begin
  perform internal.require_platform_admin();

  select o.status into v_current from public.organisations o where o.id = p_organisation_id for update;
  if v_current is null then
    raise exception 'organisation not found' using errcode = 'CH404';
  end if;
  if v_current = p_status then
    raise exception 'organisation already has this status' using errcode = 'CH409';
  end if;

  update public.organisations o set status = p_status where o.id = p_organisation_id;

  perform internal.record_audit_event('organisation.status_changed', p_organisation_id,
    'organisation', p_organisation_id,
    jsonb_build_object('from', v_current, 'to', p_status, 'via', 'platform'));
end;
$$;

create function public.platform_set_profile_status(
  p_profile_id uuid,
  p_status public.profile_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := internal.require_platform_admin();
  v_current public.profile_status;
begin
  if p_profile_id = v_admin_id then
    raise exception 'you cannot change your own account status' using errcode = 'CH403';
  end if;

  select p.status into v_current from public.profiles p where p.id = p_profile_id for update;
  if v_current is null then
    raise exception 'profile not found' using errcode = 'CH404';
  end if;
  if v_current = p_status then
    raise exception 'profile already has this status' using errcode = 'CH409';
  end if;

  update public.profiles p set status = p_status where p.id = p_profile_id;

  perform internal.record_audit_event('profile.status_changed', null,
    'profile', p_profile_id, jsonb_build_object('from', v_current, 'to', p_status));
end;
$$;

-- -----------------------------------------------------------------------------
-- Operator procedures (NOT callable through the API)
--   select internal.grant_platform_admin('<profile uuid>', '<operator name>', '<reason>');
--   select internal.revoke_platform_admin('<profile uuid>', '<operator name>', '<reason>');
-- -----------------------------------------------------------------------------
create function internal.grant_platform_admin(p_profile_id uuid, p_operator text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant_id uuid;
begin
  insert into public.platform_admins as pa (profile_id, granted_by, grant_reason)
  values (p_profile_id, btrim(p_operator), btrim(p_reason))
  returning pa.id into v_grant_id;

  perform internal.record_audit_event('platform.admin_granted', null, 'profile', p_profile_id,
    jsonb_build_object('grant_id', v_grant_id, 'operator', btrim(p_operator), 'db_role', session_user));

  return v_grant_id;
end;
$$;

create function internal.revoke_platform_admin(p_profile_id uuid, p_operator text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant_id uuid;
begin
  update public.platform_admins pa
     set revoked_at = now(), revoked_by = btrim(p_operator), revoke_reason = btrim(p_reason)
   where pa.profile_id = p_profile_id and pa.revoked_at is null
  returning pa.id into v_grant_id;

  if v_grant_id is null then
    raise exception 'no active platform admin grant' using errcode = 'CH404';
  end if;

  perform internal.record_audit_event('platform.admin_revoked', null, 'profile', p_profile_id,
    jsonb_build_object('grant_id', v_grant_id, 'operator', btrim(p_operator), 'db_role', session_user));
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function
  internal.grant_platform_admin(uuid, text, text),
  internal.revoke_platform_admin(uuid, text, text)
from public, anon, authenticated;

revoke all on function
  public.platform_list_organisations(),
  public.platform_create_organisation(public.organisation_type, text, text, text),
  public.platform_set_organisation_status(uuid, public.organisation_status),
  public.platform_set_profile_status(uuid, public.profile_status)
from public, anon;

grant execute on function
  public.platform_list_organisations(),
  public.platform_create_organisation(public.organisation_type, text, text, text),
  public.platform_set_organisation_status(uuid, public.organisation_status),
  public.platform_set_profile_status(uuid, public.profile_status)
to authenticated;
