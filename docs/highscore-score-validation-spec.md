# HighScore: invalid, misfiled and unreadable scores

**Status:** decided with Josh on 2026-10-07. Not implemented. This is a product spec for the
parse, teach and recognition workstreams of the score-parsing overhaul.

**Scope:** what happens when a pasted score is invalid, lands in the wrong game, or can't be
read, and who may change a game's parser. HighScore only; Workshop's `legacyGames` is frozen.

## Premises (fixed elsewhere)

- Parsers and recap formatters are code stored on the game row, run only on the server in a
  QuickJS sandbox at upload. The parsed value and formatted summary are stored with the score.
- Teaching is two LLM calls: list candidate score features, then write code for the one the
  user picked. The instant candidate picker is the fallback when the LLM is slow or down.
- Posting never depends on an LLM. The raw text always saves.
- Recognition is not taught: a cheap URL, domain or label match first, a Jev classifier as
  backup, exposed as `recognizeGame(raw, candidates)`.
- Formatters are operator-editable only. Games without one show cleaned raw text.

## Evidence

Read-only queries against prod `game_scores` (2,777 rows, 19 games, 162 rows with no value).

| Finding                                       | Example                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| A hand-written parser was broken unseen       | Worldle has no value on 86 of 87 rows: real shares read `#Worldle #N (DD.MM.YYYY) N/6`.                        |
| The first-number fallback stores wrong values | Krillion `#81 🦐` / `415` stored 81. Gerrymandle `#96` stored 96.                                              |
| A taught parser overfit one example           | Geozee's parser anchors on `/775`; the denominator changes daily, so 11 of 37 rows are empty.                  |
| Most empty values are real losses             | Tradle's 31 are 30 × `X/6` plus a typed `failed`. Travle has 8 × `(1 away)`.                                   |
| Users type their own "no result"              | `(Gave up)`, `(Cheated)`, `Failed`, `wtf`, `:/`, `hi`.                                                         |
| Wrong-game posts match another known game     | Five rows: Daily Tens under GeoSports (2), MapTap under Globle and NYT Mini, Globle under Geozee.              |
| Some scores are not a number in the text      | Daily Tens is a count of 🏆. Connections is a count of guess rows. A trimmed Satle grid is the position of 🟩. |
| Title-only shares                             | `MapTap.gg - Daily Geography Game` (5 rows): the share sheet passed the page title only.                       |
| Formats drift                                 | GeoSports swapped its score and emoji lines between July and August.                                           |
| Volume is small and skewed                    | Seven games have 10 or fewer rows; four have exactly one.                                                      |

## Decisions

### 1. The parser's result is the validator

- A parser returns exactly one of: a **score**, an explicit **no result** (a loss such as
  `X/6`), or it fails (throws, times out, returns anything else), which is **unread**.
- Recognition answers "which game", never "is this valid". It warns only when the text
  **positively matches a different game**. "Doesn't look like this game" is not a warning.
- No per-game validator block. The first-number fallback is removed: a game with no parser is
  unread until taught.

Why: a loss and a parse failure are the same null today, which hid the Worldle breakage. A
recognition gate would nag on games with one to three stored examples.

### 2. One preview in both entry points; posting is never blocked

- The paste sheet and the share flow's detected-score card both show a server dry-run before
  Post. The share flow stays one tap.
- If the preview takes longer than about 1.5 seconds, the user can post without it.
- The poster can fix a score afterwards from **Fix score** on their own row. Only the poster
  sees that action.

### 3. Anyone can re-teach by correcting their own score; there is no owner

- A correction always fixes the corrector's own score.
- The shared parser changes automatically only when the new code reproduces every
  user-confirmed pick and leaves other users' already-read scores unchanged. It may give a
  value to rows that were unread.
- This applies to every game, including the 17 that are hand-coded today, once their parsers
  are ported to code on the row.

Why no owner: four games have a single score ever, so the owner would be whoever pasted once.
Orphaned games would fall back to the operator, and ownership needs notification and transfer
surfaces. Admin-only re-teach is what left Worldle and Geozee broken.

### 4. Bad teaches: prevent at pick time, repair by the next tap, escalate on conflict

- **Overfit code.** Before code is accepted, the server alters the example and requires the
  result to follow: swap a picked number for another number, or add or remove one symbol for a
  count.
- **Careless pick.** The first LLM call labels each candidate (score, puzzle number, date,
  streak). The picker pre-selects the top score candidate and asks for confirmation on a
  mismatch. A user can always overturn their own earlier pick.
- **Conflicting picks.** When a correction conflicts with another user's confirmed pick, the
  corrector's own score is fixed, the game is flagged, and the operator is pinged. When a
  second user makes a matching correction, the parser switches and rows read by the outvoted
  version are re-read. Rows holding a user's own pick keep that value.

Score direction (lower or higher wins) follows the same rule. The LLM is not a tiebreak vote:
pasted text can steer it.

### 5. Format changes are ordinary corrections

- The first affected poster's tap re-teaches the game. There is no unattended re-teach.
- New code must reproduce the last **30 days** of confirmed picks and read scores. The
  code-writing call receives the current code and extends it, so both formats work during the
  transition. Older examples stop constraining the code.
- Stored values never move on a format change. Each score records the parser version that
  produced it.
- The operator is pinged when three consecutive posts from two or more users are unread with no
  accepted re-teach in between.

### 6. Trust: users choose what counts in their own text, nothing more

- A user can pick which computed candidate is their score, choose "I didn't finish", re-post
  the same day, or delete their score.
- A user cannot enter a value that was not computed from their text, or change another user's
  row. Editing the text before posting cannot be prevented; friends see the text on the row.
- A pick becomes a training example only when the text positively matches the game by label or
  URL. Otherwise it changes that user's score only.
- A picked score shows an **adjusted** label to friends only while the shared parser returns a
  different result for that text. "I didn't finish" is never labelled.

### 7. Edge inputs

| Input                                             | Behaviour                                             |
| ------------------------------------------------- | ----------------------------------------------------- |
| Empty, URL-only, or only the game's title         | Rejected by the server before any code runs.          |
| Over 2,000 characters                             | Rejected (existing limit).                            |
| A day in the future                               | Rejected. Past days stay allowed.                     |
| Text identical to the user's score on another day | Warned, then allowed.                                 |
| Hand-appended note                                | Allowed. Kept in the text; must not change the score. |
| Junk (`:/`, `hi`)                                 | Allowed. Unread, posts without a rank.                |
| Parser timeout or memory limit                    | Unread. Never an error response.                      |

Nothing reads the day out of the text. A first paste of yesterday's result lands on today
unless the user picks the day on the game board.

### 8. History is re-read once

- After the new parsers exist, all stored scores are re-read once. The operator reviews a
  dry-run list of changes before it runs.
- Nobody is notified and nothing is labelled. Streaks count days played, so they do not move.

### Candidates are computed, not just numbers

- A candidate is a feature the server computes from the text: a literal number, a symbol count
  (`7 × 🏆`), a row count (`6 rows`), a position (`🟩 is 4th`), or a duration.
- The LLM proposes what to compute; the server runs it and shows the output. The LLM never
  supplies the value.
- Counts are scoped to the result grid, so a note like `🏆 crushed it` does not add one.
- A zero count is a score, not a loss (an all-❌ Daily Tens grid is 0). "No result" is the
  parser's explicit call.

## States and copy

| State                     | Where                   | Copy                                                                           | Actions                                  |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| Score read                | Paste sheet, share card | "Score: 944" or "Score: 7 (counted 🏆)", with a "Not right?" link              | Post                                     |
| No result                 | Paste sheet, share card | "No score today. This posts and ranks last."                                   | Post                                     |
| Unread                    | Paste sheet, share card | "Couldn't read a score. Tap yours:" then candidate chips and "I didn't finish" | Post, with or without a pick             |
| Wrong game                | Paste sheet, share card | "This looks like a Daily Tens score."                                          | "Post to Daily Tens", "Post here anyway" |
| No result text            | Paste sheet, share card | "We got the link but not your result. Paste your result to post a score."      | None until text is added                 |
| Same text as another day  | Paste sheet, share card | "This is the same result you posted yesterday. Post anyway?"                   | Post, Cancel                             |
| Pick disagrees with label | Candidate picker        | "That looks like the puzzle number. Use it anyway?"                            | Confirm, pick another                    |
| Unread, own row           | Standings               | Cleaned text, no rank                                                          | "Fix score" (poster only)                |
| Picked, parser disagrees  | Standings               | "adjusted" beside the score                                                    | Tap to see the original text             |

Standings order: scores by direction, then no-result rows in last place, then unread rows with
no rank.

## Contract implications

### Parse workstream

- Parser output is `score` with a number, `no_result`, or failure. Store per score: the value,
  a status (`score`, `no_result`, `unread`), a source (`parsed`, `picked`), the parser version,
  and the formatted summary.
- `adjusted` is derived: source is `picked` and the current parser's result for the stored text
  differs. Recompute it when the parser version changes; return it on standings entries.
- Add a dry-run preview that returns status, value, a short derivation label, candidates,
  any wrong-game match, and any same-text day. The share flow needs a variant that takes text
  with no game and returns the recognised game plus its preview.
- The score upsert accepts an optional pick (a candidate from the preview, or "I didn't
  finish"). A second call applies a pick to an existing row.
- Enforce the edge-input gate on the server, including the URL-only check that is client-side
  today (`isResultlessShare`) and day validation.
- Remove `parseFirstNumber` from the resolution chain.
- Provide the one-off re-read with a dry-run diff (the successor to `scripts/rescore-game.ts`).

### Teach workstream

- Candidates are server-computed features with a role label from the LLM. Always offer
  "I didn't finish".
- The fallback picker must tally any repeated symbol. Today's list of 23 emoji misses
  Krillion's 🦑🏮🫧 and Minute Cryptic's ⚪️🟣.
- Acceptance of new code, in order: sandbox limits; the alteration test; reproduces every
  confirmed pick in the 30-day window; returns the stored value for every other read score in
  the window. Then re-read unread rows in the window.
- On a conflict: keep the corrector's value, flag the game, ping. On a second agreeing user:
  switch, re-read rows produced by the outvoted version, keep stored values where the new code
  is unread, drop the outvoted example, ping.
- A pick is stored as a confirmed example even if code generation fails or finishes after the
  post.
- Every version is kept with its author and example (`game_spec_revisions` today), and rollback
  restores a prior version.

### Recognition workstream

- `recognizeGame` must report which game matched and whether the match was the cheap one
  (label, URL, domain) or the classifier.
- The wrong-game warning needs a positive match to a different game. Pick the classifier
  threshold from the eval.
- Training-example eligibility uses the cheap match to **this** game only, never the classifier.
- Title-only detection needs each game's title and labels.
- The preview must not wait on the classifier: a cheap-match warning is immediate, and a
  classifier result that misses the 1.5-second budget is dropped.

## Not decided

- Where a user corrects score direction after the first teach.
- Practice-mode shares such as `#travle_practice +2` (two rows in prod).
- Whether routine, accepted teaches still ping the operator. Today every teach does.
- A single-player game whose re-teach keeps failing never reaches the two-user ping.
