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

Share-panel adoption observability: the `_layout.tsx` redirect appends `via=share-extension`, and
`PickGame` maps that to `entrySource: "share_extension"` on the score upsert (all other paste surfaces
send `"paste"`); the redirect also reports the intent snapshot to the log-only
`POST /v1/telemetry/share-intent` (`src/api/telemetry.ts`). Keep the `via` param if you touch the
redirect — it's the only thing distinguishing a share-sheet post from a manual paste, and the
backend derives the durable `user_flags` adoption marker from it (see root CLAUDE.md).

## "Get the app" banner (web, iOS browsers only)

`src/components/AppStoreBanner.web.tsx` mounts in `AuthGate` above the router (native variant is
`null`; hidden on `/sign-in`, which has its own App Store card). The show rule and cookie helpers
are pure in `src/lib/appStoreBanner.ts` (pinned by its test): iPhone/iPad UA only (iPadOS reports
as a Mac with `maxTouchPoints > 1`), never in a standalone home-screen context, and hidden once the
`hs_app_banner_dismissed` cookie exists. The X sets that cookie with the 400-day browser maximum —
per device by design, so a new device sees the banner again. It complements, not replaces, the
Safari-only Smart App Banner (`apple-itunes-app` meta in `public/index.html`).

## Public pages (`/support`, `/privacy`, `/terms`)

All three routes render with no session. `src/lib/publicRoutes.ts` is the single source of truth, and
`AuthGate` in `app/_layout.tsx` consults `isPublicRoute` before every redirect **and** before the
loading / "can't connect" interstitials — a public page has to resolve even when the API is
unreachable. The first two URL literals are registered in App Store Connect (support URL + privacy policy
URL) and `/terms` is the EULA the sign-in screen links to (Guideline 1.2), so renaming any is
a metadata change, not a refactor. Copy lives in `src/lib/legal.ts` and
is pinned by `legal.test.ts`: every claim there about what HighScore stores, how long it keeps it,
and what it never does must stay literally true of the shipped app. The screens are thin wrappers
over `src/screens/legal/LegalScreen.tsx`. The AASA (`functions/.well-known/`) only claims `/g/*` and
`/friends/accept/*`, so iOS leaves these in the browser where a reviewer expects them.

## App Review 1.0 (9) rejection fixes — don't regress

- **Guideline 4 (Sign in with Apple artwork):** the Apple button is the system
  `AppleAuthenticationButton` in `src/components/AppleSignInButton/impl.tsx` (web variant beside
  it). Never swap it back to the styled `Button` — Apple checks the logo is theirs.
- **Guideline 5.1.2 (consent before uploading scores):** the sign-in legal line and the paste
  sheet caption both say scores are uploaded and shown to friends; the privacy page says the same
  and that there is no global leaderboard. `legal.test.ts` pins those sentences.
- **Guideline 1.2 (UGC):** `/terms` EULA, Report (profile page + reaction picker row → `ReportSheet`),
  Block (profile page; unblock in Edit profile → Blocked users). The reaction-picker → report
  hand-off goes through `useScoreReportFlow` so two Sheets never stack. Backend + operator side:
  `docs/moderation-runbook.md`.

## Account deletion

The App Store Review Guideline 5.1.1(v) control lives in the **Danger zone** at the bottom of
`src/screens/EditProfile.tsx` (profile menu → Edit profile). Rules live in
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

## Photo-library purpose string

`expo-image-picker` is an Expo auto-plugin, so leaving it out of `app.json` `plugins` still
ships a working picker — with the generic "Allow HighScore to access your photos" string, which
App Review can flag under 5.1.1(ii). The explicit `photosPermission` entry in `app.json` is the
one that describes the use (profile picture). Camera/microphone are `false` on purpose; the
picker never opens them. Any change here is a native change: bump `version`.

## Share while signed out

`useShareIntentRedirect` returns whether a payload is pending and `AuthGate`'s post-sign-in
resolver skips its `router.replace("/")` while it is — otherwise the async home redirect lands
after the `/share/pick-game` one and the shared score is silently discarded.

## Reorder activation vs. taps (Games home)

Every Games-home card is both a drag handle and a stack of tap targets, and once a drag
_activates_ the tap is lost: RN `Pressable` suppresses `onPress` after `onLongPress`, and dnd-kit
stops the trailing `click` at document capture. The thresholds all come from `REORDER_ACTIVATION`
in `packages/ui/src/reorderActivation.ts` (500ms hold on native + web touch, 10px mouse travel on
web). The previous 250ms hold / 4px distance swallowed hesitant taps and trackpad-drift clicks —
"tapping a game or a leaderboard row sometimes doesn't open the board until the second tap". Don't
hard-code a new `delayLongPress` or sensor constraint on these surfaces; read it from the constant,
and keep the native long-press and the web `TouchSensor` delay equal.

## Open Graph cards (`functions/og/**`)

Three cards — default, `/og/g/:token` (play link), `/og/friend/:token` — share one renderer in
`functions/_lib/og.ts`. Two things are deliberately **not** done at request time:

- **The background is a pre-rendered raster**, `public/og-bg.png`, from
  `pnpm --filter highscore-app run og:background` (`scripts/build-og-background.mjs`, zero deps).
  Satori/resvg interpolate CSS gradients in sRGB with no dither, which greys out and bands on a
  dark card. The script blends icon-palette colour fields in OKLab and applies a 1-LSB Bayer
  dither. Keep it ordered dither, not random noise or grain: the card PNG is re-encoded by resvg
  on every render, and its byte size is most of a cold card's end-to-end time (random dither ≈2x,
  grain ≈5x the bytes for no visible gain at OG sizes).
- **Fonts are self-hosted** (`public/fonts/Inter-{500,700}.ttf`, OFL) and loaded through the
  ASSETS binding by `functions/_lib/fonts.ts`, memoised per isolate. Don't reintroduce
  `loadGoogleFont`: it keys its cache on the glyph subset (so on the sharer's name), re-fetches
  the TTF every request, and leaves the colo.

The remaining cold cost (~0.6s) is resvg PNG-encoding a full-entropy 1200x630 image and is not
tunable from workers-og. So the cards carry a 1-day `s-maxage` + 30-day `stale-while-revalidate`
(`OG_CARD_CACHE_CONTROL`), and the app **pre-warms** the play card the moment a link is minted
(`prewarmGameShareCard` in `src/games/lib/prewarmShareCard.ts`). iMessage builds the preview on the sender's
device, so that fetch lands the crawler on the same colo's warm cache. If you add a new share
surface, pre-warm its card the same way.

## Posting a score never waits on a round trip

The Post button is open the moment there is text. The server dry run (`useScoreCheck`) is
advice: "Checking…", a late preview and a wrong-game warning all leave Post enabled, and only
the server's own "nothing to post" refusal (a bare link or title) holds it — `blocksPosting` in
`src/games/lib/scoreCheck.ts` is the one place that decides. A post made while a wrong-game
warning is on screen is sent as `wrongGame.choice: "here"`; a wrong reading is one tap to fix
from the row. On success every surface (home paste sheet, board, share flow) writes the returned
score into the cached `GET /v1/games` list through `writePostedScore` (`src/games/lib/postedScore.ts`),
toasts and navigates at once, and lets the list refetch re-rank in the background — never
`await invalidateQueries(...)` before the toast or the navigation. The share flow asks for one
preview (`POST /v1/games/score-preview`), which seeds the per-game check's cache inside its own
`queryFn`; `useScoreCheck` on that screen gets no game id until that answer is in, so the
registry's guess at the game can't send a second, identical `scores/preview`.

Because Post never waits, a post can land before its preview said anything. The server then
returns `check` on the post (`PostedScoreCheck`: the wrong-game match, the same-text day), and
`usePostedScoreNotice` (`src/games/hooks/`) turns it into the one toast every post surface shows:
plain "Score posted", or the advice with its action — **Move** (upsert to the named game with
`wrongGame.choice: "there"`, then clear here) or **Undo** (clear). Copy lives in the pure
`src/games/lib/postedCheck.ts`. A post that carried `previewSeen: true` has no `check`; the
response's `standings` block, when present, replaces the card's block in the cache outright.
