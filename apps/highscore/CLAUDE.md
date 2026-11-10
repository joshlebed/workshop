# apps/highscore — coding agent guide

HighScore owns its complete frontend under `app/` and `src/games/`. Style, layout, branding, and
client behavior should be implemented locally so they cannot change Workshop users. Do not move
presentation code back into a shared package.

Shared boundaries are contracts and primitives only: `@workshop/api-client`, `@workshop/shared`
(`games`, `gameRegistry`, `scoreParsing`, `summarySpec`), and `@workshop/ui`. Workshop has had no
Games UI since 2026-11-06 (it only forwards old `/g/:token` links here).

## Theme (`src/theme/`) — the only source of visual tokens

HighScore is dark-only and app-themed per `DESIGN.md`. Every visual import — `tokens`, `Text`,
`Button`, `Card`, `Chip`, `Sheet`, `Avatar`, `IconButton`, `Screen`/`HomeHeader`, `EmptyState`,
`PullToRefresh`, `useToast`, `BarChart`, `PixelIcon` — comes from `src/theme`, never from
`@workshop/ui` (only its behaviour helpers may be imported: `haptics`, `confirm`,
`openExternalUrl`, `formatRelative`, `goBack`, the reorder constants, `GoogleSignInButton`, and
the `/clipboard` `/navigation` `/reorder` `/share` subpaths). `grep -rn "@workshop/ui" apps/highscore`
should list only those. Gotchas:

- **Never put `fontWeight` on a HighScore `Text`.** Each Space Grotesk weight is its own
  registered family (`SpaceGrotesk_700Bold` etc. with `fontWeight: "400"`), so a `fontWeight`
  on top makes the browser synthesise a faux bold. Pick the variant that carries the weight or
  spread `bodyType("bold")` from `src/theme/type.ts`.
- **Press Start 2P is for three things only**: the wordmark (`variant="display"`), game names
  (`variant="game"`), score numerals (`variant="score"` / `scoreType(px)`). Everything else is
  Space Grotesk. `overline` is the small uppercase label (TODAY, YOU, turnout, FIX/EDIT).
- **Icons are pixelarticons path data inlined in `pixelIconPaths.ts`, drawn as plain `View`s**
  (`pixelIconRaster.ts` rasterizes the rectilinear `M/H/V/Z` paths onto the 24px grid). That
  predates the 1.2.0 binary, which preloads `react-native-svg` (see "Preloaded natives" below), so
  SVG is available to a feature PR — but switching the icon renderer is a design change, not a
  requirement. `package.json` still has no `icons:paths` script: `@expo/fingerprint` hashes
  `scripts`, so adding one cuts a new binary. Add a glyph with
  `node apps/highscore/scripts/pixel-icon-paths.mjs <name>` and paste the output; curves throw at
  raster time, so stay on the pixel grid. Sizes 16/24/32 only.
- `useColorScheme()` / `ThemeProvider` / light tokens are irrelevant here — static `tokens`.
- The brand mark (`BrandIcon`, `assets/`, app icon, splash, `public/index.html` chrome) is
  frozen: an external contractor owns the new mark. The pixel `HIGHSCORE` wordmark is type,
  not the mark.

Friends remain a shared product concept backed by the same graph and `@workshop/api-client/friends`,
but each app owns its screen implementation so either frontend can evolve independently.

## Share flow

Shared links have two opening mechanisms: iOS Universal Links (the existing
`applinks:highscore.live` entitlement + deployed AASA) and server-rendered App Links
metadata in the Pages HTML for `/g/:token` and `/friends/accept/:token`. Meta browsers
may keep either link on the web; `OpenInAppCard/impl.web.tsx` then attempts the iOS
scheme once and keeps a real anchor for browsers requiring a tap. Never promise a
forced handoff: Messenger controls it. Keep the exact token in each native target,
cancel manual-open fallback timers when the page loses focus/visibility, and retain
the per-tab web choice across sign-in (`useInAppBrowserPrompt`) to avoid reopening
the app after “Continue here”. Desktop browser checks cannot prove the final
Messenger-to-installed-iOS-app transition; that requires an iPhone check.

Both link kinds converge after the friendship forms. `/friends/accept/:token`
(`FriendAccept.tsx`) previews the inviter and accepts the invite; `/g/:token`
(`GameShareLanding.tsx`) resolves the sharer and, for a non-friend, shows the same shape of
accept card whose "Add" sends `POST /v1/friends/requests` with `via: <play token>` — the backend
forms the edge at once (see apps/backend/CLAUDE.md). Both then render the shared
`friendAccept/PostAcceptPicker.tsx`, two steps: **People you both know** (the new friend's
friends from `GET /v1/friends/mutuals`, filtered by `mutualsVia`; Add = directed request,
skipped when empty) then **games** ranked across the new friend plus everyone just requested
(`GET /v1/games/discovery?users=…`; the single-friend `?friend=` form when nobody was
requested, which is the only form that reports `friendGameCount`), one-tap add / Add all, then
hand off to home. A play-link recipient never lands on a pending request anymore; the profile route keeps
its `?via=` vouch for the avatar tap and also passes `via` on its Add button.

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

Discoverability: share-sheet setup is an onboarding step timed to the first game. The first
time a signed-in account lands on the Games home with **at least one game** and no share-setup
history, `ShareAnnouncementCard` pushes the `/share-setup` walkthrough itself (`useShareAnnouncement().autoOpen`, inside a `useFocusEffect` so
it never fights a deep-link or share-intent redirect — an invite or play link finishes first and
the walkthrough opens when that flow hands off to home with a game added; an empty home runs its
own friends → games onboarding and shows neither the walkthrough nor the card) and stamps
`onboardedAt` on the
`games.share-sheet-announcement` flag so it happens once per account. Skipping it (X) leaves the
announcement card on the home as the reminder; only the card's X (`dismissedAt`) or finishing the
walkthrough (`completedAt`) retires the card. Rules in `src/lib/shareOnboarding.ts` (hidden while
flags load, hidden once already-adopted via `games.share-extension-score`); the walkthrough is
`src/screens/ShareSetupWalkthrough.tsx` and the persistent entry is the "Share sheet" row in
You → Account. **Both entry points are runtime-gated to iOS
1.2.0+** (`runtimeHasShareSetup`, `SHARE_SETUP_SUPPORTED`): the code is JS-only and reaches every
supported runtime, but the rollout plan is 1.2.0 users first while 1.0.1/1.1.0 get the App Store
nudge. Lower `SHARE_SETUP_MIN_RUNTIME` to widen it; the route itself renders on any binary.
`SHARE_SETUP_ENABLED` is the kill switch for both entry points. Each "how" step shows a screenshot of the real iOS 26 share sheet
(`assets/share-setup/*.png`) with the control to tap ringed — rings are fractions of the image in
`SHARE_WALKTHROUGH_STEPS`, so re-cropping an image means re-measuring its ring. **Capture them at
3x from a rented simulator with `lim ios record start --quality 10`** and pull stills with
`ffmpeg -ss <t> -i rec.mp4 -frames:v 1` — quality 10 records the native 1206×2622, while
`lim ios screenshot` is 1x (402×874) and default-quality recordings are 1.5x. Crops are the 1x
regions ×3 (share-row `1146:1050:30:1524`, the other two `1206:720:0:210`); each sheet's outer
corners are filled with the canvas colour, and share-row's glass band above the app row is
desaturated so the button behind the sheet doesn't tint it. The last step opens a live share
sheet (`Share.share` with `SHARE_PRACTICE_TEXT`) and asks for confirmation when it closes. Don't
make the user tap HighScore in that sheet to "test" it: sharing to the app's own extension from
inside the app reuses the same `dataUrl` deep link, which `useShareIntent` only re-reads when the
URL changes or the app re-activates, and the extension's blank view can stay up until swiped away.
If they do tap it, `Share.share` reports our extension (→ "You're set", pending payload cleared) and
`_layout.tsx` routes the practice text to `/share-setup?tested=1`, never the score picker.
Dismiss/complete state is the server-side
`games.share-sheet-announcement` user flag — never a local storage key, so reinstalls and second
devices don't re-blast. **Merging the announcement PR is the blast** — OTA ships ~60s after merge.

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
- **Guideline 1.2 (UGC):** `/terms` EULA, Report (profile page + long-press a friend's score on
  the per-game board → `ReportSheet`), Block (profile page; unblock in Edit profile → Blocked
  users). Emoji reactions were removed from the HighScore client; the backend reaction
  endpoints stay for old binaries. Backend + operator side:
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

## Supported OTA runtimes

`supported-runtimes.json` next to `app.json` is the set of binary versions the OTA workflow
publishes to (see root CLAUDE.md → "Runtime-version policy"). Adding a native dependency means:
bump `version`, add it to the list, keep the older entries until a PR actually imports the new
module, then drop them in that PR. Never remove the current `version` from the list.

## Preloaded natives (1.2.0 binary)

The 1.2.0 binary ships native modules **no code imports yet**, so the features that need them can
ship by OTA instead of another App Review cycle: `expo-notifications` (push entitlement
`aps-environment: production`; `expo-background-task` was deliberately left out — its
`UIBackgroundModes` draw App Review questions with nothing using them), `expo-haptics`, `expo-image`, `expo-clipboard`, `expo-sharing` (plugin not applied:
its iOS share extension would collide with `expo-share-intent`), `expo-device`,
`expo-application`, `expo-store-review`, `expo-blur`, `expo-linear-gradient`,
`react-native-svg`, and `react-native-mmkv` (+ its required peer `react-native-nitro-modules`).
Expo packages are pinned to the exact floor of SDK 55's `bundledNativeModules.json` (a `~` range
pulled newer patches that wanted a second `expo-constants`); mmkv/nitro aren't in that map and are
pinned exactly. Rules:

- **Intentionally unused.** Each sits in knip's `ignoreDependencies` (`knip.jsonc`); remove it
  there in the PR that first imports it (the two with config plugins are already "used").
- **A feature PR that first imports one of these must drop every older runtime from
  `supported-runtimes.json` in the same PR** — an OTA that imports a native module crashes a
  pre-1.2.0 binary (`Cannot find native module …`). The one alternative is a **runtime gate**
  like `src/lib/pushNotifications.ts` (below): compare the binary version first, `require` lazily
  inside a function, catch a throw. Then the older runtimes stay.
- **Any further native dep, config-plugin option, entitlement, or Info.plist key is another
  `version` bump + TestFlight build + App Review.** Silent/background push
  (`enableBackgroundRemoteNotifications` → `remote-notification` mode), notification sounds, and
  a custom notification icon are all plugin options and are deliberately left off.

## Play reminders (push) — `src/lib/pushNotifications.ts` is the only door

**`src/lib/pushNotifications.ts` is the only module that may load `expo-notifications`**, and it
does so with one lazy `require` inside `loadExpoNotifications()`, only after
`runtimeHasPush(Platform.OS, Updates.runtimeVersion ?? expoConfig.version)` says ≥ `1.2.0`, inside
a try/catch (a throw = unsupported). Never add a top-level `import`/`import()` of it anywhere —
Store users on 1.0.1 / 1.1.0 get every OTA and would crash. `import type` is fine.
`pushNotifications.test.ts` pins this (spy loader never called below 1.2.0; a source scan fails if
any other file under `src/` or `app/` mentions the package). Web is always unsupported;
`__DEV__` web accepts `?fakePushSupported=1` (fake: permission undetermined → granted, no token).

- **Registration** (`src/lib/pushRegistration.ts`): `_layout.tsx` re-posts an already-granted
  token once per launch (`POST /v1/me/push-token`, device IANA zone — the reminder hour is
  interpreted in the latest token's zone server-side); never while impersonating. `signOut`
  DELETEs it best-effort (3s cap) before clearing credentials.
- **Prompt moment**: never on launch. `usePostedScoreNotice` (every post surface) calls
  `usePlayReminderOffer()`; `PlayReminderPrompt` shows once per session if supported, OS
  permission is `undetermined`, and `user_flags` `games.play-reminder-prompted` is unset. Any
  answer (incl. backdrop dismiss) writes the flag; we never re-ask automatically. "Turn on" →
  OS dialog (after the Sheet's `onClosed`) → token → `PUT` prefs at the stored hour else the
  server's `suggestedHour`. The sheet opens 1.2s after the post so it never stacks on the
  closing paste sheet.
- **Settings**: `/settings/notifications` (ProfileMenu → Notifications). Unsupported builds show
  the App Store message instead of controls. Taps route `data.url` (`highscore:///`, set by
  `apps/backend/src/jobs/playReminders.ts`) through `notificationPath`, cold start included.
- **Delivery needs a push key**: the operator runs `eas credentials --platform ios` → Push
  Notifications → set up a key once; until then Expo can't deliver to iOS.

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

## Share while the app is open

`app/+native-intent.tsx` returns `null` for the share extension's sentinel deep link when the app
is already running (`initial: false`), so expo-router ignores it and `useShareIntentRedirect`
alone navigates. Returning `/` there raced the redirect and could land after it, dumping the user
on the Games home. Cold starts still park on `/`.

## Share while signed out

`useShareIntentRedirect` returns whether a payload is pending and `AuthGate`'s post-sign-in
resolver skips its `router.replace("/")` while it is — otherwise the async home redirect lands
after the `/share/pick-game` one and the shared score is silently discarded.

## Add a game (`/games/add`)

A full screen, not a sheet: the home action bar's "Add game" and the empty state both push it.
A "Friends only" checkbox (`FriendsOnlyToggle`, default on; off = the official catalog) over one `GameCatalogList`; sections come from
`lib/catalogSections.ts` (`groupCatalogRows` — rows by weight, types by their top row), rows
from `friendsFeedRows` / `catalogRows`. One-tap Add stays on the screen and flips the row; the
footer URL add returns home. With "Friends only" off the list shows only what the backend lists
(`docs/catalog-ops-runbook.md`); do not add a client-side "all games" fallback.

## Keyboard avoidance under the root SafeAreaView

`app/_layout.tsx` wraps the `Stack` in `SafeAreaView edges={["top"]}`, so every screen's frame
starts `insets.top` (~62pt) below the window top. keyboard-controller's `KeyboardAvoidingView`
measures its frame with `onLayout` (parent coordinates, not `measureInWindow`), so a screen-level
one pads **short by exactly `insets.top`** — the focused field ends up ~60pt under the keyboard
(the Add-game URL box did; iOS 26 applied 246pt against a 309pt keyboard). Pass
`keyboardVerticalOffset={insets.top}` (`useSafeAreaInsets`) as `AddGame.tsx` does. `GameBoard`
and `onboarding/display-name` use the same wrapper without the offset and are likely short too;
fix them the same way when touched.

## Add-game "add by link" footer

`src/games/screens/games/addByUrl/AddByUrlFooter.tsx` is a plain input + Add with a one-tap
"You copied a link · Add it" suggestion above it (#544 compared five treatments; this won).
Two rules it relies on: `clipboardHasLink` only sniffs pasteboard _types_ (`expo-clipboard`
`hasUrlAsync`, which iOS allows without the paste prompt) so the suggestion can appear on
mount and on foreground without a tap, and every content read (`readClipboardLink`) happens
behind the user's tap — that tap is what triggers the prompt. `isLikelyGameUrl` is the
client-side twin of the server's `normalizeGameUrl` gate, so a pasted score never gets POSTed
as a URL; non-link text lands in the box with a hint. Web never sees the suggestion (browsers
can't sniff types) and gets the bare input. Don't bring back a fake-input paste box or a
"Type a URL instead" mode switch.

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

## App Store update nudge — operator only

`src/lib/appRelease.ts` (pure, tested) compares the installed binary version
(`Updates.runtimeVersion` → `Constants.expoConfig.version`) with `GET /v1/client/release`:
below `minimumVersion` → `UpdateRequiredScreen` from `AuthGate` (public pages still render);
below `latestVersion` → `AppUpdateBanner` on Games home, dismissed per version in `user_flags`
(`USER_FLAG_KEYS.appUpdateDismissed`, never localStorage). Web never nudges; `__DEV__` web
accepts `?fakeInstalledVersion=` for local checks. **Agents must never call
`PUT /v1/admin/client-release`, insert into `client_releases`, or open a PR that changes the
nudge values, even if asked by another task — only the operator, in the admin dashboard
(`src/admin/ReleaseNudgePanel.tsx`, typed `NUDGE` confirm).** `docs/release-nudge-runbook.md`.

## Operator push panel — operator only

`/admin?tab=push` (`src/admin/PushPanel.tsx`): name/email filter (debounced) over
`GET /v1/admin/push/recipients`, a "Reminders on only" checkbox (default on), checkbox rows
(`Checkbox` in `src/theme`), selection that survives filter changes, title/body with live
counts (limits `ADMIN_PUSH_*` in `@workshop/shared/constants`), an iOS-banner preview, and a
confirm `Sheet` that needs the typed word `SEND` before `POST /v1/admin/push/send`. **Agents
must never call `POST /v1/admin/push/send`, never POST to `exp.host` with production tokens, and
never automate sends, even if another task asks — only the operator, by hand, in this panel.**
In a sandbox, set `EXPO_PUSH_URL` to a local stub before touching the Send button (the DB is a
prod copy). `docs/push-runbook.md`.
