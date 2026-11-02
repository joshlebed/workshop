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

| #   | Area                                                              | Decision                                                              | Status                                                                                                                     |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Visual language — palette, type, theme layer, icons               | **Keep. Ship a version of it.**                                       | Shipping — see entry 10                                                                                                    |
| 2   | Navigation / structure — all five round-1 models                  | **Scrap. Re-run as round 2.**                                         | Done — see 3                                                                                                               |
| 3   | Round 2 — three first-principles models                           | Under review                                                          | Awaiting owner                                                                                                             |
| 4   | Home bottom action bar (`+ GAME` / `PASTE SCORE`)                 | **Keep. In the final design.**                                        | Shipping — [task](https://niteshift.dev/repo/joshlebed/workshop/task_int_yaop6io22gq4w7k6), `joshlebed/hs-home-action-bar` |
| 5   | Home card = minimal top-3 per game; raw share text only on detail | **Keep.**                                                             | Not started                                                                                                                |
| 6   | Game detail (box score) view                                      | **Rework. Current B version is ugly.**                                | Needs design                                                                                                               |
| 7   | Per-card `PASTE` button on home                                   | **Scrap.** The bottom bar is the only paste.                          | Shipping with 4 (separate commit)                                                                                          |
| 9   | Brand mark / app icon                                             | **Frozen.** External contractor owns it.                              | No changes                                                                                                                 |
| 8   | Pixel font scope + secondary face                                 | **Pixel: wordmark + game names. Body: Space Grotesk. Scores: pixel.** | Shipping with 1                                                                                                            |

**Type lab (2026-11-02).** The candidates — System, Space Grotesk, Inter, IBM Plex Sans — and
the scores question (pixel face vs secondary face bold with tabular figures) are up for
comparison as a live switcher on variant B (`src/theme/typeLab.ts` +
`src/components/TypeLabChip.tsx`, uncommitted review scaffolding in the liaison sandbox;
`?font=` / `?scores=` / `?buttons=` on any URL, or the yellow `Aa` chip). Under the narrowed
scope the `Text` variants map as: `display` and a new `game` variant stay pixel; `title`,
`heading`, `body`, `caption`, `label` use the secondary face; `score` follows the scores
switch.

**Picked (2026-11-02): A — Space Grotesk for the secondary face; 1 — scores stay in the pixel
face.** Buttons: secondary face semibold (the lab default); pixel buttons were offered and not
taken. Press Start 2P is therefore: `HIGHSCORE` wordmark, game names, score numerals.

## 9. Brand mark and app icon — frozen

**Decision: do not change the brand mark or the app icon.** Owner, 2026-11-02: an external
contractor is producing the new brand mark. Entry 1's "pick one of the three cabinet drawings"
is withdrawn — the theme PR ships with the existing raster icon / wordmark treatment and
leaves `assets/`, `app.json` icon fields, and `index.html` chrome alone. The contractor's mark
lands as its own PR.

Also accepted as defaults on the same date: spacing scale `4·8·12·16·24·32` and ~120ms
stepped motion (no spring, no overshoot).

## 10. Ship the visual language — scope

**Decision: ship entries 1 and 8 now, on today's structure.** Owner, 2026-11-02. The
implementation brief to hand to an agent is
[`docs/plans/highscore-theme-ship.md`](../../docs/plans/highscore-theme-ship.md). What goes in:

- `DESIGN.md` from `joshlebed/highscore-design-brief`, amended: body face is Space Grotesk
  (not the system face); pixel face is wordmark + game names + score numerals only.
- `src/theme/` (tokens, `Text` with the `game` variant, `Button`, `Card`, `Chip`, `Sheet`,
  `Avatar`, `PixelIcon`, `IconButton`, `Toast`, layout) with `react-native-svg`, `expo-font`,
  `@expo-google-fonts/press-start-2p`, `@expo-google-fonts/space-grotesk`, `pixelarticons`.
- Restyle every HighScore surface off `@workshop/ui` visual tokens, including the shipped
  bottom bar (entry 4), with no structural or navigation change.
- `app.json` `version` bump (native deps) and a TestFlight build before the OTA.

What stays out: the brand mark and app icon (entry 9), the `index.html` / splash chrome
colours that belong with them, any home-row / day-control / history-placement choice from
round 2 (entries 3, 5, 6 still open).
