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
(value in `terraform.tfvars.local`, gitignored).

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

## 2026-04 — Email magic codes (not magic links)

**Context**: MVP needs passwordless auth. Magic *links* require universal-link configuration on
iOS, which is finicky in Expo Go (dev) and requires Apple App Site Association files.

**Decision**: 6-digit numeric codes sent via SES. User types the code into the app.

**Why**: No deep-link plumbing. Works identically in Expo Go (dev) and TestFlight (prod). Familiar
UX (SMS codes, bank OTPs).

**Tradeoff**: One extra tap (type code) vs. one tap (click link). Worth it for simplicity.

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
