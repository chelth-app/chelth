# CHELTH DESIGN TOKENS

Version: B3.2
Status: LOCKED FOUNDATION

## Color tokens

| Token              | Value     | Use                  |
| ------------------ | --------- | -------------------- |
| `brand.teal`       | `#126B67` | Primary brand/action |
| `brand.tealDark`   | `#0D514F` | Hover/dark brand use |
| `brand.navy`       | `#193348` | Authority/headings   |
| `text.ink`         | `#17272D` | Primary body text    |
| `text.slate`       | `#657780` | Secondary text       |
| `brand.mint`       | `#B8DDD5` | Supporting accent    |
| `brand.mintMist`   | `#E8F3F0` | Subtle highlights    |
| `surface.cloud`    | `#F3F6F5` | Soft backgrounds     |
| `surface.offWhite` | `#FAFBFA` | App canvas           |
| `surface.white`    | `#FFFFFF` | Cards/forms          |
| `border.default`   | `#DDE5E3` | Default borders      |
| `status.success`   | `#28826F` | Confirmed/success    |
| `status.warning`   | `#B57A31` | Warning/attention    |
| `status.critical`  | `#B34D4D` | Critical/errors      |
| `status.info`      | `#527B96` | Neutral information  |

## Typography tokens

Marketing font family:
`Manrope, sans-serif`

Product/UI font family:
`Inter, sans-serif`

### Marketing scale

Hero:

- 64 / 68
- weight 600

H1:

- 52 / 58
- weight 600

H2:

- 40 / 46
- weight 600

H3:

- 28 / 34
- weight 600

H4:

- 22 / 28
- weight 600

Body Large:

- 19 / 30
- weight 400

Body:

- 16 / 26
- weight 400

Small:

- 14 / 21
- weight 400

### Mobile marketing

Hero:

- 40 / 44
- weight 600

## Radius tokens

- `radius.sm`: 6 px
- `radius.md`: 8 px
- `radius.lg`: 12 px
- `radius.marketing`: 16 px

## Shadow tokens

Default:
`0 4px 16px rgba(21, 45, 49, 0.06)`

Elevated:
`0 8px 24px rgba(21, 45, 49, 0.08)`

Do not introduce stronger shadows without explicit design review.

## Border tokens

Default:
`1px solid #DDE5E3`

Strong:
`1px solid #C9D4D1`

## Button tokens

Primary:

- background: `#126B67`
- text: `#FFFFFF`
- hover: `#0D514F`
- radius: `8px`
- min-height: `44px`

Secondary:

- background: transparent / white
- text: `#193348`
- border: `#DDE5E3`
- radius: `8px`

## Layout principles

- Prefer clear grid alignment.
- Avoid excessive nested cards.
- Use white space to separate responsibility, not decoration.
- Operational tables are first-class components.
- Teal indicates action/selection, not decoration.
- Semantic colors must indicate real status.
