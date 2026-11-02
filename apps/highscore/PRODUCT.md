# HighScore — product context

Drafted by an agent from README.md, DESIGN.md, UX-DECISIONS.md and docs/highscore-migration-plan.md.
Owner: correct anything wrong; this file steers design work (`/impeccable`).

## Register

product

## Product purpose

HighScore (`highscore.live`, iOS + web) is a friends-only leaderboard for daily puzzle games
(Wordle-likes, geography dailies, NYT Mini, Spotle, …). You paste or share your result, it
lands on today's board for that game, and you see where you stand against your friends.
Streaks, reactions and a "who played today" turnout line keep the loop social.

## Users

- Small friend groups (3–25 people) who already play the same dailies and share results in
  iMessage / group chats. They open the app once or twice a day, usually right after finishing
  a puzzle, from the iOS share sheet or a pasted result.
- The owner is the first power user: plays many games, has ~25 friends, and is also the admin.
- New users arrive almost only through a friend's invite link; their first session is
  "accept the invite, see my friend's scores, add my own".

## Jobs to be done

1. Post today's result in one motion (share sheet → done).
2. See how I did against my friends today, per game, at a glance.
3. Keep my streak; nudge friends who haven't played.
4. Grow the group: invite, accept, discover friends-of-friends.

## Brand and tone

A dark arcade (see DESIGN.md): neon pink CTAs, chartreuse for earned wins, yellow spotlights,
pixel type only for the wordmark, game names and score numerals. Tone of voice is short,
plain and a little playful; never corporate, never gamified-casino.

## Anti-references

- Casino / loot-box energy (confetti, coins, countdown pressure).
- Generic SaaS settings pages with a dozen equal-weight rows.
- Social-network bloat (feeds, DMs, follower counts as vanity).

## Strategic principles

- The social loop (friends' scores) is the product; settings and legal are plumbing.
- One more tap for a rare action is fine; one more tap for a daily action is not.
- App Review safety controls (report, block, terms) must stay reachable but quiet.
