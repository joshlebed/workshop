# HighScore App Store screenshots

These are App Store Connect-ready starting assets composed from the HighScore web build.
They are web-render approximations; native iPhone captures are the higher-fidelity option.

## Output sets

- `6.9-inch/`: 1320 × 2868 PNGs
- `6.5-inch/`: 1284 × 2778 PNGs
- `raw/`: unframed 440 × 956 source captures

## Regenerate

Replace the files in `raw/` without changing their names, then run:

```bash
node scripts/compose-highscore-appstore-screenshots.mjs
```

The script requires `ffmpeg` with SVG support and writes opaque RGB PNGs at both required
App Store sizes.

## Native replacement shot list

1. Games home showing today's standings, streaks, and reactions.
2. Paste sheet showing a parsed score before posting.
3. Friends screen showing invite, requests, existing friends, and suggestions.
4. Share Extension showing a detected game and score destination.

## Privacy-safe native fixture

The App Store fixture creates only synthetic `@highscore-demo.local` users and is guarded to
`STAGE=local`:

```bash
pnpm --filter @workshop/backend db:seed:highscore-appstore
```

For a temporary native screenshot build, enable dev auth and select the synthetic owner:

```dotenv
EXPO_PUBLIC_API_URL=http://localhost:8787
EXPO_PUBLIC_DEV_AUTH=1
EXPO_PUBLIC_DEV_AUTH_EMAIL=maya@highscore-demo.local
EXPO_PUBLIC_DEV_AUTH_DISPLAY_NAME=Maya Chen
```

Capture on any accepted 6.9-inch simulator. Apple accepts 1290 × 2796 and 1320 × 2868 portrait
screenshots without resizing.
