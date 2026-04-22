# watchlist

Expo app (React Native + TypeScript) — the first product in this monorepo.

```bash
pnpm install                                      # from repo root
cp app.json app.json                              # (first time: fill REPLACE_WITH_* placeholders — see docs/manual-setup.md)
EXPO_PUBLIC_API_URL=http://localhost:8787 pnpm start
```

Open the Expo Go app on your phone and scan the QR code. You can also press `i` in the terminal to
open the iOS simulator.

## Structure

- `app/` — expo-router file-based routes
- `src/api/` — typed fetch client that imports shapes from `@workshop/shared`
- `src/hooks/useAuth.tsx` — auth context (magic-code flow)
- `src/lib/storage.ts` — iOS Keychain-backed session storage

## Deploying

- JS-only changes: push to `main`, GitHub Actions runs `eas update` → your phone picks it up next
  launch.
- Native changes (new native lib, config): trigger the `testflight` workflow manually, or run
  `pnpm run eas:build:ios` then `pnpm run eas:submit:ios` locally.
