# workshop — coding agent guide

Read this before editing. Every line earns its place: this file is loaded into every
session, so we keep it to what applies repo-wide. Area-specific gotchas live in nested
`CLAUDE.md` files; lookup-only tables live in `docs/`.

## Authority map — what to trust where

**Canon** (source of truth about how the system works today):

- `CLAUDE.md` (this file) — repo-wide directives
- `apps/workshop/CLAUDE.md` — Expo / RN-web / iOS gotchas
- `apps/backend/CLAUDE.md` — Hono + Drizzle patterns, soft-delete invariants
- `infra/CLAUDE.md` — Terraform deploy pipeline, AWS access
- `functions/CLAUDE.md` — Cloudflare Pages Functions, OG previews
- `docs/decisions.md` — architectural constraints and the reasoning behind them
- `docs/recovery-runbook.md` — flat "symptom → fix" lookup
- `docs/admin-runbook.md` — commands that need admin credentials
- `docs/ios-deploy-pipeline.md` — iOS deploy diagnosis + recovery
- `docs/manual-setup.md` — one-time external account setup
- `README.md` — human onboarding (clone → run → deploy)

**Not canon** (useful context, but don't treat as truth about current state):

- `docs/plans/` and `docs/*-plan.md` / `docs/*-spec.md` — design intent, may be ahead
  of or behind reality
- `AGENT-REFLECTIONS.md` — open-issues queue for environment friction (intent, not
  state)

## Self-healing docs

`CLAUDE.md` files, `README.md`, and `AGENT-REFLECTIONS.md` are living docs. Every agent
leaves them more accurate than they found them — add what would have saved ≥5min, edit
what misled you, delete what's no longer true.

- **`CLAUDE.md` files** — operational directives for agents. Place a gotcha at the
  most specific directory that fully owns it; it moves up only when it applies
  repo-wide. When you ship code that retires a gotcha, delete the bullet in the same
  PR.
- **`README.md` files** — human onboarding. Agent-only notes go in `CLAUDE.md`.
- **`AGENT-REFLECTIONS.md`** — open-issues queue for friction you couldn't fix in the
  current PR. Not a diary. One issue per entry, deleted in the PR that retires it.

## Universal directives

These apply repo-wide; everything else lives in a nested `CLAUDE.md`.

- **No secrets in repo.** DB password, session secret, DATABASE_URL, OAuth audiences,
  API keys — all in SSM Parameter Store, read via OIDC in CI. `terraform.tfvars` and
  `.env` are gitignored.
- **Verify before pushing**: `pnpm run typecheck && pnpm run test && pnpm run lint`.
  CI runs the same plus `pnpm run knip`, `terraform fmt -check`, `actionlint`.
- **Share types in `@workshop/shared`.** No manually-duplicated interfaces between
  backend and client.
- **Drizzle migrations**: from `apps/backend/`,
  `pnpm run db:generate -- --name=descriptive_name`. Always pass `--name`. Commit all
  generated files in `drizzle/` and `drizzle/meta/`.
- **`JSON.parse` and `Response.json()` return `unknown`** (ts-reset is enabled).
  Validate with zod or a type guard. Don't blind-cast.
- **Biome auto-formats on pre-commit** via lefthook (`--write` with `stage_fixed:
true`). Tools like `eas-cli` reformat `app.json` — run `pnpm run lint:fix` after.
  Gitleaks runs locally if installed; CI enforces regardless.
- **Dependency upgrades go through Dependabot.** Don't manually bump npm / Actions /
  Terraform deps unless there's a specific reason (security fix, unblocking work).
- **Logger**: use `logger` from `apps/backend/src/lib/logger.ts`. Pass the full error
  object, not `error.message` (loses the stack).

## Editing GitHub Actions workflows

1. **SHA-pin every `uses:`** (`owner/repo@<40-char-sha> # v4`). Fresh SHA:
   `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`.
2. **Never interpolate `${{ … }}` inside a `run:` block** — hoist into step `env:` and
   read as `$VAR`. actionlint enforces both.
3. **`permissions:` blocks aren't least-privilege by default.** `permissions: contents:
read` matches the push-event default but blocks PR metadata. Actions needing PR data
   (`dorny/paths-filter`, label/comment on PR) need explicit `pull-requests: read`.
   Failure is opaque (`"Resource not accessible by integration"`) and not caught by
   actionlint.
4. **Workflow path-filter self-trigger**: if a workflow's `on.push.paths:` includes its
   own filename, any PR touching the workflow file fires it on `main` post-merge even
   if no other path matched.
5. **Docs-only PRs need a required-check shim.** `ci.yml` has
   `paths-ignore: **/*.md` / `docs/**`, but branch protection still requires the
   `Quality (...)` check. `.github/workflows/ci-docs.yml` emits the same job names as
   trivial successes on the inverse path set. If you add a new required check to
   `ci.yml`, add a matching no-op job to `ci-docs.yml`. If you add a new
   `paths-ignore` entry, mirror it as a `paths` entry in `ci-docs.yml`.

## CORS `allowMethods` is a whitelist in three places — update all three

This is cross-cutting; the verb has to be added everywhere it's checked.

1. Hono's `cors()` in `apps/backend/src/app.ts`.
2. API Gateway's `cors_configuration.allow_methods` in `infra/apigateway.tf` — API
   Gateway answers OPTIONS at the edge before Lambda sees them, so a missing verb here
   silently breaks the preflight regardless of Hono.
3. `apiRequest`'s `method` union in `apps/workshop/src/lib/api.ts`.

Verify:

```bash
curl -X OPTIONS \
  -H "Origin: https://workshop-a2v.pages.dev" \
  -H "Access-Control-Request-Method: PUT" \
  <api>/v1/whatever -i
```

## Merging to `main`

Auto-merge is on. `main` requires four checks:

- `Quality (lint, typecheck, test, knip, format, terraform, actionlint)` — always
  runs.
- `Mobile Metro bundle` — runs on `apps/workshop/**`, `packages/shared/**`, or
  `pnpm-lock.yaml` changes; skipped (treated passing) otherwise. Catches RN/Expo SDK
  drift.
- `Migrate smoke (fresh DB + idempotent re-run)` — runs on `apps/backend/drizzle/**`,
  `apps/backend/src/db/**`, or `pnpm-lock.yaml` changes; skipped (treated passing)
  otherwise. Catches Drizzle journal-vs-files drift before prod.
- `terraform plan` — always runs on PRs. Exit 2 (changes detected) is success; only
  exit 1 (HCL error, IAM 403) fails. Runs with `-refresh=false` and the narrow plan
  role; the role has `ssm:GetParameter*` on `/workshop-prod/*`. A new `data` source on
  a non-SSM resource the plan role can't read WILL fail plan — expand the role in the
  same PR or split.

Canonical merge: `gh pr merge <PR> --auto --squash --delete-branch`. Verify with
`gh pr view <PR> --json state` — armed ≠ merged. Updating the required-check list is a
GitHub admin action (Settings → Branches); keep the bullets above in sync.

**If your PR adds a new CI check that should block merge, flag it in the PR
description.** Agents can't toggle branch protection (the Niteshift GH App token 403s
on that endpoint). Without a human ticking the box, a "should-be-required" check is
silently optional. End the PR description with an "After merge" section telling the
user exactly what to add and why.

## Risk tiers

- **Safe** (just push): new routes, new Expo screens, new Drizzle columns with
  defaults, new tests/scripts, `infra/` changes whose PR plan matches expectations.
- **Careful** (read PR-time plan first): destructive `infra/` changes (resource
  recreation, IAM edits, deleting SSM params); rotating `database_url`.
- **Ask first**: deleting DB data; changing Lambda runtime major; rotating OIDC
  provider; expanding `tf-apply` perms or trust policy; adding a new AWS service;
  touching anything in a different AWS account.

Admin-command authorization tiers (auto-allowed / always-confirm / prohibited):
`docs/admin-runbook.md`.

## Debugging production — entry points

```bash
AWS_PROFILE=workshop-prod ./scripts/logs.sh --since 10m --filter error   # Lambda errors
AWS_PROFILE=workshop-prod ./scripts/logs.sh --filter "<request_id>"      # one request
AWS_PROFILE=workshop-prod ./scripts/db-connect.sh                         # psql into Neon

cd infra && AWS_PROFILE=workshop-prod terraform output                    # api_url, lambda_name, …

curl -fsS $(cd infra && AWS_PROFILE=workshop-prod terraform output -raw api_url)/health
```

Preset CloudWatch Insights queries: `./scripts/log-analytics.sh {by-platform,by-user,
top-paths,errors,slow,user <user-id>}`. Detail in `apps/backend/CLAUDE.md`.

## Dev logs

`pnpm dev` tees output to `/tmp/workshop-dev.log` (override with `WORKSHOP_DEV_LOG`).
In the Niteshift sandbox the same output goes to `$NITESHIFT_LOG_FILE`. **First place
to look when something isn't working.**

```bash
tail -f /tmp/workshop-dev.log
grep -iE "error|warn" /tmp/workshop-dev.log
grep "<request_id>" /tmp/workshop-dev.log       # trace one request
```
