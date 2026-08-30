# Decisions

Architectural choices, and the constraints behind them. Read this before proposing rewrites.

## 2026-04 — Expo for the iOS client

**Context**: Need TypeScript iOS client with fast iteration, over-the-air updates, and
TestFlight path.

**Decision**: Expo (managed workflow) + expo-router.

**Why**: EAS Update ships JS-only changes to a paired phone within ~60s. EAS Build + Submit
handles TestFlight with zero native config. TypeScript is first-class. Alternatives (Flutter,
SwiftUI, React Native bare) were either not TypeScript or required more native tooling.

**Known tradeoffs**: Native module additions require an EAS Build (burns free-tier quota). We
keep native changes behind a manual `workflow_dispatch` trigger, not auto-on-merge.

## 2026-04 — Hono on AWS Lambda for the API

**Context**: Need a cheap, TypeScript-first HTTP backend on AWS with minimal babysitting.

**Decision**: Hono framework, deployed as a single Lambda behind API Gateway HTTP API.

**Why**: Lambda's always-free tier (1M req/mo + 400k GB-sec) covers every realistic prototype
load. Hono compiles to a tiny bundle, has clean middleware semantics, and works in both Lambda
and Node server targets (we use the Node target for local dev).

**Alternatives considered**: EC2 t3.micro (free tier for 12mo, but you own the box); ECS Fargate
(not free); App Runner (not free).

**Known tradeoffs**: Cold starts ~300–500ms for a Node.js Lambda. Acceptable for this use case.
If latency ever matters, provisioned concurrency is a knob we can turn.

## 2026-04 — Postgres on Neon (superseded RDS)

**Context**: Initial prototype went live on RDS `db.t4g.micro` (public + SSL + strong password —
see the history below). During the AWS-account migration, RDS provision/destroy latency (8-10
min each way) became the slow part of every infra change. Revisited vendor choice.

**Decision**: Managed Postgres on **Neon** (`aws-us-east-1`, Connection Pooling on). Lambda
reads `DATABASE_URL` from an SSM SecureString populated from the `database_url` TF variable
(value in `terraform.tfvars`, gitignored).

**Why**:

- Free tier covers realistic personal-project usage (0.5 GB storage, 100 CU-hours/mo,
  autosuspend after 5 min idle). RDS `db.t4g.micro` is free only for the first 12 months, then
  ~$13-15/mo. Savings after year 1: ~$180/yr.
- Provisioning is seconds, not 8-10 min. Makes teardown/rebuild cheap during rapid iteration.
- No more VPC / NAT gateway question for "lock it down before real users" — Neon pooled
  connections are already TLS-only and not publicly DNS-scannable the same way RDS is.
- Wire-compatible Postgres 17. Drizzle + `postgres-js` driver works unchanged.

**Tradeoffs**:

- New vendor to manage (console, billing, API tokens) outside AWS.
- First query after 5 min idle pays a cold-start (~500ms-1s). Acceptable for a personal watchlist.
- Free-tier compute suspension is per-project; if this grows into multiple tenants, re-evaluate.

**Driver note**: Kept the `postgres-js` driver (TCP). Could switch to `@neondatabase/serverless`
HTTP driver for faster Lambda cold starts (~20-50ms vs ~100-200ms), but not needed at current
latency budget.

### Historical: 2026-04 — Postgres on RDS (replaced)

Initial choice was `db.t4g.micro` RDS, `publicly_accessible = true`, security group open to
`0.0.0.0/0:5432`, forced TLS, 32-char auto-generated password in SSM. Rationale was free-tier
alignment without needing a VPC+NAT gateway. Superseded by Neon for the reasons above. If we
ever move back to RDS-in-VPC, the original migration plan was: add VPC with two private subnets,
flip `publicly_accessible = false`, put Lambda in the VPC, add SSM VPC endpoint.

## 2026-04 — Drizzle ORM

**Decision**: Drizzle over Prisma/Kysely.

**Why**: Schema-in-TypeScript with auto-generated migrations. No codegen step. Light runtime.
Matches the team's existing muscle memory from Niteshift.

## 2026-04 — HCP Terraform for state

**Decision**: HCP Terraform free tier, not self-hosted S3+DynamoDB.

**Why**: No bootstrap script (chicken-and-egg for the state bucket). Web UI for state inspection.
One fewer AWS resource to babysit. Free for up to 5 users.

**Migration**: `terraform state push` to an S3 backend config is a documented one-shot if we ever
outgrow HCP free tier.

## 2026-04 — Email magic codes (superseded)

**Context**: MVP needs passwordless auth. Magic _links_ require universal-link configuration on
iOS, which is finicky in Expo Go (dev) and requires Apple App Site Association files.

**Decision**: 6-digit numeric codes sent via SES. User types the code into the app.

**Why**: No deep-link plumbing. Works identically in Expo Go (dev) and TestFlight (prod). Familiar
UX (SMS codes, bank OTPs).

**Tradeoff**: One extra tap (type code) vs. one tap (click link). Worth it for simplicity.

**Superseded**: The 2026 redesign replaced email/SES with Sign in with Apple + Google OAuth.
The section remains as decision history, not current implementation guidance.

## 2026-08 — Managed device sessions

**Context**: The single HMAC bearer token had a hard 14-day expiry and no refresh path. Production
logs showed otherwise healthy users reaching that boundary and being sent back to sign-in. Making
the bearer token itself last longer would increase the impact of a stolen token and still leave no
per-device revocation mechanism.

**Decision**: New clients use database-backed device sessions. Access tokens last one hour; rotating
refresh credentials extend a 180-day inactivity window up to a one-year absolute cap. Native stores
both credentials in SecureStore. Web stores only the access token in memory and receives the refresh
credential as a first-party HttpOnly, Secure, SameSite=Lax cookie through the Cloudflare Pages
`/api/*` proxy. Reuse of an old refresh credential outside a short concurrency grace window revokes
that device session. Normal signout revokes the current device; the existing sign-out-all cutoff also
revokes every managed session owned by the user.

**Rollout**: Requests advertise managed-session support with `X-Workshop-Session-Version: 2`.
Clients without it continue receiving legacy 14-day tokens. An updated client exchanges a still-valid
legacy token at `POST /v1/auth/session`; a temporary old-API response falls back to `/v1/auth/me`
without deleting the token. Network and server errors show a retry state and never become evidence
that the user signed out.

**Tradeoff**: Authenticated requests now verify a session row and refresh requires mutable database
state. In return, sessions survive normal app usage for months without turning long-lived bearer
tokens into permanent credentials.

## 2026-08 — Account deletion deletes the shared Workshop + HighScore account

**Context**: App Store Review Guideline 5.1.1(v) requires an in-app way to delete an account, and
Sign in with Apple requires revoking the user's Apple tokens when they do. Workshop.dev and
HighScore run on one backend and one `users` row — signing into HighScore with the Apple ID you use
on Workshop resolves to the same account. There was no deletion surface at all.

**Decision**: One authenticated, self-only endpoint, `DELETE /v1/users/me`. It deletes the account
across both apps in a single transaction rather than deactivating it, and the HighScore
confirmation states the Workshop impact explicitly instead of burying it. The alternative —
splitting the shared identity so HighScore could delete "just" its half — would mean a second
`users` table, a migration of the live friend graph, and a user-visible account split, all to make
a confirmation dialog shorter. Not worth it.

Owned lists are deleted outright (which takes other members' contributions _to those lists_ with
them); other users' own lists survive, minus the deleted user's items, activity and invites. Every
other user's data is untouched.

**Provider revocation**: The client now forwards Apple's one-time `authorizationCode`; the backend
exchanges it for a refresh token, seals it with AES-256-GCM under a `SESSION_SECRET`-derived key
(`lib/secretBox.ts`), and stores it on `user_identities` purely so deletion can call
`POST https://appleid.apple.com/auth/revoke`. Revocation runs **after** the data deletion commits
and never blocks it: the response reports `revoked` / `nothing_to_revoke` / `unavailable` /
`failed` per identity rather than assuming success. A user must never be stranded with a live
account because Apple timed out. Google needs no equivalent — we only verify an `id_token` and
never request offline access, so we hold nothing revocable.

**Deliberately not done**: no grace period or soft-delete tombstone. Apple's guidance is that
deletion means deletion; a "you have 30 days to change your mind" state is a second account
lifecycle to maintain and a second thing to get wrong.

**Tradeoff**: Deleting from HighScore destroys Workshop data. Accepted, stated in the
confirmation, and covered by tests.

## 2026-04 — No TMDB integration for MVP

**Context**: Client vs backend call to TMDB has infra implications (NAT Gateway if backend-side).

**Decision**: Ship MVP with manual title + year entry. No poster art.

**Why**: Simplest infra. Also forces the product to be useful before adding polish.

**Revisit when**: The first real complaint about UX warrants it. Then client-side TMDB (no backend
changes) is the follow-up.

## 2026-04 — GitHub OIDC, no long-lived AWS keys

**Decision**: GitHub Actions assumes an IAM role via OIDC. No `AWS_ACCESS_KEY_ID` stored in the
repo.

**Why**: Public repo, rotating keys manually is easy to forget, OIDC is the current best practice.
The trust policy is scoped to specific branches (`main`, PRs from this repo only — not forks).

## 2026-04 — Single environment (prod)

**Decision**: One Terraform env, one branch (`main`). No staging.

**Why**: Cost and complexity. For this scale, feature branches + manual testing on PR preview is
enough. We'll add staging if/when prod outages happen during deploys.

## 2026-04 — TestFlight build and submit are separate jobs

**Context**: EAS Build (compile + sign + produce .ipa) and EAS Submit (upload to App Store
Connect → TestFlight) are two distinct pipelines on Apple/EAS infrastructure. They fail in
different ways: build failures are usually code/signing/capability issues we caused; submit
failures are usually Apple/EAS infrastructure transients (App Store Connect 5xx, EAS
free-tier submission worker pool exhaustion, network).

The original `testflight.yml` ran them as a single `eas build --auto-submit --wait` step
inside one job. When submit failed, the IPA was already built but the workflow looked like
a single "TestFlight failure," and **the only retry path was rebuilding** — burning another
~15-min EAS build minute on a build we already had.

**Decision**: Split into independent jobs (`fingerprint` → `build` → `submit` → tag-on-success).
The `submit` job has an internal 3× retry with 60s backoff for one-shot transients. If the
internal retries exhaust, `gh run rerun --failed <run-id>` re-runs _only_ `submit` against the
existing IPA — no rebuild.

**Why**: We hit this exact failure on 2026-04-27 — an EAS submission worker timed out after
10 minutes ("Failed to create worker instance"), and the only "fix" with the old workflow
was a rebuild. The split costs ~10s of cold-start overhead per workflow run (the submit job
duplicates checkout + node setup) but eliminates the rebuild-on-submit-failure cost. With
EAS free tier capped at 30 build minutes/month, that's worth a lot.

**Tradeoffs**: The retry loop will burn ~3 minutes on a _real_ Apple rejection (it can't
distinguish transient from real from exit code alone). Rare; cost acceptable.

**Out of scope** (deferred): splitting into two _workflows_ (rather than two jobs) for
cleaner per-workflow run history. The job split gets ~80% of the value.

## 2026-04 — Stay on EAS free tier; manual recovery for queue contention

**Context**: EAS submission workers are pooled across the free tier. When demand spikes,
submissions queue. We've seen 10+ minute waits ending in "Failed to create worker instance"
timeouts. EAS paid tier ($99/yr) gives dedicated submission workers and generally faster
response times.

**Decision**: Stay on free tier. When queue contention happens, recovery options are:

1. Cancel the stuck workflow run + queued submissions, retry later when the queue is less
   congested.
2. Bypass EAS submit entirely: download the IPA from the EAS build dashboard, upload via
   `xcrun altool --upload-app` (Apple's CLI tool, ships with Xcode). 2 minutes vs an
   indefinite wait.

**Why**: This is a personal project; EAS submit queue contention has happened once during
intense iteration. $99/year for "rarely faster" submissions isn't worth it. The bypass via
altool is a 30-second runbook.

**Revisit when**: Submit queue contention happens >1×/month for two months in a row, or
when the project ships to a real userbase and TestFlight delays are blocking testers.

## 2026-04 — TestFlight workflow runs only on `main`, not on PRs

**Context**: TestFlight builds cost EAS minutes (~15-20 min each on the free tier's monthly
quota). Running them on every PR would burn the quota in a week and add 15+ min of CI to
every mobile-touching PR.

**Decision**: `testflight.yml` triggers only on `push: branches: [main]` (gated on
`@expo/fingerprint` to skip when the iOS native fingerprint hasn't changed). PRs get the
`Mobile Metro bundle` job in `ci.yml` (a fast Metro export smoke test) but no actual EAS
build.

**Why**: 30 build minutes/month is the free-tier ceiling. We typically expect ~3–5 native
builds/month based on phase-level estimates. Running on PRs would consume far more.

**Tradeoffs**: TestFlight failures only surface _post-merge_. A PR that breaks the iOS
build will reach `main`, fail testflight.yml, and require a follow-up fix PR. Mitigation:
the `Mobile Metro bundle` PR check catches most native-side problems (Metro codegen
errors, RN-drift past the SDK matrix) before merge.

**Revisit when**: If we hit a "broke main, can't ship" incident from this gap. Likely fix:
add a faster pre-merge native check (a stripped-down `expo prebuild` validation) without
running full EAS Build.
