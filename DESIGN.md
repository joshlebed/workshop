# Design

## Theme

Default to dark; light mode follows the system. A couple thumbing through a
shared list at night on the couch is the scene that forced the answer; light
mode exists so the same screens stay readable on a sunny train.

## Color strategy

**Restrained.** Tinted near-black canvas, one warm amber accent at ≤10% of any
surface. Per-list color (the seven `tokens.list.*` hues) identifies a list
inside its avatar/badge only; the rest of the chrome stays neutral. Never use
`#000` or `#fff`.

## Color palette (OKLCH-equivalent hex)

Dark:

- `bg.canvas` `#0E0E10` · `bg.surface` `#16161A` · `bg.elevated` `#1F1F25`
- `text.primary` `#F2F2F5` · `text.secondary` `#A8A8B3` · `text.muted` `#6E6E78`
- `border.subtle` `#26262E` · `border.default` `#33333D` · `border.strong` `#4A4A56`

Light mirrors with the same semantic names.

Shared:

- accent `#F5A524` (hover `#E89611`, muted `#F5A52422`)
- status: success `#3DD68C`, warning `#F5A524`, danger `#F05252`
- list hues: sunset, ocean, forest, grape, rose, sand, slate

## Typography

System font stack (SF on iOS, system-ui on web). Sizes: 12/13/16/18/22/30.
Weights: 400/500/600/700. Hierarchy through scale + weight contrast; titles
26/600, headings 16/600, body 14/400, captions 11/400. Captions used as
uppercase eyebrows track +0.3.

## Spacing & radius

Spacing: 4 · 8 · 12 · 16 · 24 · 32. Radius: 6 · 10 · 14 · pill.

## Components

- **Row.** Avatar + body + chevron. The dominant pattern on every list-bearing
  screen (home, list-detail item rows, type picker). Avatars are 44 with a
  20% tinted background of the row's accent + a 22 emoji.
- **Card.** Used sparingly; never nested. Default to no container.
- **FAB.** Bottom-right; 56/28-radius primary accent; only on screens with a
  single primary action.
- **Button.** Primary (filled accent), secondary (outlined), ghost (text).
- **Filter pill.** Rounded `radius.pill` input with leading icon; lives inside
  list-detail.

## Motion

System defaults plus exponential ease-out where animation is added. No bounce.
No animated layout properties.

## Anti-patterns to refuse

- Side-stripe borders. Gradient text. Decorative glassmorphism. Hero-metric
  templates. Identical card grids. Em dashes in copy.
