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

## 2026-04 — Postgres on RDS (public + SSL + strong password)

**Context**: Prototype with no real users, coding-agent-friendly debugging, AWS free tier.

**Decision**: `db.t4g.micro` RDS, `publicly_accessible = true`, security group open to
`0.0.0.0/0:5432`, forced TLS, 32-char auto-generated password stored in SSM Parameter Store.

**Why**: Putting RDS in a private subnet forces Lambda into a VPC, which forces a NAT Gateway
(~$32/mo) to reach AWS APIs — blows the free tier. For a prototype with no user data, the
"public endpoint + strong password + TLS" model is the same security posture as Neon/Supabase.

**Known risk**: The DB hostname is discoverable via DNS. Attackers actively scan for misconfigured
RDS instances. The password is strong and TLS is forced, so successful attack requires password
brute-force against forced TLS — slow and ratelimited by RDS.

**Migration plan (before real users)**:
1. Add a VPC module with two private subnets in different AZs.
2. Flip `publicly_accessible = false`, move RDS into the private subnets.
3. Put Lambda in the same VPC with security group allowing 5432 → RDS.
4. Add a VPC endpoint for SSM (so Lambda can still read secrets without a NAT Gateway). Or add
   RDS Proxy and skip VPC endpoints.
5. Downtime: ~1min DNS flip. Apply during a quiet window.

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
