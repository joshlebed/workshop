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

| #   | Area                                                              | Decision                                      | Status                                                                                                                     |
| --- | ----------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Visual language — palette, type, theme layer, icons               | **Keep. Ship a version of it.**               | Not started                                                                                                                |
| 2   | Navigation / structure — all five round-1 models                  | **Scrap. Re-run as round 2.**                 | Done — see 3                                                                                                               |
| 3   | Round 2 — three first-principles models                           | Under review                                  | Awaiting owner                                                                                                             |
| 4   | Home bottom action bar (`+ GAME` / `PASTE SCORE`)                 | **Keep. In the final design.**                | Shipping — [task](https://niteshift.dev/repo/joshlebed/workshop/task_int_yaop6io22gq4w7k6), `joshlebed/hs-home-action-bar` |
| 5   | Home card = minimal top-3 per game; raw share text only on detail | **Keep.**                                     | Not started                                                                                                                |
| 6   | Game detail (box score) view                                      | **Rework. Current B version is ugly.**        | Needs design                                                                                                               |
| 7   | Per-card `PASTE` button on home                                   | **Scrap.** The bottom bar is the only paste.  | Shipping with 4 (separate commit)                                                                                          |
| 8   | Pixel font scope                                                  | **Narrow.** Brand, game names, maybe actions. | Secondary font pick open                                                                                                   |
