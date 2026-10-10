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

## 9. Attendance events (P0-E6-S1)

| Event                             | Audience                            | When                                           |
| --------------------------------- | ----------------------------------- | ---------------------------------------------- |
| `attendance_clock_in_late`        | agency `attendance.review` holders  | first late clock-in on an attendance           |
| `attendance_clock_in_blocked`     | agency `attendance.review` holders  | clock-in refused (not eligible / outside site) |
| `attendance_missed_clock_in`      | agency `attendance.review` holders  | scan opens `missed_clock_in`                   |
| `attendance_missed_clock_out`     | agency reviewers **and** the worker | scan opens `missed_clock_out`                  |
| `attendance_correction_requested` | agency `attendance.review` holders  | worker requests a correction                   |
| `attendance_correction_approved`  | the worker                          | reviewer approves                              |
| `attendance_correction_rejected`  | the worker                          | reviewer rejects                               |

`internal.enqueue_notification` routes `attendance_*` agency fan-out to
`attendance.review` (other agency events keep `assignment.manage`). Each
exception notifies once (only when the exception is newly opened), so repeated
attempts or scans do not repeat emails. Templates carry worker name, facility
and local shift time only: **never coordinates, distances, refusal reasons or
credential detail**. Worker emails explain how to request a correction.
Facilities receive no attendance email.

## 10. Timesheet events (P0-E6-S2)

| Event                                 | Audience                                             | When                                                                            |
| ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `timesheet_submitted`                 | agency `timesheet.approve` holders                   | worker submits                                                                  |
| `timesheet_rejected`                  | the worker                                           | agency returns or reopens a timesheet                                           |
| `timesheet_facility_signoff_required` | linked facility `timesheet.facility_signoff` holders | agency approval; once per facility organisation (again after "times confirmed") |
| `timesheet_disputed`                  | agency `timesheet.approve` holders                   | facility raises a discrepancy                                                   |
| `attendance_time_adjusted`            | the worker                                           | a reviewer approves a different time or adjusts attendance                      |

Routing: agency fan-out for `timesheet_*` uses `timesheet.approve`; facility
fan-out for `timesheet_*` uses `timesheet.facility_signoff`. The template
resolver (`subject_type = 'timesheet'`) returns agency name and period (plus
the worker name for agency audiences only) and refuses facility rows unless
the timesheet has an entry at that facility. Templates contain no times,
totals, pay, notes or coordinates. Agency approval, sign-off and locking are
shown in the app, not emailed (volume).

## 11. Pricing (P0-E7-S1)

`pricing_blocked_missing_rate` — agency `pricing.run` holders (never the
person who ran pricing), once per blocked timesheet revision (the
`pricing_blocks` row is the deduplication key). Content: worker name and
week only; no rates, amounts or currencies. Link: `/pricing`. Ready-to-price
timesheets are a UI queue, not an email.

## 12. Payroll and invoices (P0-E7-S2)

There are **no** notification events. All finance work surfaces as UI
queues, ordered needs-attention first:

- `/payroll`: adjustments, batches blocked by revised work, work not yet
  priced, unprepared periods;
- `/invoices`: the same for drafts.

This keeps amounts, references and personal pay data out of email entirely.
Future reminders (for example "3 periods ready to prepare") should carry
counts and links only.

## 13. Shift emails (P0-E9-3G)

All worker shift emails use this pipeline (outbox in the domain transaction →
dispatcher → template → Resend). No action sends email directly.

| Event                  | When                                                                                | Subject                          | Link                      |
| ---------------------- | ----------------------------------------------------------------------------------- | -------------------------------- | ------------------------- |
| `worker_assigned`      | direct assignment (the worker then confirms in Chelth)                              | You have a new shift             | `/my-shifts/<assignment>` |
| `shift_offered`        | an offer is created (never implies assignment)                                      | New shift available              | `/my-shifts`              |
| `shift_changed`        | a worker-relevant field of an open shift changes (time, date, location, role, unit) | Your shift has been updated      | `/my-shifts/<assignment>` |
| `shift_cancelled`      | the shift is cancelled                                                              | Your shift has been cancelled    | `/my-shifts`              |
| `assignment_cancelled` | the worker's assignment is cancelled                                                | Your shift has been cancelled    | `/my-shifts`              |
| `shift_reminder`       | ~24 h before an ACCEPTED shift (scan every 15 min)                                  | Reminder: your shift is tomorrow | `/my-shifts/<assignment>` |

- Acceptance (of an assignment or an offer) sends nothing: the worker did it.
- `shift_changed` comes from a trigger on `public.shifts`
  (`worker_change_version`). Headcount, references, classification and
  instructions never email. A further change while the email is still
  waiting merges into it (net change, original "previous" values). Today
  date / time / location / role cannot change under an assigned worker
  (`shifts_transition` + the assignment → shift `start_at` FK), so in practice
  the unit is the changing field; the trigger covers the rest if that rule is
  ever relaxed.
- Reminders: `internal.run_shift_reminder_scan` (cron
  `chelth-shift-reminder-scan`). Accepted assignments on open shifts starting
  within 24 h; assignments made inside that window are skipped. Wording
  ("tomorrow" / "today") uses the facility's calendar, never the device's.
- Idempotency: `notification_outbox.dedupe_key` (unique, every state).
  Lifecycle events get `<event>:<subject>:<recipient>` automatically; changes
  `shift_changed:<assignment>:<version>`; reminders
  `shift_reminder:<assignment>:<start epoch>`.
- Delivery-time guards: change and reminder rows resolve to nothing (failed
  `subject_unavailable`, never sent) when the assignment or shift is no longer
  active, or the shift has started; a worker row renders only for that
  worker's own assignment.
- Content: facility, location, date / time / timezone, role, unit and (new
  assignment / reminder) up to 280 characters of the facility's worker
  arrival guidance. Never pay or rates, coordinates, credentials, notes, other
  workers or facility contact details.
- Preferences: none yet — all shift emails are required operational
  notifications (default on). A later split could make reminders optional;
  cancellations and changes stay required.
