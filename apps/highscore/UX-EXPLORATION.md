# UX-4 — Players × Games

One of five competing UX explorations for HighScore. **Draft. Not for merge.**

Implements the visual language in [`DESIGN.md`](./DESIGN.md) verbatim — dark-only, the exact
palette, Press Start 2P for headings and scores only, zero radius, 2px bezels, reserved neon glow,
Pixelarticons, stepped 100–150ms motion. Everything below is about the layout, structure and
navigation those tokens are spent on, which is where this variant differs from the five restyles.

---

## The concept

**The same day of data has two projections, and the app flips between them instead of pushing
screens.**

`GET /v1/games` already returns the whole day: your games, in your order, each carrying that day's
standings across you and your friends. Existing HighScore renders exactly one reading of it — a
card per game — and the two questions people actually ask about a daily-games group can't be
answered from that stack at all:

- _How did **Casey's** day go?_ → you'd have to scan five cards for one avatar.
- _Who won **Wordle**?_ → fine, but only if you scroll to Wordle.

So `TODAY` has a switch. **GAMES** is the per-game reading (a game per row, its players ranked left
to right). **PLAYERS** is the transpose: a player per row, one aligned column per game, frozen
name column, scrolls as one body. The second one is a scoreboard you read in two directions — down
a column for "who won Wordle", across a row for "how was Casey's day" — and it costs no new
endpoint, because it's the same payload turned ninety degrees (`src/games/lib/matrix.ts`).

Both projections are built from the same atom: a `ScoreCell` under a header strip. GAMES puts faces
in the header strip and cells below; PLAYERS puts game marks in the header and cells below. That's
the whole transpose, and it's why the flip animates as a reflow rather than a page change.

---

## The seed

Per the creative method, the direction was seeded from a random 48-byte string (kept out of the repo
and out of the UI) rather than from taste-by-default. Six things were read off it and used as
binding constraints:

| Read from the seed                     | What it decided                                                                                                                                                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Digits `1 8 3 6 4 0`                   | **Spacing scale 4·12·16·24·32·48, with no 8 step.** Elements are welded (4) or plainly apart (12+), never in the mushy middle. The `0` is real too — welded controls share one bezel (the projection switch, the key panel).                                           |
| One doubled run (`rr`)                 | **The pinned self row.** You are always the first row of PLAYERS whether you posted or not, on your own surface step — the row that appears twice, once as data and once as a promise.                                                                                 |
| The two special characters `+` and `/` | **Two glyph operators, used once each.** `+` is the app's only add affordance (add a game, add a friend, add a friend's game, log a missing score). `/` is the projection idea itself: one dataset, two readings, `4/6`-shaped score marks in a monospaced pixel face. |
| Bookends — first and last char are `O` | **Circular navigation.** The `TODAY` key returns you home from anywhere; the flip animates from the direction of travel so a round trip lands exactly where it started. No dead ends, no orphan screens.                                                               |
| Uppercase head, lowercase body         | **Extreme, gapped type contrast.** ALL-CAPS Press Start 2P at 9–20px for structure and scores; a system face for every sentence. Nothing in between; no 15px semibold "almost heading".                                                                                |
| Two specials, ten apart                | **Two pieces of fixed chrome, everything else scrolls.** The header (day + projection) and the bottom key panel.                                                                                                                                                       |

Derived tone: **arcade-terse but never cute.** "8 haven't posted", "9 left today", "Nobody's played
yet". No exclamation marks, no mascot, no "✨".

---

## Navigation model

```
                     ┌─────────────────────────────────────────┐
                     │  fixed bottom key panel (always present) │
                     │   TODAY        FRIENDS ●       YOU       │
                     └─────────────────────────────────────────┘

   /  TODAY  ──── ‹ TODAY ›  header stepper ····· both projections follow it
   │
   │   ┌────────────────────────────────────────────┐
   │   │  GAMES  │  PLAYERS   ← flips in place       │
   │   └────────────────────────────────────────────┘
   │      │                        │
   │      │ game row               │ player row / cell
   │      │  · tap cover  → peek   │  · tap avatar → peek
   │      │  · hold row   → peek   │  · hold row   → peek
   │      │  · tap name   → board  │  · tap name   → profile
   │      │  · tap cell   → board  │  · tap cell   → board
   │      ▼                        ▼
   ├── /games/:id  BOARD ──── day stepper walks this game's history
   │        · composer (today only) · standings · reactions
   │
   ├── /friends/:id  PROFILE ── their day game-by-game, + on games you don't have
   │
   ├── /friends  FRIENDS ──── requests · friends · people you may know · invite
   │
   └── /you  YOU ──────────── identity · your day strip · cabinet menu
                                 └─ /profile  edit profile + account deletion
                                 └─ /support, /privacy (public routes, unchanged)
```

### The rules that make it learnable

1. **The identity glyph peeks; the text navigates.** Tap a game's cover or a player's avatar and
   you get a preview without leaving the page. Tap the name and you go. One rule, every row, both
   projections. It also gives the peek a tap path, so press-and-hold is an accelerator rather than
   the only way in — required on web with a mouse, and for anyone who can't hold.
2. **The tapped row continues into the next screen's header.** `src/components/Flight.tsx` measures
   the row's identity block, clones it into a root-level overlay, and animates the clone to the
   exact rect the destination header will occupy while the push runs as a `fade`. The geometry
   contract is one constant (`DETAIL_IDENTITY`) that both detail screens honour. If measurement
   fails it's an ordinary push — the flight is never a prerequisite for navigating.
3. **Back names its destination.** `‹ TODAY`, `‹ FRIENDS`, `‹ YOU` rather than a bare chevron: a
   detail screen can be reached from either projection, the friends list or a share link.
4. **The three keys never move.** They're on every signed-in screen including detail screens, which
   a `Tabs` bar can't do — hence a plain `KeyPanel` component rather than expo-router tabs.

### Two words that would have collided

The bottom key is **FRIENDS**, not PLAYERS. The brief's key set was `TODAY / PLAYERS / YOU`, but
then the projection switch and a nav key would both read "PLAYERS" and go to different places. The
switch keeps the word (it groups today's _scores_ by person); the key takes FRIENDS (the social
_graph_ — requests, mutuals, invites). Same map, no ambiguity.

### The peek

Hold a row, or tap its identity glyph. A game peeks its full standings (with reactions, and the
per-game actions that used to live behind a kebab); a player peeks their whole day, game by game.
It is a root-level overlay, **not** an RN `Modal` — no stacked-Modal wedge (see the repo
`CLAUDE.md`), and it can animate with the rest of the app.

It deviates from the brief in one way, deliberately: it **stays open** on release rather than
dismissing, so you tap the panel's commit key to go deeper or tap outside to dismiss. That's the
iOS context-menu contract, and unlike a release-to-dismiss preview it behaves identically under a
mouse, a screen reader, and a finger that can't hold still.

### The crown

The yellow crown on the PLAYERS name column marks **the day's overall leader: most outright #1
finishes today**, tie-broken by games played, then by mean rank.

- _Outright_ matters. Three people all solving Wordle in 4 all rank 1; counting shared firsts made
  the crown meaningless and turned two thirds of the grid yellow. A joint best is not a win.
- A day with no outright #1 anywhere has no crown. A dead heat on all three measures has no crown
  either — a crown two people wear says nothing.
- The same rule marks individual cells: only an outright win gets a yellow bezel, and only in
  PLAYERS, because in GAMES the rank order already puts the winner leftmost and a badge on top of
  that is decoration.

Covered by `src/games/lib/matrix.test.ts`.

### Friend streaks

The brief asked for streaks on the player rows. `GET /v1/games` only carries `viewerStreak` — the
API has no streak for anyone but you — so inventing one would have been a lie. Player rows carry
today's completion instead (`4 of 6 played`, in the peek subtitle), and the chartreuse streak
counter stays where it's real: your own games in the GAMES projection.

---

## Subtraction pass

Removed, not restyled:

| Gone                                                                     | Why                                                                                                                                                            |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `DayRail` (a scrolling week of chips)                                | A daily-games app is a _today_ app. Two chevrons and the date do the same job in a fifth of the screen.                                                        |
| The `+` FAB                                                              | A floating circle in an app with a hard 0 radius. Adding a game is now the last row of the list new games land in.                                             |
| The per-card kebab (`⋯`)                                                 | Three dots on every row is the laziest affordance in mobile design. Open / re-teach / remove live in the game's peek.                                          |
| The copy-scores header icon                                              | The day's one shareable artefact was invisible until you already knew it existed. It's now a block at the bottom of both projections, showing the actual text. |
| The profile menu **sheet**                                               | A stack of eight identical buttons in a bottom sheet. `YOU` is a screen, opening on your own day rather than on admin.                                         |
| Icons + chevrons on every `YOU` menu row                                 | Eighteen elements saying what six words already said. Labels only.                                                                                             |
| "Since 6/11/2026" on every friend row                                    | Low-value, inconsistently formatted. A friend row is a name.                                                                                                   |
| The ✕ remove key on every friend row                                     | A destructive action one tap from a list, twelve times over. Removing a friend lives on their profile, next to the context.                                    |
| The friends "Add a friend" card (two paragraphs + a permanent URL field) | One `INVITE` key in the header. The link appears once there's a link.                                                                                          |
| The cabinet mark beside the header wordmark                              | At 22pt its pixels fall under one physical pixel and turn to mush. It appears at 72pt on sign-in, where it reads.                                              |
| The wordmark on `TODAY` entirely                                         | You opened the app on purpose. Brand lives on sign-in and `YOU`.                                                                                               |
| Yellow #1 glow on every standings cell                                   | With ties, most cells ranked 1 — the spotlight colour had become wallpaper. See "the crown".                                                                   |
| Idle friends' empty grid rows                                            | Eight rows of dots. They collapse behind one `8 haven't posted` row that expands.                                                                              |
| Surnames in every score column                                           | `Colin Brinsm…` is less legible than `Colin`. Full names stay in the accessibility labels and on profiles.                                                     |
| A separate boxed "paste" key per row                                     | Your missing result is drawn as _your empty slot_ at the end of the row's strip, under your own dimmed face. The gap is the affordance.                        |
| The browser's white focus ring                                           | The only colour the app rendered that isn't in the palette. Focused inputs take the DESIGN.md-sanctioned pink bezel + glow.                                    |

---

## Design-critic rounds

Two rounds, fresh context each, screenshots + recording only — no code, no notes, no target score.

### Round 1 — **5 / 10**

> "The aesthetic direction is right and the palette discipline is above average for the genre, but
> the information architecture is redundant (peek → detail → profile chains that all show the same
> list), raw pasted data leaks straight into the UI, hierarchy is flat because one display face is
> asked to do everything, and three of the eleven screens are mostly empty below the fold."

Its top points, and what changed:

1. **Peek and board were the same screen twice.** The peek is now a _glance_ — top five, no
   controls, single-line results. Everything you can **do** to a game (open, re-teach, remove,
   react) moved to the board, which is what makes the push worth taking.
2. **Raw share text was masquerading as data.** Standings rows now put the one comparable number
   right-aligned in the pixel face and demote the pasted share to a single line of context.
3. **The board was 40% chrome and 60% void.** The back link stopped repeating the day pager (the
   pager shows the date), Edit/Clear moved onto your own row, multi-line grids expand, and the
   bottom carries "still owe a score" plus the game's actions.
4. **Everything was boxed.** Avatars, covers and neutral cells lost their bezels; the only outlined
   state left in the grid is an outright win.
5. **Friends was a phonebook.** Rows now read "6 of 9 today · 2 firsts", sort by who's playing, and
   crown the day's leader.
6. **`YOU` was a settings dump in display type.** It opens on three numbers — played, firsts,
   streak — and the menu rows dropped to the body face with no icons and no chevrons.

### Round 2 — **4 / 10**

Round 2 saw the recording as well as the stills, and marked it down for things the stills hid:

> "The mood, the matrix, and the peek-to-drill concept are studio-grade ideas; the blank avatars,
> emoji summaries, empty Board page, pink-everywhere, one-register type, and 16–20s spinners are
> what keep it from reading as finished work."

Its top points, and what changed:

1. **Blank avatars.** A remote avatar that is slow or missing left a bare purple square — twelve of
   them on the Friends screen. Initials now render _underneath_ the photo, so a face is never empty.
2. **The same game showed two different numbers.** The grid said `99`, the board said `988`. There
   is now one rule (`scoreMark`) used by the cell, the peek, the board and the profile: the parsed
   value the rank is computed from, except where the human mark is a fraction carrying that same
   value (`4/6` says everything `4` does and one thing more).
3. **Pink had stopped being an accent.** Secondary `+` keys kept the pink glyph and gave up the pink
   bezel; destructive and admin controls dropped out of button chrome entirely.
4. **One type register — shouting.** Section markers moved off Press Start 2P onto a small
   system-caps `eyebrow`, so pixel type is display and scores again.
5. **Loading was the dominant experience.** Home now paints the frame plus skeleton rows, the two
   detail screens hold their identity slot open (and the friend profile seeds its name from the
   cached friends list), and the boot screen shows the wordmark rather than a spinner on black.

**On the spinners specifically:** the sandbox's Postgres was answering between 3 and 27 seconds per
request while the recording was made, which is what the critic was watching. That is an environment
problem, not a design one — but it did expose real missing loading states, and those are fixed
above.

**Not fixed, deliberately:** the critic wants every game's summary re-rendered as native pixel tiles
instead of the games' own emoji, and Today/GAMES restructured into a single strip per game. Both are
good calls and both are larger than this exploration; they're the obvious next moves if this
variant is the one that gets picked.

---

## Notes for the reviewer

- **`app.json` `version` is deliberately not bumped.** This adds four dependencies, two of which
  are native (`react-native-svg`, `expo-font` via `@expo-google-fonts/press-start-2p`). Under the
  repo's `appVersion` runtime-version policy that means an OTA built from this branch would target
  `1.0.0` and reach installed `1.0.0` TestFlight builds that have no `RNSVG` — which crashes on
  next launch. Whoever merges one of these five explorations must bump `version` in that PR and cut
  a fresh TestFlight build. `node scripts/check-expo-sdk-deps.mjs apps/highscore` passes.
- **No `apps/workshop`, `packages/*` or backend changes** beyond the two shared-tooling files
  (`knip.json` ignores, and nothing else). HighScore iteration has zero Workshop effect.
- Every existing behaviour still works: play → return → paste, score teaching, reactions, drag
  reorder, copy-scores recap + `/g/:token`, friend invites / requests / accept, share intent →
  `/share/pick-game`, onboarding, sign-in, edit profile including account deletion, and the public
  `/support` and `/privacy` routes.
