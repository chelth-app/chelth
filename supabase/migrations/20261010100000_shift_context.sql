-- =============================================================================
-- Migration: shift_context
-- Stage:     P0-E9-3D-S2 (designed in docs/reports/P0-E9-3D-S1-data-architecture-audit.txt)
--
-- Purpose
--   Real operational context for the worker's shift, with no duplicated truth:
--   - agency_facilities: facility-default parking and arrival guidance, an
--     opt-in worker-facing ROLE / DESK contact (label + business phone; no
--     personal names — FACILITY_DOMAIN_MODEL §2), and an optional image;
--   - shifts: an optional unit / department label (departments as an entity
--     stay deferred);
--   - a private facility-images bucket (agency facility.manage writes; agency
--     facility.view and workers with an active assignment there read);
--   - list_my_shift_assignments: the context, returned only while the
--     assignment is active (the existing instructions rule).
--
-- Everything is nullable / additive; existing rows and callers are unaffected.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------
alter table public.agency_facilities
  add column parking_instructions text
    check (parking_instructions is null
           or (char_length(btrim(parking_instructions)) between 1 and 500
               and parking_instructions !~ '[\x01-\x09\x0b-\x1f\x7f]')),
  add column arrival_instructions text
    check (arrival_instructions is null
           or (char_length(btrim(arrival_instructions)) between 1 and 500
               and arrival_instructions !~ '[\x01-\x09\x0b-\x1f\x7f]')),
  add column worker_contact_label text
    check (worker_contact_label is null
           or (char_length(btrim(worker_contact_label)) between 2 and 80
               and worker_contact_label !~ '[[:cntrl:]]')),
  add column worker_contact_phone text
    check (worker_contact_phone is null or worker_contact_phone ~ '^\+?[0-9 ()-]{6,20}$'),
  add column image_path text unique
    check (image_path is null or image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  add column image_updated_at timestamptz,
  add constraint agency_facilities_worker_contact_pair
    check ((worker_contact_label is null) = (worker_contact_phone is null)),
  add constraint agency_facilities_image_path_owner
    check (image_path is null
           or image_path like agency_organisation_id::text || '/' || id::text || '/%');

comment on column public.agency_facilities.worker_contact_label is
  'Worker-facing ROLE or DESK contact (e.g. "Nursing supervisor desk"). Opt-in; shown to workers with an active assignment here. Not a personal contact.';
comment on column public.agency_facilities.parking_instructions is
  'Facility-default parking guidance for assigned workers. Shift instructions are the per-shift override.';

alter table public.shifts
  add column unit_label text
    check (unit_label is null
           or (char_length(btrim(unit_label)) between 1 and 80 and unit_label !~ '[[:cntrl:]]'));

comment on column public.shifts.unit_label is
  'Optional unit / department for the shift (e.g. ICU, Ward 3). Free label until departments exist.';

-- -----------------------------------------------------------------------------
-- Authorisation helpers
-- -----------------------------------------------------------------------------
-- The caller is an active worker with an active assignment at this facility.
create function authz.has_active_assignment_at_facility(p_agency_facility_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
    where s.agency_facility_id = p_agency_facility_id
      and a.profile_id = auth.uid()
      and a.status in ('assigned', 'accepted')
      and s.status = 'open'
      and authz.is_own_active_worker(a.agency_worker_id)
  )
$$;

-- "<agency>/<facility>/<object>" for an existing facility of that agency.
create function internal.facility_image_owner(p_object_name text)
returns public.agency_facilities
language sql
stable
security definer
set search_path = ''
as $$
  select f.*
  from public.agency_facilities f
  where p_object_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$'
    and f.agency_organisation_id = split_part(p_object_name, '/', 1)::uuid
    and f.id = split_part(p_object_name, '/', 2)::uuid
$$;

create function authz.can_write_facility_image(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from internal.facility_image_owner(p_object_name) f
    where f.id is not null
      and f.status <> 'archived'
      and authz.has_capability(f.agency_organisation_id, 'facility.manage')
  )
$$;

create function authz.can_read_facility_image(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from internal.facility_image_owner(p_object_name) f
    where f.id is not null
      and (
        authz.has_capability(f.agency_organisation_id, 'facility.view')
        or (f.image_path = p_object_name and authz.has_active_assignment_at_facility(f.id))
      )
  )
$$;

revoke all on function
  authz.has_active_assignment_at_facility(uuid),
  authz.can_write_facility_image(text),
  authz.can_read_facility_image(text)
from public, anon;
grant execute on function
  authz.has_active_assignment_at_facility(uuid),
  authz.can_write_facility_image(text),
  authz.can_read_facility_image(text)
to authenticated;
revoke all on function internal.facility_image_owner(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Storage: private facility images (JPEG / PNG, 2 MB)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('facility-images', 'facility-images', false, 2097152, array['image/jpeg', 'image/png']);

create policy facility_images_read on storage.objects
  for select to authenticated
  using (bucket_id = 'facility-images' and authz.can_read_facility_image(name));

create policy facility_images_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'facility-images' and authz.can_write_facility_image(name));

-- Replaced images are removed by the same managers; there is no in-place update.
create policy facility_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'facility-images' and authz.can_write_facility_image(name));

-- -----------------------------------------------------------------------------
-- Agency RPCs
-- -----------------------------------------------------------------------------
create function public.update_facility_worker_context(
  p_facility_id uuid,
  p_parking_instructions text,
  p_arrival_instructions text,
  p_worker_contact_label text,
  p_worker_contact_phone text
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
  if (internal.clean_text(p_worker_contact_label) is null) <> (internal.clean_text(p_worker_contact_phone) is null) then
    raise exception 'a worker contact needs both a label and a phone number' using errcode = 'CH400';
  end if;

  update public.agency_facilities f
     set parking_instructions = internal.clean_text(p_parking_instructions),
         arrival_instructions = internal.clean_text(p_arrival_instructions),
         worker_contact_label = internal.clean_text(p_worker_contact_label),
         worker_contact_phone = internal.clean_text(p_worker_contact_phone)
   where f.id = p_facility_id
  returning * into v_new;

  -- Audit lists WHICH fields changed, never their values.
  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_changed
  from jsonb_each(to_jsonb(v_new)) n
  where n.key in ('parking_instructions', 'arrival_instructions', 'worker_contact_label', 'worker_contact_phone')
    and n.value is distinct from (to_jsonb(v_old) -> n.key);
  if jsonb_array_length(v_changed) > 0 then
    perform internal.record_audit_event('facility.updated', v_old.agency_organisation_id,
      'facility', p_facility_id, jsonb_build_object('fields', v_changed));
  end if;
end;
$$;

-- Points the facility at an uploaded image (or clears it). Returns the
-- previous object so the caller can remove it.
create function public.set_facility_image(p_facility_id uuid, p_image_path text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.agency_facilities;
begin
  perform internal.require_identity();
  select * into v_old from public.agency_facilities f where f.id = p_facility_id for update;
  perform internal.require_capability(v_old.agency_organisation_id, 'facility.manage');
  if v_old.status = 'archived' then
    raise exception 'archived facilities are read-only' using errcode = 'CHF09';
  end if;
  if p_image_path is not null and not (
    p_image_path like v_old.agency_organisation_id::text || '/' || v_old.id::text || '/%'
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'facility-images' and o.name = p_image_path
    )
  ) then
    raise exception 'image not found' using errcode = 'CH400';
  end if;

  update public.agency_facilities f
     set image_path = p_image_path, image_updated_at = now()
   where f.id = p_facility_id;
  perform internal.record_audit_event('facility.image_updated', v_old.agency_organisation_id,
    'facility', p_facility_id, jsonb_build_object('present', p_image_path is not null));
  return v_old.image_path;
end;
$$;

create function public.set_shift_unit(p_shift_id uuid, p_unit_label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts := internal.agency_shift(p_shift_id, 'shift.manage', true);
begin
  if s.status in ('cancelled', 'completed') then
    raise exception 'shift is closed' using errcode = 'CHS09';
  end if;
  if internal.clean_text(p_unit_label) is not distinct from s.unit_label then
    return;
  end if;
  update public.shifts x set unit_label = internal.clean_text(p_unit_label), updated_at = now()
   where x.id = s.id;
  perform internal.record_audit_event('shift.updated', s.agency_organisation_id, 'shift', s.id,
    jsonb_build_object('fields', jsonb_build_array('unit_label')));
end;
$$;

revoke all on function
  public.update_facility_worker_context(uuid, text, text, text, text),
  public.set_facility_image(uuid, text),
  public.set_shift_unit(uuid, text)
from public, anon;
grant execute on function
  public.update_facility_worker_context(uuid, text, text, text, text),
  public.set_facility_image(uuid, text),
  public.set_shift_unit(uuid, text)
to authenticated;

-- -----------------------------------------------------------------------------
-- Worker projection: same name and argument, with shift context.
-- Context is returned only while the assignment is active (assigned or
-- accepted on an open shift), exactly like the existing instructions.
-- -----------------------------------------------------------------------------
drop function public.list_my_shift_assignments(uuid);

create function public.list_my_shift_assignments(p_organisation_id uuid)
returns table (
  assignment_id uuid,
  shift_id uuid,
  agency_facility_id uuid,
  facility_name text,
  location_name text,
  discipline_name text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  local_date date,
  status public.assignment_status,
  shift_status public.shift_status,
  instructions text,
  cancellation_reason public.assignment_cancellation_reason,
  assigned_at timestamptz,
  accepted_at timestamptz,
  can_respond boolean,
  unit_label text,
  address_line1 text,
  address_line2 text,
  locality text,
  region text,
  postal_code text,
  country_code text,
  parking_instructions text,
  arrival_instructions text,
  worker_contact_label text,
  worker_contact_phone text,
  image_path text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform internal.require_identity();
  return query
    with rows as (
      select a.*, s.id as s_id, s.status as s_status, s.instructions as s_instructions,
             s.start_at as s_start, s.end_at as s_end, s.timezone as s_tz, s.unit_label as s_unit,
             f.id as f_id, f.name as f_name, l.name as l_name, d.name as d_name,
             -- The location's own address when it has one, otherwise the facility's.
             (l.address_line1 is not null) as use_location,
             l.address_line1 as l_line1, l.locality as l_locality, l.postal_code as l_postal,
             f.address_line1 as f_line1, f.address_line2 as f_line2, f.locality as f_locality,
             f.region as f_region, f.postal_code as f_postal, f.country_code as f_country,
             f.parking_instructions as f_parking, f.arrival_instructions as f_arrival,
             f.worker_contact_label as f_contact_label, f.worker_contact_phone as f_contact_phone,
             f.image_path as f_image,
             (a.status in ('assigned', 'accepted') and s.status = 'open') as active
      from public.shift_assignments a
      join public.shifts s on s.id = a.shift_id
      join public.agency_facilities f on f.id = s.agency_facility_id
      join public.facility_locations l on l.id = s.facility_location_id
      join public.disciplines d on d.key = s.discipline_key
      where a.agency_organisation_id = p_organisation_id
        and authz.is_own_active_worker(a.agency_worker_id)
    )
    select r.id, r.s_id, r.f_id, r.f_name, r.l_name, r.d_name, r.s_start, r.s_end, r.s_tz,
           (r.s_start at time zone r.s_tz)::date,
           r.status, r.s_status,
           case when r.active then r.s_instructions end,
           r.cancellation_reason, r.assigned_at, r.accepted_at,
           r.status = 'assigned' and r.s_status = 'open' and r.s_end > now(),
           r.s_unit,
           case when r.active then case when r.use_location then r.l_line1 else r.f_line1 end end,
           case when r.active and not r.use_location then r.f_line2 end,
           case when r.active then case when r.use_location then coalesce(r.l_locality, r.f_locality) else r.f_locality end end,
           case when r.active then r.f_region end,
           case when r.active then case when r.use_location then coalesce(r.l_postal, r.f_postal) else r.f_postal end end,
           case when r.active then r.f_country end,
           case when r.active then r.f_parking end,
           case when r.active then r.f_arrival end,
           case when r.active then r.f_contact_label end,
           case when r.active then r.f_contact_phone end,
           case when r.active then r.f_image end
    from rows r
    order by r.s_start desc, r.id
    limit 500;
end;
$$;

revoke all on function public.list_my_shift_assignments(uuid) from public, anon;
grant execute on function public.list_my_shift_assignments(uuid) to authenticated;
