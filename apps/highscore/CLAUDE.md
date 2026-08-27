# apps/highscore — coding agent guide

HighScore owns its complete frontend under `app/` and `src/games/`. Style, layout, branding, and
client behavior should be implemented locally so they cannot change Workshop users. Do not move
presentation code back into a shared package.

Shared boundaries are contracts and primitives only: `@workshop/api-client`, `@workshop/shared`
(`games`, `gameRegistry`, `scoreParsing`, `summarySpec`), and `@workshop/ui`. Workshop's current
Games UI is a frozen snapshot at `apps/workshop/src/legacyGames/`; never update it in lockstep with
HighScore. Only an explicitly requested critical-fix backport may touch both copies.

Friends remain a shared product concept backed by the same graph and `@workshop/api-client/friends`,
but each app owns its screen implementation so either frontend can evolve independently.

## Share flow

HighScore has no Workshop-style `/share` chooser — there is nothing to choose between, so
`_layout.tsx` sends the iOS share intent straight to `/share/pick-game` and `app/share/index.tsx`
renders the same `PickGame` screen. Every share affordance Workshop puts on its chooser has to live
on `PickGame` instead; the detected-score card with the one-tap **Post** button is the one that
matters. `PickGame` re-runs `detectSharedScore` over the live paste-box draft rather than the frozen
route params, so a share the iOS sheet stripped to a bare referral URL (`isResultlessShare`) shows a
"paste your result" prompt that turns into a Post button as soon as the result is typed in.
