# Transactional Email

Status: P0-E3-S3; operational notifications added in P0-E5-S2 — see
[NOTIFICATION_DELIVERY.md](NOTIFICATION_DELIVERY.md) (outbox + dispatcher for
non-interactive, secret-free notifications, as anticipated in §2).

## 1. Two email channels

| Channel                | Sends                                                     | Configured in                                               |
| ---------------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| **Supabase Auth**      | sign-up confirmation, password reset, email change        | Supabase project (templates in `supabase/templates/`; SMTP) |
| **Chelth application** | organisation/worker invitations (and later notifications) | `src/lib/email` provider abstraction + server env           |

## 2. Delivery pattern: post-commit delivery with recorded outcome

```
Server Action
  1. RPC create/resend invite ──► COMMIT (invite + audit; token hash only)
  2. send email with raw token (held only in memory)
  3. RPC record_organisation_invite_delivery(status, provider, message id / error code)
  4. UI: "emailed" — or, if skipped/failed, the link is shown once to the issuer
```

| Failure mode                              | Outcome                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB rolls back                             | nothing is sent (send happens after commit)                                                                                                                                                                   |
| Provider down / rejected / not configured | invite stays valid; `delivery_status = failed/skipped` + error code is stored and shown in the invitations list; issuer gets the link; logs record invite id + code; **Resend** rotates the token and retries |
| Process crash between send and record     | status stays `not_attempted` (visible); issuer can resend                                                                                                                                                     |
| Duplicate submit                          | provider idempotency key `invite-<id>-<expiry>` (unique per token rotation)                                                                                                                                   |

**Why not an outbox (yet)?** A reliable outbox needs either the raw invite
token persisted (a secret at rest) or a privileged background worker able to
rotate tokens and read across tenants (a service-role or dedicated DB role).
Both widen the attack surface; the post-commit pattern gives the same "never
silent" guarantee for interactive invitations. An outbox becomes appropriate
for **non-interactive** notifications (shift reminders, digests) whose
payloads carry no secrets — planned for that stage, processed by an Edge
Function or cron with an approved, narrowly-granted role.

## 3. Provider abstraction

- `src/lib/email/types.ts` — `EmailMessage`, `EmailSender`, result codes
  (`provider_auth | provider_rejected | provider_rate_limited |
provider_unavailable | provider_unreachable`).
- `disabled-sender.ts` — default; never sends; returns `skipped`.
- `resend-sender.ts` — Resend REST API via `fetch`; 10 s timeout; never
  throws; never logs recipients, links or bodies.
- `getEmailSender()` (server-only) — selected by configuration.
- Domain code (`features/organisations/invitation-delivery.ts`) depends only
  on the interface; switching provider is one adapter + one env value.

## 4. Configuration (operator)

| Variable         | Scope         | Notes                                                                       |
| ---------------- | ------------- | --------------------------------------------------------------------------- |
| `EMAIL_PROVIDER` | server        | `disabled` (default) \| `resend`                                            |
| `RESEND_API_KEY` | server secret | required when `resend`; never `NEXT_PUBLIC_`; bundle scan fails if it leaks |
| `EMAIL_FROM`     | server        | e.g. `CHELTH <no-reply@mail.<domain>>`; required when `resend`              |

Validation fails the build/start if `resend` is selected without both.

**Remaining operator steps** (not possible from the repository):

1. Create the Resend account; add and verify the sending domain
   (SPF, DKIM, return-path DNS records; DMARC policy on the root domain).
2. Create a sending-only API key; set `EMAIL_PROVIDER`, `RESEND_API_KEY`,
   `EMAIL_FROM` in Vercel (Production and Preview separately).
3. Disable open/click tracking in Resend (tracking rewrites links, which would
   route invite tokens through a third-party redirector).
4. Supabase Auth emails: configure custom SMTP (can be Resend SMTP) on the
   hosted project once on a plan that allows it; until then Supabase's
   default sender (rate-limited) delivers confirmation/reset emails.
5. Set provider log retention to the minimum available.

## 5. Security rules

- Invitation links are secrets: never logged (app or provider tracking),
  never stored raw, never placed in audit metadata.
- Delivery records hold provider name, provider message id and an error code
  — no addresses or bodies.
- All interpolated values in HTML emails are escaped.
- Resend recipient is always read from the database, never from the form.
