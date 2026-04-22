# workshop — coding agent guide

Read this before editing anything. Also read `docs/decisions.md` to understand the constraints
that shaped the current design before proposing rewrites.

## What this repo is

A personal monorepo. The movie watchlist app (`apps/watchlist`) is the first product, but the repo
will grow into a collection of small apps, scripts, and experiments. Public on GitHub so friends
can contribute.

## Stack at a glance

- **pnpm workspaces** (`apps/*`, `packages/*`). Hoisted node_modules for Expo compatibility (see
  `.npmrc`).
- **Expo (React Native) + expo-router + TypeScript** for the iOS client.
- **Hono on AWS Lambda behind API Gateway** for the backend. PostgreSQL on RDS (public + SSL for
  prototype — see `docs/decisions.md`). Drizzle ORM.
- **Terraform** for all infra. State in HCP Terraform (free tier).
- **GitHub Actions** for CI/CD. OIDC to AWS (no long-lived keys).
- **EAS Update** for JS-only OTA updates to iPhones within ~60s of merge. TestFlight for native
  builds (manual dispatch only).

## Conventions

- **Verify before deploying.** Run `pnpm run typecheck && pnpm run test && pnpm run lint` locally
  before pushing — CI runs the same.
- **No secrets in the repo.** AWS password, session secret, DB URL all live in SSM Parameter Store
  and are read by Lambda at cold start (via env vars set by Terraform). GitHub Actions reads from
  SSM via OIDC — never via hardcoded access keys.
- **Share types in `@workshop/shared`.** When you add or change an API shape, put the type there
  and import it from both backend (`apps/backend`) and mobile (`apps/watchlist`). No manually-kept
  duplicate interfaces.
- **Drizzle migrations**: from `apps/backend/`, run
  `pnpm run db:generate -- --name=descriptive_name` — always use `--name`. Commit all generated
  files in `drizzle/` and `drizzle/meta/`.
- **Biome for lint + format**. Auto-applied on `pnpm run lint:fix`.
- **Logger**: use `logger` from `apps/backend/src/lib/logger.ts`. Pass full error objects:
  `logger.error("failed to x", { error })`, not `{ error: error.message }` — you lose the stack.
- **No cold-start DB connection pooling across requests** — Lambda provides isolation per
  container, `postgres({ max: 1 })` is correct.

## Debugging production

Coding agents should reach for these before asking the user:

```bash
./scripts/logs.sh --since 10m --filter error   # last 10m of errors in Lambda
./scripts/logs.sh --filter "<request_id>"      # follow one request across handlers
./scripts/db-connect.sh                         # psql into prod RDS (read-only mindset)

cd infra && terraform state list                # what's actually deployed
cd infra && terraform output                    # api_url, lambda_name, log_group, etc.
```

The Lambda reads `STAGE`, `DATABASE_URL`, `SESSION_SECRET`, `SES_FROM_ADDRESS`, `LOG_LEVEL` from
env vars set by Terraform. If config seems wrong, check `aws lambda get-function-configuration`
before assuming code is broken.

## Safe changes vs careful changes

- **Safe** (green light, just push): new routes, new Expo screens, new Drizzle columns with
  defaults, new tests, new scripts.
- **Careful** (run `terraform plan` locally first, show the user): anything in `infra/` other than
  `outputs.tf` / `README.md`; anything touching IAM policies; anything that would recreate RDS
  (e.g. changing `engine_version` with `apply_immediately=true`).
- **Ask first**: deleting DB data, changing the Lambda runtime major version, rotating the OIDC
  provider, adding a new AWS service (every service has a free-tier implication).

## Per-area guides

- `apps/backend/` — Hono + Drizzle patterns
- `apps/watchlist/` — Expo app
- `infra/` — Terraform layout
