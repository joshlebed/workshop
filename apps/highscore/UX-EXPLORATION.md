# UX-3 — Timeline + Sheet Stack

One of five competing UX explorations for HighScore. This one is not a reskin: it changes what
the screens are, how many of them there are, and how you move between them. The visual language
is `DESIGN.md` verbatim — dark-only, the exact palette, Press Start 2P for headings and scores
only, 0 radius, 2px bezels, glow on almost nothing, Pixelarticons, stepped motion.

## The concept in one line

**Time is the primary axis. HighScore has one screen — a feed of days — and everything else is a
sheet that keeps that feed visible behind it.**

Daily games are a time-shaped product: the only questions are "what do I still owe today" and
"how did today go against my friends". A card list plus a day rail plus a stack of pushed screens
answers those questions badly — the day rail is a control you have to find and operate, and every
push throws away the context you were reading. So: the feed _is_ the day navigation, and a game
board or a friend's profile slides up over the day you were looking at instead of replacing it.

## The seed and what it decided

Derived from a 48-byte random string (base64) generated at the start of the task. The string
itself stays out of the UI and out of this doc; what it decided:

- **Run lengths, not a ladder.** Tokenised into runs of same-class characters, the string is
  almost all runs of 1 and 2 with three rare long ones (7, 5, 4). That became the spacing
  rhythm: a staccato scale (`2 / 4 / 8 / 14 / 20 / 28 / 40`) instead of a uniform 4pt ladder —
  rows sit tight against each other, sections get rare large breaks. See `space` in
  `src/theme/tokens.ts`.
- **`28` → the spine.** The largest run × 4 set the left gutter at 28px, and the gutter became a
  literal timeline spine: a 2px rule down the feed with a tick square per day. Everything else
  hangs off it.
- **`G` × 5 → five.** The most-repeated character set the count of pips in the sheet grab handle
  and the depth of a standings column (top 5, plus you if you're outside it).
- **Digits `2` and `4` → motion.** Structural moves ease out over 120–150ms; state changes are
  2- or 4-frame steps. Nothing springs, nothing overshoots.
- **`70` → the split.** A day header is a fixed-width label group and a rule that eats the rest;
  a score line is name-left / value-right at roughly 30:70.
- **`0` appears once → empty states are terse.** One declarative line and the single action that
  fixes it. No illustration, no centred hero, no decorative void.
- **Base64 is dense and unpunctuated → microcopy voice.** Counts before words ("2/9 posted",
  "29 plays · you 3", "#4 today"), lower-case sentences for prose, no exclamation marks.

## Navigation model

```
                      ┌──────────────────────────────────────────┐
   /  ────────────────►  TIMELINE  (mounted once, never unmounts) │
                      │   TODAY hero  ·  per-game ledgers          │
                      │   YESTERDAY (open)                         │
                      │   older days (collapsed, tap to open)      │
                      │   + add a game                             │
                      └───────────────┬──────────────────────────┘
                                      │ every route below opens a SHEET
                                      │ over the feed; the feed stays put
        ┌─────────────────────────────┼─────────────────────────────┐
        ▼                             ▼                             ▼
  /games/:id                    /friends ──► /friends/:userId    /profile
  game board                    friends       friend profile     account
  · day pager (swipe            list          (stacks on the     (identity,
    or tap, 7-day pips)                        friends sheet,     links, admin,
  · composer / edit / clear                    back pops it)      danger zone)
  · remove from my games
```

- **One sheet host, zero extra Modals.** `src/nav/SheetHost.tsx` is a single absolutely-positioned
  overlay with one pan gesture and an internal stack derived from the URL
  (`src/nav/sheetRoute.ts`). Navigation sheets are never RN `Modal`s, so the repo's "never stack
  two Modals in one tick" footgun cannot happen between them. The only Modals left are the small
  utility sheets that ride _on top_ of a sheet (paste, reactions, add-game), and at most one is
  ever visible.
- **The URL is the stack.** `/games/:id`, `/friends`, `/friends/:userId` and `/profile` are real
  routes under `app/(feed)/`, all rendering `null`; the group layout mounts the timeline once and
  lets `SheetHost` read the pathname. Deep links, browser back and the iOS back gesture all work,
  and the feed's scroll position survives every round trip.
- **Sheets size to their content** up to a ceiling, so the account sheet shows more of the day
  behind it than the game board does.
- **Dismiss has three paths**: drag the handle down (snaps to a half position, then dismisses),
  tap the dimmed feed, or press the close square. The drag is the native-feeling one; the other
  two are the non-gesture fallback for web and assistive tech.
- **Full screens, no timeline behind them**: `/sign-in`, `/onboarding/display-name`,
  `/share/pick-game`, `/g/:token`, `/friends/accept/:token`, `/support`, `/privacy`.

## What changed structurally

| Before                                               | Now                                                                   |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| Games home = card list + DayRail                     | Timeline feed; the DayRail is deleted and the feed is the day picker  |
| One card per game, today only                        | One ledger block per game per day, days stacked down the spine        |
| Board / friends / profile = pushed stack screens     | Sheets over a feed that never unmounts                                |
| Kebab menu per card (open / re-teach / remove)       | Those three actions live at the bottom of the board they belong to    |
| Profile menu sheet → Edit profile screen             | One account sheet                                                     |
| Score = one blob of pasted text, wrapping/truncating | `value` (pixel face, right-aligned column) + one-line glyph strip     |
| Paste box = plain textarea                           | Game's mark, live parse, and **"#4 today"** — the rank you'd land on  |
| Reactions = a `+` box on every row                   | Tap a friend's score line (tapback); chips render inline when present |

## The subtraction pass

Removed on purpose, after the design was working:

- The DayRail, the FAB, the per-card kebab menu, and the Edit-profile screen.
- The duplicate list: TODAY used to show a to-do checklist _and_ a standings list, so a game
  appeared twice in one viewport. Now one row per game carries both.
- The `+` column: an identical bordered glyph on every friend's score line down the right edge of
  the whole feed. Reacting is a tap on the line.
- Eyebrows that restated the title ("GAME / MAPTAP", "ACCOUNT / JOSH", "YOUR PEOPLE / FRIENDS").
- Rule lines on every section heading — kept only on day headers, where the rule means "this is a
  boundary in time".
- Icons on the account menu rows (five unrelated glyphs is decoration).
- `Final score: 990` under a row already showing **990** in 20px pixel type.
- The "REACT" word printed once per row, and the "Tap the box to log a result" coach mark.
- Timestamps on every board row (the board is per-day; "when" is the day).
- The host line under a game title that already has an external-link arrow.
- `Friends since 6/11/2026` × 12, replaced with what they did today; friends with nothing today
  are grouped under one heading instead of repeating "Nothing today" per row.
- `+N more` links on both the to-do list and the standings.
- Pull-to-refresh on web (the feed polls every 15s and refetches on focus).
- Centred spinners in empty sheets, replaced with skeleton rows.
- The permanent red weight on destructive controls: "Remove from my games" and "Remove friend"
  are muted until pressed, and "Clear score" moved inside the edit composer.

## Design-critic rounds

Both rounds: fresh context, screenshots only, no code, no target score, verbatim prompt.

**Round 1 — 5.5 / 10.** "The aesthetic direction is committed and the restraint puts it ahead of
most attempts at this genre. But the paste flow, score typography, and the '+' affordance are the
three things a studio would have solved first, and they're the three weakest points." Top points:
(1) the to-do checklist and the standings are the same games listed twice; (2) scores render as
raw emoji strings that wrap and truncate — the number should be the typographic hero in a
right-aligned column; (3) `+` is this app's kebab menu — one glyph, two meanings, no verb;
(4) the paste sheet is the core loop and it's a stock form, with no clipboard read and no rank
preview; (5) two competing time-navigation models, and the collapsed day rows carry zero signal.

**Round 2 — 6 / 10.** "The navigation concept is the strongest thing here… That's an Arc/Family-grade
idea. Concept is an 8; execution is a 5." Top points: (1) Apple colour emoji in the chrome break
the 8-bit aesthetic (these are real game favicons and product emoji, kept deliberately);
(2) summaries still truncate — a game whose point is ten results shows seven; (3) nine sections of
the same shape; (4) the `1 /9 POSTED` hero was a mis-set numeral; (5) one glyph, two meanings —
the checkbox square and the avatar placeholder square look identical.

Applied after round 2: the fraction is one typographic unit; avatars always render an initials
tile underneath the photo so a slow image is never an empty square; the share's own header line
and puzzle number are stripped out of the glyph strip; the coach mark, the `REACT` labels and the
duplicated `Final score:` line are gone; Clear folded into the edit composer; the friends list
splits into "on the board today" and "nothing today"; the invite link is a header text action, not
the loudest button on a screen you opened with 12 friends; sheets size to content; skeletons
replaced centred spinners.

Not applied, on purpose: commissioning per-game pixel icons (game marks are favicons from the real
catalogue — inventing art for them would be fiction), and merging the board sheet's day pager into
the timeline rail (the two answer different questions: "what happened today" vs "how does this one
game go over time", and the brief specifies the horizontal pager).

## Known gaps

- The Google sign-in button still comes from `@workshop/ui` (rounded, grey) and is the one control
  in the app that isn't on HighScore tokens. Restyling it means touching a shared package, which
  this app is not allowed to do.
- Collapsed day headers only carry a summary for the six days nearest today; older ones fill in
  when you open them.
- Reacting from the feed is a tap on a friend's score line with no persistent affordance — a
  deliberate tapback bet, and the thing most worth watching in user testing.
