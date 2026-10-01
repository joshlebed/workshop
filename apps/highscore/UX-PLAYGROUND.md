# HighScore UX playground

**Draft branch. Do not merge.** This is review scaffolding: all five competing UX
explorations of `apps/highscore` running side by side in one app, with an in-app toggle so a
human can flip between them live without rebuilding or checking out another branch.

It deliberately favours duplication and isolation over cleverness. Each variant carries a full
private copy of HighScore's `src/` tree, so the five clashing `Text` / `Button` / `Sheet` /
`tokens` primitives can coexist untouched and nothing leaks between them. Nothing here is a
proposal for how to ship a variant.

## Running it

```bash
pnpm dev:backend                                     # :8787
DEV_AUTH_ENABLED=1 EXPO_PUBLIC_DEV_AUTH=1 pnpm dev:highscore   # :8082
```

Three ways to change variant:

| How                                    | Where                                                                                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The floating **UX** chip, bottom-right | Every screen, including sign-in and the legal pages. Tap it for the picker; drag it if it covers something.                                                          |
| `?ux=ux1` … `?ux=ux5` on any URL       | Web. Honoured once per page load, so a later chip/keyboard switch wins — paste `http://localhost:8082/games/<id>?ux=ux4` to land a reviewer directly in one variant. |
| `Alt+1` … `Alt+5`                      | Web. Alt-modified so it can't fire while you're typing a score into a paste sheet.                                                                                   |

The pick is persisted under `highscore.uxVariant` via `@workshop/api-client/storage`
(localStorage on web, SecureStore on native). **Reset app state** in the picker clears it and
returns to `ux1`, the default.

Changing variant remounts the whole router subtree (`key={variant}` on `VariantProviders` in
`app/_layout.tsx`). That is load-bearing: these variants hold a lot of local state — deck
panel, sheet stack, dock registrations — and leaking any of it across a switch would make the
comparison dishonest.

## The five variants

| Key   | Name                   | Original PR                                            | Branch                             | Concept                                                                                                                                               |
| ----- | ---------------------- | ------------------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ux1` | Cartridge Deck         | [#414](https://github.com/joshlebed/workshop/pull/414) | `joshlebed/hs-ux1-cartridge-deck`  | One screen, one deck. Swipe full-bleed game cartridges, scroll a cartridge down for its history, zoom out to the shelf. Nothing pushes a route.       |
| `ux2` | Expand In Place        | [#410](https://github.com/joshlebed/workshop/pull/410) | `joshlebed/hs-ux2-expand-in-place` | Zero route pushes in the main loop. A ledger row expands into its board while the others squeeze into spines; friends slide over from the right edge. |
| `ux3` | Timeline + Sheet Stack | [#411](https://github.com/joshlebed/workshop/pull/411) | `joshlebed/hs-ux3-timeline-sheets` | Time is the primary axis: one feed of days, and every other surface is a sheet that keeps that feed visible behind it.                                |
| `ux4` | Players × Games        | [#413](https://github.com/joshlebed/workshop/pull/413) | `joshlebed/hs-ux4-players-matrix`  | The same day has two projections. GAMES (a game per row) flips in place to PLAYERS (the transpose), under a fixed three-key panel.                    |
| `ux5` | Gesture Dock           | [#412](https://github.com/joshlebed/workshop/pull/412) | `joshlebed/hs-ux5-gesture-dock`    | Everything inside one thumb: full-bleed game bands you swipe, and a persistent bottom dock whose keys morph per screen.                               |

Each variant's own design doc is copied verbatim beside its code at
`src/variants/<key>/UX-EXPLORATION.md`. Read those first — they are the argument; this file is
only the wiring.

## Layout

```
apps/highscore/
  app/                      one flattened route tree, every file a two-line dispatcher
    _layout.tsx             shared providers + AuthGate + the UX chip
    (app)/                  the "surface" routes: /, /games/:id, /friends, /friends/:userId,
                            /profile, /you   ← where ux2's shell and ux3's timeline mount
    sign-in, onboarding/, share/, g/, friends/accept/, support, privacy   ← full screens
  src/
    ux/                     the playground itself (see below)
    variants/ux1…ux5/       a complete private copy of each variant's src/ tree
    api/ hooks/ lib/ games/ components/ screens/   ← main's originals, untouched
```

`src/ux/` is the whole of the new code:

| File            | Owns                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `variants.ts`   | The list of variants, as data: keys, names, blurbs, branches, PR numbers.                         |
| `variant.tsx`   | `UxVariantProvider` / `useUxVariant()` / `setVariant` / `reset`, persistence, `?ux=`, Alt+N.      |
| `routes.tsx`    | The (variant × route) → component table and the `<UxRoute name="…" />` dispatcher.                |
| `shells.tsx`    | Per-variant provider stacks, the root `Stack`, and each variant's group layout.                   |
| `deepLinks.tsx` | ux1's deep-link resolvers, and the `/you` fallbacks.                                              |
| `UxChip.tsx`    | The floating chip and its picker sheet.                                                           |
| `chrome.ts`     | The chip's palette — DESIGN.md's tokens inlined, so the review chrome never flatters one variant. |

### Why each variant has a full copy of `src/`

Every variant modified the same shared files differently (`GameScorePasteSheet`, `PickGame`,
`FriendAccept`, `GameShareLanding`, `ScoreReactions`, `ReactionPickerSheet`,
`useScoreReactions`, `EditProfile`, `LegalScreen`, `Wordmark`, the sign-in and onboarding
screens) on top of five incompatible `theme/` layers. Copying whole trees means every relative
import inside a variant still resolves to that variant's own version, with no rewriting and no
chance of one variant's primitives reaching another.

Three deliberate exceptions, all inside the variant namespaces:

1. **`hooks/useAuth.tsx`** and **`games/runtime.tsx`** are re-export shims pointing at the
   shared `src/` copies. They are React contexts mounted once by the root layout; five
   duplicate modules would mean five contexts and five session bootstraps. They were
   byte-identical on all five branches, so the shim loses nothing.
2. **`components/BrandIcon.tsx`** (ux3/ux4/ux5) had its `require("../../assets/icon-source.png")`
   re-pointed at the real `apps/highscore/assets/` — the only import that escaped `src/`.
3. **Test copies were dropped** where they duplicate a test in the shared tree. The three
   variant-only tests survive: `ux1/deck/monogram.test.ts`, `ux1/games/lib/scoreMarks.test.ts`,
   `ux4/games/lib/matrix.test.ts`.

`src/` itself is still main's HighScore, untouched; the modules the root layout genuinely
shares (`api/`, `hooks/useAuth`, `lib/*`, `games/runtime`, `games/lib/inviteStash`) live there,
and the rest is left in place rather than deleted so the diff against the brief stays readable.

### The route tree, and the fallback mapping

The five branches disagreed about route _shape_: ux1/ux4/ux5 kept `app/(tabs)/`, ux2 used
`app/(shell)/`, ux3 used `app/(feed)/` and deleted `app/profile.tsx`; ux4/ux5 added
`app/you.tsx`. The playground has one tree covering the union, and every route file is

```tsx
import { UxRoute } from "../../src/ux/routes";

export default function Home() {
  return <UxRoute name="home" />;
}
```

Two routes aren't defined by every variant. Neither falls through to a blank screen:

| Route              | ux1                                                | ux2                                   | ux3                   | ux4             | ux5             |
| ------------------ | -------------------------------------------------- | ------------------------------------- | --------------------- | --------------- | --------------- |
| `/`                | Deck `AppShell`                                    | drawn by the shell                    | drawn by the timeline | `GamesHome`     | `GamesHome`     |
| `/games/:id`       | resolves into the deck, replaces itself with `/`   | drawn by the shell (expands in place) | sheet over the feed   | `GameBoard`     | `GameBoard`     |
| `/friends`         | resolves into the PLAYERS panel                    | drawer panel 1                        | sheet                 | `FriendsHome`   | `FriendsHome`   |
| `/friends/:userId` | resolves into the PLAYERS panel                    | drawer panel 2                        | stacked sheet         | `FriendProfile` | `FriendProfile` |
| `/profile`         | `EditProfile` (pushed)                             | `EditProfile` (pushed)                | account **sheet**     | `EditProfile`   | `EditProfile`   |
| **`/you`**         | **→ deck YOU panel** (`setPanel("you")`, then `/`) | **→ `/profile`**                      | **→ `/profile`**      | `You`           | `You`           |

Rationale for the two `/you` fallbacks: ux1's "you" is the third key of its control panel, so
it resolves exactly the way ux1's other deep links do. ux2 raises "you" as a bottom sheet from
its shell and its account _screen_ is `/profile` (its own nav doc lists `/profile` among the
routes that really do push); ux3's account surface **is** the `/profile` sheet. Both therefore
map to `/profile`, which every variant resolves.

### Per-variant layouts

`app/(app)/_layout.tsx` renders whichever navigator the active variant needs
(`src/ux/shells.tsx`):

- **ux1 / ux4 / ux5** — a `Stack`, carrying that variant's own screen animations (ux1's
  deep-link routes don't animate; ux4 cross-fades detail screens so its flight animation isn't
  fought; ux5 cross-fades `/games/:id` so the board can unfold out of its band).
- **ux2** — the persistent `<Shell />` plus a `Slot` whose child routes render `null`, as on its
  own branch. On `/profile` and `/you` the shell steps back (hidden and inert, still mounted so
  the ledger survives the round trip) and the Slot takes the screen.
- **ux3** — `<TimelineHome />` mounted once, `<SheetHost />`, and a `box-none` `Slot`, exactly as
  on its own branch.

The root `_layout.tsx` is the union of the five branches' root layouts. They differed only in
the providers they added (each variant's `ToastProvider`, plus ux1's `DeckNav`, ux4's
`Flight` + `Peek`, ux5's `Dock`) and their screen animations; both moved into `src/ux/shells.tsx`.
Everything else — `configureApiClient`, OTA-on-arrival, Press Start 2P loading, the
gesture/keyboard/safe-area/query/auth/games-runtime providers, the share-intent redirect and
the whole `AuthGate` — was byte-for-byte identical on all five, so one copy serves all five.

## What had to be patched per variant

Only two things, both minimal:

1. **ux3, `src/variants/ux3/nav/SheetHost.tsx`** — real bug, fixed. The close animation's
   completion callback cleared the sheet stack unconditionally, so any fast close→open flip
   (here: `/you` redirecting to `/profile` while the host was still closing) wiped the sheet
   that had just opened and wedged the host at `return null` until a full reload. The fix
   re-checks that the host is still closed before clearing. Marked `PLAYGROUND PATCH` in the
   source.
2. **ux3 / ux4 / ux5, `components/BrandIcon.tsx`** — the asset `require` path, as above.

Nothing else about any variant's design, layout, copy or motion was changed.

## Known playground-only compromises

- `src/lib/publicRoutes.test.ts` now asserts the public `Stack.Screen`s against
  `src/ux/shells.tsx` rather than `app/_layout.tsx`, because that is where the root navigator
  moved. The guard's intent is unchanged.
- The same file still pins `src/components/ProfileMenu.tsx`, which is main's copy; all five
  variants deleted their own. It passes, but it is testing a component the playground never
  renders.
- ux2's `/profile` arrives as a `Slot` swap rather than a `slide_from_right` push, because its
  group layout has to be a `Slot` for the shell to persist.
- All five variants are bundled at once (the dispatchers import every one statically), so the
  JS bundle is roughly five HighScores. That is the price of live switching.
- `app.json` `version` is **not** bumped. The branch adds native deps
  (`react-native-svg`, `expo-font`, `@expo-google-fonts/press-start-2p`) and would need a
  runtime-version bump before any iOS build — but it is never meant to ship, so the bump is
  deliberately omitted rather than wrongly claimed.
