# apps/highscore — coding agent guide

HighScore owns its complete frontend under `app/`, `src/deck/`, `src/theme/` and
`src/games/`. Style, layout, branding, and
client behavior should be implemented locally so they cannot change Workshop users. Do not move
presentation code back into a shared package.

Shared boundaries are contracts and primitives only: `@workshop/api-client`, `@workshop/shared`
(`games`, `gameRegistry`, `scoreParsing`, `summarySpec`), and `@workshop/ui`. Workshop's current
Games UI is a frozen snapshot at `apps/workshop/src/legacyGames/`; never update it in lockstep with
HighScore. Only an explicitly requested critical-fix backport may touch both copies.

Friends remain a shared product concept backed by the same graph and `@workshop/api-client/friends`,
but each app owns its screen implementation so either frontend can evolve independently.

## The app is one screen (`src/deck/`)

HighScore does not push a route to show you a game, your friends or your account. `AppShell`
holds three panels — the deck, players, you — and `ControlPanel` crossfades between them with
one 8px step (`stepped` in `src/theme/motion.ts`). The deck is a paging `Animated.ScrollView`
of full-screen cartridges (`Cartridge`), each of which scrolls _vertically_ through seven days
(`DayBlock`), so the old `games/[id]` board no longer exists as a screen. `Shelf` is the deck
zoomed out, and owns reordering.

- **`/games/:id`, `/friends`, `/friends/:userId` and `/profile` are deep-link entry points
  only.** They hand their target to `useDeckNav()` and `router.replace("/")`. Keep them: they
  are what share links, the `/g/:token` resolver and the AuthGate bounce all route through.
  Their `Stack.Screen` options are `animation: "none"` for that reason.
- **Reordering is one gesture-handler + reanimated implementation for both platforms**
  (`Shelf.tsx`). `react-native-reorderable-list` and `@dnd-kit/*` were removed from this app;
  don't reintroduce a `.web.tsx` split for drag.
- **Never print a game's raw share text in a row.** `summarizeGameScoreBody` still distills
  the provider's copy, but `distillScore` (`src/games/lib/scoreMarks.ts`) then reduces it to
  one rankable token plus `MarkKind[]`, and `ScoreMarks` draws the grid as palette squares.
  Emoji in Press Start 2P break line boxes; a token plus squares is a fixed width, which is
  what makes the score column align.
- **`scoreMarks.ts` and `monogram.ts` are deliberately dependency-free** so vitest can collect
  them. Anything importing `src/theme` pulls in `react-native-svg`/`expo-font` and fails the
  test collector with a Rollup parse error — put pure logic in its own module and keep the
  theme in the renderer.
- **Gutter labels must fit `deck.gutter`.** The marker column is 76px wide and Press Start 2P
  has a 10px floor, so a gutter word is at most four characters. Longer copy wraps mid-word
  and looks like a bug.
- **A game is identified by a `CartridgeLabel` plate, never a favicon.** The plate's monogram
  comes from `monogramsFor(titles)` where a whole deck is on screen (so two similarly-named
  games can't collide) and from `monogramFor(title)` elsewhere.

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
`/friends/accept/*`, so iOS leaves these two in the browser where a reviewer expects them.

## Account deletion (reached from the YOU panel)

The App Store Review Guideline 5.1.1(v) control lives in the **Danger zone** at the bottom of
`src/screens/EditProfile.tsx`, reached from the YOU panel → Edit profile (`/profile` is still
a real pushed route — it is a form with a destructive zone, which deserves its own screen). Rules live in
`src/lib/accountDeletion.ts`, not the component, so they're testable without a renderer: the
two-tap `nextDeletionStep` machine, the impersonation/signed-out guard, the consequences copy,
and `runAccountDeletion` — which clears stored credentials **only** after the server confirms.
A failed request must leave the session untouched and say the account still exists; never show
success for a request that didn't happen. The copy names the shared Workshop.dev account out
loud because deleting here really does delete there (one `users` row, see
`apps/backend/src/lib/accountDeletion.ts`). `src/lib/legal.ts` describes this flow and is pinned
by `legal.test.ts` — if the behavior changes, that copy changes in the same PR.

## App Store release shape (1.0)

`app.json` `version` is the App Store version **and** the runtime version (`appVersion` policy),
so it is `1.0.0` for the initial Store release — an OTA only reaches builds that claim the same
`version`. The build number is not in the repo: `eas.json` sets `appVersionSource: "remote"` with
`autoIncrement`, so EAS owns `CFBundleVersion` and increments it per production build.
`ios.supportsTablet` is **`false`** on purpose — HighScore's layouts are phone-only and an iPad
device family would make App Store Connect require a second screenshot set. Flipping it back is a
native change: bump `version` in the same PR, and expect a fresh TestFlight build plus iPad
screenshots before the next submission.
