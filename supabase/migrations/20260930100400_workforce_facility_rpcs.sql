-- =============================================================================
-- Migration: workforce_facility_rpcs
-- Stage:     P0-E3-S3
--
-- Purpose
--   The ONLY write paths for workers, notes, facilities, locations and
--   relationships. Every RPC: requires an active identity; derives the
--   organisation from the target row (or checks the one named); requires a
--   capability there (CH402 step-up / CH403); refuses changes to one's own
--   worker record; enforces lifecycle rules; writes audit events whose
--   metadata holds identifiers and change codes only (never note bodies,
--   contact details or addresses).
--
-- Error codes: CHW09 invalid worker state · CHR09 invalid relationship state
--   CHF09 invalid facility state · CHF04 facility not found (after authz)
--   CH400 validation · CH402 step-up · CH403 forbidden
--
-- Verified by: supabase/tests/security/070_*.test.sql, 080_*.test.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Workers
-- -----------------------------------------------------------------------------
create function public.set_agency_worker_status(p_worker_id uuid, p_status public.worker_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_worker public.agency_workers;
begin
  select * into v_worker from public.agency_workers w where w.id = p_worker_id for update;

  perform internal.require_capability(v_worker.agency_organisation_id, 'worker.manage');

  if v_worker.profile_id = v_profile_id then
    raise exception 'you cannot change your own worker record' using errcode = 'CH403';
  end if;

  if not (
    (v_worker.status = 'onboarding' and p_status in ('active', 'terminated'))
    or (v_worker.status = 'active' and p_status in ('inactive', 'suspended', 'terminated'))
    or (v_worker.status = 'inactive' and p_status in ('active', 'suspended', 'terminated'))
    or (v_worker.status = 'suspended' and p_status in ('active', 'inactive', 'terminated'))
  ) then
    raise exception 'worker status change not allowed' using errcode = 'CHW09';
  end if;

  update public.agency_workers w
     set status = p_status,
         status_changed_at = now(),
         start_date = case when p_status = 'active' then coalesce(w.start_date, current_date) else w.start_date end,
         end_date = case when p_status = 'terminated' then current_date else w.end_date end
   where w.id = p_worker_id;

  perform internal.record_audit_event('worker.status_changed', v_worker.agency_organisation_id,
    'worker', p_worker_id, jsonb_build_object('from', v_worker.status, 'to', p_status));
end;
$$;

create function public.update_agency_worker(p_worker_id uuid, p_worker_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_worker public.agency_workers;
  v_reference text := nullif(btrim(p_worker_reference), '');
begin
  select * into v_worker from public.agency_workers w where w.id = p_worker_id for update;

  perform internal.require_capability(v_worker.agency_organisation_id, 'worker.manage');

  if v_worker.profile_id = v_profile_id then
    raise exception 'you cannot change your own worker record' using errcode = 'CH403';
  end if;
  if v_worker.status = 'terminated' then
    raise exception 'terminated worker records are read-only' using errcode = 'CHW09';
  end if;

  if v_reference is distinct from v_worker.worker_reference then
    update public.agency_workers w set worker_reference = v_reference where w.id = p_worker_id;
    perform internal.record_audit_event('worker.updated', v_worker.agency_organisation_id,
      'worker', p_worker_id, jsonb_build_object('fields', jsonb_build_array('worker_reference')));
  end if;
end;
$$;

create function public.add_agency_worker_note(p_worker_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_worker public.agency_workers;
  v_note_id uuid;
begin
  select * into v_worker from public.agency_workers w where w.id = p_worker_id;

  perform internal.require_capability(v_worker.agency_organisation_id, 'worker.notes.manage');

  if v_worker.profile_id = v_profile_id then
    raise exception 'you cannot add notes to your own worker record' using errcode = 'CH403';
  end if;

  insert into public.agency_worker_notes as n (agency_organisation_id, worker_id, author_profile_id, body)
  values (v_worker.agency_organisation_id, p_worker_id, v_profile_id, btrim(p_body))
  returning n.id into v_note_id;

  -- The note body is never copied into audit metadata.
  perform internal.record_audit_event('worker.note_added', v_worker.agency_organisation_id,
    'worker', p_worker_id, jsonb_build_object('note_id', v_note_id));

  return v_note_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Client facilities
-- -----------------------------------------------------------------------------
create function internal.require_valid_timezone(p_timezone text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_timezone is null
     or p_timezone ~ '^(posix|right)/'
     or not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_timezone) then
    raise exception 'invalid timezone' using errcode = 'CH400';
  end if;
end;
$$;

create function public.create_agency_facility(
  p_agency_organisation_id uuid,
  p_name text,
  p_facility_type text,
  p_timezone text,
  p_phone text default null,
  p_email text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_locality text default null,
  p_region text default null,
  p_postal_code text default null,
  p_country_code text default null,
  p_external_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_facility_id uuid;
begin
  perform internal.require_capability(p_agency_organisation_id, 'facility.manage');

  if not exists (
    select 1 from public.organisations o where o.id = p_agency_organisation_id and o.type = 'agency'
  ) then
    raise exception 'client facilities belong to agencies' using errcode = 'CH400';
  end if;
  if not exists (select 1 from public.facility_types t where t.key = p_facility_type and t.is_active) then
    raise exception 'unknown facility type' using errcode = 'CH400';
  end if;
  perform internal.require_valid_timezone(p_timezone);

  if not internal.consume_rate_limit('facility.create:' || p_agency_organisation_id, 200, interval '1 day') then
    raise exception 'too many facilities created' using errcode = 'CH429';
  end if;

  insert into public.agency_facilities as f (
    agency_organisation_id, name, facility_type_key, timezone, phone, email,
    address_line1, address_line2, locality, region, postal_code, country_code,
    external_reference, created_by_profile_id
  ) values (
    p_agency_organisation_id, btrim(p_name), p_facility_type, p_timezone,
    nullif(btrim(p_phone), ''), lower(nullif(btrim(p_email), '')),
    nullif(btrim(p_address_line1), ''), nullif(btrim(p_address_line2), ''),
    nullif(btrim(p_locality), ''), nullif(btrim(p_region), ''),
    nullif(btrim(p_postal_code), ''), upper(nullif(btrim(p_country_code), '')),
    nullif(btrim(p_external_reference), ''), v_profile_id
  )
  returning f.id into v_facility_id;

  perform internal.record_audit_event('facility.created', p_agency_organisation_id,
    'facility', v_facility_id, jsonb_build_object('facility_type', p_facility_type));

  return v_facility_id;
end;
$$;

create function public.update_agency_facility(
  p_facility_id uuid,
  p_name text,
  p_facility_type text,
  p_timezone text,
  p_phone text default null,
  p_email text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_locality text default null,
  p_region text default null,
  p_postal_code text default null,
  p_country_code text default null,
  p_external_reference text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.agency_facilities;
  v_new public.agency_facilities;
  v_changed jsonb;
begin
  perform internal.require_identity();
  select * into v_old from public.agency_facilities f where f.id = p_facility_id for update;

  perform internal.require_capability(v_old.agency_organisation_id, 'facility.manage');

  if v_old.status = 'archived' then
    raise exception 'archived facilities are read-only' using errcode = 'CHF09';
  end if;
  if not exists (select 1 from public.facility_types t where t.key = p_facility_type and t.is_active) then
    raise exception 'unknown facility type' using errcode = 'CH400';
  end if;
  perform internal.require_valid_timezone(p_timezone);

  update public.agency_facilities f
     set name = btrim(p_name),
         facility_type_key = p_facility_type,
         timezone = p_timezone,
         phone = nullif(btrim(p_phone), ''),
         email = lower(nullif(btrim(p_email), '')),
         address_line1 = nullif(btrim(p_address_line1), ''),
         address_line2 = nullif(btrim(p_address_line2), ''),
         locality = nullif(btrim(p_locality), ''),
         region = nullif(btrim(p_region), ''),
         postal_code = nullif(btrim(p_postal_code), ''),
         country_code = upper(nullif(btrim(p_country_code), '')),
         external_reference = nullif(btrim(p_external_reference), '')
   where f.id = p_facility_id
  returning * into v_new;

  -- Audit lists WHICH fields changed, never their values.
  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_changed
  from jsonb_each(to_jsonb(v_new)) n
  where n.key not in ('updated_at')
    and n.value is distinct from (to_jsonb(v_old) -> n.key);

  if jsonb_array_length(v_changed) > 0 then
    perform internal.record_audit_event('facility.updated', v_old.agency_organisation_id,
      'facility', p_facility_id, jsonb_build_object('fields', v_changed));
  end if;
end;
$$;

create function public.set_agency_facility_status(p_facility_id uuid, p_status public.facility_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facility public.agency_facilities;
begin
  perform internal.require_identity();
  select * into v_facility from public.agency_facilities f where f.id = p_facility_id for update;

  perform internal.require_capability(v_facility.agency_organisation_id, 'facility.manage');

  if not (
    (v_facility.status = 'active' and p_status in ('inactive', 'archived'))
    or (v_facility.status = 'inactive' and p_status in ('active', 'archived'))
  ) then
    raise exception 'facility status change not allowed' using errcode = 'CHF09';
  end if;

  if p_status = 'archived' and exists (
    select 1 from public.agency_facility_relationships r
    where r.agency_facility_id = p_facility_id and r.status <> 'ended'
  ) then
    raise exception 'end the relationship before archiving the facility' using errcode = 'CHF09';
  end if;

  update public.agency_facilities f set status = p_status where f.id = p_facility_id;

  perform internal.record_audit_event('facility.status_changed', v_facility.agency_organisation_id,
    'facility', p_facility_id, jsonb_build_object('from', v_facility.status, 'to', p_status));
end;
$$;

create function public.create_facility_location(
  p_facility_id uuid,
  p_name text,
  p_timezone text default null,
  p_address_line1 text default null,
  p_locality text default null,
  p_postal_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facility public.agency_facilities;
  v_timezone text;
  v_location_id uuid;
begin
  perform internal.require_identity();
  select * into v_facility from public.agency_facilities f where f.id = p_facility_id;

  perform internal.require_capability(v_facility.agency_organisation_id, 'facility.manage');

  if v_facility.status = 'archived' then
    raise exception 'archived facilities are read-only' using errcode = 'CHF09';
  end if;

  -- Explicit timezone: inherit the facility's only when none is given.
  v_timezone := coalesce(nullif(btrim(p_timezone), ''), v_facility.timezone);
  perform internal.require_valid_timezone(v_timezone);

  insert into public.facility_locations as l
    (agency_organisation_id, agency_facility_id, name, timezone, address_line1, locality, postal_code)
  values
    (v_facility.agency_organisation_id, p_facility_id, btrim(p_name), v_timezone,
     nullif(btrim(p_address_line1), ''), nullif(btrim(p_locality), ''), nullif(btrim(p_postal_code), ''))
  returning l.id into v_location_id;

  perform internal.record_audit_event('facility.location_created', v_facility.agency_organisation_id,
    'facility', p_facility_id, jsonb_build_object('location_id', v_location_id));

  return v_location_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Relationships
-- -----------------------------------------------------------------------------
create function public.create_facility_relationship(p_facility_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_facility public.agency_facilities;
  v_relationship_id uuid;
begin
  select * into v_facility from public.agency_facilities f where f.id = p_facility_id;

  perform internal.require_capability(v_facility.agency_organisation_id, 'relationship.manage');

  if v_facility.status <> 'active' then
    raise exception 'relationships require an active facility record' using errcode = 'CHF09';
  end if;

  insert into public.agency_facility_relationships as r
    (agency_organisation_id, agency_facility_id, created_by_profile_id)
  values (v_facility.agency_organisation_id, p_facility_id, v_profile_id)
  returning r.id into v_relationship_id;

  perform internal.record_audit_event('relationship.created', v_facility.agency_organisation_id,
    'relationship', v_relationship_id, jsonb_build_object('facility_id', p_facility_id));

  return v_relationship_id;
end;
$$;

create function public.set_facility_relationship_status(
  p_relationship_id uuid,
  p_status public.relationship_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_relationship public.agency_facility_relationships;
  v_linked_organisation_id uuid;
begin
  perform internal.require_identity();
  select * into v_relationship
  from public.agency_facility_relationships r
  where r.id = p_relationship_id
  for update;

  perform internal.require_capability(v_relationship.agency_organisation_id, 'relationship.manage');

  if not (
    (v_relationship.status = 'pending' and p_status in ('active', 'ended'))
    or (v_relationship.status = 'active' and p_status in ('suspended', 'ended'))
    or (v_relationship.status = 'suspended' and p_status in ('active', 'ended'))
  ) then
    raise exception 'relationship status change not allowed' using errcode = 'CHR09';
  end if;

  update public.agency_facility_relationships r
     set status = p_status,
         status_changed_at = now(),
         started_at = case when p_status = 'active' then coalesce(r.started_at, now()) else r.started_at end,
         ended_at = case when p_status = 'ended' then now() else r.ended_at end
   where r.id = p_relationship_id;

  perform internal.record_audit_event('relationship.status_changed', v_relationship.agency_organisation_id,
    'relationship', p_relationship_id, jsonb_build_object('from', v_relationship.status, 'to', p_status));

  -- A linked facility organisation sees changes to ITS relationship in its own audit.
  select f.linked_facility_organisation_id into v_linked_organisation_id
  from public.agency_facilities f
  where f.id = v_relationship.agency_facility_id;

  if v_linked_organisation_id is not null then
    perform internal.record_audit_event('relationship.status_changed', v_linked_organisation_id,
      'relationship', p_relationship_id, jsonb_build_object('from', v_relationship.status, 'to', p_status));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Verified linking of a client record to a facility organisation.
-- Today: platform-verified (AAL2, audited in both organisations). Planned:
-- two-party consent (docs/architecture/AGENCY_FACILITY_RELATIONSHIPS.md §5).
-- Never automatic, never by name/email matching.
-- -----------------------------------------------------------------------------
create function public.platform_link_agency_facility(
  p_agency_facility_id uuid,
  p_facility_organisation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facility public.agency_facilities;
begin
  perform internal.require_platform_admin();

  select * into v_facility from public.agency_facilities f where f.id = p_agency_facility_id for update;
  if not found then
    raise exception 'facility not found' using errcode = 'CHF04';
  end if;
  if v_facility.linked_facility_organisation_id is not null then
    raise exception 'facility is already linked' using errcode = 'CHF09';
  end if;
  if not exists (
    select 1 from public.organisations o
    where o.id = p_facility_organisation_id and o.type = 'facility' and o.status = 'active'
  ) then
    raise exception 'target must be an active facility organisation' using errcode = 'CH400';
  end if;

  update public.agency_facilities f
     set linked_facility_organisation_id = p_facility_organisation_id,
         linked_facility_organisation_type = 'facility'
   where f.id = p_agency_facility_id;

  perform internal.record_audit_event('facility.linked', v_facility.agency_organisation_id,
    'facility', p_agency_facility_id,
    jsonb_build_object('facility_organisation_id', p_facility_organisation_id, 'via', 'platform'));
  perform internal.record_audit_event('facility.linked', p_facility_organisation_id,
    'facility', p_agency_facility_id,
    jsonb_build_object('agency_organisation_id', v_facility.agency_organisation_id, 'via', 'platform'));
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function internal.require_valid_timezone(text) from public, anon, authenticated;

revoke all on function
  public.set_agency_worker_status(uuid, public.worker_status),
  public.update_agency_worker(uuid, text),
  public.add_agency_worker_note(uuid, text),
  public.create_agency_facility(uuid, text, text, text, text, text, text, text, text, text, text, text, text),
  public.update_agency_facility(uuid, text, text, text, text, text, text, text, text, text, text, text, text),
  public.set_agency_facility_status(uuid, public.facility_status),
  public.create_facility_location(uuid, text, text, text, text, text),
  public.create_facility_relationship(uuid),
  public.set_facility_relationship_status(uuid, public.relationship_status),
  public.platform_link_agency_facility(uuid, uuid)
from public, anon;

grant execute on function
  public.set_agency_worker_status(uuid, public.worker_status),
  public.update_agency_worker(uuid, text),
  public.add_agency_worker_note(uuid, text),
  public.create_agency_facility(uuid, text, text, text, text, text, text, text, text, text, text, text, text),
  public.update_agency_facility(uuid, text, text, text, text, text, text, text, text, text, text, text, text),
  public.set_agency_facility_status(uuid, public.facility_status),
  public.create_facility_location(uuid, text, text, text, text, text),
  public.create_facility_relationship(uuid),
  public.set_facility_relationship_status(uuid, public.relationship_status),
  public.platform_link_agency_facility(uuid, uuid)
to authenticated;
