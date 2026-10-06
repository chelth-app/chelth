# Post-Visual Product Backlog

Product features deliberately deferred during the P0-E8 visual
implementation stages. Each is a controlled product feature with its own
design, migration, security tests and review. None is part of a
presentation-only stage, and none may be approximated in the UI before it
exists. See DERIVATION-MAP §F (`docs/ui-reference/p08-e8/DERIVATION-MAP.md`).

---

## IN-APP NOTIFICATIONS

**Status:** planned, not started. Decision recorded in P0-E8-S9G (option C
approved, 2026-10-05).

**Current state:**

- Chelth delivers operational notifications by email only, through
  `internal.notification_outbox` (see `NOTIFICATION_DELIVERY.md` and
  `TRANSACTIONAL_EMAIL.md`). The outbox is a delivery queue, not a read
  model:
  - it is in the internal schema, with no grants to authenticated users;
  - it has no read, archive or resolution state;
  - its display data is resolved only at claim time.
- **Operations** (`/app/organisations/[organisationId]/operations`) is the
  current operational attention centre. It shows real-time attention and
  exception handling over authoritative read models, presented in the
  locked Notifications list language.
- There is no Notifications route, sidebar item, badge or top-bar bell
  until this feature ships.

**Product distinction:**

- Operations: real-time operational attention and exception handling.
  State lives in the source domain (assignments, relationships, delivery).
- In-app Notifications: recipient-scoped notification history and personal
  attention state (read / archived), linking to the authoritative record.
  Reading or archiving a notification never resolves the underlying issue.

### Required architecture (minimum)

Data model:

- Recipient-scoped notification records: one row per recipient profile.
- Organisation / tenant scoping: the audience organisation on every row.
- Notification type / source: the event enum and the source domain.
- The related entity type and entity id.
- `created_at`.
- `read_at` (nullable).
- `archived_at` (nullable). This is separate from read state and from
  source-domain resolution.
- A safe metadata payload: identifiers, codes and small counts only. No
  addresses, free text, tokens or provider data.
- A deep-link destination: a canonical application route, resolved and
  re-authorised at read time.

Security:

- Capability-safe access. Display data is resolved under the caller's own
  permissions, so a notification never reveals more than the destination
  surface would.
- RLS deny-by-default. Recipients read only their own rows; no cross-tenant
  reads.
- No service-role client exposure. Reads and writes go through RLS or
  narrow security-definer RPCs.
- Tenant-isolation tests (pgTAP security suite plus E2E): other tenants,
  other members, facility vs agency, worker vs agency.
- Delivery internals (attempts, leases, provider ids, error codes) are
  never exposed as notification content.

Behaviour:

- Read / unread actions: mark one read; mark all read, scoped to the
  caller's own rows.
- Archive / unarchive, independent of read state and of resolution.
- A truthful badge count: the caller's unread, unarchived rows, computed
  server-side.
- Pagination: keyset by (`created_at`, `id`).
- Accessibility: semantic list, state conveyed in text, not colour alone;
  keyboard operable; axe clean.
- Retention policy: a defined window for read and archived rows, with a
  purge job documented alongside audit retention.
- Event-to-notification creation rules: which events create in-app rows,
  for which recipients (reuse the outbox recipient policy where
  appropriate), deduplication, and expiry for time-bound events.

UI (only once the above exists):

- A Notifications route in the locked Notifications reference
  (`docs/ui-reference/p08-e8/canonical/Chelth_Notifications/`): KPIs, tabs,
  filters, list and the Activity Details drawer.
- The sidebar Notifications item with the truthful badge.
- The top-bar bell, only with a backed unread state and a real
  destination.

**Not to be done before this feature:** no synthetic notification records,
no unread or archived styling, no mark-all-read, no badge, no bell.
