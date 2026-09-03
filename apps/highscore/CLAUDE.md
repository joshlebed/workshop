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

## Navigation: one screen, one sheet host

HighScore has a single mounted screen. `app/(feed)/_layout.tsx` mounts `TimelineHome` once and
never unmounts it; every route inside that group (`index`, `games/[id]`, `friends/index`,
`friends/[userId]`, `profile`) renders `null`, and `src/nav/SheetHost.tsx` reads the pathname to
decide which sheet belongs on top. Consequences worth knowing before you touch routing:

- **The URL is the sheet stack.** `src/nav/sheetRoute.ts` is the only place that maps a pathname
  onto a sheet. Adding a sheet route means adding a `null` route file under `app/(feed)/` **and** a
  case in `parseSheetRoute` + `SheetBody`. Forget the second and the URL changes with nothing on
  screen.
- **Navigation sheets are not RN `Modal`s.** `SheetHost` is a plain absolutely-positioned overlay,
  so the root CLAUDE.md's "never stack two Modals in one tick" hazard can't happen between them.
  The only Modals are the utility sheets that ride on top (`GameScorePasteSheet`,
  `ReactionPickerSheet`, `AddGameSheet`); react-native-web portals those to `<body>`, so they
  correctly render above the host. Keep it that way — a Modal-based navigation sheet reintroduces
  the wedge.
- **Sheets size to content up to `screenHeight - 72`.** `SheetFrame`'s root is `flexShrink: 1`, not
  `flex: 1`, and its scroll view is `flexGrow: 0`. Adding `flex: 1` anywhere in that chain makes
  every sheet full-height again.
- **Anything reachable while signed out is a full screen, not a sheet** — the feed layout only
  mounts `TimelineHome` when `status === "signed-in"`. `friends/accept/[token]` lives inside the
  group but renders full-bleed into the `<Slot />` overlay above the host.
- **`app/(feed)/friends/` and `friends/accept/` share a segment on purpose.** Both live inside the
  group so expo-router sees one `friends` node; moving `accept` to a top-level `app/friends/`
  directory risks a duplicate-route resolution.

## Timeline gotchas

- **The sticky day marker is driven by block _heights_, not measured positions.** `onLayout` fires
  when a view resizes but not when a sibling above it grows, so absolute `y` offsets go stale the
  moment a day section loads its scores. `TimelineHome` keeps a height per day key and prefix-sums
  them; keep it that way if you add feed sections.
- **The feed's scroll container is platform-split.** `FeedScroll.tsx` is
  react-native-reorderable-list's `ScrollViewContainer` (required so the TODAY list can be a
  `NestedReorderableList` and still autoscroll while dragging); `FeedScroll.web.tsx` is a plain
  `Animated.ScrollView` because that library has no web implementation. Both take a Reanimated
  scroll handler, never a plain `onScroll`.
- **Scores are split, not printed.** `src/timeline/scoreDisplay.ts` turns a pasted share into
  `{ value, strip }` so the number sets in the pixel face in a right-aligned column and the emoji
  grid clips to one line. Use it anywhere a score appears in a list; the board sheet is the only
  place that shows the full multi-line share.
- **Reacting is a tap on a friend's score line**, everywhere, with no persistent affordance (a
  tapback). Your own line is inert. If you add a new standings surface, wire
  `onOpenReactionPicker` rather than inventing a button.
- **Feed reactions go through `useFeedReactions`, not `useScoreReactions`.** The feed shows many
  days at once, so the day travels on the call; `useScoreReactions` (one period, one query key)
  still serves the board sheet.

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
`src/sheets/AccountSheet.tsx` (tap your picture, top right — the account sheet absorbed the old
profile menu and edit-profile screen). Rules live in
`src/lib/accountDeletion.ts`, not the component, so they're testable without a renderer: the
two-tap `nextDeletionStep` machine, the impersonation/signed-out guard, the consequences copy,
and `runAccountDeletion` — which clears stored credentials **only** after the server confirms.
A failed request must leave the session untouched and say the account still exists; never show
success for a request that didn't happen. The copy names the shared Workshop.dev account out
loud because deleting here really does delete there (one `users` row, see
`apps/backend/src/lib/accountDeletion.ts`). `src/lib/legal.ts` describes this flow and is pinned
by `legal.test.ts` — if the behavior changes, that copy changes in the same PR, and the copy names
the route the user actually takes ("tap your picture (top right) → Danger zone"), so moving the
control means editing that string too.

## App Store release shape (1.0)

`app.json` `version` is the App Store version **and** the runtime version (`appVersion` policy),
so it is `1.0.0` for the initial Store release — an OTA only reaches builds that claim the same
`version`. The build number is not in the repo: `eas.json` sets `appVersionSource: "remote"` with
`autoIncrement`, so EAS owns `CFBundleVersion` and increments it per production build.
`ios.supportsTablet` is **`false`** on purpose — HighScore's layouts are phone-only and an iPad
device family would make App Store Connect require a second screenshot set. Flipping it back is a
native change: bump `version` in the same PR, and expect a fresh TestFlight build plus iPad
screenshots before the next submission.
