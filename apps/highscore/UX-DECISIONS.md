# HighScore UX explorations — keep / scrap log

Running record of what we decided to **ship** out of the five competing UX explorations, and
what we decided to **scrap**. Most of that work was exploration and will be thrown away; this
file exists so the parts worth keeping don't go with it.

Append-only in spirit: entries get added as feedback comes in, and edited in place when a
decision changes. Each entry says what was looked at, what the call is, and what it costs to
actually land.

## The explorations

Five complete reimplementations of `apps/highscore`'s UI, all against the same written brief.
All are **draft and never merge** — they exist to be compared, not shipped.

| Key | Name                   | PR                                                     | Branch                             |
| --- | ---------------------- | ------------------------------------------------------ | ---------------------------------- |
| ux1 | Cartridge Deck         | [#414](https://github.com/joshlebed/workshop/pull/414) | `joshlebed/hs-ux1-cartridge-deck`  |
| ux2 | Expand In Place        | [#410](https://github.com/joshlebed/workshop/pull/410) | `joshlebed/hs-ux2-expand-in-place` |
| ux3 | Timeline + Sheet Stack | [#411](https://github.com/joshlebed/workshop/pull/411) | `joshlebed/hs-ux3-timeline-sheets` |
| ux4 | Players × Games        | [#413](https://github.com/joshlebed/workshop/pull/413) | `joshlebed/hs-ux4-players-matrix`  |
| ux5 | Gesture Dock           | [#412](https://github.com/joshlebed/workshop/pull/412) | `joshlebed/hs-ux5-gesture-dock`    |

All five run side by side behind an in-app toggle on
[#426 `joshlebed/hs-ux-playground`](https://github.com/joshlebed/workshop/pull/426) — the
fastest way to re-check any claim below. Each variant's own rationale is at
`src/variants/<key>/UX-EXPLORATION.md` on that branch.

## Status board

| #   | Area                                                | Decision                        | Status      |
| --- | --------------------------------------------------- | ------------------------------- | ----------- |
| 1   | Visual language — palette, type, theme layer, icons | **Keep. Ship a version of it.** | Not started |

---

## 1. Visual language — palette, type, theme layer, icons

**Decision: keep, and ship it.** The dark-arcade / 8-bit-neon look is the thing to salvage
from this round. It is also the cheapest thing to salvage, because it is the one layer all
five explorations agreed on.

### Why it's separable from the navigation question

The five variants disagree about almost everything structural — route shape, what a screen is,
whether anything pushes. They do **not** disagree about how it looks. Diffing the five
`src/theme/tokens.ts` files, these are byte-identical in all five:

- the entire `palette` — every hex, including `primaryTint` and the three glow rgba values;
- the whole `tokens.bg` / `text` / `border` / `accent` / `neon` / `status` tree;
- `radius` (0 across the board) and `bezel: 2`;
- `font.pixel` (`PressStart2P_400Regular`) and `font.weight`;
- the base `font.size` ramp (12 / 13 / 16 / 18 / 22 / 28).

So the visual layer can land on its own, before a navigation direction is picked, and whichever
structure wins inherits it. That ordering is worth protecting: it's the difference between one
restyle and five.

### What actually diverges (and so needs a call)

| Token       | ux1                   | ux2                        | ux3                        | ux4                                     | ux5                         |
| ----------- | --------------------- | -------------------------- | -------------------------- | --------------------------------------- | --------------------------- |
| `space`     | 4·8·12·16·24·32       | 4·8·12·16·24·32            | 2·4·8·14·20·28·40          | 4·12·16·24·32·48                        | 2·6·12·18·24·36             |
| `font.size` | base                  | base                       | adds `xxs:11`, `md` 16→15  | base                                    | base                        |
| motion      | 2 hard frames / 120ms | 92–140ms, 28ms stagger     | 120–150ms, 2–4 frame steps | 120ms, 18ms stagger                     | 4 frames / 140ms `steps(4)` |
| extras      | `deck`, `zoomStepped` | `actionType`, `HomeHeader` | `gutter: 28`, `Skeleton`   | `MONO_FONT`, `PullToRefresh`, `IconKey` | `stepped`, 6px quantization |

Four of five ship the same 4/8 spacing scale; ux3 and ux5 deliberately broke it for their own
layout arguments. **Default to the 4·8·12·16·24·32 scale** and treat the others as variant
flavour that leaves with the variant.

Motion is the one genuinely unresolved piece — everyone agreed on "stepped, 100–150ms, no
spring, no overshoot" and then picked a different number of frames. That can be decided late;
it's one constant.

### The icons are three independent votes for the same answer

`PixelIcon` is the same idea in all five: [pixelarticons](https://pixelarticons.com) path data
vendored inline as `d` strings and rendered through `react-native-svg`, because Metro and the
Cloudflare Pages bundler both choke on raw `.svg` imports. They differ only in **which** glyphs
each one happened to need (111–135 lines). Shipping this is a union, not a choice.

The brand mark is stronger evidence. ux3, ux4 and ux5 kept main's raster
`require("…/icon-source.png")`, but ux1, ux2 **and** ux4 each independently hand-drew a pixel
arcade cabinet as an SVG rect grid — because a PNG can't tint with the palette (lit marquee in
yellow, screen in pink, a chartreuse pixel for a win). Three people solved the same problem the
same way without coordinating. That's the mark to ship; we just need to pick one of the three
drawings (ux1's and ux2's are 16×16, ux4's is a 12×14 `CABINET` table beside a type-only
`Wordmark`).

### What it costs to land

Non-trivial, and worth being honest about: **none of this is on `main` today.**

- `apps/highscore/DESIGN.md` is still unmerged — it lives only on
  `joshlebed/highscore-design-brief`. The written brief has to land first, or the theme layer
  arrives with no spec behind it.
- `apps/highscore/src/theme/` does not exist on `main`. Every variant built its own.
- The four native-ish deps are absent on `main`: `react-native-svg`, `expo-font`,
  `@expo-google-fonts/press-start-2p`, `pixelarticons`.
- 36 of HighScore's ~49 component files currently import `@workshop/ui` for tokens and
  primitives. Restyling is mechanical (`tokens.x.y` keys were deliberately shaped to mirror
  `@workshop/ui`'s) but it is a wide diff.
- `react-native-svg` + `expo-font` are native: the PR that adds them **must** bump
  `apps/highscore/app.json` `version`, and a fresh TestFlight build has to land before the OTA
  does. See the runtime-version guard in the root `CLAUDE.md`.
- Chrome colours live outside the app too: `app.json` splash + `adaptiveIcon.backgroundColor`,
  and `apps/highscore/public/index.html`'s `theme-color` and html/body background. ux1 moved
  all of those from `#0E0C0B` to the palette's `#121216`.

### Suggested shape

Four PRs, stacked, each independently reviewable:

1. **`DESIGN.md`** — land the brief as-is from `joshlebed/highscore-design-brief`. Doc only.
2. **`src/theme/`** — tokens + primitives (`Text`, `Button`, `Card`, `Chip`, `Sheet`, `Avatar`,
   `PixelIcon`, `Toast`, `layout`), the four deps, font loading in the root layout, and the
   `app.json` version bump. Nothing consumes it yet, so it is additive and safe.
3. **Restyle** — move the 36 files off `@workshop/ui` tokens onto `src/theme`. Wide but
   mechanical; no structural change, so it stays reviewable against screenshots.
4. **Brand assets** — the SVG `BrandIcon`, the `Wordmark`, and the `app.json` / `index.html`
   chrome colours.

Open questions to settle before (2): which spacing scale (recommend 4/8), which motion
constant, and which of the three cabinet drawings.
