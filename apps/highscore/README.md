# HighScore (`apps/highscore`)

Expo app for **HighScore** (`highscore.live`) — the daily-games half of the split described
in [`docs/highscore-migration-plan.md`](../../docs/highscore-migration-plan.md). Builds web
and iOS from one component tree via `react-native-web`, exactly like `apps/workshop`.

This app owns the Games home, standings, catalog, friends, play-link resolver, and native
score-share flow. During migration, Workshop renders the same `@workshop/games` package.

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
  (tabs)/index.tsx       Games home
  games/[id].tsx         per-game standings history
  friends/               friends, profiles, invite acceptance
  g/[token].tsx          in-app play-link resolver
  share/                 native score-share picker
  sign-in.tsx            Apple / Google / dev sign-in
  onboarding/            display-name capture
src/hooks/useAuth.tsx    auth context over @workshop/api-client
src/components/          app-local components (wordmark)
public/index.html        web HTML shell — OG tags, theme-color, canvas lock
functions/               Pages API proxy, AASA, and OG metadata/PNG routes
```

Shared code comes from `@workshop/games` (Games feature), `@workshop/ui` (design system and
Google sign-in button), `@workshop/api-client` (API, session, storage, OAuth hooks), and
`@workshop/shared` (types). Anything both apps need belongs in a package, not here.

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

Cloudflare Pages deploys web from the Git-integrated `highscore` project. Mobile deployment
CI is not wired yet: `testflight-highscore.yml` and the OTA channel land in PR-8. The
Metro-bundle and runtime-version guards already cover both apps. Until PR-8 lands:

```bash
cd apps/highscore
pnpm exec expo export --platform ios --output-dir dist-ci   # bundle smoke test
pnpm eas:build:ios                                          # manual EAS build
```

`eas.json` has no `submit.production` block yet — the App Store Connect app id gets filled
in when PR-8 wires auto-submit.
