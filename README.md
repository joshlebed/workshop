# workshop

Josh's personal monorepo for apps, scripts, and experiments. The first product is an iOS app
called **Workshop.dev** (`apps/workshop`), an umbrella that currently hosts a movie **watchlist**
and will grow to include more small apps over time.

- **Mobile**: Expo (React Native, TypeScript) — `apps/workshop`
- **Backend**: Hono on AWS Lambda + PostgreSQL on RDS — `apps/backend`
- **Shared types**: `packages/shared`
- **Infra**: Terraform on AWS, state in HCP Terraform — `infra/`
- **CI/CD**: GitHub Actions — merge to `main` deploys the API and ships a JS OTA update to
  phones via EAS Update.

## Quickstart (local dev)

```bash
pnpm install
./scripts/dev.sh                  # postgres (docker) + backend (leave running)

# In a second terminal:
EXPO_PUBLIC_API_URL=http://localhost:8787 pnpm --filter workshop-app start
```

Open Expo Go on your iPhone, scan the QR code from the second terminal. Sign in with any email —
the 6-digit code prints in the backend terminal (local mode doesn't send real email).

> Two terminals because Expo's interactive QR/keybind UI doesn't render cleanly next to streaming
> backend logs.

## Commands

```bash
pnpm run typecheck        # all packages
pnpm run lint             # biome (auto-fixes on: pnpm run lint:fix)
pnpm run test             # vitest

./scripts/dev.sh                                          # local dev stack
AWS_PROFILE=workshop-prod ./scripts/logs.sh               # tail prod Lambda logs
AWS_PROFILE=workshop-prod ./scripts/db-connect.sh         # psql into prod RDS
AWS_PROFILE=workshop-prod ./scripts/deploy.sh             # manual Lambda upload (CI does this automatically)
```

## First-time setup

See [`docs/manual-setup.md`](./docs/manual-setup.md) for the ordered checklist of external
accounts (AWS, HCP Terraform, Expo, Apple Dev) and one-time configuration.

If there's a `docs/plans/HANDOFF.md`, setup isn't finished — read that first.

## Deploying to your phone

- **Development (daily)**: Expo Go scans a QR code — no build needed. EAS Update ships JS-only
  changes in ~60s after merge to `main`.
- **TestFlight (share with friends)**: run `pnpm --filter workshop-app run eas:build:ios` from
  your laptop (needs Apple 2FA). Then `pnpm --filter workshop-app run eas:submit:ios` pushes the
  build to App Store Connect TestFlight. From there, promote to "External Testers" and generate a
  public link.

## Decisions

See [`docs/decisions.md`](./docs/decisions.md) for architectural choices (why Lambda over EC2, why
public RDS for the prototype, how to migrate when it's time to lock things down).

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Small focused PRs preferred.
