-- =============================================================================
-- Migration: invite_reissue_pending
-- Stage:     P0-E9 (Workforce invite conflict)
--
-- Problem
--   create_organisation_invite always INSERTed. Inviting an email that still had
--   a pending invitation for the organisation violated the partial unique index
--   organisation_invites_one_pending (23505), which the app reported as the
--   generic "This change conflicts with the current state". Expiry is computed
--   (status stays 'pending' after expires_at), so an expired, never-accepted
--   invitation blocked re-inviting the same way.
--
-- Change (same arguments; one extra return column)
--   * A transaction-scoped advisory lock per (organisation, email) serialises
--     concurrent issues, so they cannot race into the unique index.
--   * Pending invitation for the SAME role: re-issued through the existing
--     rotation semantics (as resend_organisation_invite): new token, the old
--     token hash overwritten (old link can never match again), a fresh 7-day
--     expiry, the 5-send cap (CH429), audit `invite.resent`. Returns
--     invite_reissued = true. No second row is created.
--   * Pending invitation for a DIFFERENT role: refused with CHI09 — the issuer
--     must revoke it first (no silent role change).
--   * Already a member: CHI10 (was a generic CH409).
--   * Accepted / revoked invitations are not pending, so a new invitation is
--     created exactly as before (subject to the member check).
--   Unchanged: capability check, role ceiling, email binding and
--   normalisation, token hashing, single use, expiry length, daily issue rate
--   limit for new invitations, audit `invite.created`, tenant isolation.
--
-- Verified by: supabase/tests/security/040_invitations.test.sql
-- =============================================================================

drop function public.create_organisation_invite(uuid, text, text);

create function public.create_organisation_invite(
  p_organisation_id uuid,
  p_email text,
  p_role_key text
)
returns table (invite_id uuid, invite_token text, invite_expires_at timestamptz, invite_reissued boolean)
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
  v_pending public.organisation_invites;
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
    raise exception 'this person is already a member' using errcode = 'CHI10';
  end if;

  -- Serialise issues for this person in this organisation.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('organisation_invite:' || p_organisation_id::text || ':' || v_email, 0));

  select * into v_pending
  from public.organisation_invites i
  where i.organisation_id = p_organisation_id and i.email = v_email and i.status = 'pending'
  for update;

  if v_pending.id is not null then
    if v_pending.role_key <> p_role_key then
      raise exception 'a pending invitation with a different role exists' using errcode = 'CHI09';
    end if;
    if v_pending.send_count >= 5 then
      raise exception 'invitation resend limit reached' using errcode = 'CH429';
    end if;

    v_token := internal.new_invite_token();
    v_expires_at := now() + interval '7 days';
    -- Rotation: the previous token's hash is overwritten and can never match again.
    update public.organisation_invites i
       set token_hash = internal.hash_invite_token(v_token),
           expires_at = v_expires_at,
           send_count = i.send_count + 1,
           last_sent_at = now(),
           invited_by_profile_id = v_profile_id
     where i.id = v_pending.id;

    perform internal.record_audit_event('invite.resent', p_organisation_id,
      'invite', v_pending.id, jsonb_build_object('send_count', v_pending.send_count + 1, 'via', 'reinvite'));

    return query select v_pending.id, v_token, v_expires_at, true;
    return;
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

  return query select v_invite_id, v_token, v_expires_at, false;
end;
$$;

revoke all on function public.create_organisation_invite(uuid, text, text) from public, anon;
grant execute on function public.create_organisation_invite(uuid, text, text) to authenticated;
