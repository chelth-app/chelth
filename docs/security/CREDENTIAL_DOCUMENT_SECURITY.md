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

**Production status (P0-E9-2): the scanning pipeline below is implemented and
tested, but NOT yet active in production.** Until the operator supplies the
provider account and configuration (scanner principal, secrets, Vault, pg_net),
production uploads stay `scanning` and therefore cannot satisfy requirements or
be verified. This is deliberate: nothing is ever falsely labelled clean.

### 3.1 Pipeline (migration `20261009100000_document_malware_scanning`)

```
complete_credential_document_upload ── status → scanning
        │ trigger
        ▼
internal.document_scan_queue (pending)            pg_cron every minute
        ▲                                         internal.request_document_scan_dispatch
        │ claim / complete (SKIP LOCKED, lease)            │ pg_net + Vault secret
        │                                                  ▼
POST /api/internal/documents/scan  (Bearer DOCUMENT_SCAN_DISPATCH_SECRET)
  └ signs in as the SCANNER PRINCIPAL (src/lib/supabase/scanner.ts)
  └ public.claim_document_scans(batch ≤ 25, lease 60–900 s)
  └ Storage download of the claimed object only (claim-scoped policy)
  └ size + SHA-256 must equal the validated upload, else integrity_mismatch
  └ MalwareScanner adapter (provider-neutral; Cloudmersive implemented)
  └ public.complete_document_scan(outcome) → internal.record_document_scan_result
```

### 3.2 Scanner principal (least privilege, no service role)

A dedicated Auth identity registered by the operator with
`internal.register_document_scanner(profile_id, label)`:

- its application profile is **suspended**, so `authz.current_profile_id()` is
  NULL and every application RPC and tenant policy refuses it;
- it must not belong to any organisation or be a platform admin;
- it can call exactly `claim_document_scans`, `complete_document_scan` and
  `document_scan_health` (each gated on `authz.is_document_scanner()`);
- `authz.can_read_credential_document` (the single table **and** Storage
  helper) lets it read a document **only while it is `scanning` and the
  scanner holds an unexpired claim on it**;
- revoke with `internal.revoke_document_scanner(profile_id)`.

The web app holds no service-role key and no database password for scanning.

### 3.3 Result model (fail-closed)

Adapters normalise provider output to `clean | malicious | unscannable |
transient_failure`. The worker and database map:

| Outcome                                                                             | Document                             | Retry |
| ----------------------------------------------------------------------------------- | ------------------------------------ | ----- |
| `clean` on matching bytes                                                           | `clean` (evidence; NOT verification) | —     |
| `malicious` (virus or unsafe content)                                               | `quarantined` / `malware_detected`   | never |
| `integrity_mismatch` (size/SHA differ)                                              | `quarantined` / `integrity_mismatch` | never |
| `unscannable` (corrupt / encrypted)                                                 | `rejected` / `unscannable`           | never |
| `transient_failure` (timeout, 429/5xx, auth, malformed response, object unreadable) | stays `scanning`                     | yes   |

A clean verdict is accepted only when the observed SHA-256 equals the hash
recorded at upload (re-checked by the database). Objects cannot be replaced
(no UPDATE policy; inserts only into `upload_pending`), so the scanned bytes are
the validated bytes.

### 3.4 Retries, leases and stuck scans

- Backoff 1 min, 5 min, 30 min, 2 h; the 5th failed attempt is terminal
  (`internal.operations_settings.max_document_scan_attempts`).
- An expired lease (crashed worker) is reclaimable and counts an attempt; a
  superseded claim token can no longer report (`stale_claim`).
- Terminal failure: the queue row becomes `failed`, the document **stays
  `scanning`** with `status_reason = 'scan_failed'` (the owner sees "We
  couldn't finish checking this document. Try again later or upload a new
  copy."), and `credential.document_scan_failed` is audited.
- Signals: `public.document_scan_health()` (logged by the worker every run),
  the `document_scan_watchdog` run every 15 min in
  `internal.scheduled_job_runs` (`healthy`, `failed`, `stuck`, oldest age), and
  `internal.list_stuck_document_scans()` ("which documents have been scanning
  too long?"; threshold `document_scan_stuck_after`, default 6 h).
- Recovery after a provider outage: `internal.requeue_document_scan(id)`.

### 3.5 Provider

`MALWARE_SCAN_PROVIDER = disabled | cloudmersive | local_test`. Cloudmersive's
advanced file scan also refuses scripts, macros, executables, password
protection and non-PDF/JPEG/PNG content. `local_test` (EICAR signature stub) is
refused in production. A new provider is one adapter implementing
`MalwareScanner`; domain code never sees vendor responses.

### 3.6 Testing

pgTAP `260_document_scanning`, `tests/integration/document-scanning.test.ts`
(real Storage + scanner principal, EICAR, corrupt, mismatch, transient,
concurrency, stale lease) and `tests/unit/lib/document-scanning.test.ts`
(worker and provider mapping). Production verification uses the route's
`{"selfTest": true}` mode (clean sample + EICAR through the provider, no
document touched) and a controlled internal upload.

Local/dev/test: `npm run dev:scan-documents` and the test harness
(`tests/support/scanner.ts`) can still act as the scanner against the **local
database only** (they refuse other hosts).

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
