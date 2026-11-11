# apps/workshop — coding agent guide

The Expo app builds **iOS and web from one component tree** via `react-native-web`. Web is
the primary dev surface — faster iteration, browser-automation can drive the real UI.

Human onboarding (clone → run → deploy) lives in `apps/workshop/README.md`.

## Games were removed from Workshop on 2026-11-06 — only the `/g/:token` hand-off remains

Daily games live in HighScore (`apps/highscore`). Workshop has no Games tab, no Lists / Games
switch, no games routes, and no share-to-games option; `/share` redirects straight to
`/share/pick-list`. The one survivor is `app/g/[token].tsx`: the Workshop AASA still claims
`/g/*`, so an installed Workshop app intercepts old play links before the Pages-level 301 can.
It calls `openHighScore({ path: "/g/<token>" })` on mount and renders `GamesMovedScreen`
(`src/screens/gamesMoved/`) behind it. The hand-off helpers live in `src/lib/highscoreHandoff/`:
`HANDOFF_PLATFORM` is `ios` (native), `ios-web` (iPhone/iPad browser, UA-sniffed), or `web`;
`impl.ts` `openHighScore` tries the `highscore://` scheme and falls back to the App Store on
rejection — no `canOpenURL`, which would need `LSApplicationQueriesSchemes` and a TestFlight
build. `/g/*` mounts signed-out (AuthGate's `onGameShare`). The backend keeps 410ing Workshop
clients on `/v1/games*` + `/v1/game-share*` (`middleware/workshop-games-sunset.ts`) for old
binaries that never took the OTA. `EXPO_PUBLIC_ENABLE_GAMES` is no longer read; the leftover
`"1"` in `eas.json` (an `@expo/fingerprint` input) and the `deploy-mobile.yml` /
`testflight.yml` env blocks are no-ops — drop them with the next native bump.

## App shell: a one-tab `Tabs` shell via route groups

The root is an expo-router `Tabs` shell holding a single tab, `app/(tabs)/(lists)/` (home, lists,
create-list, profile). The bottom tab bar is hidden (`tabBarStyle: { display: "none" }`). The
groups are kept (rather than flattened) so no URL, deep link, or `withAnchor` replace changes.
Group segments never appear in URLs but DO appear in `useSegments()`; AuthGate in
`app/_layout.tsx` filters `(`-prefixed segments before matching. Auth/onboarding/invite/share/
friends routes live OUTSIDE `(tabs)` in the root stack — add new tab-content routes to the
`(lists)` stack layout. Use the static `tokens` (not `useTheme()`) for navigator backgrounds,
matching the root layout, or light-preferring browsers get a light scene behind dark screen
content. Metro does NOT invalidate its cache when an `EXPO_PUBLIC_*` value changes — restart
with `expo start --clear` after changing one (`scripts/e2e.sh` always clears for this reason).

## Friends surface (G2b, issue #286)

Friends are a core/shared product surface (always on — no flag). Workshop's screen
implementations live in `src/friends/`, and both apps share the validated HTTP boundary at
`@workshop/api-client/friends`. They read token/user/routes from `src/lib/clientRuntime.tsx`
(provided by `ClientRuntimeBridge` in `app/_layout.tsx`).

The friend graph lives at `app/friends/index.tsx` (requests + list + mutuals + invite),
`app/friends/[userId].tsx` (per-user profile), and `app/friends/accept/[token].tsx` (preview
inviter + Accept) — all at the **root** stack, NOT inside `(tabs)`, since the backend mints
invite URLs as `/friends/accept/:token` (`friendInviteUrl` in `routes/v1/friends.ts`).
Reached from the profile/settings sheet (`ProfileMenu`, which also badges its avatar trigger
with the pending inbound-request count from `queryKeys.friends.requests`). The accept landing
reuses the list-invite deep-link round-trip (`inviteStash.ts`): it stashes
`PENDING_FRIEND_INVITE_TOKEN_KEY` so a brand-new user can sign in mid-flow and land back on
the accept screen — AuthGate (`_layout.tsx`) allows `/friends/accept/*` to mount signed-out
(`onFriendAccept`) and consults that stash in its post-sign-in bounce. Accept lands on
`/friends`. The friends page has three sections: pending **inbound requests** (accept/decline
inline), friends, and **mutuals** ("people you may know" — friends of friends ranked by mutual
count, one-tap request). The client filters inbound requesters out of the mutuals list (they're
already in Requests) and marks outbound-pending mutuals as "Requested" by cross-referencing
`queryKeys.friends.requests` — the mutuals endpoint itself doesn't know about pending
requests. Every person card opens `/friends/:userId`, which renders the relationship-specific
action (add / cancel / accept-decline / remove). The profile endpoint still takes a `period`
(HighScore uses its per-game score lines); Workshop passes `localDateKey()` and ignores the
`games` field. Decline and unfriend `goBack("/friends")` after success — removing the
relationship can 404 the profile on refetch (no relationship + no mutuals). API wrappers
(zod-validated — the public preview endpoint is the least-trusted boundary) live in
`packages/api-client/src/friends.ts`; keys under `queryKeys.friends.*`.

## Profile avatar circles

Use the shared `Avatar` component for any user identity circle. For the signed-in user, pass
`user.avatarUrl` directly so profile edits update immediately; for other user ids, use
`userAvatarImageUrl(userId)` from `@workshop/api-client/avatar`. That route returns the stored picture
as an image when one exists and 404s otherwise; `Avatar` handles image load failure by falling
back to initials. Do not hand-roll initials-only circles for members, friends, or leaderboard
rows.

## Cross-platform code sharing

Metro resolves `.web.ts(x)` before `.ts(x)` on web and `.native.ts(x)` before `.ts(x)` on
iOS. Add a `.web.ts(x)` (or `.native.ts(x)`) **beside** a file when a feature imports a
platform-only module. Don't `Platform.OS === "web"` branch inside shared files — the
extension is cleaner and Metro strips the unused variant. Reference:
`packages/api-client/src/storage/impl.ts` (`expo-secure-store`) +
`packages/api-client/src/storage/impl.web.ts` (`window.localStorage` shim).

Inside a workspace package this only works for **relative** imports: Metro resolves a package
`exports` target with an exact file lookup and skips platform extensions entirely. So a
platform-variant package export is a fixed shim — `src/storage/index.ts` doing
`export * from "./impl"` — with `impl.ts` / `impl.web.ts` beside it.

Web-compatible by default: `expo-router`, `expo-linking`, `expo-constants`,
`expo-status-bar`, `expo-updates` (stub), `react-native-safe-area-context`,
`react-native-screens`, `react-native-gesture-handler`, `@react-navigation/native`.
Re-check when adding a new native module.

## Managed auth credentials

All API calls advertise session protocol v2 and include cookies. `api.ts` owns a single-flight 401
refresh + one-shot retry, while `useAuth.tsx` owns bootstrap and installs the refresh handler. Keep
platform storage behind `sessionCredentials.ts` / `.web.ts`: native persists access + rotating refresh
tokens in SecureStore; web persists neither managed bearer nor refresh token (the refresh token is an
HttpOnly cookie) and keeps only non-sensitive managed-session-presence / explicit-signed-out markers
so a new visitor does not probe refresh and an offline signout cannot be undone by a stale cookie on
reload. Existing `workshop.session.v1` bearer tokens upgrade through `POST /v1/auth/session`.
If that endpoint 404s during a rolling deploy, verify via legacy `/v1/auth/me` and retry the upgrade on
the next launch. A 401 from refresh clears auth; network, 5xx, 429, and missing-new-endpoint failures
must preserve credentials and render AuthGate's retry state.

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
(`client_share_intent`). All of this is **JS + backend**, so it ships to an installed build
over-the-air — no new TestFlight binary needed to start collecting data. Remove the
scaffolding once the share-extension payload bug is nailed.

## `react-native-reorderable-list` is patched: drag-start races could freeze scrolling

Native list reorder (`ItemList.tsx`) activates via a 250ms `Pressable`
`onLongPress` calling `useReorderableDrag()`'s `drag()` — a JS-thread event that hops to the
UI thread via `runOnUI(startDrag)`. The finger-lift is processed directly on the UI thread by
the library's pan gesture, so a lift near the 250ms mark (or under JS-thread load) could land
**after** the pan finalized: the library entered `DRAGGED`, disabled scroll on both the
FlatList and the outer `ScrollViewContainer` via `setNativeProps({scrollEnabled: false})`,
and its gesture-state reaction (the only re-enable path) never fired again — the whole screen
stopped scrolling until the user happened to drag on the ordered section or left the screen.
`patches/react-native-reorderable-list.patch` fixes this in `startDrag` (bail unless the pan
gesture is currently BEGAN/ACTIVE — same-thread check, fully closes the race) and in
`onBegin` (always record gesture state so the check sees the current touch, not the previous
gesture's terminal state). The patch edits `src/` (what Metro bundles — the package's
`react-native` field points at `src/index`) **and** both `lib/` builds; keep all three in
sync if you touch it. Pure-JS patch: the iOS fingerprint doesn't move, so no `app.json`
version bump and it OTAs to existing builds. If you bump the library, re-verify upstream
fixed this (drag start must validate gesture liveness on the UI thread) before dropping the
patch.

## Native list-detail drag crosses the Ranked ↔ unranked boundary via ONE combined list

`react-native-reorderable-list` can only reorder within a single list's `data`, so promote/
demote-by-drag on native (`ItemList.tsx`) renders `[...ordered, ...unordered]` in ONE
`NestedReorderableList` (enabled when ranking is on and the ranked block is non-empty;
empty-ranked falls back to the hint + kebab "Move to ordered"). `resolveCombinedReorder`
(`combinedReorder.ts`, unit-tested) maps the library's `{from,to}` to the neighbor-relative
`POST /v1/items/:id/move` (`beforeItemId`/`afterItemId` set → ranked between those rows; both
`null` → unranked). For a move that stays within the ranked block it returns the exact same
neighbors as `neighborsForOrderedReorder`, so existing ranked reorder is unchanged. Section
headers stay OUT of the reorderable **data** — a header _row_ inside the list desyncs the
library's per-cell layout (it can render below its rows). "Ranked" is plain markup above the
list; "Ideas" is decoration on the first unranked **cell** (a real row, not a data row). Web
(`ItemList.web.tsx`, dnd-kit) keeps its own separate-sections + drop-zone implementation and
never calls `onMoveItemRelative`.

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

**The same patch also moves the hide-view hand-off from `viewDidLoad` to `viewDidAppear`.**
With `iosHideView: true` upstream starts in `viewDidLoad`, so `completeRequest` can land while
iOS is still presenting the extension's sheet; the host drops the dismiss and a clear sheet
stays over the app swallowing every tap until it is swiped away (upstream #231 / #217, open and
unfixed through v9). It hit HighScore's share-setup walkthrough ("Done and X don't work"), and
the source app of any share is exposed the same way. Simulator repro, practice shares
stuck before → after the patch: iOS 26 3 of 41 → 0 of 26, iOS 27 10 of 35 → 0 of 30. The Limrun builder reuses a generated
`ios/` directory, so a patch edit only reaches a simulator build with
`lim xcode build … --expo-force-prebuild` (check the log for `Compiling ShareViewController.swift`).

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

## Don't override `ios.infoPlist.CFBundleURLTypes` without re-listing the scheme

Once declared, Expo stops auto-adding the `scheme:` value. Mirror the root `scheme`
(`"workshop"`) into `CFBundleURLSchemes` manually. `npx expo config --type public`
catches it before EAS does.

## Share extension payloads can include both URL and text

Preserve both when handling `useShareIntent()` in `_layout.tsx`; it forwards both as `?url=` /
`?text=` to `/share`, which redirects to `/share/pick-list` (normal item adds) with the same
params. (Score shares belong to HighScore's own share extension.)

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
leaves a phantom `/share` screen beneath `(tabs)` that a home swipe-back can surface). Any new
cross-navigator `replace` into `(lists)` needs `withAnchor` too (e.g. the invite-accept /
public-landing → list paths share this shape).

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
See `packages/ui/src/ThemeProvider.tsx`.

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
Reference: HighScore's paste/teach flow (`apps/highscore/src/games/screens/GamesHome.tsx`).

## Sheet keyboard handling is centralized in `packages/ui/src/Sheet.tsx`

Keep the backdrop close target as a sibling **behind** the sheet content, not a parent
wrapping it; iOS can otherwise treat taps inside a keyboard-moved form as backdrop taps
and dismiss the modal. Don't wrap a whole sheet form in `KeyboardStickyView`; reserve
sticky keyboard footers for full-screen forms that separate scroll content from the
footer.

## Don't add `react-native-worklets/plugin` manually

`babel-preset-expo` auto-wires it. Adding it to `babel.config.js` runs it twice.

## For animated text, use `AnimatedText` from `@workshop/ui`

Raw `<Animated.Text>` strips our `variant`/`tone` props.

## Override `lineHeight` whenever you bump `fontSize` on the shared `<Text>`

`Text` defaults to `variant="body"`, which carries a fixed `lineHeight: 22` (each variant
sets its own line-height for vertical rhythm — see `variantStyle` in
`packages/ui/src/Text.tsx`).
A local style that overrides only `fontSize` (e.g. a 34px wordmark) keeps the 22px line
box, and **iOS clips the glyphs to that line box** (web/RN-Web doesn't — the overflow just
renders, so this is invisible until you look on device). Always set a matching `lineHeight`
(~1.2× the font size) alongside any custom `fontSize`. The sign-in wordmark
(`app/sign-in.tsx`) regressed this way. **This includes emoji/symbol glyphs** — any
`fontSize` > the inherited `lineHeight` clips, so a `🔗`/`📀` cover placeholder or list emoji
at fontSize 24/28/40 in a `body` (22) line box renders cut off and shifted low on iOS
(`ItemRow` `coverPlaceholderGlyph`, the item-detail hero, list settings/empty-state emoji all
hit this). Pin a `lineHeight` on **every** emoji/glyph `<Text>` style (e.g. `24/28`, `40/48`).

## Wrap top-level screens in `Screen` from `@workshop/ui`

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

No SSE/WS yet. Hook at `@workshop/api-client/useLivePollingInterval`; pass into queries via
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
OPTIONS preflights with `403`. `packages/api-client/src/config.ts` works around this by
deriving the API
URL from `window.location` on web (localhost stays; `ns-<port>-<id>` rewrites to the
matching `ns-8787-<id>` host). Keep that derivation in place or browsers can't sign in.
