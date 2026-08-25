# HighScore (`apps/highscore`)

Expo app for **HighScore** (`highscore.live`) — the daily-games half of the split described
in [`docs/highscore-migration-plan.md`](../../docs/highscore-migration-plan.md). Builds web
and iOS from one component tree via `react-native-web`, exactly like `apps/workshop`.

Today this is a **scaffold**: sign-in (Apple / Google / dev) plus a placeholder Games home.
The Games surfaces themselves move over from Workshop in PR-4.

|                              |                                                                 |
| ---------------------------- | --------------------------------------------------------------- |
| Bundle id                    | `live.highscore.app`                                            |
| Scheme                       | `highscore`                                                     |
| Apple Services ID (web auth) | `live.highscore.web`                                            |
| EAS project                  | `@joshlebed/highscore` (`92a568f5-b0f0-4af1-bb9d-98181025691c`) |
| Web domain (not live yet)    | `highscore.live` — Cloudflare Pages project lands in OP-7/PR-6  |

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
  (tabs)/index.tsx       placeholder Games home
  sign-in.tsx            Apple / Google / dev sign-in
  onboarding/            display-name capture
src/hooks/useAuth.tsx    auth context over @workshop/api-client
src/lib/oauth/           Apple + Google provider glue (native/.web variants)
src/components/          app-local components (wordmark)
public/index.html        web HTML shell — OG tags, theme-color, canvas lock
```

Shared code comes from `@workshop/ui` (design system), `@workshop/api-client`
(`apiRequest`, session credentials, storage, API-URL derivation) and `@workshop/shared`
(types). Anything both apps need belongs in a package, not here — see the root `CLAUDE.md`.

`src/lib/oauth/**` is currently duplicated from `apps/workshop`; keep the two copies in sync
until it's extracted (tracked in `AGENT-REFLECTIONS.md`).

## API URL derivation

Handled by `@workshop/api-client/config` — the same module Workshop uses. On web it derives
the base URL from `window.location`: `localhost` → `http://localhost:8787`, a Niteshift
preview host or a `*.pages.dev` host → same-origin `/api`. `metro.config.js` +
`dev-api-proxy.js` forward that `/api` prefix to the backend so the web bundle never has to
cross the Niteshift preview proxy's per-port auth wall.

`highscore.live` is not in that derivation yet — it needs the `/api/*` Pages Function that
lands with the Cloudflare Pages project in PR-6. Until then production web falls through to
`EXPO_PUBLIC_API_URL` (the API Gateway origin), which the backend's CORS allowlist already
accepts.

## Shipping

Not wired to CI yet. `testflight-highscore.yml`, the OTA channel, and the per-app
fingerprint tag namespace (`hs-ios-fp-*`) land in PR-8; the Metro-bundle and
runtime-version guards get matrixed over both apps in PR-5. Until then:

```bash
cd apps/highscore
pnpm exec expo export --platform ios --output-dir dist-ci   # bundle smoke test
pnpm eas:build:ios                                          # manual EAS build
```

`eas.json` has no `submit.production` block yet — the App Store Connect app id gets filled
in when PR-8 wires auto-submit.
