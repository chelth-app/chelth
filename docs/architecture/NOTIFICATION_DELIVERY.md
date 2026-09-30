# Notification Delivery

Status: P0-E5-S2. Extends the P0-E5-S1 outbox; complements
[TRANSACTIONAL_EMAIL.md](TRANSACTIONAL_EMAIL.md) (interactive invitations keep
their post-commit pattern).

## 1. Shape

```
domain RPC ──(same transaction)──► internal.enqueue_notification
                                     │ recipient policy → one outbox row per recipient profile
                                     ▼
                            internal.notification_outbox   (ids + codes only)
pg_cron (every minute) ─► internal.request_notification_dispatch ─pg_net─►
   POST /api/internal/notifications/dispatch   (Bearer secret)
        │ connects as a login role in chelth_notification_worker
        ├─ internal.claim_notifications(batch, lease)  → address + template data resolved NOW
        ├─ renderNotification (src/lib/notifications/templates.ts)
        ├─ EmailSender.send (Resend adapter; provider-neutral interface)
        └─ internal.complete_notification(id, claim_token, outcome, …)
```

Domain code depends only on the event, the recipient identity and template
data. Provider choice is `EMAIL_PROVIDER`; SMS/push/in-app would be new senders
behind the same dispatcher, not new domain code.

## 2. Recipient policy (narrowest safe default)

| Audience          | Who                                                                                   | Events                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Worker            | the one worker (profile) concerned                                                    | worker_assigned, assignment_cancelled, shift_cancelled, shift_offered                                                 |
| Agency operations | active members holding `assignment.manage`, capped at 25, actor excluded              | assignment_declined, facility_request_submitted, assignment_non_compliant, relationship_suspended, relationship_ended |
| Facility          | active members of the LINKED facility holding `shift.request`, capped, actor excluded | facility_request_opened, shift_cancelled (facility request)                                                           |

`audience_organisation_id` is the recipient's organisation: delivery status is
visible only inside that tenant. All current events are **required**
operational notifications; a preference model (optional digests/reminders)
is future work. Offer declines/acceptances are shown in the UI, not emailed.

## 3. What is stored

The outbox holds event, organisation ids, recipient **profile id**, subject
type/id, small numeric `detail`, state fields, provider name/message id and a
safe error code. **No address, subject, body, link or token.** The address is
read from `auth.users` at claim time, only for an active, confirmed identity
that is still an active member of the audience organisation; template data is
built from current records by `internal.notification_template` (and returns
nothing if the subject no longer belongs to the right tenant). Nothing is
copied into audit metadata except event, error code and attempt count.

## 4. State machine

| State      | Meaning                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| pending    | queued, due at `next_attempt_at`                                                                            |
| processing | claimed: `claim_token` + `claimed_until` lease (default 120 s)                                              |
| sent       | provider accepted; `sent_at`, `provider_message_id`                                                         |
| retry      | temporary failure; due again after backoff                                                                  |
| failed     | final: permanent provider error, attempts exhausted, recipient/subject unavailable, or past `deliver_until` |

Claims use `SELECT … FOR UPDATE SKIP LOCKED` (bounded batch ≤ 100), so two
dispatchers never take the same row. Completion applies only with the current
claim token (`stale_claim` otherwise), so a crashed/slow dispatcher cannot
overwrite a newer result. An expired lease makes the row reclaimable and
counts as an attempt.

## 5. Retries and idempotency

- Backoff after attempt n: 1 min, 5 min, 30 min, 2 h; the 5th failed attempt
  is final (`internal.operations_settings`).
- Permanent: `provider_rejected` (e.g. invalid recipient), invalid template.
  Temporary: unavailable, unreachable, rate-limited, auth (configuration).
- Provider idempotency key `chelth-notification-<outbox id>` is stable across
  retries: if a send succeeded but was not recorded, the retry is
  de-duplicated by Resend (idempotency window 24 h; the whole retry schedule
  fits inside it).
- **Guarantee:** at-least-once delivery attempt per row, de-duplicated by the
  provider key within its window; at most one row per (event, subject,
  recipient) while pending (unique index). Limits: a provider that ignores
  idempotency keys, or a resend after 24 h, could duplicate.
- `deliver_until` (usually the shift end, or the offer expiry) stops stale
  emails: late rows fail as `expired_before_delivery`.

## 6. Templates

`src/lib/notifications/templates.ts`: branded, restrained HTML (table layout,
600 px, banner image, `lang`, alt text, 15 px text, one call-to-action) plus a
plain-text alternative. Every interpolated value is escaped. Content: agency,
facility, location, discipline, local date/time with timezone, a canonical
`APP_BASE_URL` route. Never: credential or compliance detail, notes, other
workers, ids in visible text, tokens, signed URLs. Workers accept/decline in
the authenticated app — there are no one-click action links.

## 7. Configuration (operator)

| Setting                                                 | Where                   | Notes                                                      |
| ------------------------------------------------------- | ----------------------- | ---------------------------------------------------------- |
| `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` | Vercel (server)         | existing; while `disabled`, nothing is claimed (rows wait) |
| `APP_BASE_URL`                                          | Vercel (server)         | https origin for links, e.g. `https://app.chelth.com`      |
| `NOTIFICATION_DISPATCH_SECRET`                          | Vercel (server) + Vault | ≥ 32 random chars; same value in both                      |
| `NOTIFICATION_WORKER_DATABASE_URL`                      | Vercel (server)         | login role below; use the pooler URL (`prepare: false`)    |
| Vault `chelth_notification_dispatch_url`                | Supabase Vault          | `https://<app>/api/internal/notifications/dispatch`        |
| Vault `chelth_notification_dispatch_secret`             | Supabase Vault          | = `NOTIFICATION_DISPATCH_SECRET`                           |

Login role (SQL editor, once per environment; the password is a secret, so it
is never in a migration):

```sql
create role chelth_notifier login password '<generated>' in role chelth_notification_worker;
```

That role can execute `internal.claim_notifications` and
`internal.complete_notification` only (pgTAP-enforced). Missing Vault entries
make the cron kick a no-op. Alternative trigger: Vercel Cron (Pro) calling the
same route with the secret.

## 8. Observability

- `list_notification_deliveries(org)` (assignment.view): failed/retrying
  deliveries of that tenant with recipient **name**, event, state, attempts,
  safe error label — on `/operations`.
- Final failures are audited (`notification.failed`: event, error code,
  attempts). Successful sends are recorded on the outbox row only (not audited,
  to keep audit volume proportional).
- `internal.scheduled_job_runs` records every scheduled scan/expiry run.
- Dispatcher logs: notification id, event, attempt, state, error code.
