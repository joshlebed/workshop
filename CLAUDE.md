# workshop — coding agent guide

Read this before editing anything. Also read `docs/decisions.md` for the constraints behind the
design, and check `docs/plans/HANDOFF.md` if it exists — it describes in-flight setup work that
may not be complete.

## What this repo is

A personal monorepo. The iOS app (`apps/workshop`, published as **Workshop.dev**) is an umbrella
for multiple small products. The first feature is **watchlist** (movie tracker). Future features
land as additional routes inside the same app.

## Stack at a glance

- **pnpm workspaces** (`apps/*`, `packages/*`). Hoisted node_modules for Expo compatibility (see
  `.npmrc`). Expo SDK 55, React Native 0.83.6 — use `npx expo install --check` before upgrading
  any mobile dep.
- **Expo (React Native) + expo-router + TypeScript** for the iOS client. Bundle id
  `dev.josh.workshop`, Apple Team ID `Q65U6C65ZZ`, App Store Connect App ID `6763154414`, EAS
  project `@joshlebed/workshop` (id `e395fb39-54cc-4841-a40a-c8d074f5db60`).
- **Hono on AWS Lambda behind API Gateway HTTP API** for the backend. PostgreSQL on RDS
  (`db.t4g.micro`, public + forced SSL — see `docs/decisions.md`). Drizzle ORM.
- **Terraform** for all infra. State in HCP Terraform (free tier), org `josh-personal-org`,
  workspace `workshop-prod`, execution mode **Local** (plans/applies run on the client, state
  stored in HCP).
- **GitHub Actions** for CI/CD. OIDC to AWS (no long-lived keys). Secrets: `TF_API_TOKEN`,
  `AWS_ROLE_ARN`, `EXPO_TOKEN`, `EXPO_PUBLIC_API_URL`.
- **EAS Update** for JS-only OTA updates to iPhones within ~60s of merge. TestFlight for native
  builds (manual dispatch only).

## AWS

- **Account for Workshop**: see `infra/terraform.tfvars.local` (gitignored). During the initial
  setup the project ran inside a multi-tenant "messenger-weight-bot" account; the intent is to
  isolate it into a dedicated `workshop` account under the same AWS Organization
  (`o-m515tekbvf`). If `docs/plans/HANDOFF.md` exists, that migration is in progress.
- **Region**: us-east-1.
- **Local access**: SSO via `aws sso login --profile workshop-prod` (or whichever profile
  targets the Workshop account). All `terraform` / `aws` commands should be prefixed with
  `AWS_PROFILE=workshop-prod`. If SSO expires mid-session, re-login.
- **CI access**: GitHub Actions assumes the `workshop-prod-github-actions` IAM role via OIDC.
  The trust policy is scoped to this repo on `main`, PRs, and the `production` environment.

## Conventions

- **Verify before deploying.** Run `pnpm run typecheck && pnpm run test && pnpm run lint` locally
  before pushing — CI runs the same.
- **No secrets in the repo.** The DB password, session secret, and DATABASE_URL all live in SSM
  Parameter Store and are read by Terraform (baked into Lambda env vars at deploy time). GitHub
  Actions reads SSM via OIDC — never hardcoded access keys. `terraform.tfvars.local` and
  `.env` files are gitignored.
- **Share types in `@workshop/shared`.** When you add or change an API shape, put the type there
  and import it from both backend (`apps/backend`) and mobile (`apps/workshop`). No manually-kept
  duplicate interfaces.
- **Drizzle migrations**: from `apps/backend/`, run
  `pnpm run db:generate -- --name=descriptive_name` — always use `--name`. Commit all generated
  files in `drizzle/` and `drizzle/meta/`.
- **Biome for lint + format**. `eas-cli` and some other tools reformat `app.json`; always run
  `pnpm run lint:fix` after those to settle CI.
- **Logger**: use `logger` from `apps/backend/src/lib/logger.ts`. Pass full error objects:
  `logger.error("failed to x", { error })`, not `{ error: error.message }` — you lose the stack.
- **Postgres connection pool**: `postgres({ max: 1 })` is correct for Lambda. Each container has
  its own connection.

## Debugging production

Reach for these before asking the user:

```bash
AWS_PROFILE=workshop-prod ./scripts/logs.sh --since 10m --filter error   # Lambda errors
AWS_PROFILE=workshop-prod ./scripts/logs.sh --filter "<request_id>"       # one request
AWS_PROFILE=workshop-prod ./scripts/db-connect.sh                          # psql into RDS

cd infra && AWS_PROFILE=workshop-prod terraform state list                 # deployed resources
cd infra && AWS_PROFILE=workshop-prod terraform output                     # api_url, lambda_name, log_group, etc.

curl -fsS $(cd infra && AWS_PROFILE=workshop-prod terraform output -raw api_url)/health   # quick health check
```

The Lambda reads `STAGE`, `DATABASE_URL`, `SESSION_SECRET`, `SES_FROM_ADDRESS`, `LOG_LEVEL` from
env vars set by Terraform. If behavior seems wrong, `aws lambda get-function-configuration` shows
what's actually running.

## Known gotcha: HCP Terraform state lock

HCP's state lock doesn't auto-release when a terraform process is killed (Ctrl-C, CI cancel,
runner crash). Symptoms: `terraform apply` hangs or fails with `Error acquiring the state lock`.

Fix:
1. Open <https://app.terraform.io/app/josh-personal-org/workspaces/workshop-prod>.
2. Click **Unlock** (top right).
3. Retry the operation.

Prefer force-unlock via the UI over `-lock=false` — the flag bypasses safety; UI unlock clears
cleanly.

## Safe changes vs careful changes

- **Safe** (green light, just push): new routes, new Expo screens, new Drizzle columns with
  defaults, new tests, new scripts.
- **Careful** (run `terraform plan` locally first, show the user): anything in `infra/` other than
  `outputs.tf` / `README.md`; anything touching IAM policies; anything that would recreate RDS
  (e.g. changing `engine_version` with `apply_immediately=true`).
- **Ask first**: deleting DB data, changing the Lambda runtime major version, rotating the OIDC
  provider, adding a new AWS service (every service has a free-tier implication), touching
  anything in a *different* AWS account than Workshop's.

## Per-area guides

- `apps/backend/CLAUDE.md` — Hono + Drizzle patterns, Lambda bundling
- `apps/workshop/README.md` — Expo app structure
- `infra/README.md` — Terraform layout

## Running commit-ready checks

```bash
pnpm run typecheck     # ~12s
pnpm run lint          # ~1s
pnpm run test          # ~2s
cd infra && terraform fmt -check -recursive && terraform validate
```
