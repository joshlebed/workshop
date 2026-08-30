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

## Public pages (`/support`, `/privacy`)

Both routes render with no session. `src/lib/publicRoutes.ts` is the single source of truth, and
`AuthGate` in `app/_layout.tsx` consults `isPublicRoute` before every redirect **and** before the
loading / "can't connect" interstitials — a public page has to resolve even when the API is
unreachable. The two URL literals are registered in App Store Connect (support URL + privacy policy
URL), so renaming either is a metadata change, not a refactor. Copy lives in `src/lib/legal.ts` and
is pinned by `legal.test.ts`: every claim there about what HighScore stores, how long it keeps it,
and what it never does must stay literally true of the shipped app. The screens are thin wrappers
over `src/screens/legal/LegalScreen.tsx`. The AASA (`functions/.well-known/`) only claims `/g/*` and
`/friends/accept/*`, so iOS leaves these two in the browser where a reviewer expects them. In-app
account deletion is still missing — an open App Store blocker; the pages point at support for it.
