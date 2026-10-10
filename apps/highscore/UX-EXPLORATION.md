# HighScore UX r2 — Day Scoreboard

One of three independent round-2 explorations. Visual language is fixed by
[`DESIGN.md`](./DESIGN.md); everything here is structure, information architecture and flow.
This document describes what is implemented on this branch, what was rejected, and what is
open.

## The mental model: the day is the document

Everything in the app is one dataset, **day × game × player → score**. The question was which
axis the user holds in their head while they move around. The answer that makes the five hot
paths cheapest is **the day**:

- Paths 1, 2, 4 and 5 are all "a day, sliced" (all games / one game; today / another day).
- The thing people actually say is "what did everyone get **today**?" and "what happened
  **on Tuesday**?" — the day is the noun, games and people are the slices.
- A daily-games app resets at midnight. The day is the only global that is *supposed* to
  change under you.

So: **the viewed day is one piece of global state** (`state/viewDay.tsx`, already present),
and every scoreboard surface pins the same `DayHeader` under its title bar:

```
‹   YESTERDAY            ›  [TODAY]
    Wednesday, October 7
```

- ‹ › step one day. › is disabled on today (no future bucket).
- The date itself is a button: it opens a month calendar (`DayPickerSheet`) — "what happened
  on Tuesday" is two taps from anywhere.
- A pink **TODAY** chip appears the moment you leave today. Reversal is always one tap and
  never requires knowing how many days you went back.
- The short line is in the pixel face and spotlight-yellow on today; the long line is the
  full date in the system face. "Which day am I looking at" is answered twice, in two
  typefaces, on every surface.
- Home mirrors the day into the URL (`/?d=2026-10-07`); game boards carry `?date=`. A web
  refresh or a shared link lands on the same day.
- Rollover: a selection made yesterday snaps back to today on the first render of a new
  calendar day (`resolveViewDay`). You are greeted with today, not the day you left on.

Adjacent days are prefetched on home, so ‹ › never show a spinner on the common
yesterday / back-to-today hops.

### What about the starting hypothesis (people as the social object, a feed)?

Stress-tested and **partly rejected**. A time-ordered feed is the wrong primary structure:
paths 1 and 2 are *comparative reads* ("where did I place?", "who won MapTap?"), and a feed
sorted by time hides exactly that. Grouping a feed by game to make rankings legible collapses
it back into a per-game leaderboard list — at which point calling it a feed is just a label.

What survives from the hypothesis, deliberately:

- **People are drawn, not counted.** The ranking on home is a strip of faces in rank order,
  not a column of numbers. The leader wears the yellow bezel, you wear the pink one. The
  comparative read and the social read are the same glance.
- **Every face is a tap to a person.** From home, from a board, from a profile's head-to-head.
- **Reactions stay on the game board** rows (the Strava "kudos on the activity" layer).
- **The profile is the diary.** A 7-day form strip plus a same-day head-to-head, both driven
  by the shared day, so "how did Alex do on Tuesday" uses the same ‹ › as everywhere else.

So the model is *a scoreboard of people*, not a feed of people.

## Navigation model

```
(tabs)/index   HOME — day scoreboard               bottom bar: BOARD · [PASTE] · FRIENDS
   │ tap row ──────────────► games/:id?date=   BOARD — one game, full ranking, composer
   │ tap face ─────────────► friends/:userId   PERSON — identity · form · head-to-head · games
   │ POST (row) ───────────► paste sheet, in place, for that game, today
   │ + (title bar) ────────► add-game sheet (URL + what friends play)
   │ avatar (title bar) ───► profile menu sheet (edit profile, legal, sign out, admin)
   │ PASTE (bottom bar) ───► share/pick-game   recognise the game from the text, post
   │ ‹ › / date ───────────  changes the shared day; no navigation
friends          FRIENDS — invite · requests · list · people you may know   (same bottom bar)
```

- **Global**: the day. Changing it never pushes a screen.
- **Push** (slide from right, back = ‹ or swipe): game board, person, paste screen, edit
  profile, legal pages. Each is a real URL.
- **Sheet** (bottom, dismiss by backdrop/swipe): day picker, paste-for-this-game, add game,
  row menu, reaction picker, report, profile menu. Sheets are for things that *modify* the
  surface you are on; they never contain navigation.
- **Bottom bar** only on the two top-level surfaces. PASTE is the one lit sign — it is the
  write, the reason the app exists. Game board and person push *over* the bar; their own
  write affordance is the composer / POST on the row you came from.

Time is never in the navigation stack. Going to yesterday is not a push, so you never
"back" out of a day; you step or tap TODAY.

## Hot paths, tap-counted (iPhone 390×844, one-handed)

### 1 · Today, all games, my friends — 0 taps

Open the app. Screen: title bar (wordmark · copy recap · + · you), `DayHeader` on TODAY with
the day's caption ("10 of 15 games · 7 players"), then one `GameResultRow` per game in my
order:

```
[icon] MAPTAP                      #1
       6 played today              902     …
       [J][C][KB][D][R][M]
        902 902 897 895 875 842
```

At real density (yesterday in this sandbox: 13–15 games, 7 players, ~30 scores) a row is
~120px, so ~6 games are above the fold and the whole day is under two screens. Sparse days
(2 games, 3 players) read the same way with shorter strips. A game nobody played collapses
to its title line plus "Be the first — paste a result." / "Nobody posted."

My cell on the right is the status column: `#rank` + score once I've posted, a lit **POST**
while I haven't (today only), a dim dash on a past day. Unplayed games are findable by
scanning one column.

### 2 · Today, one game, full leaderboard — 1 tap

Tap the row → `games/:id?date=today`. Screen: ‹ · cover · title · streak · ↗ open game;
`DayHeader` (same day, same control); my slot first (composer if I haven't posted, my
entry with Fix / Edit / Clear if I have); then every entry with `#rank` numeral, face, name,
posted-ago, the share text, and reactions (tap to toggle, + to pick). Posting from here files
under the *viewed* day, so a result finished after midnight can still go to yesterday.

### 3 · One person — 1 tap from anywhere

Tap any face (home strip, board row, head-to-head row). Screen: identity card (friends
since, mutuals); relationship action (add / cancel / accept·decline); **LAST 7 DAYS** form
strip ending on the viewed day (games posted per day, wins in yellow, the viewed day in
pink); `DayHeader`; **YOU n vs n THEM** head-to-head for the viewed day with one row per
game you both posted (tap → that board on that day); their games list with the viewed
day's score and quick-add for games I don't have; remove friend; report / block.

### 4 · A past day, all games — 1 tap (yesterday) · 2 taps (any day)

‹ on home, or tap the date → calendar → day. The same rows re-date in place; POST becomes
a dash; the caption drops the present tense; TODAY appears. Back to today: 1 tap, always.

### 5 · A past day, one game — 2 taps (from home) · 1 tap (from a board)

From home on yesterday, tap the row → that board already on yesterday (`?date=` is passed).
Or on any board, ‹ › moves the shared day without leaving the game. Returning to home keeps
the day, so the loop home → game → back → yesterday → game → back → today is five taps.

### The write

- **POST on a row** (today, unplayed): opens the paste sheet for that game. 1 tap + paste.
- **PASTE in the bottom bar**: reads the clipboard where allowed (web, with permission) and
  lands on `share/pick-game`, which recognises the game from the text and offers one-tap
  Post; otherwise the paste box is focused. Works from home or friends, for any game,
  including one not yet in my rotation.
- **iOS share sheet** → `share/pick-game` unchanged.
- **Row menu (…)**: Open game (arms paste-on-return), scoring direction, admin re-teach,
  remove.

## What was rejected and why

- **A time-ordered activity feed as home.** Hides rank; makes path 2 a scroll-and-search.
  Reactions as the organising principle also inflate the write surface — this app's write is
  the paste, not the comment.
- **A games × players grid.** The honest "whole day in one glance", but at 390px with 7+
  players the cells are 36px and scores like `1,000 / 1,000` or `3/6 🟩` do not fit; it also
  forces a horizontal scroll axis that competes with ‹ ›. The rank strip is the grid, one row
  at a time, with the column order (rank) carrying the meaning instead of position.
- **Unplayed-games-first sorting.** Tempting for the write, but it reorders the board under
  you every time you post. The POST sign in a fixed status column does the same job without
  motion; the user keeps their own order (drag to reorder is preserved).
- **A chip rail of the last seven days** (round 1 and the previous HighScore). It wastes 44px
  of every scoreboard surface on a control used a few times a day, and does not scale to
  "what happened two weeks ago" without an "Earlier" escape hatch. ‹ › + a calendar covers
  1 day and N days with the same two affordances.
- **Day as part of the navigation stack** (push a "yesterday" screen). Then every surface
  would need its own time control and the back button would mean two different things.
- **Hiding the bottom bar for a cleaner home.** Without it PASTE lives in a FAB that covers
  the last row's status column, and Friends is three taps deep behind the profile menu.

## Tradeoffs stated plainly

- Rows are taller than a plain leaderboard list (two lines). The strip earns it: the
  comparative read and the people read happen without opening the game.
- The strip shows at most six faces then `+N`; on a 12-player day the tail is one tap away
  on the board. Scores under faces are 1–5 characters (`stripScoreLabel`): numeric values
  compact (`12.5k`), a loss is `X`, an unread share is `?`. Share-text detail lives on the
  board, not on home.
- The `DayHeader` costs 60px on each surface. It is the one control the model stands on, so
  it is pinned rather than scrolled.
- Head-to-head and the form strip are derived client-side from `GET /v1/games?period=` (my
  rotation, standings of me ∪ friends), one request per day. They therefore only cover games
  in *my* rotation; a friend's game I don't have is on their games list but not in the
  comparison. Seven requests for the form strip are cached and shared with home's ‹ ›.

## Faked / missing API (marked `TODO(api)` in code)

- **Per-user history**: `src/games/lib/headToHead.ts` and the form strip in
  `FriendProfile.tsx` derive from `GET /v1/games?period=` per day. A
  `GET /v1/friends/users/:id/history?from&to` endpoint would cover all games and arbitrary
  ranges with one request.
- **Days with activity**: the calendar (`DayPickerSheet`) has no activity dots; it needs a
  "which days have any score" endpoint.
- **Clipboard on native**: the PASTE button reads the clipboard on web only
  (`src/games/lib/pasteEntry.ts`); native needs `expo-clipboard` (a native dep, out of scope
  here) and otherwise lands on the paste screen's text box.

## Not shipped as-is

The theme layer adds native dependencies (`react-native-svg`, `expo-font`) and `app.json`
`version` is deliberately **not** bumped; this branch is a draft for review only.
