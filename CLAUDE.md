# workshop — coding agent guide

Read this before editing anything. Also read `docs/decisions.md` for the constraints behind the
design, `docs/recovery-runbook.md` when something is broken (flat symptom → fix lookup), and
check `docs/plans/HANDOFF.md` if it exists — it describes in-flight setup work that may not be
complete.

## Self-healing agent docs (do this every session)

`CLAUDE.md`, `README.md`, and `AGENT-REFLECTIONS.md` are living artifacts. Every agent is
expected to leave them more accurate than they found them — both by adding lessons learned
_and_ by removing entries that no longer apply. The goal is a self-healing loop: every
mistake an agent makes once should become impossible (or cheap to recover from) for the
next agent, and stale guidance should disappear before it misleads anyone.

**Before you finish a task, do all three:**

1. **Update `CLAUDE.md`** when you hit a gotcha, footgun, or non-obvious constraint that
   isn't already documented — _or_ when an existing rule misled you. Add it to the most
   relevant existing section (Conventions, the per-system layers, recovery runbook); don't
   bolt on a new top-level section unless the topic is genuinely new. Prefer one tight
   paragraph with the symptom, the cause, and the fix. If a rule here led you astray
   (stale, ambiguous, wrong), _edit it_ — don't add a contradicting rule alongside it.
   When you ship code that retires a CLAUDE.md gotcha (the underlying issue is permanently
   fixed, not just worked around), delete the corresponding bullet in the same PR.
2. **Update `README.md`** when human-facing setup, run, or deploy instructions are wrong or
   missing. If `pnpm dev` failed for a reason a fresh clone would also hit, that's a
   README bug. Keep `README.md` aimed at humans/onboarding; keep agent-only guidance in
   `CLAUDE.md`.
3. **Curate `AGENT-REFLECTIONS.md`** as the outstanding-issues queue for environment /
   tooling friction you can't fix from inside the current PR (setup script, sandbox image,
   dev orchestration, missing tooling, slow feedback loops, flaky tests). It is _not_ a
   session diary — entries describe **open** problems, not history. The contract:
   - **Add** an entry when you hit friction that you can't fix in the current PR. Keep
     each entry to one tight paragraph: symptom → suggested fix. One issue per entry.
   - **Remove** an entry in the same PR that retires it. If a fix is partial, edit the
     entry down to just the still-open part. Don't archive, don't strike through — just
     delete. Git history is the audit trail.
   - **Promote** an entry to `CLAUDE.md` (as a documented gotcha agents work around) if
     it's been sitting unfixed across multiple sessions and probably _won't_ get a code
     fix soon.

   See `AGENT-REFLECTIONS.md` for the current open queue and the full contribution rules.

**What counts as worth writing down:** anything that would have saved you ≥5 minutes if
you'd known it at the start of the session. If you found yourself grepping the same thing
twice, re-discovering a port collision, re-learning which log file has the magic code, or
working around a broken script — write it down. If you wasted time on a wrong assumption
that the existing docs technically covered, _improve the wording_ so the next agent can't
make the same misread.

**What doesn't belong:** task-specific notes (PR description), positive reflections ("X
worked well"), speculative future-feature ideas, or anything fixable inside a normal PR
(open the PR instead of writing about it).

Treat these updates as part of "done." A PR that fixes a bug but leaves the next agent to
re-hit the same trap — or leaves a stale entry pointing at a problem you just solved — is
only half-finished.

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
  driver. Connection string lives in `infra/terraform.tfvars` (gitignored) → SSM SecureString
  → Lambda env var.
- **Terraform** for all infra. State in HCP Terraform (free tier), org `josh-personal-org`,
  workspace `workshop-prod`, execution mode **Local** (plans/applies run on the client, state
  stored in HCP). Auto-applied by CI on merge to `main` — see Terraform deploy pipeline below.
- **GitHub Actions** for CI/CD. OIDC to AWS (no long-lived keys). Secrets: `TF_API_TOKEN`,
  `AWS_ROLE_ARN` (narrow Lambda-deploy + plan role), `AWS_ROLE_ARN_TF_APPLY` (Admin, used only
  by main-branch apply), `NITESHIFT_EXTERNAL_ID`, `EXPO_TOKEN`, `EXPO_PUBLIC_API_URL`.
- **EAS Update** for JS-only OTA updates to iPhones within ~60s of merge. TestFlight builds
  auto-trigger on merge when `@expo/fingerprint` detects a native change (new native dep, config
  plugin, bundle id, etc.); `testflight.yml` runs `eas build --auto-submit` and **awaits the
  build** (~30 min of GH Actions runner time per native build) so the workflow's red/green
  reflects the actual EAS outcome instead of just the enqueue. Manual dispatch with `force=true`
  bypasses the fingerprint check. Last-built fingerprint is stored as a git tag
  (`ios-fp-<hash>`), written only after the build succeeds. Runtime-version policy is
  `appVersion`, not `fingerprint` (see iOS deploy pipeline section for the why).
- **Tooling baseline**: Biome (lint + format), Vitest, Zod (for API-boundary validation),
  `@total-typescript/ts-reset` (globally enabled), knip (unused code/deps), lefthook (pre-commit),
  actionlint + gitleaks in CI. Dependabot opens aggressively-grouped npm/Actions/Terraform PRs
  monthly on the first Monday (~3 PRs/month total — combined into native/aws-sdk/tooling for
  npm, single grouped PRs for Actions and Terraform). `.mise.toml` pins node, pnpm, terraform, actionlint, gitleaks — `mise install` gets
  you the exact versions CI uses.

## AWS

- **Account for Workshop**: see `infra/terraform.tfvars` (gitignored). During the initial
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
  Actions reads SSM via OIDC — never hardcoded access keys. `terraform.tfvars` and
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
- **Docs-only PRs need a required-check shim.** `ci.yml` has
  `paths-ignore: **/*.md`/`docs/**` so docs-only PRs don't burn CI minutes — but
  branch protection still requires the `Quality (...)` check to report. Without
  a shim, a docs-only PR is unmergeable (the required check never runs and
  `mergeStateStatus` stays `BLOCKED` with no failing checks visible). The fix
  lives in `.github/workflows/ci-docs.yml`: a sibling workflow that triggers on
  the inverse path set and emits the same job names as trivial successes. If
  you add a new required check to `ci.yml`, add a matching noop job to
  `ci-docs.yml` or docs-only PRs will deadlock again. If you add a new
  `paths-ignore` entry to `ci.yml`, mirror it as a `paths` entry in
  `ci-docs.yml`.
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
  `expo-apple-authentication` plugin); App Groups `group.dev.josh.workshop`
  (via `ios.entitlements` _and_ the `expo-share-intent` plugin — both
  belt-and-suspenders since the share extension target also needs the
  entitlement and the plugin handles both halves).
- **Don't override `ios.infoPlist.CFBundleURLTypes` without re-listing the
  app scheme.** Once you declare a `CFBundleURLTypes` entry in `app.json`
  (e.g. for the Google OAuth reverse-client scheme), Expo stops auto-adding
  the app's own `scheme:` value to that array — and plugins like
  `expo-share-intent` will refuse to prebuild (`Incompatibility found, when
you override CFBundleURLSchemes you have to manually add the application
scheme`). Mirror the root `scheme` ("workshop") into the
  `CFBundleURLSchemes` array yourself. The check fires at `expo config`
  time, so `npx expo config --type public` catches it before EAS does.
- **GitHub Actions `permissions:` blocks aren't least-privilege by default** — `permissions:
contents: read` _replicates_ GitHub's default for push events, doesn't restrict it. Any new
  action that needs PR metadata (e.g. `dorny/paths-filter`, label-on-PR, comment-on-PR) needs
  an explicit grant like `pull-requests: read`. Failure mode is opaque at runtime
  (`"Resource not accessible by integration"`) and isn't caught by `actionlint`.
- **CORS `allowMethods` is an explicit whitelist in _two_ places.** A new HTTP verb
  needs to be added to both:
  1. Hono's `cors()` middleware in `apps/backend/src/app.ts` (echoes the verb on
     `Access-Control-Allow-Methods`).
  2. API Gateway HTTP API's `cors_configuration.allow_methods` in
     `infra/apigateway.tf` — API Gateway answers OPTIONS preflights _at the edge_
     before Lambda even sees them, so a verb missing from this list silently breaks
     the browser preflight no matter what Hono says. Caught 2026-05-16: PUT
     `/v1/items/:id/scores` shipped with Hono updated but apigateway.tf left at
     `[GET, POST, PATCH, DELETE, OPTIONS]`. Safari surfaced the failed preflight
     as a generic "Load failed" toast on mobile web.

  The same whitelist also gates `apiRequest`'s `method` union in
  `apps/workshop/src/lib/api.ts`, so update all three in lockstep. To verify a verb
  is wired correctly end-to-end, probe the preflight:
  `curl -X OPTIONS -H "Origin: https://workshop-a2v.pages.dev" -H "Access-Control-Request-Method: PUT" <api>/v1/whatever -i`
  should respond with `Access-Control-Allow-Methods` containing the verb.

- **Auto-merge is on.** The repo is public (which gives us free branch protection + unlimited
  Actions minutes) and `main` requires four checks to pass:
  - `Quality (lint, typecheck, test, knip, format, terraform, actionlint)` — always runs on PRs.
  - `Mobile Metro bundle` — runs only when `apps/workshop/**`, `packages/shared/**`, or
    `pnpm-lock.yaml` changes; skipped (and treated as passing) otherwise. Catches RN/Expo
    SDK drift — Dependabot bumping `react-native` past the SDK matrix would have shipped
    to prod without this gate (the 2026-04-24 mobile outage).
  - `Migrate smoke (fresh DB + idempotent re-run)` — runs only when
    `apps/backend/drizzle/**`, `apps/backend/src/db/**`, or `pnpm-lock.yaml` changes;
    skipped (and treated as passing) otherwise. Catches Drizzle journal-vs-files drift
    before it can desync prod (the 2026-04-24 backend-deploy outage).
  - `terraform plan` — always runs on PRs (no paths filter on the workflow's
    `pull_request` trigger). Catches infra mistakes before merge so a bad apply
    can't wedge prod state. Exit 2 ("changes detected") is success — that's the
    expected state for any PR that touches infra; only exit 1 (HCL error, missing
    var, IAM 403 on a managed resource) fails the check. Plan runs with
    `-refresh=false` and the narrow plan role; that role has `ssm:GetParameter*`
    on `/workshop-prod/*` so SSM-imports / SSM-data-sources don't 403, but a
    future `import {}` block or `data` source on a non-SSM resource the plan
    role can't read (IAM, future services) WILL fail plan and block merge —
    expand the plan role's policy in the same PR or carve the change in two.

  `gh pr merge <PR> --auto --squash --delete-branch` is the canonical merge path: it arms
  a queued merge that fires when all required checks go green, including across reruns and
  force-pushes. The `/continue-redesign` skill uses this by default. Don't claim merged
  without verifying with `gh pr view <PR> --json state` — armed ≠ merged.

  Updating the required-check list is a GitHub admin action (Settings → Branches → main →
  edit rule), not a repo file. Keep the bullets above in sync if the gate ever changes.

  **If your PR adds a new CI check that should block merge, flag it to the user in the PR
  description.** Agents can't toggle branch protection (the Niteshift GitHub App token is
  user-to-server scope and 403s on that endpoint), so a new "should-be-required" check is
  silently non-required until a human ticks the box. The trap is invisible: CI looks green,
  PRs merge, and the new gate catches nothing. The 2026-05-16 audit found `Mobile Metro
bundle` and `Migrate smoke` had been shipped as designed-to-be-required but never wired
  in — both 2026-04-24 outages would have shipped again. When opening the PR, end the
  description with an "After merge" section telling the user exactly what to add and why
  (mirror the format of #182's PR description). Also bump the bullet list above in the
  same PR so the doc and reality stay aligned post-flip.

- **Dependency upgrades go through Dependabot.** Don't manually bump npm/Actions/Terraform deps
  unless there's a specific reason (security fix, unblocking work). Monthly PRs on the first
  Monday, aggressively grouped.
- **Logger**: use `logger` from `apps/backend/src/lib/logger.ts`. Pass full error objects:
  `logger.error("failed to x", { error })`, not `{ error: error.message }` — you lose the stack.
- **Postgres connection pool**: `postgres({ max: 1 })` is correct for Lambda. Each container has
  its own connection.
- **Runtime imports from `@workshop/shared` go through a subpath, not the barrel.** The barrel
  (`packages/shared/src/index.ts`) re-exports `./types.js` because `apps/backend` runs on
  `moduleResolution: "NodeNext"` and would otherwise break with TS2835. Metro can't resolve
  those `.js` extensions at runtime — `import type` from `@workshop/shared` is fine (Metro
  elides it), but a value import from the bare specifier crashes with `Unable to resolve
"./types.js"`. Pure-runtime constants live in `packages/shared/src/constants.ts` and are
  exported via `"./constants": "./src/constants.ts"` in the package's `exports` map. Import
  them with `import { SHARED_TYPES_VERSION } from "@workshop/shared/constants"`. Add new
  pure-runtime exports to `constants.ts` (or another non-barrel subpath), not to `types.ts`.
- **`scripts/e2e.sh` collides with the running dev servers.** It spawns its own backend
  (`:8787`) and web (`:8081`) on the same ports `pnpm dev` (and the Niteshift sandbox) use.
  Kill anything bound to those ports before running it; don't rely on `--kill-others-on-fail`
  to clean up — that's the e2e script's own children, not the pre-existing dev servers.
- **`useColorScheme()` returns `null` on web during the first render.** Before
  `prefers-color-scheme` hydrates, React Native Web's `useColorScheme()` is
  `null | undefined`, not `"light"`. A naive `scheme === "dark" ? darkTokens
: lightTokens` ternary silently flips the app to light on first paint.
  Default to the baseline mode explicitly: `scheme === "light" ? lightTokens
: darkTokens` (or the reverse, depending on which mode is the default).
  See `apps/workshop/src/ui/ThemeProvider.tsx` for the pattern.
- **Reanimated press-feedback: wrap `Pressable`, don't replace it.**
  `Animated.createAnimatedComponent(Pressable)` looks tempting, but
  `Pressable`'s `style={({ pressed }) => [...]}` callback re-resolves on
  every render and clobbers any transform animation routed through the same
  animated component. Wrap a plain `<Pressable>` inside an `<Animated.View>`
  (or `<Animated.Pressable>` for ref-only animations) and keep the
  press-state styling on the inner `Pressable`. `UpvotePill` is the
  canonical reference. See AGENT-REFLECTIONS.md 2026-04-28 (Phase 5d).
- **`react-native-worklets` babel plugin is auto-wired by
  `babel-preset-expo`.** Reanimated 4 needs the worklets babel plugin to
  transform `worklet` functions; when `react-native-worklets` is a dep,
  `babel-preset-expo` includes it automatically. Don't add
  `react-native-worklets/plugin` to `babel.config.js` manually — it'll run
  twice and either no-op or break with confusing duplicate-transform errors.
- **For animated text, use `AnimatedText` from `src/ui/Text.tsx`.** Raw
  `<Animated.Text>` strips our `variant` / `tone` props, so a `body`-sized
  title that gets switched to `<Animated.Text>` for an opacity crossfade
  silently loses its `fontSize` / `fontWeight`. `AnimatedText` is the same
  surface as `Text` but accepts animated styles; reach for it instead of
  re-applying styles by hand on `Animated.Text`.
- **Don't spread dnd-kit's `attributes` onto a `View` that wraps a
  `Pressable`.** `useSortable` / `useDraggable` return an `attributes` bag
  with `role: "button"` and `tabIndex: 0`, and react-native-web renders any
  `View` with `role="button"` as an HTML `<button>`. The inner `Pressable`s
  also render as `<button>`s, so spreading the bag wholesale produces a
  "button cannot contain a nested button" DOM-nesting warning. We only use
  Mouse/Touch sensors (no KeyboardSensor), so strip `role` and `tabIndex`
  before spreading — see the `stripButtonRole` helper in
  `apps/workshop/src/screens/listDetail/ItemList.web.tsx`.
- **Per-(list, viewer) presentation state lives on `list_members`.** The
  `pinned_at`, `archived_at`, `muted_at` columns are timestamps that double
  as flags (NULL = not set). `last_read_at` for unread-count derivation
  lives in the older `user_activity_reads` table — don't duplicate it on
  `list_members` (we did once during PR #165's first draft and ripped it
  back out). `GET /v1/lists` joins both into `ListSummary` so the home
  client gets the full per-viewer picture in one round trip. Endpoints
  follow `POST /v1/lists/:id/{pin,archive,mute,read}` to set + `DELETE` to
  clear; the three toggleable flags also accept `DELETE`, but `read` is
  one-way (its inverse — "mark unread up to now" — doesn't have a
  meaningful product semantic in a feed model). Don't confuse this
  per-viewer `archived_at` (the "stash from my home feed" toggle) with
  the global `archived_at` columns on `lists` / `items`, which are the
  soft-delete markers below.
- **Lists and items are soft-deleted via `archived_at`.** `DELETE
/v1/lists/:id` (owner-only) and `DELETE /v1/items/:id` set the row's
  `archived_at` instead of removing it; cascade FKs stay configured for
  the unarchive surface that hasn't shipped yet. Every read path filters
  `archived_at IS NULL` — `requireListMember` and `requireItemMember`
  both 404 archived rows (so handlers downstream can trust active
  state), `GET /v1/lists` adds `WHERE l.archived_at IS NULL`, items
  reads filter both the item's and the parent list's marker, the
  activity feed joins through `lists` + `items` to drop events on
  archived parents, and the public invite preview / accept flow checks
  the same. **When you add a new query that touches `lists` or `items`,
  add the same filter** — the partial behavior is opt-out, not opt-in.
  Activity events for the action itself land as `list_archived` /
  `item_archived` (legacy `item_deleted` is kept in the enum for
  pre-2026-05 rows). For album-shelf items the partial unique index on
  `(list_id, spotifyAlbumId)` includes archived rows, so a refresh
  won't resurface an album the user explicitly archived.
- **The home unread count is server-authored, not derived client-side.**
  The bell badge is `sum(list.unreadCount across non-muted lists)`, and
  each row reads `list.unreadCount` directly from `ListSummary`. Don't
  reintroduce the client-side cutoff-against-`getActivityLastViewedAt`
  derivation — it was wrong on multiple axes (no per-list granularity,
  cleared everything on a single `/activity` visit). The latest event
  array is still loaded for subtitle attribution ("2 new from Sarah"),
  which needs an actor name the count alone doesn't supply.
- **Real-time on web today is `useLivePollingInterval` (15s, visibility-
  gated).** No SSE / WebSocket transport yet — Lambda Function URLs with
  response streaming is the natural next step. The hook is at
  `src/hooks/useLivePollingInterval.ts`; wire it into queries on
  multiplayer surfaces by passing the result to `refetchInterval`. On
  native it returns `false` (no polling) — the existing
  `refetchOnWindowFocus` + AppState integration handles foreground
  refresh, and a background timer would be a battery tax we don't ship.
- **Wrap top-level screens in `Screen` from `src/ui/Layout.tsx`** when adding a
  new route. On native it's a no-op `flex: 1` view; on web it constrains the
  content to a ~560px reading column with `alignSelf: center`. Without it, a
  RN-Web app at desktop width stretches edge-to-edge — list rows render
  full-bleed at 1920px with content clustered at the left edge and trailing
  affordances drifting to the right column. Existing screens that use it:
  home, list-detail, activity, create-list/{type,customize,playlist,share}.
  The `Sheet` modal is intentionally _not_ inside the column on web (it
  stays a system-level overlay) — that's fine.

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

## Admin runbook

Operational commands for the cross-system surfaces this project owns. For "should I
do this without asking" gating, see "Safe changes vs careful changes" below.

Most of these need admin credentials. Two surfaces:

- **Laptop sessions** — secrets live in `~/.workshop-admin.env` (gitignored, mode 600).
  Run the `/admin-elevate` skill at the start of a session that needs writes — it sources
  the file and runs a health-check sweep, then echoes which credentials are live.
- **Niteshift sandbox sessions** — secrets are injected as env vars at task start. AWS
  is special: Niteshift uses role assumption (no static keys), so `AWS_ACCESS_KEY_ID` /
  `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` appear automatically with 1h auto-refresh.
  The assumed role is defined in `infra/niteshift.tf`. To rotate the External ID:
  Niteshift → Settings → Repositories → workshop → AWS → "Generate New ID", then update
  `var.niteshift_external_id` in tfvars (or the HCP workspace variable) and apply.

| Goal                                            | Command                                                                                                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ship an infra change                            | Open a PR; the PR comment shows the plan. Merge — `.github/workflows/terraform.yml` auto-applies. Manual `terraform apply` is bootstrap-only (see Terraform deploy pipeline below) |
| Preview an infra change locally                 | `cd infra && AWS_PROFILE=workshop-prod terraform plan` (no apply needed — CI does it)                                                                                              |
| See what infra would change on main             | `gh workflow run terraform.yml --ref main` (workflow_dispatch runs plan + opens an `infra-drift` issue if anything is pending)                                                     |
| Tail prod logs (last 10m, errors)               | `AWS_PROFILE=workshop-prod ./scripts/logs.sh --since 10m --filter error`                                                                                                           |
| Trace one request id                            | `AWS_PROFILE=workshop-prod ./scripts/logs.sh --filter <reqid>`                                                                                                                     |
| psql into Neon prod                             | `AWS_PROFILE=workshop-prod ./scripts/db-connect.sh`                                                                                                                                |
| Spin a Neon branch for a risky migration        | `neonctl branches create --name pre-<feature>` (requires `NEON_API_KEY`)                                                                                                           |
| Read an SSM secret                              | `AWS_PROFILE=workshop-prod aws ssm get-parameter --name /workshop-prod/X --with-decryption --query 'Parameter.Value' --output text`                                                |
| Rotate an SSM secret                            | `aws ssm put-parameter --name /workshop-prod/X --value … --overwrite --type SecureString` — note `lifecycle { ignore_changes = [value] }` so Terraform won't drift the next apply  |
| Deploy web to preview (branch)                  | `pnpm deploy:pages:preview` (requires `CLOUDFLARE_API_TOKEN`)                                                                                                                      |
| Deploy web to production                        | `pnpm deploy:pages` (always-confirm — see below)                                                                                                                                   |
| Force a fresh TestFlight build                  | `gh workflow run testflight.yml --ref main --field force=true`                                                                                                                     |
| Bypass EAS submit (when submit queue is jammed) | download IPA from EAS dashboard, then `xcrun altool --upload-app --type ios -f ~/Downloads/workshop.ipa -u joshlebed@gmail.com -p "$APPLE_APP_SPECIFIC_PASSWORD"` (macOS-only)     |

The "Sources of truth" map below lists where each system's UI/state lives if you need to
read or change something the CLI doesn't cover.

## iOS deploy pipeline

The iOS pipeline has more moving parts than the backend, and the failure modes
need different recovery paths. Read this before trying to debug a TestFlight
problem — the wrong fix at the wrong layer wastes EAS build minutes (free-tier:
30/month).

### First diagnostic when "iOS is missing a feature web has"

When a feature is reportedly shipped (merged to main, web shows it) but missing
on iOS, the answer is almost always the deploy pipeline, **not** a per-platform
code difference. Before reading any RN code or chasing platform `.web.tsx`
divergence, check (in order):

1. **Did the OTA actually ship?** Look at the most recent `Deploy Mobile (OTA)`
   run on main: was it green, what runtime version did it target?
   ```bash
   gh run list --workflow=deploy-mobile.yml --branch=main --limit=3
   gh run view <run-id> --log | grep -E "Runtime version|Branch  *production"
   ```
2. **Does the installed TestFlight build's runtime version match the OTA's?**
   The user's app only picks up the OTA when its `runtimeVersion` (now
   `appVersion`, i.e. the `version` field in `app.json` at build time) matches
   the OTA's target. A TestFlight build from `version: 0.1.0` will _never_ apply
   an OTA targeting `0.2.0`, however many times the user force-quits.
3. **Has the latest TestFlight build actually finished + been installed?** The
   `testflight.yml` workflow now awaits the EAS build (~30 min) and reports
   real status. A red testflight run means the OTA channel is correct but no
   matching binary exists yet for users to install.

This shortcut would have saved most of the 2026-05-15 debugging session that
landed PR #160 — the bug was diagnosed as a per-platform code bug ("kebab
goes to wrong screen on iOS") when the actual root cause was that no
TestFlight build had landed for ~24h (runtime-version mismatch wedging the
EAS Build pipeline silently), so the iOS device was still running pre-#154
JS bundled into pre-#149 native code.

### The four layers

```
Apple Developer Portal  ←→  EAS Build infrastructure  ←→  GitHub Actions  ←→  Code/config
```

- **Apple Developer Portal** owns identifiers, capabilities, certificates, profiles. Manual
  config that EAS reflects/syncs.
- **EAS Build/Submit** runs the actual iOS build on Apple Silicon, signs with the certs/profiles
  it manages, then submits the IPA to App Store Connect for TestFlight processing.
- **GitHub Actions** orchestrates: computes fingerprint (as a CI idempotency key), calls
  `eas build --auto-submit` and **awaits the build**, tags the fingerprint only after the
  build is confirmed green. The TestFlight submit still runs on EAS infra (`--auto-submit`)
  but no longer falls outside the GH workflow's success signal: an EAS build failure now
  surfaces as a red CI run instead of a silent stuck pipeline. Lives in `testflight.yml`.
- **Code/config** is what EAS Build packages: `app.json` plugins/entitlements, `eas.json` build
  profile, source code.

### Await-the-build model (and why we don't use `policy: "fingerprint"` for runtime version)

`testflight.yml` runs `eas build --auto-submit` without `--no-wait` — the GH Actions runner
blocks for the full ~25–30 min build, then exits success/failure based on the actual EAS
build outcome. Auto-submit chains on EAS's side after the build succeeds (the job doesn't
block on submission; check App Store Connect for that). Cost: ~150 GH Actions minutes/month
at ~5 native builds/month, well inside the 2000-minute free-tier ceiling.

Why we changed from `--no-wait` (the old fire-and-forget model): EAS Build added a
`Configure expo-updates` step that fails the build when the runtime version computed
pre-submit (on the GH Actions Linux runner via `@expo/fingerprint`) disagrees with the
runtime version computed during prebuild (on EAS's macOS builder). They _will_ disagree
under `policy: "fingerprint"` because:

- The macOS-side prebuild generates an `ios/` directory that the Linux fingerprint never
  sees (the file is "added" in the EAS-vs-local diff).
- Several native package directories (`@react-native-async-storage/async-storage`,
  `react-native-reanimated`, `react-native-safe-area-context`, `react-native-screens`,
  `react-native-worklets`) have different content hashes on Linux vs macOS — postinstall
  artifacts, platform-conditional files, etc.

Result: every TestFlight enqueue silently failed on EAS infra for ~24h while
`--no-wait` returned green and the fingerprint tag got written. Two changes locked this
out:

1. **Runtime version policy is now `"appVersion"`** (in `app.json`), not `"fingerprint"`.
   Runtime version is just the `version` field, so `eas build` and `eas update --auto`
   produce identical values on every host. **The cost is manual and severe if forgotten:
   when you add a native module or change a config plugin, you MUST bump `version` in
   `app.json` in the same PR.** Concretely:
   - You add `react-native-foo` (a native module) in PR #N without bumping version. CI
     builds a fresh TestFlight binary at `version: "0.1.0"` containing the new native
     code. `deploy-mobile.yml` _also_ publishes an OTA targeting `0.1.0`. That OTA's JS
     bundle calls into native symbols that the **already-installed** TestFlight build
     (also `0.1.0`, but from before PR #N) doesn't have. The OTA downloads, applies, and
     the app crashes on next launch with `Native module RNFoo cannot be null`. Existing
     users have to delete + reinstall.
   - Bumping to `0.2.0` in the same PR makes the new OTA target `0.2.0`, which only the
     post-PR-#N TestFlight build claims, so old installs stay on the last `0.1.0` OTA.
     `appVersion` is _safe_ when paired with a version bump and _dangerous_ without one.
     There's currently no CI check enforcing this — when in doubt, bump.
2. **The workflow awaits the build**, so a `Configure expo-updates` (or any other) failure
   now turns CI red and the fingerprint tag isn't written. The next push retries cleanly.

Fingerprint tag (`ios-fp-<hash>`) is still used as a CI idempotency key — it just decides
whether to enqueue a build, not the runtime version. It's written after build success, so
a poisoned tag from a failed build can't strand subsequent pushes.

Manual recovery if a tag does get stuck (e.g. the build succeeded but auto-submit failed
and you want to force a fresh build + submit cycle):

```bash
git tag -d ios-fp-<hash>
git push origin :refs/tags/ios-fp-<hash>
gh workflow run testflight.yml --ref main --field force=true
```

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

| System                          | URL                                                                                    | What it owns                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **EAS dashboard**               | <https://expo.dev/accounts/joshlebed/projects/workshop>                                | iOS build history + IPAs, submission queue status, fingerprint tags, EAS Update channels, monthly build-minute quota                                                                                                                                                                                                                                                           |
| **App Store Connect**           | <https://appstoreconnect.apple.com>                                                    | TestFlight builds, app metadata, App Store listings, ASC API keys                                                                                                                                                                                                                                                                                                              |
| **Apple Developer Portal**      | <https://developer.apple.com/account/resources/identifiers/list>                       | App IDs, capabilities, App Groups, provisioning profiles, signing certificates                                                                                                                                                                                                                                                                                                 |
| **Google Cloud Console**        | <https://console.cloud.google.com/apis/credentials?project=workshop-494616&authuser=1> | OAuth client IDs (iOS, web), API keys (Books), enabled APIs                                                                                                                                                                                                                                                                                                                    |
| **TMDB**                        | <https://www.themoviedb.org/settings/api>                                              | TMDB v3 API key (movies/TV enrichment)                                                                                                                                                                                                                                                                                                                                         |
| **AWS SSM Parameter Store**     | `aws ssm describe-parameters` (region us-east-1, prefix `/workshop-prod/`)             | Lambda env values (DATABASE_URL, OAuth audiences, API keys); `lifecycle { ignore_changes = [value] }` so direct `put-parameter --overwrite` doesn't drift Terraform state                                                                                                                                                                                                      |
| **HCP Terraform**               | <https://app.terraform.io/app/josh-personal-org/workspaces/workshop-prod>              | All AWS infra state (Lambda, IAM, SSM resources, API Gateway, etc.)                                                                                                                                                                                                                                                                                                            |
| **Cloudflare Pages**            | <https://dash.cloudflare.com/?to=/:account/pages/view/workshop>                        | Web build env vars (the `EXPO_PUBLIC_*` audience values), build logs, production URL `workshop-a2v.pages.dev`                                                                                                                                                                                                                                                                  |
| **GitHub Actions**              | <https://github.com/joshlebed/workshop/actions>                                        | CI workflow runs, deploy workflow runs, fingerprint tags (as git tags)                                                                                                                                                                                                                                                                                                         |
| **Neon**                        | (managed; connection string in SSM `/workshop-prod/db/url`)                            | Production Postgres data                                                                                                                                                                                                                                                                                                                                                       |
| **Discord (`#workshop-admin`)** | webhook URL in SSM `/workshop-prod/discord/notify_webhook_url`                         | Operator notifications for new signups + new lists (see `apps/backend/src/lib/discord.ts`). To rotate: Discord channel → ⚙ → Integrations → Webhooks → regenerate; then `aws ssm put-parameter --name /workshop-prod/discord/notify_webhook_url --type SecureString --value … --overwrite`. SSM resource has `ignore_changes = [value]` so a rotation doesn't drift Terraform. |

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

## Terraform deploy pipeline

`infra/` changes ship through `.github/workflows/terraform.yml`, which owns the full
Terraform lifecycle with three triggers:

- **PR (paths: `infra/**`or`terraform.yml`)** → `terraform plan -detailed-exitcode -refresh=false`,
  posted as a sticky comment on the PR. Plan is **informational**, not a required check;
  a bad plan surfaces as a red post-merge apply (caught loudly there).
- **Push to `main` (same paths)** → `terraform apply -auto-approve`, followed by a `/health`
  smoke test. No human gate beyond the PR review that already gated the merge.
- **Weekly cron (Mondays 13:00 UTC)** + `workflow_dispatch` → plan; opens / updates a single
  `infra-drift` GitHub issue if drift is detected. Safety net for any state drift introduced
  outside Terraform (console edits, etc.).

### Roles, variables, and the `-refresh=false` workaround

Plan uses the existing narrow `AWS_ROLE_ARN` (Lambda + `ssm:GetParameter` on `db/url` and
`session_secret`). It runs with `-refresh=false` so it doesn't try to re-read every
`aws_ssm_parameter` (the role can't see most of them — 403s otherwise). The case this
misses is true out-of-band drift on an SSM value (someone edits via the console); apply's
plan (admin role) catches that downstream.

Apply uses `AWS_ROLE_ARN_TF_APPLY` — `AdministratorAccess`, assumable **only** by the
`ref:refs/heads/main` sub claim. Fork PRs and any non-main push cannot produce that sub
even with `id-token: write`, so they cannot apply. Broad perms because Terraform manages
IAM (including this role's own trust policy) — scoping tighter doesn't shrink blast
radius and creates ongoing least-privilege debugging.

Variables, because the HCP workspace is Local-mode (vars aren't injected automatically):

- `database_url` — fetched from SSM `/workshop-prod/db/url` at job runtime via OIDC.
- `niteshift_external_id` — GH Actions secret `NITESHIFT_EXTERNAL_ID`.
- Everything else (Apple/Google/TMDB/Books/Spotify) — uses the variable's empty-string
  default. The backing SSM params have `lifecycle { ignore_changes = [value] }`, so apply
  with `""` doesn't clobber the live values that ops set out-of-band.

If you add a new required variable in `infra/variables.tf` (no default), wire it into
both jobs' env blocks **and** add the matching GH secret (or extend the SSM-fetch path)
in the same PR — otherwise the next apply fails on "no value for required variable".

### Plan-vs-apply race (re-plan-at-apply tradeoff)

Apply re-plans at apply time rather than consuming a saved plan from the PR-time job. If
two `infra/` PRs merge back-to-back, the second apply re-plans against the post-first
state and may do something the second PR's plan comment didn't reflect. HCP's workspace
lock prevents concurrent applies (the second waits); branch protection gates merges.
Solo-repo low risk; revisit when a second contributor lands.

### Cross-workflow inconsistency window

A PR touching both `apps/backend/**` and `infra/**` triggers both `deploy-backend.yml`
and `terraform.yml` on merge — they run in parallel, no ordering. Today the Lambda's
`ignore_changes = [filename, source_code_hash]` means the two paths are independent, but
if a future change couples backend code to a new env var Terraform sets, the code deploy
could land before the apply. Either bump the app version with a runtime-version-mismatch
guard, or split into infra-first + code-second PRs.

### Bootstrap (only matters when expanding the apply role's perms)

The apply role is itself Terraform-managed. To change its trust policy or attached
policies you need an existing, more-privileged actor to run the first apply that enacts
the change. Standard pattern: run `AWS_PROFILE=workshop-prod terraform apply` from a dev
laptop once (your SSO `AdministratorAccess` can grant the perms), then let CI take over.
Document the manual step in the PR description.

### Recovery: apply fails on main

`gh run view <run-id> --log` shows the failure. Common cases:

- **Plan failed** (validation, missing TF_VAR) → fix on a new PR; normal flow resumes.
- **Apply failed partway** → HCP locks the workspace; the next push retries. If a single
  resource is stuck mid-modify, `terraform apply` from a dev laptop with the same vars
  resumes (state is in HCP).
- **State lock held by aborted run** → see "Known gotcha: HCP Terraform state lock" above.

## Safe changes vs careful changes

- **Safe** (green light, just push): new routes, new Expo screens, new Drizzle columns
  with defaults, new tests, new scripts, **`infra/` changes whose PR-time plan matches
  expectations** (CI applies on merge automatically).
- **Careful** (read the PR-time plan output before merging): destructive `infra/` changes
  (resource recreation, IAM policy edits, deleting SSM params with non-default data);
  rotating `database_url` (Lambda env var updated, in-flight requests may briefly fail).
- **Ask first**: deleting DB data, changing the Lambda runtime major version, rotating
  the OIDC provider, expanding the `tf-apply` role's perms or trust policy, adding a new
  AWS service (every service has a free-tier implication), touching anything in a
  _different_ AWS account than Workshop's.

### Admin actions: auto-allowed vs always-confirm

Once `/admin-elevate` is active (or running in a Niteshift sandbox with the AWS role
assumed), the day-to-day grey areas:

**Auto-allowed** (just do it, mention in chat):

- `terraform plan`, `terraform output`, `terraform state list`, any log read
- `aws ssm get-parameter` (incl. `--with-decryption`)
- `aws lambda get-function-configuration` / `get-function`
- `pnpm deploy:pages:preview` (preview branch, not prod)
- `neonctl branches create` (any non-`main`/`prod*` name)
- Lambda env var rotation via `aws lambda update-function-configuration` (reverted on the
  next CI apply if SSM source ignores changes — useful for ad-hoc experiments)
- Rerunning a failed CI job, `gh workflow run` for non-deploy workflows

**Always confirm**:

- Manual `terraform apply` (CI applies on merge; only run locally as a bootstrap or to
  recover a stuck apply — see Terraform deploy pipeline)
- Any Cloudflare DNS change
- `pnpm deploy:pages` to production
- Any change to GH branch protection or required checks
- `neonctl branches delete` for `main` or anything matching `prod*`
- Apple Developer Portal capability toggles (EAS sync semantics — see iOS pipeline)
- OIDC provider rotation, GH Actions IAM role policy edits (especially `tf-apply` trust)
- Adding a new AWS service (free-tier blast radius)
- Anything in a _different_ AWS account than Workshop's

**Prohibited** (do not do, even with confirmation):

- Force-push to `main`
- `terraform destroy` on prod
- `DROP TABLE` / `TRUNCATE` on prod Neon
- Rotating `SESSION_SECRET` without first warning the user that all sessions invalidate
- Removing Niteshift's IAM role trust policy while a task is in-flight (it'll lose creds mid-run)

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
`apps/backend/.env` on first run (generating `SESSION_SECRET`), applies Drizzle migrations,
seeds dev fixtures (idempotently — see "Dev data seed" below), then uses `concurrently` to
run the backend (`tsx watch`) and `expo start --web` with `[backend]` / `[web]` prefixes in a
single terminal. Ctrl-C stops both. `app.json` already points `apiUrl` at
`http://localhost:8787`; backend CORS is `origin: "*"`.

### Dev data seed

`apps/backend/scripts/seed.ts` populates the local Postgres with a "lived-in" set of lists
(movie / tv / book / date_idea / trip / game) owned by `preview@workshop.local` — the same
identity the web app's auto-dev-sign-in uses (`apps/workshop/src/hooks/useAuth.tsx`). A
second user `friend@workshop.local` is added as a member on a few shared lists with one
upvote each, plus a handful of recent `game_scores` rows so the game-detail screen renders
non-empty.

Both `scripts/dev.sh` and `niteshift-setup.sh` run `pnpm --filter @workshop/backend run db:seed`
after migrations. The script is idempotent (bails the moment it finds the preview user owns
any list) and hard-guards against non-local stages, so re-running setup is safe and prod
can't be touched. Set `SEED_DEV_DATA=0` to skip when reproducing empty-state bugs. To
re-seed locally, blow away the preview user (`DELETE FROM users WHERE email LIKE
'%@workshop.local';`) and re-run `pnpm --filter @workshop/backend run db:seed` — the seed
restores the same fixture set.

When adding a new list type or item-metadata field, extend `seed.ts` so the next agent or
human gets coverage for it on first load.

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

### Web HTML shell lives in `apps/workshop/public/index.html`

The web bundle uses `app.json` → `web.output: "single"`, which means Expo Router's
`+html.tsx` static-rendering hook is **not** invoked. Expo CLI builds the HTML from
`apps/workshop/public/index.html` (project-local override) and falls back to the
bundled `node_modules/@expo/cli/static/template/index.html` if absent. This is where
the iOS Safari URL-bar / home-indicator tint (`<meta name="theme-color">`),
`viewport-fit=cover`, and the html/body `background-color` lock live — without them,
the system bars render white in iOS light mode no matter what the app shell paints.
If you switch to `output: "static"` someday, port these meta tags into a `+html.tsx`
in the same PR; until then, edit `public/index.html`.

## Per-area guides

- `apps/backend/CLAUDE.md` — Hono + Drizzle patterns, Lambda bundling
- `apps/workshop/README.md` — Expo app structure
- `infra/README.md` — Terraform layout

## Share-link Open Graph previews

Share URLs (`https://workshop-a2v.pages.dev/invite/<token>`) get
per-list iMessage/Facebook/Twitter previews via two Cloudflare Pages
Functions at the repo root (`functions/invite/[token].ts` and
`functions/og/invite/[token].ts`). The metadata flow is:

```
GET /invite/:token  →  fetch /v1/invites/:token/preview  →  HTMLRewriter injects OG tags into SPA index.html
GET /og/invite/:token.png  →  workers-og renders 1200×630 PNG using Satori + resvg-wasm
```

Two non-obvious things to keep in sync:

- **OG image must be a real raster (PNG/JPEG).** Apple Link Presentation
  and Facebook silently drop SVG `og:image` even though both _claim_ to
  accept it — symptom is a blank white image card with the title +
  description still rendering correctly. The 2026-05-16 first pass
  shipped SVG and had to be replaced. The rasterizer is `workers-og`
  (Satori-based) running inside the Pages Function.
- **The Pages Functions must NOT import from workspace packages.**
  Cloudflare Pages's bundler (esbuild via Wrangler) runs at the repo
  root, but `functions/` isn't a pnpm workspace member, so
  `node_modules/@workshop/` doesn't exist there for esbuild to follow.
  PR #168 and #169 both shipped a `@workshop/shared/og` import in
  `functions/_lib/og.ts` and both deploy-failed with
  `Could not resolve "@workshop/shared/og"` — production stayed on
  the previous version for hours with zero visibility outside the CF
  dashboard. The fix is to keep the function code self-contained: the
  pure metadata helpers (`buildMetaTags`, `buildOgImageHtml`,
  `escapeXml`, `truncate`, color/type tables, `OG_IMAGE_WIDTH/HEIGHT`)
  are inlined into `functions/_lib/og.ts`. A mirror copy lives in
  `packages/shared/src/og.ts` so vitest can unit-test the same surface
  (`packages/shared/src/og.test.ts`); if you edit one, update both in
  the same PR. Anything imported from `@workshop/shared/*` inside
  `functions/**` will silently fail the CF Pages build on next merge.

### Verifying a thumbnail after deploy

The platforms cache aggressively (Facebook caches per-URL for ~30 days,
iMessage per-conversation forever — there's no "purge my preview"
button for users). So verify against a freshly-generated invite each
time, not a token you've already shared:

```bash
# 1. Generate a new invite via the API (auth required for create; the
#    /preview endpoint is intentionally public for the scrapers)
TOKEN=$(curl -sS -H "Authorization: Bearer $JWT" -X POST \
  https://<api>/v1/lists/<list-id>/invites -d '{}' \
  -H "Content-Type: application/json" | jq -r .invite.token)

# 2. Run the post-deploy validator against the share URL it builds
node scripts/check-og.mjs "https://workshop-a2v.pages.dev/invite/$TOKEN"
```

`scripts/check-og.mjs` is the agent / CI verification step. It (a)
curls the share URL with a Facebook/Apple-LP-shaped UA and asserts the
full OG tag set is present, (b) fetches `og:image` and verifies the
response is a valid PNG with `Content-Type: image/png` and dimensions
matching `og:image:width/height`, and (c) flags a fallback-to-bare-SPA
title as a failure (means the function couldn't reach the preview
API). It exits non-zero on any mismatch with a human-readable diff.
For a richer visual check, open the `og:image` URL in `agent-browser`
to confirm the thumbnail composition looks right.

For the gold-standard "does Facebook actually accept this image" check,
the FB Sharing Debugger has a public API:
`POST graph.facebook.com/v19.0/?id=<URL>&scrape=true&access_token=<APP_ID>|<APP_SECRET>`
returns the resolved `image[]` array; empty = your image was rejected.
We don't wire that into CI today (no FB app secret in the Pages env),
but it's the right escalation when `check-og.mjs` passes but Facebook
still shows nothing.

Apple LinkPresentation has no debug API — black-box behavior. The
closest signal is `check-og.mjs` passing with an Apple-shaped UA and a
visual eyeball via the agent-browser route above.

### Fast deploy loop for Pages Functions (skip CI)

The git-source CF Pages auto-build is slow (~3–5min) AND silent on
failure — see the workspace-import gotcha above. For iteration on
anything in `functions/**` or the OG renderer, deploy directly via
wrangler instead of waiting for merge → CI → CF auto-build:

```bash
pnpm deploy:pages:preview   # builds web + deploys to a preview branch
                            # URL (`<branch>.workshop-a2v.pages.dev`)
                            # named after the current git branch.
                            # ~30s end-to-end; doesn't touch prod.

pnpm deploy:pages           # builds web + deploys to production
                            # (workshop-a2v.pages.dev). Bypasses GH
                            # Actions entirely; loud failure if the
                            # functions bundle won't compile.
```

Both wrap `scripts/deploy-pages.sh` which handles the Node 22 switch
(wrangler@latest needs it) via nvm automatically. Auth via either
`wrangler login` (one-time, OAuth) or `CLOUDFLARE_API_TOKEN` in env.

The CI equivalent is `.github/workflows/deploy-pages.yml`, which fires
on push to `main` for `apps/workshop/**`, `packages/shared/**`, and
`functions/**`, runs `wrangler pages deploy`, then asserts the
production `/og/invite/...png` endpoint actually serves PNG bytes
before exiting green. Required GH secrets: `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` — see the workflow header for setup.
Once those are set, **disable the CF Pages git integration in the
dashboard** (Settings → Builds → Disconnect) so we don't double-deploy.

## Running commit-ready checks

```bash
pnpm run typecheck     # ~12s
pnpm run lint          # ~1s
pnpm run test          # ~2s
pnpm run knip          # ~2s — non-blocking in CI while the baseline is tuned; known findings
                       # include expo-splash-screen, @types/aws-lambda, closeDb, etc.
cd infra && terraform fmt -check -recursive && terraform validate
```
