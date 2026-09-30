# Design System Foundation

Brand: **CHELTH** — _Healthcare workforce operations_.
Qualities: reliable, calm, operational, trusted, premium, healthcare-native.
Not futuristic, not AI-centric.

A live reference is available at `/design-system` in non-production
environments.

## Tokens

Defined once in `src/app/globals.css` (`@theme`). Components use **semantic**
tokens so the brand palette can evolve without editing components.

| Brand colour | Hex       | Semantic use                            |
| ------------ | --------- | --------------------------------------- |
| Deep Teal    | `#0F766E` | `primary` (actions, brand)              |
| Slate Navy   | `#1E3A8A` | `secondary`, `focus-ring`, info text    |
| Cool Gray    | `#64748B` | `subtle-foreground`, `input-border`     |
| Soft Mint    | `#B7E4D9` | `accent-soft` (brand badges/highlights) |
| Off White    | `#F8FAFC` | `background`                            |

Additional semantic tokens: `surface`, `surface-muted`, `foreground`,
`muted-foreground`, `border`, and `danger` / `warning` / `success` / `info`
with `-soft` backgrounds and `-soft-foreground` text.

### Contrast (WCAG 2.2 AA verified)

| Pair                                            | Ratio                 |
| ----------------------------------------------- | --------------------- |
| White on teal (primary button)                  | 5.47                  |
| White on navy                                   | 10.36                 |
| Cool gray on white / off-white                  | 4.76 / 4.55           |
| Teal-900 on mint                                | 6.82                  |
| Status soft pairs (danger/warning/success/info) | 6.37 – 8.49           |
| Input border (cool gray) vs white               | 4.76 (≥ 3:1 non-text) |

**Do not** place brand teal text on mint (3.94:1 — fails for body text); use
`accent-soft-foreground`. Focus rings use a 2 px offset so they are measured
against the page background (navy on white 10.36:1).

## Typography

- Inter Variable, self-hosted via `@fontsource-variable/inter` (no runtime
  requests to third-party font CDNs; CSP `font-src 'self'`).
- Scale: Tailwind defaults. Page title `text-2xl`–`text-4xl font-semibold`;
  section `text-lg font-semibold`; body `text-base`; secondary `text-sm
text-muted-foreground`; metadata `text-xs`.
- Inputs use `text-base` (16 px) to prevent iOS zoom.

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
