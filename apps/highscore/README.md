# HighScore (`apps/highscore`)

Expo app for **HighScore** (`highscore.live`) — the daily-games half of the split described
in [`docs/highscore-migration-plan.md`](../../docs/highscore-migration-plan.md). Builds web
and iOS from one component tree via `react-native-web`, exactly like `apps/workshop`.

This app owns the Games home, standings, catalog, friends, play-link resolver, and native
score-share flow. Its live UI is app-owned under `src/shell`, `src/theme` and `src/games`;
Workshop's pre-cutover UI is a separate frozen snapshot, so frontend iteration here cannot
change Workshop users.

|                              |                                                                 |
| ---------------------------- | --------------------------------------------------------------- |
| Bundle id                    | `live.highscore.app`                                            |
| Scheme                       | `highscore`                                                     |
| Apple Services ID (web auth) | `live.highscore.web`                                            |
| EAS project                  | `@joshlebed/highscore` (`92a568f5-b0f0-4af1-bb9d-98181025691c`) |
| Web domain                   | `highscore.live` (Cloudflare Pages project `highscore`)         |

It shares a backend, a Postgres, and a user identity with Workshop. Apple's `sub` is stable
per developer team, so signing in here with the Apple ID you use on Workshop resolves to the
same account row — see the multi-audience token verification in `apps/backend/src/lib/config.ts`.

## Running it locally

The app needs the backend on `:8787`. Three options:

```bash
# 1. Everything at once — backend + Workshop web (:8081) + HighScore web (:8082)
HIGHSCORE=1 pnpm dev

# 2. Just this app, against an already-running backend
pnpm dev:highscore            # http://localhost:8082

# 3. Native (Expo Go / dev client) — separate terminal, interactive QR UI
pnpm dev:highscore:mobile
```

`pnpm dev` on its own is unchanged (backend + Workshop only), so the common Workshop loop
doesn't pay for a third Metro server.

To sign in without Apple/Google, enable the gated dev identity on both sides:

```bash
DEV_AUTH_ENABLED=1 EXPO_PUBLIC_DEV_AUTH=1 HIGHSCORE=1 pnpm dev
```

The Niteshift sandbox sets both by default.

## Layout

```
app/                     expo-router routes
  _layout.tsx            providers + auth gate
  (shell)/               the one surface — see "The shell" below
    _layout.tsx          persistent layout that renders <Shell />
    index.tsx            /                    → null
    games/[id].tsx       /games/:id           → null
    friends/index.tsx    /friends             → null
    friends/[userId].tsx /friends/:userId     → null
  friends/accept/        invite acceptance (full page, works signed out)
  g/[token].tsx          in-app play-link resolver
  share/                 native score-share picker
  profile.tsx            edit profile (form + account deletion)
  sign-in.tsx            Apple / Google / dev sign-in
  onboarding/            display-name capture
src/hooks/useAuth.tsx    auth context over @workshop/api-client
src/theme/               app-owned design tokens + primitives (see DESIGN.md)
src/shell/               the ledger, the expanding board, the friends drawer
src/components/          app-local components (wordmark, brand icon, Google button)
src/games/               app-owned games hooks, API adapters and shared sheets
public/index.html        web HTML shell — OG tags, theme-color, canvas lock
functions/               Pages API proxy, AASA, and OG metadata/PNG routes
```

### The shell

`/`, `/games/:id`, `/friends` and `/friends/:userId` are four real routes that all resolve to one
mounted `<Shell />`. A layout in expo-router is not remounted when you move between its child
routes, so the `(shell)` layout persists while its children (which render `null`) swap underneath.
The shell reads `usePathname()` and animates into the matching state: a game expanded in place, or
the friends drawer slid over. Deep links, refresh, browser back and the iOS system back all work
because the URLs are real; nothing in the daily loop is a screen you travel to.

Visual tokens and primitives are app-owned in `src/theme/` (per `DESIGN.md`, nothing visual
may come from `@workshop/ui`). What still comes from packages is behaviour and contracts:
`@workshop/ui` for `confirm`, `haptics`, `formatRelative`, `openExternalUrl`, clipboard and
share helpers; `@workshop/api-client` for the API, friends boundary, session, storage and
OAuth hooks; `@workshop/shared` for types, the game registry, score parsing and summary specs.
Presentation and games-specific client adapters stay here even when Workshop's frozen snapshot
has a copy; only contract-level code belongs in a package.

## Brand assets

The owner artwork lives in `assets/icon-source.png`: a square PNG with transparency that is
used as the foreground layer everywhere. Replace that file, then regenerate every derived
asset with one command:

```bash
pnpm --filter highscore-app run icon:build
```

`scripts/build-icon.mjs` has no system dependencies: it validates and decodes the source, copies
it into the generated `assets/HighScore.icon/` Apple Icon Composer bundle at 1.6× scale, and
centers it at 80% scale over the dark app canvas for the uncropped opaque 1024×1024
`assets/icon.png`. It also produces the transparent adaptive/splash art and web favicon.
The exact transparent source is copied to `public/icon-source.png` for OG cards.

The `.icon` manifest schema is copied from the known-good
`apps/workshop/assets/Workshop.dev.icon/icon.json` Icon Composer export. It is plain JSON plus
`Assets/icon-source.png`, so no Mac or GUI is required to regenerate it. Xcode validates this
undocumented schema on the first EAS/TestFlight build; if it ever rejects the bundle, change
`ios.icon` in `app.json` to `./assets/icon.png` as the one-line fallback. The fallback PNG is
opaque and has no baked rounded corners because Apple applies the device mask.

## API URL derivation

Handled by `@workshop/api-client/config` — the same module Workshop uses. On web it derives
the base URL from `window.location`: `localhost` → `http://localhost:8787`, a Niteshift
preview host, a `*.pages.dev` host, or `highscore.live` → same-origin `/api`. `metro.config.js` +
`dev-api-proxy.js` forward that `/api` prefix to the backend so the web bundle never has to
cross the Niteshift preview proxy's per-port auth wall.

In Cloudflare, the HighScore Pages project uses `root_dir=apps/highscore` and
`destination_dir=dist`. Pages discovers `functions/` relative to that project root. Workshop
keeps `root_dir=""` and continues to own the repo-root `functions/` directory.

## Shipping

Cloudflare Pages deploys web from the Git-integrated `highscore` project. HighScore mobile
deploys independently through `deploy-mobile-highscore.yml` (OTA) and
`testflight-highscore.yml` (fingerprint-triggered native builds). The Metro-bundle and
runtime-version guards cover both apps. For a manual local bundle or EAS build:

```bash
cd apps/highscore
pnpm exec expo export --platform ios --output-dir dist-ci   # bundle smoke test
pnpm eas:build:ios                                          # manual EAS build
```

`eas.json` has no `submit.production` block yet — the App Store Connect app id gets filled
in when PR-8 wires auto-submit.
