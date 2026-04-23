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
- **Hono on AWS Lambda behind API Gateway HTTP API** for the backend. PostgreSQL on **Neon**
  (managed, free tier, see `docs/decisions.md` for the switch from RDS). Drizzle ORM, `postgres-js`
  driver. Connection string lives in `infra/terraform.tfvars.local` (gitignored) → SSM SecureString
  → Lambda env var.
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
AWS_PROFILE=workshop-prod ./scripts/db-connect.sh                          # psql into Neon

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
  `outputs.tf` / `README.md`; anything touching IAM policies; rotating `database_url` (Lambda env
  var gets updated, in-flight requests may fail briefly).
- **Ask first**: deleting DB data, changing the Lambda runtime major version, rotating the OIDC
  provider, adding a new AWS service (every service has a free-tier implication), touching
  anything in a *different* AWS account than Workshop's.

## Local development

The Expo app builds to **iOS and web from the same component tree** via `react-native-web`. Web
is the primary dev surface — it's faster to iterate in Chrome, and browser-automation tools
(including Claude's `mcp__claude-in-chrome__*`) can drive the real UI for closed-loop testing.
iOS ships via EAS; the web build is dev-only.

### First-time setup

Prereqs: Node 20.19 (see `.nvmrc`), pnpm 10.19 (pinned in `package.json`), Docker Desktop
running. Then:

```bash
pnpm install
pnpm dev   # first run creates apps/backend/.env and migrates the local DB
```

### Running it

```bash
pnpm dev          # → postgres (docker) + backend (:8787) + web app (:8081)
pnpm dev:backend  # backend only
pnpm dev:mobile   # iOS/Expo Go — MUST be a separate terminal (QR/keybinds)
```

`pnpm dev` runs `scripts/dev.sh`, which: starts the `workshop-pg` postgres container, seeds
`apps/backend/.env` on first run (generating `SESSION_SECRET`), applies Drizzle migrations, then
uses `concurrently` to run the backend (`tsx watch`) and `expo start --web` with `[backend]` /
`[web]` prefixes in a single terminal. Ctrl-C stops both. `app.json` already points `apiUrl` at
`http://localhost:8787`; backend CORS is `origin: "*"`.

### Dev logs — `/tmp/workshop-dev.log`

All dev output is also tee'd to `/tmp/workshop-dev.log` (override with `WORKSHOP_DEV_LOG=...`).
The terminal copy keeps ANSI colors; the file copy is plain text so grep and agents can read it
directly. **This is the first place to look when something isn't working.**

```bash
tail -f /tmp/workshop-dev.log
grep "magic code" /tmp/workshop-dev.log         # local sign-in codes
grep -iE "error|warn" /tmp/workshop-dev.log
grep "<request_id>" /tmp/workshop-dev.log       # trace a single request
```

### Signing in locally (no email)

In `STAGE=local`, `sendMagicLinkEmail` does **not** hit SES — it logs the code to stdout (see
`apps/backend/src/lib/email.ts:17-20`). To sign in through the web app: submit your email in
the form, then:

```bash
grep "magic code" /tmp/workshop-dev.log | tail -1
```

Copy the 6-digit `code` out of the JSON log line and paste it into the verify step. Codes
expire in 15 minutes.

### Sharing code between web and iOS

Metro resolves `.web.ts(x)` before `.ts(x)` on web and `.native.ts(x)` before `.ts(x)` on iOS,
so most of the UI is truly shared and only native-specific modules need a platform variant:

- `src/lib/storage.ts` → `expo-secure-store` (iOS keychain)
- `src/lib/storage.web.ts` → `window.localStorage` shim with the same exports

Add a new `.web.ts(x)` beside a file when a feature imports a native-only module. Don't add
`Platform.OS === 'web'` branches inside shared files — the `.web.ts` extension is cleaner and
Metro strips the unused variant from each bundle.

Modules known to work as-is on web: `expo-router`, `expo-linking`, `expo-constants`,
`expo-status-bar`, `expo-updates` (web stub returns `isUpdatePending: false`),
`react-native-safe-area-context`, `react-native-screens`, `react-native-gesture-handler`,
`@react-navigation/native`. Re-check when adding any new native module.

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
