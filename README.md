# workshop

Josh's personal monorepo for apps, scripts, and experiments. First product: a movie watchlist iOS
app (`apps/watchlist`). Future apps live alongside it.

- **Mobile**: Expo (React Native, TypeScript) — `apps/watchlist`
- **Backend**: Hono on AWS Lambda + PostgreSQL on RDS — `apps/backend`
- **Shared types**: `packages/shared`
- **Infra**: Terraform (AWS, one prod env) — `infra/`
- **CI/CD**: GitHub Actions — merge to `main` deploys the API and ships a JS OTA update to
  phones via EAS Update.

## Quickstart (local dev)

```bash
pnpm install
./scripts/dev.sh                  # postgres + backend (leave running)

# In a second terminal:
EXPO_PUBLIC_API_URL=http://localhost:8787 pnpm --filter watchlist start
```

Open Expo Go on your iPhone, scan the QR code from the second terminal. Sign in with any email —
the 6-digit code prints in the backend terminal (local mode doesn't send real email).

> Two terminals because Expo's interactive QR/keybind UI doesn't render cleanly next to streaming
> backend logs.

## Commands

```bash
pnpm run typecheck        # all packages
pnpm run lint             # biome (auto-fixes on: pnpm run lint:fix)
pnpm run test             # vitest + jest

./scripts/dev.sh          # full local stack
./scripts/logs.sh         # tail prod Lambda logs
./scripts/db-connect.sh   # psql into prod RDS (read-only mindset)
./scripts/deploy.sh       # manual Lambda upload (CI does this automatically)
```

## First-time setup

See [`docs/manual-setup.md`](./docs/manual-setup.md) — an ordered checklist of accounts and
one-time configuration (HCP Terraform, AWS, Apple Dev, EAS, SES, GitHub secrets).

## Contributing

This repo is public so friends can drop in. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Decisions

See [`docs/decisions.md`](./docs/decisions.md) for architectural choices (why Lambda over EC2, why
public RDS for now, how to migrate when it's time to lock things down).
