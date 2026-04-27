# workshop — coding agent guide

Read this before editing anything. Also read `docs/decisions.md` for the constraints behind the
design, `docs/recovery-runbook.md` when something is broken (flat symptom → fix lookup), and
check `docs/plans/HANDOFF.md` if it exists — it describes in-flight setup work that may not be
complete.

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
- **EAS Update** for JS-only OTA updates to iPhones within ~60s of merge. TestFlight builds
  auto-trigger on merge when `@expo/fingerprint` detects a native change (new native dep, config
  plugin, bundle id, etc.) and use `eas build --no-wait --auto-submit` so the build + submit
  happen entirely on EAS infra (no GH Actions polling time). Manual dispatch with `force=true`
  bypasses the fingerprint check. Last-built fingerprint is stored as a git tag (`ios-fp-<hash>`),
  written on successful enqueue (see iOS deploy pipeline section for the trade-off).
- **Tooling baseline**: Biome (lint + format), Vitest, Zod (for API-boundary validation),
  `@total-typescript/ts-reset` (globally enabled), knip (unused code/deps), lefthook (pre-commit),
  actionlint + gitleaks in CI. Dependabot opens aggressively-grouped npm/Actions/Terraform PRs
  monthly on the first Monday (~3 PRs/month total — combined into native/aws-sdk/tooling for
  npm, single grouped PRs for Actions and Terraform). `.mise.toml` pins node, pnpm, terraform, actionlint, gitleaks — `mise install` gets
  you the exact versions CI uses.

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
- **Pre-commit auto-formats via lefthook**. Biome runs `--write` on staged files with
  `stage_fixed: true`, so if a commit includes tweaks to a file you didn't explicitly edit,
  that's the hook — not a bug. Gitleaks is wired too but skips silently when the binary isn't
  installed locally; CI enforces regardless.
- **`JSON.parse` and `Response.json()` return `unknown`** (ts-reset is enabled via `reset.d.ts`
  in each package). Validate with zod — see `apps/backend/src/lib/session.ts` for the pattern —
  or narrow with a type guard. Blind `as T` casts without runtime checks are a footgun; agents
  have already hit this once.
- **Editing GitHub Actions workflows** — two CI-blocking rules enforced by actionlint:
  (1) SHA-pin every `uses:` (`owner/repo@<40-char-sha> # v4`); fetch fresh SHAs with
  `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`. Dependabot rolls them forward monthly.
  (2) Never interpolate `${{ … }}` inside a shell `run:` block — hoist into the step's `env:`
  and read as `$VAR` in bash. Both patterns are visible throughout `.github/workflows/*`.
- **Workflow path-filter self-trigger** — if a PR modifies a workflow file and that
  workflow's own `on.push.paths:` includes its own filename (e.g. `testflight.yml` lists
  `.github/workflows/testflight.yml` as a path), the merge commit will trigger that
  workflow on `main` even if no other paths matched. Hit this 2026-04-27: a PR primarily
  targeting `ci.yml` also touched `testflight.yml` (just to add a step-summary annotation),
  and the merge inadvertently spun up a real TestFlight run. The behavior is intentional
  (you usually want to test a workflow change against the workflow itself), but worth
  checking when a PR's diff spans multiple workflow files.
- **iOS capabilities are config-as-code.** When adding an iOS capability (App Groups,
  Push Notifications, Associated Domains, etc.), declare it in `apps/workshop/app.json`
  (`ios.entitlements`) or via an Expo config plugin **before** enabling it in the Apple
  Developer portal. EAS Build's capability sync silently reverts any portal-only changes
  on the next build, so a manual portal toggle without a matching code declaration is
  drift waiting to happen. Currently declared: Sign In with Apple (via the
  `expo-apple-authentication` plugin).
- **GitHub Actions `permissions:` blocks aren't least-privilege by default** — `permissions:
contents: read` _replicates_ GitHub's default for push events, doesn't restrict it. Any new
  action that needs PR metadata (e.g. `dorny/paths-filter`, label-on-PR, comment-on-PR) needs
  an explicit grant like `pull-requests: read`. Failure mode is opaque at runtime
  (`"Resource not accessible by integration"`) and isn't caught by `actionlint`.
- **Auto-merge requires GitHub Pro on private repos.** `gh pr merge --auto` is the cleanest
  pattern for autonomous agents (skill-driven Niteshift sessions, etc.) — it queues the merge
  to fire when checks pass. But on a private repo on the free GitHub plan, branch protection
  is unavailable, and auto-merge requires branch protection. So the gh command fails with
  `"Auto merge is not allowed for this repository"`. The `/continue-redesign` skill falls back
  to manual merge cleanly. To unlock auto-merge: make the repo public (free) OR upgrade to
  Pro (\$4/mo). Worth it if rate-of-PR-merges is high enough; not currently.
- **Dependency upgrades go through Dependabot.** Don't manually bump npm/Actions/Terraform deps
  unless there's a specific reason (security fix, unblocking work). Monthly PRs on the first
  Monday, aggressively grouped.
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

The Lambda reads `STAGE`, `DATABASE_URL`, `SESSION_SECRET`, `APPLE_BUNDLE_ID`,
`APPLE_SERVICES_ID`, `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_WEB_CLIENT_ID`, `TMDB_API_KEY`,
`GOOGLE_BOOKS_API_KEY`, `LOG_LEVEL` from env vars set by Terraform. If behavior seems wrong,
`aws lambda get-function-configuration` shows what's actually running.

## iOS deploy pipeline

The iOS pipeline has more moving parts than the backend, and the failure modes
need different recovery paths. Read this before trying to debug a TestFlight
problem — the wrong fix at the wrong layer wastes EAS build minutes (free-tier:
30/month).

### The four layers

```
Apple Developer Portal  ←→  EAS Build infrastructure  ←→  GitHub Actions  ←→  Code/config
```

- **Apple Developer Portal** owns identifiers, capabilities, certificates, profiles. Manual
  config that EAS reflects/syncs.
- **EAS Build/Submit** runs the actual iOS build on Apple Silicon, signs with the certs/profiles
  it manages, then submits the IPA to App Store Connect for TestFlight processing.
- **GitHub Actions** orchestrates: computes fingerprint, calls
  `eas build --no-wait --auto-submit` (fire-and-forget), tags the fingerprint immediately on
  successful enqueue. The actual build + TestFlight submit run on EAS infra; GH Actions does
  not poll. Lives in `testflight.yml`.
- **Code/config** is what EAS Build packages: `app.json` plugins/entitlements, `eas.json` build
  profile, source code.

### Fire-and-forget enqueue model

`testflight.yml` uses `eas build --no-wait --auto-submit`. The workflow exits in ~1–2 minutes
once EAS accepts the job; the build (~30 min) and TestFlight submit (~5 min) happen entirely
on EAS infra. This avoids burning ~400–500 GH Actions minutes/month on polling.

Fingerprint tag (`ios-fp-<hash>`) is written **immediately on successful enqueue**, not after
build success. Trade-off: if the build or submit fails on EAS's side, the fingerprint stays
tagged — the next push with the same fingerprint won't auto-rebuild. Manual recovery:

```bash
git tag -d ios-fp-<hash>
git push origin :refs/tags/ios-fp-<hash>
gh workflow run testflight.yml --ref main --field force=true
```

This is a deliberate trade — EAS-side failures are rare and the alternative (polling-wait or
webhook-driven tagging) costs either Actions minutes or operational complexity.

- **Build failures** are usually code, signing, or capability mismatches. The provisioning
  profile got out of sync with the App ID's capabilities; an entitlement was added in
  `app.json` but EAS hasn't seen it yet; a native dep got bumped past the SDK. Recovery:
  fix the underlying issue, delete the stale tag (above), push.
- **Submit failures** are usually Apple/EAS infrastructure transients. App Store Connect
  was 5xxing; the EAS free-tier submission worker pool was exhausted ("Failed to create
  worker instance"); a network blip mid-upload. Recovery: from the EAS dashboard, click
  "Resubmit" on the failed submission — it reuses the existing IPA, no rebuild needed. EAS
  handles internal retries already; manual retry is rarely required.

If the actual built IPA is fine but Apple/EAS won't accept it, **bypass entirely**: download
the IPA from the EAS build details page and upload directly via `xcrun altool`:

```bash
read -s "ASP?Paste app-specific password: " && echo "" && \
  xcrun altool --upload-app --type ios -f ~/Downloads/workshop.ipa \
    -u joshlebed@gmail.com -p "$ASP" && unset ASP
```

Generate the app-specific password at <https://appleid.apple.com> → Sign-In and Security →
App-Specific Passwords. The IPA hits App Store Connect in ~2 minutes; appears in TestFlight
~10 minutes later. This is the fastest path when the EAS submit queue is congested.

### EAS capability sync semantics

EAS reflects Apple Developer Portal capability state from your code, **one-way**:

- Capability declared in code (via `app.json` `ios.entitlements` or via an Expo config plugin)
  → EAS enables it in the portal on the next build.
- Capability enabled in the portal **but not declared in code** → EAS _disables_ it on the
  next `eas credentials` or build.

Practical implication: any capability you toggle directly in the Apple Developer Portal will
get reverted unless you also declare it in code. Currently declared:

- **Sign In with Apple** — via the `expo-apple-authentication` plugin in `app.json`.

Phase 4's share extension will declare **App Groups** (`group.dev.josh.workshop`) via a config
plugin. The App Group identifier was registered in the Apple portal during this session as
preventive setup — but the _capability_ on the App ID was auto-disabled by EAS sync because
no code declaration exists yet. That's expected and self-corrects when Phase 4 ships.

### Capability changes invalidate provisioning profiles

When you toggle a capability on an App ID (e.g. enabling Sign In with Apple, App Groups,
Push Notifications), Apple invalidates existing provisioning profiles. EAS _should_ detect
this and regenerate, but doesn't always. Symptom: TestFlight build fails with
`"Provisioning profile ... doesn't include the <foo> capability"`.

Recovery:

```bash
cd apps/workshop && npx eas-cli@latest credentials --platform ios
# → production
# → Build Credentials: Manage everything needed to build your project
# → Provisioning Profile: Delete one from your project
# → confirm
```

Then trigger a fresh build (`gh workflow run testflight.yml --ref main --field force=true`).
EAS sees the missing profile, regenerates it with the current capabilities, and the build
succeeds.

### ASC API key role scoping

EAS auto-creates an App Store Connect API key for the **submit** step the first time you
submit (it shows in `eas credentials -p ios` as `[Expo] EAS Submit ...`). That key is _not_
automatically usable for the **build** step's credential operations (regenerating provisioning
profiles non-interactively in CI). Without a build-side key registered, CI fails with
`"In order to configure your Provisioning Profile, authentication with an ASC API key is
required in non-interactive mode."`

The fix is registering an ASC API key for build via:

```bash
npx eas-cli@latest credentials --platform ios
# → production → App Store Connect: Manage your API Key
# → Set up an App Store Connect API Key for your project
# → reuse the existing ADMIN-role key, or create a new one in App Store Connect
```

See `docs/manual-setup.md` §5 for the full runbook.

### GitHub Actions concurrency

`testflight.yml` uses `concurrency: testflight, cancel-in-progress: false`. This is the right
default — never abandon an in-flight EAS build minute by cancelling it for a new push. But it
becomes a hostage-taker when the in-flight run is stuck (Apple outage, EAS submit queue
exhaustion). New runs queue behind the stuck one and pile up.

Recovery when stuck: cancel the stuck run with `gh run cancel <run-id>`. This frees the
GitHub Actions runner and the concurrency lock; the queued runs proceed. The EAS build itself
keeps running on EAS's servers regardless — cancelling the workflow only stops the GitHub
runner from waiting for it.

### When to bypass CI entirely

Roughly: if the IPA itself is correct (build succeeded on EAS) but downstream is broken
(submit queue contention, App Store Connect 5xx, etc.), **bypass** with `xcrun altool`.
Don't keep retrying the workflow — it'll keep getting stuck on the same external issue.
The IPA URL is in the EAS build details page (`https://expo.dev/accounts/joshlebed/projects/workshop/builds`).

---

## Sources of truth — where each piece of state lives

This map lives here because state is scattered across many systems and an agent
otherwise has to re-derive "where do I look for X?" every session.

| System                      | URL                                                                                    | What it owns                                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EAS dashboard**           | <https://expo.dev/accounts/joshlebed/projects/workshop>                                | iOS build history + IPAs, submission queue status, fingerprint tags, EAS Update channels, monthly build-minute quota                                                      |
| **App Store Connect**       | <https://appstoreconnect.apple.com>                                                    | TestFlight builds, app metadata, App Store listings, ASC API keys                                                                                                         |
| **Apple Developer Portal**  | <https://developer.apple.com/account/resources/identifiers/list>                       | App IDs, capabilities, App Groups, provisioning profiles, signing certificates                                                                                            |
| **Google Cloud Console**    | <https://console.cloud.google.com/apis/credentials?project=workshop-494616&authuser=1> | OAuth client IDs (iOS, web), API keys (Books), enabled APIs                                                                                                               |
| **TMDB**                    | <https://www.themoviedb.org/settings/api>                                              | TMDB v3 API key (movies/TV enrichment)                                                                                                                                    |
| **AWS SSM Parameter Store** | `aws ssm describe-parameters` (region us-east-1, prefix `/workshop-prod/`)             | Lambda env values (DATABASE_URL, OAuth audiences, API keys); `lifecycle { ignore_changes = [value] }` so direct `put-parameter --overwrite` doesn't drift Terraform state |
| **HCP Terraform**           | <https://app.terraform.io/app/josh-personal-org/workspaces/workshop-prod>              | All AWS infra state (Lambda, IAM, SSM resources, API Gateway, etc.)                                                                                                       |
| **Cloudflare Pages**        | <https://dash.cloudflare.com/?to=/:account/pages/view/workshop>                        | Web build env vars (the `EXPO_PUBLIC_*` audience values), build logs, production URL `workshop-a2v.pages.dev`                                                             |
| **GitHub Actions**          | <https://github.com/joshlebed/workshop/actions>                                        | CI workflow runs, deploy workflow runs, fingerprint tags (as git tags)                                                                                                    |
| **Neon**                    | (managed; connection string in SSM `/workshop-prod/db/url`)                            | Production Postgres data                                                                                                                                                  |

If you need to **change** something, change it in the system listed above. If you need to
**read** the current value, read it there too — don't trust caches in code or Terraform that
might be stale.

---

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
  anything in a _different_ AWS account than Workshop's.

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

### Dev logs — `/tmp/workshop-dev.log` (local) or `$NITESHIFT_LOG_FILE` (sandbox)

When running `pnpm dev` locally, all output is tee'd to `/tmp/workshop-dev.log` (override with
`WORKSHOP_DEV_LOG=...`). The terminal copy keeps ANSI colors; the file copy is plain text so grep
and agents can read it directly. **This is the first place to look when something isn't working.**

```bash
tail -f /tmp/workshop-dev.log
grep "magic code" /tmp/workshop-dev.log         # local sign-in codes
grep -iE "error|warn" /tmp/workshop-dev.log
grep "<request_id>" /tmp/workshop-dev.log       # trace a single request
```

**Inside the Niteshift sandbox**, `pnpm dev` isn't what runs — `~/.niteshift/niteshift-setup.sh`
starts backend + web via `concurrently` directly, and dev output lands in `$NITESHIFT_LOG_FILE`
(`/root/.niteshift/task-<task_id>.log`) alongside harness output. Same `[backend]` / `[web]`
prefixes, same grep patterns:

```bash
grep "magic code" "$NITESHIFT_LOG_FILE" | tail -1   # sandbox sign-in codes
grep -iE "error|warn" "$NITESHIFT_LOG_FILE" | tail -50
grep "^\[backend\]" "$NITESHIFT_LOG_FILE" | tail -50
```

### Known sandbox gotcha: CORS preflight via the preview proxy

The Niteshift preview proxy (`https://ns-<port>-<id>.preview.niteshift.dev`) rejects
unauthenticated CORS OPTIONS preflights with `403`, which breaks any POST/PATCH/DELETE from a
browser whose origin differs from the backend's. `/.env.setup` pre-sets `EXPO_PUBLIC_API_URL` to
the 8787 preview URL, so the web bundle would otherwise bake that in. `apps/workshop/src/config.ts`
works around this by deriving the API URL from `window.location` on web (localhost stays on
localhost; a `ns-<port>-<id>` preview host rewrites to the matching `ns-8787-<id>` host). Keep that
derivation in place or agent-browser (and any sandbox-local browser) won't be able to sign in.

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
pnpm run knip          # ~2s — non-blocking in CI while the baseline is tuned; known findings
                       # include expo-splash-screen, @types/aws-lambda, closeDb, etc.
cd infra && terraform fmt -check -recursive && terraform validate
```
