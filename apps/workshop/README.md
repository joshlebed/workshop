# workshop (Expo app)

The iOS client. This app is an umbrella for multiple small products — the first is **watchlist**
(movie tracker). Future features (fitness tracker, silly experiments, etc.) live alongside as
additional routes.

```bash
pnpm install                                      # from repo root
EXPO_PUBLIC_API_URL=http://localhost:8787 pnpm --filter workshop-app start
```

Open the Expo Go app on your phone and scan the QR code. Press `i` in the terminal to open the iOS
simulator.

## Structure

- `app/` — expo-router file-based routes (current routes are watchlist-only; adding a route per
  new feature)
- `src/api/` — typed fetch client that imports shapes from `@workshop/shared`
- `src/hooks/useAuth.tsx` — auth context (magic-code flow)
- `src/lib/storage.ts` — iOS Keychain-backed session storage

## Deploying

- JS-only changes: push to `main`, GitHub Actions runs `eas update` → your phone picks it up next
  launch.
- Native changes (new native lib, config): trigger the `testflight` workflow manually, or run
  `pnpm --filter workshop-app run eas:build:ios` then `eas:submit:ios` locally.
