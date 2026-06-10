# apps/workshop — coding agent guide

The Expo app builds **iOS and web from one component tree** via `react-native-web`. Web is
the primary dev surface — faster iteration, browser-automation can drive the real UI.

Human onboarding (clone → run → deploy) lives in `apps/workshop/README.md`.

## App shell: Lists/Games tabs via route groups (G0, epic #279)

The root is an expo-router `Tabs` shell: `app/(tabs)/(lists)/` holds the entire pre-Games
stack (home, lists, activity, create-list) and `app/(tabs)/games/` the Games surface. Group
segments never appear in URLs, so all deep links are unchanged — but they DO appear in
`useSegments()`; AuthGate in `app/_layout.tsx` filters `(`-prefixed segments before matching.
The Games tab is gated on `EXPO_PUBLIC_ENABLE_GAMES` (`src/lib/featureFlags.ts`: launched
2026-06-10 — unset means ON; `"0"` is the kill switch). Flag off must look exactly like the
pre-tabs app: tab bar hidden, `/games` redirects home, no web top switch. Auth/onboarding/invite/share
routes live OUTSIDE `(tabs)` in the root stack — add new tab-content routes to the
`(lists)` or `games` stack layout (`app/(tabs)/games/_layout.tsx` since G1b), not the root
one. Web shows the Lists/Games switch inline inside the top-level screen header actions,
immediately left of Activity on both Lists and Games; native uses the Expo bottom tab bar.
The Games surface (G1b): `games/index` → `src/screens/GamesHome.tsx` (My Games as
`StandingsCard`s, drag-reorder via `src/screens/games/GameCardList[.web].tsx`, add-by-URL
sheet, paste → `PUT /v1/games/:id/scores`); `games/[id]` is the per-game history board
(DayRail + today paste slot). Games API wrappers live in `src/api/games.ts`; query keys
under `queryKeys.games.*`. Every flag-off route must `<Redirect href="/" />`. Use the static `tokens` (not
`useTheme()`) for navigator backgrounds, matching the root layout, or light-preferring
browsers get a light scene behind dark screen content. Metro does NOT invalidate its
cache when an `EXPO_PUBLIC_*` value changes — after flipping the flag, restart with
`expo start --clear` or the bundle serves the stale value (`scripts/e2e.sh` always
clears for this reason).

## Friends surface (G2b, issue #286)

The share-link friend graph lives at `app/friends/index.tsx` (list + invite + unfriend) and
`app/friends/accept/[token].tsx` (preview inviter + Accept) — both at the **root** stack,
NOT inside `(tabs)`, since the backend mints invite URLs as `/friends/accept/:token`
(`friendInviteUrl` in `routes/v1/friends.ts`). Reached from the Games header (`👥` button in
`GamesHome`) and the profile/settings sheet on home; both entry points are flag-gated, and
the screens `<Redirect href="/" />` when the flag is off. The accept landing reuses the
list-invite deep-link round-trip (`inviteStash.ts`): it stashes
`PENDING_FRIEND_INVITE_TOKEN_KEY` so a brand-new user can sign in mid-flow and land back on
the accept screen — AuthGate (`_layout.tsx`) allows `/friends/accept/*` to mount signed-out
(`onFriendAccept`) and consults that stash in its post-sign-in bounce. There is **no**
"incoming requests" list: a share-link has no directed recipient until someone opens it, so
the accept route _is_ the incoming-request surface. API wrappers (zod-validated — the public
preview endpoint is the least-trusted boundary) in `src/api/friends.ts`; keys under
`queryKeys.friends.*`. The social board (home cards + per-game `[id]` board) needs no
solo-vs-multi branch: the backend's `rankEntries` already returns rank-ordered standings
(ties as 1,2,2,4) for `viewer ∪ friends`, and `StandingsCard` + the board's `EntryRow`
render ranks/ties/"you" highlighting straight from the entries. After accept/unfriend,
invalidate both `queryKeys.friends.all` and the `["games"]` prefix (friendship gates score
visibility); cross-client propagation otherwise waits on the 15s `useLivePollingInterval`.

## Friends-first onboarding + game discovery (G3, issue #293)

Games are discovered **through friends** — `GET /v1/games/discovery` (G2a) returns friends'
games you haven't added, each tagged with which friends play it; `?friend=<userId>` narrows
to one friend (404s for non-friends). Wrapper: `fetchGameDiscovery` in `src/api/games.ts`;
keys under `queryKeys.games.discovery(friendUserId?)` — the friend form nests under the
all-friends key so invalidating `["games", "discovery"]` clears both. One-tap "add" reuses
`POST /v1/games` with the discovery game's `url` (find-or-create collapses onto the existing
catalog row); there is **no** add-by-id endpoint. Three surfaces render the same presentational
`FriendGameSuggestions` (`src/screens/games/FriendGameSuggestions.tsx`):

1. **`GamesHome` empty state** (`src/screens/games/GamesOnboarding.tsx`) — two variants gated
   on friend count (the home queries `queryKeys.friends.all`, enabled only while empty): **no
   friends** → primary "Add friends" (mints + shares an invite via the G2b `createFriendInvite`
   - `shareOrCopyLink` machinery, link revealed inline on web), secondary "Add a game by URL";
     **friends but no games** → their games as one-tap suggestions. The home card list itself
     stays purely your chosen games — suggestions never appear there.
2. **The + add-game sheet** (`AddGameSheet`) — discovery suggestions ABOVE the URL field
   (capped-height scroll); URL field's `autoFocus` is suppressed when suggestions exist so the
   keyboard doesn't shove them offscreen.
3. **Post-accept picker** — `app/friends/accept/[token].tsx` no longer bounces to `/friends`
   on Accept; it sets `acceptedFriend` and renders an inline `PostAcceptPicker` (the new
   friend's games via `discovery?friend=<id>`, one-tap + "Add all", skippable) then
   `router.replace("/games")` so a brand-new user lands on a populated home. `games-social.spec`
   was updated to click through this picker (`friend-accept-picker` / `-picker-done`).

The home/sheet share one discovery query (`queryKeys.games.discovery()`, enabled when the
home is empty OR the sheet is open) so they don't double-fetch. Per-row add state
(spinner / "✓ Added") is tracked by game id in the call site (one mutation, many rows), since
RQ's `useMutation` only surfaces the latest call. The picker invalidates only
`queryKeys.games.mine(today)` on add (keeps its own suggestion list stable); the home add
invalidates both `mine` and `["games", "discovery"]` so the added game drops off suggestions.
Everything stays behind `EXPO_PUBLIC_ENABLE_GAMES` (queries gate on `GAMES_TAB_ENABLED`).

## Cross-platform code sharing

Metro resolves `.web.ts(x)` before `.ts(x)` on web and `.native.ts(x)` before `.ts(x)` on
iOS. Add a `.web.ts(x)` (or `.native.ts(x)`) **beside** a file when a feature imports a
platform-only module. Don't `Platform.OS === "web"` branch inside shared files — the
extension is cleaner and Metro strips the unused variant. Reference: `src/lib/storage.ts`
(`expo-secure-store`) + `src/lib/storage.web.ts` (`window.localStorage` shim).

Web-compatible by default: `expo-router`, `expo-linking`, `expo-constants`,
`expo-status-bar`, `expo-updates` (stub), `react-native-safe-area-context`,
`react-native-screens`, `react-native-gesture-handler`, `@react-navigation/native`.
Re-check when adding a new native module.

## iOS capabilities are config-as-code

Declare iOS capabilities (App Groups, Push, Associated Domains, etc.) in `app.json`
(`ios.entitlements` / `ios.associatedDomains`) or via an Expo config plugin **before**
enabling in the Apple Developer Portal. EAS's capability sync reverts portal-only changes
on the next build. Currently declared:

- **Sign In with Apple** — via `expo-apple-authentication`.
- **App Groups `group.dev.josh.workshop`** — declared in both `ios.entitlements` and the
  `expo-share-intent` plugin config; both are needed because the share extension also
  requires the entitlement.
- **Associated Domains `applinks:workshop-a2v.pages.dev`** — Universal Links route
  `/l/*` (primary share URL), `/invite/*` (legacy share URLs), and `/list/*`
  (canonical UUID URLs) into the app for installed users.

## Share-intent telemetry — debug the native payload from the server

The share extension is native and never exercised by CI or the web build, so when a share
misbehaves on device the only window is telemetry. `_layout.tsx` snapshots every
`useShareIntent()` payload shape (type, `hasText`/`textLen`, `hasWebUrl`/`webUrlLen`,
truncated previews, runtime version, OTA update id), `console.log`s it (`[share-intent]`),
and POSTs it to `POST /v1/telemetry/share-intent` → one CloudWatch line
(`client_share_intent`). The score upsert logs a matching `score_upsert_debug` line
(raw length/preview, `has_url`, `has_grid_emoji`, `url_only`, parsed value). The `/share`
screen also renders a one-line `ShareDiagnostics` (payload lengths + rt + ota) so the shape
is visible on the phone. All of this is **JS + backend**, so it ships to an installed build
over-the-air — no new TestFlight binary needed to start collecting data. Remove the
scaffolding once the share-extension payload bug is nailed.

## `expo-share-intent` is patched: capture `attributedContentText`

A Web Share (`navigator.share({ text, url })` — Daily Tens, etc.) reaches the iOS share
extension with the **`text` body (the result grid) in `NSExtensionItem.attributedContentText`**
and the **`url` as an `attachment`**. Upstream `expo-share-intent` only iterates
`content.attachments`, so it captured just the url (a game's `?ref=<id>` referral link) and
**silently dropped the grid** — the JS layer then sees `text === webUrl === <url>` (its
`parseShareIntent` mirrors `text` from a `weburl` share for retro-compat), which posts a
scoreless "Played" row. Proven via the `client_share_intent` telemetry: `textLen == webUrlLen
== 33`, both the bare URL. `patches/expo-share-intent.patch` (pnpm `patchedDependencies`)
reads `attributedContentText` first: when present it delivers a **text** share (grid + any url
attachments appended, so the existing JS still extracts a `webUrl`); plain link / media / file
shares with no content text fall through to the original attachment loop unchanged. The patch
targets the plugin's swift **template** (`plugin/build/ios/ShareExtensionViewController.swift`),
which EAS prebuild copies into the extension. The earlier "text-before-url for dual-conforming
providers" approach was a no-op (the url provider doesn't conform to `public.text`) — don't
reintroduce it. If you bump `expo-share-intent`, re-verify the patch applies and re-test a real
game share on a TestFlight build (the extension isn't exercised by CI or web).

## Universal Links: AASA path allowlist lives in two places

The iOS app advertises which domain to fetch via `ios.associatedDomains` in `app.json`.
The domain itself serves the path allowlist via
`functions/.well-known/apple-app-site-association.ts` — a Pages Function, not a static
file in `public/`, because Cloudflare serves extension-less files as
`application/octet-stream` and iOS sometimes silently rejects them. When you add a new
shareable route that should open in the app, add the `/path/*` entry to the AASA
function's `components` array; expo-router maps the URL pathname to the matching
`app/.../...tsx` route automatically (no manual `Linking.prefixes` config). Apple's
CDN-cached copy:
`curl https://app-site-association.cdn-apple.com/a/v1/workshop-a2v.pages.dev`.

## iOS Google sign-in waits for the exchanged id_token

Google's iOS OAuth client type only supports the auth-code flow, so
`expo-auth-session/providers/google.useAuthRequest` auto-exchanges the code for tokens
inside a `useEffect` after `promptAsync()` resolves. Reading `id_token` straight off
`await promptAsync()` is always undefined on iOS — wait for the hook's `response` state
to update with `authentication.idToken`. `useGoogleSignIn` already bridges this; don't
"simplify" it back to a one-shot read or iOS Google sign-in silently bounces users back
to the sign-in screen.

## A game share can reach us as just its referral URL (grid dropped)

Some games (Daily Tens) share via the iOS share sheet with a single item provider
conforming to **both** `public.url` and `public.text`. `expo-share-intent`'s extension
checks URL before text, so it captures only the `?ref=<id>` link and drops the 🏆/❌ grid
— we then post a bare link that renders as a "Played" row with no score. The share
screens guard against this with `isResultlessShare()` (`src/lib/shareScoreDetection.ts`):
if the payload strips to nothing (URL-only / hashtag-only), `/share` offers a "Paste"
affordance instead of one-tap posting, and `/share/pick-leaderboard` blocks the post and
asks the user to paste their result. This is a band-aid for the symptom; the root-cause
fix lives in the share extension's url-before-text precedence.

## Don't override `ios.infoPlist.CFBundleURLTypes` without re-listing the scheme

Once declared, Expo stops auto-adding the `scheme:` value. Mirror the root `scheme`
(`"workshop"`) into `CFBundleURLSchemes` manually. `npx expo config --type public`
catches it before EAS does.

## Share extension payloads can include both URL and text

Preserve both when handling `useShareIntent()` in `_layout.tsx`; score shares often need
`shareIntent.text` even when `shareIntent.webUrl` is also present. `/share` owns the
top-level choice, `/share/pick-list` handles normal item adds, and
`/share/pick-leaderboard` handles score posting.

## A cross-navigator `router.replace` collapses the target stack — pass `withAnchor`

`router.replace("/list/:id/...")` from a **root-level** screen (the `/share/*` flow lives in
the root stack, the content lives in `(tabs)/(lists)`) rebuilds the `(lists)` stack fresh with
**only** the target route — no parent beneath it. `canGoBack()` is then `false`, so every
screen's back button falls through `goBack()` (`src/lib/goBack.ts`) to `router.replace(parent)`,
which animates as a **forward push** (`animationTypeForReplace` defaults to `"push"` in
`@react-navigation/native-stack`) — the back button visibly slides the wrong way. The share
flow hit this on every destination it reached. Fix: `(lists)/_layout.tsx` declares
`unstable_settings = { initialRouteName: "index" }` (the anchor), and the share flow's terminal
`router.replace(...)` calls pass `{ withAnchor: true }` so the anchor is injected at runtime
(`initialRouteName` alone only applies to cold deep-link state, **not** runtime `replace`). Net:
`canGoBack()` is true → `goBack()` uses a real `router.back()` (a proper pop). Two corollaries:
keep the `/share/*` forward moves as `router.replace` (a clean linear chain — a stray `push`
leaves a phantom `/share` screen beneath `(tabs)` that a home swipe-back can surface), but
`pick-leaderboard`'s "add a game" stays `router.push` so the picker (and its in-progress score
draft) survives the round-trip. Any new cross-navigator `replace` into `(lists)` needs
`withAnchor` too (e.g. the invite-accept / public-landing → list paths share this shape).

## Web HTML shell lives in `public/index.html`

`app.json` → `web.output: "single"`, so Expo Router's `+html.tsx` hook isn't invoked.
Expo CLI builds HTML from `public/index.html` (or the bundled template fallback). The
iOS Safari URL-bar/home-indicator tint (`<meta name="theme-color">`),
`viewport-fit=cover`, and html/body `background-color` lock all live there. If you
switch to `output: "static"` someday, port these into `+html.tsx` in the same PR.

## Default OG tags live in `public/index.html`

That static set covers every URL without a more-specific override. Route-specific
overrides live in Cloudflare Pages Functions — see `functions/CLAUDE.md`. If you add a
new OG `<meta>` to `index.html`, mirror the selector into `OG_META_SELECTORS` in
`functions/_lib/og.ts` in the same PR or the override pipeline leaves duplicates.

## `useColorScheme()` returns `null` on web during first render

Before `prefers-color-scheme` hydrates, `useColorScheme()` is `null`. A naive
`scheme === "dark" ? darkTokens : lightTokens` silently flips to light on first paint.
Default to the baseline explicitly: `scheme === "light" ? lightTokens : darkTokens`.
See `src/ui/ThemeProvider.tsx`.

## Reanimated press feedback: wrap `Pressable`, don't replace it

`Animated.createAnimatedComponent(Pressable)` looks tempting, but `Pressable`'s
`style={({ pressed }) => [...]}` re-resolves on every render and clobbers transform
animations on the same component. Wrap a plain `<Pressable>` inside `<Animated.View>` and
keep press-state styling on the inner `Pressable`.

## Don't stack `<Sheet>`s with `setA(false); setB(true)`

Each Sheet wraps an RN `Modal` that stays mounted for ~220ms while its exit animation
runs. Flipping the second sheet open during that window briefly stacks two `Modal`s — on
iOS the new one registers as visible but never actually presents, leaving the screen
non-interactable until you navigate away. Chain through Sheet's `onClosed` prop instead.
Reference: `app/list/[id]/game/[itemId].tsx`.

## Sheet keyboard handling is centralized in `src/ui/Sheet.tsx`

Keep the backdrop close target as a sibling **behind** the sheet content, not a parent
wrapping it; iOS can otherwise treat taps inside a keyboard-moved form as backdrop taps
and dismiss the modal. Don't wrap a whole sheet form in `KeyboardStickyView`; reserve
sticky keyboard footers for full-screen forms that separate scroll content from the
footer.

## Don't add `react-native-worklets/plugin` manually

`babel-preset-expo` auto-wires it. Adding it to `babel.config.js` runs it twice.

## For animated text, use `AnimatedText` from `src/ui/Text.tsx`

Raw `<Animated.Text>` strips our `variant`/`tone` props.

## Override `lineHeight` whenever you bump `fontSize` on the shared `<Text>`

`Text` defaults to `variant="body"`, which carries a fixed `lineHeight: 22` (each variant
sets its own line-height for vertical rhythm — see `variantStyle` in `src/ui/Text.tsx`).
A local style that overrides only `fontSize` (e.g. a 34px wordmark) keeps the 22px line
box, and **iOS clips the tops of the glyphs** (web/RN-Web doesn't — the overflow just
renders, so this is invisible until you look on device). Always set a matching `lineHeight`
(~1.2× the font size) alongside any custom `fontSize`. The sign-in wordmark
(`app/sign-in.tsx`) regressed this way; emoji/icon glyphs are exempt (no ascenders to clip).

## Wrap top-level screens in `Screen` from `src/ui/Layout.tsx`

No-op on native; on web it constrains content to a ~560px reading column. Without it,
RN-Web stretches edge-to-edge. The `Sheet` modal is intentionally outside the column on
web.

## Don't spread dnd-kit's `attributes` onto a `View` wrapping a `Pressable`

`useSortable` / `useDraggable` return `attributes` with `role: "button"` and
`tabIndex: 0`; react-native-web renders any `View` with `role="button"` as an HTML
`<button>`. The inner `Pressable`s are also `<button>`s — DOM nesting warning. We only
use Mouse/Touch sensors (no KeyboardSensor), so strip `role`/`tabIndex` before
spreading. See `stripButtonRole` in `src/screens/listDetail/ItemList.web.tsx`.

## Real-time on web is `useLivePollingInterval` (15s, visibility-gated)

No SSE/WS yet. Hook at `src/hooks/useLivePollingInterval.ts`; pass into queries via
`refetchInterval`. Returns `false` on native — `refetchOnWindowFocus` + AppState
integration handles foreground refresh, and a background timer would be a battery tax.

## Runtime imports from `@workshop/shared` go through a subpath, not the barrel

The barrel re-exports `./types.js` for backend's NodeNext resolution; Metro can't
resolve those `.js` extensions at runtime. `import type` from the bare specifier is
fine (Metro elides it); a value import crashes. Pure-runtime constants live in
`packages/shared/src/constants.ts`, exported via `"./constants"`. Import with
`import { SHARED_TYPES_VERSION } from "@workshop/shared/constants"`. Add new runtime
exports to `constants.ts` (or another non-barrel subpath).

## Native module added → bump `app.json` `version` in the same PR

Runtime version policy is `appVersion`. If you add `react-native-foo` (native) at
`version: 0.1.0` without bumping, the new OTA targets `0.1.0`, which the
already-installed pre-PR `0.1.0` TestFlight binary also claims. The OTA applies, then
crashes on next launch with `Native module RNFoo cannot be null` — existing users have
to delete + reinstall. Bumping to `0.2.0` makes the OTA target `0.2.0`, which only
post-PR builds claim. The `Runtime version guard` workflow enforces this (fails a PR with a
new iOS fingerprint or changed app.json native fields and no `version` bump). When in doubt,
bump. Full deploy-pipeline context: `docs/ios-deploy-pipeline.md`.

## Niteshift preview proxy strips CORS preflight auth

The proxy (`https://ns-<port>-<id>.preview.niteshift.dev`) rejects unauthenticated
OPTIONS preflights with `403`. `src/config.ts` works around this by deriving the API
URL from `window.location` on web (localhost stays; `ns-<port>-<id>` rewrites to the
matching `ns-8787-<id>` host). Keep that derivation in place or browsers can't sign in.
