# HighScore UX-1 — Cartridge Deck

One of five competing UX explorations. This one is not a reskin: it replaces the app's
navigation model. `DESIGN.md` is binding and unchanged; layout, structure, motion, and
navigation are the variables.

## The concept

**The app is one deck of cartridges, and you never push a screen to see a game.**

HighScore used to be a scrolling list of leaderboard cards on a home screen, with a
per-game board one push away, friends two pushes away, and your account inside a sheet
hanging off an avatar. Five screens, four stack transitions, one card list.

Here there is **one screen**. Each game in your deck is a full-bleed cartridge you swipe
between; scrolling a cartridge _down_ is the game's history (today, yesterday, earlier),
so the home and the game board are the same surface. Zooming _out_ is the shelf — every
cartridge at once, where reordering lives. A three-key control panel switches the surface
between the deck, the people, and you. Nothing in the app pushes a route.

The stack still exists for deep links only: `/games/:id`, `/friends`, `/friends/:userId`
and `/profile` resolve their target into the shell and replace themselves.

## Seed-derived direction

The direction was derived from a random 64-character string (`head -c 48 /dev/urandom |
base64`) rather than from taste, so the layout would not converge on the most probable
one. What the string decided:

- **Three mirrored triples** in the string (`x-y-x` patterns) → a **three-key** control
  panel, and a **mirror composition**: a strip at the top and a panel at the bottom
  bracket the cartridge, with the active item centred in both.
- **A single `+` at 17% of the string** → an **asymmetric grid**. Every screen runs on one
  vertical rule at **68px** — a fixed marker column on the left (day markers, section
  counts, the shelf key, avatars) and content to the right. The `+` also terminates the
  deck: the last cartridge is the empty slot.
- **`8` is the most frequent digit; `E8` repeats** → **8px rhythm**, and the app's one
  transition is **two hard frames over 120ms** (`Easing.steps(2)`), travelling 8px.
  Nothing eases, nothing overshoots. Direct manipulation (the pager, a dragged tile) is
  exempt and tracks the finger 1:1.
- **`3` twice** → a **three-column shelf**.
- **`7` is the first digit** → a cartridge is **seven days deep**.
- **No whitespace in the string** → **density**. Content is separated by 2px bezels, not by
  padding. No section has a decorative gap.
- **The string reads as a machine serial** → **terse, machine-panel microcopy**. Pixel caps
  for system state (`DECK`, `THU 3`, `PLAY`), system sentence case for anything spoken to
  a person ("9 games still open today.", "Hold a cartridge to move it.").

## Navigation model

```
                       ┌──────────── SHELF ────────────┐
                       │ 3-col grid of every cartridge │
                       │ long-press drag to reorder    │
                       │ + slot tile at the end        │
                       └───────────────────────────────┘
                          ▲  tap the mark / pinch in
                          │  tap a tile / tap wordmark
                          ▼
  ┌─── STRIP ── mark │ ▣ ▣ ▣ ▣ ▣ … + ── underline tracks the pager ───┐
  │                                                                   │
  │   ◀── swipe ──▶   CARTRIDGE (one game, full screen)               │
  │                    ├ header: title → opens the game, Eject        │
  │                    ├ TODAY   ▸ PLAY / Paste result, standings     │
  │                    ├ WED 2   standings          (scroll down …)   │
  │                    └ TUE 1 … 7 days back                          │
  └───────────────────────────────────────────────────────────────────┘
  ┌ COPY TODAY'S SCORES ─ appears only once you've posted today ──────┐
  ├──────────  DECK  │  PLAYERS  │  YOU  ─────────────────────────────┤
```

- **DECK ⇄ PLAYERS ⇄ YOU** — crossfade + one 8px step in the direction of travel. Never a
  push, never a slide-over.
- **PLAYERS** is a two-level panel: the roster (requests, friends, people you may know,
  invite link) and one player's profile, which slides in over it with the same step and
  backs out with `← PLAYERS`.
- **YOU** replaces the old profile sheet with a real surface: your day (played / leading /
  run), edit profile, feedback, support, privacy, sign out, admin impersonation.
- **Play → paste** is unchanged in behaviour and shorter in distance: `▸ PLAY` on today's
  slot opens the game and arms the return prompt; coming back pops the paste sheet
  wherever you are. Editing a posted score reuses that same sheet instead of a second
  composer.
- **Gestures always have a tap**: swipe ⇄ strip cells, pinch-out ⇄ the mark in the strip's
  gutter, tile drag ⇄ (reorder only, as before).

## What the subtraction pass removed

- **The whole `games/[id]` screen** and its second score composer — the cartridge is the
  board, and one surface takes a pasted result.
- **The add-game sheet and the floating `+` button** — the deck already has a place where a
  new cartridge goes.
- **The Games-home card list, the DayRail chip row, and `StandingsCard`** — days are marker
  rows on the grid, not chips above a stack of identical boxes.
- **Both drag implementations** (`react-native-reorderable-list` on native, `@dnd-kit` on
  web) and the `.web.tsx` split they forced — the shelf's grid drag is one
  gesture-handler + reanimated implementation for both platforms. Four npm dependencies
  dropped from `apps/highscore`.
- **The profile menu sheet** and its avatar-with-badge trigger.
- **The per-row "Remove" on every friend** (12 identical destructive links on one screen) —
  unfriending lives on the profile, one tap away, where the consequence is spelled out.
  The "Remove friend" button there also moved off the top of the profile to a quiet line
  at the bottom.
- **The permanent 🙂+ reaction button on every score row** — tapping a friend's row opens
  the picker; chips render only where reactions exist.
- **Leading icons on every menu row in YOU** — the trailing mark now differs only where it
  means something (in-app `›`, external `↗`, nothing).
- **"Friends since 6/11/2026" on every roster row** — replaced with what a friend actually
  did today, and the roster sorts by it.
- **The centred `EmptyState` block** — replaced by a left-aligned `Notice` on the grid.
- **A "TODAY" word marker** — today is the yellow day, which is what neon yellow is for.

## Critic rounds

Two rounds (the cap), a fresh design-director context each time, given screenshots and
filmstrips of the recording only — no code, no notes, no target score.

### Round 1 — **5/10**

> "The concept is ownable (deck / cartridge / shelf / tape / eject, plus the score-chip
> ranker) and it avoids the glow-everything trap, but raw share-text rows, label-wrapping
> bugs, tiny unlabeled rail icons, the double footer, default body type, and generic
> settings screens are things a studio would never ship."

Top points, and what changed:

1. **Leaderboard rows printed the provider's raw share text** ("99🎯 97🔥 … FINAL SCORE: 988"),
   wrapping mid-row. → New `scoreMarks.ts` reduces any share to one rankable token plus the
   grid, and the grid renders as palette squares instead of emoji in a pixel face. Every row
   is one line and the score column lines up. This was the single biggest change in the pass.
2. **The marker column couldn't hold its own labels** ("THEY PLAY" → "THE Y PLA Y"). → Column
   widened to 76px; every gutter word is now ≤4 characters at Press Start 2P's 10px floor.
3. **A permanent "COPY TODAY'S SCORES" bar stacked on the tab bar** — a double footer giving
   prime space to a secondary action. → Moved onto the shelf, the only surface that spans
   every game, and demoted to a ghost button.
4. **Empty days read as skeleton loaders.** → Loading is score-shaped placeholder marks; a day
   nobody played collapses to a single line.
5. **"Nothing today" ×8 buried the friends who actually played.** → The roster splits into
   "On the board today" (full rows, sorted by leads) and "Quiet today" (a compact chip row).
6. **Profile and You were generic chevron stacks.** → The profile is a head-to-head card
   (THEM / YOU per shared game); You leads with your day; the settings rows lost their
   leading icons and keep a trailing mark only where it means something.
7. Plus: web scrollbars hidden, `Recording score: 1` → `Reads as 1`, the Apple button moved to
   its own compliant filled treatment, sign-in centred on a 112px cabinet.

### Round 2 — **5/10**

> "The concept (rail, cartridge strip, paste-in-place, 'Reads as 4', the tape line) is
> genuinely above average and the restraint on glow is real; the execution is a dark-mode
> list app wearing a pixel font, with generic favicons, generic cards, generic toast, and no
> motion language backing the hardware idea."

Top points, and what changed after the cap (the critic did not see these):

1. **"The core nav object is a row of raw third-party favicons — it reads as Safari's tab
   bar, not a cartridge slot."** → `CartridgeLabel`: a bezelled plate with a coloured spine
   and a two-character pixel monogram, deck-unique (`monogram.ts`, unit-tested, so "Travle"
   and "Tradle" never wear the same plate). Used in the strip, the shelf, the cartridge
   header, the friend profile and the add-game list. Favicons are gone from the app.
2. **"PLAY / PASTE squats in the rank-1 slot and pushes the board down."** → The control moved
   into the sticky cartridge header, so today's board starts at rank 1 and the control stays
   on screen while you scroll the tape.
3. **"Triple-redundant chrome on the deck"** (strip + header + an X duplicating the shelf). →
   The eject moved to the end of the tape as a quiet text action; the header is one line.
4. **"Five signal colours on a dark ground."** → Copy-scores is a ghost button, the posted-score
   toast is gone entirely (your row landing on the board is the confirmation), and the active
   panel key is indicated once, by a lit seam, with no glow.
5. **"Yellow on every row so nobody leads."** → Only the top row of the roster is spotlighted.
6. **"Zoom out to the shelf is a cut."** → The shelf zoom gets its own three-frame, 180ms step,
   longer than the two-frame panel swap.

Not addressed, and honestly out of scope for this pass: a custom body grotesk (DESIGN.md
pins body copy to the system face), and a full mechanical insert/eject motion language.
