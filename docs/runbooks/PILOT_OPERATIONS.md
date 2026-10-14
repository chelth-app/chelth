# Chelth pilot operations runbook

For the operator running the controlled pilot. Production app: `https://app.chelth.com`
(Vercel project `chelth`). Database: the linked Supabase production project
(`supabase/.temp/project-ref`).

Rules:

- Read-only first. Every query below is a `select` unless it is marked **WRITE**.
- Never paste secrets, tokens, API keys or recipient email addresses into tickets,
  chat or this document.
- Run SQL with `supabase db query --linked "<sql>"` from the repository root (the
  CLI must be linked to production).
- **WRITE** steps change production. Take a backup first (§9) when the change is
  not trivially reversible, and record who ran what and when.

---

## 1. Is the app healthy?

| Check              | How                                                                 | Healthy                                                                            |
| ------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| App up             | `curl -s https://app.chelth.com/api/health`                         | `{"status":"ok"}`, HTTP 200                                                        |
| Sign-in page       | open `https://app.chelth.com/sign-in`                               | renders; no error page                                                             |
| Auth gate          | `curl -s -o /dev/null -w "%{http_code}" https://app.chelth.com/app` | `307` (redirect to sign-in)                                                        |
| Security headers   | `curl -sI https://app.chelth.com/sign-in`                           | CSP, HSTS, `x-frame-options: DENY`, `permissions-policy` with `geolocation=(self)` |
| Current deployment | GitHub → Deployments → Production (or the Vercel dashboard)         | latest `main` commit, state `success`                                              |
| Runtime errors     | Vercel → project → Logs, filter `level:error`                       | no new `"level":"error"` lines; each has a `requestId`                             |

The app logs structured JSON to stdout (Vercel runtime logs). There is no
external error tracker. Search Vercel logs by the `requestId` a user sees, or by
the `action` name, for example `compliance.createCustomType`.

## 2. Scheduled jobs (pg_cron)

```sql
-- All jobs active?
select jobname, schedule, active from cron.job order by 1;

-- Health over the last 24 h (expect only "succeeded")
select j.jobname, d.status, count(*), max(d.end_time) as last
from cron.job_run_details d join cron.job j on j.jobid = d.jobid
where d.start_time > now() - interval '24 hours'
group by 1, 2 order by 1, 2;

-- Freshness: the minute jobs ran within the last ~2 minutes
select now() - max(end_time) as since_last_run from cron.job_run_details;
```

Expected jobs: `chelth-notification-kick` (every minute),
`chelth-document-scan-kick` (every minute), `chelth-document-scan-watchdog`,
`chelth-attendance-scan`, `chelth-shift-reminder-scan` (every 15 minutes),
`chelth-offer-expiry` (every 5 minutes), `chelth-readiness-scan` (hourly) and
`chelth-location-evidence-purge` (daily).

If a job fails, read `cron.job_run_details.return_message` for that run. A kick
job failing usually means a Vault entry is missing or wrong (§3).

## 3. Notification (email) health

Flow: database event → `internal.notification_outbox` → `chelth-notification-kick`
calls `POST /api/internal/notifications/dispatch` (URL and bearer secret come from
Vault: `chelth_notification_dispatch_url`, `chelth_notification_dispatch_secret`)
→ the dispatcher claims rows as the `chelth_notifier` login (member of
`chelth_notification_worker`) → Resend.

```sql
-- Queue by state: pending | processing | retry | sent | failed
select state, count(*), max(created_at) as latest
from internal.notification_outbox group by 1 order by 1;

-- Waiting too long (should be empty within a couple of minutes)
select event, state, attempts, last_error_code, created_at, next_attempt_at
from internal.notification_outbox
where state in ('pending', 'retry', 'processing') and created_at < now() - interval '10 minutes'
order by created_at;

-- Failures by cause (no recipients shown)
select event, last_error_code, count(*), max(processed_at) as latest
from internal.notification_outbox where state = 'failed'
group by 1, 2 order by 3 desc;

-- Vault entries present (names only; never select the secret value)
select name from vault.secrets where name like 'chelth_%' order by 1;
```

Retries are automatic: transient errors move to `retry` with backoff, up to the
configured maximum number of attempts, then `failed`.
`expired_before_delivery` is expected for a time-bound message (an offer or a
reminder) that could not be sent before it stopped being useful. It is not an
outage.

**Failed email handling**

1. Group failures by `last_error_code` with the query above.
2. Provider or authentication errors on every row: check Resend (API key,
   verified sender domain, account status) in the Resend dashboard, and the
   Vercel env vars `EMAIL_PROVIDER` and `EMAIL_FROM` (names only).
3. No rows ever leaving `pending`, and the kick's HTTP calls return 401
   (`{"status":"unauthorized"}` in Vercel logs for
   `/api/internal/notifications/dispatch`): the Vault URL or secret and the
   Vercel `NOTIFICATION_DISPATCH_SECRET` do not match.
4. A single failed row: there is no replay tool. Tell the affected user through
   the app (Messages), or have the agency re-send the action (for example,
   re-offer the shift). Emails are a convenience; every state is also visible
   in the app.

## 4. Credential scanner health

Flow: upload → `credential_documents.status = 'scanning'` →
`chelth-document-scan-kick` calls `POST /api/internal/documents/scan` (Vault:
`chelth_document_scan_url`, `chelth_document_scan_secret`) → provider
(`MALWARE_SCAN_PROVIDER=cloudmersive` with `MALWARE_SCAN_API_KEY` in Vercel) →
`clean` or `infected`/`failed`. The watchdog re-queues stalled scans.
`local_test` can never run in production. With the provider disabled or
misconfigured, documents stay `scanning` (fail-closed: never trusted).

```sql
-- Status mix
select status, count(*), max(created_at) as latest
from public.credential_documents group by 1 order by 1;

-- Stuck: still scanning after 1 hour (should be 0)
select id, created_at from public.credential_documents
where status = 'scanning' and created_at < now() - interval '1 hour'
order by created_at;
```

**Stuck credential ("Checking document…" that never clears)**

1. Run the stuck query. If many rows are stuck, it is a scanner outage: check
   the kick job (§2), the Vault entries and the Vercel env vars
   `MALWARE_SCAN_PROVIDER` and `MALWARE_SCAN_API_KEY`, and Vercel logs for the
   scan route.
2. For one document, once the cause is fixed — **WRITE**:
   `select internal.requeue_document_scan('<document-id>'::uuid);`
3. Never mark a document clean by hand. If the provider is down, the worker
   waits; an agency cannot verify an unscanned document (by design).

## 5. Geofence readiness (per pilot location)

UI (agency admin, verified with the authenticator app):
Settings → Attendance & Geofencing (`/app/organisations/<agency-id>/settings/attendance`).
Each location shows its readiness. Configure a location at
`/settings/attendance/geofences/<location-id>`. "Require geofencing" is the
organisation switch on the same page.

```sql
-- Locations and their geofence (no coordinates selected)
select f.name as facility, l.name as location, g.enabled, g.radius_meters,
       g.max_accuracy_meters, g.outside_policy
from public.facility_locations l
join public.agency_facilities f on f.id = l.agency_facility_id
left join public.location_geofences g on g.facility_location_id = l.id
order by 1, 2;

-- Organisations requiring geofencing
select o.name, s.require_geofence
from public.agency_attendance_settings s
join public.organisations o on o.id = s.agency_organisation_id;
```

Pilot standard: every location workers check in at has an enabled geofence
with a radius, a maximum accuracy and `outside_policy = 'block'`, the agency
has "Require geofencing" on, and readiness shows READY. With geofencing
required, an unconfigured location blocks check-in with a configuration
message (fail-closed). Clock-out is never blocked.

## 6. Attendance issues

| Report                                         | Check                                                                                | Action                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| "I can't check in"                             | Location readiness (§5); the worker's location permission; accuracy shown in the app | Fix the geofence. Ask the worker to enable precise location and step outside. The agency can record a correction on the attendance record. |
| "Check-in says outside the area" while on site | Geofence centre and radius (§5)                                                      | Correct the geofence; the agency records a correction for the missed time                                                                  |
| Missed clock-in or clock-out                   | Agency → Attendance → the record → Corrections                                       | Use the correction flow; never edit tables                                                                                                 |
| Facility asks for location details             | n/a                                                                                  | Facilities see derived states only, by design; the agency keeps evidence                                                                   |

## 7. When a pilot user reports a problem

1. Ask for: the organisation, the page URL, the time (with timezone), what they
   expected, and the reference/request ID shown on the error message, if any.
2. App health (§1). If the issue is red, it is an incident: go to §8.
3. Search Vercel logs for the `requestId` or the `action` name.
4. Permissions: is the user a member with the right role? Settings → Team &
   Permissions. Some actions need the authenticator step-up ("Verify now").
5. Data or flow:
   - email missing → §3;
   - document stuck → §4;
   - check-in → §5 and §6;
   - "page not found" for a valid page → it usually means no access to that
     organisation (404 by design).
6. Record the outcome in the pilot log: date, user role, issue, cause, fix.

## 8. Rollback the app deployment

The app is stateless; rolling back the code is safe and fast:

1. Vercel dashboard → project → Deployments → the last known-good Production
   deployment → **Promote to Production** (or "Instant Rollback").
2. Verify §1 and run the smoke test (`PILOT_SMOKE_TEST.md`).
3. Open an issue with the bad commit. Fix forward on a branch, then merge to
   `main` (which redeploys).

Database migrations are forward-only (`docs/architecture/DATABASE_MIGRATION_POLICY.md` §8).
Every pilot migration is additive, so an older app keeps working against a
newer schema. Do not roll the schema back; fix forward with a new migration.

## 9. Backup and recovery

Current production state: point-in-time recovery (PITR) is **off**, and the
provider lists no physical backups (`supabase backups list`). Backups are
**manual logical dumps** taken by the operator.

Before every production migration, and before pilot start:

1. Take a manual logical backup with the procedure used in
   `docs/reports/P0-E9-1B-controlled-production-activation.txt` §2 (roles,
   schema and data dumps into `~/chelth-backups/prod-<purpose>-<UTC timestamp>/`,
   permissions `700`).
2. Record the timestamp and the latest applied migration
   (`supabase migration list --linked`).
3. A restore is rehearsed locally only. Never test a restore against production.
4. Recommended before the pilot handles real data: enable PITR (Supabase
   project → Database → Backups), or at least daily logical dumps.

Recovery from a bad migration: fix forward (new migration). Restore from a
backup only for data loss, and only after an explicit decision, because a
restore discards every write since the backup.

## 10. Platform administration (control plane)

Chelth's own operators use `https://app.chelth.com/platform` (P0-E9-4A). A
platform admin is not a member of any customer and gets no access inside a
customer's workspace. The control plane needs the authenticator app (AAL2).

| Task                                                                                   | Where                                                                         |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| See customers, setup state and health                                                  | `/platform`                                                                   |
| Create a facility organization and invite its owner                                    | `/platform/organisations` → Create an organization                            |
| Resend or revoke the owner invitation                                                  | the organization → Owner invitations                                          |
| Link an agency facility record to a facility organization                              | the facility organization → Facility links → choose agency → record → confirm |
| Set up or change an agency's commercial account (plan, status, billing contact, trial) | the agency → Commercial account (a reason is required)                        |
| Suspend or reactivate an organization                                                  | the organization → Organization access (a reason is required)                 |
| Plans                                                                                  | `/platform/billing` → Plans (no prices until approved)                        |
| Background services                                                                    | `/platform/system`                                                            |
| What platform admins changed                                                           | `/platform/activity`                                                          |

The payment provider is not connected: commercial statuses are records, not
charges. A commercial suspension also suspends the organization's access.

**Granting or revoking platform administration** stays an operator procedure.
There is no UI for it, by design. Run it as a one-off **WRITE** with the owner
connection, for a named person who already has an account with the
authenticator app enrolled:

```sql
select internal.grant_platform_admin('<operator-profile-uuid>'::uuid, '<Operator name>', '<reason>');
select internal.revoke_platform_admin('<operator-profile-uuid>'::uuid, '<Operator name>', '<reason>');
```

Both are audited. Keep at least one active platform admin. Revoking takes
effect on that person's next request.

## 11. Facility connections and disputes

Normal path: the agency invites from its facility record, and the facility's
administrator accepts (creates the facility, or connects the one they already
manage). No platform action is needed.

| Situation                                               | What to check                                                                    | Action                                                                                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "The invitation never arrived"                          | `/platform` → the agency → Facility connection invitations (masked email, sends) | The agency resends (rotates the link) or revokes and re-invites with the right email                                                                        |
| "It says the invitation is unavailable"                 | It is bound to the exact email and expires after 7 days                          | Sign in with the invited email; otherwise the agency resends                                                                                                |
| A scheduler or supervisor was invited                   | They cannot approve for an existing facility                                     | The agency invites the facility's administrator                                                                                                             |
| A duplicate facility was created ("Metro Health" twice) | `/platform/organisations` (both facility organizations, their links)             | Do not merge or delete. Decide with both parties which is canonical; suspend the unused one (`/platform` → Organization access, with a reason)              |
| The wrong facility was connected                        | `/platform` → the facility → Facility links                                      | Links are written once (not re-pointable). The agency ends that relationship (its record keeps history), then creates a new client record and invites again |

Never re-point a link with SQL, and never reassign records between
organisations. Every recovery is additive and audited.

## 12. Additional business requests

One staffing business = one agency organization. Branches, facilities and
departments belong inside it. An owner cannot self-create a second agency
(database-enforced, `CHB01`); they request one from Account → Businesses.

1. `/platform/billing` → Additional business requests: check the requester,
   the agencies they already own, the business name, the billing contact and
   the note.
2. Confirm with the requester that it is a separate business (separate legal
   entity or operation), not a branch or a client facility.
3. **Create business and account** (start as Trial or Active, a plan if one
   applies, a reason). This creates the agency with the requester as owner
   and its own commercial account in one step. Nothing is inherited from
   their existing business.
4. Otherwise, **Decline** with a reason (for example, "same business; use
   facilities").

Never create a second agency for an existing owner any other way. Every
agency must have its own commercial account.
