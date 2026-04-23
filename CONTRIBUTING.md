# Contributing

Thanks for poking around. This is a personal playground, so the bar for merging is "does it work
and does Josh like it." Small, focused PRs preferred.

## Getting started

```bash
pnpm install
./scripts/dev.sh
```

Open Expo Go on your phone, scan the QR code, sign in with your email. In dev, the 6-digit code
is printed in the backend terminal (no real email sent).

## Before opening a PR

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
```

CI runs the same. PRs from forks do **not** get deploy credentials — don't expect `deploy-*`
workflows to run on your PR.

## Architectural guidelines

Read [`docs/decisions.md`](./docs/decisions.md) before proposing substantial changes. Most of the
quirks (Neon for Postgres, manual TMDB, email codes instead of links) are deliberate and explained
there.

If you're adding a new app or script, drop it in `apps/<name>/` or as a top-level script — the
repo is deliberately loose about structure.
