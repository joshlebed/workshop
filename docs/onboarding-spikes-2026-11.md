# HighScore onboarding: where new users drop off, and the 10 spikes to run

_Planning and design input, 2026-11-25. Numbers are from the prod snapshot of that day (94
HighScore users; 49 joined in November). Treat them as directional: the cohorts are small._

## 1. The funnel today

Per signup month, share of users who reached each milestone (ever):

| Cohort  | n   | ≥1 friend | ≥2 friends | ≥1 game | ≥3 games | ≥1 score | scored ≥7 days | push token | reminders on | used share sheet | completed share setup | active last 7d |
| ------- | --- | --------- | ---------- | ------- | -------- | -------- | -------------- | ---------- | ------------ | ---------------- | --------------------- | -------------- |
| 2026-10 | 14  | 93%       | 57%        | 93%     | 86%      | 79%      | 57%            | 14%        | 7%           | 50%              | 7%                    | 64%            |
| 2026-11 | 49  | 76%       | 41%        | 76%     | 59%      | 53%      | 20%            | 10%        | 6%           | 33%              | 24%                   | 61%            |
| All     | 94  | 85%       | 51%        | 86%     | 72%      | 68%      | 38%            | 15%        | 9%           | 37%              | 17%                   | 55%            |

Where people stall (all users, by furthest milestone):

| Stage                             | Users  | Avg active days | Joined in last 30d |
| --------------------------------- | ------ | --------------- | ------------------ |
| friends + games + scored          | 62     | 20.5            | 53%                |
| **friends + games, never scored** | **14** | **1.5**         | 71%                |
| 0 friends, 0 games                | 9      | 1.0             | 100%               |
| friends, 0 games                  | 4      | 1.3             | 100%               |
| 0 friends, games, no score        | 3      | 3.7             | 100%               |
| 0 friends, scored                 | 2      | 1.5             | 50%                |

Other facts that shape the plan:

- **Everything that happens, happens in session one.** Median time from signup to first friend,
  first game and first score is minutes. Nobody comes back later to do these.
- **Day-1 score is the activation event.** Of users who joined Oct–Nov (and are ≥7 days old):
  85% of those who posted a score on day 1 were active again after day 7, vs 22% of those who
  didn't. 2+ friends on day 1 → 73% (vs 30% with 0 friends). 2+ friends **and** a day-1 score →
  90% (n=10). 3+ games on day 1 → 81%.
- **Pending requests rot.** 58 directed friend requests are pending; 52 are older than 7 days.
  178 friendships exist, so ~1 in 4 attempted connections never completed.
- **Invites come from a handful of people.** 6 users have ever brought in a friend by link; none
  has brought in 5+. The friend-invite path works when used (100% ≥1 friend, 67% scored) but
  only 9 of 63 recent signups came through it; 25 were "none" (App Store / direct) and 29 predate
  attribution.
- **The share sheet works once set up.** 904 of ~2,050 iOS scores in the last 30 days came
  through the share extension, but only a third of users ever get there.
- **Push is nearly absent.** 14 users have a push token; 8 have reminders on. Pokes (#595) have
  been sent 43 times by 8 people; head-to-head (#605) is too new to measure.
- **Game breadth matters.** 10 users have exactly 1 game; the median is ~6. Top games: MapTap
  (54 players), Daily Tens (53), Krillion (50), Globle, Tradle, Wordle, Satle, Travle.

The activation target that falls out of this: **score posted + 2 friends + 3 games, all on day 1**
("2-3-1"). Today roughly a third of new users get there.

## 2. Deep dives on the proposed ideas

### 2.1 Phone-number registration + contacts access

**What it would do.** Verify a phone number at signup (or later), let users upload hashed
contacts, and surface "N of your contacts are on HighScore" plus "invite" rows for the rest.

**Evidence.** The research doesn't give a conversion number for contact import in social apps.
Bluesky's write-up and RFC are the best design reference: verify the number before matching,
hash on device, rate-limit imports per account, delete raw numbers after matching, and only
surface a match when both sides opted in. BeReal's suggestions combine mutuals and matched
contacts, and a match still requires the other person to accept. iOS 18 changed the terms: the
all-or-nothing contacts prompt is gone, apps can use `ContactAccessButton` for a one-tap grant of
a few contacts, and at least one investor reports contact sharing "dropped dramatically" after
the change (anecdotal). Phone OTP at signup adds friction; one vendor claims 43% abandon at
identity verification (unsourced). Apple/Google sign-in is already in place and cheap.

**Fit for HighScore.** The hard constraint is density, not discovery: Andrew Chen's framing is
that a social product needs a minimum group (10–20 people in the right network) before it holds.
Contacts help a user who already has friends on the app find them; they don't help a solo
signup whose friends aren't here. Today most new users come from a friend's link, so they have
one known contact already. The win is the **second and third friend** (mutuals already cover
part of this) and the **inviter's side**: "12 of your contacts aren't on HighScore — invite them"
is a far better invite surface than copying a link.

**Recommendation.** Do not gate signup on a phone number. Spike a **contacts-based "find and
invite"** surface that is opt-in, uses `ContactAccessButton` (limited access) first, hashes
on-device, and shows two lists: contacts on HighScore (one-tap add) and contacts not on
HighScore (one-tap iMessage invite with the play link). Phone verification becomes a separate,
optional "let friends find me by number" setting, with the Bluesky safeguards.

### 2.2 Better game suggestions ("games your friends play", "people who play X also play Y")

**What exists.** Add game → Friends only (ranked by how many friends play), the official
catalog, the post-accept picker (now ranked across the friend + requested mutuals), and the
"friends but no games" empty state.

**Evidence from our data.** 3+ games on day 1 → 81% return vs 40% for 1–2 games. 10 users are
stuck at exactly one game. Co-play is strong: the top 8 games are played by half the base, so
"people who play MapTap also play Daily Tens" is a reliable signal even at this size.

**Fit.** Collaborative filtering at 94 users is a SQL query, not ML: for each game, the games
most co-added by its players, weighted by friend overlap. The place it's missing is **after the
first game is added** and **after the first score** — the moments the data says matter.

**Recommendation.** Spike a "What to play next" rail: co-play suggestions on the board of a game
you just scored, on the empty space of a 1–2-game home, and in the post-accept picker's second
page. Include a "popular this week among your friends' friends" row to reach the solo signup.

### 2.3 Remind a friend who hasn't played yet

**What exists.** Pokes (#595): after you post, every friend's row on that board has a poke;
one per friend per game per day; 5/day. 43 sent by 8 people — a feature only power users found.

**Fit.** The data says the _recipient_ of these needs them most: the 14 "friends + games, never
scored" users have on average 1.5 active days. A nudge from a friend ("Josh is waiting for your
MapTap score") is the one message that has a social cost to ignore. But pokes depend on the
sender noticing and on the recipient having push (14 users do).

**Recommendation.** Two spikes. (a) **Automatic "you're the only one who hasn't played" nudge**:
once a day, if ≥2 of your friends posted a game you have and you haven't, send one push (or an
iMessage-able card the friend can send). (b) **Make the poke the default post-score action**
for stalled friends: after posting, "Nudge Sam, Riley — they haven't played yet" as one tap,
with the push permission pre-prompt attached to the first nudge (today the pre-prompt is tied to
the first score and gets 6–10% uptake).

### 2.4 Challenge a friend (a game they haven't played, or haven't played today)

**What exists.** Head-to-head (#605) is a record view, not a loop. Play links are per-person,
not per-game.

**Evidence.** Facebook's Instant Games guidance: trigger the challenge at the moment it matters
(you just beat a friend's score) and notify the friend; same-content fairness (same puzzle, same
day) is what makes daily games natural for this. Async challenge threads converge on an inbox +
expiry + idempotent accept.

**Fit.** Daily games are already same-content-per-day, so "beat my 937 on today's MapTap" is a
challenge without any new game logic. It is also the best **invite** we have: a challenge link
carries a concrete, time-boxed reason to install ("Josh challenged you: MapTap, today, 937"),
and it converts a game the recipient doesn't have into a one-tap add.

**Recommendation.** Spike a **per-score challenge link**: mint from the posted-score toast /
board row, OG card shows the game + the score to beat, landing adds the game, opens it, and
returns to a two-row board. Expire at the day boundary. Track accept → play → post as its own
funnel. This is the single feature that touches friend, game, score and install at once.

## 3. Patterns from elsewhere worth borrowing

- **Commit before you sign up (Duolingo).** Onboarding ends with the user having started a
  streak before the account exists. For HighScore: let a visitor from a link play/paste the first
  score _before_ sign-in, then sign in to save it. Removes the context-free sign-in wall.
- **Minimum social group / density first (Andrew Chen).** Optimise for a group of 5–10 who all
  join, not for individual signups. Group invites ("start a crew") beat 1:1 links.
- **Activation metric discipline (Facebook "7 friends in 10 days", Twitter "30 follows").** Pick
  one measurable day-1 event, instrument it, and review every onboarding change against it.
- **Friends of friends as the default suggestion (BeReal, Strava).** Already shipped as mutuals;
  the gap is surfacing them repeatedly, not once.
- **Cooperative goals, not only rivalry (Duolingo Friend Quests, Friend Streaks).** "You and Sam:
  7-day combined streak" gives two weak players a reason to keep going that leaderboards don't.
- **Push pre-prompt timed to a meaningful action (OneSignal, Airship).** Tie the OS prompt to a
  moment with an obvious payoff (a nudge you're sending, a challenge you're accepting), not to
  "first score of a session". Measure each stage: shown → accepted pre-prompt → OS granted.
- **Widgets and Live Activities (OneSignal: +23.7% D30 for apps with Live Activities; Gratitude:
  +25% retention with widgets).** A home-screen widget showing "2 of 5 friends have played
  today" is a daily re-entry point that needs no permission.
- **Celebrity / public boards (NYT Games leaderboard tracks celebrity solvers).** A public "house"
  board for solo signups so an empty home still has a comparison.
- **Low-friction first value (Wordle: no account, no app).** The web can already resolve a play
  link without a session; show the board before asking for anything.

## 4. The 10 spikes

Ordered by expected lift on the "2-3-1" activation target over effort. Each is a bounded design +
implementation investigation (prototype, measure, decide), not a committed feature.

| #   | Spike                                                                                                                                                                                                            | Funnel step                   | Question to answer                                                                                                                         | Evidence it matters                                                                  | Effort |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------ |
| 1   | **Score before sign-in.** From a play link or challenge link on web, paste/share a score and see the two-row board first; sign in to save.                                                                       | first score, install          | Does moving sign-in after the first score lift day-1 score rate?                                                                           | Day-1 score → 85% vs 22% return. Sign-in is context-free today. Duolingo pattern.    | M      |
| 2   | **Per-score challenge link.** "Beat my 937 on today's MapTap" with its own OG card, landing that adds the game and opens it, expiry at day end.                                                                  | friend, game, score, install  | Does a concrete, time-boxed challenge convert better than the generic play link?                                                           | Facebook social-games guidance; our play link is the most-sent link and the weakest. | M      |
| 3   | **Contacts "find and invite" (limited access, hashed).** Opt-in, `ContactAccessButton`, two lists: on HighScore (add) and not yet (iMessage invite). Phone verification optional, Bluesky safeguards.            | 2nd friend, invites           | What share of users grant limited access, and how many friends/invites does it yield per grant?                                            | 0 users have brought in 5+ friends; 2+ friends day 1 → 73% vs 30%.                   | L      |
| 4   | **Stalled-friend nudge, automatic and one-tap.** After you post: "Nudge Sam, Riley — they haven't played" with the push pre-prompt attached; plus a daily automatic "only one who hasn't played" push.           | first score (recipient), push | Does a friend-sourced nudge move the 14 "friends + games, never scored" users? Does attaching the pre-prompt to a nudge beat 6–10% opt-in? | Pokes used by 8 people; push tokens on 14 users.                                     | S–M    |
| 5   | **"What to play next" co-play suggestions.** Games co-added by players of your games, shown after the first score, on a 1–2-game home, and as page 2 of the post-accept picker.                                  | 3 games                       | Does a co-play rail get new users from 1–2 games to 3+ on day 1?                                                                           | 3+ games day 1 → 81% vs 40%. 10 users stuck at one game.                             | S      |
| 6   | **Day-1 checklist with one live target.** A persistent card on home for the first 48h: friend ✓ · 3 games ○ · first score ○ · share sheet ○ · reminders ○, each row a one-tap action, ordered by what's missing. | all                           | Does an explicit, ordered checklist raise 2-3-1 completion vs the current implicit flow?                                                   | Everything happens in session one or never; users don't know the next step.          | S      |
| 7   | **Pending-request recovery.** Inbound request badge + push on the home, reminder push after 48h, and expiry-with-re-send at 14 days; show requesters on the Friends tab top.                                     | 2nd friend                    | How many of the 58 pending (52 >7d) requests complete when the recipient is told?                                                          | 1 in 4 attempted connections never completes.                                        | S      |
| 8   | **Group invite ("start a crew").** One link that creates a named group, everyone who joins is friends with everyone in it, with a group board.                                                                   | friends, density              | Does a group link produce 3+ mutual friendships per invite vs ~1 for a personal link?                                                      | Chen: minimum social group; 6 inviters total, none past 4 friends.                   | M      |
| 9   | **Home-screen widget "who's played today".** Small widget: today's games, which friends have posted, tap to paste. Needs a native build (widget extension).                                                      | first score (daily), return   | Does a widget lift day-2 to day-7 score days for users who install it?                                                                     | OneSignal/Gratitude retention figures; no permission needed.                         | L      |
| 10  | **Friend streak / cooperative quest.** "You and Sam: 5 days in a row both posted" with a shared counter and a weekly cooperative goal.                                                                           | score (repeat), 2nd friend    | Does a cooperative streak retain pairs where one player is weaker?                                                                         | Duolingo: friend adders 5.6x more likely to finish (self-reported); Friend Quests.   | M      |

Not in the ten, and why:

- **Phone-number registration as the sign-up method.** Friction with no evidence of lift here;
  Apple/Google already give one-tap sign-in. Kept as an optional discoverability setting inside
  spike 3.
- **Share-sheet setup changes.** Already rebuilt three times (#577, #579, auto-open after the
  first game). Measure before touching again: completion is 24% for November signups and rising.
- **Celebrity/public board.** Fun, but it doesn't create friendships, and the privacy page
  promises no global leaderboard.

## 5. Instrumentation to put in before any spike

1. **Funnel events** for the day-1 milestones (first friend, 2nd friend, 1st/3rd game, first
   score, share-ext score, push granted, reminders on) with the entry source, so each spike has a
   control. `user_activity_days` gives days, not milestones.
2. **A weekly "2-3-1" cohort row** in the admin analytics dashboard (users who signed up that
   week; % reaching score + 2 friends + 3 games within 24h).
3. **Per-stage push permission funnel**: pre-prompt shown → accepted → OS granted, by trigger.

## Sources

- Bluesky: [Find Friends contact import](https://blog.bmannconsulting.com/3ma5ozmwfns2l),
  [secure contact import RFC](https://docs.bsky.app/blog/contact-import-rfc)
- Apple: [ContactAccessButton](https://developer.apple.com/documentation/contactsui/contactaccessbutton.md),
  [WWDC24 10121](https://developer.apple.com/videos/play/wwdc2024/10121/);
  [TechCrunch on iOS 18 contacts](https://techcrunch.com/2024/06/12/ios-18-cracks-down-on-apps-asking-for-full-address-book-access),
  [9to5Mac](https://9to5mac.com/2024/10/03/iphone-contact-privacy-change-is-good-for-developers-not-bad/)
- BeReal [friend recommendations](https://help.bereal.com/hc/en-us/articles/13270135622557-Friend-Recommendations);
  Strava [contact sync](https://support.strava.com/hc/en-us/articles/360016371512-Syncing-your-Contacts-and-Connections-with-Strava)
- Facebook [Building social games](https://developers.facebook.com/documentation/games/retain/building-social-games.md)
- Andrew Chen: [cold-start problem for social products](https://andrewchen.com/how-to-solve-the-cold-start-problem-for-social-products/),
  [zero to critical mass](https://andrewchen.com/social-network-marketing-getting-from-zero-to-critical-mass)
- Duolingo: [friends and social features](https://blog.duolingo.com/friends-social-features/),
  [streak mechanic analysis](https://duolingo.deconstructoroffun.com/mechanics/streaks),
  [product teardown](https://prodlab.substack.com/p/product-teardown-duolingo)
- NYT Games [multi-game leaderboard](https://www.fingerlakes1.com/2025/04/22/nyt-games-wordle-leaderboard-launch/),
  [social makeover](https://geardiary.com/2025/05/01/new-york-times-games-app/)
- Push opt-in: [Pushwoosh 2025 benchmarks](https://www.pushwoosh.com/blog/increase-push-notifications-opt-in/),
  [OneSignal prompting](https://documentation.onesignal.com/docs/en/prompt-for-push-permissions),
  [Airship](https://www.airship.com/blog/mobile-app-marketing-how-to-series-getting-the-opt-in),
  [MobiLoud](https://www.mobiloud.com/blog/push-notification-opt-in-rate)
- Widgets: [Finch widgets](https://www.deconstructoroffun.com/blog/x0hd2ssr80y5n7gv0w967pg7hwd7tl),
  [Gratitude +25% retention](https://android-developers.googleblog.com/2026/05/how-gratitude-widgets-boosted-user-retention-25-percent.html),
  [Expo widgets and Live Activities](https://expo.dev/blog/home-screen-widgets-and-live-activities-in-expo)
- Activation: [Appcues aha moments](https://www.appcues.com/blog/aha-moment-examples),
  [startups.com activation](https://www.startups.com/lexicon/activation)
- Auth friction: [Corbado](https://corbado.com/blog/login-friction-kills-conversion),
  [ipification](https://www.ipification.com/blog/how-mobile-apps-can-cut-the-drop-off-rate-in-sign-in-process/)
