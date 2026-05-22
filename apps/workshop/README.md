# workshop (Expo app)

The iOS + web client for **Workshop.dev** — an umbrella app for small products
(currently lists, scores, leaderboards). One component tree, two platforms via
`react-native-web`.

## Running locally

From the repo root: `pnpm dev` (boots postgres + backend + this app at `:8081`).
Web is the primary dev surface — open <http://localhost:8081>.

For iOS in Expo Go:

```bash
EXPO_PUBLIC_API_URL=http://localhost:8787 pnpm --filter workshop-app start
```

Press `i` for the iOS simulator or scan the QR with the Expo Go app on a real phone.

## Structure

- `app/` — expo-router file-based routes
- `src/ui/` — primitives (`Text`, `Button`, `Sheet`, `Screen`, theme tokens)
- `src/screens/` — screen-level composition
- `src/lib/` — API client, storage shim, hooks
- `src/config.ts` — API URL resolution (localhost, Niteshift preview proxy, env override)
- `public/index.html` — web HTML shell (theme color, viewport, default OG tags)

## Deploying

Merge to `main`:

- **JS-only changes** → GitHub Actions runs `eas update`, phones pick it up next launch
  (~60s).
- **Native changes** → bump `app.json` `version` in the same PR, then trigger
  `testflight.yml` manually (or rely on the auto-trigger when fingerprint changes).

Agent gotchas (Sheets, Reanimated, dnd-kit, OAuth quirks, etc.): see `CLAUDE.md`.
iOS deploy recovery: `docs/ios-deploy-pipeline.md`.
