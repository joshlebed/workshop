# workshop — coding agent guide

Read this before editing. Also: `docs/decisions.md` for constraints, `docs/recovery-runbook.md`
for flat symptom → fix lookup, and `docs/plans/HANDOFF.md` if it exists (in-flight setup).

## Self-healing agent docs

`CLAUDE.md`, `README.md`, and `AGENT-REFLECTIONS.md` are living docs. Every agent leaves them
more accurate than they found them — add what would have saved ≥5min, edit what misled you,
delete what's no longer true.

- **`CLAUDE.md`** — gotchas, footguns, non-obvious constraints. One tight paragraph each.
  When you ship code that retires a gotcha, delete the bullet in the same PR.
- **`README.md`** — human onboarding (clone → run → deploy). Agent-only notes go in CLAUDE.md.
- **`AGENT-REFLECTIONS.md`** — open-issues queue for environment/tooling friction you couldn't
  fix in the current PR. Not a diary. One issue per entry, deleted in the PR that retires it.

## What this repo is

Personal monorepo. iOS app (`apps/workshop`, published as **Workshop.dev**) is an umbrella for
small products — first feature is **watchlist** (movie tracker). New features land as routes.

## Stack at a glance

- **pnpm workspaces** (`apps/*`, `packages/*`), hoisted node_modules for Expo (see `.npmrc`).
  Expo SDK 55, RN 0.83.6 — `npx expo install --check` before bumping mobile deps.
- **Expo (React Native) + expo-router + TypeScript**. Bundle id `dev.josh.workshop`,
  EAS project `@joshlebed/workshop`.
- **Hono on AWS Lambda + API Gateway HTTP API**, PostgreSQL on **Neon**, Drizzle ORM with
  `postgres-js`. DB URL lives in SSM → Lambda env.
- **Terraform** for infra. HCP Terraform state, org `josh-personal-org`, workspace
  `workshop-prod`, Local execution. Auto-applied by CI on merge to `main`.
- **GitHub Actions** CI/CD, OIDC to AWS. Secrets: `TF_API_TOKEN`, `AWS_ROLE_ARN`,
  `AWS_ROLE_ARN_TF_APPLY`, `NITESHIFT_EXTERNAL_ID`, `EXPO_TOKEN`, `EXPO_PUBLIC_API_URL`,
  `ASC_API_KEY_CONTENT`/`ASC_API_KEY_ID`/`ASC_API_ISSUER_ID` (provision via
  `pnpm setup:asc-key`, see manual-setup.md §5), `DISCORD_NOTIFY_WEBHOOK_URL` (testflight
  failure pings to `#workshop-admin`).
- **EAS Update** for JS-only OTA (~60s after merge). TestFlight builds trigger on native
  change via `@expo/fingerprint`; `testflight.yml` runs `eas build --auto-submit` and
  **awaits the build** so CI red/green matches EAS outcome. Last-built fingerprint stored
  as `ios-fp-<hash>` git tag, written only on success — created via the GitHub **refs API**
  (`gh api .../git/refs`), not `git push`. The build job's checkout is shallow, so a
  `git push origin <tag>` re-sends the commit's tree (incl. `.github/workflows/*` blobs); if
  a workflow file changed on `main` after the build started, GitHub rejects the push
  ("refusing to allow a GitHub App to create or update workflow … without `workflows`
  permission") — the Actions token can't hold that scope. Creating a ref to an existing SHA
  sends no blobs. Runtime-version policy is `appVersion` (see iOS deploy pipeline).
- **Tooling**: Biome (lint+format), Vitest, Zod (boundary validation), `@total-typescript/ts-reset`,
  knip, lefthook, actionlint, gitleaks. Dependabot monthly (first Monday), aggressively grouped.
  `.mise.toml` pins node/pnpm/terraform/actionlint/gitleaks — `mise install` gets CI's versions.

## AWS

- **Account**: see `infra/terraform.tfvars` (gitignored). Org `o-m515tekbvf`. Region us-east-1.
- **Local access**: `aws sso login --profile workshop-prod`, prefix commands with
  `AWS_PROFILE=workshop-prod`.
- **CI access**: assumes `workshop-prod-github-actions` via OIDC, scoped to this repo on
  `main`, PRs, and the `production` environment.

## Conventions

- **Verify before deploying**: `pnpm run typecheck && pnpm run test && pnpm run lint`. CI runs
  the same.
- **No secrets in repo**. DB password, session secret, DATABASE_URL all in SSM Parameter Store.
  Read via OIDC in CI. `terraform.tfvars` and `.env` are gitignored.
- **Share types in `@workshop/shared`**. No manually-duplicated interfaces between backend/mobile.
- **Drizzle migrations**: from `apps/backend/`, `pnpm run db:generate -- --name=descriptive_name`.
  Always pass `--name`. Commit all generated files in `drizzle/` and `drizzle/meta/`.
- **Biome auto-formats on pre-commit via lefthook** (`--write` with `stage_fixed: true`). Tools
  like `eas-cli` reformat `app.json` — run `pnpm run lint:fix` after. Gitleaks runs locally if
  installed; CI enforces regardless.
- **`JSON.parse` and `Response.json()` return `unknown`** (ts-reset enabled). Validate with zod
  (see `apps/backend/src/lib/session.ts`) or a type guard. Don't blind-cast.
- **Editing GitHub Actions workflows**:
  1. SHA-pin every `uses:` (`owner/repo@<40-char-sha> # v4`). Fresh SHA:
     `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`.
  2. Never interpolate `${{ … }}` inside a `run:` block — hoist into step `env:` and read
     as `$VAR`. actionlint enforces both.
- **`permissions:` blocks aren't least-privilege by default** — `permissions: contents: read`
  matches GitHub's push-event default but blocks PR metadata. Actions needing PR data
  (`dorny/paths-filter`, label/comment on PR) need explicit `pull-requests: read`. Failure is
  opaque (`"Resource not accessible by integration"`) and not caught by actionlint.
- **Workflow path-filter self-trigger**: if a workflow's `on.push.paths:` includes its own
  filename, any PR touching the workflow file fires it on `main` post-merge even if no other
  path matched. Intentional but worth knowing when a PR's diff spans multiple workflow files.
- **Docs-only PRs need a required-check shim.** `ci.yml` has `paths-ignore: **/*.md`/`docs/**`,
  but branch protection still requires the `Quality (...)` check. `.github/workflows/ci-docs.yml`
  emits the same job names as trivial successes on the inverse path set. If you add a new
  required check to `ci.yml`, add a matching no-op job to `ci-docs.yml`. If you add a new
  `paths-ignore` entry, mirror it as a `paths` entry in `ci-docs.yml`.
- **iOS capabilities are config-as-code.** Declare iOS capabilities (App Groups, Push, Associated
  Domains, etc.) in `apps/workshop/app.json` (`ios.entitlements`) or via an Expo config plugin
  **before** enabling in the Apple Developer Portal. EAS's capability sync reverts portal-only
  changes on the next build. Currently declared: Sign In with Apple (via
  `expo-apple-authentication`); App Groups `group.dev.josh.workshop` (via `ios.entitlements`
  - `expo-share-intent` plugin — both are needed since the share extension also requires the
    entitlement).
- **Don't override `ios.infoPlist.CFBundleURLTypes` without re-listing the app scheme.** Once
  declared, Expo stops auto-adding the `scheme:` value. Mirror the root `scheme` ("workshop")
  into `CFBundleURLSchemes` manually. `npx expo config --type public` catches it before EAS does.
- **Share extension payloads can include both URL and text.** Preserve both when handling
  `useShareIntent()` in `_layout.tsx`; score shares often need `shareIntent.text` even when
  `shareIntent.webUrl` is also present. `/share` owns the top-level choice, `/share/pick-list`
  handles normal item adds, and `/share/pick-leaderboard` handles score posting.
- **CORS is owned by Hono — two places to update.** API Gateway has **no**
  `cors_configuration`; OPTIONS preflights fall through to Lambda so Hono can do
  dynamic origin matching (Cloudflare Pages branch previews). When adding a verb:
  update `cors()` in `apps/backend/src/app.ts` **and** the `apiRequest` `method` union
  in `apps/workshop/src/lib/api.ts`. When allowing a new web origin: extend
  `STATIC_ALLOWED_ORIGINS` / `ALLOWED_ORIGIN_PATTERNS` in `apps/backend/src/app.ts`.
  Never widen to `*` with `credentials: true`.

  Verify: `curl -X OPTIONS -H "Origin: https://workshop-a2v.pages.dev" -H "Access-Control-Request-Method: PUT" <api>/v1/whatever -i`.

- **Auto-merge is on. `main` requires four checks:**
  - `Quality (lint, typecheck, test, knip, format, terraform, actionlint)` — always runs.
  - `Mobile Metro bundle` — runs on `apps/workshop/**`, `packages/shared/**`, or
    `pnpm-lock.yaml` changes; skipped (treated passing) otherwise. Catches RN/Expo SDK drift.
  - `Migrate smoke (fresh DB + idempotent re-run)` — runs on `apps/backend/drizzle/**`,
    `apps/backend/src/db/**`, or `pnpm-lock.yaml` changes; skipped (treated passing) otherwise.
    Catches Drizzle journal-vs-files drift before prod.
  - `terraform plan` — always runs on PRs. Exit 2 (changes detected) is success; only exit 1
    (HCL error, IAM 403) fails. Runs with `-refresh=false` and the narrow plan role; the role
    has `ssm:GetParameter*` on `/workshop-prod/*`. A new `data` source on a non-SSM resource
    the plan role can't read WILL fail plan — expand the role in the same PR or split.

  Canonical merge: `gh pr merge <PR> --auto --squash --delete-branch`. Verify with
  `gh pr view <PR> --json state` — armed ≠ merged. Updating the required-check list is a
  GitHub admin action (Settings → Branches); keep the bullets above in sync.

- **If your PR adds a new CI check that should block merge, flag it in the PR description.**
  Agents can't toggle branch protection (the Niteshift GH App token 403s on that endpoint).
  Without a human ticking the box, a "should-be-required" check is silently optional. End the
  PR description with an "After merge" section telling the user exactly what to add and why.

- **Dependency upgrades go through Dependabot.** Don't manually bump npm/Actions/Terraform deps
  unless there's a specific reason (security fix, unblocking work).
- **Logger**: use `logger` from `apps/backend/src/lib/logger.ts`. Pass full errors:
  `logger.error("failed to x", { error })`, not `{ error: error.message }` (loses stack).
- **Postgres pool**: `postgres({ max: 1 })` — correct for Lambda. Each container has its own.
- **Runtime imports from `@workshop/shared` go through a subpath, not the barrel.** The barrel
  re-exports `./types.js` for backend's NodeNext resolution; Metro can't resolve those `.js`
  extensions at runtime. `import type` from the bare specifier is fine (Metro elides it); a
  value import crashes. Pure-runtime constants live in `packages/shared/src/constants.ts`,
  exported via `"./constants"`. Import with
  `import { SHARED_TYPES_VERSION } from "@workshop/shared/constants"`. Add new runtime exports
  to `constants.ts` (or another non-barrel subpath).
- **`scripts/e2e.sh` collides with running dev servers** on `:8787` and `:8081`. Kill anything
  bound to those ports first; `--kill-others-on-fail` only cleans the e2e script's own children.
- **`useColorScheme()` returns `null` on web during the first render** (before
  `prefers-color-scheme` hydrates). A naive `scheme === "dark" ? darkTokens : lightTokens`
  silently flips to light on first paint. Default to the baseline explicitly:
  `scheme === "light" ? lightTokens : darkTokens`. See `apps/workshop/src/ui/ThemeProvider.tsx`.
- **Reanimated press-feedback: wrap `Pressable`, don't replace it.**
  `Animated.createAnimatedComponent(Pressable)` looks tempting, but `Pressable`'s
  `style={({ pressed }) => [...]}` re-resolves on every render and clobbers transform
  animations on the same component. Wrap a plain `<Pressable>` inside `<Animated.View>` and
  keep press-state styling on the inner `Pressable`.
- **Don't stack `<Sheet>`s with `setA(false); setB(true)`.** Each Sheet wraps an RN `Modal`
  that stays mounted for ~220ms while its exit animation runs. Flipping the second sheet open
  during that window briefly stacks two `Modal`s — on iOS the new one registers as visible
  but never actually presents, leaving the screen non-interactable until you navigate away.
  Chain through Sheet's `onClosed` prop instead. See `apps/workshop/app/list/[id]/game/[itemId].tsx`
  for the pattern.
- **Sheet keyboard handling is centralized in `src/ui/Sheet.tsx`.** Keep the backdrop close
  target as a sibling behind the sheet content, not a parent wrapping it; iOS can otherwise
  treat taps inside a keyboard-moved form as backdrop taps and dismiss the modal. Don't wrap a
  whole sheet form in `KeyboardStickyView`; reserve sticky keyboard footers for full-screen
  forms that separate scroll content from the footer.
- **`react-native-worklets` babel plugin is auto-wired by `babel-preset-expo`.** Don't add
  `react-native-worklets/plugin` to `babel.config.js` manually — it'll run twice.
- **For animated text, use `AnimatedText` from `src/ui/Text.tsx`.** Raw `<Animated.Text>`
  strips our `variant`/`tone` props.
- **Don't spread dnd-kit's `attributes` onto a `View` wrapping a `Pressable`.** `useSortable`/
  `useDraggable` return `attributes` with `role: "button"` and `tabIndex: 0`; react-native-web
  renders any `View` with `role="button"` as an HTML `<button>`. The inner `Pressable`s are
  also `<button>`s — DOM nesting warning. We only use Mouse/Touch sensors (no KeyboardSensor),
  so strip `role`/`tabIndex` before spreading. See `stripButtonRole` in
  `apps/workshop/src/screens/listDetail/ItemList.web.tsx`.
- **Per-(list, viewer) presentation state lives on `list_members`.** `pinned_at`,
  `archived_at`, `muted_at` columns (NULL = not set). `last_read_at` for unread-count
  derivation lives in the older `user_activity_reads` table — don't duplicate it.
  `GET /v1/lists` joins both into `ListSummary`. Endpoints follow
  `POST /v1/lists/:id/{pin,archive,mute,read}` to set + `DELETE` to clear; `read` is one-way
  (no inverse semantic). Don't confuse this per-viewer `archived_at` with the global soft-delete
  `archived_at` on `lists` / `items` below.
- **Lists and items are soft-deleted via `archived_at`.** `DELETE /v1/lists/:id` (owner-only)
  and `DELETE /v1/items/:id` set the row's `archived_at`; FKs stay configured for a future
  unarchive surface. Every read path filters `archived_at IS NULL` —
  `requireListMember`/`requireItemMember` 404 archived rows, `GET /v1/lists` filters lists,
  items reads filter both item and parent list, the activity feed joins through both, and the
  public invite preview/accept checks the same. **When you add a new query touching `lists` or
  `items`, add the same filter.** Action events are `list_archived` / `item_archived`
  (legacy `item_deleted` is kept in the enum for old rows). For album-shelf items the partial
  unique index on `(list_id, spotifyAlbumId)` includes archived rows, so a refresh won't
  resurface an album the user archived.
- **The home unread count is server-authored, not derived client-side.** The bell badge is
  `sum(list.unreadCount across non-muted lists)` from `ListSummary`. Don't reintroduce a
  client-side cutoff-against-`getActivityLastViewedAt` derivation — no per-list granularity,
  and a single `/activity` visit cleared everything.
- **Real-time on web today is `useLivePollingInterval` (15s, visibility-gated).** No SSE/WS
  yet. Hook at `src/hooks/useLivePollingInterval.ts`; pass into queries via `refetchInterval`.
  Returns `false` on native — `refetchOnWindowFocus` + AppState integration handles foreground
  refresh, and a background timer would be a battery tax.
- **Wrap top-level screens in `Screen` from `src/ui/Layout.tsx`** when adding a new route.
  No-op on native; on web it constrains content to a ~560px reading column. Without it,
  RN-Web stretches edge-to-edge. The `Sheet` modal is intentionally outside the column on web.

## Debugging production

```bash
AWS_PROFILE=workshop-prod ./scripts/logs.sh --since 10m --filter error   # Lambda errors
AWS_PROFILE=workshop-prod ./scripts/logs.sh --filter "<request_id>"      # one request
AWS_PROFILE=workshop-prod ./scripts/db-connect.sh                         # psql into Neon

cd infra && AWS_PROFILE=workshop-prod terraform state list                # deployed resources
cd infra && AWS_PROFILE=workshop-prod terraform output                    # api_url, lambda_name, etc.

curl -fsS $(cd infra && AWS_PROFILE=workshop-prod terraform output -raw api_url)/health
```

The Lambda reads `STAGE`, `DATABASE_URL`, `SESSION_SECRET`, `APPLE_BUNDLE_ID`,
`APPLE_SERVICES_ID`, `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_WEB_CLIENT_ID`, `TMDB_API_KEY`,
`GOOGLE_BOOKS_API_KEY`, `LOG_LEVEL` from env vars set by Terraform.
`aws lambda get-function-configuration` shows what's running.

## Admin runbook

Most commands need admin credentials.

- **Laptop**: secrets in `.admin.env` at the repo root (gitignored, mode 600). Run
  `/admin-elevate` to source + health-check.
- **Niteshift sandbox**: secrets injected as env vars. AWS uses role assumption (no static
  keys), 1h auto-refresh. Role defined in `infra/niteshift.tf`. Rotate External ID via
  Niteshift → Settings → Repositories → workshop → AWS → "Generate New ID", then update
  `var.niteshift_external_id` and apply.

| Goal                                | Command                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ship an infra change                | Open PR; plan posts as comment. Merge → auto-applies.                                                                                                             |
| Preview infra change locally        | `cd infra && AWS_PROFILE=workshop-prod terraform plan`                                                                                                            |
| See what infra would change on main | `gh workflow run terraform.yml --ref main`                                                                                                                        |
| Tail prod logs                      | `AWS_PROFILE=workshop-prod ./scripts/logs.sh --since 10m --filter error`                                                                                          |
| Trace one request                   | `AWS_PROFILE=workshop-prod ./scripts/logs.sh --filter <reqid>`                                                                                                    |
| psql into Neon prod                 | `AWS_PROFILE=workshop-prod ./scripts/db-connect.sh`                                                                                                               |
| Neon branch for risky migration     | `neonctl branches create --name pre-<feature>` (needs `NEON_API_KEY`)                                                                                             |
| Read SSM secret                     | `AWS_PROFILE=workshop-prod aws ssm get-parameter --name /workshop-prod/X --with-decryption --query 'Parameter.Value' --output text`                               |
| Rotate SSM secret                   | `aws ssm put-parameter --name /workshop-prod/X --value … --overwrite --type SecureString` (SSM resources have `ignore_changes = [value]`)                         |
| Deploy web to preview               | `pnpm deploy:pages:preview`                                                                                                                                       |
| Deploy web to prod                  | `pnpm deploy:pages` (always-confirm)                                                                                                                              |
| Force a fresh TestFlight build      | `gh workflow run testflight.yml --ref main --field force=true`                                                                                                    |
| Bypass EAS submit (queue jammed)    | Download IPA from EAS dashboard, then `xcrun altool --upload-app --type ios -f ~/Downloads/workshop.ipa -u joshlebed@gmail.com -p "$APPLE_APP_SPECIFIC_PASSWORD"` |

## iOS deploy pipeline

### First diagnostic: "feature shipped on web but missing on iOS"

Almost always the deploy pipeline, not per-platform code. Check in order:

1. **Did the OTA ship?** Look at most recent `Deploy Mobile (OTA)` run on main.
   ```bash
   gh run list --workflow=deploy-mobile.yml --branch=main --limit=3
   gh run view <run-id> --log | grep -E "Runtime version|Branch  *production"
   ```
2. **Does the installed TestFlight build's runtime version match the OTA's?** Runtime version
   is `app.json` `version` at build time. A `0.1.0` TestFlight build never applies a `0.2.0` OTA.
3. **Has the latest TestFlight build landed?** `testflight.yml` awaits the EAS build. Red run =
   no matching binary exists yet. Two common failure shapes:
   - Fails at the `Write ASC API key` step → the `ASC_API_KEY_*` GitHub Actions secrets are
     unset or stale. One-time fix via the website in `docs/manual-setup.md` §5.
   - Fails at `Build + auto-submit (await success)` with `Distribution Certificate is not
validated for non-interactive builds` → the ASC API key the secrets point to was revoked
     or doesn't have App Manager+. Rotate the key (same §5 flow) and re-fire. Before the ASC
     API key was wired into the workflow, any new bundle id (share / widget / push extension
     target) would also surface this error because EAS fell through to interactive Apple auth;
     that's no longer a risk as long as the secrets are populated.

### Runtime-version policy: `appVersion` (not `fingerprint`)

Runtime version = `app.json` `version`. **You MUST bump `version` in the same PR that adds a
native module or changes a config plugin.** Enforced by the `Runtime version guard`
(`.github/workflows/runtime-version-guard.yml`): it fails a PR whose iOS `@expo/fingerprint`
has no prior `ios-fp-<hash>` tag (native dep / `patches/` change) or whose app.json iOS native
fields changed, unless `apps/workshop/app.json` `version` is bumped. When in doubt, bump.

Why this matters: if you add `react-native-foo` (native) at `version: 0.1.0` without bumping,
the new OTA targets `0.1.0`, which the already-installed pre-PR `0.1.0` TestFlight binary
also claims. The OTA applies, then crashes on next launch with
`Native module RNFoo cannot be null` — existing users have to delete + reinstall. Bumping to
`0.2.0` makes the OTA target `0.2.0`, which only post-PR builds claim.

We can't use `policy: "fingerprint"`: EAS's `Configure expo-updates` step fails when the
fingerprint computed pre-submit (Linux runner) disagrees with the one computed during
prebuild (macOS builder) — they disagree because several native package directories hash
differently across OSes. `appVersion` produces identical values on every host.

### Recovery

Stuck fingerprint tag (e.g. build succeeded but auto-submit failed):

```bash
git tag -d ios-fp-<hash>
git push origin :refs/tags/ios-fp-<hash>
gh workflow run testflight.yml --ref main --field force=true
```

Provisioning profile out of sync after a capability toggle:

```bash
cd apps/workshop && npx eas-cli@latest credentials --platform ios
# production → Build Credentials → Provisioning Profile → Delete one → confirm
```

Then force a fresh build. EAS regenerates with current capabilities.

App Store Connect / EAS submit queue stuck (IPA is fine, downstream broken): download IPA
from EAS dashboard, upload directly:

```bash
read -s "ASP?Paste app-specific password: " && echo "" && \
  xcrun altool --upload-app --type ios -f ~/Downloads/workshop.ipa \
    -u joshlebed@gmail.com -p "$ASP" && unset ASP
```

App-specific password: <https://appleid.apple.com> → Sign-In and Security. macOS only.

ASC API key secret missing or revoked (build red at `Write ASC API key` or `Distribution
Certificate is not validated for non-interactive builds`):

```bash
pnpm setup:asc-key
```

Interactive script — generates the key in the browser, encodes the `.p8`, pushes the three
GH secrets (`ASC_API_KEY_CONTENT`, `ASC_API_KEY_ID`, `ASC_API_ISSUER_ID`) via `gh secret set`,
and re-fires `testflight.yml --field force=true`. With the secrets in place eas-cli auto-
generates the cert + provisioning profile for any new bundle id (share/widget/push extension)
on the next build with zero human-in-loop. Idempotent — run again to rotate.

A red `testflight.yml` run also pings `#workshop-admin` on Discord via the `notify` job
(uses `DISCORD_NOTIFY_WEBHOOK_URL` secret; missing webhook degrades to a CI warning). The
ping includes a `pnpm setup:asc-key` hint so the recovery path is one command away.

### GitHub Actions concurrency

`testflight.yml` uses `concurrency: testflight, cancel-in-progress: false`. Right default —
don't abandon EAS minutes for a new push. But if the in-flight run is stuck, new runs queue
behind it. Cancel with `gh run cancel <run-id>`; the EAS build keeps running on EAS's servers.

## Sources of truth

| System                          | URL                                                                                    | Owns                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **EAS dashboard**               | <https://expo.dev/accounts/joshlebed/projects/workshop>                                | iOS build history + IPAs, submission queue, fingerprint tags, EAS Update channels                |
| **App Store Connect**           | <https://appstoreconnect.apple.com>                                                    | TestFlight builds, app metadata, ASC API keys                                                    |
| **Apple Developer Portal**      | <https://developer.apple.com/account/resources/identifiers/list>                       | App IDs, capabilities, App Groups, provisioning profiles, signing certificates                   |
| **Google Cloud Console**        | <https://console.cloud.google.com/apis/credentials?project=workshop-494616&authuser=1> | OAuth client IDs, API keys (Books)                                                               |
| **TMDB**                        | <https://www.themoviedb.org/settings/api>                                              | TMDB v3 API key                                                                                  |
| **AWS SSM Parameter Store**     | `aws ssm describe-parameters` (prefix `/workshop-prod/`)                               | Lambda env values; SSM resources have `lifecycle { ignore_changes = [value] }`                   |
| **HCP Terraform**               | <https://app.terraform.io/app/josh-personal-org/workspaces/workshop-prod>              | All AWS infra state                                                                              |
| **Cloudflare Pages**            | <https://dash.cloudflare.com/?to=/:account/pages/view/workshop>                        | Web build env vars (`EXPO_PUBLIC_*`), production URL `workshop-a2v.pages.dev`                    |
| **GitHub Actions**              | <https://github.com/joshlebed/workshop/actions>                                        | CI runs, deploy runs, fingerprint tags (as git tags)                                             |
| **Neon**                        | connection string in SSM `/workshop-prod/db/url`                                       | Production Postgres                                                                              |
| **Discord (`#workshop-admin`)** | webhook in SSM `/workshop-prod/discord/notify_webhook_url`                             | Operator notifications. Rotate via channel ⚙ → Integrations → Webhooks, then `ssm put-parameter` |

Change something in the system above; don't trust caches in code or Terraform.

## HCP Terraform state lock

HCP's state lock doesn't auto-release when terraform is killed. Symptom: `Error acquiring the
state lock`. Fix: workspace UI → **Unlock** (top right). Prefer UI unlock over `-lock=false`.

## Terraform deploy pipeline

`.github/workflows/terraform.yml` owns the full lifecycle:

- **PR (paths: `infra/**`or`terraform.yml`)** → `terraform plan -detailed-exitcode -refresh=false`,
  sticky PR comment. Informational, not a required check.
- **Push to `main`** → `terraform apply -auto-approve` + `/health` smoke test. No human gate
  beyond the PR review.
- **Weekly cron (Mon 13:00 UTC)** + `workflow_dispatch` → plan; opens/updates one
  `infra-drift` issue on drift.

**Roles**: plan uses narrow `AWS_ROLE_ARN` (Lambda + scoped SSM), runs with `-refresh=false`
so it doesn't 403 on SSM params it can't read. Apply uses `AWS_ROLE_ARN_TF_APPLY`
(`AdministratorAccess`), assumable only by `ref:refs/heads/main`. Broad perms because
Terraform manages IAM (including this role's own trust policy).

**Variables**: HCP workspace is Local-mode so vars aren't auto-injected. `database_url`
fetched from SSM at job runtime. `niteshift_external_id` from GH secret. Everything else
(Apple/Google/TMDB/Books/Spotify) uses empty-string defaults — backing SSM params have
`lifecycle { ignore_changes = [value] }`, so apply doesn't clobber ops-set values.

If you add a new required var (no default), wire it into both jobs' env blocks **and** add
the matching GH secret in the same PR.

**Recovery**: `gh run view <run-id> --log` shows failure. Plan failed → fix on a new PR.
Apply failed partway → HCP locks; next push retries, or run locally with same vars (state in
HCP). State lock stuck → see "HCP Terraform state lock" above.

## Safe changes vs careful changes

- **Safe** (just push): new routes, new Expo screens, new Drizzle columns with defaults, new
  tests/scripts, `infra/` changes whose PR plan matches expectations (CI auto-applies).
- **Careful** (read PR-time plan first): destructive `infra/` changes (resource recreation,
  IAM edits, deleting SSM params); rotating `database_url`.
- **Ask first**: deleting DB data; changing Lambda runtime major; rotating OIDC provider;
  expanding `tf-apply` perms or trust policy; adding a new AWS service; touching anything in
  a different AWS account.

### Admin actions: auto-allowed vs always-confirm

Once `/admin-elevate` is active (or in a Niteshift sandbox with the AWS role assumed):

**Auto-allowed** (do it, mention in chat):

- `terraform plan/output/state list`, log reads
- `aws ssm get-parameter` (incl. `--with-decryption`)
- `aws lambda get-function-configuration/get-function`
- `pnpm deploy:pages:preview` (preview branch)
- `neonctl branches create` (non-`main`/`prod*`)
- Lambda env var rotation via `aws lambda update-function-configuration` (reverted on next
  apply if SSM source ignores changes)
- Rerunning failed CI, `gh workflow run` for non-deploy workflows

**Always confirm**:

- Manual `terraform apply` (CI applies on merge)
- Any Cloudflare DNS change
- `pnpm deploy:pages` to production
- Any change to GH branch protection or required checks
- `neonctl branches delete` for `main` or `prod*`
- Apple Developer Portal capability toggles
- OIDC provider rotation, GH Actions IAM role policy edits
- Adding a new AWS service
- Anything in a different AWS account

**Prohibited**:

- Force-push to `main`
- `terraform destroy` on prod
- `DROP TABLE`/`TRUNCATE` on prod Neon
- Rotating `SESSION_SECRET` without warning the user (invalidates all sessions)
- Removing Niteshift's IAM role trust policy while a task is in-flight

## Local development

The Expo app builds to **iOS and web from one component tree** via `react-native-web`. Web is
the primary dev surface — faster iteration, browser-automation can drive the real UI.

### First-time setup

Prereqs: Node 20.19 (`.nvmrc`), pnpm 10.19, Docker Desktop.

```bash
pnpm install
pnpm dev   # first run creates apps/backend/.env, migrates the local DB
```

### Running it

```bash
pnpm dev          # postgres (docker) + backend (:8787) + web app (:8081)
pnpm dev:backend  # backend only
pnpm dev:mobile   # iOS/Expo Go — separate terminal (QR/keybinds)
```

`pnpm dev` runs `scripts/dev.sh`: starts `workshop-pg` postgres, seeds `apps/backend/.env`
on first run (generates `SESSION_SECRET`), applies migrations, runs dev seed, then
`concurrently` runs backend + `expo start --web` with `[backend]`/`[web]` prefixes. Ctrl-C
stops both. `app.json` points `apiUrl` at `http://localhost:8787`; backend CORS allowlist already includes `http://localhost:8081`.

### Database in the Niteshift sandbox

Local `pnpm dev` uses docker postgres. Niteshift sandbox can use docker OR a per-task Neon
branch, depending on the repo's Niteshift Database integration (Settings → Repositories →
`joshlebed/workshop` → Database). When enabled: fresh Neon branch on task start with
`DATABASE_URL` injected, reused on resume, GC'd on archive. `niteshift-setup.sh` detects
shape — non-localhost `DATABASE_URL` skips docker. Migrations still run. Dev seed is
**skipped by default** against remote DBs to avoid smearing fixtures over real data; force
with `SEED_DEV_DATA=1`.

**PII caveat**: if the parent branch is prod, every sandbox gets a copy of real user data.
Point at a scrubbed staging branch if that's not OK.

### Dev data seed

`apps/backend/scripts/seed.ts` populates Postgres with a lived-in set of lists owned by
`joshlebed@gmail.com` (the web app's auto-dev-sign-in identity). Second user
`friend@workshop.local` is added on a few shared lists, plus recent `game_scores` rows. Both `dev.sh` and `niteshift-setup.sh` run
`pnpm --filter @workshop/backend run db:seed`. Idempotent, hard-guarded against non-local
stages. `SEED_DEV_DATA=0` to skip. To re-seed: `DELETE FROM users WHERE email IN
('joshlebed@gmail.com','friend@workshop.local');` and re-run.

On a Niteshift Neon branch forked from prod the seed is skipped by default — the real
`joshlebed@gmail.com` row already exists with the apple identity, and the dev sign-in
route attaches a synthetic `(apple, dev:joshlebed@gmail.com)` identity to that same user
on first hit. So the agent/preview see your real data; the sign-in just bypasses Apple.

When adding a new list type or item-metadata field, extend `seed.ts`.

### Dev logs — `/tmp/workshop-dev.log` (local) or `$NITESHIFT_LOG_FILE` (sandbox)

`pnpm dev` tees all output to `/tmp/workshop-dev.log` (override with `WORKSHOP_DEV_LOG`).
Terminal copy keeps ANSI; file copy is plain text. **First place to look when something
isn't working.**

```bash
tail -f /tmp/workshop-dev.log
grep "magic code" /tmp/workshop-dev.log         # local sign-in codes
grep -iE "error|warn" /tmp/workshop-dev.log
grep "<request_id>" /tmp/workshop-dev.log       # trace one request
```

In the Niteshift sandbox, `~/.niteshift/niteshift-setup.sh` starts backend + web directly
via `concurrently`; output goes to `$NITESHIFT_LOG_FILE` (`/root/.niteshift/task-<id>.log`).
Same prefixes, same grep patterns.

### Known sandbox gotcha: CORS preflight via the preview proxy

The Niteshift preview proxy (`https://ns-<port>-<id>.preview.niteshift.dev`) rejects
unauthenticated CORS OPTIONS preflights with `403`. `apps/workshop/src/config.ts` works
around this by deriving the API URL from `window.location` on web (localhost stays;
`ns-<port>-<id>` rewrites to the matching `ns-8787-<id>` host). Keep that derivation in
place or browsers can't sign in.

### Signing in locally (no email)

`STAGE=local` logs the magic code to stdout instead of sending email
(`apps/backend/src/lib/email.ts:17-20`). Submit the form, then:

```bash
grep "magic code" /tmp/workshop-dev.log | tail -1
```

Codes expire in 15 minutes.

### Sharing code between web and iOS

Metro resolves `.web.ts(x)` before `.ts(x)` on web and `.native.ts(x)` before `.ts(x)` on
iOS. Most UI is truly shared; only native-only modules need a platform variant:

- `src/lib/storage.ts` → `expo-secure-store` (iOS keychain)
- `src/lib/storage.web.ts` → `window.localStorage` shim

Add a `.web.ts(x)` beside a file when a feature imports a native-only module. Don't
`Platform.OS === 'web'` branch inside shared files — the extension is cleaner and Metro
strips the unused variant.

Web-compatible: `expo-router`, `expo-linking`, `expo-constants`, `expo-status-bar`,
`expo-updates` (stub), `react-native-safe-area-context`, `react-native-screens`,
`react-native-gesture-handler`, `@react-navigation/native`. Re-check when adding native modules.

### Web HTML shell lives in `apps/workshop/public/index.html`

`app.json` → `web.output: "single"`, so Expo Router's `+html.tsx` hook isn't invoked. Expo
CLI builds HTML from `apps/workshop/public/index.html` (or the bundled template fallback).
This is where the iOS Safari URL-bar/home-indicator tint (`<meta name="theme-color">`),
`viewport-fit=cover`, and html/body `background-color` lock live. If you switch to
`output: "static"` someday, port these into `+html.tsx` in the same PR.

## Per-area guides

- `apps/backend/CLAUDE.md` — Hono + Drizzle patterns, Lambda bundling
- `apps/workshop/README.md` — Expo app structure
- `infra/README.md` — Terraform layout

## Share-link Open Graph previews

Every URL on the production domain renders an Open Graph + Twitter Card preview so iMessage,
Slack, Facebook, etc. show a thumbnail instead of a dead link. Four routes, layered around
the per-list `share_slug` / `share_visibility` model owned by the backend `lists` table:

1. **Default** — `apps/workshop/public/index.html` ships a static set of OG tags pointing at
   `/og/default.png`. Applied to every URL with no more specific override (home, sign-in,
   activity, settings, …). The PNG is generated on demand by `functions/og/[name].ts`.
2. **Short share URL** — `functions/l/[slug].ts` is the primary share surface. Calls
   `GET /v1/lists/by-slug/:slug/preview` and emits a list-specific card (name, emoji, owner,
   item count, color gradient). Image is rendered by `functions/og/l/[slug].ts`.
3. **Canonical list URL** — `functions/list/_middleware.ts` intercepts every `/list/:id/...`
   URL, calls `GET /v1/lists/:id/preview`, and picks rich-vs-locked based on
   `shareVisibility`: `view` / `join` → rich list card pointing at `og/list/:id.png`;
   `off` (or preview failed) → "Sign in to view this list" variant pointing at
   `/og/locked-list.png`. Crawlers on either URL shape end up with an equivalent thumbnail.
4. **Legacy invite** — `functions/invite/[token].ts` is kept around so URLs already pasted
   into iMessage / email keep working. Calls the legacy `/v1/invites/:token/preview` and
   emits the same list-specific card via `functions/og/invite/[token].ts`. We don't mint
   new invite tokens; this is a back-compat surface only.

```
GET /l/:slug              → preview API → HTMLRewriter swaps defaults for per-list tags
GET /og/l/:slug.png       → workers-og  → 1200×630 per-list PNG
GET /list/:id/...         → /list/_middleware.ts → rich card when shareVisibility ∈ {view, join}, locked otherwise
GET /og/list/:id.png      → workers-og  → 1200×630 per-list PNG (id-keyed)
GET /invite/:token        → legacy preview API (back-compat) → per-list tags
GET /og/invite/:token.png → legacy PNG renderer (back-compat)
GET /og/:name.png         → workers-og  → 1200×630 static PNG (default, locked-list)
```

Three non-obvious things:

- **One tag per property.** Each route-specific Pages Function strips the default OG tags
  from `index.html` via HTMLRewriter before appending its own. Facebook's spec says "first
  tag wins" for duplicate `og:image` etc., Twitter is inconsistent, and Apple LinkPresentation
  is closed-source — single-tag-per-property is the only safe state. If you add a new tag to
  `buildMetaTagsRaw`, mirror its selector into `OG_META_SELECTORS` in the same PR or the
  override pipeline silently leaves duplicates.
- **OG image must be raster (PNG/JPEG).** Apple LinkPresentation and Facebook silently drop
  SVG `og:image` despite claiming to accept it. Rasterizer is `workers-og` (Satori-based).
- **Pages Functions must NOT import from workspace packages.** Cloudflare Pages's bundler runs
  at the repo root, but `functions/` isn't a pnpm workspace member, so `node_modules/@workshop/`
  doesn't exist for esbuild to follow. Keep function code self-contained: pure metadata helpers
  (`buildMetaTags`, `buildOgImageHtml`, etc.) are inlined into `functions/_lib/og.ts`. A mirror
  copy lives in `packages/shared/src/og.ts` so vitest can unit-test the same surface; if you
  edit one, update both in the same PR. Anything imported from `@workshop/shared/*` inside
  `functions/**` silently fails the CF Pages build.

### Verifying a thumbnail after deploy

Platforms cache aggressively (Facebook ~30 days per URL, iMessage per-conversation forever).
Verify against a freshly rotated slug each time — owners reset via
`POST /v1/lists/:id/share/reset`:

```bash
SLUG=$(curl -sS -H "Authorization: Bearer $JWT" -X POST \
  https://<api>/v1/lists/<list-id>/share/reset | jq -r .shareSlug)

node scripts/check-og.mjs "https://workshop-a2v.pages.dev/l/$SLUG"
```

`scripts/check-og.mjs` curls with a FB/Apple-LP-shaped UA, asserts OG tags, fetches the image
and verifies PNG content-type + dimensions match. Exits non-zero on mismatch. The expected
variant is inferred from the URL path: `/l/...` and `/invite/...` expect list-specific,
`/list/...` accepts either the rich list card or the locked-list copy (both are valid
post-redesign outcomes), anything else expects the brand default.

Apple LinkPresentation has no debug API. Closest signal is `check-og.mjs` passing with an
Apple-shaped UA + a visual eyeball in `agent-browser`.

### How web ships, and the fast deploy loop

Production web is deployed by **Cloudflare Pages' native Git integration** (Pages project
`workshop`, connected to this repo, `production_branch=main`, `deployments_enabled=true`).
Every push to `main` triggers a CF build (`pnpm install --frozen-lockfile && expo export
--platform web`, output `apps/workshop/dist`, `functions/` picked up automatically), and
the result posts back to the commit as the **"Cloudflare Pages"** check (app
`cloudflare-workers-and-pages`) — a failed build is visible on the PR/commit, not silent.
**No GitHub Actions workflow deploys web.** CF auto-build is slow (~3–5min); for a fast
manual deploy, run wrangler directly:

```bash
pnpm deploy:pages:preview   # builds web + deploys to <branch>.workshop-a2v.pages.dev (~30s)
pnpm deploy:pages           # builds web + deploys to production
```

Both wrap `scripts/deploy-pages.sh` (handles Node 22 switch for wrangler). Auth via
`wrangler login` or a `CLOUDFLARE_API_TOKEN` with **Pages:Edit on the account that owns the
`workshop` project** (`dd75c7bdd35289afb8b0a74f3610eba8`).

CI's `.github/workflows/deploy-pages.yml` (**"Verify Pages Deploy"**) does _not_ deploy — it
waits for CF's build of the pushed commit to complete (read via the GitHub check-runs API,
no CF secret), then asserts production serves a raster OG image + a valid AASA document
(the runtime regression class CF's "build succeeded" status can't catch). It needs **no
Cloudflare secrets**. It previously ran a redundant second `wrangler pages deploy` from CI
that failed every run with CF API error **7003** — the `CLOUDFLARE_*` Actions secrets had
stopped resolving to the project's account. Since the CF Git integration (not that
workflow) is what ships prod, dropping the wrangler step changed nothing about deploys.

## Running commit-ready checks

```bash
pnpm run typecheck     # ~12s
pnpm run lint          # ~1s
pnpm run test          # ~2s
pnpm run knip          # ~2s — non-blocking in CI while baseline tunes
cd infra && terraform fmt -check -recursive && terraform validate
```
