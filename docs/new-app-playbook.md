# New app playbook

For a coding agent (Claude Code, Codex, etc.) working interactively with a
single developer who wants a working production iOS app plus backend. Same
stack as `workshop`: Expo (SDK 55+) + Hono on Lambda + Postgres on Neon +
Terraform on HCP + GitHub Actions.

The user shows up with:

- An **AWS account** (any billing status; you'll keep inside free tier).
- An **Apple Developer account** (paid, $99/yr, enrolled).
- Nothing else.

Your job: a working app on their phone via TestFlight, deploying OTA updates
from every `git push` to main, in **one session**, without burning their Apple
2FA patience.

**Budget: 2 hours wall-clock. ~25 min of user-active time.** Anything longer
means you're either stuck or you ignored this playbook.

---

## The single most important rule

**Verify current state before moving anything.** Every time you think a piece
of the pipeline "works," push a trivial change through it and watch it
actually succeed before building the next piece on top. This playbook is
ordered so that each phase's green light is a real deploy, not a
`terraform validate` or a passing type-check.

If you skip this rule you will spend half your session debugging latent bugs
three phases ago, which is exactly what happened when this stack was first
built.

---

## Phase 0 — Preflight interview (5 min, user-active)

Before writing a single file, get these from the user in one chat turn:

1. **Project slug** — one lowercase word, no hyphens. Used as TF workspace
   name, RDS identifier (even on Neon, some things reuse it), AWS tag
   `Project=`. Example: `watchlist`, `workshop`, `ledger`.
2. **Display name** — what shows on the home screen. Can have dots/spaces.
   Example: `Workshop.dev`.
3. **Bundle ID** — reverse-domain style. `dev.<theirname>.<slug>` is fine.
   Must match whatever App Store Connect app they create.
4. **Apple Team ID** — 10-char string. On [developer.apple.com/account](https://developer.apple.com/account) → Membership details → Team ID.
5. **AWS account ID** — 12-digit. `aws sts get-caller-identity` after SSO.
6. **SSO start URL** — in `~/.aws/config` under any existing sso-session.
7. **Existing AWS profile name** pointing at this account (if any).
8. **Sender email for auth** — e.g. `joshlebed@gmail.com`. Used as the
   `reply-to` on magic-code emails; **not** the SES `from:` — see below.
9. **Domain name they're willing to register** — push hard for this.
   Without a domain, every auth email hits spam. Cloudflare Registrar is
   ~$10/yr for `.dev`/`.app`; Namecheap has cheaper TLDs. If they refuse,
   note it as a known-wart and proceed.

**Do not proceed until all 9 are in chat.** Don't invent defaults for the
missing ones — the cost of asking is 30s, the cost of rebuilding for a
wrong bundle ID is 15 min.

---

## Phase 1 — External account setup (10 min, user-active)

In parallel, have them create accounts while you scaffold the repo:

### Accounts they need to create (give them all URLs at once)

| Account              | URL                                                         | Login method           | Why                 |
| -------------------- | ----------------------------------------------------------- | ---------------------- | ------------------- |
| **Neon**             | https://console.neon.tech/signup                            | "Continue with GitHub" | Postgres            |
| **HCP Terraform**    | https://portal.cloud.hashicorp.com/sign-up                  | GitHub or email        | TF state            |
| **Expo**             | https://expo.dev/signup                                     | GitHub recommended     | EAS Build / Update  |
| **GitHub repo**      | `gh repo create <slug> --private --source=. --push` (later) | —                      | CI + source         |
| **Domain registrar** | cloudflare.com/products/registrar/ or namecheap.com         | —                      | SES, branded sender |

### Neon project setup (30 sec of their time)

Tell them to create the project **inside `aws-us-east-1`**. Mismatching
regions with the Lambda adds 30-80ms to every cold query. Ask for the
**pooled connection string** (the URL with `-pooler` in the hostname).
If they send you the direct URL, it works for personal scale but flag it.

### HCP workspace setup

Create **one workspace per environment**, workflow: "CLI-driven",
execution mode: **Local**. Not remote — remote would require stuffing AWS
keys into HCP, which defeats the point of using OIDC from CI. Record the
`<org>/<workspace>` pair (e.g. `josh-personal-org/workshop-prod`).

Save the HCP API token locally (`terraform login`) **and** as a GitHub
secret (`TF_API_TOKEN`). Same token, both places.

### Expo

Have them create an access token at
[expo.dev/accounts/\[user\]/settings/access-tokens](https://expo.dev/) named
something like `<slug>-ci`. Save as GitHub secret `EXPO_TOKEN`. They do NOT
need to run `eas login` locally if all builds go through CI — but they will
for the very first `eas build` (Apple 2FA); see Phase 9.

### Domain

If they agree to buy a domain, collect it now. They don't need to
set up DNS yet — that happens in Phase 7. They just need the registrar
account and the domain purchased.

---

## Phase 2 — Repo scaffold (15 min, mostly you)

### Directory structure

```
<slug>/
  apps/
    backend/           # Hono on Lambda
    <slug>/            # Expo app (apps/<slug> matches the project slug)
  packages/
    shared/            # Shared TS types
  infra/               # Terraform
  scripts/             # dev.sh, logs.sh, db-connect.sh, etc.
  .github/workflows/
    ci.yml
    deploy-backend.yml
    deploy-mobile.yml
    testflight.yml
  CLAUDE.md
  README.md
  CONTRIBUTING.md
  docs/decisions.md
  docs/manual-setup.md
  .npmrc
  .nvmrc                # node 20.19.x (RN 0.83 / Expo 55 require 20.19+, <21)
  pnpm-workspace.yaml
  package.json
  biome.json            # lint + format
  tsconfig.json
```

### `.npmrc` (critical, don't skip)

```ini
node-linker=hoisted
shamefully-hoist=true
```

Without these, Expo fails at runtime with "Unable to resolve <peer dep>".
React Native's peer-dep graph assumes npm-style flat node_modules. This is
also why you cache `node_modules` directly in CI instead of just the pnpm
store — see Phase 8.

### `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### Root `package.json` scripts

```json
{
  "scripts": {
    "typecheck": "pnpm -r --parallel typecheck",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "test": "pnpm -r --parallel test"
  },
  "packageManager": "pnpm@10.19.0",
  "engines": { "node": ">=20.19 <21" },
  "devDependencies": {
    "@biomejs/biome": "^2.0.0",
    "typescript": "5.9.3"
  }
}
```

### Initial commit

```bash
git init
pnpm install
git add -A
git commit -m "chore: scaffold"
gh repo create <slug> --private --source=. --push
```

---

## Phase 3 — Backend (`apps/backend`, 20 min)

### Package.json essentials

```json
{
  "name": "@<slug>/backend",
  "main": "src/server.ts",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "node scripts/bundle.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "hono": "^4",
    "@hono/node-server": "^1",
    "@aws-sdk/client-sesv2": "^3",
    "drizzle-orm": "^0.37",
    "postgres": "^3",
    "zod": "^3"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8",
    "drizzle-kit": "^0.28",
    "esbuild": "^0.24",
    "tsx": "^4",
    "vitest": "^2"
  }
}
```

### Gotcha: SESSION_SECRET validator

If you put zod validation on env vars (you should), write:

```ts
SESSION_SECRET: z.string().min(32, "must be ≥32 chars"),
```

**Then remember this when you write CI later.** The workflow's migrate
step sets a dummy `SESSION_SECRET`. Make it **≥32 chars** or the migrate
step will fail with a cryptic zod error. Literal mistake made last
session; cost ~15 min of debug-fix-redeploy cycle.

### Lambda bundling (`scripts/bundle.mjs`)

Use esbuild, target `node20`, platform `node`, format `esm`. Mark
`@aws-sdk/*` as external — Lambda runtime ships AWS SDK v3. Bundle `postgres`,
`drizzle-orm`, `hono` inline.

### DB client

```ts
// src/db/client.ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const client = postgres(DATABASE_URL, {
  ssl: isLocal ? false : "require",
  max: 1, // correct for Lambda: one connection per container
  idle_timeout: 20,
  connect_timeout: 10,
});
export const db = drizzle(client, { schema });
```

**`max: 1` is not a typo.** Each Lambda container invocation gets one
connection. Anything higher leaks connections on reuse and exhausts Neon's
pool.

### Lambda handler

```ts
// src/lambda.ts
import { handle } from "hono/aws-lambda";
import { app } from "./app.js";
export const handler = handle(app);
```

### Local dev

`scripts/dev.sh` starts a docker Postgres + the backend with Hono's Node
adapter. Seed a `.env` from `.env.example` using a randomly generated
`SESSION_SECRET` (32+ bytes).

**Ship `/health` and `/health/db` routes from day one.** You will use them
100 times to triangulate deploy failures.

---

## Phase 4 — Shared types (`packages/shared`, 5 min)

```json
{
  "name": "@<slug>/shared",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

Export any API request/response type here. Both apps import from it.
Avoid duplicate `WatchlistItem` definitions — subtle drift will bite.

---

## Phase 5 — Mobile (`apps/<slug>`, 30 min)

### ⚠️ SDK 55 + Expo Go incompatibility

**At time of writing, the Expo Go app in the App Store does NOT support
SDK 55+.** Scanning a Metro QR code with App Store Expo Go produces:
_"Project is incompatible with this version of Expo Go."_

**Pick one:**

- **(A) Use the latest SDK that App Store Expo Go supports** (usually one
  behind cutting-edge). Check [docs.expo.dev/versions](https://docs.expo.dev/versions/latest/) for the current one. Easier dev loop (scan QR, live-reload from
  Metro), no native builds during dev.
- **(B) Commit to the latest SDK and build a Development Client or
  TestFlight build upfront.** Phone streams from Metro via your own
  compiled client, not Expo Go. ~15-20 min build up front, then it works
  forever. This is the right call for anything serious.

**Don't promise the user "Expo Go + scan the QR" without verifying SDK
support first.** That's a 5-min question that saves ~20 min of confusion.

### Required native deps

If you use ANY of these, explicit peer deps matter:

| If you use...                | You also need                                                                            | Why                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `react-native-reanimated@4+` | `react-native-worklets`                                                                  | Split out in RN-Reanimated 4.x. `pod install` fails without it. |
| `expo-secure-store`          | nothing extra                                                                            | Works on iOS via Keychain.                                      |
| `expo-router`                | `react-native-screens`, `react-native-safe-area-context`, `react-native-gesture-handler` | All handled by `npx expo install`                               |

**Always run `npx expo install <dep>` instead of `pnpm add <dep>`** — Expo
picks the SDK-compatible version. Then do `npx expo install --check` to
verify all installed versions match the SDK.

### app.json landmines

- **SDK 55+**: DO NOT put `newArchEnabled: true` at the root. It's the
  default now, and expo-doctor rejects it as an unknown field, which
  causes EAS Build to warn and _sometimes_ fail before `pod install`.
  Remove it.
- `scheme: "<slug>"` — picked up by expo-router for deep links.
- `runtimeVersion: { "policy": "appVersion" }` — this governs which OTA
  updates are compatible with which builds. If you bump `expo` or
  `react-native` major versions, bump `version` in app.json too, or your
  new OTA won't deliver to old native builds. (SDK 55 default — keep.)
- `updates.url: "https://u.expo.dev/<expo-project-id>"` — fill in after
  `eas init`.
- `ios.infoPlist.ITSAppUsesNonExemptEncryption: false` — set this up
  front. You're sending HTTPS + using Keychain; both are exempt under
  Apple's encryption-export rules. Omitting this means every TestFlight
  submit asks about encryption.

### eas.json

Use this shape exactly:

```json
{
  "cli": { "version": ">= 12.0.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "ios": { "simulator": false }
    },
    "production": {
      "autoIncrement": true,
      "channel": "production",
      "env": {
        "EXPO_PUBLIC_API_URL": "<prod API URL, filled in Phase 7>"
      }
    }
  },
  "submit": {
    "production": {
      "ios": {
        "ascAppId": "<app store connect app id>",
        "appleTeamId": "<team id>"
      }
    }
  }
}
```

The `env` on the `production` profile is **load-bearing**. Without it, the
first TestFlight build launches, hits `http://localhost:8787` from the
`app.json` `extra.apiUrl` default, and fails before the first OTA
downloads.

### Config reading (`src/config.ts`)

```ts
import Constants from "expo-constants";

export function getApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  if (extra?.apiUrl) return extra.apiUrl.replace(/\/$/, "");
  throw new Error("No API URL configured");
}
```

### OTA auto-apply (SDK 55 API — don't use the old one)

In your root `_layout.tsx`:

```tsx
import * as Updates from "expo-updates";

function useApplyOtaUpdatesOnArrival() {
  const { isUpdatePending } = Updates.useUpdates();
  useEffect(() => {
    if (isUpdatePending) Updates.reloadAsync().catch(() => {});
  }, [isUpdatePending]);
}
```

**Do NOT write** `Updates.addListener` / `Updates.UpdateEventType` — that's
the SDK ≤52 API. SDK 55+ removed it. Type errors will surface; don't try
to "fix" them by adding `any` — the hook approach is the only valid one.

### Metro config (`metro.config.js`)

Monorepo-aware config. Expo-doctor will warn about
`resolver.disableHierarchicalLookup` — ignore it; that's the pnpm
workaround and is correct.

```js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../..")];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(__dirname, "../../node_modules"),
];
config.resolver.disableHierarchicalLookup = true;
module.exports = config;
```

### EAS project init

```bash
cd apps/<slug>
npx eas-cli@latest init
```

Accept the default project ID. This writes `extra.eas.projectId` into
`app.json` and creates the project on expo.dev.

---

## Phase 6 — Infra (`infra/`, 25 min)

### File layout

```
infra/
  versions.tf           # terraform + provider versions + HCP cloud backend
  providers.tf          # aws provider with default_tags, data sources
  variables.tf          # ses_verified_email, budget_email_recipient, database_url (sensitive), sending_domain, github_repository
  locals.tf             # { project, env, prefix } — prefix = "${project}-${env}"
  outputs.tf            # api_url, github_actions_role_arn, lambda_function_name, db_url_ssm_param, cloudwatch_log_group
  ses.tf                # domain identity + DKIM records OUTPUTTED as values
  ssm.tf                # random_password.session_secret + aws_ssm_parameter { db_url (from var), session_secret }
  lambda.tf             # placeholder zip + lambda + role + log group + lifecycle.ignore_changes for [filename, source_code_hash]
  apigateway.tf         # HTTP API + routes + integration + stage
  iam_github_oidc.tf    # OIDC provider + role + scoped inline policy
  budgets.tf            # $5/mo alert
  terraform.tfvars.example
```

### Critical IAM scoping

The CI role's inline policy needs these exact actions — tested from the
`workshop` project:

```hcl
# Lambda deploy: CI does update-function-code + wait function-updated.
# BOTH require GetFunctionConfiguration. Don't omit it.
statement {
  sid = "LambdaDeploy"
  actions = [
    "lambda:UpdateFunctionCode",
    "lambda:UpdateFunctionConfiguration",
    "lambda:GetFunction",
    "lambda:GetFunctionConfiguration",  # <- required for `lambda wait function-updated`
    "lambda:PublishVersion",
  ]
  resources = [aws_lambda_function.api.arn]
}

statement {
  sid = "ReadSecretsForMigrations"
  actions = ["ssm:GetParameter", "ssm:GetParameters"]
  resources = [
    aws_ssm_parameter.db_url.arn,
    aws_ssm_parameter.session_secret.arn,
  ]
}

statement {
  sid = "DescribeForDeployVerification"
  actions = [
    "apigateway:GET",
    "logs:DescribeLogGroups",
    "logs:FilterLogEvents",
    "logs:GetLogEvents",
  ]
  resources = ["*"]
}
```

Why narrow scoping: you'll never run `terraform apply` from CI (see
"HCP + CI philosophy" below), so the role does NOT need broad AWS perms.
Keeps blast radius small.

### ⚠️ SES: domain identity, not email identity

**Do not `aws_sesv2_email_identity` a gmail/outlook address.** The setup
succeeds but every auth email goes to spam because SPF/DKIM alignment
fails — Gmail sees a SES-sent message claiming to be `from gmail.com`,
which looks like spoofing.

Use a domain identity instead. From their registered domain (`<slug>.app`
or similar):

```hcl
resource "aws_sesv2_email_identity" "sender" {
  email_identity = var.sending_domain
}

# SES generates 3 DKIM tokens; expose them so the user can add DNS records
output "ses_dkim_records" {
  value = [for t in aws_sesv2_email_identity.sender.dkim_signing_attributes[0].tokens :
    "${t}._domainkey.${var.sending_domain} CNAME ${t}.dkim.amazonses.com"]
}
```

From the generated output, the user creates:

- 3 DKIM CNAMEs (the ones in the output)
- SPF TXT at root: `v=spf1 include:amazonses.com ~all`
- DMARC TXT at `_dmarc`: `v=DMARC1; p=none; rua=mailto:<their email>`

Update the Lambda `SES_FROM_ADDRESS` env var to
`"<AppName> <noreply@<sending_domain>>"`. Format matters — the display-name
form improves open rates and trust.

### HCP + CI philosophy (do NOT skip)

`terraform apply` runs **only from a dev laptop**, never from CI. Reasons:

1. HCP's state lock doesn't auto-release on SIGKILL (runner cancellation,
   CI timeout). Every cancelled CI job leaves a stale lock that blocks the
   next run.
2. Giving CI role terraform-scoped perms means it effectively has admin on
   the AWS account. With apply local-only, the CI role stays narrow.
3. Dev-laptop apply means you see terraform's diff in real-time and can
   ctrl-C if it's about to do something surprising. CI would just do it.

The CI `terraform` job **only runs `terraform init` + `terraform output`**
to feed the Lambda function name and API URL into downstream jobs. It
needs `TF_API_TOKEN` (for HCP state) but NOT `AWS_ROLE_ARN` (for
providers). See Phase 8 for the exact workflow shape.

### Database pattern (Neon)

Neon is external — terraform manages only the SSM parameter holding the
connection string:

```hcl
resource "aws_ssm_parameter" "db_url" {
  name  = "/${local.prefix}/db/url"
  type  = "SecureString"
  value = var.database_url  # passed in via terraform.tfvars, gitignored
}
```

Set `var.database_url` in `infra/terraform.tfvars` locally (the file
is gitignored) and as a GitHub Actions secret `DATABASE_URL` for any CI
operation that needs it.

---

## Phase 7 — First local apply (10 min, ~half waiting)

```bash
cd infra
AWS_PROFILE=<slug>-prod terraform init
AWS_PROFILE=<slug>-prod terraform apply
```

**Before proceeding, verify real resources exist** (don't trust the
"Apply complete!" summary — HCP has been known to declare success with
partial creation during lock contention):

```bash
AWS_PROFILE=<slug>-prod aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=Project,Values=<slug> \
  --query 'ResourceTagMappingList[*].ResourceARN' --output text
```

Expect ~10-14 ARNs: Lambda, API Gateway (2), SSM params, log groups, SES
identity, IAM role, OIDC provider, budget.

### Capture outputs

```bash
AWS_PROFILE=<slug>-prod terraform output -raw api_url
AWS_PROFILE=<slug>-prod terraform output -raw github_actions_role_arn
AWS_PROFILE=<slug>-prod terraform output ses_dkim_records
```

Paste to user:

1. The DKIM CNAME records for their domain registrar (they set these up in
   DNS).
2. The API URL (goes in the `eas.json` production env + a GitHub secret).
3. The role ARN (GitHub secret `AWS_ROLE_ARN`).

### SES domain verification

Have them add the 3 DKIM CNAMEs + SPF + DMARC records at their DNS host.
Verification takes 5-15 min; check with:

```bash
AWS_PROFILE=<slug>-prod aws sesv2 get-email-identity \
  --email-identity <sending_domain> \
  --query '[VerifiedForSendingStatus,VerificationStatus]'
```

Result should be `[true, "SUCCESS"]`. Until then, auth emails bounce.

### Run DB migrations against Neon

```bash
cd apps/backend
STAGE=prod \
  DATABASE_URL="<neon url from terraform.tfvars>" \
  SESSION_SECRET="dummy_session_secret_for_migrations_only_32chars" \
  SES_FROM_ADDRESS="noreply@<sending_domain>" \
  AWS_REGION=us-east-1 \
  pnpm run db:migrate
```

Verify with `psql "<neon url>" -c "\dt"`. Expect 3 tables if you're using
the standard auth schema (magic_tokens, users, watchlist_items).

---

## Phase 8 — CI/CD (`.github/workflows/`, 20 min)

### Secrets to set upfront (before first push)

```bash
echo -n "<value>" | gh secret set <NAME> --repo <owner>/<slug>
```

| Secret                | Value                                              | Used by                                                                               |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `TF_API_TOKEN`        | HCP user API token                                 | all workflows (to read state)                                                         |
| `AWS_ROLE_ARN`        | `arn:aws:iam::<acct>:role/<prefix>-github-actions` | backend deploy                                                                        |
| `DATABASE_URL`        | Neon pooled URL                                    | (unused by CI since no `terraform apply`, but keep for future workflows that need it) |
| `EXPO_TOKEN`          | Expo CI access token                               | mobile deploys                                                                        |
| `EXPO_PUBLIC_API_URL` | API Gateway URL from tf output                     | mobile OTA (baked into the JS bundle)                                                 |

### `ci.yml` — lint/typecheck/test + terraform validate

### `deploy-backend.yml` — the shape that actually works

Three jobs: `terraform` (read outputs only), `migrate`, `deploy`. The
`terraform` job does **init only**, no `apply`, no AWS creds:

```yaml
- uses: hashicorp/setup-terraform@v3
  with:
    terraform_version: 1.14.7
    cli_config_credentials_token: ${{ secrets.TF_API_TOKEN }}
- name: terraform init
  working-directory: infra
  run: terraform init
- name: Capture outputs
  working-directory: infra
  run: |
    echo "lambda_name=$(terraform output -raw lambda_function_name)" >> "$GITHUB_OUTPUT"
    echo "api_url=$(terraform output -raw api_url)" >> "$GITHUB_OUTPUT"
    echo "db_url_param=$(terraform output -raw db_url_ssm_param)" >> "$GITHUB_OUTPUT"
```

The `migrate` job's dummy SESSION_SECRET must be **32+ chars**:

```yaml
env:
  SESSION_SECRET: dummy_for_migrate_only_not_used_padding_to_32
```

The `deploy` job uses `aws lambda update-function-code --publish` followed
by `aws lambda wait function-updated`. Both require the IAM perms called
out in Phase 6.

### `deploy-mobile.yml` — one job, EAS Update

```yaml
- working-directory: apps/<slug>
  env:
    EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
    EXPO_PUBLIC_API_URL: ${{ secrets.EXPO_PUBLIC_API_URL }}
  run: npx eas-cli@latest update --auto --branch production --message "ci: ${{ github.sha }}"
```

`--branch production` must match the `channel` in `eas.json`'s production
profile. Mismatches mean updates get published to a branch that no
installed build subscribes to.

### `testflight.yml` — manual, for native rebuilds

Manual-only (`workflow_dispatch`), since EAS Build burns free-tier quota.
Used when adding a native dep or bumping SDK. Similar install setup +
`eas-cli build --platform ios --profile production --non-interactive`.
**Requires Apple credentials cached in EAS** from a prior interactive
build (Phase 9).

### node_modules cache (in every workflow)

After `setup-node cache: pnpm`, add:

```yaml
- name: Cache hoisted node_modules
  id: nm-cache
  uses: actions/cache@v4
  with:
    path: |
      node_modules
      apps/*/node_modules
      packages/*/node_modules
    key: nm-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}

- name: Install deps
  if: steps.nm-cache.outputs.cache-hit != 'true'
  run: pnpm install --frozen-lockfile
```

Savings are modest (~10-15s per install because setup-node's pnpm store
cache already handles download). Still worth it — scales with dep count.

---

## Phase 9 — First deploys + Apple credential bootstrap (~25 min)

### Push + watch backend deploy

```bash
git push origin main
gh run watch --repo <owner>/<slug> --exit-status
```

Expected: `/health` returns `{"ok":true,...}`, `/health/db` returns
`{"ok":true,"rows":1}`. If anything fails here, **stop and fix the CI
itself** — all downstream steps assume CI works end-to-end.

### First iOS build — INTERACTIVE, user-required

This is the one unavoidable Apple 2FA session. User types in their
terminal:

```bash
cd apps/<slug>
npx eas-cli@latest build --platform ios --profile production
```

Prompts, in order:

1. _"iOS app only uses standard/exempt encryption?"_ → **Yes** (HTTPS +
   Keychain only).
2. _"Do you want to log in to your Apple account?"_ → **Yes**.
3. Apple ID → their email.
4. Apple password.
5. Apple 2FA → 6-digit code from their trusted devices.
6. _"Select a team:"_ → their team.
7. _"Generate a new Apple Distribution Certificate?"_ → **Yes**.
8. _"Generate a new Apple Provisioning Profile?"_ → **Yes**.
9. _"Push notification key?"_ → **No** (add later if needed).

EAS caches Apple creds in the macOS Keychain after this. Future
`eas build` + `eas submit` can run `--non-interactive`.

~12-15 min for the build to complete. While it runs, have the user install
the **TestFlight** app on their phone and sign in with their Apple ID.

### First submit — also INTERACTIVE first time

```bash
npx eas-cli@latest submit --platform ios --latest
```

Prompts:

1. _"Generate a new App Store Connect API Key?"_ → **Yes**. (Cached for
   every future submit.)
2. Apple login again (different cached session).
3. 2FA code.

### App Store Connect TestFlight group

After submit finishes (~5 min), user goes to [App Store Connect](https://appstoreconnect.apple.com/apps) → their app → TestFlight:

1. **Internal Testing** → **+** → create group (`dogfooders` or similar).
2. Enable "Automatic distribution" so future builds land without manual
   assignment.
3. Add themselves as a tester (pick from App Store Connect Users).
4. Assign the processed build to the group.

Within a minute, the build appears in their phone's TestFlight app → tap
Install → Open.

### First-launch verification

1. Sign-in screen appears (dark or light as designed).
2. Enter their email → they receive magic code via real SES (now in
   inbox, not spam — because you set up domain identity in Phase 6).
3. Type code → lands on home screen.
4. Create a record → force-quit app → relaunch → record persists.

**If all four work, the stack is fully operational.**

---

## Phase 10 — Validate the OTA loop (5 min)

Last check before declaring victory: ship a trivial visible change via
OTA. Change a background color, a button label, anything. Push, watch
CI, wait ~2 min, reopen the app.

With the `Updates.useUpdates()` hook in place, the change should apply
**on the first cold-start** after CI finishes (check → download →
auto-reload via `reloadAsync`). If it takes two cold-starts, the hook
didn't wire up correctly.

This is the full iteration loop going forward: `git push main` → ~2-3
min → installed phone. All production UI work lives in this loop. The
`eas build` path is only revisited when adding native deps or bumping
SDK.

---

## Pitfalls — every mistake I've seen

Each of these cost 5-15 min of debug time the first time it happened.
Check for them proactively.

| Symptom                                                           | Cause                                                 | Fix                                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| EAS build: `[Reanimated] Failed to validate worklets version`     | Missing `react-native-worklets` peer                  | `npx expo install react-native-worklets`                             |
| EAS build: `should NOT have additional property 'newArchEnabled'` | SDK 55 default                                        | Remove from `app.json`                                               |
| Expo Go: _"Project is incompatible with this version of Expo Go"_ | Latest SDK > App Store Expo Go SDK                    | Use dev client or downgrade to App Store SDK                         |
| `Updates.addListener is not a function`                           | SDK ≤52 API called on SDK 55+                         | Use `Updates.useUpdates()` hook                                      |
| Magic-code emails in spam                                         | SES email identity on a non-owned domain              | Switch to domain identity + DKIM + SPF + DMARC                       |
| CI `terraform apply` fails with "No valid credential sources"     | Missing `aws-actions/configure-aws-credentials`       | Either add it, or (recommended) move apply to dev laptop             |
| CI migrate step fails with zod "too_small"                        | `SESSION_SECRET` dummy < 32 chars                     | Pad to 32+                                                           |
| CI `lambda wait function-updated` fails AccessDenied              | Missing `lambda:GetFunctionConfiguration`             | Add to IAM policy                                                    |
| Apply hangs on state lock                                         | Prior CI kill left stale HCP lock                     | `terraform force-unlock <org>/<workspace>` or click Unlock in HCP UI |
| `aws` CLI ignores `AWS_PROFILE=` in interactive shell             | User has a shell function wrapping `aws`              | Use `command aws` to bypass                                          |
| TestFlight build opens to white screen                            | `EXPO_PUBLIC_API_URL` not baked into build            | Add to `eas.json` production profile's `env`                         |
| OTA updates don't reach phone                                     | `branch` in `eas update` ≠ `channel` in build profile | Make them match (both `production`)                                  |
| Expo-doctor warns about metro.config                              | Monorepo disableHierarchicalLookup override           | Expected — ignore                                                    |

---

## Non-obvious invariants (don't "fix" these)

- **`postgres({ max: 1 })`** in Lambda DB client. Not a bug.
- **Public API Gateway, no auth at the gateway level** — auth lives in
  Hono middleware reading a cookie. Correct for this architecture.
- **Lambda's placeholder zip returns 503** until CI replaces it. The
  `lifecycle { ignore_changes = [filename, source_code_hash] }` on the
  Lambda resource is why terraform doesn't revert CI's uploads.
- **`node-linker=hoisted` + `shamefully-hoist=true`** in `.npmrc`.
  Required for RN peer resolution.
- **`apply_immediately = true`** on RDS (if you ever use RDS). Intentional
  for prototypes; would be dangerous for production with active traffic.
- **SES sandbox mode** limits sending to verified identities until Apple
  Support opens your account for general sending. Fine for a personal
  app where all recipients are you; a blocker for real users.

---

## User-time budget (be honest with them)

Total user-active time: **~25-30 min**, across these checkpoints:

| Checkpoint                                      | Time   |
| ----------------------------------------------- | ------ |
| Phase 0 interview                               | 5 min  |
| Phase 1 account signups                         | 10 min |
| Phase 7 DNS records at registrar                | 3 min  |
| Phase 9 Apple 2FA × 2 + App Store Connect setup | 10 min |
| Phase 10 phone E2E verification                 | 3 min  |

Wall-clock: **~2 hours** assuming no pivots. Major waits you can't shrink:

- First EAS build: 12-15 min (compile + pods + sign)
- SES DNS propagation: 5-15 min
- Apple processing post-submit: 5-15 min

Anything beyond that is iteration churn — this playbook is designed to
drive it toward zero. If you find yourself ~90 min in and not at Phase 8,
stop and re-read the "verify current state before moving anything" rule
at the top. You've probably skipped a verification and are now debugging
three phases downstream.

---

## Things you (the agent) can and can't do

### Can do without user:

- Write / edit all source code
- Run terraform (once user has SSO'd into their account and passed you
  the profile name)
- Kick off non-interactive `eas` commands (post-first-build)
- Poll Gmail via the MCP Gmail tool for SES/TestFlight email receipts
- Clean up SES domain verification by `aws sesv2 get-email-identity`

### Cannot do without user:

- Register accounts (Neon, HCP, Expo, domain registrar, GitHub)
- Interactive Apple 2FA (required for first `eas build` and first
  `eas submit`)
- Add DNS records at their registrar
- Physically install TestFlight on their phone
- Click "Install" on the TestFlight app
- Create App Store Connect testing groups (web UI)

### Should never do:

- Commit without `pnpm run typecheck && pnpm run lint && pnpm run test`
  passing locally
- Push to main without having watched the previous push succeed
- `terraform destroy` against anything containing user data without
  explicit per-session authorization (not just a line in a handoff)
- Cache an `AWS_PROFILE=<profile>` assumption across Bash calls — working
  directory and profile resets between tool calls
- Claim an OTA deploy works without verifying the change appeared on a
  real phone
