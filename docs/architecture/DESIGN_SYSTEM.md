# Design System Foundation

Brand: **Chelth** — _Healthcare Workforce Operations_.

**Source of truth (locked, B3):** [../brand/CHELTH-BRAND-GUIDELINES.md](../brand/CHELTH-BRAND-GUIDELINES.md),
[../brand/CHELTH-DESIGN-TOKENS.md](../brand/CHELTH-DESIGN-TOKENS.md),
[../brand/CLAUDE-CHELTH-BRAND-RULES.md](../brand/CLAUDE-CHELTH-BRAND-RULES.md),
`src/styles/brand.css` (values) and `public/brand/chelth/` (logo and icon
assets). This document only describes how the application consumes them.
Where this file and the brand documents disagree, the brand documents win.

A live reference is available at `/design-system` in non-production
environments.

## Tokens

- `src/styles/brand.css` holds every brand value as `--chelth-*` custom
  properties plus base element rules. It is kept byte-for-byte as approved
  (excluded from Prettier) and imported into the `base` cascade layer in
  `src/app/globals.css`, so Tailwind utilities always take precedence over its
  element rules.
- `src/app/globals.css` maps those variables into Tailwind with
  `@theme inline`: every brand colour is available as `chelth-*`
  (`bg-chelth-teal`, `text-chelth-navy`, `border-chelth-border`…), plus
  `font-display`, `shadow-card`, `shadow-elevated`, `rounded-marketing`.
- Components use **semantic** tokens. Brand-equivalent semantic tokens resolve
  to the brand variables:

| Semantic token                  | Brand value                               |
| ------------------------------- | ----------------------------------------- |
| `background`                    | Off White `#FAFBFA`                       |
| `surface` / `surface-muted`     | White `#FFFFFF` / Cloud `#F3F6F5`         |
| `foreground`                    | Ink `#17272D`                             |
| `border`                        | Border `#DDE5E3`                          |
| `primary` / `primary-hover`     | Deep Teal `#126B67` / Teal Dark `#0D514F` |
| `secondary` / `secondary-hover` | Navy `#193348` / Ink `#17272D`            |
| `accent-soft` / `-foreground`   | Soft Mint `#B8DDD5` / Teal Dark           |
| `focus-ring`                    | Navy                                      |
| radii `sm` / `md` / `lg`        | 6 / 8 / 12 px (marketing max 16)          |

### Accessibility exceptions (kept pending design review)

| Brand value                | Problem                                             | App keeps                                                   |
| -------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| Slate `#657780` as text    | 4.49:1 on Off White, 4.29:1 on Cloud (AA needs 4.5) | `muted-foreground` `#475569`, `subtle-foreground` `#64748B` |
| Border `#DDE5E3` on inputs | 1.28:1 (form controls need 3:1)                     | `input-border` `#64748B`                                    |
| Warning `#B57A31` as text  | 3.63:1 on white                                     | status text via `warning-soft-foreground`                   |

Status colours (P0-E8-S2) are derived from the brand semantic palette
(`--chelth-success`, `-warning`, `-critical`, `-info`, `-slate`): soft
background = brand colour 12% on white, soft foreground = brand colour 62% +
Ink 38%, indicator = the brand colour. Tones: `neutral`, `info`, `success`,
`warning`, `danger`, `attention` (Critical + Warning). Text on its soft
background: 5.55–6.91:1. `danger` (destructive button) = Critical, white text
5.14:1.

### Contrast (WCAG 2.2 AA verified)

| Pair                           | Ratio |
| ------------------------------ | ----- |
| White on Deep Teal (primary)   | 6.32  |
| White on Teal Dark (hover)     | 9.10  |
| White on Navy (secondary)      | ≥ 12  |
| Ink on Off White (body)        | 14.84 |
| Navy on Off White (headings)   | 12.59 |
| Teal Dark on Soft Mint (badge) | 6.22  |
| Navy focus ring on white       | 13.06 |

Do not place Deep Teal text on Soft Mint (4.31:1).

## Typography

- **Inter** (product/UI) and **Manrope** (display/marketing), both self-hosted
  via `@fontsource-variable/*` (no third-party font requests; CSP
  `font-src 'self'`). They register as "Inter Variable" / "Manrope Variable";
  `globals.css` prepends those names to `--chelth-font-ui` /
  `--chelth-font-display` so the brand rules resolve to the loaded fonts.
- `brand.css` sets `h1`–`h4` in Manrope, Navy; body text is Inter, Ink.
  Utilities: `font-sans` (Inter), `font-display` (Manrope).
- Scale: Tailwind defaults. Page title `text-2xl`–`text-4xl font-semibold`;
  section `text-lg font-semibold`; body `text-base`; secondary `text-sm
text-muted-foreground`; metadata `text-xs`.
- Inputs use `text-base` (16 px) to prevent iOS zoom.
- Product typography reference (promoted in P0-E8-S1 from the approved UI
  library, byte-for-byte): [../brand/CHELTH-PRODUCT-TYPOGRAPHY.md](../brand/CHELTH-PRODUCT-TYPOGRAPHY.md)
  — Manrope for page titles, section headings and KPI values; Inter for all
  UI, navigation, tables, forms and status chips. Pages adopt its scale as
  they are restyled (P0-E8-S2+); the shell already follows it (workspace name
  in Manrope, navigation in Inter).

## Logo and icons

Use only the canonical files in `public/brand/chelth/`; never typeset the
wordmark or draw the mark.

- `BrandLogo` (`src/components/shared/brand-logo.tsx`) is the only way to show
  the logo in the app: `primary` (light surfaces: home, auth), `reverse` (Navy
  / Deep Teal surfaces), `monochrome`, `mark` (Shift Mark only: app header,
  compact/mobile). Heights are clamped to the brand minimums (lockup 48 px ≈
  140 px wide; mark 20 px). It renders a plain `<img>` with width/height
  attributes: `next/image` emits an inline style that the strict CSP blocks,
  and SVGs need no optimisation.
- Browser icons (`src/app/layout.tsx` `metadata.icons`): `favicon.ico`,
  `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`.
  `/favicon.ico` is rewritten to the canonical file (`next.config.ts`), so no
  copy exists outside `public/brand/chelth/`.
- Web manifest (`src/app/manifest.ts`, served at `/manifest.webmanifest`):
  `icon-192x192`/`icon-512x512` (`any`) and `icon-maskable-192x192`/
  `icon-maskable-512x512` (`maskable`); theme Deep Teal, background Off White.
- E2E (`tests/e2e/foundation.spec.ts`) asserts every canonical asset is served
  and that the head and manifest reference only these files.

## Spacing and layout

- Tailwind 4 px spacing scale. Common rhythm: `gap-1.5` (field internals),
  `gap-3`/`gap-4` (within sections), `gap-6`–`gap-10` (between sections).
- `PageContainer`: `px-4 sm:px-6 lg:px-8` gutters; `size="default"` is
  `max-w-6xl` (personal and public pages), `size="wide"` is
  `max-w-screen-2xl` (workspace shell content beside the sidebar).
- Mobile-first: design at 360 px first; desktop enhances.
- Minimum interactive height 44 px (`Button` `md`, `Input`).

## Workspace shell (`src/components/layout`, P0-E8-S1)

The shared authenticated Agency / Facility shell around
`/app/organisations/[organisationId]/**` (route group `(workspace)`):

| Component            | Notes                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppShell`           | `lg`+: persistent 240 px sidebar + sticky top bar + Off White canvas; below `lg` the sidebar is not rendered in the page                     |
| `WorkspaceSidebar`   | `shell-sidebar` → `shell-sidebar-deep` vertical tint, canonical `reverse` logo, `<nav aria-label="Workspace">`, grouped lists                |
| `SidebarNavItem`     | `aria-current="page"`; active = Deep Teal pill + Mint indicator bar + semibold (never colour alone); 44 px rows                              |
| `WorkspaceHeader`    | narrow-viewport menu trigger, Shift Mark, current workspace name and type; no search field and no notification bell (they do not exist)      |
| `WorkspaceSwitcher`  | disclosure: identity, role, current workspace, switch between existing memberships (`selectOrganisationAction`), Account, Security, Sign out |
| `MobileWorkspaceNav` | the same sidebar in a native modal `<dialog>`: focus trap, Escape, inert background, focus return to the trigger, closes on navigation       |

Navigation items come from `buildWorkspaceNavigation`
(`src/features/organisations`), which lists a route only when the caller holds
the capability that page requires; the shell renders what it is given. Members
with self-service access only (agency healthcare workers) and the worker
self-service pages (`(self-service)`: My shifts, My credentials) keep the
personal frame.

Shell tokens (`globals.css`, derived only from `brand.css`):

| Token                      | Value                              |
| -------------------------- | ---------------------------------- |
| `shell-sidebar`            | Teal Dark `#0D514F`                |
| `shell-sidebar-deep`       | Teal Dark 72% + Navy (`#10494D`)   |
| `shell-sidebar-foreground` | White (9.10 / 10.09:1)             |
| `shell-sidebar-muted`      | Soft Mint (group labels, 6.22:1)   |
| `shell-sidebar-hover`      | White 8% overlay                   |
| `shell-sidebar-active`     | Deep Teal (white text 6.32:1)      |
| `shell-sidebar-indicator`  | Soft Mint                          |
| `shell-sidebar-divider`    | White 18% overlay                  |
| `shell-sidebar-focus`      | White (focus ring on dark sidebar) |
| canvas / content divider   | existing `background` / `border`   |

## Components (`src/components/ui`)

| Component                                          | Notes                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                           | variants primary/secondary/outline/ghost/danger; sizes sm/md/lg; `loading` sets `aria-busy` + disabled; defaults to `type="button"`   |
| `Input`, `Label`                                   | `invalid` → `aria-invalid`; visual `*` marker is aria-hidden — the control's native `required` is announced (no duplicate "required") |
| `FormField`                                        | wires `id`, label, description and errors (`aria-describedby`, `aria-invalid`) — use for every form control                           |
| `Badge`                                            | tones neutral/brand/info/success/warning/danger; meaning must be in the text, never colour alone                                      |
| `Card` (+ Header/Title/Description/Content/Footer) |                                                                                                                                       |
| `Dialog`                                           | native `<dialog>` + `showModal()`: focus trap, Escape, inert background, focus restore; no inline styles (CSP-safe)                   |
| `Select`                                           | native `<select>`: robust keyboard/screen-reader support on every platform                                                            |
| `Spinner`, `LoadingState`                          | `role="status"`                                                                                                                       |
| `ErrorState`                                       | `role="alert"`; shows safe message and optional reference only                                                                        |

### Operational primitives (P0-E8-S2)

Compose pages from these; keep cell content page-specific.

| Component                                       | Notes                                                                                                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader`                                    | one `h1` (Manrope 600, 32/40, -0.03em; 28/36 on phones), supporting copy (Inter 16/24), `back`, `meta`, `primaryAction`, `secondaryActions` slots                      |
| `KpiFilterCard`, `KpiFilterGroup`               | real counts only (no charts, sparklines or deltas); link or static; active = `aria-current="true"` + visible "Showing" + heavier border                                |
| `FilterBar`, `FilterField`, `FilterSelect`      | named native GET form, labels above controls, submit + optional clear link + actions; wraps on phones; no global search                                                |
| `DataTableRegion`                               | THE scroll container for wide tables: `relative overflow-x-auto`, `role="region"`, required name, `tabIndex=0`. A unit test fails if bypassed                          |
| `DataTable` (+`Head`/`HeaderCell`/`Row`/`Cell`) | density, header, hover, `selected` (`aria-selected` + Mint Mist), `numeric` cells                                                                                      |
| `DataTablePagination`                           | cursor pagination as a named `nav`; 44 px links                                                                                                                        |
| `StatusChip`                                    | soft chip + decorative dot; six semantic tones; the text carries the meaning. Domain status badges render through it                                                   |
| `SectionTabs`                                   | route tabs: a named `nav` of links with `aria-current="page"` (never ARIA tabs for navigation); scrolls inside itself on phones                                        |
| `DetailDrawer`, `DetailDrawerTrigger`           | P5: native modal `<dialog>` — right panel on desktop (sm/md/lg widths), full-screen sheet on phones; Escape, focus trap, focus return. Never replaces the record route |
| `KeyValueList`                                  | `dl` of label/value pairs; stacks on phones                                                                                                                            |
| `ActivityTimeline`                              | ordered list with semantic dots                                                                                                                                        |
| `EmptyState`, `ErrorState`, `LoadingState`      | P9: icon tile, title, one sentence, one action; Error keeps `role="alert"` + reference, Loading keeps `role="status"`                                                  |

`Panel` / `PanelLink` (P0-E8-S3): titled card (P2 dashboard panel, P4 record
section) — a region named by its heading, one header action ("View all →"),
optional anchor `id`. Record pages also use `SectionTabs` as an in-page
section list (links to `#heading-id`, no `aria-current`), rendered only for
sections that exist for the viewer.

`FilterBar` controls are uncontrolled: give the bar a `key` derived from the
current filter values so it remounts when a quick-filter link changes the URL
on the client.

`Badge` remains for non-status labels (organisation type, role names).

Ownership: these components are ours. We do not depend on a component
framework runtime. If a complex primitive (combobox, date picker, menu) is
needed later, prefer adopting an accessible headless primitive (e.g. Radix /
React Aria) wrapped in an owned component here, and verify it under our CSP
(some libraries inject inline styles and need nonce support).

## Accessibility checklist for new components

- Semantic element first; ARIA only to fill gaps.
- Fully keyboard operable; visible `:focus-visible` (global style — never
  remove outlines without a replacement).
- Labels for every control (use `FormField`).
- Announce async state (`role="status"`) and errors (`role="alert"`).
- Respect `prefers-reduced-motion` (global style).
- Contrast verified against the table above.
- Covered by an axe check on the design-system page.
