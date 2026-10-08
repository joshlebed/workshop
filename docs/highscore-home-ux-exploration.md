# HighScore home: paste-first primary action (UX exploration)

Status: proposal · 2026-10-08 · Owner: @joshlebed

## The problem

HighScore's home makes **Add a game** the primary action (the amber `+` FAB) while the thing
users do many times a day — **paste a score** — is a tiny underlined `paste` link on each row,
and only after they have picked the right row. The real-world session usually starts outside
the app: a user plays today's first game from a browser tab or a group chat, copies the share
text, and opens HighScore with a score on the clipboard and no game in mind. Today that user
has to find the row, tap a small link, and paste. The iOS share sheet flow (`/share/pick-game`)
already solves "post with no context" — it runs the classifier over the text and offers one-tap
Post — but it is unreachable from inside the app.

Meanwhile the classifier (recognition + teach v2, on for everyone since #454) now identifies
any game with stored scores, auto-adds unknown-to-me games to My Games on post, and previews
what will be recorded. That makes "paste first, we figure out the game" a safe default.

## What ships today

| Surface                 | Primary action                        | Where "paste" lives                                    | Where "add game" lives                     |
| ----------------------- | ------------------------------------- | ------------------------------------------------------ | ------------------------------------------ |
| Home (`GamesHome.tsx`)  | `+` FAB → `AddGameSheet`              | per-row `paste` link (`StandingsCard` CTA, today only) | FAB, empty-state onboarding                |
| Share (`PickGame.tsx`)  | one-tap **Post** on the detected game | paste box (classifier runs on edit)                    | implicit: posting find-or-creates the game |
| Board (`GameBoard.tsx`) | Play / paste for that game            | per-game sheet                                         | —                                          |

Two findings drive the proposal:

1. **`PickGame` is already the contextless paste surface.** It takes text, asks
   `POST /v1/games/score-preview`, and shows "Wordle score detected → Post". It only needs a way
   in from home and a clipboard pre-fill.
2. **Add-game is a setup task, not a daily task.** Discovery (friends' games) and URL add are
   needed on day one and rarely after. They belong in onboarding, a secondary surface, and the
   classifier's post-adds path — not under the thumb.

## Options considered

### A. Swap the FAB: `+` becomes "Paste score"

The FAB opens `PickGame` (as a sheet or route) with the clipboard pre-read on tap. Add-game moves
to the header overflow. Smallest change; keeps the FAB pattern.

- Pro: one-line mental model, zero new components, reuses the share flow verbatim.
- Con: a round FAB with a glyph does not say "paste"; still an extra tap before the sheet.
- Con: discovery of friends' games becomes invisible after onboarding.

### B. Clipboard-aware banner on foreground

On app foreground, read the clipboard and, if it classifies, show "Post your Wordle 4/6?" with
a one-tap button at the top of home. Zero-tap intent detection.

- Pro: the best case is magical — open the app, tap Post, done.
- Con: iOS shows a system "HighScore pasted from Safari" banner (and from iOS 16 a permission
  prompt) on every silent read; web cannot read the clipboard without a gesture at all.
- Con: false positives (old share text still on the clipboard) read as nagging.

### C. Docked composer: "Paste a score" bar + "Friends are playing" strip (recommended)

Replace the FAB with a full-width primary pill docked at the bottom of home that reads
**Paste a score**. Tapping it reads the clipboard (a user gesture, so no system prompt on iOS
and allowed on web), opens the paste sheet pre-filled, and the classifier names the game with a
one-tap Post. Discovery moves out of the add sheet into a light "Friends are playing" strip at
the bottom of the card list; URL add moves to the header overflow menu.

- Pro: the label says exactly what the action is; the clipboard pre-fill removes the paste step.
- Pro: discovery stays visible on every visit without competing with the primary action.
- Con: a docked bar costs ~56px of list height; on web it needs the same column constraint as
  `Screen`.

Option B's mechanism (classify the clipboard) is reused inside C at the moment of the tap, so
C gets most of B's magic without the silent read.

## Recommendation: C, with the session loop kept in-app

### 1. Primary action: **Paste a score** (docked, full width)

- Replaces `fab-add-game`. Label, not glyph. Amber, same elevation as the FAB today.
- On tap: read clipboard → open the paste sheet with the draft pre-filled → classifier runs
  (`useSharePreview`) → "Wordle 4/6 detected · Post" above the text box. Empty clipboard or
  non-score text just opens the sheet with the box focused.
- Sheet body is `PickGame`'s existing content refactored into a sheet-mountable component:
  detected-score card, paste box, Your games list as the manual fallback. Not in My Games yet →
  post auto-adds (already true). Classifier miss and not in Your games → a single
  "Different game? Paste its link" row at the bottom of the list opens the URL add.
- The per-row `paste` link on cards stays as a secondary, contextful path (it skips the
  classifier because the game is known).

### 2. After a post: offer the next unplayed game

The user's session starts with one score, but they have N games. After Post succeeds, the
sheet's success state shows **Next up: Connections · Play** (first unplayed game in My Games
order) with Play arming the existing return-to-paste prompt. This turns a contextless paste
into a loop that runs the rest of the day's games from inside HighScore. Skip = close.

### 3. Discovery and add-game move down a level

- A **Friends are playing** strip at the bottom of the card list (horizontal chips from
  `GET /v1/games/discovery`, `FriendGameSuggestions` reused, one-tap add). Hidden when
  empty. This is the encouragement the brief asks for, present on every visit, below the fold
  for a heavy user and immediately visible for a new one.
- **Add a game by link** lives in the header overflow (`⋯` next to the copy-scores icon) and
  on the empty-state onboarding, where it already is. `AddGameSheet` is unchanged.
- Empty state (no games) keeps the friends-first onboarding but the docked bar still reads
  **Paste a score**: a brand-new user with a share text on the clipboard gets their first game
  created by the post itself, which is the fastest possible onboarding.

### Why not keep both buttons

Two FABs or a split FAB make the user decide "add vs paste" before acting. The classifier makes
the distinction unnecessary from the user's side: pasting a score for a game you do not have
yet _is_ adding the game.

## Flows

```
Cold open with a score on the clipboard
  Home → [Paste a score] → sheet pre-filled → "Satle score detected" → [Post]
       → "Posted · Next up: Globle [Play]" → opens Globle → return → paste prompt (existing)

Cold open, nothing on the clipboard
  Home → [Paste a score] → sheet, box focused → user pastes → classifier → [Post]

Classifier miss, game already in My Games
  … → sheet shows box + Your games → tap the row → posts (existing PickGame behaviour)

Classifier miss, brand-new game
  … → "Different game? Paste its link" → AddGameSheet URL field → added → back in sheet,
      the new row is selectable
```

## Risks and open questions

- **Clipboard read on tap.** `expo-clipboard` `getStringAsync` inside a press handler is fine on
  iOS (no prompt, just the transient banner) and web (`navigator.clipboard.readText` requires
  a gesture and shows a one-time permission on Chromium). Firefox denies programmatic read;
  fall back to an empty focused box.
- **Classifier latency.** The preview request is debounced 300ms and the sheet must not wait on
  it: show the box and Your games immediately, slide the detected card in when it lands.
- **Confidence floor.** A low-confidence match should not auto-select a game; keep today's
  `useRecognizedGame` null-on-doubt semantics and let the list be the fallback.
- **Web layout.** The docked bar must respect the `Screen` reading column and sit above the
  scrollbar region; on native it sits above the safe-area inset.
- **"Next up" ordering.** First unplayed game in My Games order is predictable; a "most friends
  played today" sort is tempting but surprises users who ordered their list.

## Suggested rollout

1. **PR-1 (no new UI):** extract `PickGame`'s body into a `PostScoreSheet` component; mount it
   from home behind the existing FAB with clipboard pre-fill; FAB label becomes "Paste a score".
   Add-game moves to the header overflow. Empty state unchanged.
2. **PR-2:** docked full-width bar replaces the FAB; "Friends are playing" strip at the list
   bottom; `AddGameSheet` loses its discovery section (strip owns it).
3. **PR-3:** post-success "Next up" state + arming return-to-paste for the next game.

Each step is a JS-only OTA for Workshop-independent HighScore code under `apps/highscore/src`.
