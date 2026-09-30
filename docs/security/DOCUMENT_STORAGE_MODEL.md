# Document Storage Model (design)

Status: P0-E3-S3 — **design only**. No bucket is created in this stage:
nothing yet needs one, and an unused bucket is attack surface. The pgTAP
baseline continues to assert that no public bucket exists.

This model governs credential documents (P0-E4+) and any other sensitive
worker or facility document.

## 1. Principles

1. **Private buckets only.** Workforce documents are never public, never
   served from a CDN URL without authorization.
2. **The database decides.** Storage policies call the same `authz` helpers
   as table RLS. A file is accessible only if its database metadata row is.
3. **Metadata first.** Every object has a `documents` row; objects without
   one are orphaned and swept.
4. **Versioned and append-only.** Replacing a document creates a new version;
   prior versions are retained per retention policy.
5. **Short-lived access.** Downloads use signed URLs (≤ 60 s) minted by a
   server action after an authorization check and an access audit event.

## 2. Buckets and paths

| Bucket                   | Contents                                           | Public |
| ------------------------ | -------------------------------------------------- | :----: |
| `worker-documents`       | credentials, right-to-work, training certificates  |   no   |
| `organisation-documents` | contracts, facility policies (relationship-scoped) |   no   |

Path convention (tenant-scoped, non-guessable, no PII in paths):

```
worker-documents/{agency_organisation_id}/{agency_worker_id}/{document_id}/{version}
organisation-documents/{organisation_id}/{relationship_id|_}/{document_id}/{version}
```

Worker-owned documents that a worker shares with several agencies will be
stored once under a person-scoped prefix (`person/{profile_id}/…`) with
explicit per-agency share rows, rather than copied per agency.

## 3. Metadata (future migration)

`documents` (id, owner scope ids, kind, status) and `document_versions`
(document_id, version, storage path, sha256, size, mime type, scan status,
uploaded_by, uploaded_at) — composite FKs to the owning worker/agency;
append-only versions; RLS via `authz.has_capability(org, 'credential.view')`
etc.

## 4. Upload pipeline

1. Server action authorises (`credential.manage` or worker self-upload) and
   creates a `document_versions` row in `pending_scan`.
2. Client uploads directly to Storage with a **signed upload URL** bound to
   that exact path.
3. Bucket limits: allowed MIME types (PDF, JPEG, PNG, HEIC) and max size
   (10 MB) enforced by bucket config AND re-checked server-side (magic bytes,
   not just extension).
4. Malware scanning (Edge Function or provider) sets `scan_status`
   `clean | infected`; only `clean` versions can be downloaded or marked
   verified. Infected objects are quarantined and removed.

## 5. Storage policies (shape)

```sql
create policy worker_documents_read on storage.objects for select to authenticated using (
  bucket_id = 'worker-documents'
  and exists (
    select 1 from public.document_versions v
    where v.storage_path = name and v.scan_status = 'clean'
      and authz.has_capability(v.agency_organisation_id, 'credential.view')
  )
);
```

Writes are via signed upload URLs only; no direct insert policy for
authenticated users.

## 6. Access auditing

Every signed-URL issuance writes an audit event (`document.accessed`,
document/version ids, purpose code) — never the URL. Facility-side access
(credential visibility for a placement) flows through the relationship rules
in CROSS_ORG_DATA_SHARING.md.

## 7. Retention and deletion

Retention periods per document kind (regulatory, per jurisdiction) are set
before credentials go live. Deletion is a recorded, authorised action;
metadata tombstones remain for audit.
