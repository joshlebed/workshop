# workshop

> [!WARNING]  
> This app is basically completely vibe coded. Dive into the code and docs at your own risk.

Josh's personal monorepo for apps, scripts, and experiments. Two products, one backend
and one user account:

- **Workshop.dev** (`apps/workshop`) — an umbrella for small products: lists, watchlist,
  sharing, friends.
- **HighScore** (`apps/highscore`, `highscore.live`) — daily games. Currently a scaffold
  (sign-in + placeholder home); the Games surfaces move over from Workshop next. See
  [`docs/highscore-migration-plan.md`](docs/highscore-migration-plan.md).

Both build iOS + web from one component tree. Sign in with the same Apple ID on either and
you get the same account.

- **Mobile + web**: Expo (React Native, TypeScript) — `apps/workshop`, `apps/highscore`
- **Backend**: Hono on AWS Lambda + PostgreSQL on Neon — `apps/backend`
- **Shared client code**: `packages/ui` (design system), `packages/api-client` (API + session)
- **Shared types**: `packages/shared`
- **Cloudflare Pages Functions**: OG previews, AASA — `functions/`
- **Infra**: Terraform on AWS, state in HCP Terraform — `infra/`
- **CI/CD**: GitHub Actions — merge to `main` deploys the API and ships a JS OTA via
  EAS Update.

## Quickstart

```bash
pnpm install
pnpm dev                # postgres (docker) + backend (:8787) + workshop web (:8081)
HIGHSCORE=1 pnpm dev    # …plus the HighScore web app on :8082
```

Open <http://localhost:8081> (or <http://localhost:8082> for HighScore). Web is the primary dev surface — fast iteration,
agent-browser can drive the real UI. The web app auto-signs in as a seeded dev user
(`joshlebed@gmail.com`) with sample lists already populated, so it opens lived-in.

For iOS in Expo Go (separate terminal — Expo's interactive UI doesn't render cleanly
next to streaming backend logs):

```bash
EXPO_PUBLIC_API_URL=http://localhost:8787 pnpm --filter workshop-app start
EXPO_PUBLIC_API_URL=http://localhost:8787 pnpm --filter highscore-app start
```

Scan the QR with Expo Go on a real phone, or press `i` for the iOS simulator.

## Commands

```bash
pnpm run typecheck     # all packages
pnpm run lint          # biome (auto-fix on: pnpm run lint:fix)
pnpm run test          # vitest
pnpm run knip          # unused-code detection (non-blocking)

./scripts/dev.sh                                          # local dev stack
AWS_PROFILE=workshop-prod ./scripts/logs.sh               # tail prod Lambda logs
AWS_PROFILE=workshop-prod ./scripts/db-connect.sh         # psql into prod Neon
```

## Deploying

- **Daily**: merge to `main`. EAS Update ships JS-only changes to phones in ~60s;
  Lambda + Pages deploy automatically.
- **TestFlight**: triggered automatically when the iOS fingerprint changes. Force
  manually with `gh workflow run testflight.yml --ref main --field force=true`.

## First-time setup

See [`docs/manual-setup.md`](./docs/manual-setup.md) for the ordered checklist of
external accounts (AWS, HCP Terraform, Expo, Apple Dev) and one-time configuration.

If `docs/plans/HANDOFF.md` exists, setup isn't finished — read that first.

## Decisions

See [`docs/decisions.md`](./docs/decisions.md) for architectural choices (why Lambda
over EC2, why Neon over RDS, how this prototype stays on free tiers).

## For coding agents

Start at [`CLAUDE.md`](./CLAUDE.md). It points at the area-specific guides
(`apps/workshop/CLAUDE.md`, `apps/backend/CLAUDE.md`, `infra/CLAUDE.md`,
`functions/CLAUDE.md`) and the reference docs in `docs/`.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Small focused PRs preferred.
