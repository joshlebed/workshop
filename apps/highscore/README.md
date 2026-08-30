# HighScore (`apps/highscore`)

Expo app for **HighScore** (`highscore.live`) — the daily-games half of the split described
in [`docs/highscore-migration-plan.md`](../../docs/highscore-migration-plan.md). Builds web
and iOS from one component tree via `react-native-web`, exactly like `apps/workshop`.

This app owns the Games home, standings, catalog, friends, play-link resolver, and native
score-share flow. Its live UI is app-owned under `src/games`; Workshop's pre-cutover UI is a
separate frozen snapshot, so frontend iteration here cannot change Workshop users.

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

# 3. Native development client — separate terminal, interactive QR UI
pnpm dev:highscore:mobile
```

`pnpm dev` on its own is unchanged (backend + Workshop only), so the common Workshop loop
doesn't pay for a third Metro server.

To sign in without Apple/Google, enable the gated dev identity on both sides:

```bash
DEV_AUTH_ENABLED=1 EXPO_PUBLIC_DEV_AUTH=1 HIGHSCORE=1 pnpm dev
```

The Niteshift sandbox sets both by default.

### App Store screenshot studio

SDK 55 is newer than the Expo Go binary currently available from Apple's App Store, and
HighScore also uses native modules that Expo Go does not bundle. Use the side-by-side
`HighScore Studio` development client for native screenshot work instead. It has its own
bundle id (`live.highscore.app.studio`) and App Group, so installing it does not replace the
production/TestFlight app.

Register the physical iPhone once, then build the native shell:

```bash
cd apps/highscore
pnpm exec eas device:create
pnpm exec eas build --platform ios --profile studio
```

Start Metro with the isolated screenshot backend URL. The dev identity is fixed to the
privacy-safe Josh fixture; changing `EXPO_PUBLIC_API_URL` only needs a Metro restart, never a
new native build.

```bash
HIGHSCORE_STUDIO=1 \
EXPO_PUBLIC_API_URL=https://<temporary-fake-backend> \
EXPO_PUBLIC_DEV_AUTH=1 \
EXPO_PUBLIC_DEV_AUTH_EMAIL=josh@highscore-demo.local \
EXPO_PUBLIC_DEV_AUTH_DISPLAY_NAME='Josh Lebedinsky' \
pnpm exec expo start --dev-client --tunnel --port 8082
```

Fixture data comes from `apps/backend/scripts/seed-highscore-appstore.ts`. Apply edits with
`pnpm --filter backend run db:seed:highscore-appstore`, then reload Metro; the installed Studio
shell only needs rebuilding after a native dependency or Expo config change.

## Layout

```
app/                     expo-router routes
  _layout.tsx            providers + auth gate
  (tabs)/index.tsx       Games home
  games/[id].tsx         per-game standings history
  friends/               friends, profiles, invite acceptance
  g/[token].tsx          in-app play-link resolver
  share/                 native score-share picker
  sign-in.tsx            Apple / Google / dev sign-in
  onboarding/            display-name capture
src/hooks/useAuth.tsx    auth context over @workshop/api-client
src/components/          app-local components (wordmark)
src/games/               app-owned Games + friends UI, hooks, and client adapters
public/index.html        web HTML shell — OG tags, theme-color, canvas lock
functions/               Pages API proxy, AASA, and OG metadata/PNG routes
```

Shared code comes from `@workshop/ui` (design system and Google sign-in button),
`@workshop/api-client` (API, friends boundary, session, storage, OAuth hooks), and
`@workshop/shared` (types, game registry, score parsing, summary specs). Presentation and
games-specific client adapters stay here even when Workshop's frozen snapshot has a copy;
only contract-level code belongs in a package.

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

`eas.json` includes the App Store Connect app id for production submissions.
