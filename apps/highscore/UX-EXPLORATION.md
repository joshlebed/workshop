# HighScore UX r2 — Scoreboard

Round-2 redesign of the home page, leaderboards and hot paths. Visual language is
[`DESIGN.md`](./DESIGN.md) verbatim (tokens vendored into `src/theme/`); nothing below is
about colour or type. Everything is about **what the user is looking at, how they move, and
how many taps each job costs.**

## The mental model

> **You are looking at a day. A day is a scoreboard of games. A game is a box score.**

The dataset is `day × game × player → score`. Three candidate "things" to make primary:

| Primary object | What home becomes                    | Where it breaks                                                                                   |
| -------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **Person**     | a feed of friends' activity (Strava) | "Who won Wordle?" means scanning 7 posts. Scores are compared _per game_, not per person.         |
| **Game**       | a scoreboard of games (ESPN scores)  | A past day needs a separate time axis or it's buried inside each game's history (round 1's trap). |
| **Day**        | one page per day                     | On its own it's just a calendar; it needs something _inside_ the day to be the row unit.          |

The answer is the second with the third bolted on as **global state**: the game is the row,
the day is the lens. That's exactly the Apple Sports / ESPN structure (date scrubber at the
top, games below, tap a game for the box score) and the Apple Fitness structure (the day is
app-wide state; every surface shows the day you picked). Round 1 tried to hide the day inside
the game ("scroll a cartridge down for yesterday") and lost "which day am I on" instantly.
This design makes the day **explicit, persistent, and the same control on every surface**.

People are secondary on purpose: a person is reached from any score row, and their profile
is _also_ viewed through the same day lens ("Casey on Tuesday").

## Navigation model

```
 ┌─────────────────────────────────────────────┐
 │ HIGHSCORE                    [friends] [me] │  home header (wordmark, friends, profile sheet)
 │ ‹   TODAY · WED OCT 8                     › │  DATE BAR — global day, pinned, every surface
 ├─────────────────────────────────────────────┤
 │ ▣ MAPTAP            6 played   you: 1ST ⭐  │  game card = scoreboard row
 │   1 Josh 902   2 Claire 902   3 Kay 880     │    podium (top 3), your placing or [PASTE]
 │ ▣ WORDLE            1 played   [PASTE]      │
 │ …                                           │
 │ [ + GAME ]                   [ PASTE SCORE ]│  bottom actions (only two writes exist)
 └─────────────────────────────────────────────┘
       │ tap card                        │ tap avatar / name (anywhere)
       ▼                                 ▼
 ┌───────────────────────┐        ┌────────────────────────┐
 │ ‹ MAPTAP        [↗]   │        │ ‹ CASEY                │
 │ ‹  TUE OCT 7       ›  │        │ ‹  TUE OCT 7        ›  │  same date bar, same state
 │ last 7 days: 1 2 · 1 3│        │ friends since · mutuals│
 │ composer / my row     │        │ their games that day   │
 │ full board + reactions│        │ last 7 days form strip │
 └───────────────────────┘        └────────────────────────┘
```

- **Global state:** `viewDate` (already existed in `state/viewDay.tsx`; kept). It resets to
  today on a new calendar day. Every day-aware surface (home, box score, profile) renders the
  same `DateBar` bound to that state, so paging on one screen is reflected on all of them.
- **Push:** game → box score, person → profile, friends list, settings pages. Back is the
  system back (swipe / `‹`). Nothing replaces the stack, nothing morphs.
- **Sheets:** paste score (existing `GameScorePasteSheet`), add game, pick a day, reactions,
  report, profile/settings menu. Sheets are for _actions_, never for browsing.
- **Time selection:** three controls, all on the `DateBar`:
  1. `‹` / `›` step one day. `›` is disabled on today (no future bucket).
  2. The label opens a **day picker sheet** (last 5 weeks as a calendar grid; today marked
     yellow).
  3. When off today, a yellow **TODAY** chip appears at the right — one tap home from any
     depth, on any surface. The label itself reads `TODAY · WED OCT 8` or `TUE OCT 7`, in
     spotlight yellow on today and plain on past days, so the day is never ambiguous.

## Hot paths

| #   | Job                   | Taps from home | Path                                                                                 |
| --- | --------------------- | -------------- | ------------------------------------------------------------------------------------ |
| 1   | Today, all games      | 0              | Home. Each card: podium + your placing + turnout. Streaks and your rank inline.      |
| 2   | Today, one game       | 1              | Tap card → box score: composer or your row pinned, full ranking, reactions.          |
| 3   | One person            | 1 (or 2)       | Tap any avatar/name (podium on home, row on a board) → profile for the current day.  |
| 4   | A past day, all games | 1 (2 for any)  | `‹` on the date bar (yesterday) or label → day picker. Home re-dates in place.       |
| 5   | A past day, one game  | 2              | `‹` then tap card — **or** open the game and tap a day on its 7-day strip.           |
| –   | Back to today         | 1              | Yellow TODAY chip on every surface.                                                  |
| –   | Paste a score         | 1              | PASTE SCORE button → recognises the game from the text (existing `PickGame`), or the |
|     |                       |                | card's PASTE button for a specific game (opens the paste sheet).                     |
| –   | Add game / friends    | 1              | `+ GAME` bottom-left; friends icon in the header.                                    |

What's on screen at each step is in the PR screenshots.

## Testing the hypothesis

The brief's hypothesis: _games are the objects, like a sports scores app; a game card carries
its own history, so a separate time axis may be unnecessary._

- **Games as objects: confirmed.** Nobody asks "how was my day" in this app; they ask "did I
  beat Claire at MapTap". The row unit is the game. The podium-on-the-card is what makes home
  work at 10 games × 7 players without opening anything.
- **No separate time axis: rejected.** Path 4 ("what happened on Tuesday, across all games")
  has no natural answer without a day control on home, and round 1 proved that burying it
  makes "which day am I on" fragile. So the day is a first-class global axis _and_ the box
  score keeps a game-local 7-day strip (the "team schedule"). Both set the same state. The
  cost is one pinned 44px row per screen; the win is that paths 4 and 5 are each ≤2 taps and
  every surface says which day it is.

## Rejected

- **Players × games matrix / flip.** Reads well on a desktop, unreadable at 390px with 10
  games and multi-line scores. Round 1's verdict stands.
- **A feed (Strava).** Reactions want a feed, rankings don't. Reactions live on rows instead.
- **A per-game pager (swipe between games).** Hides the overview, which is the job.
- **Day as a horizontal chip rail (the old `DayRail`).** Seven chips take a full row and still
  can't reach three weeks back; `‹ label ›` plus a picker covers both in the same height.
- **A "You" tab.** Your profile is just a profile; it's reached from your own row and the
  avatar menu. No fourth surface.

## Density and empty states (real data)

The sandbox DB is a Neon branch of prod: 15 games in my rotation, 7 friends. Sampled with
`GET /v1/games?period=`:

| Day       | games played | players | max per game |
| --------- | ------------ | ------- | ------------ |
| today     | 0            | 0       | 0            |
| yesterday | 10           | 7       | 6            |
| −3        | 4            | 5       | 5            |
| −6        | 7            | 3       | 3            |

Consequences built in:

- **Today before anyone has played** is the most common home state at the time people open
  the app. Cards stay one row tall ("Nobody yet · [PASTE]"); the first card with scores gets
  its podium; a chartreuse "You're first in" is the celebration for being first.
- **A game you added that no friend plays**: card shows your own score only and a muted
  "Only you play this" line; the box score's empty board says the same and offers the invite
  link.
- **A past day with nothing**: the date bar still says which day, cards say "No plays" (past
  tense), the PASTE button stays available (posting to a past day is allowed on the board).
- **10 games × 6 players**: podium shows 3 + "+3"; your placing is always visible even when
  you're 6th (pinned "you: 6TH").

## Short scores

The card needs a one-token score per player. The server gives a numeric `scoreValue` and a
multi-line recap `scoreSummary`. `lib/shortScore.ts` derives the token: `N/6`-style fractions
and short last lines (`+1`, `0:45` after keycap-emoji folding) are kept verbatim; otherwise
the number; `no_result` → `✗`; unread → `?`. Direction is the server's `scoreDirection`, so
the podium order is always the server's rank, never a client sort.

## Client-side composition (no API changes)

- **7-day strip on the box score and the profile form strip** are built from seven cached
  `GET /v1/games?period=` calls (one per day) — the same queries home uses when paging, so
  they're free once you've looked back a week. TODO(api): a `GET /v1/games/:id/history?days=7`
  would make this one request.
- **Profile "last 7 days"** uses `GET /v1/friends/users/:id?period=` per day. TODO(api): a
  range parameter.
- **Day picker** has no per-day counts (that'd be 35 requests). TODO(api): a calendar summary
  endpoint `GET /v1/games/calendar?from=&to=` → `{ day: playedCount }`.

## What was kept, what was replaced

Replaced in place: `GamesHome` → `Scoreboard`, `GameBoard` → `BoxScore`, `FriendProfile`,
`FriendsHome` restyled, `DayRail` → `DateBar` + `DayPickerSheet`, `StandingsCard` →
`GameScoreCard` + `BoardRow`, wordmark and profile menu restyled on the new tokens.

Kept as-is (functional, reachable, not restyled in this round): sign-in, onboarding,
`PickGame` share flow, `GameScorePasteSheet` + teach panels, reactions picker, report/block,
edit profile + account deletion, legal pages. They still render on `@workshop/ui` primitives;
the brief allows that temporarily and each is one screen to port.
