# UX-2 — Expand In Place

One of five competing UX explorations for HighScore. It implements the visual language in
[`DESIGN.md`](./DESIGN.md) verbatim; everything below is about **structure, navigation and
motion**, which the brief leaves open.

## The concept

**Zero route pushes in the main loop.** There is one surface — a ledger of your games — and
everything else grows out of it:

- a game **expands in place** into its full board while the others squeeze into spines
- friends **slide over** from the right edge as a two-panel drawer
- you, add-game and paste **sheet up** from the bottom

Nothing in the daily loop is a screen you travel to and come back from. The URL still moves
(`/`, `/games/:id`, `/friends`, `/friends/:userId` are real routes), so deep links, refresh,
browser back and the iOS system back all behave — the router just isn't allowed to draw a new
screen for any of it. Mechanically: `app/(shell)/_layout.tsx` is a persistent layout whose four
child routes render `null`; the layout reads `usePathname()` and animates itself into the
matching state.

## Seed-derived direction

Per the method, the direction came from a 48-byte random string (`head -c 48 /dev/urandom |
base64`) read for sub-patterns, so the layout decisions aren't the statistically obvious ones.
What the string gave:

1. **A triple at the head, then a break.** Threes are the structural unit: three ledger states
   (row / spine / board), three type sizes in the pixel face (10 / 12 / 22), at most three
   friend faces in the header, three hard frames in the board reveal.
2. **Two `+` hinges at roughly a quarter and three quarters through.** Two edge hinges — the
   right edge opens friends, the bottom edge raises sheets — and an asymmetric row split: a
   narrow left identity gutter (52px), a wide middle field, and a fixed **76px score rail** on
   the right that forms one continuous alignment column from the top of the ledger down through
   any open board. Press Start 2P is fixed-advance, so that column actually lines up.
3. **A palindromic triple mid-string.** The drawer's second panel enters and leaves on the same
   axis, the same distance, the same duration — push and pop are mirror images.
4. **The digit run, ending on the highest digit.** Motion timings: 92ms spine squeeze, 28ms
   per-row stagger radiating away from the row you tapped, 140ms board open (ease-out geometry,
   three stepped frames for the content), 100ms collapse with no stagger. Ending high →
   empty states end on an imperative, never a shrug.
5. **Alternating case texture, no long uniform runs.** No uniform card stack anywhere: rows are
   rules on the canvas, never boxes, and density alternates (64px row / 30px spine) instead of
   repeating one height.
6. **No lowercase in the pixel face.** Pixel labels are ALL CAPS and at most three words;
   anything conversational is the system face in sentence case.

Spacing rhythm: 4-unit base, ledger breathing on 8, 24 at the two section hinges.

## Navigation model

```
                         ┌──────────── sheets (bottom edge) ─────────────┐
                         │  You · Add a game · Paste your result         │
                         │  Reaction picker                              │
                         └───────────────────────────────────────────────┘
                                              ▲ tap
   /                     ledger — all games, 64px rows, day tape pinned above
     │ tap a row                    ▲ tap header / chevron / swipe down
     ▼                              │
   /games/:id            board — that game expands; the rest become 30px spines,
                         still tappable, so you switch games without collapsing
     │ right-edge swipe, or tap the header face stack
     ▼                              ▲ tap ✕ / backdrop / drag panel right
   /friends              drawer panel 1 — requests, friends, you-may-know, invite
     │ tap a person                 ▲ tap "‹ FRIENDS" / drag panel right
     ▼
   /friends/:userId      drawer panel 2 — pushes in on the same track

   routes that really do push: /sign-in · /onboarding/display-name · /profile
   (edit profile, a form with account deletion) · /support · /privacy ·
   /share/pick-game · /friends/accept/:token · /g/:token
```

Every gesture has a visible tap equivalent — edge-swipe-to-open is also the header face stack,
drag-to-dismiss is also the ✕ and the backdrop, swipe-down-to-collapse is also the header and
the ▲ in the rail. Web and assistive tech never depend on a gesture.

Closing the drawer returns to whatever the ledger was showing, expanded game included: the
shell remembers the ledger's href while `/friends` owns the URL and `router.dismissTo()`s back
to it.

## What the subtraction pass removed

- **The floating `+` FAB.** Add-a-game is the last line of the ledger, where you land after
  reading your games.
- **The per-row kebab.** Nine `⋯` buttons became zero; open-game / re-teach / remove are
  labelled text actions at the foot of the open board.
- **The word "PLAY" ×9.** One pink play glyph in the rail says the same thing without nine
  repetitions of the same word down the page.
- **Boxed cards.** Games, friends, suggestions and standings are all rules on the canvas now.
- **The "you" pill** on your own standings row — a 2px pink edge and "(you)" in the
  accessibility label do the work.
- **"N played today" next to N faces.** The facepile is the count.
- **"Friends since …" and a chevron on twelve friend rows.** One line each; the date lives on
  the profile.
- **The rainbow avatar palette.** Initials were coloured per-name from the neon set, spending
  the CTA, earned and spotlight colours at once on decoration. They're all one quiet grey now.
- **The "Account" eyebrow** above "Edit profile", and two full-height photo buttons that
  outweighed the form under them.
- **Truncated scores.** Anything that can't fit the rail falls back to the parsed number or a
  lit square; nothing in the app ends in an ellipsis that reads like a menu.

## Design-critic rounds

Two rounds, each run in a fresh context with screenshots and the recording only — no code, no
notes, no earlier iteration.

### Round 1 — **5 / 10**

> "The day strip, the disciplined palette, and the absence of glow show taste, and the
> single-screen ledger is a genuinely interesting navigation idea. But the type system has no
> rule, the accordion is uncommitted, the score language is unabstracted, and every secondary
> screen falls back to stock."

Its sharpest points, and what changed:

1. **"Ledger row semantics are three symbols in one column."** The right slot cycled between a
   pink play chevron, a yellow numeral and a grey dash — one nav affordance and two kinds of
   data in the same place. → The ledger became a real table: a `GAME · BEST · YOU` header rule,
   two fixed 56px value columns, and no nav affordance in a data column.
2. **"The score glyph zoo."** Eleven games in eight visual dialects; trophy runs, tile runs,
   `= 2`, `4.5 2/6`. → `railScore` became the one rule, and raw share grids now appear in
   exactly one place: the open board.
3. **"The board's action layer has no hierarchy."** The most destructive action had the same
   weight as the primary one, and a system-emoji reaction stub sat under every row. → One pink
   action per board, Remove pushed to the far edge in the quiet colour, and the reaction
   affordance became a pixel glyph instead of an emoji.

Also applied from round 1: friends rows carry a line of competitive signal instead of a
"friends since" date and a chevron; the friend panel paints the identity it already knows
instead of a blank spinner; both sign-in providers share one bezel (app-owned Google button);
web scrollbars hidden; sub-10px text lifted off the legibility floor.

### Round 2 — **5.5 / 10**

> "The concept is above the bar — the single-surface navigation and the BEST/YOU ledger are
> ideas a studio would keep, and the restraint (no card stacks, no glow spam, no badges) is
> real. But the hierarchy fails at the three moments that matter most: your empty column,
> posting a score, and comparing yourself to a friend."

Its sharpest points, and what changed:

1. **"The YOU column is 78% dashes"** — the most important column read as an error state.
   → `---` became an empty slot: a 14px square outline that lights pink under the finger and
   opens the paste sheet. Past days show nothing, because you can't post into them.
2. **"Posting a score is the emotional peak and it's a silent dismiss."** → The toast now says
   where the result landed ("You lead Satle today", "Posted — #2 of 4") and the number that
   changed blinks in three hard frames.
3. **"Friend profile is a scoreboard without the vs."** → It became a `THEM / YOU` head-to-head
   on the same two-column grid as the ledger, with a `FRIENDS / MARTIN` breadcrumb replacing
   the generic back chevron.
4. **"Two type worlds glued together"** and **"spine collapse deletes the comparison data."**
   → One rule: pixel for headings, game names and numerals; the body face for every inline
   action. And spines keep both value columns, so expanding a game no longer costs you the
   comparison you opened it to make.

Left undone on purpose: the critic wanted the board pushed as a page with a shared-element
transition and Friends promoted to a peer of the ledger — both would undo the variant's
premise. Its "container zoo" note is partly structural: edit-profile is a form with account
deletion in it and `/share/pick-game` is the iOS share-extension target, so both stay routes.

## Notes for reviewers

- `apps/highscore/**` only. Workshop, `packages/ui` visuals, `packages/api-client` and the
  backend are untouched.
- All existing behaviour is intact: play → return-to-paste, teach-a-score, reactions, drag
  reorder, copy-scores recap + `/g/:token`, friend invites/requests/accept, share intent →
  `/share/pick-game`, onboarding, sign-in, edit profile incl. account deletion, `/support`
  and `/privacy`.
