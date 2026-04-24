# workshop (Expo app)

The iOS + web client for Workshop.dev. The v1 watchlist UI has been removed; v2 (group lists)
is being rebuilt phase-by-phase per `docs/redesign-plan.md`. The home screen currently shows a
"v2 in progress" placeholder; auth, lists, and items land in the next chunks.

```bash
pnpm install                                      # from repo root
EXPO_PUBLIC_API_URL=http://localhost:8787 pnpm --filter workshop-app start
```

Open the Expo Go app on your phone and scan the QR code. Press `i` in the terminal to open the iOS
simulator.

## Structure

- `app/` — expo-router file-based routes (just the placeholder home for now)
- `src/config.ts` — API URL resolution (handles localhost, Niteshift preview proxy, env override)
- `src/ui/` (Phase 0b) — primitives library (`Text`, `Button`, theme tokens) once auth lands

## Deploying

- JS-only changes: push to `main`, GitHub Actions runs `eas update` → your phone picks it up next
  launch.
- Native changes (new native lib, config): trigger the `testflight` workflow manually, or run
  `pnpm --filter workshop-app run eas:build:ios` then `eas:submit:ios` locally.
