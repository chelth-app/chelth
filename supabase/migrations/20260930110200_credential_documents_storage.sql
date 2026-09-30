-- =============================================================================
-- Migration: credential_documents_storage
-- Stage:     P0-E4-S1
--
-- Purpose
--   Private credential document storage with a trust (scan) gate.
--
--   Bucket `credential-documents`: PRIVATE, 10 MiB limit, PDF/JPEG/PNG only.
--   Object path (generated, no PII): {profile_id}/{credential_id}/{version_id}/{document_id}
--
--   Document trust states (document_status):
--     upload_pending  row created; signed upload URL issued; not yet uploaded
--     scanning        uploaded and content-checked; awaiting malware scan — NOT trusted
--     clean           scanner cleared it — the ONLY state usable as evidence or by reviewers
--     rejected        failed validation (type/content mismatch) — unusable
--     quarantined     scanner flagged it — unusable, not downloadable
--   Nothing in the API can set `clean`. Only internal.record_document_scan_result
--   (scanner / operator role) can, and there is no production scanner yet:
--   production uploads stay `scanning` until one is integrated
--   (docs/security/CREDENTIAL_DOCUMENT_SECURITY.md).
--
--   ONE helper, authz.can_read_credential_document, drives BOTH the table RLS
--   policy and the Storage policy, so table and Storage authorization cannot
--   diverge. Download access additionally goes through an audited RPC.
--
-- Verified by: supabase/tests/security/095_credential_documents.test.sql
-- =============================================================================

create type public.document_status as enum ('upload_pending', 'scanning', 'clean', 'rejected', 'quarantined');

create table public.credential_documents (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null,
  credential_version_id uuid not null,
  profile_id uuid not null,
  storage_path text generated always as (
    profile_id::text || '/' || credential_id::text || '/' || credential_version_id::text || '/' || id::text
  ) stored,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  declared_size_bytes integer not null check (declared_size_bytes between 1 and 10485760),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  status public.document_status not null default 'upload_pending',
  status_reason text check (status_reason is null or status_reason ~ '^[a-z_]{1,60}$'),
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (credential_version_id, credential_id, profile_id)
    references public.credential_versions (id, credential_id, profile_id) on delete restrict,
  unique (storage_path)
);

comment on table public.credential_documents is
  'Versioned credential evidence files. Only `clean` documents are trusted. Never deleted.';

create index credential_documents_version_idx on public.credential_documents (credential_version_id);

-- Trust-state machine + immutability.
create function internal.protect_credential_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'credential documents are never deleted' using errcode = 'CH409';
  end if;
  if new.id is distinct from old.id
     or new.credential_id is distinct from old.credential_id
     or new.credential_version_id is distinct from old.credential_version_id
     or new.profile_id is distinct from old.profile_id
     or new.mime_type is distinct from old.mime_type
     or new.declared_size_bytes is distinct from old.declared_size_bytes
     or new.created_at is distinct from old.created_at
     or (old.sha256 is not null and new.sha256 is distinct from old.sha256) then
    raise exception 'credential document evidence is immutable' using errcode = 'CH409';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'upload_pending' and new.status in ('scanning', 'rejected'))
    or (old.status = 'scanning' and new.status in ('clean', 'quarantined', 'rejected'))
  ) then
    raise exception 'invalid document status transition' using errcode = 'CH409';
  end if;
  new.status_changed_at := case when new.status is distinct from old.status then now() else old.status_changed_at end;
  return new;
end;
$$;

create trigger credential_documents_protect
  before update or delete on public.credential_documents
  for each row execute function internal.protect_credential_document();

-- -----------------------------------------------------------------------------
-- Single authorization source for documents (table AND Storage)
-- -----------------------------------------------------------------------------
-- Owner: own documents that are not rejected/quarantined (incl. pending, so the
-- server can verify uploaded content). Agency: CLEAN documents of credentials
-- actively shared with an agency where the caller holds credential.review (AAL2).
create function authz.can_read_credential_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.credential_documents d
    where d.id = p_document_id
      and (
        (d.profile_id = auth.uid() and d.status in ('upload_pending', 'scanning', 'clean'))
        or (d.status = 'clean' and authz.can_access_shared_credential(d.credential_id, 'credential.review'))
      )
  )
$$;

create function authz.can_read_credential_object(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.credential_documents d
    where d.storage_path = p_object_name
      and authz.can_read_credential_document(d.id)
  )
$$;

-- Upload only into a pending document row the caller owns.
create function authz.can_upload_credential_object(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.credential_documents d
    where d.storage_path = p_object_name
      and d.profile_id = auth.uid()
      and d.status = 'upload_pending'
  )
$$;

-- Owners may delete the stored object of a document rejected at validation.
create function authz.can_delete_credential_object(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.credential_documents d
    where d.storage_path = p_object_name
      and d.profile_id = auth.uid()
      and d.status = 'rejected'
  )
$$;

revoke all on function
  authz.can_read_credential_document(uuid),
  authz.can_read_credential_object(text),
  authz.can_upload_credential_object(text),
  authz.can_delete_credential_object(text)
from public, anon;
grant execute on function
  authz.can_read_credential_document(uuid),
  authz.can_read_credential_object(text),
  authz.can_upload_credential_object(text),
  authz.can_delete_credential_object(text)
to authenticated;
revoke all on function internal.protect_credential_document() from public, anon, authenticated;

alter table public.credential_documents enable row level security;
grant select on public.credential_documents to authenticated;

create policy credential_documents_select on public.credential_documents
  for select to authenticated
  using (authz.can_read_credential_document(id));

-- -----------------------------------------------------------------------------
-- Storage bucket + policies (mirror the table helper)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('credential-documents', 'credential-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png']);

create policy credential_documents_object_read on storage.objects
  for select to authenticated
  using (bucket_id = 'credential-documents' and authz.can_read_credential_object(name));

create policy credential_documents_object_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'credential-documents' and authz.can_upload_credential_object(name));

create policy credential_documents_object_delete_rejected on storage.objects
  for delete to authenticated
  using (bucket_id = 'credential-documents' and authz.can_delete_credential_object(name));
-- No UPDATE policy: stored evidence is never replaced in place (new versions instead).

-- -----------------------------------------------------------------------------
-- Upload lifecycle RPCs (owner)
-- -----------------------------------------------------------------------------
create function public.begin_credential_document_upload(
  p_credential_version_id uuid,
  p_mime_type text,
  p_size_bytes integer
)
returns table (document_id uuid, object_path text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  v_version public.credential_versions;
  v_document public.credential_documents;
begin
  select * into v_version from public.credential_versions v where v.id = p_credential_version_id for update;

  if v_version.id is null or v_version.profile_id <> v_profile_id then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  if v_version.status <> 'draft' then
    raise exception 'documents can only be added to draft versions' using errcode = 'CH409';
  end if;
  if (select count(*) from public.credential_documents d where d.credential_version_id = p_credential_version_id) >= 5 then
    raise exception 'too many documents for this version' using errcode = 'CH409';
  end if;
  if not internal.consume_rate_limit('credential.upload:' || v_profile_id, 50, interval '1 day') then
    raise exception 'too many uploads' using errcode = 'CH429';
  end if;

  insert into public.credential_documents as d
    (credential_id, credential_version_id, profile_id, mime_type, declared_size_bytes)
  values (v_version.credential_id, v_version.id, v_profile_id, p_mime_type, p_size_bytes)
  returning * into v_document;

  return query select v_document.id, v_document.storage_path;
end;
$$;

-- Called after the upload with the server's content check result. A document
-- that passes becomes `scanning` (still untrusted); nothing here can make it clean.
create function public.complete_credential_document_upload(
  p_document_id uuid,
  p_sha256 text,
  p_content_valid boolean
)
returns public.document_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := internal.require_identity();
  v_document public.credential_documents;
  v_status public.document_status;
begin
  select * into v_document from public.credential_documents d where d.id = p_document_id for update;
  if v_document.id is null or v_document.profile_id <> v_profile_id then
    raise exception 'not permitted' using errcode = 'CH403';
  end if;
  if v_document.status <> 'upload_pending' then
    raise exception 'upload already completed' using errcode = 'CH409';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'credential-documents' and o.name = v_document.storage_path
  ) then
    raise exception 'no uploaded file' using errcode = 'CH409';
  end if;

  v_status := case when p_content_valid then 'scanning'::public.document_status else 'rejected'::public.document_status end;

  update public.credential_documents d
     set status = v_status,
         status_reason = case when p_content_valid then null else 'content_type_mismatch' end,
         sha256 = case when p_content_valid then lower(p_sha256) else null end
   where d.id = p_document_id;

  perform internal.record_audit_event('credential.document_uploaded', null, 'credential', v_document.credential_id,
    jsonb_build_object('document_id', p_document_id, 'version_id', v_document.credential_version_id,
                       'status', v_status));
  return v_status;
end;
$$;

-- Scanner / operator only (no API role can execute).
create function internal.record_document_scan_result(p_document_id uuid, p_result public.document_status, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.credential_documents;
begin
  if p_result not in ('clean', 'quarantined', 'rejected') then
    raise exception 'scan result must be clean, quarantined or rejected' using errcode = 'CH400';
  end if;
  select * into v_document from public.credential_documents d where d.id = p_document_id for update;
  if v_document.id is null then
    raise exception 'document not found' using errcode = 'CH404';
  end if;
  update public.credential_documents d set status = p_result, status_reason = p_reason where d.id = p_document_id;
  perform internal.record_audit_event('credential.document_scanned', null, 'credential', v_document.credential_id,
    jsonb_build_object('document_id', p_document_id, 'result', p_result));
end;
$$;

-- -----------------------------------------------------------------------------
-- Audited access gate for downloads. Returns the object path when permitted;
-- the server then mints a short-lived signed URL (Storage re-checks the same
-- helper). Denials return no row so the denial audit event commits.
-- p_organisation_id: NULL for self-access, else the reviewing agency.
-- -----------------------------------------------------------------------------
create function public.authorize_credential_document_access(p_document_id uuid, p_organisation_id uuid default null)
returns table (object_path text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile_id uuid := internal.require_identity();
  v_document public.credential_documents;
  v_allowed boolean := false;
  v_audit_org uuid;
begin
  select * into v_document from public.credential_documents d where d.id = p_document_id;

  if v_document.id is not null then
    if p_organisation_id is null then
      v_allowed := v_document.profile_id = v_profile_id and v_document.status in ('scanning', 'clean');
    else
      v_allowed := v_document.status = 'clean'
        and authz.has_capability(p_organisation_id, 'credential.review')
        and exists (
          select 1 from public.credential_shares s
          join public.organisation_memberships m on m.id = s.membership_id and m.status = 'active'
          where s.credential_id = v_document.credential_id
            and s.agency_organisation_id = p_organisation_id
            and s.status = 'active'
        );
    end if;
  end if;

  -- Audit in the agency's history only when the caller belongs to it.
  v_audit_org := case when p_organisation_id is not null and authz.is_org_member(p_organisation_id)
                      then p_organisation_id end;

  if not v_allowed then
    perform internal.record_audit_event('credential.document_access_denied', v_audit_org, 'credential_document',
      p_document_id, '{}'::jsonb);
    return;
  end if;

  perform internal.record_audit_event('credential.document_accessed', v_audit_org, 'credential_document',
    p_document_id, jsonb_build_object('credential_id', v_document.credential_id,
                                      'purpose', case when p_organisation_id is null then 'self' else 'review' end));
  return query select v_document.storage_path;
end;
$$;

revoke all on function internal.record_document_scan_result(uuid, public.document_status, text)
from public, anon, authenticated;
revoke all on function
  public.begin_credential_document_upload(uuid, text, integer),
  public.complete_credential_document_upload(uuid, text, boolean),
  public.authorize_credential_document_access(uuid, uuid)
from public, anon;
grant execute on function
  public.begin_credential_document_upload(uuid, text, integer),
  public.complete_credential_document_upload(uuid, text, boolean),
  public.authorize_credential_document_access(uuid, uuid)
to authenticated;
