# Rate Card Model

Status: P0-E7-S1. Engine: [PRICING_ENGINE.md](PRICING_ENGINE.md). Access:
[../security/FINANCIAL_DATA_ACCESS.md](../security/FINANCIAL_DATA_ACCESS.md).

Pricing configuration lives in its own tables. No operational table
(attendance, shifts, assignments, timesheet entries) carries a pay or bill
column. Shifts gained only a controlled `classification`
(`regular | evening | night | weekend`, default `regular`, fixed once the
shift is open) that is used to _select_ a rate.

## 1. Entities

| Table                | Purpose                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `currencies`         | ISO 4217 reference data with minor-unit digits (USD, CAD, GBP, EUR, AUD, NZD — all 2). No FX.                                                                                          |
| `rate_cards`         | One pricing scope: agency + (one relationship, or all facilities) + discipline + (classification, or any). One card per scope (`unique nulls not distinct`). Never updated or deleted. |
| `rate_card_versions` | Effective-dated hourly `pay_rate_minor` and `bill_rate_minor` with one currency; `draft → active` or `discarded`.                                                                      |

Pay and bill are independent values; neither is derived from the other and
no margin is stored.

## 2. Money

Integer **minor units** (`bigint`), e.g. $42.50/h → `4250`. Rates must be
between 1 and 100,000,000 minor units. **Zero is rejected**: a legitimate
zero-rate case would need a future, explicit rule type, so "missing" can
never be confused with "free".

## 3. Effective dating and versioning

- `effective_from` (required) and `effective_to` (optional, inclusive last
  day). Work is matched by its **local work date**.
- Drafts can be edited or discarded. **Activation freezes the terms**
  (trigger-enforced, even for the owner role).
- Activating a version whose start falls inside an existing active,
  open-ended (or later-ending) version sets that version's
  `superseded_from` to the new start — its terms and its history before that
  date are untouched. Nothing else on an active version can change.
- A new version starting on or before an existing active version's start, or
  one that would leave part of an existing version ambiguous, is refused
  (`CHM12 OVERLAPPING_RATE_VERSION`).
- The effective period `[effective_from, min(effective_to + 1, superseded_from))`
  is a generated column with an exclusion constraint: two active versions of
  one card can never overlap.
- UI phases (derived, not stored): Draft, Current, Upcoming, Superseded,
  Ended, Discarded.

## 4. Precedence

Resolution for (relationship, discipline, classification, work date):

1. relationship + discipline + classification
2. relationship + discipline (any classification)
3. all facilities + discipline + classification
4. all facilities + discipline (any classification)

The first tier with a matching **card** decides. If that card has no active
version for the work date the result is `RATE_NOT_CONFIGURED` — there is no
silent fallback to a less specific card for a gap. More than one match at a
tier is `RATE_AMBIGUOUS` (structurally prevented by the unique scope and the
exclusion constraint). Worker names and free text are never pricing keys.

## 5. Administration

`rates.manage` (AAL2): `create_rate_card` (idempotent per scope),
`create_rate_version`, `update_rate_version_draft`, `discard_rate_version`,
`activate_rate_version`. Every step is audited with ids, currency and
minor-unit values. Rates are read with `rates.view` via `list_rate_cards`
(keyset-paginated).
