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

Status colours (`danger`, `warning`, `success`, `info` and their `-soft`
pairs) are not yet aligned to the brand semantic palette (see the B3 report).

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
- `PageContainer`: `max-w-6xl` with `px-4 sm:px-6 lg:px-8` gutters.
- Mobile-first: design at 360 px first; desktop enhances.
- Minimum interactive height 44 px (`Button` `md`, `Input`).

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
