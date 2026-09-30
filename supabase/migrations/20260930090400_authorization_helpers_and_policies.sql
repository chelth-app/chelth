-- =============================================================================
-- Migration: authorization_helpers_and_policies
-- Stage:     P0-E3-S2
--
-- Purpose
--   Reusable authorization helpers and the RLS policies for every table
--   created in this stage.
--
--   authz.*    (EXECUTE granted to authenticated; used by policies)
--     current_profile_id()                 caller's profile if active, else NULL
--     current_aal()                        'aal1' | 'aal2' from the JWT (fails closed to aal1)
--     is_org_member(org)                   active membership in a non-archived org
--     has_capability(org, capability)     THE authorization primitive; enforces
--                                          AAL2 for privileged capabilities
--     is_platform_admin()                  active platform grant AND aal2
--     can_view_profile(profile)            self, or co-member visible via membership.view
--     is_own_membership(membership)        membership belongs to caller
--
--   internal.* (no API access; used inside SECURITY DEFINER RPCs)
--     profile_capabilities(profile, org)   effective capabilities, ignoring AAL
--     require_identity()                   raise CH401 unless an active profile
--     require_capability(org, capability)  raise CH402 (step-up) / CH403
--     require_platform_admin()             raise CH402 / CH403
--     role_within_ceiling(org, role)       role grants nothing the caller lacks
--     membership_within_ceiling(org, m)    target holds nothing the caller lacks
--     assert_owner_remains(org)            org keeps ≥1 active organisation.manage holder
--
--   Every organisation-aware check takes the organisation explicitly. There
--   is no "my organisation" / "my staff" helper and no active-organisation
--   state in the database.
--
--   All helpers: SECURITY DEFINER where they read protected tables, fixed
--   search_path = '', fully-qualified names, EXECUTE revoked from PUBLIC.
--
-- Error convention (src/lib/errors/normalize-error.ts):
--   CH400 validation · CH401 authentication · CH402 MFA step-up required
--   CH403 forbidden · CH404 not found · CH409 invalid state · CH410 invalid
--   invitation · CH429 rate limited
--
-- Verified by: supabase/tests/security/0[1-6]0_*.test.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Identity & assurance
-- -----------------------------------------------------------------------------
create function authz.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.id = auth.uid()
    and p.status = 'active'
$$;

create function authz.current_aal()
returns text
language sql
stable
set search_path = ''
as $$
  select case when auth.jwt() ->> 'aal' = 'aal2' then 'aal2' else 'aal1' end
$$;

-- -----------------------------------------------------------------------------
-- Capability resolution
-- -----------------------------------------------------------------------------
-- Effective capabilities of a profile in an organisation, IGNORING session
-- assurance. Requires: active profile, active organisation, active membership,
-- unrevoked role assignment.
create function internal.profile_capabilities(p_profile_id uuid, p_organisation_id uuid)
returns table (capability_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct rc.capability_key
  from public.organisation_memberships m
  join public.profiles p
    on p.id = m.profile_id and p.status = 'active'
  join public.organisations o
    on o.id = m.organisation_id and o.status = 'active'
  join public.membership_roles mr
    on mr.membership_id = m.id and mr.revoked_at is null
  join public.role_capabilities rc
    on rc.role_key = mr.role_key
  where m.profile_id = p_profile_id
    and m.organisation_id = p_organisation_id
    and m.status = 'active'
$$;

create function authz.has_capability(p_organisation_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from internal.profile_capabilities(auth.uid(), p_organisation_id) held
    join public.capabilities c on c.key = held.capability_key
    where held.capability_key = p_capability
      and (not c.is_privileged or authz.current_aal() = 'aal2')
  )
$$;

create function authz.is_org_member(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organisation_memberships m
    join public.profiles p on p.id = m.profile_id and p.status = 'active'
    join public.organisations o on o.id = m.organisation_id and o.status <> 'archived'
    where m.organisation_id = p_organisation_id
      and m.profile_id = auth.uid()
      and m.status = 'active'
  )
$$;

create function authz.is_own_membership(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organisation_memberships m
    where m.id = p_membership_id
      and m.profile_id = auth.uid()
  )
$$;

create function authz.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id = auth.uid()
    or exists (
      select 1
      from public.organisation_memberships target
      where target.profile_id = p_profile_id
        and authz.has_capability(target.organisation_id, 'membership.view')
    )
$$;

create function authz.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select authz.current_aal() = 'aal2'
    and exists (
      select 1
      from public.platform_admins pa
      join public.profiles p on p.id = pa.profile_id and p.status = 'active'
      where pa.profile_id = auth.uid()
        and pa.revoked_at is null
    )
$$;

-- -----------------------------------------------------------------------------
-- Guards used inside RPCs
-- -----------------------------------------------------------------------------
create function internal.require_identity()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := authz.current_profile_id();
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = 'CH401';
  end if;
  return v_profile_id;
end;
$$;

create function internal.require_capability(p_organisation_id uuid, p_capability text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_organisation_id is not null and authz.has_capability(p_organisation_id, p_capability) then
    return;
  end if;

  -- Held, but the session is not AAL2: ask for step-up rather than deny.
  if p_organisation_id is not null and exists (
    select 1 from internal.profile_capabilities(auth.uid(), p_organisation_id) held
    where held.capability_key = p_capability
  ) then
    raise exception 'multi-factor authentication required' using errcode = 'CH402';
  end if;

  -- Identical for "organisation does not exist" and "not permitted": no oracle.
  raise exception 'not permitted' using errcode = 'CH403';
end;
$$;

create function internal.require_platform_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
begin
  if authz.is_platform_admin() then
    return v_profile_id;
  end if;

  if exists (
    select 1 from public.platform_admins pa
    where pa.profile_id = v_profile_id and pa.revoked_at is null
  ) then
    raise exception 'multi-factor authentication required' using errcode = 'CH402';
  end if;

  raise exception 'not permitted' using errcode = 'CH403';
end;
$$;

-- A role may be granted/revoked/offered only if every capability it confers is
-- one the caller already holds in that organisation (no escalation).
create function internal.role_within_ceiling(p_organisation_id uuid, p_role_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select rc.capability_key
    from public.role_capabilities rc
    where rc.role_key = p_role_key
    except
    select held.capability_key
    from internal.profile_capabilities(auth.uid(), p_organisation_id) held
  )
$$;

-- A membership may be managed only if the target holds nothing the caller lacks.
create function internal.membership_within_ceiling(p_organisation_id uuid, p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select rc.capability_key
    from public.membership_roles mr
    join public.role_capabilities rc on rc.role_key = mr.role_key
    where mr.membership_id = p_membership_id
      and mr.organisation_id = p_organisation_id
      and mr.revoked_at is null
    except
    select held.capability_key
    from internal.profile_capabilities(auth.uid(), p_organisation_id) held
  )
$$;

create function internal.assert_owner_remains(p_organisation_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.organisation_memberships m
    where m.organisation_id = p_organisation_id
      and exists (
        select 1 from internal.profile_capabilities(m.profile_id, p_organisation_id) held
        where held.capability_key = 'organisation.manage'
      )
  ) then
    raise exception 'organisation must retain at least one administrator' using errcode = 'CH409';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants: revoke-by-default, then grant only policy helpers to authenticated.
-- -----------------------------------------------------------------------------
revoke all on all functions in schema authz from public, anon, authenticated;
revoke all on all functions in schema internal from public, anon, authenticated;

grant execute on function
  authz.current_profile_id(),
  authz.current_aal(),
  authz.has_capability(uuid, text),
  authz.is_org_member(uuid),
  authz.is_own_membership(uuid),
  authz.can_view_profile(uuid),
  authz.is_platform_admin()
to authenticated;

-- -----------------------------------------------------------------------------
-- RLS policies (all tables have RLS enabled; nothing is granted to anon)
-- -----------------------------------------------------------------------------

-- profiles: self, or co-members visible to membership.view holders.
create policy profiles_select on public.profiles
  for select to authenticated
  using (authz.can_view_profile(id));

-- Only the display name is column-granted; this restricts it to one's own row.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- organisations: visible to active members only. Platform admins use RPCs.
create policy organisations_select on public.organisations
  for select to authenticated
  using (authz.is_org_member(id));

-- memberships: one's own, or all in an org where the caller holds membership.view.
create policy organisation_memberships_select on public.organisation_memberships
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or authz.has_capability(organisation_id, 'membership.view')
  );

-- role assignments: one's own, or all in an org where the caller holds membership.view.
create policy membership_roles_select on public.membership_roles
  for select to authenticated
  using (
    authz.is_own_membership(membership_id)
    or authz.has_capability(organisation_id, 'membership.view')
  );

-- reference data
create policy capabilities_select on public.capabilities
  for select to authenticated using (true);
create policy roles_select on public.roles
  for select to authenticated using (true);
create policy role_capabilities_select on public.role_capabilities
  for select to authenticated using (true);

-- platform_admins: only one's own grant rows.
create policy platform_admins_select_self on public.platform_admins
  for select to authenticated
  using (profile_id = (select auth.uid()));

-- audit: one's own actions, or an organisation's history with audit.view (AAL2).
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (
    actor_profile_id = (select auth.uid())
    or (organisation_id is not null and authz.has_capability(organisation_id, 'audit.view'))
  );
