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

Content gutters: 30 px left / 19 px right beside the sidebar.

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
  and `details-tabs.tsx`.

Future Facility, Shift, Attendance, Credential, Timesheet and Financial
detail drawers reuse this visual language with their own real content.

Geometry and behaviour:

- 387 px wide, 178 px from the top, 18 px radius.
- A modal dialog, docked without dim at 1536 px and wider (the page
  contracts beside it); a full-height sheet on phones.

Surface and title:

- Surface: a white → `#FBFEFD` → `#F2FAF7` gradient, a
  `rgba(18,107,103,0.14)` border, and diffused two-layer elevation.
- Title: Manrope 20.5 / 800, ink, with a 0.2 px stroke.
- Close control: 44 px, restrained.

Identity header:

- A 90 px initials tile with a luminous mint radial fill, 30 px / 800
  teal-dark initials and a white ring.
- Name: Manrope 23 / 800, ink. Discipline: 15 / 500, slate. Org: 13.5,
  muted.
- Status: `RefChip`, 28 px, semibold.

Metadata rows:

- 28 px pitch, teal-dark icons (2.1 stroke) in a 20 px column, 14 px slate
  text. Real fields only.

Tabs (ARIA, real tabs only):

- 44 px bar, 28 px spacing.
- Active label 14.5 / 700 ink, with a 3 px rounded underline the width of
  the label. Inactive 500, slate-500.

Sections:

- Headings 16 / 800 ink, 14 px rhythm, teal hairline dividers, no nested
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

Families: Manrope for display, Inter for UI.

| Element                | Treatment                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| Page title             | Manrope 31.5 / 800, heading ink, with a 0.4 px stroke (`PageHeader variant="reference"`) |
| Page subtitle          | Inter 17.5 / 400, muted                                                                  |
| Panel / section titles | Manrope 20 / 800, −0.02em, heading ink                                                   |
| KPI value              | Manrope 30.5 / 700; KPI label Inter 14.75 / 500                                          |
| Tables                 | Inter 11.5–13.5 (per page reference); headers regular / semibold per reference           |
| Tabs                   | the C treatment                                                                          |

Heading ink = `color-mix(in srgb, var(--chelth-navy) 72%, black)`.

Do not lighten or soften inner pages.

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

## Pages on the locked system

| Page                | Status                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Operations Overview | locked (B)                                                                                       |
| Shifts              | page pass done before the lock. It adopts `.chelth-locked` at its next pass, without a redesign. |
| Workforce           | locked page and canonical drawer (C)                                                             |
| Worker Record       | inherits the system (`.chelth-locked`, `PageHeader variant="reference"`); structure unchanged    |

Next pages: Facilities, Attendance, Timesheets, Credentials, Finance and
Worker Mobile. Each reuses A–J unchanged and derives only its
page-specific layout from its own locked reference.
