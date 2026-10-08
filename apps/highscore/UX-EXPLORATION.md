# HighScore UX r2 — "Day Spine"

Round-2 redesign of HighScore's structure, information architecture, and flow. Visual language
is fixed by `DESIGN.md` (dark arcade, Press Start 2P, `radius: 0`, 2px bezels); this document
spends zero words on colour and all of them on **what is on screen, what is global, and how many
taps each job takes**.

## 1. The mental model: you are always looking at a day

The whole product is one dataset, `day × game × player → score`. Every job to be done is a
slice of it, and the slices share one axis: **the day**. "What did everyone get today?",
"the Wordle board on Tuesday", "how did Renata do this week" — all are a day (or a short
run of days) with the other two axes filtered.

So the app has one piece of global state: **the selected day**. It is `today` by default,
resets to today on the first launch of a new calendar day, and every surface is parameterised
by it. This is the Apple Fitness / Health model: the date scrubber is global; the rings, the
workouts list, and a workout's detail all show the day you picked.

What you are looking at is therefore:

- **Home** = _this day_, every game in my rotation, everyone in my circle.
- **Game board** = _this day_, one game, everyone.
- **Profile** = one person, a _week_ ending on this day.

The alternative models were rejected:

- **Game as the primary object** (a list of games, each with its own history): forces the
  "yesterday" job to be done per game, and the home page becomes a list of 15 cards with no
  cross-game summary. This is what round 1's cartridge deck did.
- **Person as the primary object** (a feed of friends' activity, Strava-style): great for
  reactions, terrible for "did I beat Martin at MapTap today?" which needs a game-sorted view.
  We keep the feed idea as an _ingredient_ (recent activity in the game board, reactions on
  rows) rather than the spine.
- **Timeline / feed as the primary object** (round 1's sheet stack over a timeline): ordering
  by time-of-posting destroys the per-game comparison that is the product's reason to exist.

The day spine survives the stress test because it is the only axis users actually navigate
on. Nobody asks "show me every day of Wordle" without first asking "how did today go".

## 2. The navigation model

| Thing                        | Kind                 | Notes                                                                                            |
| ---------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| Selected day                 | **Global state**     | `ViewDayProvider`. Shown and settable on Home, Game board, Profile. Snaps to today on a new day. |
| Home (`/`)                   | Root screen          | Day spine + scorecard + game rows. No tab bar; the app has one root.                             |
| Game board (`/games/:id`)    | **Push**             | Keeps the selected day. Back pops to Home on the same day.                                       |
| Profile (`/friends/:id`)     | **Push**             | Keeps the selected day as the "focus column". Pushing a game from the grid sets the day first.   |
| Friends (`/friends`)         | Push                 | Invite link, requests, list, people you may know.                                                |
| Paste a score                | **Sheet**            | Never a screen. Opens from Home ("Post" on an unplayed row) and from the board (sticky CTA).     |
| Add a game                   | Sheet                | From the `+` in the Home header.                                                                 |
| Pick a day                   | Inline strip + sheet | 7-day strip inline; a month grid sheet for anything older.                                       |
| Reactions, report, fix score | Sheets               | Row-level actions on a board; unchanged flows from today's app.                                  |
| Profile menu                 | Sheet                | Avatar in the Home header: edit profile, friends, support, legal, admin, sign out.               |

Pushes are for _changing the subject_ (day → game, game → person). Sheets are for _acting on
the subject_ without losing it. Nothing animates in place, nothing morphs, nothing is a gesture
you have to discover.

### The day control

Time navigation is the thing round 1 fumbled, so it gets the most explicit control in the app:

- **A 7-cell strip** (D-6 … Today), always visible at the top of Home, Board, and Profile. Each
  cell: weekday initial, day-of-month, and a chartreuse dot if _you_ played that day. The
  selected cell is a pink bezel; today's cell is a yellow bezel when not selected, so you can
  always see both "where today is" and "where I am".
- **A big date line** directly under the strip: `TODAY · WED OCT 8` / `YESTERDAY · TUE OCT 7` /
  `MON SEP 29`. Press Start 2P, always visible, so "which day am I looking at" cannot be lost.
- **`‹` / `›` keys** step one day. `›` is disabled on today.
- **A `TODAY` key** appears (pink, glowing) the moment you are not on today. One tap home.
- **Tapping the date line** opens a month-grid sheet for arbitrary past days. Days with any
  score in your circle are marked, so you can see where the data is before you go.

The same component is mounted on all three surfaces and bound to the same global value, so
the mental model stays "I moved the app to Tuesday", not "I moved this screen to Tuesday".

## 3. The five hot paths

Screen sizes are iPhone 15-class (390×844). Tap counts start from a cold open on Home.

### 1. Today, all games, my friends — Home (0 taps)

```
┌──────────────────────────────────────────┐
│ HIGHSCORE                     [+]  [👤2] │  header: wordmark, add game, profile (badge = requests)
│ ‹  Th  Fr  Sa  Su  Mo  Tu  [We]  ›      │  7-day strip, today selected (pink)
│ TODAY · WED OCT 8                  [📅] │  date line (tap → month sheet)
│ ┌────────────────────────────────────┐  │
│ │ 3/15 PLAYED   2 WINS   🔥 4 DAYS   │  │  scorecard: you today (chartreuse when earned)
│ └────────────────────────────────────┘  │
│ TO PLAY                                  │
│ ▸ Wordle            Martin 3/6  ·3 👥   [POST]│  unplayed rows: leader + player count + Post
│ ▸ Daily Tens        Renata 10   ·5 👥   [POST]│
│ PLAYED                                   │
│ ▸ MapTap   #2 of 6   you 4,812  ▲Dag 4,950 │  played rows: your rank, your score, leader
│ ▸ Krillion #1 of 3   you 7/7  👑         │
│ …                                        │
└──────────────────────────────────────────┘
```

Each row is a **box score line**, ESPN-style: one line per game, scannable in a column.
Unplayed games float to the top under "To play" (that is your to-do list), played games sit
below under "Played" with your placing. Within each section the user's own game order is kept;
reordering is "Move up / Move down" in the row's long-press menu (drag-to-reorder was dropped —
it fought the row tap on every surface it lived on, and a 15-game rotation is reordered once).

Row anatomy (left → right): game icon, title, _your_ cell (rank + score, or `POST`), leader
cell (name + score + crown), player-count avatars stack. Tapping the row pushes the board.
Tapping an avatar stack opens the leader's profile. `POST` opens the paste sheet directly
without leaving Home.

Dense day (13 games × 7 players): 13 single-line rows, ~56px each, fits in ~1.5 screens.
Sparse day (2 games × 3 players): two rows, scorecard still reads "0/15 played". Empty day
(nobody played): the scorecard says "NOBODY'S PLAYED YET", rows show `—` in the leader cell
and `POST` in yours.

### 2. Today, one game, full leaderboard — Board (1 tap)

```
┌──────────────────────────────────────────┐
│ ‹ BACK        MAPTAP               [⋯]  │  header; ⋯ = play, copy board, direction, remove
│ ‹  Th  Fr  Sa  Su  Mo  Tu  [We]  ›      │  same day strip, same global value
│ TODAY · WED OCT 8                        │
│ 1  👑 Dagmawi        4,950   🔥 👏2     │  rank, avatar, name, score, reactions
│ 2     Josh (you)     4,812   ← pink rail │  your row has a pink left bezel
│ 3     Martin         4,700              │
│ 4     Renata         4,210   😂1        │
│ —     Kay            unread  [fix]      │  failed parse rows sit at the bottom
│ ─────────────────────────────────────── │
│ NOT YET: Natalie, Marcelo, Claire       │  friends with the game who haven't posted
│                                          │
│ [ PLAY ]            [ POST SCORE ]       │  sticky footer; POST becomes EDIT once played
└──────────────────────────────────────────┘
```

Tap a row → long-press or `⋯` for react / report / block; tap the avatar/name → profile.
Reactions render inline on the row and the picker is a sheet. The footer is sticky so
"paste my score" is always one tap from any scroll position.

### 3. One person — Profile (1 tap from Home avatar, 1 from any board row)

```
┌──────────────────────────────────────────┐
│ ‹ BACK                            [⋯]   │  ⋯ = remove / report / block
│ [RH]  RENATA HOH                         │
│       Friends since Aug · 4 mutuals      │
│ ‹  Th  Fr  Sa  Su  Mo  Tu  [We]  ›      │  day strip: selected day = focus column
│ WEEK ENDING WED OCT 8                    │
│ THIS WEEK  18 plays · 5 wins · 🔥 6      │  computed over the 7 fetched days
│              Th Fr Sa Su Mo Tu We   H2H  │
│ MapTap        ●  ●  ●  ○  ●  ●  👑   3-2 │  ● played, 👑 won, ○ didn't; H2H = you vs them
│ Daily Tens    ●  👑 ●  ●  ●  ●  ●   1-4 │
│ Globle        ○  ○  ●  ○  ○  ●  ○   —   │
│ Wordle*       ●  ●  ●  ●  ●  ●  ●   —   │  * you don't have this game → [+ add]
└──────────────────────────────────────────┘
```

The profile is a **week grid** (Letterboxd diary meets a box score). Rows are the person's
games, columns are the 7 days ending on the selected day, the selected day's column is
highlighted. Each cell is tappable → sets the global day to that column and pushes that game's
board. So "what did Renata get at MapTap on Monday" is exactly two taps from Home (avatar →
cell). Head-to-head is a per-game win/loss record against you over the window.

The API only returns one day per call (`GET /v1/friends/users/:id?period=`), so the grid is
seven parallel requests — see §6.

### 4. A past day, all games — Home, day strip (1 tap)

Tap `Tu` (or `‹`). The strip moves, the date line says `YESTERDAY · TUE OCT 7`, the scorecard
and every row re-render for that day, and a glowing `TODAY` key appears beside `›`. Anything
older than a week: tap the date line → month sheet → tap the day (2 taps). Everything about
the screen is identical to path 1; only the data changed. That is the whole point of the model.

### 5. A past day, one game — Board on a past day (2 taps)

From path 4, tap the row (1 more tap). Or from a board on today, tap `Tu` on the strip — the
board is already day-parameterised. Back pops to Home _still on Tuesday_ (the day is global,
not per-screen), with `TODAY` one tap away.

### Tap-count summary

| Job                                | Taps | Via                                  |
| ---------------------------------- | ---- | ------------------------------------ |
| Today, all games                   | 0    | Home                                 |
| Today, one game                    | 1    | Row                                  |
| One person                         | 1    | Avatar on a row / name on a board    |
| Yesterday, all games               | 1    | Strip cell or `‹`                    |
| Any day in the last week           | 1    | Strip cell                           |
| Older day                          | 2    | Date line → month sheet              |
| Yesterday, one game                | 2    | Strip cell, then row                 |
| Friend's result, one game, one day | 2    | Avatar → grid cell                   |
| Post today's score (unplayed)      | 1    | `POST` on the row, paste sheet opens |
| Back to today from anywhere        | 1    | `TODAY` key                          |

## 4. Always-available actions

- **Paste a score**: `POST` on any unplayed Home row; sticky `POST SCORE` on every board;
  iOS share sheet → `/share/pick-game` (unchanged). Pasting always posts to the _selected_ day,
  which is shown in the sheet title ("Post to Tue Oct 7") so a backfill is deliberate, never
  accidental. On today this is invisible.
- **Add a game**: `+` in the Home header → sheet with friends' games as one-tap suggestions and
  a URL field (existing `AddGameSheet`).
- **Friends / add friend**: avatar in the Home header → profile menu → Friends; the pending
  request count is the badge on the avatar. Also reachable from any profile's header.
- **Copy today's scores**: `⋯` on Home → "Copy day recap" (the existing share-text recap and
  play link).

## 5. Empty and edge states

| State                               | What you see                                                                |
| ----------------------------------- | --------------------------------------------------------------------------- |
| No games in rotation                | Scorecard replaced by onboarding: add friends' games, or add by URL.        |
| Games but no friends                | Rows show only you; scorecard footer: "Add friends to compete".             |
| Day where nobody has played         | Scorecard "NOBODY'S PLAYED YET"; every row under "To play".                 |
| Game you added that no friend plays | Row leader cell "Only you"; board says "No friends play this yet · invite". |
| Past day you didn't play            | Row shows `—` in your cell, `POST` label becomes `BACKFILL`.                |
| Future day                          | Unreachable: `›` disabled on today; month sheet disables future days.       |
| Unparsed score ("unread")           | Board row sits unranked at the bottom with a `fix` action (existing sheet). |
| Profile of a non-friend             | Header + add-friend; grid replaced by "Games are for friends".              |

## 6. Tradeoffs and open questions

**Fan-out for the week grid.** There is no multi-day endpoint. The profile fires 7
`fetchFriendProfile` calls (one per column); on a cold cache this is ~7 × 150ms in parallel.
It works and is cached by React Query, but a `GET /v1/friends/users/:id/week?end=` endpoint
would be the honest fix. Marked `TODO(api)` in `src/games/hooks/useProfileWeek.ts`.

**Streaks for friends.** `viewerStreak` is only computed for the viewer. The profile derives
the friend's streak from the fetched 7-day window and caps the display at "7+". Same TODO.

**Home scorecard "wins".** A win is rank 1 on a game with ≥2 entries that day. Computed
client-side from `GET /v1/games?period=` which already carries full standings per game, so
no extra request.

**Sections vs the user's order.** Splitting Home into "To play" / "Played" overrides the
user's drag order across the split. I judged the to-do framing more valuable than a single
stable order, because the stable order is still kept _within_ each section, and after you've
posted everything the two sections collapse into one. If the owner disagrees it is a one-line
change (`groupRows` in `GamesHome.tsx`).

**Global day on Profile.** Profile reads the selected day as the _end_ of its week and as the
focus column. Changing the day on a profile changes it on Home too. This is consistent with
the model, but it means tapping "Sa" on Renata's profile and going back lands Home on
Saturday. The `TODAY` key is always visible, so recovery is one tap.

**Instant day switching.** The spine prefetches the other six days of its window (plus today)
with a five-minute staleTime, so a tap on "Tue" is a cache hit after the first load. While a
day is genuinely loading, the rows keep their titles and dim their standings rather than
blanking — the rotation is the same on every day, only the numbers change.

**7-day strip width.** Seven cells at 390px is 48px each — comfortable. On web the column is
capped at 440px and the strip stays 7 wide. Going to 14 was rejected: cells would drop below
the 44pt tap minimum.

## 7. What was rejected

- A tab bar (Home / Friends / Me). Two of the three tabs would be a list you visit weekly;
  it costs 50px of every screen for that. Friends and Me live behind the avatar.
- A horizontal game pager on the board (swipe between boards). Round 1 built it; it hides
  which game you are on and competes with the back gesture.
- A per-screen day (board remembers its own day). Breaks the "I moved the app to Tuesday"
  model and produces the "why does Home say today" confusion round 1 had.
- Calendar-first (open to a month grid). Today is the answer 95% of the time; the month grid
  is the escape hatch, not the front door.
- A "feed" of recent posts as Home. Loses the per-game comparison; kept as reactions on rows.
