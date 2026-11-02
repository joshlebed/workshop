# HighScore visual design brief

The binding visual-language spec for HighScore (`apps/highscore`). Layout and screen
structure may change freely; **everything in this document may not**. Agents restyling the
app implement against these tokens and rules exactly — divergence is a bug, not a take.

## Identity in one line

A dark arcade: dark-grey room, deep-purple machines, 70s/80s neon light in pink, yellow,
and green. Retro 8-bit / pixel treatment in type, icons, and edges — sharp, glowing, and a
little loud where it counts, quiet everywhere else.

## Non-negotiables (summary)

1. **Dark-only.** No light mode. Delete/ignore light-token paths; `useColorScheme()` is
   irrelevant to HighScore styling.
2. **App-owned theme.** All colors/type/shape tokens live in `apps/highscore/src/theme/`.
   No visual token may be imported from `@workshop/ui` (repo rule: HighScore branding has
   zero Workshop effect). Shared `@workshop/ui` components may remain temporarily, but any
   surface an agent touches gets restyled onto HighScore tokens.
3. **Pixel type is for exactly three things: the `HIGHSCORE` wordmark, game names, and score
   numerals.** Everything else is set in Space Grotesk.

## Palette (dark-only)

| Token            | Value                   | Role                                                      |
| ---------------- | ----------------------- | --------------------------------------------------------- |
| `bg`             | `#121216`               | App background — near-black grey, slightly cool           |
| `surface.1`      | `#1C1528`               | Cards, sheets — lowest purple                             |
| `surface.2`      | `#251B36`               | Raised elements, inputs                                   |
| `surface.3`      | `#2F2244`               | Highest elevation, pressed/hover fills                    |
| `border`         | `#3D2E55`               | Standard 2px bezel on cards/buttons/inputs                |
| `primary`        | `#FF3D9A`               | Neon pink — CTAs, links, active states, selection         |
| `primary.glow`   | `rgba(255,61,154,0.45)` | Glow shadow for primary elements                          |
| `success`        | `#C6FF3D`               | Neon chartreuse — success, streaks, positive scores, wins |
| `success.glow`   | `rgba(198,255,61,0.40)` | Glow for celebration moments                              |
| `accent`         | `#FFE93D`               | Neon yellow — spotlight/rank moments, brand decoration    |
| `accent.glow`    | `rgba(255,233,61,0.40)` | Glow for spotlight moments                                |
| `warning`        | `#FFC53D`               | Amber — sparingly; duller than `accent` on purpose        |
| `danger`         | `#FF4D5E`               | Destructive actions, errors                               |
| `text.primary`   | `#F2EFFA`               | Primary text                                              |
| `text.secondary` | `#A99EC2`               | Secondary text, captions, timestamps                      |
| `text.onPrimary` | `#121216`               | Text on pink or chartreuse fills (dark, not white)        |

Rules:

- **Pink is the one interactive color.** Buttons, links, tab-active, focus rings. Never
  use chartreuse for a CTA.
- **Chartreuse is earned.** Success states, streak flames, personal bests, positive score
  deltas. It's the celebration color; overuse kills it.
- **Yellow is the spotlight.** #1 rank / leader crowns, "today" markers, badges and
  medals, and brand decoration (wordmark accent, marketing surfaces). It marks _what to
  look at_, never _what to tap_ (pink) or _what went well_ (chartreuse). Keep it distinct
  from `warning` amber — warnings use amber, spotlights use neon yellow.
- Neon on dark fills: prefer text/borders/glows in neon over large solid neon fills. A
  filled primary button is fine; a neon-filled card is not.
- On neon fills, foreground is `text.onPrimary` (`#121216`) — dark-on-neon reads as a lit
  sign; white-on-neon fails contrast.
- Small-size pink text (below ~15px) may use tint `#FF6AB5` if contrast reads muddy.

## Typography

- **Pixel face: Press Start 2P** (`@expo-google-fonts/press-start-2p` + `expo-font`).
  Used in exactly three places: the `HIGHSCORE` wordmark, game names, and score numerals
  (ranks, scores, the podium "1ST 902" cell, streak counts, day-strip values). Nowhere
  else — not screen titles, not section headings, not buttons.
- **Secondary face: Space Grotesk** (`@expo-google-fonts/space-grotesk`, 400/500/600/700)
  for everything else: names, body copy, captions, labels, section headers, the day
  header and TODAY chip, turnout lines, FIX/EDIT/CLEAR, sheet titles, legal pages.
  Register each weight as its own family and keep `fontWeight: "400"` on it so the
  browser never synthesises a faux bold.
- **Button labels: Space Grotesk 600, 16px.** Never pixel.
- **Small uppercase UI labels** (turnout, "YOU", TODAY, FIX/EDIT): Space Grotesk 700,
  `letterSpacing` 0.6, `textTransform: "uppercase"`, sized ~1.35× the pixel size they
  replace (pixel 8 → 11, 10 → 13/14, 11 → 15).
- Press Start 2P rules: it has no lowercase — set it in ALL CAPS deliberately. Minimum
  size 10px, headings typically 14–20px, hero numerals up to 40px+. Add `letterSpacing`
  ≥ 1 and generous `lineHeight` (~1.6×) — the face clips tight line boxes.
- Score/number alignment: Press Start 2P is effectively monospace — use it wherever
  columns of scores must align. Never use the body face for hero numerals.

## Shape & texture

- **Corner radius: 0 everywhere** (2px max where a hard 0 renders badly on iOS). No
  pills, no rounded cards.
- **Bezels: 2px solid `border`** on cards, buttons, inputs, sheets. Chunky and honest.
- **Neon glow** (`shadow`/`boxShadow` in the matching `.glow` token, ~8–12px blur, no
  offset) is reserved for: primary buttons, focused inputs, the active tab/selection,
  streak & new-high-score celebration, the wordmark. Nothing else glows. If everything
  glows, nothing does.
- **No CRT gimmicks.** No scanlines, no dither textures, no chromatic aberration, no
  screen-curvature effects.
- Elevation = surface step + bezel, not soft drop shadows. The only shadows in the app
  are neon glows.

## Iconography

- **Pixelarticons** (MIT, `pixelarticons` npm package, 24px-grid pixel SVGs) for all UI
  icons. Render via `react-native-svg` (add as a dependency; verify against
  `scripts/check-expo-sdk-deps.mjs` before bumping anything native — it may require an
  `app.json` version bump per the runtime-version policy).
- Icons are single-color: `text.secondary` at rest, `primary` when active/selected. A
  passive affordance that only _signals_ (the reorder grip on a game card, which you
  can't tap) sits one tier lower, in `border` — the same colour as rules and bezels —
  so it never reads as a control. Keep
  them on the 24px grid (16/24/32) — fractional scaling blurs the pixels and breaks the
  aesthetic.
- Emoji already in the product (reactions, game emoji) stay as-is.

## Motion

- **Snappy and stepped, never bouncy.** Durations 100–150ms, plain ease-out or hard
  steps. No springs with visible overshoot.
- Glow eligibility extends to `accent` spotlight moments (leader crown, #1 rank) with
  `accent.glow` — same restraint rules as pink/chartreuse.
- Celebration moments (new high score, streak extended) may use a brief 2–3 frame
  stepped "blink" or glow pulse — think arcade attract-mode, not confetti physics.
- Respect existing structural animation (Sheet slide, navigation transitions); this
  governs styling-level motion.

## Brand assets

> The brand mark and app icon are **frozen** (`UX-DECISIONS.md` entry 9): an external
> contractor owns the new mark, and it lands as its own PR. The wordmark below is type,
> not the mark, and ships with the theme; the icon description is the target for that
> later PR, not something the theme PRs touch.

- **Wordmark:** "HIGHSCORE" in Press Start 2P, `text.primary`, with a `primary` glow
  accent. Replaces the current bold-sans wordmark in `src/components/Wordmark.tsx`.
- **App icon / logo:** pixel-art upright **arcade cabinet**, purple-dominant
  (`surface.2`/`surface.3` body) on `bg` grey, screen lit in neon — pink dominant with
  yellow/chartreuse pixels.
  Built through the existing `pnpm --filter highscore-app run icon:build` pipeline
  (opaque 1024 PNG fallback + `.icon` bundle); first TestFlight build validates the
  bundle.

## Do / don't quick check

- ✅ Sharp corners, 2px purple bezels, dark grey ground, purple surfaces.
- ✅ Pink for anything tappable; chartreuse only when something good happened; yellow
  only to spotlight the leader/today/badges.
- ✅ ALL-CAPS Press Start 2P for the wordmark, game names, and score numerals; Space
  Grotesk for everything else.
- ✅ Glow on the few designated elements only.
- ❌ Light mode, rounded corners, soft drop shadows, scanline overlays.
- ❌ Chartreuse CTAs, white text on neon fills, pixel-font body copy, pixel-font headings
  or button labels.
- ❌ Importing colors/type/shape from `@workshop/ui`.
