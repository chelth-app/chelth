-- =============================================================================
-- Migration: locale_and_display_timezone
-- Stage:     P0-E9-3F (localization, timezone default)
--
-- Purpose
--   1. Presentation locale (spelling / terminology only — never identifiers):
--      - organisations.locale: the workspace's configured locale; it governs
--        workspace surfaces (organisation.manage, AAL2, audited).
--      - profiles.locale: the person's own preference for personal surfaces.
--      Supported now: en-US, en-GB. NULL ⇒ the documented fallback chain
--      (src/lib/i18n/terminology.ts).
--   2. Personal DISPLAY timezone on profiles:
--      - timezone_mode 'automatic' (default) follows the device; 'manual'
--        keeps an explicitly chosen zone and is never overwritten by a device.
--      - timezone: a valid IANA name (pg_timezone_names), or NULL until first
--        detection.
--      DISPLAY ONLY. Shift, facility and attendance times remain in the
--      facility / shift timezone; nothing here changes operational truth.
--
--   Pricing: no schema change. "Exact minutes" is the existing versioned
--   rounding policy mode 'none' (see the P0-E9-3F report).
-- =============================================================================

create function internal.is_supported_locale(p_locale text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_locale in ('en-US', 'en-GB')
$$;

create function internal.is_valid_timezone(p_timezone text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_timezone is not null
     and char_length(p_timezone) between 1 and 64
     and p_timezone !~ '^(posix|right)/'
     and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone)
$$;

alter table public.organisations
  add column locale text check (locale is null or locale in ('en-US', 'en-GB'));

create type public.timezone_mode as enum ('automatic', 'manual');

alter table public.profiles
  add column locale text check (locale is null or locale in ('en-US', 'en-GB')),
  add column timezone_mode public.timezone_mode not null default 'automatic',
  add column timezone text check (timezone is null or char_length(timezone) between 1 and 64);

comment on column public.profiles.timezone is
  'Personal DISPLAY timezone (IANA). Never used for shift, attendance or pricing dates.';

-- The column CHECKs are inlined (no function call) so ordinary column writes
-- by roles without access to internal.* keep working.

-- Workspace locale (organisation.manage is privileged ⇒ AAL2).
create function public.set_organisation_locale(p_organisation_id uuid, p_locale text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  perform internal.require_identity();
  perform internal.require_capability(p_organisation_id, 'organisation.manage');
  if p_locale is not null and not internal.is_supported_locale(p_locale) then
    raise exception 'unsupported locale' using errcode = 'CH400';
  end if;
  select o.locale into v_old from public.organisations o where o.id = p_organisation_id for update;
  update public.organisations o set locale = p_locale where o.id = p_organisation_id;
  perform internal.record_audit_event('organisation.locale_updated', p_organisation_id, 'organisation',
    p_organisation_id, jsonb_build_object('from', v_old, 'to', p_locale));
end;
$$;

-- Own display preferences (no capability: a person's own profile only).
create function public.set_my_display_preferences(
  p_timezone_mode public.timezone_mode,
  p_locale text default null,
  p_timezone text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
begin
  if p_locale is not null and not internal.is_supported_locale(p_locale) then
    raise exception 'unsupported locale' using errcode = 'CH400';
  end if;
  if p_timezone_mode is null
     or (p_timezone_mode = 'manual' and not internal.is_valid_timezone(p_timezone))
     or (p_timezone is not null and not internal.is_valid_timezone(p_timezone)) then
    raise exception 'invalid timezone' using errcode = 'CH400';
  end if;
  update public.profiles p
     set locale = p_locale,
         timezone_mode = p_timezone_mode,
         timezone = coalesce(p_timezone, p.timezone)
   where p.id = v_profile_id;
end;
$$;

-- Device detection: applies ONLY in automatic mode; a manual choice is never
-- overwritten. An invalid zone is ignored (returns false), never stored.
create function public.sync_my_device_timezone(p_timezone text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_count integer;
begin
  if not internal.is_valid_timezone(p_timezone) then
    return false;
  end if;
  update public.profiles p
     set timezone = p_timezone
   where p.id = v_profile_id
     and p.timezone_mode = 'automatic'
     and p.timezone is distinct from p_timezone;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function internal.is_supported_locale(text), internal.is_valid_timezone(text)
  from public, anon, authenticated, service_role;
revoke all on function
  public.set_organisation_locale(uuid, text),
  public.set_my_display_preferences(public.timezone_mode, text, text),
  public.sync_my_device_timezone(text)
from public, anon;
grant execute on function
  public.set_organisation_locale(uuid, text),
  public.set_my_display_preferences(public.timezone_mode, text, text),
  public.sync_my_device_timezone(text)
to authenticated;
