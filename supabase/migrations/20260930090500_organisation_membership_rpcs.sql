-- =============================================================================
-- Migration: organisation_membership_rpcs
-- Stage:     P0-E3-S2
--
-- Purpose
--   Server-controlled mutations for organisations, memberships and roles.
--   These RPCs are the ONLY write path for those tables. Each one:
--     1. requires an active identity                 (CH401)
--     2. derives the organisation from the target row, never from the client
--     3. requires a capability in that organisation  (CH402 step-up / CH403)
--     4. enforces anti-escalation rules:
--          - no changes to one's own roles or membership
--          - capability ceiling: cannot grant/revoke/manage beyond one's own
--     5. mutates without destroying history
--     6. writes audit events in the same transaction
--
--   Self-serve organisation creation: an authenticated user with a VERIFIED
--   email may create an AGENCY. The creator's membership and owner role are
--   derived server-side. Facility organisations are created by platform
--   administrators (platform RPC migration). Sign-up alone never grants any
--   organisation role.
--
-- Verified by: supabase/tests/security/020_*.test.sql, 030_*.test.sql
-- =============================================================================

create function public.create_organisation(
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

-- -----------------------------------------------------------------------------
-- Capabilities the caller holds in an organisation (UI hints only — every
-- operation re-checks in the database). Empty for non-members.
-- -----------------------------------------------------------------------------
create function public.my_capabilities(p_organisation_id uuid)
returns table (capability_key text, is_privileged boolean, is_satisfied boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.key, c.is_privileged, (not c.is_privileged or authz.current_aal() = 'aal2')
  from internal.profile_capabilities(auth.uid(), p_organisation_id) held
  join public.capabilities c on c.key = held.capability_key
  order by c.key
$$;

-- -----------------------------------------------------------------------------
-- Role assignment
-- -----------------------------------------------------------------------------
create function public.assign_membership_role(p_membership_id uuid, p_role_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_organisation_id uuid;
  v_organisation_type public.organisation_type;
  v_target_profile_id uuid;
  v_status public.membership_status;
  v_assignment_id uuid;
begin
  select m.organisation_id, o.type, m.profile_id, m.status
    into v_organisation_id, v_organisation_type, v_target_profile_id, v_status
  from public.organisation_memberships m
  join public.organisations o on o.id = m.organisation_id
  where m.id = p_membership_id;

  perform internal.require_capability(v_organisation_id, 'role.assign');

  if v_target_profile_id = v_profile_id then
    raise exception 'you cannot change your own roles' using errcode = 'CH403';
  end if;

  if v_status is distinct from 'active'::public.membership_status then
    raise exception 'roles can only be assigned to active memberships' using errcode = 'CH409';
  end if;

  if not exists (
    select 1 from public.roles r
    where r.key = p_role_key and r.organisation_type = v_organisation_type
  ) then
    raise exception 'role is not valid for this organisation' using errcode = 'CH400';
  end if;

  if not internal.role_within_ceiling(v_organisation_id, p_role_key) then
    raise exception 'cannot assign a role with capabilities you do not hold' using errcode = 'CH403';
  end if;

  insert into public.membership_roles
    (organisation_id, organisation_type, membership_id, role_key, granted_by_profile_id)
  values
    (v_organisation_id, v_organisation_type, p_membership_id, p_role_key, v_profile_id)
  returning id into v_assignment_id;

  perform internal.record_audit_event('role.assigned', v_organisation_id,
    'membership', p_membership_id, jsonb_build_object('role_key', p_role_key));

  return v_assignment_id;
end;
$$;

create function public.revoke_membership_role(p_membership_id uuid, p_role_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_organisation_id uuid;
  v_target_profile_id uuid;
  v_assignment_id uuid;
begin
  select m.organisation_id, m.profile_id
    into v_organisation_id, v_target_profile_id
  from public.organisation_memberships m
  where m.id = p_membership_id;

  perform internal.require_capability(v_organisation_id, 'role.assign');

  if v_target_profile_id = v_profile_id then
    raise exception 'you cannot change your own roles' using errcode = 'CH403';
  end if;

  if not internal.role_within_ceiling(v_organisation_id, p_role_key) then
    raise exception 'cannot revoke a role with capabilities you do not hold' using errcode = 'CH403';
  end if;

  update public.membership_roles mr
     set revoked_at = now(), revoked_by_profile_id = v_profile_id
   where mr.membership_id = p_membership_id
     and mr.role_key = p_role_key
     and mr.revoked_at is null
  returning mr.id into v_assignment_id;

  if v_assignment_id is null then
    raise exception 'role assignment not found' using errcode = 'CH404';
  end if;

  perform internal.assert_owner_remains(v_organisation_id);

  perform internal.record_audit_event('role.revoked', v_organisation_id,
    'membership', p_membership_id, jsonb_build_object('role_key', p_role_key));
end;
$$;

-- -----------------------------------------------------------------------------
-- Membership lifecycle: active ⇄ suspended → revoked (revoked is terminal here;
-- re-admission is by a new invitation). Revocation ends all role assignments
-- so a later re-admission never silently restores old privileges.
-- -----------------------------------------------------------------------------
create function public.set_membership_status(
  p_membership_id uuid,
  p_status public.membership_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_organisation_id uuid;
  v_target_profile_id uuid;
  v_current public.membership_status;
begin
  select m.organisation_id, m.profile_id, m.status
    into v_organisation_id, v_target_profile_id, v_current
  from public.organisation_memberships m
  where m.id = p_membership_id;

  perform internal.require_capability(v_organisation_id, 'membership.manage');

  if v_target_profile_id = v_profile_id then
    raise exception 'you cannot change your own membership' using errcode = 'CH403';
  end if;

  if not internal.membership_within_ceiling(v_organisation_id, p_membership_id) then
    raise exception 'cannot manage a member with capabilities you do not hold' using errcode = 'CH403';
  end if;

  if not (
    (v_current = 'active' and p_status in ('suspended', 'revoked'))
    or (v_current = 'suspended' and p_status in ('active', 'revoked'))
  ) then
    raise exception 'membership status change not allowed' using errcode = 'CH409';
  end if;

  update public.organisation_memberships
     set status = p_status
   where id = p_membership_id;

  if p_status = 'revoked' then
    update public.membership_roles mr
       set revoked_at = now(), revoked_by_profile_id = v_profile_id
     where mr.membership_id = p_membership_id
       and mr.revoked_at is null;
  end if;

  perform internal.assert_owner_remains(v_organisation_id);

  perform internal.record_audit_event('membership.status_changed', v_organisation_id,
    'membership', p_membership_id, jsonb_build_object('from', v_current, 'to', p_status));
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function
  public.create_organisation(public.organisation_type, text, text),
  public.my_capabilities(uuid),
  public.assign_membership_role(uuid, text),
  public.revoke_membership_role(uuid, text),
  public.set_membership_status(uuid, public.membership_status)
from public, anon;

grant execute on function
  public.create_organisation(public.organisation_type, text, text),
  public.my_capabilities(uuid),
  public.assign_membership_role(uuid, text),
  public.revoke_membership_role(uuid, text),
  public.set_membership_status(uuid, public.membership_status)
to authenticated;
