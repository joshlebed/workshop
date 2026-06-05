# Design

## Theme

Default to dark; light mode follows the system. A couple thumbing through a
shared list at night on the couch is the scene that forced the answer; light
mode exists so the same screens stay readable on a sunny train.

## Color strategy

**Restrained.** Warm-tinted near-black canvas, one warm amber accent at ≤10% of
any surface. Per-list color (the seven `tokens.list.*` hues) identifies a list
inside its avatar/badge only; the rest of the chrome stays neutral. Never use
`#000` or `#fff`.

Every neutral is tinted warm (OKLCH hue ~66, the amber accent's own hue) at very
low chroma, so canvas, surface, and elevated belong to one family and step up in
lightness rather than shifting hue. Canvas is always the darkest layer. (A prior
navy `#081325` canvas under neutral surfaces read as the "dark-glow AI app"
look the brand explicitly avoids; the warm ramp replaced it.) Values derived in
OKLCH and checked for WCAG AA: `text.muted` clears 4.5:1 on both canvas and
surface in both modes.

## Color palette (OKLCH-equivalent hex)

Dark:

- `bg.canvas` `#0E0C0B` · `bg.surface` `#191715` · `bg.elevated` `#24221F`
- `text.primary` `#F2F0ED` · `text.secondary` `#A7A29E` · `text.muted` `#86817C`
- `border.subtle` `#2D2926` · `border.default` `#3C3835` · `border.strong` `#55504C`

Light:

- `bg.canvas` `#FEFCFA` · `bg.surface` `#F7F4F2` · `bg.elevated` `#EFECE9`
- `text.primary` `#1F1B17` · `text.secondary` `#554F49` · `text.muted` `#726C66`
- `border.subtle` `#E3DFDA` · `border.default` `#D4CEC9` · `border.strong` `#AFA8A1`

Shared:

- accent `#F5A524` (hover `#E89611`, muted `#F5A52422`), `text.onAccent` `#0E0C0B`
- status: success `#3DD68C`, warning `#F5A524`, danger `#F05252`
- list hues: sunset, ocean, forest, grape, rose, sand, slate

## Typography

System font stack (SF on iOS, system-ui on web). Size scale (`font.size`):
12/13/16/18/22/28. Weights: 400/500/600/700. Hierarchy through scale + weight
contrast. Each `Text` variant carries its own line-height so vertical rhythm is
correct by default: title 28/600 (line-height 34, tracking -0.4), heading 18/600
(24, -0.2), body 16/400 (22), label 13/500 (18), caption 12/400 (16). Captions
used as uppercase eyebrows track +0.5–0.8. Large titles take negative tracking;
RN's auto line-height runs tight on heavy weights, so lean on the variant's.

## Spacing & radius

Spacing: 4 · 8 · 12 · 16 · 24 · 32. Radius: 6 · 10 · 14 · pill.

## Components

- **Row.** Avatar + body + chevron. The dominant pattern on every list-bearing
  screen (home, list-detail item rows, type picker). Avatars are 44 with a
  20% tinted background of the row's accent + a 22 emoji.
- **Card.** Used sparingly; never nested. Default to no container.
- **FAB.** Bottom-right; 56/28-radius primary accent; only on screens with a
  single primary action. Elevation is a **neutral** drop shadow
  (`rgba(0,0,0,…)`), never a colored/accent halo: the accent fill carries the
  warmth, a glow would read as the "AI app" aesthetic the brand avoids.
- **Button.** Primary (filled accent), secondary (outlined), ghost (text).
- **Filter pill.** Rounded `radius.pill` input with leading icon; lives inside
  list-detail.

## Motion

System defaults plus exponential ease-out where animation is added. No bounce.
No animated layout properties.

## Anti-patterns to refuse

- Side-stripe borders. Gradient text. Decorative glassmorphism. Hero-metric
  templates. Identical card grids. Em dashes in copy.
