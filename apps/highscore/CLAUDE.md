# apps/highscore — coding agent guide

Design language: `DESIGN.md` (binding). Layout/navigation rationale for the current UX:
`UX-EXPLORATION.md`. Visual tokens and primitives live in `src/theme/` — never import colors,
type or shape from `@workshop/ui`; behavior-only helpers (`confirm`, `haptics`,
`openExternalUrl`, `formatRelative`, `REORDER_AUTOSCROLL`, `GoogleSignInButton`) still come
from there.

HighScore owns its complete frontend under `app/` and `src/games/`. Style, layout, branding, and
client behavior should be implemented locally so they cannot change Workshop users. Do not move
presentation code back into a shared package.

Shared boundaries are contracts and primitives only: `@workshop/api-client`, `@workshop/shared`
(`games`, `gameRegistry`, `scoreParsing`, `summarySpec`), and `@workshop/ui`. Workshop's current
Games UI is a frozen snapshot at `apps/workshop/src/legacyGames/`; never update it in lockstep with
HighScore. Only an explicitly requested critical-fix backport may touch both copies.

Friends remain a shared product concept backed by the same graph and `@workshop/api-client/friends`,
but each app owns its screen implementation so either frontend can evolve independently.

## Navigation: the dock

`src/nav/dock.tsx` owns every piece of navigation chrome. Screens declare their keys with
`useDock(memoizedKeys)`; the provider keeps a **stack** of registrations keyed by a per-mount
id, because expo-router leaves the pushing screen mounted and a plain "last write wins" would
strand the pushed screen's keys after a pop. A screen that registers nothing (sign-in,
onboarding, the legal pages) gets no dock — the bar animates itself away rather than rendering
an empty frame. Conventions the keys must keep: the **last key is the way out** and is never
the widest (`weight: 0.7`); at most **one key is lit** (`tone: "primary"`, filled pink); and a
destructive action is never the lit key. `DOCK_HEIGHT` is the bottom inset every docked screen
owes its scroll content.

Layout weights are ratios, not fractions — the Dock normalises them so the smallest live key
has `flexGrow ≥ 1`, otherwise a screen whose only action is BACK leaves the bar two-thirds
empty.

## Gestures

`GameRow` and the board header use `react-native-gesture-handler` Pan gestures. They work under
CDP mouse input on web **only if the moves are paced** (~50ms apart); a burst of synthetic
`pointermove`s never activates the handler, which makes swipes look broken in browser
automation when they are fine. Every gesture has a visible tap fallback — see the table in
`UX-EXPLORATION.md`; web users are expected to use the fallbacks.

The home day scrubber is not a gesture: it is rendered _above_ the top of the list and the
list is parked past it on first layout, so "pull down to reveal" is just scrolling up. That
avoids a Pan handler competing with the list's own scroll on both platforms. The park needs
both the viewport height and the content height, and re-arms whenever the list remounts
(leaving sort mode) — `contentOffset` is iOS-only and `onContentSizeChange` can beat the first
layout, so neither alone is enough.

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

## Account deletion

The App Store Review Guideline 5.1.1(v) control lives in the **Danger zone** at the bottom of
`src/screens/EditProfile.tsx` (dock → YOU → EDIT). Rules live in
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
