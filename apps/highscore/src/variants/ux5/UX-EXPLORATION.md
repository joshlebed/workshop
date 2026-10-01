# UX-5 — Gesture Dock

One of five competing UX explorations for HighScore. **This is a product change, not a
reskin**: the screens, the navigation model, and the motion are different from the shipped
app. The visual language is `apps/highscore/DESIGN.md`, unchanged and binding.

## The concept in one line

**Everything is reachable inside one thumb.** A persistent bottom dock whose keys morph per
screen, full-bleed game bands you swipe instead of hunting buttons on, and chrome (the day
scrubber, the profile menu) that stays off-screen until you ask for it.

## The seed-derived direction

Per the method, the open decisions — the ones DESIGN.md deliberately leaves to the
implementer — were derived from an external random string generated at the start of the task
(`head -c 48 /dev/urandom | base64`). The string itself is not in the product or in this doc;
what it decided is:

| Open decision          | What the seed produced                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spacing rhythm**     | A **6px base** — `2 / 6 / 12 / 18 / 24 / 36` — not the 4-or-8 grid every other variant will use. Every inset, gap and bezel lands on it, and the swipe drag is quantized to it. |
| **Density**            | Tight. A game band is three lines tall; six games fit above the fold on a 390×844 phone.                                                                                        |
| **Grid & asymmetry**   | Full-bleed rows with a fixed **42px left rail** and a ragged right edge. The rail carries a 2px rule that runs the full height of every band — a ledger, not a card stack.      |
| **Hierarchy**          | Extreme scale contrast: one 24px hero numeral per band against 10–12px for everything else. The _data_ is big and the _chrome_ is small — a scoreboard inversion.               |
| **Motion signature**   | Four hard frames, ~140ms, `Easing.steps(4)`. Dock keys morph horizontally, content moves vertically, quick-menu keys stagger 30ms apart. No springs, no overshoot.              |
| **Navigation shape**   | A bottom-anchored control panel of unequal-width keys. Ratios, not fractions — the lit key on a screen is ~1.5×, the way out is 0.7×.                                           |
| **Empty-state voice**  | Terse and dry. Verbs, not sentences: "Pick a first game", "Send an invite", "NO ENTRY".                                                                                         |
| **Zeroes in the seed** | Zero radius (already mandated), and **zero horizontal inset** — content runs edge to edge so the rail rule can be a real column.                                                |

## Navigation model

```
                     ┌───────────────────────────────┐
   scroll past top   │  DAY SCRUBBER  (hidden)       │  ← also: tap the header date key
        ▲            ├───────────────────────────────┤
        │            │  HOME — one band per game     │
        │            │    swipe →   PLAY             │
        │            │    swipe ←   PASTE            │
        │            │    tap       BOARD            │
        │            │    SORT      reorder mode     │
        └────────────┤                               │
                     └───────────────────────────────┘
        dock:  [ADD] [RECAP] [PLAYERS] [YOU]        (no board yet → RECAP drops out)
                                    │        └── long-press → quick actions
                                    │
   ┌────────────────────────────────┼──────────────────────────┐
   ▼                                ▼                          ▼
 BOARD  /games/:id              PLAYERS /friends            YOU  /you
 unfolds out of the tapped band  dock: [INVITE] [BACK]      dock: [EDIT] [BACK]
 dock: [PLAY] [EDIT|TODAY]         │  (+[COPY] once a link      │
       [REMOVE] [BACK]             │    has been minted)        ▼
                                   ▼                        EDIT PROFILE /profile
                            PROFILE /friends/:id            dock: [SAVE] [BACK]
                            dock: [ADD|CANCEL|ACCEPT+DECLINE] [BACK]
```

Rules the dock keeps on every screen:

- **The last key is always the way out**, and it is never the widest.
- **The first key is the screen's verb.** Exactly one key can be lit (filled pink); a screen
  with nothing constructive to do (a friend's profile) has no lit key at all.
- **Destructive actions are never the lit key.** Removing a player is a plain text row at the
  bottom of their profile; removing a game is a quiet key on that game's own board.
- A key that survives a screen change (BACK, PASTE) **keeps its slot and re-labels** with a
  two-frame blink — the bar morphs, it never swaps.

Implementation: `src/nav/dock.tsx`. Screens register key sets through `useDock`, and
registrations form a stack keyed per mount, because expo-router keeps the pusher mounted and a
plain "last write wins" would leave the wrong keys up after a pop.

### The gestures, and their fallbacks

| Gesture                            | Non-gesture fallback (default on web)                                   |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Swipe a band right → play          | The `PLAY` key in the band's own score slot                             |
| Swipe a band left → paste          | The `PASTE` key beside it; on a played band, `EDIT` in the board's dock |
| Scroll past the top → day scrubber | The date key in the header (also closes it)                             |
| Long-press YOU → quick actions     | Tapping YOU opens the full YOU screen                                   |
| Drag the board header down → back  | The `BACK` dock key, plus the iOS edge-swipe                            |
| Long-press a sort row → drag       | ▲ / ▼ keys on every sort row                                            |

The drag is quantized to the 6px rhythm and hard-detents at the action threshold with a
haptic, so the band steps rather than glides.

### The unfold

There is no shared-element transition across expo-router screens, so the board fakes one: the
tapped band's window position is measured at press time (`src/nav/rowGeometry.ts`), the stack
animation for `games/[id]` is a cross-fade, and the board's header starts at that position and
steps up into place while the rest of the screen fades in behind it. The hand-off is consumed
on read, so a deep link or a back-forward gets a plain fade instead of a header flying in from
a position that no longer means anything.

## What the subtraction pass removed

- The **FAB**. Adding a game is a dock key.
- The **kebab menu** on every game card, and the sheet behind it.
- The **header avatar** — the dock's YOU key is the identity anchor and carries the pending-
  request notch, so a second avatar in the corner was decoration. (A deliberate deviation from
  the variant brief, which put the long-press on a header avatar; anchoring it to the dock is
  the same idea executed inside the thumb.)
- The **profile menu sheet** — replaced by a real YOU screen plus two long-press shortcuts.
- **Per-row Remove** on the players list, **the ✕ close button** on Edit Profile, and the
  in-page **Save changes** button (all now dock keys or profile-level rows).
- The **"Add a game by URL" button** on the empty state (the dock's ADD key is that path) and
  the **↗ open** key on the board header (the dock's PLAY key is that path).
- The **"✓ In your games" pills** in discovery — a check glyph and 50% opacity say it.
- The **sheet grab handle** (a stock-iOS tell; the sheets aren't draggable).
- The **share-text echo** under each home hero numeral, and the **per-row timestamps** on the
  board.
- The **streak badge** from every band title — it now appears only on a band you haven't
  played, where it's a reason to act rather than a decoration.
- **18 bezelled squares** on the sort screen: the keys are unboxed, and Remove left entirely.
- `StandingsCard`, `DayRail`, `GameCardList`, `ProfileMenu` — deleted, not restyled.

## Critic rounds

Two rounds, each run in a fresh context on screenshots only, using the verbatim prompt from
the brief.

### Round 1 — **5 / 10**

> "A coherent, ownable point of view with several genuinely studio-grade moments (hero
> numerals, the scoreline, the sparkline, the mascot), undermined by boxed-everything
> repetition, a navigation bar that changes meaning per screen, five competing accents, and
> secondary screens that fall back to stock chrome."

Top points and what changed:

1. **Three affordances for one day control** — the header marker is now one bezelled key with
   a chevron in every state, and the scrubber uses a single highlight vocabulary (numeral
   colour) instead of a yellow edge _and_ a pink bezel.
2. **~30 bordered mini-badges on one screen** — the friends strip is now unboxed: initial,
   score, reaction, no chrome.
3. **The rank floats, aligned to nothing** — it moved onto the hero numeral's line, so the
   rank column reads straight down the board.
4. **The left icon gutter reads as a stubby table column, and raster favicons clash** — the
   rail now carries _your standing_ (`2` over `/5`), the same thing the board's rail carries.
   No favicons on home at all.
5. **Board rows read 2, 1, 2, 4 because "You" is pinned first** — entries sort by rank; only
   the empty composer pins to the top.
6. **BACK eats a third of the action row; destructive actions sit in the primary slot** — BACK
   is 0.7× everywhere, and REMOVE is never the lit key.
7. **Quick menu duplicates two keys and puts Sign out one tap from home** — it is now Edit
   profile + Invite a player; sign-out lives on the YOU screen only.

### Round 2 — **5 / 10** (hard cap reached)

> "The concept is a 7 — a table-as-app with a controller deck and a real voice — but execution
> is a 4: the type system fractures the moment you leave home, the outline-everything palette
> flattens hierarchy…"

Top points and what changed:

1. **Everything is an outline, so nothing is primary** — the primary `Button` and the dock's
   lit key are now _filled_ pink with a dark label, and short button labels moved onto the
   pixel face so sheets belong to the same control panel as the dock.
2. **Four typefaces pretending to be one** — added a `data` (monospace) text variant for
   everything the app quotes rather than composes: raw shares, field sizes, "NO ENTRY".
3. **A bare rank digit is a mystery** — the rail reads `2` over `/5`.
4. **Raster 🙂+ as the add-a-reaction affordance** — replaced with a pixel `+`; the reaction
   chips themselves lost their pills. (Product emoji stay: DESIGN.md mandates it.)
5. **The profile's head-to-head is a 12px line while REMOVE owns the hero slot** — the
   scoreline is now 32px pixel numerals and REMOVE is a text row at the bottom.
6. **Three stacked Wordle grids** — everyone else's share collapses to one line with a real
   expand key; yours stays open, because it's the one row on the page that's about you.
7. **18 buttons to reorder six rows** — unboxed, and Remove moved to the game's own board.
8. **Add-a-game leads with games you already have** — owned games sink below addable ones.

Two round-2 notes were deliberately not taken:

- _"The scrubber should always be visible."_ Hiding it **is** this variant's premise: today is
  the answer ~95% of the time, and one of five explorations should test paying zero permanent
  pixels for the other 5%. It has a persistent header key and a persistent date label.
- _"Kill the quick-action popover."_ The long-press menu is the variant's brief. It was trimmed
  to the two actions that actually save a tap.

## What is intentionally the same

Every product behavior is unchanged: the play → return → paste loop (`useReturnToPaste`, scope
`"games"`), score paste + the teach flow, reactions, drag reorder, the copy-scores recap and
its `/g/:token` play link, friend invites/requests/accept, share-intent → `/share/pick-game`,
onboarding, sign-in, edit profile including account deletion, and the public `/support` and
`/privacy` routes.
