# Chelth Locked Visual System

**Status: LOCKED.** Approved through human visual review on Operations
Overview (global depth) and Workforce → Professional Details (canonical
drawer).

## Governing rule

**SUBSEQUENT PAGES MUST REUSE THESE IMPLEMENTATIONS. DO NOT REINTERPRET
THEM.**

For every new page:

- **Global visual system:** reuse exactly what is recorded here, through the
  shared code named below. Do not restyle it per page.
- **Page-specific layout:** derive it only from that page's locked
  reference in `docs/ui-reference/p08-e8/canonical/<Page>/`.

The following are finished decisions. Do not refine them again page by
page: sidebar, logo, typography weight, colour saturation, card depth,
drawer styling, buttons, chips and icon styling.

## How a page inherits the system

1. Wrap the page content in **`.chelth-locked`**, for example
   `<div className="chelth-locked flex flex-col gap-5">`. This turns on:
   - the locked palette, defined in `src/app/globals.css` (the
     `.ref-overview, .chelth-locked` block);
   - the locked treatment of the shared primitives, through Tailwind's
     `in-[.chelth-locked]:` variant:
     - `Panel` (`src/components/ui/panel.tsx`);
     - `SectionTabs` (`src/components/ui/section-tabs.tsx`);
     - `StatusChip` (`src/components/ui/status-chip.tsx`);
     - `Button` primary / outline / danger (`src/components/ui/button.tsx`).
2. Use `PageHeader variant="reference"` for the page title.
3. Use the locked blocks in `src/components/reference/locked-reference.tsx`
   for KPI cards, reference tables, chips and avatars:
   - `RefKpiCard` (`lg` Overview, `md` Shifts, `sm` Workforce);
   - `RefPanel` and `RefPanelAction`;
   - `REF_TABLE`;
   - `RefChip`;
   - `InitialsAvatar`;
   - `REF_CARD_FROSTED`;
   - `REF_TEXT`.
4. Use `DetailDrawer width="profile"` plus the canonical drawer anatomy for
   any detail drawer (see C).

Pages not yet built to their locked reference stay on the standard
primitives until their own page pass. That pass is when they adopt
`.chelth-locked`.

---

## A. Canonical Application Shell

Implementation:

- `src/components/layout/app-shell.tsx`
- `workspace-sidebar.tsx`
- `workspace-switcher.tsx`
- `page-container.tsx`
- shell tokens in `globals.css`

Sidebar:

- 214 px wide.
- Deep teal-navy body, `#012B37` → `#003A45`.
- Mint lower ambient wave: an inline decorative SVG (`SidebarWave`) with
  two white wave lines and a teal band, behind the navigation.

Logo:

- The canonical `public/brand/chelth/logo-reverse.svg`, unmodified, at a
  height of 56 px (`BrandLogo variant="reverse"`).
- No effects. Do not redraw, recolour or resize it.

Navigation:

- Rows 45 px tall at a 52 px pitch, with a 22 px icon and a 15 px / 500
  label.
- Active pill: a `#007079` → `#005C63` gradient, a white/35 edge, an inner
  highlight, a faint mint ring and a lift shadow.

Top bar (lg+):

- 76 px, frosted (`rgba(240,247,253,0.78)` with a 10 px blur).
- The workspace identity is one quiet 13 px line.
- User block: 46 px avatar, 15.25 / 500 name, 14 px role.
- No search or notifications (not product features).

Workspace width:

- Sidebar: fixed at 214 px.
- Main workspace: the remaining viewport width (`calc(100vw - 214px)`,
  grid `214px minmax(0,1fr)`).
- Page content: fluid, with small gutters (30 px left / 19 px right
  beside the sidebar; 16 / 24 px below lg).
- Operational screens are fully fluid. `PageContainer size="wide"`
  (AppShell) has `width: 100%`, no max-width and no auto margins: only the
  gutters above. At every desktop width the content runs from the sidebar
  plus 30 px to the viewport minus 19 px. This is asserted by
  `tests/e2e/workspace-width.spec.ts` at 1440 / 1920 / 2560 / 3440.
- Never add a page-level `max-w-*` or `mx-auto` wrapper to an operational
  route. Reading measures (for example `KeyValueList max-w-2xl`, the
  68ch notes) stay on the text itself.

## B. Canonical Overview Depth

Operations Overview
(`src/app/app/organisations/[organisationId]/(workspace)/_components/agency-operations-overview.tsx`)
is the canonical reference for colour depth, typography authority, surface
richness and contrast. Every inner page matches it through A, D–J.

## C. Canonical Drawer

Implementation:

- `DetailDrawer width="profile"` (`src/components/ui/detail-drawer.tsx`);
- anatomy in
  `src/app/app/organisations/[organisationId]/(workspace)/workforce/_components/worker-details-panel.tsx`
  and `src/components/reference/details-tabs.tsx`.

Future Facility, Shift, Attendance, Credential, Timesheet and Financial
detail drawers reuse this visual language with their own real content.

Geometry and behaviour:

- 387 px wide, 178 px from the top, 18 px radius.
- A modal dialog, docked without dim at 1536 px and wider (the page
  contracts beside it); a full-height sheet on phones.

Surface and title:

- Surface: a white → `#FBFEFD` → `#F2FAF7` gradient, a
  `rgba(18,107,103,0.14)` border, and diffused two-layer elevation.
- Title: Manrope 20.5 / 600, ink (no stroke).
- Close control: 44 px, restrained.

Identity header:

- A 90 px initials tile with a luminous mint radial fill, 30 px / 700
  teal-dark initials and a white ring.
- Name: Manrope 23 / 700, ink. Discipline: 15 / 500, slate. Org: 13.5,
  muted.
- Status: `RefChip`, 28 px, semibold.

Metadata rows:

- 28 px pitch, teal-dark icons (2.1 stroke) in a 20 px column, 14 px slate
  text. Real fields only.

Tabs (ARIA, real tabs only):

- 44 px bar, 28 px spacing.
- Active label 14.5 / 600 ink, with a 3 px rounded underline the width of
  the label. Inactive 500, slate-500. The active tab is differentiated by
  colour and underline, not by extra weight.

Sections:

- Headings 16 / 600 ink, 14 px rhythm, teal hairline dividers, no nested
  cards.

Rows:

- Shift and assignment rows: a 36 px mint icon tile.
- Empty states keep the section, with a neutral tile and a quiet note.

Credential rows:

- A 22 px solid semantic glyph with a halo.
- The title 14.5 / 600 ink, wrapping (never truncated); a "Valid to" line.
- A 28 px semibold chip.
- States come only from the readiness engine.

Actions, at the foot:

- Primary: a 48 px deep-teal gradient CTA.
- Secondaries: 48 px outlined, half width.
- Show only actions the product really supports for that user.

## D. Typography Hierarchy

**Status: LOCKED.** Approved through human visual review on Facilities as
the canonical Chelth typography weight system.

Families: Manrope for display, Inter for UI. Weights follow the canonical
scale below on every page, record page and drawer, including future pages.
No `-webkit-text-stroke` faux-bold. 800 and 900 are not used for text.

In words: page titles strong but not heavy; section titles semibold; KPI
labels semibold; KPI values bold; table headers semibold; tabs
medium/semibold; body regular/medium; metadata regular.

| Element                      | Treatment                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------- |
| Page title                   | Manrope 31.5 / 700, heading ink (`PageHeader variant="reference"`)           |
| Page subtitle                | Inter 17.5–18 / 400, muted                                                   |
| Panel / section titles       | Manrope 20 / 600, −0.02em, heading ink (`RefPanel`, `Panel`, drawer title)   |
| Drawer identity name         | Manrope 21–23 / 700, heading ink                                             |
| Drawer section headings      | 16 / 600, heading ink                                                        |
| KPI label                    | Inter 14.75 / 600 (compact variant 13.5 / 600)                               |
| KPI value / stat numerals    | Manrope 30.5–31 / 700                                                        |
| Table headers                | Inter 11.5–13 / 600 (`REF_TABLE`, `DataTableHeaderCell` in `.chelth-locked`) |
| Tabs                         | 14.5; active 600 ink plus underline; inactive 500, slate-500                 |
| Row titles (record lists)    | 15 / 600, heading ink                                                        |
| Body / support / label-value | Inter 400–500                                                                |

Heading ink = `color-mix(in srgb, var(--chelth-navy) 72%, black)`.

Hierarchy comes from size and ink, not from stacking heavy weights: the page
title (700) leads, section titles (600) stay clearly above body (400–500)
and never compete with the page title. Do not lighten inner pages below this
scale.

No drift: do not increase heading weight on subsequent pages. New headings
use the shared styles (`REF_TEXT`, `RefPanel`, `Panel`, `PageHeader`,
`DetailsTabs`, the record primitives) rather than ad-hoc weights. This is
enforced by `tests/unit/components/typography-weight-lock.test.ts`, which
fails on any 800/900 weight or faux-bold stroke in `src/`, and on any change
to the reference scale.

## E. Colour Saturation

The locked palette is defined once in `globals.css`
(`.ref-overview, .chelth-locked`). Do not generate new colours per page.

| Role                     | Value     |
| ------------------------ | --------- |
| Teal (primary / actions) | `#007A70` |
| Teal dark                | `#005A60` |
| Mint                     | `#86E6CF` |
| Mint mist                | `#E1F6F0` |
| Info / blue              | `#2F74F0` |
| Danger / coral           | `#E5484D` |
| Warning / amber          | `#E08A0A` |
| Success / green          | `#12A383` |
| Neutral slate            | `#7A8AA6` |
| Ink                      | `#16243F` |
| Navy                     | `#0C1E46` |
| Muted text               | `#56647F` |

Chip text stays at or above 4.5:1 on its tint. Danger buttons use
`#B42318` for white labels.

## F. Card / Panel Surface

`REF_CARD_FROSTED`, which is also the `Panel` treatment in `.chelth-locked`:

- 12 px radius;
- a `rgba(18,107,103,0.10)` border;
- a white → cool-mint gradient at 92–96%;
- a 10 px backdrop blur;
- a soft navy ambient shadow: `0 10px 30px rgba(13,47,66,0.07)` plus a
  1 px contact shadow.

This is restrained depth, not glassmorphism: no translucent rows, fields
or chips.

## G. Status Chips

- `RefChip`: 26 px, 8 px radius, a filled semantic glyph, 11.5–12.5 px.
- `StatusChip` inside `.chelth-locked`: the same geometry and saturated
  palette.

Vocabulary comes only from existing domain labels: worker status,
readiness, compliance reasons, verification and shift / fill states.

## H. Icon Treatment

- The single family: `WorkspaceNavIcon` (line icons), plus `LocationPin`.
- KPI and drawer tiles: duotone (28% fill, 2.25–2.4 stroke) on luminous
  semantic gradient tiles, with a white inner highlight.
- Metadata and section icons: teal-dark, 2.1 stroke.
- Do not introduce page-specific icon styles or a second icon family.

## I. Canvas Atmosphere

The app canvas (lg+, `app-shell.tsx`):

- an off-white vertical wash, `#FAFCFE` → `#F6FAFC` → `#F1F9FA`;
- a very faint mint radial in the lower right.

No visible bands, neon or glow.

## J. CTA Hierarchy

- **Primary:** a `#00666C` → `#004F55` gradient, a semibold white label, an
  inner highlight and a lift shadow (`Button` primary in `.chelth-locked`;
  the drawer primary).
- **Secondary:** a white surface with a `rgba(0,90,96,0.35)` border, a
  semibold navy label and teal-dark icons (`Button` outline in
  `.chelth-locked`; the drawer secondaries).
- **Links:** the locked teal (`text-primary`, `#007A70`).
- **Destructive:** `#B42318`.

---

## Canonical Record Page Primitives

**All future record pages (Shift record, Attendance record, Timesheet record,
Credential record, Financial records, …) MUST inherit these exact values.**
Worker Record and Facility Record are the reference implementations.

Implementation: `src/components/reference/record-page.tsx`, together with the
shared primitives already locked above.

| Element                                   | Primitive                              | Value                                                                                                                    |
| ----------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Page wrapper and rhythm                   | `RecordPage`                           | `.chelth-locked`, 20 px vertical gap between sections                                                                    |
| Back link                                 | `PageHeader` `back`                    | locked teal link, underlined                                                                                             |
| Entity title                              | `PageHeader variant="reference"`       | Manrope 31.5 / 700, heading ink                                                                                          |
| Subtitle / metadata                       | `PageHeader` `description`             | Inter 17.5 / 400, muted; facts joined with " · "                                                                         |
| Status placement                          | `PageHeader` `meta`                    | status chip first (`StatusChip` / domain badge, locked geometry), then `RecordMeta` (14 / 500 slate) for secondary facts |
| Section tabs                              | `SectionTabs`                          | 14.5 px, active 600 ink, 3 px underline, teal 14% divider; in-page anchors to real sections only                         |
| Panels                                    | `Panel`                                | 12 px radius, `rgba(18,107,103,0.10)` border, white → cool-mint surface, soft navy shadow, 18 px title-to-content gap    |
| Section heading                           | `Panel` `title`                        | Manrope 20 / 600, −0.02em, heading ink                                                                                   |
| Label / value                             | `KeyValueList`                         | labels 500 slate-600; values 500 heading ink; 10 px row gap from sm                                                      |
| Panel copy                                | `RecordNote`                           | 14 / 500 slate-600                                                                                                       |
| Divided lists                             | `RecordList` + `RECORD_ROW`            | teal 12% hairline dividers and top / bottom rule; rows 56 px minimum, 12 px gap, `px-1 py-2.5`                           |
| Row text                                  | `RECORD_ROW_TITLE` / `RECORD_ROW_META` | 15 / 600 heading ink; 13 px slate                                                                                        |
| Row icon tile                             | (drawer icon tile)                     | 36 px mint gradient tile, teal-dark 2.1 stroke icon                                                                      |
| Status block                              | `RecordStatusBlock`                    | 10 px radius, teal 10% border, `#F6FBFA` → `#EEF7F4` surface; icon tile, 28 px chip, "since" meta                        |
| Chips                                     | `RefChip` / `StatusChip`               | 26–28 px, 8 px radius, semibold, saturated locked palette                                                                |
| Readiness                                 | `ReadinessPanel`                       | same status-block surface; green check glyph for met items                                                               |
| Primary / secondary / destructive actions | `Button` and `InlineActionForm`        | the J treatment (destructive `#B42318`)                                                                                  |

Rules:

- Do not hand-write list dividers, row padding or panel surfaces on a record
  page. Use these primitives.
- Content, sections and actions come from the product. Only the
  presentation is fixed here.

---

## Pages on the locked system

| Page                | Status                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Operations Overview | locked (B)                                                                                                       |
| Shifts              | locked system: List / Calendar, Shift Details drawer and shift record (Shifts canonical lock; awaiting approval) |
| Workforce           | locked page and canonical drawer (C)                                                                             |
| Worker Record       | inherits the system (`.chelth-locked`, `PageHeader variant="reference"`); structure unchanged                    |
| Facilities          | locked page, Facility Details drawer and Facility Record                                                         |
| Attendance          | locked page, Attendance Details drawer and Attendance Record                                                     |
| Timesheets          | **locked canonical implementation** (see "Canonical Timesheets Implementation")                                  |
| Timesheet Details   | **locked canonical drawer implementation**                                                                       |
| Timesheet Record    | canonical record arrangement (Canonical Record Page Primitives)                                                  |
| Compliance          | **locked canonical implementation** (see "Canonical Compliance / Credentials Implementation")                    |
| Credential Register | **locked canonical register**                                                                                    |
| Credential Details  | **locked canonical drawer implementation**                                                                       |
| Credential Record   | canonical record arrangement (Canonical Record Page Primitives)                                                  |
| Operations          | locked system in the Notifications list language; current attention centre (S9G option C)                        |
| Notifications       | **deferred**: no route, nav item, badge or bell until In-App Notifications ships (backlog)                       |
| Settings            | **locked canonical implementation** (Credentials & Compliance; see "Canonical Settings Implementation")          |

Next pages: Rates / Pricing, Finance and Worker Mobile. In-app Notifications is a
product feature in `docs/architecture/POST_VISUAL_PRODUCT_BACKLOG.md`. Each
reuses A–J unchanged and derives only its page-specific layout from its own
locked reference.

## Canonical Timesheets Implementation

**Status: LOCKED.** Approved through human visual review (P0-E8-S9E).
Implementation:
`src/app/app/organisations/[organisationId]/(workspace)/timesheets/_components/`
(`agency-timesheets.tsx`, `timesheet-details-panel.tsx`) and
`timesheets/[timesheetId]/page.tsx`.

Page:

- Reference header (title 700, subtitle), read-only period context on the
  right.
- Four `RefKpiCard` lg cards as real status quick filters (`aria-current`
  on the active card).
- Filter row in the Facilities control geometry (46 px, hairline border,
  leading icons).
- `RefPanel` "Current Timesheets" with `REF_TABLE`: 42 px rows, avatar and
  name in `font-medium` ink, the Source chip and the status column
  separated by 12–16 px, and the status chip with its secondary line
  stacked with a 4 px gap.
- `RefPanel` "Recent Timesheet Activity": the same table system as the
  main table (42 px rows, `REF_TEXT.tableHead` / `tableBody`, the same
  worker identity treatment and the same chips).
- Selected row: teal 3 px inset rule and mint fill. With the drawer open at
  1536 px and wider, the whole work area contracts (`pr-[407px]`).

Drawer (canonical C, with these record-detail refinements):

- Identity: worker name (Manrope 21 / 700) as the primary identity, the
  record type ("Weekly timesheet", 14 / 500 slate) and the period as
  supporting metadata (13 px muted). Meta rows hold only real facts.
- Detail facts use `KeyValueList`, the record-page label/value hierarchy
  (labels 500 slate-600, values 500 heading ink).
- Verification block: a soft surface (`#F8FCFB`) with a 7% teal hairline,
  the green semantic glyph, a 500 title and a slate explanation. It
  supports the drawer and never dominates it.
- Audit history uses `ActivityTimeline` (the record-page timeline), with
  semantic dots per event.
- Actions: one deep-teal primary CTA and outlined half-width secondaries.
  Decisions link to the record's existing forms.

Future record-detail drawers (Credentials, Finance) reuse this drawer
anatomy: identity, record type, period or date, `KeyValueList` facts, a soft
verification tile, `ActivityTimeline`, and the action region.

## Canonical Compliance / Credentials Implementation

**Status: LOCKED.** Approved through human visual review (P0-E8-S9F, final
lock polish).
Implementation:
`src/app/app/organisations/[organisationId]/(workspace)/compliance/page.tsx`,
`compliance/_components/credential-details-panel.tsx`,
`compliance/_components/compliance-tones.ts` and
`workforce/[workerId]/credentials/[credentialId]/page.tsx`.

Compliance page:

- Reference header ("Compliance", subtitle) with the real primary action
  only.
- Four `RefKpiCard` sm cards (Up to Date, Expiring Soon, Needs Review,
  Missing). They count readiness-engine results and act as status quick
  filters.
- Filter row in the Facilities control geometry.
- "Agency baseline requirements" panel: the explanatory copy is quieter
  than the rows (13.5 / 400 slate-600, 21 px leading, 68ch measure), so
  each requirement row (15 / 600 heading ink) leads.

Credential Register:

- `RefPanel` with `REF_TABLE`, 48 px rows.
- One row per engine result (worker × requirement), never a client-side
  eligibility calculation.
- Engine reason labels are the status chips. Tones: green met; amber
  expiring or waiting on the worker; blue pending verification or security
  scan; red missing / expired / rejected; slate worker-level.
- Expires: calendar date plus a days-remaining note (amber when the engine
  says expiring soon, red once expired).
- Workforce pager (10 per page). Selected row: teal 3 px inset and mint
  fill.

Row action (all locked tables):

- The canonical row action is the vertical "⋮" `DetailDrawerTrigger`:
  `text-xl font-bold text-chelth-navy`, no border, no underline, 44 px
  touch target (36 px from sm).
- It keeps the global `:focus-visible` ring for keyboard users.
- Every locked table uses it: Shifts, Attendance, Timesheets, Workforce,
  Facilities, Compliance, Rates, Payroll, Invoices and the facility
  workspace (P0-E8-QA-F3 retired the interim horizontal "⋯"). Do not
  introduce outlined or boxed ellipsis buttons.

Credential Details drawer (canonical C, with the Timesheet Details
anatomy):

- Identity: worker (21 / 700), the credential as record type, disciplines,
  and the engine status chip.
- Overview: `KeyValueList` facts, then soft state tiles for the document
  scan state, then verification and expiration. Requirements tab: the
  worker's full engine coverage.
- A document is described as cleared only when the database reports a
  clean document. Documents never open from the drawer; the record gates
  them (audited signed URL, credential.review at AAL2).
- Actions: "Review Credential" (deep-teal primary) and "View Professional"
  (outlined).

Drawer scrollbar (all canonical `width="profile"` drawers):

- Thin, with a teal-hairline thumb `rgba(18,107,103,0.22)` and no track
  (`scrollbar-width: thin`). Scrolling is never removed.

## Canonical Settings Implementation

**Status: LOCKED.** Approved through human visual review on Settings →
Credentials & Compliance (P0-E8 Settings canonical lock). Every existing and
future Settings section reuses this implementation unchanged.
Route: `/app/organisations/[organisationId]/settings` (`settings/layout.tsx`
plus one page per section).

- Sidebar: a real "Settings" item (gear icon, same icon family and stroke)
  is the last item for every workspace member. It sits in its own
  "Administration" list in the same flat column; there is no visible
  divider and no badge.
- Layout: the reference page header, then a 264 px secondary section
  navigation (`SettingsNav`: icon + label rows; the current section has a
  mint fill and a 3 px teal left rule; `aria-current="page"`; scrolls
  horizontally on phones). Beside it, the section work area is
  left-aligned and capped at 1180 px for readable forms. This is the
  administration width, not a centred website column.
- Cards: the canonical `Panel` (title 20 / 600 plus a description), with
  `KeyValueList` for read-only values and the existing feature forms
  (canonical inputs, selects and buttons) for real mutations.
- Sections exist only where Chelth has real configuration:
  - Organization (read-only workspace details and operational preferences
    summary);
  - Team & Permissions;
  - Attendance & Geofencing;
  - Timesheets & Payroll;
  - Rates & Billing;
  - Credentials & Compliance;
  - Security.
    The reference's Notifications, Shifts & Scheduling, Integrations and
    Workspace lifecycle sections are deliberately absent until those
    features exist.
- Each section is capability-gated with the same predicate as its page
  (404 otherwise). There is no fake Save button: read-only values are
  shown read-only.
- Administration moved here: Members, Invitations and the audit log
  (formerly on Overview), the attendance rules and retention panel
  (formerly on Attendance), and payroll settings and maker-checker
  (formerly on Payroll). Those pages now link to Settings.

### Settings canonical patterns (locked)

Shared code: `settings/layout.tsx` (SettingsLayout),
`settings/_components/settings-nav.tsx` (SettingsSubnav) and
`settings/_components/settings-ui.tsx` (everything below). The card is the
locked `Panel`; no Settings section defines its own card, tile, row or CTA.

| Pattern                  | Implementation                                       | Locked values                                                                                                                             |
| ------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Page header              | `PageHeader variant="reference"`                     | "Settings" 31.5 / 700; one subtitle line, muted                                                                                           |
| Layout                   | `settings/layout.tsx`                                | 264 px subnav + work area (max 1180 px), 16 / 20 px gap; stacks below lg                                                                  |
| Subnav item              | `SettingsNav`                                        | 46 px (44 px touch), 8 px radius, 21 px icon at 1.9 stroke in a 22 px column, 14.5 px label (500; current 600 heading ink)                |
| Subnav selected          | `SettingsNav`                                        | mint-mist 80% fill, 3 px teal left rule, `rgba(12,30,70,0.09)` navy hairline; no shadow — always quieter than the sidebar's selected pill |
| Subnav position          | `SettingsNav`                                        | desktop: sticky 92 px (16 px below the 76 px top bar); below lg: one scrolling row that opens scrolled to the current section             |
| Card                     | `Panel` in `.chelth-locked`                          | F surface: 12 px radius, teal 10% border, canonical two-layer shadow; title 20 / 600; one-sentence description; optional header chip      |
| Icon tile                | `SettingsIconTile`                                   | 36 px, 10 px radius, 18 px icon at 2.1 stroke; mint by default; info / warning / danger tints only where the row means that status        |
| Icon-led list / row      | `SettingsExplanationList` / `SettingsExplanationRow` | teal hairline dividers; 56 px rows; title 15 / 600 ink; one 13 px slate line; trailing chips wrap under on narrow widths                  |
| Outcome chips            | `SettingsStatusSummary`                              | "Label:" 13.5 / 500 slate, then `RefChip`s (400) — success / warning / danger / info / neutral by real meaning                            |
| Actions                  | `SettingsActionRow` / `SettingsActionLink`           | outlined secondary CTA (J): 44 px, 8 px radius, `rgba(0,90,96,0.35)` border, 14 / 600 navy, optional teal-dark 18 px icon; 10 px gap      |
| Related areas            | `SettingsRelatedLinks`                               | navigation-only link cards (icon tile, 14.5 / 600 title, 12.5 slate purpose), 1 / 2 / 3 columns, equal height; no metrics or controls     |
| Account / workspace menu | `workspace-switcher.tsx`                             | as approved in S9H1: white, 12 px radius, drawer shadow, teal hairlines, 44 px rows; Escape closes and returns focus                      |

Semantic chips: Ready / Active / Requirement met = success (teal / mint);
Warning / Action required = warning (amber); Error / Not eligible = danger
(red); informational = info (blue) or neutral (slate). Compact and subdued
(`RefChip`, 26 px).

Explanatory pattern (from "How Readiness Is Calculated"): section title, one
explanatory sentence, the icon-led list, optional outcome chips, then related
navigation actions. Use it only where a section needs explanation.

Rule card pattern (from "Credential Requirement Rules"): title, short
explanation, active-count chip, one row per real rule with semantic chips,
then actions to the real destinations. No editable control without a backing
mutation.

Standalone navigation links in Settings sections use `SettingsActionLink`;
inline "Change" links inside a `KeyValueList` value stay text links.
