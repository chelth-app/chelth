# Credential Document Security

Status: P0-E4-S1 — implements [DOCUMENT_STORAGE_MODEL.md](DOCUMENT_STORAGE_MODEL.md).

## 1. Storage

| Property    | Implementation                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Bucket      | `credential-documents`, **private** (migration-created)                                                                         |
| Limits      | 10 MiB; `application/pdf`, `image/jpeg`, `image/png` (bucket config)                                                            |
| Path        | `{profile_id}/{credential_id}/{version_id}/{document_id}` — generated column, opaque UUIDs, no PII                              |
| Public URLs | never work (tested)                                                                                                             |
| Overwrite   | impossible: no UPDATE policy; new evidence = new version/document                                                               |
| Delete      | only an owner's **rejected** upload (Storage policy); raw SQL deletes are refused by Storage; cleared evidence is never deleted |

## 2. Upload pipeline

1. Server action validates name, declared MIME type, size and that the
   extension matches the type (`startUploadAction`).
2. RPC `begin_credential_document_upload` checks ownership, draft version,
   ≤ 5 documents, rate limit (50/day), MIME/size constraints → document row
   `upload_pending`.
3. Server mints a **signed upload URL** for exactly that path (Storage checks
   the insert policy: pending row owned by the caller).
4. The browser uploads directly to Storage (no file passes through Vercel).
5. `completeUploadAction` downloads the stored object **as the user** and
   checks actual size = declared size ≤ 10 MiB, **magic bytes** match the
   declared type, computes SHA-256 → RPC `complete_credential_document_upload`
   → `scanning` (or `rejected`, and the bytes are removed).

Client-side checks are only for feedback. The database and server enforce.

## 3. Trust (malware) gate

`upload_pending → scanning → clean | quarantined | rejected`, enforced by a
trigger. **Only `clean` documents are evidence** (engine) and **only `clean`
documents can be opened by reviewers** (table RLS, Storage policy and access
RPC). No API role can execute `internal.record_document_scan_result`.

There is **no production scanner yet**: production uploads stay `scanning`
and therefore cannot satisfy requirements or be verified. This is deliberate
— nothing is falsely labelled clean.

Local/dev/test path: `npm run dev:scan-documents` and the test harness
(`tests/support/scanner.ts`) act as the scanner against the **local database
only** (they refuse other hosts).

Planned production integration: Storage upload webhook or a scheduled Edge
Function (approved privileged role, not the web app) → stream the object to a
scanning service (e.g. ClamAV container or a commercial API) →
`record_document_scan_result` → quarantined objects moved out of reach and
the owner notified.

## 4. Access

| Actor                                                                     | Table row                     | Storage object | Download gate       |
| ------------------------------------------------------------------------- | ----------------------------- | -------------- | ------------------- |
| Owner                                                                     | own, not rejected/quarantined | same           | own clean/scanning  |
| Agency with `credential.review` (AAL2) + active share + active membership | clean only                    | clean only     | clean only, audited |
| `credential.view` only (recruiter, ops manager)                           | no                            | no             | no                  |
| Scheduler (`compliance.view`)                                             | no                            | no             | no                  |
| Other agencies, other workers, facilities, platform admins                | no                            | no             | no                  |

**Table and Storage cannot diverge:** both policies call
`authz.can_read_credential_document` (via `can_read_credential_object` for
Storage). pgTAP asserts table visibility = Storage visibility for ten actors
at two trust states.

## 5. Signed download URLs

- Minted only after `authorize_credential_document_access` grants access; the
  RPC records `credential.document_accessed` (or `…_access_denied`) with the
  organisation, document id and purpose — never the path or URL.
- Storage re-checks the same policy when signing.
- TTL **60 seconds**; the server action redirects to it immediately. The URL is
  never rendered into HTML, stored in the database, or logged. Expiry is
  enforced by Storage (integration test: a 2-second URL fails after expiry).
- Redirects are restricted to the configured Supabase origin.

## 6. What is never exposed

Document content in logs or audit · signed URLs or tokens · object paths in
audit metadata · credential numbers outside owner/reviewers · documents to
facilities (facility visibility is readiness + reasons only).
