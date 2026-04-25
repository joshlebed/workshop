# Workshop.dev — Redesign Implementation Plan

Status: proposed · Date: 2026-04-24 · Owner: @joshlebed

This is the engineering plan for executing the rewrite described in
[`docs/redesign-spec.md`](./redesign-spec.md). The spec defines the *what*; this
document defines the *how* — phases, PR decomposition, file-level deliverables,
dependencies, and risks.

The foundation stays (pnpm monorepo, Expo + expo-router, Hono on Lambda, Neon
Postgres, Drizzle, Terraform, EAS). The entire feature surface is replaced —
data model, API, client screens, and design system.

See [`CLAUDE.md`](../CLAUDE.md) for operational conventions and
[`docs/decisions.md`](./decisions.md) for infra rationale.

---

## 0. Guiding principles

- **Clean cutover, not dual-track.** The spec drops existing data and removes
  `/items` / `/auth` routes in favor of a `/v1` prefix. No compatibility layer.
  This keeps scope tight — the cost is one terminal deploy where old clients
  stop working. Acceptable pre-launch.
- **Backend before client per phase.** Ship new routes (behind tests) first, then
  wire screens. The dev loop and E2E tests need real endpoints.
- **Ship phases independently.** Each phase in §3 lands as its own PR (or small
  stack). Between phases, `main` is always deployable even if the client UI is
  partially new. Use local feature flags in the client (`const ENABLE_V2 =
  false`) only where strictly needed to avoid broken screens on `main`.
- **Shared types first.** Every API change starts by editing
  `packages/shared/src/types.ts`. Backend and client both depend on it, so the
  type error is the to-do list.
- **Test the golden path per phase.** Don't defer all E2E tests to Phase 5.
  Each phase adds one Playwright happy-path for its feature so regressions
  surface early.

---

## 1. Starting state (what we're replacing)

From the repo survey (see `docs/redesign-spec.md` §14 for the migration
contract):

- **Backend**: `apps/backend/src/routes/auth.ts`, `items.ts`, `health.ts`.
  Single-user watchlist semantics (`rec_items.count` on duplicate-add,
  per-user `completed`). No lists, no groups, no upvotes.
- **DB**: `users`, `magic_tokens`, `rec_items` tables only.
- **Client**: `apps/workshop/app/_layout.tsx`, `index.tsx`, `sign-in.tsx`.
  ~300-line home screen with category tabs + per-category "watched/unwatched"
  toggles. Components under `src/components/` (`ItemCard`, `AddEditModal`,
  `CategoryDropdown`, `Tabs`, `DataPanel`, `ContextMenu`, `HeaderMenu`).
- **Shared**: `packages/shared/src/types.ts` has `RecItem`, `RecCategory`, and
  the paired request/response types.
- **Theme**: hardcoded dark palette in `src/components/theme.ts`. No token
  object, no `useTheme` hook, no primitives library.
- **Testing**: `vitest` unit tests on the backend (`lib/session.test.ts`).
  Client has no tests. No Playwright.

Everything above is deleted or rewritten. Infra survives **except SES**:
Terraform, GitHub Actions, SSM, Lambda, API Gateway, Neon, EAS stay; SES is
removed entirely in Phase 0 (see §6 — auth moves to OAuth, invites move to
share-link only, so nothing in v2 sends email).

---

## 2. Cross-cutting workstreams

These flow through every phase and are not separate PRs:

| Workstream | Owner | What it means per phase |
|---|---|---|
| Shared types | `packages/shared` | Every new endpoint gets its request/response types added here first. |
| Zod at the boundary | `apps/backend/src/routes/*` | Every route validates input via Zod before touching the DB. `as` casts on `JSON.parse` / `Response.json()` are banned (ts-reset is on — see CLAUDE.md). |
| Logger discipline | `apps/backend/src/lib/logger.ts` | Always pass the full `error` object, never `error.message`. |
| Drizzle migrations | `apps/backend/drizzle/` | `pnpm run db:generate -- --name=<desc>` for every schema change. Never hand-edit generated SQL. |
| Biome + knip + typecheck gates | CI | Each PR green on `pnpm run typecheck && test && lint && knip`. |
| Theme tokens | `apps/workshop/src/ui/theme.ts` | No hex literals in component files after Phase 0. Lint rule optional; code review enforces. |

---

## 3. Phased build

Each phase lists: **goal**, **deliverables** (file-level), **dependencies**,
**acceptance**, **risks**. Phases map 1:1 to spec §15.

### Phase 0 — Foundations (small stack)

**Goal**: Wipe v1, land the v2 schema, move auth + user profile under `/v1`,
capture `display_name`, ship the primitives library skeleton.

Phase 0 ships as a small stack of three chunks (see §3.1) so that no single PR
depends on external setup (Apple/Google portals, Cloudflare Pages, Terraform
apply) being done up front.

#### 3.1 Phase 0 chunks

| Chunk | What ships | External deps | Status |
|---|---|---|---|
| **0a** | Backend foundation: v2 schema + drop_v1 migration, `lib/response.ts` envelope, `middleware/rate-limit.ts` (table-backed, not yet wired), shared types skeleton, deletion of v1 `routes/auth.ts` + `routes/items.ts` + `lib/email.ts`, `/v1/*` returns 501, client neutralized to "v2 in progress" placeholder, `@aws-sdk/client-ses` + `SES_FROM_ADDRESS` config removed. | None | **Done** |
| **0b-1** | Backend OAuth foundation: `lib/oauth/{jwks,apple,google}.ts` with JWKS-cached JWT verify via `jose`, `routes/v1/auth.ts` (`POST /apple`, `POST /google`, `POST /signout`, `GET /me`), `routes/v1/users.ts` (`PATCH /me` with display-name validation), `requireAuth` middleware refactored to the v1 envelope, rate-limit wired to `/v1/auth/*` (per-IP, 30/min), shared types extended (`AppleAuthRequest`, `GoogleAuthRequest`, `AuthResponse`, `UpdateMeRequest`), `config.ts` reads OAuth audiences from env, Vitest mocked-JWKS coverage (43 tests). | None — uses dep-injected JWKS/audiences in tests so no provider portal config required to land the code. | **Done** (this PR) |
| **0b-2** | Client OAuth surface: primitives library skeleton (`apps/workshop/src/ui/`), `app/sign-in.tsx` + `app/onboarding/display-name.tsx` rewritten, `useAuth` rewritten (signInWithApple/Google, signOut, setDisplayName), dev-only `POST /v1/auth/dev` backend route gated on `DEV_AUTH_ENABLED=1`, one Playwright happy-path that drives sign-in → display-name → home via the dev route. | None — real OAuth SDK integration is deferred to 0c (requires Apple/Google portal config). | **Done** (this PR) |
| **0c-1** | Infra Terraform code only (no apply): delete `infra/ses.tf` + `ses_verified_email` variable + SES IAM policy + `SES_FROM_ADDRESS` from Lambda + `SES_FROM_ADDRESS` from the deploy-backend migrate job; add six `aws_ssm_parameter` SecureString resources (`apple_bundle_id`, `apple_services_id`, `google_ios_client_id`, `google_web_client_id`, `tmdb_api_key`, `google_books_api_key`) with empty defaults and `lifecycle { ignore_changes = [value] }`; wire six matching env vars into `aws_lambda_function.api`; update `terraform.tfvars.example`; create `docs/plans/HANDOFF.md` tracking the remaining external work. | None — zero cloud actions; `terraform plan` is informational until 0c-2 applies. | **Done** (this PR) |
| **0c-2** | Apply the infra + wire real OAuth SDKs: `AWS_PROFILE=workshop-prod terraform apply`; paste real values into SSM via `aws ssm put-parameter --overwrite`; stand up the Cloudflare Pages project wired to `main`; add `expo-apple-authentication` + `expo-auth-session` + `expo-crypto` + `expo-web-browser` to `apps/workshop`; replace the warning-dialog stubs in `app/sign-in.tsx` + `useAuth.signInWithApple` / `signInWithGoogle` with real SDK calls reading `EXPO_PUBLIC_APPLE_SERVICES_ID` / `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; add a second Playwright happy-path that stubs Google Identity Services. | AWS SSO into `workshop-prod`; Terraform apply; Cloudflare account; Apple Developer portal (Services ID + return URLs); Google Cloud Console (iOS + web OAuth client IDs). All tracked in `docs/plans/HANDOFF.md`. | Pending |

#### 3.2 What 0a actually shipped — start here for 0b

Files that landed in 0a (read these first; they're the foundation 0b builds on):

- `apps/backend/drizzle/0001_drop_v1_schema.sql` + `0002_v2_schema.sql` —
  applied locally; CI's `migrate` job will re-apply on first deploy after
  merge. Drops `users`/`magic_tokens`/`rec_items`; creates the full v2 set
  (`users`, `lists`, `list_members`, `list_invites`, `items`, `item_upvotes`,
  `activity_events`, `user_activity_reads`, `metadata_cache`, `rate_limits`)
  + four enums (`list_type`, `member_role`, `auth_provider`,
  `activity_event_type`).
- `apps/backend/src/db/schema.ts` — Drizzle definitions for all of the above,
  including the partial unique index `list_members_one_owner_idx` that
  enforces "exactly one owner per list" at the DB layer.
- `apps/backend/src/lib/response.ts` — `ok(c, data, status?)` and
  `err(c, code, message, details?, status?)`. `code` is the `ErrorCode` enum
  (`UNAUTHORIZED | FORBIDDEN | NOT_FOUND | VALIDATION | RATE_LIMITED |
  CONFLICT | INTERNAL`) and is mirrored in `@workshop/shared`.
  **Use these in every new route — don't `c.json` raw.**
- `apps/backend/src/middleware/rate-limit.ts` — `rateLimit({ family, limit,
  windowSec, key })` middleware + `consume(db, bucketKey, windowStart)`
  primitive. Fixed-window counter against the `rate_limits` table; race-safe
  via the `(bucket_key, window_start)` PK upsert. Fail-open on DB error so a
  rate-limiter outage doesn't take the API down. **Created but not yet wired
  to any route — wire it in 0b.**
- `apps/backend/src/app.ts` — `/v1/*` returns 501 with the new envelope until
  0b lands real handlers. Old `/auth/*` and `/items/*` are gone.
- `apps/backend/src/lib/config.ts` — `sesFromAddress` removed. Don't
  reintroduce it; 0c deletes the env var from the Lambda definition.
- `apps/backend/src/middleware/auth.ts` — kept (still wires `requireAuth` to
  `verifySession`); **0b refactors this** into `requireAuth` +
  `requireListMember` per the plan.
- `apps/backend/src/lib/session.ts` — unchanged HMAC token signer/verifier;
  0b's OAuth handlers issue tokens via `signSession(userId)` after
  upserting the user.
- `packages/shared/src/types.ts` — skeleton only (User, enums, error
  shapes). 0b adds `AppleAuthRequest`, `GoogleAuthRequest`, `AuthResponse`,
  and the display-name patch shape; Phase 1 adds list/item shapes.
- `apps/workshop/app/{_layout,index}.tsx` — placeholder home + stripped
  layout. `app/sign-in.tsx`, `src/{api,hooks,lib,components}/` were deleted
  wholesale; `src/config.ts` (API URL resolver) and `src/ui/` (TBD) are the
  only client surface 0b touches.
- `@aws-sdk/client-ses` removed from `apps/backend/package.json`.

Open carry-overs for 0c that subsequent chunks should NOT touch:
- `infra/ses.tf` deletion + `ses_verified_email` variable removal
- `SES_FROM_ADDRESS` env var removal from `lambda.tf`
- SSM SecureString params for OAuth client IDs + API keys

#### 3.4 What 0b-1 actually shipped — start here for 0b-2

Files that landed in 0b-1 (read these first; they're the foundation 0b-2
builds the client against):

- `apps/backend/src/lib/oauth/jwks.ts` — `verifyIdentityToken(token, jwks,
  opts)` and `getRemoteJwks(url)` (per-URL memoized `createRemoteJWKSet`).
  `OAuthVerifyError` is the typed failure mode every caller catches.
- `apps/backend/src/lib/oauth/apple.ts` — `verifyAppleIdentityToken({
  identityToken, nonce? }, deps?)`. Issuer locked to
  `https://appleid.apple.com`. Audiences come from
  `appleAudiences()` (config: `APPLE_BUNDLE_ID`, `APPLE_SERVICES_ID`,
  optional CSV `APPLE_EXTRA_AUDIENCES`). Tests inject `deps.jwks` +
  `deps.audiences` so no portal config is needed to land code.
- `apps/backend/src/lib/oauth/google.ts` — same pattern. Accepts both
  `https://accounts.google.com` and bare `accounts.google.com` issuers.
  Audiences from `googleAudiences()` (`GOOGLE_IOS_CLIENT_ID`,
  `GOOGLE_WEB_CLIENT_ID`, optional `GOOGLE_EXTRA_AUDIENCES`).
- `apps/backend/src/routes/v1/auth.ts` — handlers:
  - `POST /v1/auth/apple` — body `{ identityToken, nonce?, email?, fullName? }`.
    `email`/`fullName` come from the Apple SDK on first sign-in only;
    backend persists both on initial upsert (Apple's first-sign-in trap).
  - `POST /v1/auth/google` — body `{ idToken }`. Email + name come straight
    out of the JWT.
  - `POST /v1/auth/signout` — auth-required no-op (HMAC sessions are
    stateless; client just discards the token).
  - `GET /v1/auth/me` — returns `{ user }`.
  - Response shape on apple/google: `{ user, token, needsDisplayName }` where
    `needsDisplayName === !user.displayName`. The client's onboarding flow
    branches on that boolean.
- `apps/backend/src/routes/v1/users.ts` — `PATCH /v1/users/me` with the
  exported `displayNameSchema` (trim + 1–40 chars + no newlines, emoji and
  non-Latin OK). Returns `{ user }`.
- `apps/backend/src/middleware/auth.ts` — `requireAuth` rewritten to use
  `err()` envelope. Sets `c.var.userId`. The plan's §6 deliverable #2
  mentions a future `requireListMember` helper — that's a Phase 1 add when
  list routes land, not now.
- `apps/backend/src/app.ts` — `/v1/auth/*` is rate-limited per-IP at 30/min
  via the `rate_limits` table. `/v1/auth` and `/v1/users` are mounted; the
  catch-all `/v1/*` 501 is gone.
- `apps/backend/src/lib/config.ts` — adds `appleBundleId`, `appleServicesId`,
  `googleIosClientId`, `googleWebClientId`, plus optional CSV `*_EXTRA_AUDIENCES`
  envs. All default to empty so local dev still boots; the `appleAudiences()` /
  `googleAudiences()` helpers throw `OAuthVerifyError` at request time if
  unconfigured. **0c is what wires real values from SSM.**
- `packages/shared/src/types.ts` — adds `AppleAuthRequest`, `GoogleAuthRequest`,
  `AuthResponse`, `UpdateMeRequest`. The client should import these.
- `apps/backend/package.json` — adds `jose@6.2.2`.

Tests landed (43 passing): `jwks.test.ts` (signed-token round-trip,
issuer/audience/expiry/key/nonce mismatches), `apple.test.ts` +
`google.test.ts` (issuer + audience + nonce specifics per provider),
`auth.test.ts` (middleware envelope), `users.test.ts` (display-name
validation). Pattern for testing OAuth verifiers: `generateKeyPair("RS256")`
+ `SignJWT(...).sign(privateKey)` + a `JWTVerifyGetKey` that returns the
matching public key — no network involved.

What 0b-2 should do *first*: read `apps/backend/src/lib/oauth/*.ts` and the
auth routes so the client request shapes match exactly. The
`AuthResponse.token` is the bearer token for `Authorization: Bearer ...` —
store it in `expo-secure-store` on iOS / `localStorage` on web (see
`apps/workshop/src/lib/storage.ts` patterns from CLAUDE.md). Hit
`GET /v1/auth/me` to revalidate the session on cold start.

Known constraints for 0b-2:
- The Apple SDK on iOS surfaces `email` + `fullName` *only* on first sign-in.
  The client must forward both fields to `POST /v1/auth/apple` on every call;
  the backend ignores them when the user already exists. Web Apple JS
  surfaces them in the auth callback's `user` field on first sign-in only.
- Apple Web sign-in requires a Services ID return URL configured per
  `workshop.pages.dev` and `http://localhost:8081`. Track in
  `docs/plans/HANDOFF.md` once those are pasted into SSM by 0c.
- Google's iOS client uses `expo-auth-session` (or `@react-native-google-signin/google-signin`
  on a native build); web uses Google Identity Services. Both produce an
  `id_token` to send to `POST /v1/auth/google`.
- `needsDisplayName` is true after first Apple Hide-My-Email sign-in (no
  `fullName` was supplied) and after any sign-in where the user's row still
  has a null `display_name`. Route to `app/onboarding/display-name.tsx` on
  true; otherwise land on the home placeholder.

#### 3.5 What 0b-2 actually shipped — start here for 0c

Files that landed in 0b-2 (read these before touching 0c):

- `apps/workshop/src/ui/` — primitives library skeleton. Exports `tokens`
  (see Appendix §9), `useTheme`, `Text`, `Button`, `IconButton`, `Card`,
  `EmptyState` via `src/ui/index.ts`. **Components import from `src/ui/`,
  never from `src/components/` (which no longer exists).** No hex literals
  in new screens.
- `apps/workshop/src/lib/storage.ts` + `storage.web.ts` — `getItem` /
  `setItem` / `removeItem`. Native uses `expo-secure-store`; web uses
  `localStorage`. Metro picks `.web.ts` on web builds.
- `apps/workshop/src/lib/api.ts` — tiny `apiRequest<T>()` wrapper around
  `fetch` that parses the v1 envelope and throws a typed `ApiError` on
  failures. Every new client API call should use it.
- `apps/workshop/src/hooks/useAuth.tsx` — React context with
  `signInWithApple`, `signInWithGoogle`, `signInDev`, `signOut`,
  `setDisplayName`, `refresh`. Status machine:
  `loading → signed-out | needs-display-name | signed-in`. Bootstraps from
  storage on mount via `GET /v1/auth/me`; 401/404 clears the stored token.
- `apps/workshop/app/_layout.tsx` — wraps the tree in `AuthProvider` and
  uses a segments-aware `AuthGate` to redirect based on status.
  `sign-in` and `onboarding/display-name` are the only routes reachable
  while signed out / pre-onboarding; anything else replaces to `/`.
- `apps/workshop/app/sign-in.tsx` — Continue-with-Apple / Continue-with-Google
  buttons. Both currently open a `window.alert` / `Alert.alert` explaining
  that provider config is a 0c deliverable; the plumbing through
  `useAuth.signInWithApple` / `signInWithGoogle` is live and types match the
  backend. A **third button — "Dev sign-in (test only)"** — renders only
  when `process.env.EXPO_PUBLIC_DEV_AUTH === "1"` and calls the backend
  `/v1/auth/dev` endpoint.
- `apps/workshop/app/onboarding/display-name.tsx` — single-field screen,
  enforces 1–40 chars after trim, calls `setDisplayName()` which hits
  `PATCH /v1/users/me`. The layout routes here automatically when status
  is `needs-display-name`.
- `apps/workshop/app/index.tsx` — signed-in home placeholder. Shows the
  user's display name and a "Sign out" button. Real list surface lands in
  Phase 1.
- `apps/backend/src/routes/v1/auth.ts` — new `POST /v1/auth/dev` handler
  gated on `config.devAuthEnabled`. Returns 404 when disabled; otherwise
  upserts a user keyed by synthetic `provider_sub = dev:<email>` and signs
  a normal HMAC session token. **Never enable in prod** — this is the
  mocked verifier path the Playwright test drives.
- `apps/backend/src/lib/config.ts` — adds `devAuthEnabled` parsed from
  `DEV_AUTH_ENABLED`. Accepts `"1"` or `"true"`; anything else is false.
- `apps/backend/src/routes/v1/auth.test.ts` — new vitest file covering the
  gating (404 when disabled) and validation (400 on bad body).
- `playwright.config.ts` + `tests/e2e/sign-in.spec.ts` — one happy-path
  that navigates to `/`, clicks the dev sign-in button, fills the display
  name, and asserts the home greeting. Runnable via `pnpm run e2e`, which
  spins up backend + web with the right env vars. **CI wiring lands in
  Phase 5** — see §3 Phase 5 deliverable #3.
- `scripts/e2e.sh` — starts backend (:8787) + web (:8081) with
  `DEV_AUTH_ENABLED=1` + `EXPO_PUBLIC_DEV_AUTH=1`, waits for health,
  then runs `playwright test`.
- `docs/plans/HANDOFF.md` — new file tracking the portal + SSM + Pages work
  0c has to pick up.

What 0c should do *first*: read `docs/plans/HANDOFF.md`, then work through
the three fronts (portals → SSM → Cloudflare Pages) mostly independently.
The only deliberate ordering is that SSM params have to exist before the
Terraform apply that wires them into Lambda env vars, and real OAuth client
IDs have to be pasted into SSM *before* the client's Sign-in buttons stop
showing the warning dialog.

#### 3.6 What 0c-1 actually shipped — start here for 0c-2

Files that landed in 0c-1 (read these first before touching 0c-2):

- `infra/ses.tf` — **deleted**. The `aws_sesv2_email_identity.sender`
  resource and the `ses_verification_notice` output are gone.
- `infra/variables.tf` — `ses_verified_email` variable removed. Six new
  variables added: `apple_bundle_id`, `apple_services_id`,
  `google_ios_client_id`, `google_web_client_id`, `tmdb_api_key`,
  `google_books_api_key`. All default to `""` so `terraform apply`
  succeeds before any portal setup; the backend rejects OAuth requests
  with `OAuthVerifyError` when audiences are empty.
  `budget_email_recipient` is unchanged — AWS Budgets uses SNS, not SES.
- `infra/ssm.tf` — six new `aws_ssm_parameter` SecureString resources
  matching the variables above, each with
  `lifecycle { ignore_changes = [value] }` so `aws ssm put-parameter
  --overwrite` doesn't drift state.
- `infra/lambda.tf` — SES IAM policy (`aws_iam_role_policy.lambda_inline`
  with `ses:SendEmail` / `ses:SendRawEmail`) removed. `SES_FROM_ADDRESS`
  env var removed from `aws_lambda_function.api`. Six new env vars added:
  `APPLE_BUNDLE_ID`, `APPLE_SERVICES_ID`, `GOOGLE_IOS_CLIENT_ID`,
  `GOOGLE_WEB_CLIENT_ID`, `TMDB_API_KEY`, `GOOGLE_BOOKS_API_KEY`, each
  sourced from the matching SSM param.
- `infra/terraform.tfvars.example` — `ses_verified_email` line removed;
  six empty OAuth/API-key placeholders added.
- `.github/workflows/deploy-backend.yml` — `SES_FROM_ADDRESS` removed
  from the migrate job env (the backend config no longer reads it, so
  it was already dead code).
- `CLAUDE.md` — the "Lambda reads…" line updated to list the six new
  env vars instead of `SES_FROM_ADDRESS`.
- `docs/plans/HANDOFF.md` — new file. This is the runbook for 0c-2:
  portal checklists, SSM paste commands, Cloudflare Pages build config,
  and the client-SDK wiring sketch.

Nothing was applied — this PR is pure code. `terraform plan` after
merge will show the SES identity + IAM policy removal and the six new
SSM params created with empty values.

What 0c-2 should do *first*: read `docs/plans/HANDOFF.md` top to bottom.
The ordering there is deliberate: portals produce identifiers, identifiers
get pasted into SSM, SSM must exist before `terraform apply` wires the
Lambda env vars, and real client IDs must be in SSM before the client
sign-in buttons stop showing warning dialogs.

#### 3.3 Original Phase 0 deliverable list

(Each item is now annotated with the chunk that lands it.)

**Deliverables**:

1. **Migrations** (`apps/backend/drizzle/`) — *0a*
   - `drop_v1_schema` — drops `rec_items`, `magic_tokens`, `users`.
   - `v2_schema` — creates enums (`list_type`, `member_role`,
     `activity_event_type`, `auth_provider`), tables (`users`, `lists`,
     `list_members`, `list_invites`, `items`, `item_upvotes`,
     `activity_events`, `user_activity_reads`, `metadata_cache`,
     `rate_limits`). Index set per spec §7. `users` carries
     `auth_provider` (`apple` | `google`), `provider_sub` (unique per
     provider), `email` nullable (Apple "Hide My Email" relay stored as-is),
     `display_name`. No `magic_tokens` table — magic-link auth is dropped.
   - `apps/backend/src/db/schema.ts` — Drizzle table definitions for the above.
2. **OAuth auth rewrite** (`apps/backend/src/routes/v1/auth.ts`, `users.ts`) — *0b-1*
   - `POST /v1/auth/apple` — body: `{ identityToken, nonce }`. Verify JWT
     against Apple's JWKS (`https://appleid.apple.com/auth/keys`), check
     `aud` matches the iOS bundle ID *or* the Services ID (web), check
     `nonce` matches. Upsert user by `(apple, sub)`. Returns
     `{ user, needsDisplayName }`.
   - `POST /v1/auth/google` — body: `{ idToken }`. Verify JWT against
     Google's JWKS (`https://www.googleapis.com/oauth2/v3/certs`), check
     `aud` matches one of the configured client IDs (iOS + web). Upsert user
     by `(google, sub)`. Returns `{ user, needsDisplayName }`.
   - `POST /v1/auth/signout`, `GET /v1/auth/me`, `PATCH /v1/users/me`.
   - `apps/backend/src/lib/oauth/apple.ts` + `google.ts` — JWKS fetch with
     in-memory caching (refresh on `kid` miss), JWT verify via `jose`.
   - Remove `src/routes/auth.ts` + `items.ts` from `src/app.ts`.
   - Remove `apps/backend/src/lib/email.ts` and `sendMagicLinkEmail`.
3. **Rate-limit middleware** (`apps/backend/src/middleware/rate-limit.ts`) — *0a* (created), *0b-1* (wired to `/v1/auth/*`, per-IP, 30/min)
   - Table-backed by `rate_limits`. Applied to `/v1/auth/*` first (by IP —
     cheap abuse surface); item/search limits wired when those routes land.
4. **Response envelope helper** (`apps/backend/src/lib/response.ts`) — *0a*
   - `ok(data)`, `err(code, message, details?)` — uniform `{ error, code }` per
     spec §8.
5. **Client — sign-in + display-name capture** — *0b-2*
   - `apps/workshop/app/sign-in.tsx` rewritten: two buttons, Sign in with
     Apple + Sign in with Google. No email field.
     - iOS: `expo-apple-authentication` for Apple (native sheet);
       `expo-auth-session` with Google's OAuth endpoints.
     - Web: Apple "Sign in with Apple JS" for Apple (their mandatory styled
       button); `expo-auth-session` or Google Identity Services for Google.
     - Each path produces an identity token sent to the matching backend
       endpoint.
   - New `apps/workshop/app/onboarding/display-name.tsx` — single-field screen
     shown when `needsDisplayName === true` (first sign-in, or when Apple
     "Hide My Email" user has no name yet).
   - `useAuth` extended: user includes `displayName` + `authProvider`;
     exposes `signInWithApple()`, `signInWithGoogle()`, `signOut()`,
     `setDisplayName()`.
6. **Primitives library skeleton** (`apps/workshop/src/ui/`) — *0b-2*
   - `theme.ts` (palette + tokens per §9 Appendix; dark-only initially),
     `useTheme.ts`, `Text.tsx`, `Button.tsx`, `IconButton.tsx`, `Card.tsx`,
     `EmptyState.tsx`. Enough to rebuild sign-in + onboarding. (No
     `TextField` needed for Phase 0 — OAuth has no inputs; defer to Phase 1.)
   - Old `src/components/theme.ts` — migrate sign-in to tokens, then delete
     the hex palette exports.
7. **Infra** (`infra/`) — *0c*
   - `ssm.tf` — add **OAuth verification params** (all SecureString,
     placeholder values; real values pasted after provider portals are
     configured):
     - `/workshop/apple_services_id` (web audience — e.g. `dev.josh.workshop.web`)
     - `/workshop/apple_bundle_id` (iOS audience — `dev.josh.workshop`)
     - `/workshop/google_ios_client_id`
     - `/workshop/google_web_client_id`
     - Also Phase 2's `TMDB_API_KEY` + `GOOGLE_BOOKS_API_KEY` — landed now
       so the Terraform churn is one-time.
   - `lambda.tf` — pass all five OAuth/API params as Lambda env vars.
     Remove `SES_FROM_ADDRESS` and the SES IAM policy statement (`ses:SendEmail`
     / `ses:SendRawEmail`).
   - **Delete** `infra/ses.tf`. Remove `ses_verified_email` from
     `variables.tf` + `terraform.tfvars.example`. Keep `budget_email_recipient`
     in `budgets.tf` — AWS Budgets uses SNS, not SES.
   - `terraform apply` — AWS will delete the verified email identity; no
     cutover pain because nothing sends mail anymore.
8. **Shared types** (`packages/shared/src/types.ts`) — *0a* (skeleton: `User`,
   `AuthProvider`, `ListType`, `MemberRole`, `ActivityEventType`, `Me`,
   `ApiErrorResponse`, `ErrorCode`); *0b-1* (`AppleAuthRequest`,
   `GoogleAuthRequest`, `AuthResponse` `{ user, token, needsDisplayName }`,
   `UpdateMeRequest`)
   - Remove `RecItem`, `RecCategory`, old auth request/response types.

**Dependencies**: None — this is the base of the stack. Prereq setup
(outside code): Apple Developer portal — enable Sign in with Apple on the
App ID, create a Services ID + return URL for web, create a Sign in with
Apple key (.p8) → stored only for *token signing* if we use "Sign in with
Apple on the server"; for *token verification* (our case, since we only
receive identity tokens) only the JWKS is needed, so the .p8 is not
required. Google Cloud Console — create OAuth client IDs (iOS + web).
Track in `docs/plans/HANDOFF.md`.

**Acceptance**:
- `pnpm dev` comes up clean; both Sign in with Apple and Sign in with
  Google work end-to-end on web. iOS tested via Expo Go once Google client
  ID is wired; Sign in with Apple on iOS tested on a TestFlight build.
- First sign-in from a "Hide My Email" Apple user lands on the
  display-name screen, then the empty home.
- `curl $api_url/health` green in prod.
- All old routes return 404. `/v1/auth/request` and `/v1/auth/verify` do
  not exist.
- Vitest covers `response.ts`, rate-limit middleware, display-name
  validation, Apple/Google JWT verification (mocked JWKS + signed test
  tokens).
- One new Playwright test: web Sign in with Google (test account) →
  display-name → land on empty home.

**Risks**:
- Home screen (`app/index.tsx`) references deleted types — gate it behind a
  placeholder "Coming soon" screen until Phase 1. Acceptable because Phase 0
  and Phase 1 land close together.
- Apple returns `email` + `name` only on **first** sign-in. The backend
  must persist both on the initial `auth/apple` call or they're gone
  forever. Unit test enforces this.
- Apple Services ID config requires a web **return URL** — locally this is
  `http://localhost:8081` (Expo web), in prod it's whatever the CF Pages
  host is. Add both to the Services ID.
- Google test accounts for Playwright require either a dedicated service
  account flow or a long-lived refresh token pinned to a test Google
  account. Cheaper option for P0: mock the backend's Google JWT verifier
  in E2E with a fixture token; real Google login only tested manually.
- CLAUDE.md mentions Neon autosuspend adds ~500ms cold-start; keep in mind
  when running tests against remote DB.
- Terraform apply that removes the SES identity + adds SSM params runs
  once; real OAuth client IDs and API keys must be pasted into SSM *before*
  the client hits `/v1/auth/*` or enrichment endpoints. Track in
  HANDOFF.md.

---

### Phase 1 — Core list CRUD (single-user happy path)

**Goal**: A user can create a list (date-idea / trip type only, free-form),
add items, upvote, complete, edit, delete. All single-user for now — sharing
is Phase 3.

Phase 1 ships as a stack of chunks (mirroring Phase 0) so each PR is reviewable
on its own and `main` stays deployable between landings.

#### 3.7 Phase 1 chunks

| Chunk | What ships | External deps | Status |
|---|---|---|---|
| **1a-1** | Backend lists CRUD: `GET /v1/lists` (with `role`/`memberCount`/`itemCount` aggregates), `POST` (transactional list + owner-member insert), `GET /:id` (list + members + empty `pendingInvites`), `PATCH /:id` (owner only), `DELETE /:id` (owner only; cascades). `requireListMember` + `requireListOwner` middleware (404 vs 403 — non-members get 404 to avoid leaking existence). Shared types `List`, `ListSummary`, `ListMemberSummary`, `PendingInvite`, `CreateListRequest`, `UpdateListRequest` and the matching response shapes. Vitest coverage of input validation + auth gating (20 tests). | None — runs against the existing local Postgres and v2 schema; doesn't depend on 0c-2's portal/SSM/Cloudflare work. | **Done** (this PR) |
| **1a-2** | Backend items CRUD + upvote + complete: `GET /v1/lists/:id/items` (with `upvote_count` aggregate via `LEFT JOIN ... COUNT(*)::int` + per-user `has_upvoted`), `POST` (transactional: insert item + insert creator's upvote in one tx — spec §2.3), `GET /v1/items/:id`, `PATCH`, `DELETE`, `POST/:id/upvote` (idempotent), `DELETE/:id/upvote`, `POST/:id/complete`, `POST/:id/uncomplete`. `requireItemMember` helper that resolves the item's list and reuses `requireListMember`'s membership check. Shared types `Item`, `ItemListResponse`, `ItemResponse`, request bodies. Sort order: `upvote_count DESC, created_at DESC` per spec §7.7; completed-only filter sorts by `completed_at DESC` per spec §2.4. Rate limits wired: `POST /lists/:id/items` 60/user/min, upvote endpoints 120/user/min per spec §8. Vitest coverage of input validation + auth gating + UUID bail-out (29 tests). | None. | **Done** (this PR) |
| **1b-1** | Client TanStack Query foundation + home screen: `apps/workshop/src/lib/query.ts` (`QueryClient` with `refetchOnWindowFocus` / `refetchOnReconnect`), `src/lib/queryKeys.ts` (centralized factory), `src/api/lists.ts` (typed wrappers around `/v1/lists`), `app/index.tsx` rewritten as the rich list-cards home with FAB and empty state. New primitives in `src/ui/`: `Sheet`, `Modal`, `Toast`. | None. | **Done** (this PR) |
| **1b-2** | Client list detail + create-list flow: `app/list/[id]/index.tsx` (filter bar + completed section), `app/list/[id]/item/[itemId].tsx`, `app/list/[id]/add.tsx` (free-form for date-idea / trip; movie/TV/book stubs route to free-form until Phase 2), `app/create-list/_layout.tsx` + `type.tsx` + `customize.tsx`. New primitives: `UpvotePill`, `Avatar`, `Chip`. Optimistic-update helpers for upvote/complete/add with toast rollback. `expo-haptics` wired on upvote/complete/delete (no-op `.web.ts`). One Playwright happy-path: create list → add item → upvote → complete. | None. | Pending |

#### 3.8 What 1a-1 actually shipped — start here for 1a-2

Files that landed in 1a-1 (read these before touching 1a-2):

- `apps/backend/src/middleware/authorize.ts` — `requireListMember` reads
  `:id` from the path, parses it as a UUID (404s on parse failure so handlers
  never see invalid ids), looks up `(list_id, user_id)` in `list_members`,
  404s if not a member, otherwise stashes `c.var.listMemberRole` on the
  context. `requireListOwner` reads that role and 403s on member. Layer them:
  `requireListMember, requireListOwner` (member runs first; owner is cheap).
- `apps/backend/src/routes/v1/lists.ts` — five handlers, all behind
  `requireAuth`. The list shape comes back from `toListShape(DbList)` so
  enum widening + date-to-ISO is in one place; reuse for items in 1a-2 by
  building an analogous `toItemShape` helper.
  - `GET /` uses `db.execute(sql\`...\`)` for the aggregate query (member +
    item count subselects). The Drizzle relational API can do this but the
    raw SQL is shorter and easier to audit. The result is cast through
    `Array<Record<string, unknown>> | { rows: ... }` because `postgres-js`
    sometimes returns one shape and sometimes the other depending on the
    statement; do the same in 1a-2's `GET /lists/:id/items` aggregate.
  - `POST /` opens a `db.transaction(async tx => ...)`. 1a-2's `POST
    /lists/:id/items` should use the same pattern to insert the item + the
    creator's upvote atomically.
  - `PATCH` uses `Partial<DbList>` + `if (parsed.data.foo !== undefined)`
    so a field can be cleared with `null` (description) without hitting the
    "did the caller mean to update?" question. `description: undefined` is
    "leave alone", `description: null` is "clear it".
- `packages/shared/src/types.ts` — `List`, `ListColor` (the seven palette
  keys baked into spec §9), `ListSummary`, `ListMemberSummary`, `PendingInvite`
  (defined now to lock the `GET /:id` shape ahead of Phase 3),
  `CreateListRequest`, `UpdateListRequest`, response wrappers. The `Item`
  shape lands in 1a-2.
- `apps/backend/src/app.ts` — `app.route("/v1/lists", listRoutes)` mounted.
  No rate-limit middleware on it yet — 1a-2 should wire `POST /items` +
  `POST /items/:id/upvote` per spec §8 (60/user/min and 120/user/min
  respectively) using the existing `rateLimit({ family, key: ... })`
  middleware with a `userId`-derived key.
- `apps/backend/src/routes/v1/lists.test.ts` — 20 tests covering the Zod
  schemas (`createListSchema`, `updateListSchema`) plus auth gating + UUID
  parse-failure paths. Same convention as `users.test.ts` / `auth.test.ts`:
  validation-only, no DB integration. End-to-end coverage of the DB path
  comes from the 1b Playwright run; smoke-tested locally during
  development against the docker postgres.

What 1a-2 should do *first*: read `apps/backend/src/routes/v1/lists.ts` end
to end (especially `toListShape`, the `db.transaction` shape, and the raw
SQL aggregate) and `apps/backend/src/middleware/authorize.ts`. Items reuse
the same helpers — `requireListMember` already reads `:id` from the path,
so the natural URL shape for the *item-keyed* routes (`GET /v1/items/:id`,
`PATCH`, `DELETE`, `POST /:id/upvote`, etc.) is to add a sibling
`requireItemMember` middleware that resolves the item's list and then
delegates to the same membership check. Don't duplicate the role-gating
logic; layer the existing pieces.

#### 3.10 What 1a-2 actually shipped — start here for 1b-1

Files that landed in 1a-2 (read these before touching 1b-1):

- `apps/backend/src/middleware/authorize.ts` — adds `requireItemMember`
  alongside the existing `requireListMember` / `requireListOwner`. It
  parses `:id` as a UUID (404s on parse failure so handlers never see
  invalid ids), then resolves the item → list → membership in a single
  inner-join query keyed by `(list_id, user_id)`. Stashes
  `c.var.listMemberRole` (matches the existing list middleware) and
  `c.var.itemListId` for handlers that want the parent list id without
  re-fetching. 404 on miss — never 403, to match `requireListMember`.
- `apps/backend/src/routes/v1/items.ts` — new file, all handlers behind
  `requireAuth + requireItemMember`. Exports three reusable primitives the
  list-scoped routes consume:
  - `createItemSchema` / `updateItemSchema` — Zod validators. `title` is
    1–500 chars + single-line; `url` is ≤2048 chars (free text — no
    `z.url()` because date-idea/trip URLs come through here too); `note` is
    ≤1000 chars; `metadata` is `z.record(z.string(), z.unknown())`. **The
    loose metadata record is intentional — Phase 2 swaps in per-list-type
    Zod validators per spec §9.4.**
  - `fetchItemShape(itemId, userId)` — re-selects an item with
    `upvote_count` (subselect COUNT) and `has_upvoted` (subselect EXISTS).
    Used after every mutation to return the fresh shape. Cheaper than
    threading aggregates through every `RETURNING` clause.
  - `fetchItemsForList(listId, userId, { completed })` — the list-scoped
    aggregate query. Default sort `upvote_count DESC, created_at DESC` per
    spec §7.7; `?completed=true` filter sorts by `completed_at DESC NULLS
    LAST, created_at DESC` per spec §2.4. Uses a `LEFT JOIN (SELECT
    item_id, COUNT(*)::int AS upvote_count, BOOL_OR(user_id = $userId) AS
    has_upvoted FROM item_upvotes GROUP BY item_id)` derived table — one
    round-trip, computes both aggregates in the same scan.
  - `createItem(listId, userId, data)` — opens a transaction, looks up the
    parent list's `type` so `items.type` matches `lists.type` (denormalized
    per schema §7.6), inserts the item, then inserts the creator's upvote
    in the same tx (spec §2.3). Returns the shape with `upvoteCount: 1,
    hasUpvoted: true` directly — no extra SELECT.
  - Item-id-scoped handlers: `GET`, `PATCH`, `DELETE`,
    `POST/DELETE /:id/upvote`, `POST /:id/complete`, `POST /:id/uncomplete`.
    Upvote handlers use `INSERT ... ON CONFLICT DO NOTHING` for idempotency.
    Complete/uncomplete set `completed_at` + `completed_by` together (or
    `null/null` on uncomplete). All return `{ item }` with fresh aggregates.
- `apps/backend/src/routes/v1/lists.ts` — adds list-scoped item routes:
  - `GET /v1/lists/:id/items` accepts `?completed=true|false`. Validation
    via a `z.union([z.literal("true"), z.literal("false")]).optional()`
    that transforms to `boolean | undefined`.
  - `POST /v1/lists/:id/items` calls `createItem`. Rate-limited inline at
    60/user/min (`family: "v1.items.create"`, `key: c.get("userId")`).
  Both layered on top of the existing `requireListMember` so non-members
  hit 404 before the handler runs.
- `apps/backend/src/app.ts` — mounts `app.route("/v1/items", itemRoutes)`.
  Upvote rate-limits live inline on the upvote handlers (120/user/min,
  `family: "v1.items.upvote"`) — applied after `requireItemMember` so the
  key function sees `c.get("userId")`. The existing per-IP `/v1/auth/*`
  limiter is unchanged.
- `packages/shared/src/types.ts` — adds `Item`, `ItemMetadata` (loose
  record alias), `CreateItemRequest`, `UpdateItemRequest`,
  `ItemListResponse`, `ItemResponse`. `Item.upvoteCount` and
  `Item.hasUpvoted` are always populated by the backend — the client UI
  reads `hasUpvoted` to render the upvote pill's "selected" state per spec
  §4.2.
- `apps/backend/src/routes/v1/items.test.ts` — 29 tests covering
  `createItemSchema` / `updateItemSchema` (trim, length caps, single-line,
  metadata-must-be-record, null-clears-vs-undefined-leaves-alone), auth
  gating across every route shape (401 on no token), and uuid bail-out via
  `requireItemMember` (404 before any DB read). Same convention as
  `lists.test.ts`: validation-only — DB-integration coverage comes from
  the 1b Playwright run. End-to-end smoke-tested locally against the
  docker postgres during development.

What 1b-1 should do *first*: read `apps/backend/src/routes/v1/items.ts`
end-to-end (request/response shapes for the typed client wrappers) and
`apps/backend/src/routes/v1/lists.ts` for the `GET /v1/lists` shape — that's
the home-screen card data. The shared types (`Item`, `ListSummary`,
`Me`) fully describe what `apiRequest<T>()` should return; `apps/workshop/src/lib/api.ts`
already wraps the v1 envelope. New work in 1b-1 is purely client side:
TanStack Query setup, query keys, typed list wrappers, and the home-screen
rewrite. The backend changes nothing — 1a-2 closed out the Phase 1 server
surface; 1b-2 will lift in the item-mutation wrappers.

#### 3.11 What 1b-1 actually shipped — start here for 1b-2

Files that landed in 1b-1 (read these before touching 1b-2):

- `apps/workshop/package.json` — adds `@tanstack/react-query@^5.100.1`.
  Only the new dep; nothing else in the manifest moved.
- `apps/workshop/src/lib/query.ts` — `createQueryClient()` returns a
  configured `QueryClient` with `refetchOnWindowFocus: true`,
  `refetchOnReconnect: true`, `staleTime: 30_000`, and a typed `retry`
  policy that bails on 401/403/404 and otherwise retries up to twice.
  Mutations don't auto-retry — 1b-2's optimistic updates own their own
  rollback path.
- `apps/workshop/src/lib/queryKeys.ts` — centralized key factory: tuples
  `["lists"]`, `["lists","detail",id]`, `["items","byList",listId]`,
  `["items","detail",id]`, `["auth","me"]`. **1b-2 should extend this file
  rather than define keys inline** — invalidation patterns rely on the
  prefix structure.
- `apps/workshop/src/api/lists.ts` — typed wrappers: `fetchLists`,
  `fetchListDetail`, `createList`, `updateList`, `deleteList`. All take
  `token: string | null` so callers thread the value from `useAuth()`. The
  v1 envelope is unwrapped inside `apiRequest`, so the return types are
  the response shapes from `@workshop/shared` directly. **1b-2's
  `src/api/items.ts` should mirror this shape** (one function per route,
  thin wrapper, no caching — TanStack Query owns caching).
- `apps/workshop/src/ui/Modal.tsx` — `<Modal visible onRequestClose>`,
  centered card on a translucent backdrop. Wraps RN's built-in `Modal` so
  it works on web + iOS without extra deps; backdrop-press dismisses,
  card-press doesn't bubble.
- `apps/workshop/src/ui/Sheet.tsx` — same pattern but slides up from the
  bottom and adds a drag-handle indicator. Real spring/drag behavior is
  deliberately out of scope here — landing it now (1b-2 needs it for
  swipe gestures + reanimated) requires `react-native-gesture-handler`
  wiring, which 1b-2 owns.
- `apps/workshop/src/ui/Toast.tsx` — `<ToastProvider>` + `useToast()`
  with a `showToast({ message, tone, durationMs, actionLabel, onAction })`
  API. Auto-dismisses after 3.5s by default; `durationMs: 0` makes it
  sticky. **This is the rollback surface for optimistic mutations** in
  1b-2: `onAction` plus `actionLabel: "Undo"` is the spec §5.5 rollback
  pattern.
- `apps/workshop/src/ui/index.ts` — exports the three new primitives plus
  the `useToast` hook and `ToastProvider`.
- `apps/workshop/app/_layout.tsx` — wraps the tree as
  `ThemeProvider → QueryClientProvider → ToastProvider → AuthProvider →
  AuthGate`. **The ordering matters**: AuthProvider sits inside both
  Query + Toast so 1b-2 can call `useToast()` from auth flows or
  invalidate query caches on sign-out. `useMemo(createQueryClient, [])`
  pins the client across renders.
- `apps/workshop/app/index.tsx` — home screen: header with display name +
  sign-out icon, `useQuery(queryKeys.lists.all, fetchLists)` driving
  loading / error / empty / list states, FlatList of `<ListCard>` rows
  with pull-to-refresh, FAB in the bottom-right. The empty-state and
  FAB both call `showToast({ actionLabel: "OK" })` as a placeholder until
  1b-2 wires the real create-list flow. `<ListCard>` reads
  `tokens.list[colorKey]` for the left-edge stripe and renders
  `emoji · name · "Type · Role" · description · "N items · M members"`.
  Sort order matches backend (`updated_at DESC`).

What 1b-2 should do *first*: replace the FAB's toast handler in
`app/index.tsx` with `router.push("/create-list/type")` once the
create-list stack lands; route the empty-state CTA the same way. The
home-screen `useQuery(queryKeys.lists.all)` is already the right cache —
1b-2's `createListMutation` should `queryClient.invalidateQueries({
queryKey: queryKeys.lists.all })` on success (or do an `onMutate`
optimistic insert + `onError` rollback) so the new card appears without
a refetch. For item mutations on the list-detail screen, the natural
keys are already in `queryKeys.items.byList(listId)` and
`queryKeys.items.detail(itemId)`.

Known constraints for 1b-2:
- The `Modal` and `Sheet` primitives use RN's built-in `Modal`. On web
  it renders inline (no portal); that's fine for 1b-2's flows but if
  Phase 5's two-pane layout needs portaled overlays a swap to
  `react-native-modal` or a custom portal will be needed.
- `useToast` must be called from inside the React tree under
  `ToastProvider`. Service-layer code (e.g. mutation `onError`) should
  receive a callback or use a snapshot of the hook from the component.
- `react-native-gesture-handler` and `react-native-reanimated` are
  already in the manifest (Phase 0 deps) but neither is used yet —
  1b-2's swipe-to-complete gesture is the first real use. Verify on web
  where gesture-handler is a partial shim (per spec §5.5 Risks).
- `expo-haptics` is **not** in the manifest yet. 1b-2 deliverable #7
  (haptics on upvote/complete/delete) needs to add it via
  `npx expo install expo-haptics` and ship a `.web.ts` no-op shim
  alongside the native implementation.

#### 3.9 Original Phase 1 deliverable list

(Each item is annotated with the chunk that lands it.)

**Deliverables**:

1. **Backend routes** (`apps/backend/src/routes/v1/`)
   - `lists.ts` — `GET /v1/lists`, `POST`, `GET /:id`, `PATCH /:id`, `DELETE /:id`. — *1a-1*
   - `items.ts` — `GET /v1/lists/:id/items`, `POST`, `GET /v1/items/:id`,
     `PATCH`, `DELETE`, `POST /:id/upvote`, `DELETE /:id/upvote`,
     `POST /:id/complete`, `POST /:id/uncomplete`. — *1a-2*
   - Helpers: `requireListMember` / `requireListOwner` middleware (1a-1)
     plus `requireItemMember` (1a-2) used by every item-keyed route.
2. **Item creation transactionally inserts the creator's upvote** (spec §2.3). — *1a-2*
3. **List query returns `upvote_count` as a computed column** via
   `LEFT JOIN ... COUNT(...)::int` (spec §7.7). Sort: `upvote_count DESC,
   created_at DESC`. — *1a-2*
4. **Client**
   - `app/index.tsx` — Home with rich list cards, empty state, FAB. — *1b-1*
   - `app/create-list/_layout.tsx` + `type.tsx` + `customize.tsx` —
     create-list modal stack (skip the Invite screen in P1; added in P3). — *1b-2*
   - `app/list/[id]/index.tsx` — list detail with filter bar, upvote pill,
     completed section. — *1b-2*
   - `app/list/[id]/item/[itemId].tsx` — item detail. — *1b-2*
   - `app/list/[id]/add.tsx` — free-form add (date-idea/trip type only).
     Movie/TV/Book add pathway is a stub that routes to free-form until P2. — *1b-2*
   - New primitives: `Sheet`, `Modal`, `Toast` (1b-1); `UpvotePill`,
     `Avatar`, `Chip` (1b-2).
5. **TanStack Query integration** (`apps/workshop/src/lib/query.ts`) — *1b-1*
   - `QueryClient` setup with `refetchOnWindowFocus`, `refetchOnReconnect`.
   - `queryKeys.ts` — centralized key factory (`lists.all`, `lists.detail(id)`,
     `items.byList(id)`, `items.detail(id)`).
   - Optimistic update helpers for upvote, complete, add — *1b-2*. Rollback
     with toast on error (spec §5.5).
6. **Shared types**: `List`, `ListMemberSummary`, list CRUD request bodies — *1a-1*;
   `Item`, item CRUD request bodies — *1a-2*.
7. **Haptics**: wire `expo-haptics` on upvote / complete / delete (no-op on
   web — handle via `.web.ts` override). — *1b-2*

**Dependencies**: Phase 0.

**Acceptance**:
- Create-list → add 3 items → upvote two → complete one → they sort and grey
  correctly.
- Edit title + note inline on item detail persists.
- Delete list cascades (verified by a `DELETE /v1/lists/:id` integration test
  that then queries `items` by list_id — zero rows).
- Playwright: create list → add item → upvote → complete, all on web.
- Unit coverage: item sort order, optimistic upvote rollback.

**Risks**:
- TanStack Query's optimistic update pattern is new to the codebase —
  non-trivial first time. Budget a small spike at the start of the phase.
- The client-side "filter bar" (spec §4.2) is literal substring match on
  rendered list — keep it client-only; don't add a server query param.
- Swipe gestures (spec §5.5) depend on `react-native-gesture-handler` +
  `reanimated`. Already in deps, but first real use — verify on web where
  gesture-handler is a partial shim.

---

### Phase 2 — Enrichment (movies, TV, books, link previews)

**Goal**: Adding items to movie / TV / book lists uses live search; adding to
date-idea / trip lists fetches link previews for pasted URLs.

**Deliverables**:

1. **Backend**
   - `apps/backend/src/routes/v1/search.ts` — `GET /v1/search/media?type=`,
     `GET /v1/search/books`. Proxies TMDB / Google Books using SSM-sourced
     API keys. Normalizes responses into the shapes in spec §9.
   - `apps/backend/src/routes/v1/link-preview.ts` — `GET /v1/link-preview`.
     Fetch with 3s timeout, 1MB cap, 3-redirect cap. SSRF allowlist (block
     RFC1918 / loopback / link-local / metadata service IPs). OG + Twitter
     card parsing.
   - `apps/backend/src/lib/metadata-cache.ts` — upsert by `(source,
     source_id)`; TTL enforcement (30 days / 7 days).
2. **Per-type Zod validators** for `items.metadata` (spec §9.4), applied on
   POST/PATCH `/v1/items`.
3. **Client**
   - `app/list/[id]/add.tsx` — type-aware: movie/TV → media search modal;
     book → book search; date-idea/trip → free-form with live URL preview on
     blur.
   - New primitive: `SearchResultRow` (poster + title + year + action).
   - `useDebouncedQuery` hook (300ms) for the search input.
4. **Auth-aware rate limits** wired to `POST /items` + search endpoints.
5. **Shared types**: `MediaResult`, `BookResult`, `LinkPreview`, per-type
   metadata shapes.

**Dependencies**: Phase 1. API keys must be in SSM (Phase 0 left placeholders).

**Acceptance**:
- TMDB search returns normalized rows; selecting one adds an item with poster
  URL populated.
- Pasting a URL into a date-idea add form fetches the OG image + site name
  within 3s or gracefully shows "couldn't fetch preview."
- SSRF regression test: a request for `http://169.254.169.254/` (AWS metadata
  IP) is rejected at the validator layer before `fetch` runs.
- Cache: repeated searches for the same term don't hit TMDB twice within 30d.
- Playwright: add a movie via search on a movie list.

**Risks**:
- TMDB + Google Books rate-limits in free tier. Cache aggressively; back off
  on 429.
- Link-preview is the most security-sensitive surface added so far. SSRF
  allowlist must block *all* private ranges, not just the obvious ones — use
  a tested IP-range library (`ipaddr.js` or equivalent).
- Metadata cache could grow unbounded without retention — nightly cleanup job
  is acceptable v1.1; just log size in CloudWatch.

---

### Phase 3 — Social (sharing, invites, activity feed)

**Goal**: Two users on the same list — upvotes aggregate, activity shows up in
the bell, removing a member removes their upvotes, sharing works via
copy-link (no email; email invites are explicitly deferred — see §7).

**Deliverables**:

1. **Backend**
   - `apps/backend/src/routes/v1/invites.ts` — `POST /v1/lists/:id/invites`
     (share link only — generates a single-use or time-bounded token tied
     to the list), `POST /v1/invites/:token/accept`,
     `DELETE /v1/lists/:id/invites/:inviteId`. No email sending path.
   - `apps/backend/src/routes/v1/members.ts` —
     `DELETE /v1/lists/:id/members/:userId` (owner-remove or self-leave).
     Self-leave cascades to remove the member's `item_upvotes` rows.
   - `apps/backend/src/routes/v1/activity.ts` — `GET /v1/activity`,
     `POST /v1/activity/read`.
   - `apps/backend/src/lib/events.ts` — `recordEvent(listId, actorId, type,
     payload)`. Called from every mutating list/item/member handler.
     Synchronous insert; no queue in v1.
2. **Client**
   - `app/list/[id]/settings.tsx` — list settings sheet (Details, Members,
     Share link [copy-to-clipboard], Activity, Danger). No "invite by
     email" input.
   - `app/onboarding/accept-invite.tsx` — deep-link handler
     (`workshop.dev/invite/:token` on web, `workshop://invite/:token` on
     iOS) — auto-join after OAuth sign-in.
   - `app/activity.tsx` — cross-list feed, pagination at 50/page.
   - Bell badge in home header showing unread count.
3. **Create-list flow** — add the previously-skipped share screen (spec
   §4.5 step 3, but "copy share link" only — no email field).
4. **Shared types**: `Invite`, `ListMember` (full), `ActivityEvent`,
   `ActivityEventType`.
5. **Terraform** — none for this phase. (SES was deleted in Phase 0; no
   email infra to provision.)

**Dependencies**: Phase 1 (lists + members). No email dependencies.

**Acceptance**:
- Two real users, two browsers: A creates a list, copies the share link,
  pastes it to B out-of-band, B opens it and accepts after OAuth sign-in,
  both see each other's upvotes aggregated.
- Activity feed shows the join, the add, the complete, ordered correctly.
- B leaves → B's upvotes vanish from counts but the items they added persist
  with `added_by` intact (spec §2.5).
- Owner cannot leave, can delete.
- Unread count is zero after tapping the bell.
- Playwright: two browser contexts, share-link accept flow.

**Risks**:
- Dual-context Playwright tests are fiddly — one golden path is enough.
- Share-link leakage: a leaked token lets anyone join. Mitigations: tokens
  expire in 7 days, owner can revoke from settings, and `accept` requires
  an authenticated user (joining as a new user is fine — that's the UX —
  but bots need a valid OAuth session first). Good enough for v1.
- Activity writes are on every mutation — measure latency impact on the
  upvote endpoint. If it's >50ms, move to an async queue (SQS) in a v1.1.

---

### Phase 4 — iOS share extension

**Goal**: From Safari on iOS, tap Share → "Workshop" → pick a list → the URL
lands in the add-item confirm screen with preview already fetched.

**Deliverables**:

1. **Expo config plugin** (`apps/workshop/plugins/share-extension/`)
   - Modifies the iOS native project during prebuild: adds a Share Extension
     target, app group entitlement (`group.dev.josh.workshop`), URL scheme
     (`workshop://`).
   - Handles `public.url` and `public.plain-text`.
2. **Extension Swift code** (kept minimal; writes payload to app-group
   `UserDefaults` then opens `workshop://share`).
3. **Main app deep-link handler** (`apps/workshop/app/_layout.tsx`)
   - Reads `workshop://share?url=...` — or the app-group UserDefaults if the
     URL carried no query string — on launch/resume.
   - Navigates to `app/share/pick-list.tsx` (new screen).
4. **`app/share/pick-list.tsx`** — list picker + "Create new list" row. On
   pick, routes to `app/list/[id]/add.tsx` with URL prefilled.
5. **EAS native build** — expo-fingerprint will detect the native change and
   auto-trigger a TestFlight build on merge (per CLAUDE.md).

**Dependencies**: Phase 2 (link preview must exist; the share flow relies on
it for enrichment).

**Acceptance**:
- TestFlight build installs. Safari share sheet shows "Workshop." Tapping
  routes into the picker, then the confirm screen, with the URL prefilled and
  a preview rendered.
- Web app is unchanged — no share extension, same paste-URL code path.
- `./scripts/logs.sh --filter share-extension` shows a single event per
  share.

**Risks**:
- Native changes = TestFlight build. Costs EAS free-tier build minutes. Merge
  this phase separately from other native changes so a revert doesn't mean
  another native rebuild.
- App group entitlements require Apple Developer portal configuration — the
  plugin can inject them into the project but Apple's side needs a manual
  capability enable (once). Track in HANDOFF.md.
- Deep-link handling on app *resume* (not just launch) is easy to miss —
  hook both the initial URL and `Linking.addEventListener('url', ...)`.

---

### Phase 5 — Polish

**Goal**: Offline read-cache persistence, desktop two-pane responsive layout,
full Playwright coverage, light-mode tokens, motion.

**Deliverables**:

1. **Offline cache**
   - `persistQueryClient` + `createAsyncStoragePersister` (iOS) /
     `createSyncStoragePersister` (web) in `apps/workshop/src/lib/query.ts`.
   - Cold start rehydrates; screens render from cache, then revalidate.
   - Mutation-while-offline: revert + toast "Retry?" button.
2. **Desktop two-pane** (`apps/workshop/app/_layout.tsx`)
   - Responsive breakpoint at 768px. Left pane: list of lists; right pane:
     current list/item. Modals open centered over the right pane.
   - Mobile (<768px): stack navigation unchanged.
3. **Playwright E2E** (`apps/workshop/tests/e2e/`)
   - Sign in (Google, via mocked JWKS in the test backend — see Phase 0
     Risks), create each of 5 list types, add item (all 4 pathways),
     upvote/unvote, complete/uncomplete, share-link accept in a second
     browser context.
   - Wire into CI on a new workflow job — runs against a local backend +
     local Postgres (spec §13).
4. **Light theme tokens** in `src/ui/theme.ts`; `useColorScheme` flip.
5. **Haptics + micro-animations**
   - Reanimated upvote pulse, completion cross-out, sheet transitions.
6. **"New items" pill** (spec §12) — on refetch, compare counts; show pill at
   top of list if delta > 0.

**Dependencies**: Phases 1–3 functionally. Phase 4 not required (web-only
E2E is fine; share extension is iOS-only).

**Acceptance**:
- Kill the dev server, reload the app: last-seen list renders from cache.
- Resize a browser across 768px: layout reflows.
- All Playwright flows green in CI.
- Dark → light flip works without remounts.

**Risks**:
- `persistQueryClient` mis-hydration can show stale data indefinitely; set a
  `maxAge` (24h) and a buster key that bumps on schema changes.
- Two-pane layout introduces divergent navigation paths; verify back-button
  / deep-link behavior on both.

---

## 4. Rollout & deploy order

Per spec §14.6, the order within each phase is:

1. Backend PR (routes + migrations + unit tests) → merged → Terraform apply
   auto-runs via GitHub Actions → Lambda deploys. New routes live.
2. Client PR (screens + mutations + E2E) → merged → EAS Update pushes JS OTA
   (~60s) for iOS and the web build deploys via the web-hosting pipeline
   (see Open Questions §6).
3. Verify with `./scripts/logs.sh --since 10m --filter error` — zero errors
   on the new route family for ~15 minutes with real traffic.

**Rollback**: `git revert <phase PR>` + push. Terraform re-applies the prior
state; EAS Update pushes the previous JS bundle. Data is intentionally
disposable in v1 (no export obligation).

---

## 5. Testing strategy summary

Layered, per spec §13:

- **Unit (Vitest)**: every Hono route handler, every lib module. Drizzle
  mocked via transactional wrapper that rolls back per test. Target ≥70% on
  backend. Client unit tests where logic is non-trivial (sort, optimistic
  update rollback, URL parsing). Snapshot tests not used.
- **Integration**: a handful of route tests hit a real (Dockerized) Postgres
  to validate cascades, triggers, and the upvote-count aggregate.
- **E2E (Playwright)**: one happy-path per feature, web-only, against a local
  backend. Grows each phase. Runs in CI.
- **Manual**: TestFlight smoke test after every native (Phase 4) change. Web
  preview deploys per PR.

---

## 6. Resolved decisions + remaining open questions

### Resolved (2026-04-24)

1. **Web hosting target → Cloudflare Pages.** Unlimited bandwidth + requests
   on the free tier, one-click GitHub integration, free custom-domain TLS.
   Ship on `workshop.pages.dev` until a real domain is purchased; the static
   bundle (`expo export --platform web` → `dist/`) drops in with no infra
   changes when the domain cuts over. Phase 0's infra PR wires the CF Pages
   project; nothing goes into Terraform (CF is out of band from AWS).
2. **Color palette → placeholder tokens now, designer pass later.** Warm-dark
   neutral set; semantic tokens in `apps/workshop/src/ui/theme.ts` separate
   from raw hex values so a designer edits `palette` without touching
   component code. Light-mode variant is a Phase 5 add. See Appendix §9 for
   the specific hex values baked into Phase 0.
3. **EAS build budget → stay on free tier, reduce CI trigger rate.** 30
   builds/month is plenty for Phase 4 (~3–5 expected builds) *if* CI doesn't
   spend any on speculative work. Action items baked into Phase 0 / Phase 4
   deliverables:
   - Auto-TestFlight build should only run on `main` merges where
     `@expo/fingerprint` changed — already the setup per CLAUDE.md; re-verify
     the workflow gates the build step on the fingerprint diff, not just on
     file paths.
   - Add a `concurrency: ios-native-build` group to cancel superseded builds
     if multiple native-change PRs merge back-to-back.
   - Never trigger a build from PR CI — `EXPO_TOKEN` is only used by the
     `main`-branch job.
   - Monitor usage at <https://expo.dev/accounts/joshlebed/settings/billing>
     after Phase 4 lands; if it crosses 20 builds/month, re-evaluate.
4. **Feature flags → dropped.** Clean cutover as the spec says. No
   `ENABLE_V2` toggle. Phase 0 and Phase 1 land in rapid succession so the
   "Coming soon" placeholder on home is short-lived.

5. **Auth → OAuth-only (Apple + Google). SES dropped entirely.** Magic-link
   email auth was risking getting `joshlebed@gmail.com` flagged by downstream
   spam filters, and email infra (SES sandbox exit, verified sending domain,
   DKIM/SPF/DMARC) is meaningful setup work for v1. Instead:
   - Sign in with Apple (required by App Store review guideline 4.8 if any
     OAuth is offered on iOS) + Sign in with Google — both on iOS and web.
   - List invites become **share-link only** (copy token URL, paste out of
     band). No email invite path.
   - SES is removed from Terraform in Phase 0; `SES_FROM_ADDRESS` env var
     and the SES IAM policy come off the Lambda. `apps/backend/src/lib/email.ts`
     is deleted. Budget alerts (AWS Budgets → SNS → email) are unaffected.
   - Effort estimate: ~2 days (one-time; replaces Phase 0's magic-link
     work rather than adding on top).
   Phase 0 and Phase 3 deliverables below already reflect this decision.

### Still open (must answer before the phase that needs them)

1. **Domain to own.** The CF Pages custom domain name. Not urgent —
   `workshop.pages.dev` works until you want a nicer URL. Apple Sign in with
   Apple web flow requires a configured return URL; `workshop.pages.dev`
   plus `http://localhost:8081` is fine for Phase 0, updated when a custom
   domain lands.

Anything not flagged here is assumed to follow the spec's §16 defaults.

---

## 7. Out of scope (explicitly deferred)

Per spec §1 non-goals + §16 assumptions, the following are not built in this
plan:

- Push notifications.
- Real image uploads (avatars, item art beyond enrichment).
- Public profiles / follow graph.
- AI / auto-suggest.
- Mutation queue / offline-first writes.
- WebSockets / realtime collab.
- Multi-list membership for a single item.
- Per-user completion (shared boolean only).
- **Email invites / any transactional email.** v1 ships share-link invites
  only; re-adds SES (or a managed alternative like Resend / Postmark) + a
  verified sending domain as a v1.1 item.
- **Magic-link / email-password auth.** OAuth-only in v1.

These belong in a v1.1+ plan.

---

## 8. Appendix — file-level deltas at a glance

(See §9 for the Phase 0 placeholder palette.)


| Area | Added | Deleted | Renamed/Rewritten |
|---|---|---|---|
| `apps/backend/src/routes/` | `v1/auth.ts`, `v1/users.ts`, `v1/lists.ts`, `v1/items.ts`, `v1/invites.ts`, `v1/members.ts`, `v1/activity.ts`, `v1/search.ts`, `v1/link-preview.ts` | `auth.ts`, `items.ts` | — |
| `apps/backend/src/db/schema.ts` | — | — | Full rewrite (no `magic_tokens`) |
| `apps/backend/drizzle/` | `drop_v1_schema`, `v2_schema`, per-phase ALTERs | — | — |
| `apps/backend/src/lib/` | `response.ts`, `metadata-cache.ts`, `events.ts`, `oauth/apple.ts`, `oauth/google.ts` | `email.ts` | — |
| `apps/backend/src/middleware/` | `rate-limit.ts`, `authorize.ts` | — | `auth.ts` (now `requireAuth` + `requireListMember` helpers) |
| `packages/shared/src/types.ts` | All v2 types | `RecItem`, `RecCategory`, old request/response | — |
| `apps/workshop/app/` | `onboarding/`, `list/[id]/...`, `create-list/`, `activity.tsx`, `share/`, `settings.tsx` | existing `index.tsx`, `sign-in.tsx` | Full rewrite (OAuth buttons) |
| `apps/workshop/src/components/` | — | All existing (`ItemCard`, `AddEditModal`, `CategoryDropdown`, `Tabs`, `DataPanel`, `ContextMenu`, `HeaderMenu`, `Header`, `theme.ts`) | — |
| `apps/workshop/src/ui/` | Full primitives library (§5.3) | — | — |
| `apps/workshop/plugins/share-extension/` | Phase 4 config plugin + Swift source | — | — |
| `infra/` | `ssm.tf` — `apple_services_id`, `apple_bundle_id`, `google_ios_client_id`, `google_web_client_id`, `TMDB_API_KEY`, `GOOGLE_BOOKS_API_KEY` | `ses.tf`; `ses_verified_email` variable; `SES_FROM_ADDRESS` env + SES IAM policy in `lambda.tf` | `lambda.tf` (OAuth + API key env vars) |
| `docs/` | This file; phase-specific handoff notes as written | — | — |

---

## 9. Appendix — Phase 0 placeholder palette

Arbitrary pick to unblock Phase 0; a designer pass later will revise.
Structured so that swap-out is a single-file edit.

**Structure in `apps/workshop/src/ui/theme.ts`**:

```ts
const palette = {
  // raw hex — edit these to reskin
  ink: { 900: "#0E0E10", 800: "#16161A", 700: "#1F1F25", 600: "#26262E", 500: "#33333D", 400: "#4A4A56" },
  paper: { 50: "#F2F2F5", 200: "#A8A8B3", 400: "#6E6E78" },
  amber: { 500: "#F5A524", 600: "#E89611", muted: "#F5A52422" },
  green: { 500: "#3DD68C" },
  red:   { 500: "#F05252" },
  listColors: {
    sunset: "#F5A524", ocean: "#4CA7E8", forest: "#3DD68C",
    grape:  "#A78BFA", rose:  "#F472B6", sand:   "#D4B896", slate: "#94A3B8",
  },
} as const;

export const tokens = {
  // semantic names — components only reference these
  bg:      { canvas: palette.ink[900], surface: palette.ink[800], elevated: palette.ink[700] },
  text:    { primary: palette.paper[50], secondary: palette.paper[200], muted: palette.paper[400], onAccent: palette.ink[900] },
  border:  { subtle: palette.ink[600], default: palette.ink[500], strong: palette.ink[400] },
  accent:  { default: palette.amber[500], hover: palette.amber[600], muted: palette.amber.muted },
  status:  { success: palette.green[500], warning: palette.amber[500], danger: palette.red[500] },
  list:    palette.listColors,
} as const;
```

**List color keys** (stored server-side on `lists.color_key`): `sunset`,
`ocean`, `forest`, `grape`, `rose`, `sand`, `slate`. The backend treats the
key as opaque; the client maps it via `tokens.list[key]`.

**Tweakability rules**:
- Components import `tokens`, never `palette` — renaming a hex value in
  `palette` ripples to every screen.
- No hex literals in component files (lint rule optional; PR review
  enforces).
- Adding light mode later is `tokens = { dark: { ... }, light: { ... } }`
  plus a `useTheme()` picker — no component changes.

