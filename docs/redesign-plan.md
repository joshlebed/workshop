# Workshop.dev — Redesign Implementation Plan

Status: in progress · Opened: 2026-04-24 · Last touched: 2026-04-28 (5a offline cache landed; Phase 5 polish in progress) · Owner: @joshlebed

This is the engineering plan for executing the rewrite described in
[`docs/redesign-spec.md`](./redesign-spec.md). The spec defines the _what_; this
document defines the _how_ — phases, PR decomposition, file-level deliverables,
dependencies, and risks.

The foundation stays (pnpm monorepo, Expo + expo-router, Hono on Lambda, Neon
Postgres, Drizzle, Terraform, EAS). The entire feature surface is replaced —
data model, API, client screens, and design system.

See [`CLAUDE.md`](../CLAUDE.md) for operational conventions and
[`docs/decisions.md`](./decisions.md) for infra rationale.

---

## Current status (2026-04-28)

Per-chunk status lives in the §3 tables; this is the orientation snapshot.

### Done

- **Phase 0** chunks 0a, 0b-1, 0b-2, 0c-1 — backend + client foundations,
  primitives skeleton, OAuth verifier code, infra code (no apply).
- **0c-2 portal + infra** (2026-04-27):
  - Apple Services ID Web Auth saved (`dev.josh.workshop` configured as
    primary App ID with Sign In with Apple; Services ID
    `dev.josh.workshop.web` Domain + Return URL `workshop-a2v.pages.dev`).
  - Google Cloud project `workshop` set up — OAuth consent screen
    (Testing, External, scopes `openid email profile`), iOS client ID
    - Web client ID created.
  - `terraform apply` on `workshop-prod` ran cleanly: 6 new SSM
    SecureString params (`apple_bundle_id`, `apple_services_id`,
    `google_ios_client_id`, `google_web_client_id`, `tmdb_api_key`,
    `google_books_api_key`); Lambda env vars wired to those params;
    GH Actions IAM role updated; `aws_sesv2_email_identity.sender` +
    `aws_iam_role_policy.lambda_inline` destroyed.
  - Lambda `/health` green with new audiences live in env.
  - Cloudflare Pages production env vars set
    (`EXPO_PUBLIC_APPLE_SERVICES_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`,
    `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`) so the next CF build picks up
    the audiences for the web bundle.
- **0c-2 client SDK PR** (#56, this session — closes Phase 0):
  - `apps/workshop/src/lib/oauth/{apple,google}.{ts,web.ts}` —
    platform-split hooks with a uniform `{ available, signIn }` shape.
    Native uses `expo-apple-authentication` (Apple) + `expo-auth-session/providers/google`
    (Google). Web lazy-loads Apple JS (`appleid.cdn-apple.com/...`) +
    Google Identity Services (`accounts.google.com/gsi/client`).
  - `apps/workshop/app/sign-in.tsx` rewritten — real Apple/Google
    buttons (each disabled when `EXPO_PUBLIC_*` audience env is unset),
    `sign-in-providers-unconfigured` empty-state copy, all
    `Alert.alert` / `window.alert` warning dialogs deleted.
  - `expo-apple-authentication` added to `app.json` plugins; deps
    pinned via `pnpm exec expo install` (`expo-apple-authentication
~55.0.13`, `expo-auth-session ~55.0.15`, `expo-crypto ~55.0.14`,
    `expo-web-browser ~55.0.14`).
  - `useAuth.tsx` — auto-dev-sign-in (#33) is now skippable per-test
    via a `workshop.disable-auto-dev` localStorage flag so the sign-in
    screen actually renders for E2E.
  - `tests/e2e/helpers.ts` + `tests/e2e/sign-in-google.spec.ts` — new
    Playwright happy-path that stubs Google Identity Services with a
    known JWT and mocks `POST /v1/auth/google` to return a
    backend-signed `AuthResponse` (sourced via `/v1/auth/dev` so the
    subsequent display-name PATCH actually works). Existing
    `sign-in.spec.ts` + `list-flow.spec.ts` adopt the disable-auto-dev
    helper.
  - `scripts/e2e.sh` exports stub `EXPO_PUBLIC_APPLE_SERVICES_ID` /
    `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` so the sign-in screen treats both
    providers as available; tests stub the SDK callbacks directly so
    no value ever leaves the browser.
- **Phase 1** chunks 1a-1, 1a-2, 1b-1, 1b-2 — full lists/items CRUD,
  upvote, complete, home + detail + create-list flows, optimistic-update
  plumbing, one Playwright happy-path.
- **Phase 2** chunk 2a-1 — TMDB + Google Books search routes, metadata
  cache, per-type `items.metadata` Zod validators.
- **Phase 2** chunk 2a-2 — link-preview backend (`GET
/v1/link-preview?url=`) with SSRF allowlist via `ipaddr.js`, manual
  per-redirect-hop hostname re-validation, 3s timeout, 1 MB body cap,
  OG/Twitter card parser, 7-day metadata cache reuse, 30/user/min rate
  limit. 45 vitest cases (24 SSRF guard + 21 route).
- **Phase 2** chunk 2b-1 — client search modal: type-aware
  rewrite of `app/list/[id]/add.tsx` (movie/tv/book → search flow,
  date_idea/trip → free-form). New `src/api/search.ts` typed wrappers,
  `useDebouncedQuery(value, 300)` hook, `<SearchResultRow>` primitive.
  Selecting a result POSTs `/v1/lists/:id/items` with normalised
  metadata pre-filled (`source: "tmdb"|"google_books"`, sourceId,
  posterUrl/coverUrl, year, runtime/pageCount, overview/description).
  Playwright happy-path (`tests/e2e/add-search.spec.ts`) creates a
  movie list, mocks `/v1/search/media`, types a query, selects a
  result, asserts it lands on the list.
- **Phase 2** chunk 2b-2 — client link preview: free-form
  `<FreeFormFlow>` in `app/list/[id]/add.tsx` debounces the URL field
  through `useDebouncedQuery`, gates on a client-side `new URL()` parse,
  and calls `GET /v1/link-preview` via TanStack Query (cancellable via
  `signal`). New `src/api/linkPreview.ts` typed wrapper, inline preview
  card (image + siteName + title), "Couldn't fetch preview" fallback on
  error. On submit, the preview is copied into `metadata` using only
  `placeMetadataSchema`-allowed keys (`source: "link_preview"`,
  `sourceId: finalUrl`, `image`, `siteName`, `title`, `description`).
  Playwright happy-path (`tests/e2e/add-link-preview.spec.ts`) creates
  a date-idea list, mocks `/v1/link-preview`, pastes a URL, sees the
  card, saves.
- **Phase 3** chunk 3a-1 — backend share-link invites + member removal.
  New `apps/backend/src/routes/v1/invites.ts`
  (`POST /v1/lists/:id/invites`, `POST /v1/invites/:token/accept`,
  `DELETE /v1/lists/:id/invites/:inviteId`) and
  `apps/backend/src/routes/v1/members.ts`
  (`DELETE /v1/lists/:id/members/:userId`). Tokens are 32-byte URL-safe
  base64 with a 7-day expiry; `accept` is idempotent (re-joining is a
  no-op, the owner can't accept their own list). Owner removal cascades
  to upvotes via the existing FKs; self-leave is allowed for non-owners.
  `GET /v1/lists/:id` now returns real `pendingInvites`. Email invites
  are explicitly out — share-link only per spec §6.
- **Phase 3** chunk 3a-2 — backend activity events +
  `recordEvent` retrofit. New `apps/backend/src/lib/events.ts`
  (`recordEvent({ listId, actorId, type, itemId?, payload?, db? })` —
  synchronous insert; the optional `db` param accepts an open
  transaction so events roll back with the parent op, mirroring
  `metadata-cache.ts`). New `apps/backend/src/routes/v1/activity.ts`:
  `GET /v1/activity?cursor&limit=50` (cross-list feed scoped via JOIN
  on `list_members`, base64url cursor encoding `(created_at, id)` to
  disambiguate same-tx ties), `POST /v1/activity/read` (upserts
  `user_activity_reads` per `(user_id, list_id)`; omit `listIds` to
  mark every membership read at once). Every mutating handler in
  `lists.ts` / `items.ts` / `invites.ts` / `members.ts` retrofitted to
  emit the matching `activityEventTypeEnum` value inside the existing
  transaction. Shared types: `ActivityEvent`, `ActivityFeedResponse`,
  `MarkActivityReadRequest`, `MarkActivityReadResponse`. 25 new vitest
  cases (4 events + 21 activity); test convention matches
  `invites.test.ts` (validator + auth gating + UUID-bail) since the
  DB path is covered by Playwright in 3b-2.
- **Phase 3** chunk 3b-1 — client list settings + share-link
  UX. New `apps/workshop/app/list/[id]/settings.tsx` modal sheet
  (Details / Members / Share link / Danger zone, owner-vs-member gated).
  New `apps/workshop/app/onboarding/accept-invite.tsx` deep-link landing
  screen + thin redirect shim at `apps/workshop/app/invite/[token].tsx`
  so `workshop.dev/invite/:token` (web) and `workshop://invite/:token`
  (iOS) route to one place. Token survives a sign-in round-trip via a
  storage stash (`PENDING_INVITE_TOKEN_KEY`) consulted in `_layout.tsx`'s
  `AuthGate`. Typed wrappers in `src/api/invites.ts` + `src/api/members.ts`,
  share-URL builder + clipboard helper in `src/lib/share.ts`. List-detail
  header gains a `⋯` `IconButton` (`testID="list-settings"`) routing to
  the modal. Playwright happy-path (`tests/e2e/share-link-accept.spec.ts`)
  - new `signInAsDevUser` helper that seeds two contexts as different
    dev users via `/v1/auth/dev` + `addInitScript` of the session token.
- **Phase 3** chunk 3b-2 (this PR — Phase 3 complete) — client activity
  feed + bell badge + create-list share step. New
  `apps/workshop/app/activity.tsx` (cross-list feed, 50/page,
  `useInfiniteQuery`, `useFocusEffect` writes `lastViewedAt` and fires
  `POST /v1/activity/read`). Bell `IconButton` + 18×18 unread badge in
  the home header (`open-activity` + `activity-unread-badge` testIDs);
  badge count derives from a client-side `lastViewedAt` stamp + filters
  out same-actor events. New `apps/workshop/app/create-list/share.tsx`
  step at the end of the create-list flow — generate / copy a share link
  (reuses `createInvite` + `buildInviteShareUrl` from 3b-1). Typed
  wrappers in `src/api/activity.ts`, storage helper in
  `src/lib/lastViewed.ts`, separate `activity.feedInfinite` cache key
  (vs the bell's `activity.feed`). Playwright happy-path
  (`tests/e2e/activity-feed.spec.ts`) — owner adds item → member sees
  the event in the feed → unread badge clears after a back-nav.
- **Phase 5** chunk 5a (this PR) — offline read cache. Wired
  `PersistQueryClientProvider` into `app/_layout.tsx` with platform-split
  persisters (`createAsyncStoragePersister` on native via
  `@react-native-async-storage/async-storage`,
  `createSyncStoragePersister` on web via `window.localStorage`). 24h
  `maxAge`; buster key derived from a local `PERSIST_TYPES_VERSION`
  constant kept in lock-step with `SHARED_TYPES_VERSION` in
  `packages/shared/src/types.ts` (vitest enforces the lock-step). Failed
  mutations whose error matches `isOfflineError` surface a "Retry?"
  toast via a global `OfflineRetryWatcher` that subscribes to the
  `MutationCache`; per-component `onError` handlers still revert
  optimistic updates as before. Mutations are not persisted
  (`shouldDehydrateMutation: () => false`); only successful queries are.
  4 vitest tests (`apps/workshop/src/lib/query.test.ts`); 8 Playwright
  specs unchanged-and-green.

### Pending

- **iOS-only follow-up for 0c-2** (not blocking web; carry into the
  next native-build PR or whenever Phase 4 starts):
  - `eas.json` `build.production.env` is missing
    `EXPO_PUBLIC_APPLE_SERVICES_ID` / `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
    / `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. iOS native builds today only
    bake `EXPO_PUBLIC_API_URL`. Native Apple sign-in falls back to the
    bundle-id audience (already in Lambda env) but native Google
    sign-in needs `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` at build time.
  - `app.json` `ios.infoPlist.CFBundleURLTypes` is empty. Native
    Google sign-in via `expo-auth-session/providers/google` redirects
    back through the **reverse iOS client ID** URL scheme
    (`com.googleusercontent.apps.<suffix>://`); without a registered
    URL type the browser hands back to Safari instead of the app.
  - `.github/workflows/{deploy-mobile,testflight}.yml` only inject
    `EXPO_PUBLIC_API_URL`. If we want OTA (deploy-mobile) to keep the
    bundles' OAuth audiences fresh from a secret rotation, the three
    new `EXPO_PUBLIC_*` env vars need GitHub Actions secrets + a
    matching `env:` block.
    Web is unaffected — Cloudflare Pages reads those env vars from its
    own project config at build time.
- Production `TMDB_API_KEY` / `GOOGLE_BOOKS_API_KEY` are live in SSM
  (pasted via `aws ssm put-parameter --overwrite` 2026-04-27; both keys
  smoke-tested against TMDB and Google Books). `lifecycle
  { ignore_changes = [value] }` keeps Terraform from drifting them.
  Link-preview doesn't depend on either key (it scrapes OG tags
  directly), so dev wiring works even without them set.
- **Phase 4** — iOS share extension. **4a-1 done** — JS-only
  share-flow plumbing landed (`app/share/pick-list.tsx`, `app/share/index.tsx`
  redirect, `?prefillUrl=` on `app/list/[id]/add.tsx`, Playwright
  happy-path). **4a-2 deferred** until Phase 5 polish completes — see
  §3.24 for rationale. The native config plugin + Swift extension + App
  Group entitlement + EAS native build are blocked on a manual TestFlight
  smoke test (real iPhone) and burn EAS free-tier minutes; landing them
  before the rest of the app is polished risks rebuilds against a
  still-shifting JS surface. Implementation guidance for whenever 4a-2
  is picked up lives in §3.25 ("What 4a-2 should do _first_").
- **Phase 5** — polish. **Now the active phase.** Decomposed into six
  chunks in §3.26 (offline cache, light theme, "new items" pill, haptics +
  micro-animations, desktop two-pane, full E2E coverage). **5a done** —
  offline read cache landed (this PR). Pick up **5b** (light theme
  tokens + `useColorScheme` flip) next.

### Next to implement

The next chunk is **5b — light theme tokens + `useColorScheme` flip**
(Phase 5 polish). Extends `apps/workshop/src/ui/theme.ts` with a
`light` palette mirror of the existing `dark` palette (semantic tokens
stay stable; only raw hex values change). `ThemeProvider` reads
`useColorScheme()` and swaps the active palette without remounts. No
new component code — every primitive already reads from semantic
tokens. Vitest snapshot of the resolved tokens for both modes. See
§3.26 for the full Phase 5 chunks table and §3.27 for what 5a shipped.

**Why not 4a-2?** Phase 4a-2 (native iOS share extension) is
**deferred** until Phase 5 polish lands. It's blocked on a manual
TestFlight smoke test (real iPhone), it consumes EAS free-tier build
minutes, and the JS surface it hands off to is still being polished —
landing native code now risks rebuilding against a moving target. See
§3.24 for the deferral note and §3.25 for the implementation guidance
that's been preserved in place for whenever 4a-2 is revisited.

**Why not 5c–5f?** Pickup order in §3.26 is 5a → 5b → 5c → 5d → 5e →
5f. Order isn't strict (any 5a–5d can land independently) but 5b is
next per the plan and unblocks visual polish that 5e (two-pane) builds
on.

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

| Workstream                     | Owner                            | What it means per phase                                                                                                                                 |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared types                   | `packages/shared`                | Every new endpoint gets its request/response types added here first.                                                                                    |
| Zod at the boundary            | `apps/backend/src/routes/*`      | Every route validates input via Zod before touching the DB. `as` casts on `JSON.parse` / `Response.json()` are banned (ts-reset is on — see CLAUDE.md). |
| Logger discipline              | `apps/backend/src/lib/logger.ts` | Always pass the full `error` object, never `error.message`.                                                                                             |
| Drizzle migrations             | `apps/backend/drizzle/`          | `pnpm run db:generate -- --name=<desc>` for every schema change. Never hand-edit generated SQL.                                                         |
| Biome + knip + typecheck gates | CI                               | Each PR green on `pnpm run typecheck && test && lint && knip`.                                                                                          |
| Theme tokens                   | `apps/workshop/src/ui/theme.ts`  | No hex literals in component files after Phase 0. Lint rule optional; code review enforces.                                                             |

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

| Chunk    | What ships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | External deps                                                                                                                                                                                                     | Status                                                                                                                                                                                                                                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0a**   | Backend foundation: v2 schema + drop_v1 migration, `lib/response.ts` envelope, `middleware/rate-limit.ts` (table-backed, not yet wired), shared types skeleton, deletion of v1 `routes/auth.ts` + `routes/items.ts` + `lib/email.ts`, `/v1/*` returns 501, client neutralized to "v2 in progress" placeholder, `@aws-sdk/client-ses` + `SES_FROM_ADDRESS` config removed.                                                                                                                                                                                                                                                                            | None                                                                                                                                                                                                              | **Done**                                                                                                                                                                                                                                                                                                                          |
| **0b-1** | Backend OAuth foundation: `lib/oauth/{jwks,apple,google}.ts` with JWKS-cached JWT verify via `jose`, `routes/v1/auth.ts` (`POST /apple`, `POST /google`, `POST /signout`, `GET /me`), `routes/v1/users.ts` (`PATCH /me` with display-name validation), `requireAuth` middleware refactored to the v1 envelope, rate-limit wired to `/v1/auth/*` (per-IP, 30/min), shared types extended (`AppleAuthRequest`, `GoogleAuthRequest`, `AuthResponse`, `UpdateMeRequest`), `config.ts` reads OAuth audiences from env, Vitest mocked-JWKS coverage (43 tests).                                                                                            | None — uses dep-injected JWKS/audiences in tests so no provider portal config required to land the code.                                                                                                          | **Done** (this PR)                                                                                                                                                                                                                                                                                                                |
| **0b-2** | Client OAuth surface: primitives library skeleton (`apps/workshop/src/ui/`), `app/sign-in.tsx` + `app/onboarding/display-name.tsx` rewritten, `useAuth` rewritten (signInWithApple/Google, signOut, setDisplayName), dev-only `POST /v1/auth/dev` backend route gated on `DEV_AUTH_ENABLED=1`, one Playwright happy-path that drives sign-in → display-name → home via the dev route.                                                                                                                                                                                                                                                                | None — real OAuth SDK integration is deferred to 0c (requires Apple/Google portal config).                                                                                                                        | **Done** (this PR)                                                                                                                                                                                                                                                                                                                |
| **0c-1** | Infra Terraform code only (no apply): delete `infra/ses.tf` + `ses_verified_email` variable + SES IAM policy + `SES_FROM_ADDRESS` from Lambda + `SES_FROM_ADDRESS` from the deploy-backend migrate job; add six `aws_ssm_parameter` SecureString resources (`apple_bundle_id`, `apple_services_id`, `google_ios_client_id`, `google_web_client_id`, `tmdb_api_key`, `google_books_api_key`) with empty defaults and `lifecycle { ignore_changes = [value] }`; wire six matching env vars into `aws_lambda_function.api`; update `terraform.tfvars.example`; create `docs/plans/HANDOFF.md` tracking the remaining external work.                     | None — zero cloud actions; `terraform plan` is informational until 0c-2 applies.                                                                                                                                  | **Done** (this PR)                                                                                                                                                                                                                                                                                                                |
| **0c-2** | Apply the infra + wire real OAuth SDKs: `AWS_PROFILE=workshop-prod terraform apply`; paste real values into SSM via `aws ssm put-parameter --overwrite`; stand up the Cloudflare Pages project wired to `main`; add `expo-apple-authentication` + `expo-auth-session` + `expo-crypto` + `expo-web-browser` to `apps/workshop`; replace the warning-dialog stubs in `app/sign-in.tsx` + `useAuth.signInWithApple` / `signInWithGoogle` with real SDK calls reading `EXPO_PUBLIC_APPLE_SERVICES_ID` / `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; add a second Playwright happy-path that stubs Google Identity Services. | AWS SSO into `workshop-prod`; Terraform apply; Cloudflare account; Apple Developer portal (Services ID + return URLs); Google Cloud Console (iOS + web OAuth client IDs). All tracked in `docs/plans/HANDOFF.md`. | **Done** — portal + SSM + Terraform apply + CF Pages env vars landed 2026-04-27. Client SDK wiring + Playwright GIS-stub happy-path landed in PR #56 (this session). iOS-only follow-up (`eas.json` env, `app.json` reverse-client URL scheme, GH Actions secrets) tracked in §"Pending" above and in `docs/plans/HANDOFF.md` §7. |

#### 3.2 What 0a actually shipped — start here for 0b

Files that landed in 0a (read these first; they're the foundation 0b builds on):

- `apps/backend/drizzle/0001_drop_v1_schema.sql` + `0002_v2_schema.sql` —
  applied locally; CI's `migrate` job will re-apply on first deploy after
  merge. Drops `users`/`magic_tokens`/`rec_items`; creates the full v2 set
  (`users`, `lists`, `list_members`, `list_invites`, `items`, `item_upvotes`,
  `activity_events`, `user_activity_reads`, `metadata_cache`, `rate_limits`)
  - four enums (`list_type`, `member_role`, `auth_provider`,
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

#### 3.3 What 0b-1 actually shipped — start here for 0b-2

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

- `SignJWT(...).sign(privateKey)` + a `JWTVerifyGetKey` that returns the
  matching public key — no network involved.

What 0b-2 should do _first_: read `apps/backend/src/lib/oauth/*.ts` and the
auth routes so the client request shapes match exactly. The
`AuthResponse.token` is the bearer token for `Authorization: Bearer ...` —
store it in `expo-secure-store` on iOS / `localStorage` on web (see
`apps/workshop/src/lib/storage.ts` patterns from CLAUDE.md). Hit
`GET /v1/auth/me` to revalidate the session on cold start.

Known constraints for 0b-2:

- The Apple SDK on iOS surfaces `email` + `fullName` _only_ on first sign-in.
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

#### 3.4 What 0b-2 actually shipped — start here for 0c

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

What 0c should do _first_: read `docs/plans/HANDOFF.md`, then work through
the three fronts (portals → SSM → Cloudflare Pages) mostly independently.
The only deliberate ordering is that SSM params have to exist before the
Terraform apply that wires them into Lambda env vars, and real OAuth client
IDs have to be pasted into SSM _before_ the client's Sign-in buttons stop
showing the warning dialog.

#### 3.5 What 0c-1 actually shipped — start here for 0c-2

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

What 0c-2 should do _first_: read `docs/plans/HANDOFF.md` top to bottom.
The ordering there is deliberate: portals produce identifiers, identifiers
get pasted into SSM, SSM must exist before `terraform apply` wires the
Lambda env vars, and real client IDs must be in SSM before the client
sign-in buttons stop showing warning dialogs.

#### 3.6 What 0c-2 actually shipped — start here for the next chunk

The portal + SSM + Terraform apply + Cloudflare Pages env vars landed
ahead of the client PR (notes inlined in §"Current status" → "Done"
above). The client SDK PR (#56, this session) closed out Phase 0:

- `apps/workshop/src/lib/oauth/apple.ts` (native) — `useAppleSignIn()`
  hook. Generates a UUID raw nonce, hashes via
  `Crypto.digestStringAsync(SHA256, …)`, calls
  `AppleAuthentication.signInAsync({ requestedScopes: [FULL_NAME, EMAIL],
nonce: hashedNonce })`. Returns `{ identityToken, nonce: hashedNonce,
email?, fullName? }`. **Nonce semantics**: Apple emits
  `claims.nonce = sha256(suppliedNonce)`, so the client forwards the
  _hashed_ value to the backend — `verifyAppleIdentityToken` compares
  the hashed value the client sent against the (already hashed) claim.
  Don't forward the raw nonce or verification fails.
- `apps/workshop/src/lib/oauth/apple.web.ts` — lazy-loads
  `https://appleid.cdn-apple.com/.../appleid.auth.js`,
  `init({ clientId: EXPO_PUBLIC_APPLE_SERVICES_ID, scope: "name email",
redirectURI: window.location.origin, usePopup: true })`,
  `signIn()` returns `{ identityToken, email?, fullName? }`. Cancels
  (`popup_closed_by_user`) resolve `null`. **No nonce roundtrip** —
  Apple JS in popup mode doesn't surface one to the caller; the
  backend's `verifyAppleIdentityToken` already accepts an optional
  nonce.
- `apps/workshop/src/lib/oauth/google.ts` (native) — `useGoogleSignIn()`
  hook. Calls `WebBrowser.maybeCompleteAuthSession()` at module load,
  uses `Google.useAuthRequest({ iosClientId:
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID })`. `signIn()` awaits
  `promptAsync()`, extracts `params.id_token` (preferred) or
  `authentication.idToken` (fallback). Returns `{ idToken }`.
  **iOS native gotcha**: Google's iOS OAuth client redirects via the
  reverse client ID URL scheme; `app.json` is missing
  `ios.infoPlist.CFBundleURLTypes` — a TestFlight build needs that
  before the redirect lands back in the app. Tracked under "Pending"
  in §"Current status".
- `apps/workshop/src/lib/oauth/google.web.ts` — lazy-loads GIS
  (`https://accounts.google.com/gsi/client`), initializes
  `google.accounts.id.initialize({ client_id, callback, auto_select: false
})` with a `resolveRef` pattern so each call resolves a single
  Promise. Renders an off-screen button host (`-9999px`, opacity 0)
  via `renderButton(host, { type: "standard", size: "large" })` and on
  `signIn()` finds the inner clickable (`div[role='button'], button,
span`), clicks it, and falls back to `google.accounts.id.prompt()`
  if no inner is found yet — that fallback is what the Playwright
  stub exercises.
- `apps/workshop/app/sign-in.tsx` — uses both hooks, disables a
  provider button when its `available` flag is false (audience env
  unset or SDK didn't load), shows
  `sign-in-providers-unconfigured` empty-state copy when neither is
  configured. All `Alert.alert` / `window.alert` warning paths are
  gone. The dev-auth button (`testID="sign-in-dev"`) still renders
  behind `EXPO_PUBLIC_DEV_AUTH === "1"`.
- `apps/workshop/src/hooks/useAuth.tsx` — adds
  `AUTO_DEV_OPT_OUT_KEY = "workshop.disable-auto-dev"`. The
  `autoDevSignIn` boot path early-returns when that key is set in
  storage, which is how Playwright keeps the sign-in screen rendered
  even with `EXPO_PUBLIC_DEV_AUTH=1`.
- `apps/workshop/app.json` — `expo-apple-authentication` added to
  the `plugins` array. iOS prebuild will pick this up once a native
  build runs (Expo fingerprint will detect the change and auto-trigger
  a TestFlight build on the next merge to `main`).
- `apps/workshop/package.json` — `expo-apple-authentication ~55.0.13`,
  `expo-auth-session ~55.0.15`, `expo-crypto ~55.0.14`,
  `expo-web-browser ~55.0.14` (all pinned via
  `pnpm exec expo install`).
- `tests/e2e/helpers.ts` (new) — three helpers:
  - `disableAutoDevSignIn(page)` — `addInitScript` that sets
    `localStorage["workshop.disable-auto-dev"] = "1"` so the
    AuthProvider doesn't auto-sign-in.
  - `stubGoogleIdentityServices(page, jwt)` — `addInitScript` that
    defines `window.google.accounts.id` with `initialize` (stores
    the callback), `prompt` (queueMicrotask invokes the callback with
    `{ credential: jwt }`), and no-op `renderButton` / `cancel` /
    `disableAutoSelect`. The production `google.web.ts` falls back to
    `prompt()` when the rendered button has no inner clickable, so
    the stub is reachable end-to-end.
  - `mockGoogleAuthEndpoint(page, authResponse)` —
    `page.route("**/v1/auth/google", ...)` returns the supplied
    response body verbatim. The backend's `ok(c, data)` returns the
    body directly (no `{ data: ... }` wrapper), so the test fetches a
    real `/v1/auth/dev` response and forwards it unchanged — the
    session token is therefore signed by the running server's
    `SESSION_SECRET` and the subsequent `PATCH /v1/users/me` works.
- `tests/e2e/sign-in-google.spec.ts` (new) — drives the GIS-stub flow
  through display-name → home. Uses `request.post("/v1/auth/dev")` for
  the AuthResponse, `disableAutoDevSignIn` + `stubGoogleIdentityServices`
  - `mockGoogleAuthEndpoint` before `page.goto("/")`, then
    `getByTestId("sign-in-google").click()` and asserts on the
    display-name input + home greeting.
- `tests/e2e/{sign-in,list-flow}.spec.ts` (modified) — add
  `await disableAutoDevSignIn(page)` before `page.goto("/")` so they
  still pass with `EXPO_PUBLIC_DEV_AUTH=1` set globally.
- `scripts/e2e.sh` — exports stub `EXPO_PUBLIC_APPLE_SERVICES_ID` /
  `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
  so the sign-in screen treats both providers as available; tests
  stub the SDK callbacks directly so no value ever leaves the browser.

What the next chunk (2b-1 client search modal — see §3.14) should do
_first_: read `apps/backend/src/routes/v1/search.ts` for the response
shapes (`MediaSearchResponse`, `BookSearchResponse` in
`@workshop/shared`) and `apps/workshop/app/list/[id]/add.tsx` for the
current "search lands in Phase 2" stub banner. The new
`src/api/search.ts` should mirror the existing `src/api/items.ts`
shape (one function per route, thin wrapper, no caching — TanStack
Query owns caching). The 2b-1 row in §3.14 is the source of truth for
the deliverable list.

#### 3.7 Original Phase 0 deliverable list

(Each item is now annotated with the chunk that lands it.)

**Deliverables**:

1. **Migrations** (`apps/backend/drizzle/`) — _0a_
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
2. **OAuth auth rewrite** (`apps/backend/src/routes/v1/auth.ts`, `users.ts`) — _0b-1_
   - `POST /v1/auth/apple` — body: `{ identityToken, nonce }`. Verify JWT
     against Apple's JWKS (`https://appleid.apple.com/auth/keys`), check
     `aud` matches the iOS bundle ID _or_ the Services ID (web), check
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
3. **Rate-limit middleware** (`apps/backend/src/middleware/rate-limit.ts`) — _0a_ (created), _0b-1_ (wired to `/v1/auth/*`, per-IP, 30/min)
   - Table-backed by `rate_limits`. Applied to `/v1/auth/*` first (by IP —
     cheap abuse surface); item/search limits wired when those routes land.
4. **Response envelope helper** (`apps/backend/src/lib/response.ts`) — _0a_
   - `ok(data)`, `err(code, message, details?)` — uniform `{ error, code }` per
     spec §8.
5. **Client — sign-in + display-name capture** — _0b-2_
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
6. **Primitives library skeleton** (`apps/workshop/src/ui/`) — _0b-2_
   - `theme.ts` (palette + tokens per §9 Appendix; dark-only initially),
     `useTheme.ts`, `Text.tsx`, `Button.tsx`, `IconButton.tsx`, `Card.tsx`,
     `EmptyState.tsx`. Enough to rebuild sign-in + onboarding. (No
     `TextField` needed for Phase 0 — OAuth has no inputs; defer to Phase 1.)
   - Old `src/components/theme.ts` — migrate sign-in to tokens, then delete
     the hex palette exports.
7. **Infra** (`infra/`) — _0c_
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
8. **Shared types** (`packages/shared/src/types.ts`) — _0a_ (skeleton: `User`,
   `AuthProvider`, `ListType`, `MemberRole`, `ActivityEventType`, `Me`,
   `ApiErrorResponse`, `ErrorCode`); _0b-1_ (`AppleAuthRequest`,
   `GoogleAuthRequest`, `AuthResponse` `{ user, token, needsDisplayName }`,
   `UpdateMeRequest`)
   - Remove `RecItem`, `RecCategory`, old auth request/response types.

**Dependencies**: None — this is the base of the stack. Prereq setup
(outside code): Apple Developer portal — enable Sign in with Apple on the
App ID, create a Services ID + return URL for web, create a Sign in with
Apple key (.p8) → stored only for _token signing_ if we use "Sign in with
Apple on the server"; for _token verification_ (our case, since we only
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
  once; real OAuth client IDs and API keys must be pasted into SSM _before_
  the client hits `/v1/auth/*` or enrichment endpoints. Track in
  HANDOFF.md.

---

### Phase 1 — Core list CRUD (single-user happy path)

**Goal**: A user can create a list (date-idea / trip type only, free-form),
add items, upvote, complete, edit, delete. All single-user for now — sharing
is Phase 3.

Phase 1 ships as a stack of chunks (mirroring Phase 0) so each PR is reviewable
on its own and `main` stays deployable between landings.

#### 3.8 Phase 1 chunks

| Chunk    | What ships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | External deps                                                                                                       | Status             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **1a-1** | Backend lists CRUD: `GET /v1/lists` (with `role`/`memberCount`/`itemCount` aggregates), `POST` (transactional list + owner-member insert), `GET /:id` (list + members + empty `pendingInvites`), `PATCH /:id` (owner only), `DELETE /:id` (owner only; cascades). `requireListMember` + `requireListOwner` middleware (404 vs 403 — non-members get 404 to avoid leaking existence). Shared types `List`, `ListSummary`, `ListMemberSummary`, `PendingInvite`, `CreateListRequest`, `UpdateListRequest` and the matching response shapes. Vitest coverage of input validation + auth gating (20 tests).                                                                                                                                                                                                                                                                                             | None — runs against the existing local Postgres and v2 schema; doesn't depend on 0c-2's portal/SSM/Cloudflare work. | **Done** (this PR) |
| **1a-2** | Backend items CRUD + upvote + complete: `GET /v1/lists/:id/items` (with `upvote_count` aggregate via `LEFT JOIN ... COUNT(*)::int` + per-user `has_upvoted`), `POST` (transactional: insert item + insert creator's upvote in one tx — spec §2.3), `GET /v1/items/:id`, `PATCH`, `DELETE`, `POST/:id/upvote` (idempotent), `DELETE/:id/upvote`, `POST/:id/complete`, `POST/:id/uncomplete`. `requireItemMember` helper that resolves the item's list and reuses `requireListMember`'s membership check. Shared types `Item`, `ItemListResponse`, `ItemResponse`, request bodies. Sort order: `upvote_count DESC, created_at DESC` per spec §7.7; completed-only filter sorts by `completed_at DESC` per spec §2.4. Rate limits wired: `POST /lists/:id/items` 60/user/min, upvote endpoints 120/user/min per spec §8. Vitest coverage of input validation + auth gating + UUID bail-out (29 tests). | None.                                                                                                               | **Done** (this PR) |
| **1b-1** | Client TanStack Query foundation + home screen: `apps/workshop/src/lib/query.ts` (`QueryClient` with `refetchOnWindowFocus` / `refetchOnReconnect`), `src/lib/queryKeys.ts` (centralized factory), `src/api/lists.ts` (typed wrappers around `/v1/lists`), `app/index.tsx` rewritten as the rich list-cards home with FAB and empty state. New primitives in `src/ui/`: `Sheet`, `Modal`, `Toast`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | None.                                                                                                               | **Done** (this PR) |
| **1b-2** | Client list detail + create-list flow: `app/list/[id]/index.tsx` (filter bar + completed section), `app/list/[id]/item/[itemId].tsx`, `app/list/[id]/add.tsx` (free-form for date-idea / trip; movie/TV/book stubs route to free-form until Phase 2), `app/create-list/type.tsx` + `customize.tsx`. New primitives: `UpvotePill`, `Avatar`, `Chip`. Optimistic-update helpers for upvote/complete/add with toast rollback. `expo-haptics` wired on upvote/complete/delete (no-op `.web.ts`). One Playwright happy-path: create list → add item → upvote → complete.                                                                                                                                                                                                                                                                                                                                 | None.                                                                                                               | **Done** (this PR) |

#### 3.9 What 1a-1 actually shipped — start here for 1a-2

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
  - `GET /` uses `db.execute(sql\`...\`)`for the aggregate query (member +
item count subselects). The Drizzle relational API can do this but the
raw SQL is shorter and easier to audit. The result is cast through`Array<Record<string, unknown>> | { rows: ... }`because`postgres-js`sometimes returns one shape and sometimes the other depending on the
statement; do the same in 1a-2's`GET /lists/:id/items` aggregate.
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

What 1a-2 should do _first_: read `apps/backend/src/routes/v1/lists.ts` end
to end (especially `toListShape`, the `db.transaction` shape, and the raw
SQL aggregate) and `apps/backend/src/middleware/authorize.ts`. Items reuse
the same helpers — `requireListMember` already reads `:id` from the path,
so the natural URL shape for the _item-keyed_ routes (`GET /v1/items/:id`,
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

What 1b-1 should do _first_: read `apps/backend/src/routes/v1/items.ts`
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

What 1b-2 should do _first_: replace the FAB's toast handler in
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

#### 3.12 What 1b-2 actually shipped — start here for 2a-1

Files that landed in 1b-2 (read these before touching 2a-1):

- `apps/workshop/src/ui/UpvotePill.tsx` — `<UpvotePill count hasUpvoted
onPress disabled />`. Pill with up-arrow glyph + count divided by a 1px
  rule. `accessibilityState={{ selected: hasUpvoted }}`. Tokens-only
  styling — `tokens.accent.muted` background + `tokens.accent.default`
  border when selected; unselected falls back to `tokens.bg.elevated` +
  `tokens.border.default`. Disabled = 0.5 opacity, pressed = 0.7. Min size
  56×36 — large enough to land an iOS thumb without crowding adjacent
  items in a list.
- `apps/workshop/src/ui/Avatar.tsx` — `<Avatar name size>`. Initials
  derived from `name` (first + last word's first char). Background colour
  is hashed deterministically off `name` through `tokens.list.*`, so the
  same display name renders the same colour in every screen. Three
  sizes (`sm: 24`, `md: 32`, `lg: 48`) — used at `md` in the list
  detail header (added-by avatar) and `sm` in completed-section rows.
- `apps/workshop/src/ui/Chip.tsx` — `<Chip label selected onPress
disabled />`. Pressable when `onPress` is provided, otherwise a static
  pill (no `accessibilityRole`). Same selected/unselected colour pair
  as `UpvotePill`. Used by the type picker in `create-list/type.tsx`
  and earmarked for Phase 2's filter sheet.
- `apps/workshop/src/ui/index.ts` — exports the three new primitives
  alphabetised.
- `apps/workshop/src/lib/haptics.ts` — wraps `expo-haptics` with four
  named verbs: `light()`, `medium()`, `success()`, `warning()`. Callers
  fire-and-forget — errors are swallowed so a haptics failure can't
  break a mutation. `apps/workshop/src/lib/haptics.web.ts` is a no-op
  shim with the same signatures so Metro picks it on the web bundle and
  upvote/complete handlers don't need a `Platform.OS` branch.
- `apps/workshop/package.json` — adds `expo-haptics: ~55.0.14` (installed
  via `npx expo install` so the version matches Expo SDK 55).
- `apps/workshop/src/api/items.ts` — typed wrappers mirroring the v1
  envelope: `fetchItems(token, listId, { completed? })`,
  `fetchItem(token, itemId)`, `createItem(token, listId, body)`,
  `updateItem`, `deleteItem`, `upvoteItem`, `removeUpvote`,
  `completeItem`, `uncompleteItem`. All thin — TanStack Query owns
  caching. **2a-1 should mirror the same shape for `src/api/search.ts`
  and `src/api/linkPreview.ts`** when the backend lands.
- `apps/workshop/src/lib/queryKeys.ts` — adds
  `items.byListFiltered(listId, completed)` so the active and
  completed FlatLists in `list/[id]/index.tsx` cache separately.
  Invalidations on item mutations clear the parent
  `items.byList(listId)` prefix, which matches both filtered keys.
- `apps/workshop/app/create-list/type.tsx` — five-card type picker
  (movie / tv / book / date_idea / trip). Each card shows the emoji,
  label, and one-line subtitle. Tapping a card calls
  `router.push("/create-list/customize?type=<type>")`.
- `apps/workshop/app/create-list/customize.tsx` — name field (required,
  1–100 chars), emoji picker (12 preset glyphs), colour picker (the
  seven `tokens.list.*` keys), optional description. `useMutation`
  calls `createList`; `onSuccess` invalidates `queryKeys.lists.all`,
  then `router.dismissAll()` + `router.replace("/list/<id>")` so the
  back button on the new list-detail screen returns to home rather
  than the create flow.
- `apps/workshop/app/list/[id]/index.tsx` — list detail. Header has a
  back button + the list's emoji + name + a coloured stripe pulled
  from `tokens.list[colorKey]`. Three `useQuery`s: list detail, active
  items, completed items (the second/third use the new
  `items.byListFiltered` keys). A client-only `<TextInput>` filter bar
  (spec §4.2 — substring match on `title` only) drives a `useMemo`
  filter over the active list. Each row is an `ItemRow` with
  `<UpvotePill>`, the title (line-through when completed), and a
  complete button. `upvoteMutation` does optimistic
  `onMutate`/`onError` rollback against both filtered keys; the
  complete mutation invalidates on success. The completed section
  renders as `ListFooterComponent` of the active FlatList so a single
  scroll surface contains both. FAB pushes
  `/list/<id>/add`.
- `apps/workshop/app/list/[id]/item/[itemId].tsx` — item detail.
  Editable `title` / `url` / `note` fields, kept in local state and
  re-synced from the query whenever the underlying item changes
  (`useEffect` keyed off `item.updatedAt`). `<UpvotePill>` for the
  current user, complete toggle, save (dirty-check before firing),
  delete (calls `router.back()` after success). Tapping the URL
  preview opens via `Linking.openURL`.
- `apps/workshop/app/list/[id]/add.tsx` — modal (`presentation:
"modal"` on the parent stack). Free-form `title` + optional `url` +
  optional `note`. Movie/TV/book lists show a banner that says "search
  lands in Phase 2 — for now, type the title manually." `useMutation`
  optimistically inserts the new item into
  `items.byListFiltered(listId, false)`, then invalidates and
  `router.back()`s.
- `apps/workshop/app/index.tsx` — wires the FAB and the empty-state
  CTA to `router.push("/create-list/type")`. List cards are now
  `<Pressable>` and navigate to `/list/<id>` on press. Removed the
  `useToast` placeholder import that 1b-1 had stubbed in.
- `apps/workshop/app/_layout.tsx` — registers the new routes:
  `create-list/type`, `create-list/customize` (both with
  `animation: "slide_from_right"`), `list/[id]/index`,
  `list/[id]/add` (`presentation: "modal"`), `list/[id]/item/[itemId]`.
  No nested `_layout.tsx` under `create-list/` — the per-screen
  animation override on the parent stack is enough, and a nested
  layout caused expo-router to log "no route named create-list in
  nested children" because it flattens the leaf names into the
  parent's child registry.
- `tests/e2e/list-flow.spec.ts` — Playwright happy-path under
  `EXPO_PUBLIC_DEV_AUTH=1` + `DEV_AUTH_ENABLED=1` (set by
  `scripts/e2e.sh`): dev sign-in → onboarding (if first-run) → FAB →
  pick "Date idea" → name + submit → empty state → add item with
  free-form title → upvote → complete. The test relies on `testID`s
  added throughout 1b-2's screens (`fab-create-list`,
  `type-card-<type>`, `list-name-input`, `submit-create-list`,
  `add-item-fab`, `add-item-title`, `submit-add-item`,
  `upvote-button-<itemId>`, `complete-button-<itemId>`).

What 2a-1 should do _first_: read `apps/backend/src/routes/v1/items.ts`
end to end (the loose `metadata: z.record(z.string(), z.unknown())`
that 1a-2 left as a TODO — Phase 2 swaps in per-list-type validators
per spec §9.4) and `apps/backend/src/routes/v1/lists.ts` for the
`requireListMember` + `app.route` mounting pattern. The new
`v1/search.ts` and `v1/link-preview.ts` routes follow the same shape:
`requireAuth` middleware, Zod query-param validation, response shape
declared in `@workshop/shared/types`. The metadata cache table
(`metadata_cache (source TEXT, source_id TEXT, payload JSONB,
fetched_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, PRIMARY KEY (source,
source_id))`) is a new Drizzle migration; `pnpm run db:generate --
--name=add_metadata_cache` from `apps/backend/`.

Known constraints for 2a-1:

- TMDB and Google Books API keys live in SSM (Phase 0 placeholders).
  `apps/backend/src/lib/config.ts` already declares the env vars; the
  Lambda env-var wiring in `infra/lambda.tf` was set up in 0c-1.
  Locally, drop real keys into `apps/backend/.env` (gitignored) before
  hitting the search routes.
- The link-preview route is the most security-sensitive surface so
  far. Build the SSRF allowlist with a tested IP-range library
  (`ipaddr.js`) per spec §8.5 — block RFC1918, loopback, link-local,
  AWS metadata IP. Add a regression test that hits
  `http://169.254.169.254/`. 3s timeout, 1MB body cap, 3 redirects max.
- Per-type metadata Zod validators (spec §9.4): keep the existing
  `metadata: z.record(...)` as a default fallback so unknown list
  types don't block writes; layer the per-type validators on top with
  a discriminated union keyed off the parent list's `type`.
- Rate limits on `POST /v1/search/*` per spec §8 — wire inline using
  the existing `rateLimit({ family, key })` middleware with a
  `userId`-derived key (the search routes are auth-only).

#### 3.13 Original Phase 1 deliverable list

(Each item is annotated with the chunk that lands it.)

**Deliverables**:

1. **Backend routes** (`apps/backend/src/routes/v1/`)
   - `lists.ts` — `GET /v1/lists`, `POST`, `GET /:id`, `PATCH /:id`, `DELETE /:id`. — _1a-1_
   - `items.ts` — `GET /v1/lists/:id/items`, `POST`, `GET /v1/items/:id`,
     `PATCH`, `DELETE`, `POST /:id/upvote`, `DELETE /:id/upvote`,
     `POST /:id/complete`, `POST /:id/uncomplete`. — _1a-2_
   - Helpers: `requireListMember` / `requireListOwner` middleware (1a-1)
     plus `requireItemMember` (1a-2) used by every item-keyed route.
2. **Item creation transactionally inserts the creator's upvote** (spec §2.3). — _1a-2_
3. **List query returns `upvote_count` as a computed column** via
   `LEFT JOIN ... COUNT(...)::int` (spec §7.7). Sort: `upvote_count DESC,
created_at DESC`. — _1a-2_
4. **Client**
   - `app/index.tsx` — Home with rich list cards, empty state, FAB. — _1b-1_
   - `app/create-list/_layout.tsx` + `type.tsx` + `customize.tsx` —
     create-list modal stack (skip the Invite screen in P1; added in P3). — _1b-2_
   - `app/list/[id]/index.tsx` — list detail with filter bar, upvote pill,
     completed section. — _1b-2_
   - `app/list/[id]/item/[itemId].tsx` — item detail. — _1b-2_
   - `app/list/[id]/add.tsx` — free-form add (date-idea/trip type only).
     Movie/TV/Book add pathway is a stub that routes to free-form until P2. — _1b-2_
   - New primitives: `Sheet`, `Modal`, `Toast` (1b-1); `UpvotePill`,
     `Avatar`, `Chip` (1b-2).
5. **TanStack Query integration** (`apps/workshop/src/lib/query.ts`) — _1b-1_
   - `QueryClient` setup with `refetchOnWindowFocus`, `refetchOnReconnect`.
   - `queryKeys.ts` — centralized key factory (`lists.all`, `lists.detail(id)`,
     `items.byList(id)`, `items.detail(id)`).
   - Optimistic update helpers for upvote, complete, add — _1b-2_. Rollback
     with toast on error (spec §5.5).
6. **Shared types**: `List`, `ListMemberSummary`, list CRUD request bodies — _1a-1_;
   `Item`, item CRUD request bodies — _1a-2_.
7. **Haptics**: wire `expo-haptics` on upvote / complete / delete (no-op on
   web — handle via `.web.ts` override). — _1b-2_

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

#### 3.14 Phase 2 chunks

Each chunk is independently shippable; CI gates on backend tests +
Playwright. The split mirrors Phase 1: 2a is backend-only and 2b is
client-only.

| Chunk    | What ships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | External deps                                                                                         | Status         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------- |
| **2a-1** | Backend search + metadata cache: `apps/backend/src/routes/v1/search.ts` (`GET /v1/search/media?type=movie\|tv`, `GET /v1/search/books`) proxying TMDB / Google Books behind SSM-sourced API keys, normalising into the spec §9 shapes. New `apps/backend/src/lib/metadata-cache.ts` (`upsert(source, source_id, payload, ttl)` + `lookup(source, source_id)`) backed by a new `metadata_cache` Drizzle migration. Per-type Zod validators for `items.metadata` applied on `POST/PATCH /v1/items` (movie / tv / book shapes; date-idea / trip stay loose for 2a-2). Rate limits on `POST /v1/search/*` at 60/user/min. Vitest coverage of validators + cache TTL + auth gating. | TMDB API key + Google Books API key in SSM (placeholders from Phase 0; production needs real values). | Done           |
| **2a-2** | Backend link preview: `apps/backend/src/routes/v1/link-preview.ts` (`GET /v1/link-preview?url=`). SSRF allowlist via `ipaddr.js` (block RFC1918 / loopback / link-local / 169.254.169.254). 3s timeout, 1MB cap, 3 redirects. OG + Twitter card parser. Cached through the 2a-1 `metadata-cache` (7-day TTL). Rate limit 30/user/min. SSRF regression test + parser unit tests.                                                                                                                                                                                                                                                                                                | None — uses the metadata cache from 2a-1.                                                             | Done           |
| **2b-1** | Client search modal: `app/list/[id]/add.tsx` rewrites the movie/TV/book "stub" banner from 1b-2 into a real type-aware add flow. New primitive `<SearchResultRow>` (poster + title + year + add button). New `useDebouncedQuery(input, 300)` hook. New `src/api/search.ts` typed wrappers. Selecting a result calls `createItem` with the normalised metadata pre-filled. Playwright: add a movie via search on a movie list.                                                                                                                                                                                                                                                  | 2a-1.                                                                                                 | Done (this PR) |
| **2b-2** | Client URL link preview: `app/list/[id]/add.tsx` for date-idea / trip lists fetches `/v1/link-preview` on URL `onBlur` (debounced + cancellable via `AbortController`). New `src/api/linkPreview.ts`. Inline preview card under the URL field with poster + site name + title; "couldn't fetch preview" fallback after 3s. Playwright: paste a URL, see the preview, save.                                                                                                                                                                                                                                                                                                     | 2a-2.                                                                                                 | Done (this PR) |

#### 3.15 What 2a-1 actually shipped — start here for 2a-2

Files that landed in 2a-1 (read these before touching 2a-2):

- `apps/backend/src/lib/metadata-cache.ts` — `lookupCacheEntry<T>(source,
sourceId, db?)` + `upsertCacheEntry<T>(source, sourceId, data,
ttlSeconds, db?)`. The `db?` parameter exists so vitest can pass a
  fake without touching postgres. `expires_at` is computed at write
  time (`now() + ttl::int * interval '1 second'`) and the lookup
  filters on `expires_at > now()` — expired rows are left in place for
  a future cleanup job rather than pruned on the read path. `CacheTtl`
  exports the per-source TTLs: `tmdb` and `googleBooks` are 30 days,
  `linkPreview` is 7 days. **2a-2 should reuse `CacheTtl.linkPreview`
  and `upsertCacheEntry` directly** rather than re-deriving expiry
  math.
- `apps/backend/drizzle/0003_add_metadata_cache_expires_at.sql` —
  `metadata_cache` already had `(source, source_id, data, fetched_at)`
  from 0a; this migration adds `expires_at TIMESTAMPTZ NOT NULL DEFAULT
now()`. The `DEFAULT` is there for safety on existing rows; the
  insert path always provides an explicit `expires_at`.
- `apps/backend/src/routes/v1/search.ts` — `GET /media?type=movie|tv&q`
  and `GET /books?q`. Both are `requireAuth`-gated and rate-limited at
  60/user/min via `rateLimit({ family: "v1.search.{media,books}", key:
userKey })`. Cache key is `tmdb:{type}` + `q-search:<lowercased
trimmed q>` for media; `google_books:search` + same key for books.
  Cache writes are best-effort (`.catch(...)` + `logger.warn`) so a
  cache outage doesn't fail the response. `__testing.setDeps({
fetchTmdb?, fetchGoogleBooks?, lookupCache?, upsertCache? })` is the
  test seam — all four are typed mocks; tests use them to bypass real
  upstream calls and the postgres-backed cache. **2a-2 should mirror
  this `__testing.setDeps` shape on `link-preview.ts`** — the cache
  test seam in particular (lookup / upsert mocks) is the cleanest way
  to keep handler tests off postgres.
- `apps/backend/src/routes/v1/items.ts` — adds per-type Zod schemas
  (`movieTvMetadataSchema`, `bookMetadataSchema`, `placeMetadataSchema`,
  all `.strict()` so stray fields reject), a
  `metadataSchemasByType: Record<ListType, ZodType<ItemMetadata>>`
  map, an exported `validateMetadataForType(type, metadata)`, and an
  `ItemMetadataError` class. `createItem()` validates against the
  parent list's `type` inside the transaction; PATCH `/:id` re-fetches
  `items.type` (denormalised) and validates the same way when
  metadata is present. The route handler in `lists.ts` translates
  `ItemMetadataError` to `err(c, "VALIDATION", …, issues)` so the
  client gets a structured 400.
- `packages/shared/src/types.ts` — adds `MediaSearchType`,
  `MediaResult`, `BookResult`, `MediaSearchResponse`, `BookSearchResponse`,
  and the per-type metadata shapes (`MovieMetadata`, `TvMetadata =
MovieMetadata`, `BookMetadata`, `PlaceMetadata`). 2b-1 should import
  the result types directly rather than re-declaring them in
  `src/api/search.ts`.
- `apps/backend/src/lib/config.ts` — reads `TMDB_API_KEY` and
  `GOOGLE_BOOKS_API_KEY` from env (both default to empty strings). The
  search routes return `500 INTERNAL` when the key is empty; locally,
  drop real keys into `apps/backend/.env` (gitignored) before hitting
  the routes.
- `apps/backend/src/app.ts` — mounts `/v1/search` via `app.route`. Auth
  rate-limit middleware was already global on `/v1/auth/*`; the search
  routes carry their own per-user rate limit.

What 2a-2 should do _first_: read `apps/backend/src/routes/v1/search.ts`
end to end (the cache wiring + `__testing.setDeps` test seam is the
template) and `apps/backend/src/lib/metadata-cache.ts` (`CacheTtl`
already declares `linkPreview: 7 * 86400`). The new
`v1/link-preview.ts` route follows the same shape: `requireAuth`
middleware, Zod query-param validation, response shape declared in
`@workshop/shared/types` (add `LinkPreview` and `LinkPreviewResponse`
there). Cache reads/writes go through `lookupCacheEntry<LinkPreview>(
"link_preview", urlHash)` / `upsertCacheEntry(..., CacheTtl.linkPreview)`.

Known constraints for 2a-2:

- SSRF is the headline risk per spec §8.5. Use `ipaddr.js` (already on
  npm; not yet a dep) to parse the resolved IP and block RFC1918,
  loopback, link-local, and the AWS metadata IP (`169.254.169.254`).
  Resolve the hostname _yourself_ before fetching so a redirect to a
  blocked IP doesn't slip past — `fetch` won't tell you the IP it
  actually connected to. Add a regression test that hits
  `http://169.254.169.254/`.
- 3s timeout (`AbortSignal.timeout(3000)`), 1MB body cap (read in
  chunks, abort if exceeded), 3 redirects max. The TMDB / Google Books
  fetchers in `search.ts` use `AbortSignal.timeout(5000)` — same
  pattern, tighter window.
- Rate limit: `rateLimit({ family: "v1.link-preview", limit: 30,
windowSec: 60, key: userKey })`. Same `userKey` helper as
  `search.ts`; user-keyed because the route is auth-only.
- Cache key: `link_preview` source + a stable hash of the normalised
  URL (`new URL(input).href`) as `source_id`. Don't store the raw URL
  as the source_id — `metadata_cache.source_id` is `TEXT NOT NULL` but
  long URLs make for ugly index keys; `crypto.createHash("sha1")` over
  the normalised URL is plenty.
- Per-type Zod metadata validators (spec §9.4) are wired _but the
  date_idea / trip schemas are still permissive_. 2a-2 should keep the
  current `placeMetadataSchema` shape compatible with what
  `link-preview.ts` writes back — the response body will be inserted
  into `items.metadata` by 2b-2, and the validator runs on every
  `POST/PATCH /v1/items`. If you add a field to `LinkPreview`, add it
  to `placeMetadataSchema` in the same PR.

#### 3.16 What 2a-2 actually shipped — start here for 2b-1 / 2b-2

Files that landed in 2a-2 (read these before touching 2b-1 or 2b-2):

- `apps/backend/src/lib/ssrf-guard.ts` — the standalone SSRF guard
  module. Three exports: `class SsrfBlockedError extends Error` (carries
  `host` + `reason`), `classifyIp(ip)` (`{ ok: true } | { ok: false;
reason }` — only `ipaddr.js` `unicast` is allowed; `169.254.169.254`
  is also explicitly denied as a belt-and-suspenders catch even though
  `link-local` already covers it), `parseAndValidateUrl(input)` (parses
  - checks http(s) protocol, no userinfo, IP-literal classification),
    and `assertHostnameSafe(hostname, deps?)` (resolves via
    `dns.lookup({ all: true, verbatim: true })` and rejects if _any_
    returned address is in a blocked range). Handles IPv4-mapped IPv6
    (`::ffff:a.b.c.d`) by rechecking against the v4 deny list. **Reuse
    this module unchanged** for any future outbound fetch — the route
    wires it in two places (URL validation up-front + per-redirect-hop
    inside the fetcher).
- `apps/backend/src/lib/ssrf-guard.test.ts` — 24 cases covering v4/v6
  loopback / RFC1918 / link-local / multicast / broadcast /
  ipv4-mapped, plus literal-vs-DNS paths and the mixed-answers (one
  public + one private) regression that proves "all addresses checked,
  not just the first."
- `apps/backend/src/routes/v1/link-preview.ts` — `GET /` route
  (`requireAuth` + `rateLimit({ family: "v1.link-preview", limit: 30,
windowSec: 60, key: userKey })`). Pipeline: Zod-validate the `url`
  query param → `parseAndValidateUrl` (throws `SsrfBlockedError` →
  400 `VALIDATION` for IP literals) → cache lookup (sha1 of
  `parsedUrl.href` as `source_id`, source `link_preview`) → on miss,
  `fetchPage(url)` runs a manual redirect loop (max 3 hops, each calls
  `assertHostnameSafe` first; `redirect: "manual"` so we control every
  hop) → `readCappedBody` reads chunks via `getReader()` and aborts at
  1 MB → `parseOgMeta` extracts og:/twitter:/`<title>` from the `<head>`
  block → `buildPreview` resolves relative `og:image` against
  `finalUrl` and falls back `siteName` to the host of `finalUrl`. SSRF
  errors thrown _during_ fetch (e.g. a redirect that resolves to a
  private IP) are caught and returned as 400 `VALIDATION`, not 500 —
  same shape as the up-front URL check. Cache writes are best-effort
  (`.catch(...)` + `logger.warn`) — same pattern as `search.ts`.
  `__testing.setDeps({ fetchPage?, lookupCache?, upsertCache? })` is
  the test seam; `__internal = { parseOgMeta, cacheKeyFor, buildPreview
}` exposes the pure helpers for unit tests without leaking them into
  the route's public surface.
- `apps/backend/src/routes/v1/link-preview.test.ts` — 21 cases:
  `parseOgMeta` (og preferred over twitter and `<title>`, fallback
  chain, HTML-entity decoding, single/unquoted attrs, all-null
  defaults), `cacheKeyFor` (stable + collision-safe + sha1 shape),
  `buildPreview` (relative-image resolution, hostname fallback for
  `siteName`), auth + validation (401 without bearer, 400 on empty /
  unparseable / non-http(s)), SSRF blocks (AWS metadata / loopback /
  RFC1918 literals — fetcher mock asserts it's never called),
  userinfo-URL block, happy-path (returns parsed preview), cache hit
  (fetcher not called), 500 on non-SSRF fetcher errors, 400 on
  `SsrfBlockedError` thrown from inside `fetchPage` (the
  redirect-rebind regression), and best-effort cache writes (200
  preserved when `upsertCache` rejects).
- `apps/backend/package.json` — adds `ipaddr.js` (pinned at `2.3.0` to
  match the existing exact-pin convention for backend deps).
- `apps/backend/src/app.ts` — mounts `/v1/link-preview` via
  `app.route`. Same per-route rate-limit pattern as `/v1/search/*`.
- `packages/shared/src/types.ts` — adds `LinkPreview` (url, finalUrl,
  title, description, image, siteName, fetchedAt) and
  `LinkPreviewResponse` (`{ preview: LinkPreview }`). `PlaceMetadata`
  was widened with optional `title` + `description` so 2b-2 can copy
  the link-preview response body straight into `items.metadata` for
  date_idea / trip lists without the per-type Zod validator rejecting
  it (the schema already accepted those keys via the existing
  `placeMetadataSchema` in `items.ts` — the type now matches).

Live smoke-tested against the running dev backend: blocks
`http://169.254.169.254/`, `http://127.0.0.1/`, `http://10.0.0.1/`, and
`http://user:pw@example.com/` all with 400 `VALIDATION`; happy-path on
`https://example.com/` returns 200 with parsed title.

What 2b-1 should do _first_: read `apps/workshop/app/list/[id]/add.tsx`
(the current "stub" banner from 1b-2) plus the search shapes in
`packages/shared/src/types.ts` (`MediaResult`, `BookResult`,
`MediaSearchResponse`, `BookSearchResponse`). The new
`src/api/search.ts` should import the result types directly rather
than re-declaring them. The `useDebouncedQuery(input, 300)` hook is a
new primitive — `apps/workshop/src/hooks/` is the right home (or
inline beside the modal if it's the only call site for now). The
client doesn't need any new backend work for 2b-1 — `/v1/search/*` is
already live and rate-limited.

What 2b-2 should do _first_: read this section's summary of
`link-preview.ts` (especially the `LinkPreviewResponse` shape) and the
per-type Zod metadata validators in `apps/backend/src/routes/v1/items.ts`
to confirm `placeMetadataSchema` accepts everything `LinkPreview`
returns. The new `src/api/linkPreview.ts` is a typed wrapper around
`GET /v1/link-preview?url=…` — pass the user's input through `new
URL()` client-side first to fail fast on garbage. The `onBlur`
debounce + `AbortController` pattern is described in the §3.14 row;
no new backend work needed.

#### 3.17 What 2b-1 actually shipped — start here for 2b-2

Files that landed in 2b-1 (read these before touching 2b-2):

- `apps/workshop/src/api/search.ts` — typed wrappers `searchMedia(type,
q, token, signal?)` and `searchBooks(q, token, signal?)`. Both return
  `MediaSearchResponse` / `BookSearchResponse` from
  `@workshop/shared`; no re-declared types. Both accept an optional
  `AbortSignal` so TanStack Query can cancel inflight searches when the
  query key changes — **2b-2's `linkPreview.ts` should mirror this
  exact shape** (signal forwarded to `apiRequest`).
- `apps/workshop/src/lib/api.ts` — `apiRequest({ ..., signal })` now
  forwards an optional `AbortSignal` into `fetch`. Reuse this rather
  than building a parallel fetcher in 2b-2.
- `apps/workshop/src/hooks/useDebouncedQuery.ts` — trailing-edge
  300ms debounce. Pure value-debounce, no cancellation. **2b-2 should
  reuse this hook unchanged** for the URL-on-blur debounce; combine
  with TanStack Query's built-in `signal` for cancellation when the
  URL changes mid-flight.
- `apps/workshop/src/ui/SearchResultRow.tsx` — poster (56×84) + title
  - year + secondary subtitle + Add button. `testID` defaults to
    `search-result-${id}` and the button to `search-result-${id}-add`;
    the Playwright spec relies on those exact IDs. Exported via
    `src/ui/index.ts`. The image falls back to a `?` placeholder card
    when no URL is provided so book covers and movie posters render
    consistently.
- `apps/workshop/app/list/[id]/add.tsx` — full rewrite. The screen
  fetches `fetchListDetail` to get the list type (cached by the list
  detail screen, so the read is instant in normal navigation). For
  movie/tv/book it renders `<SearchFlow>` with a TextInput + debounced
  TanStack Query + result rows. For date_idea/trip it renders the
  previous `<FreeFormFlow>` (title + url + note) — **2b-2 attaches the
  link-preview UI inside this branch.** Both flows share one
  `addMutation` that POSTs to `createItem` and invalidates
  `queryKeys.items.byListFiltered(id, false)` + `queryKeys.lists.all`
  on success; the previous hand-rolled `setQueryData` was removed
  because the multi-result path is simpler with pure invalidation.
  Selecting a search result builds metadata via `buildMediaMetadata` /
  `buildBookMetadata` — both omit absent fields (the per-type Zod
  schemas in `items.ts` are `.strict()`, so passing `posterUrl: null`
  would reject; use omission, not null).
- `tests/e2e/add-search.spec.ts` — Playwright happy-path:
  dev-sign-in → create movie list → mock `/v1/search/media` →
  type "matrix" → click `search-result-603-add` → assert the new item
  on the list. The mock fixture intentionally includes one row with
  `posterUrl: null` to exercise the placeholder branch, even though
  the test only adds the first row. Adopts the same
  `Promise.race(displayName, homeGreeting)` pattern that the existing
  `sign-in-google.spec.ts` uses for the post-sign-in branch — **2b-2's
  Playwright spec should use the same race so it survives a dirty dev
  DB where dev@workshop.local already has a displayName**. (The
  pre-existing `tests/e2e/sign-in.spec.ts` does NOT use this race and
  flakes on a dirty DB; that's an unrelated pre-existing issue.)

What 2b-2 should do _first_: read this section's `add.tsx` summary
(especially the `<FreeFormFlow>` branch — that's where the link-preview
fetch + inline card go). The 2b-1 search flow only fires on
movie/tv/book; 2b-2 only fires on date_idea/trip — they don't overlap.

Known constraints for 2b-2:

- The `placeMetadataSchema` in `apps/backend/src/routes/v1/items.ts` is
  `.strict()` and accepts `source`, `sourceId`, `image`, `siteName`,
  `title`, `description`, `lat`, `lng`. The `LinkPreview` response has
  `url`, `finalUrl`, `title`, `description`, `image`, `siteName`,
  `fetchedAt` — when 2b-2 copies the response into `items.metadata`,
  pass only the keys that overlap (`source: "link_preview"`,
  `sourceId: <hash>`, `image`, `siteName`, `title`, `description`).
  Everything else needs explicit handling in items.ts before 2b-2 can
  send it.
- The free-form `url` field still POSTs as the item's `url` column;
  metadata image is separate. Both can coexist on one item.
- Reuse the `useDebouncedQuery` hook (300ms is a fine default; the
  `onBlur` pattern in §3.14 is also valid — pick whichever feels
  right but don't reinvent the debounce primitive).

#### 3.18 What 2b-2 actually shipped — start here for Phase 3

Files that landed in 2b-2 (read these before touching the next chunk):

- `apps/workshop/src/api/linkPreview.ts` — single typed wrapper
  `fetchLinkPreview(url, token, signal?)` returning `LinkPreviewResponse`
  from `@workshop/shared`. Mirrors `src/api/search.ts` — `signal`
  forwarded into `apiRequest` so TanStack Query auto-cancels in-flight
  requests when the query key changes. No new client types declared
  here; everything reuses `@workshop/shared`.
- `apps/workshop/app/list/[id]/add.tsx` — incremental edits to the
  free-form branch only (2b-1's search branch is unchanged):
  - New `useDebouncedQuery(url, 300)` + a `normalizeHttpUrl(input)`
    helper that tries `new URL()` and rejects non-http(s). The
    TanStack Query is `enabled` only when the list is non-search
    (`date_idea` / `trip`) AND `normalizeHttpUrl` returns non-null.
    Result: garbage input never hits the network, and a value-debounce
    is sufficient — no `onBlur`, no manual `AbortController` (TanStack
    handles cancellation via `signal` on key change).
  - `<FreeFormFlow>` accepts four new props (`preview`, `previewLoading`,
    `previewFailed`, `previewActive`) and renders a `<LinkPreviewSection>`
    block right under the URL `TextInput`. `previewActive` gates all
    rendering so the section is invisible while the URL field is empty
    or unparseable.
  - `<LinkPreviewSection>` is inline in `add.tsx` (the only call site).
    Three states: spinner + "Fetching preview…" while loading,
    `<Text testID="link-preview-error">Couldn't fetch preview.</Text>`
    on error, and a card (`testID="link-preview-card"`) with image
    (64×64 with `🔗` placeholder when null), site name (caption), and
    title (or fallback chain `title → siteName → finalUrl`,
    `testID="link-preview-title"`). The 3s "couldn't fetch" fallback
    is implicit — the backend's own 3s `AbortSignal.timeout` aborts
    the upstream fetch and returns an error, which TanStack surfaces
    as `previewQuery.error` (no client-side timer needed).
  - `submitFreeForm` builds metadata via `buildLinkPreviewMetadata(p)`
    only when (a) the query has data, (b) the user's URL field still
    matches the debounced URL the preview was fetched for, and
    (c) `normalizedUrl !== null`. The match check guards against the
    stale-preview race: if the user types a URL, sees a preview, then
    edits the URL and submits before the new debounce fires, we don't
    attach a metadata for the wrong URL.
  - `buildLinkPreviewMetadata` only emits keys that
    `placeMetadataSchema` (`apps/backend/src/routes/v1/items.ts`)
    allows: `source: "link_preview"`, `sourceId: preview.finalUrl`
    (the canonicalized URL after redirects, served by the backend),
    `image`, `siteName`, `title`, `description`. `url` and `fetchedAt`
    from the response are _not_ sent — `url` would collide with the
    schema (no `url` key in `placeMetadataSchema`) and `fetchedAt`
    isn't allowed either. The schema is `.strict()` so any stray field
    would 400; this is the constraint §3.17 flagged.
- `tests/e2e/add-link-preview.spec.ts` — new Playwright happy-path:
  dev-sign-in (`Promise.race(displayName, homeGreeting)` for dirty-DB
  resilience, same as `add-search.spec.ts`) → create date-idea list →
  open add flow → mock `/v1/link-preview` with a fixture → fill title
  - URL → assert `link-preview-card` is visible and contains the
    fixture title → submit → assert the new item appears on the list.
    No backend dependencies beyond the running dev server (the
    link-preview route doesn't need any third-party API key — see
    `apps/backend/src/routes/v1/link-preview.ts`).
- `docs/redesign-plan.md` — this section, the §3.14 status flip, the
  top-of-doc status snapshot, and the rewritten "Next to implement"
  pointer to Phase 3.

Test counts: no new vitest cases (the chunk is client-only and the
backend has 21 `link-preview.test.ts` cases already). One new
Playwright spec; existing 174 backend vitest tests still green.
`pnpm run typecheck && lint && test` all pass; `knip` shows no new
findings.

Surprises / deviations from plan:

- **No manual `AbortController`.** §3.14's row mentioned
  "cancellable via `AbortController`" — TanStack Query's built-in
  `signal` handed to the `queryFn` is the same primitive (it's an
  `AbortSignal` under the hood) and the library cancels it on key
  change. Building a parallel `useEffect` + `new AbortController()`
  would have duplicated the cancellation logic. Same trade §3.17
  recommended for 2b-1's search flow.
- **No explicit 3s "fallback after 3s" timer in the client.** §3.14
  said "couldn't fetch preview" fallback after 3s; in practice the
  backend's `AbortSignal.timeout(3000)` enforces the timeout
  upstream-side, and the resulting error becomes `previewQuery.error`
  immediately. A second client-side timer would race the server's
  error response. Documented above so the next agent knows it was
  intentional.
- **`sourceId` is `finalUrl`, not a sha1 hash.** §3.17 said
  `sourceId: <hash>` — but the route already hashes the URL
  internally (cache key) and the _client-facing_ `LinkPreview` exposes
  `finalUrl` (post-redirect canonical URL). Storing the canonical URL
  in `items.metadata.sourceId` is more useful than a hash that the
  client can't invert; `placeMetadataSchema` accepts `sourceId` as
  `z.string().max(128)`, so URLs up to 128 chars fit. Long URLs would
  reject — if that becomes a problem in production, switch to a hash
  here AND widen the schema in the same PR.

What Phase 3 should do _first_: §3.18 (this section) used the chunk
slot that future phases used for the chunk _table_. Phase 3 needs to
draft a §3.19 chunks table (§3.14 / §3.8 are good templates) before
picking up code. The first chunks come straight out of spec
[§3 (groups + memberships)](redesign-spec.md) and §6 (share-link
invites). The auth + items + lists CRUD that lands them is already
shipped — Phase 3 layers ownership semantics on top.

Known constraints for Phase 3:

- The current `lists.ownerId` column is single-tenant. Group lists
  need either a `lists.groupId` foreign key + a `groups` /
  `group_memberships` pair, or the existing `ownerId` repurposed as
  `creatorId`. Spec §3 calls out the latter.
- Share-link invites need a tokenised URL (`/l/<short>`) the backend
  resolves to a list + membership grant. SES is gone (per the
  Phase 0 cutover), so the share UX is "copy link," not "send
  email." Match the spec.
- The auto-upvote on item create (§3.10's behavior) is single-tenant —
  in a group list, it should still be the _creator's_ vote, not auto-
  granted to other members. The existing test in `items.test.ts`
  asserts this for the single-tenant case; widen the assertion when
  groups land.

#### 3.19 Phase 3 chunks

Each chunk is independently shippable. The split mirrors Phases 1 and 2
(3a is backend, 3b is client). 3a-1 lands the membership primitives
(share-link invites + remove/leave) so 3a-2 can wire `recordEvent` into
every mutating handler against a real membership surface.

| Chunk    | What ships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | External deps                                          | Status         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------- |
| **3a-1** | Backend share-link invites + member removal: `apps/backend/src/routes/v1/invites.ts` (`POST /v1/lists/:id/invites` owner-only, `POST /v1/invites/:token/accept` auth-only and idempotent, `DELETE /v1/lists/:id/invites/:inviteId` owner-only revoke) and `apps/backend/src/routes/v1/members.ts` (`DELETE /v1/lists/:id/members/:userId` — owner removes anyone but themselves; non-owners can self-leave). Tokens: 32-byte URL-safe base64 with a 7-day `expires_at` per spec §6 risks. `GET /v1/lists/:id` swaps the hardcoded `pendingInvites: []` for the real list. Shared types: `Invite`, `ListMember` full shape, request/response envelopes. Vitest: validator + auth gating + UUID-bail like `lists.test`.                                                                                                                                                     | None — uses existing schema (`list_invites` from 0a).  | Done (this PR) |
| **3a-2** | Backend activity + events: `apps/backend/src/lib/events.ts` (`recordEvent({ listId, actorId, type, itemId?, payload?, db? })` — synchronous insert, no queue; `db?` accepts an open tx), `apps/backend/src/routes/v1/activity.ts` (`GET /v1/activity?cursor&limit=50`, `POST /v1/activity/read`). Retrofit every existing mutating handler in `lists.ts` / `items.ts` plus the new `invites.ts` / `members.ts` from 3a-1 to call `recordEvent` (see `activityEventTypeEnum` in `db/schema.ts` for the type set). `userActivityReads` table already exists from 0a; `POST /activity/read` upserts a row per `(user_id, list_id)`. Vitest: event-recording shape, cursor encoding round-trip + DoS guard, mark-read schema, route auth gating + input validation. (DB-path coverage deferred to Playwright in 3b-2 once a client surface exists, matching 3a-1 convention.) | None.                                                  | Done (this PR) |
| **3b-1** | Client list settings + share-link UX: `apps/workshop/app/list/[id]/settings.tsx` modal sheet — Details (rename / emoji / color / description, owner-only), Members (with Leave for non-owners and Remove for owner), Share link (generate + copy + revoke), Danger zone (Delete list, owner-only). New `apps/workshop/app/onboarding/accept-invite.tsx` deep-link handler routed via `expo-linking` (`workshop.dev/invite/:token` on web, `workshop://invite/:token` on iOS). Auto-join after OAuth sign-in; routes to the joined list. New typed wrappers in `src/api/invites.ts` + `src/api/members.ts`. Playwright happy-path: owner generates link → second context accepts via dev sign-in → both see the list.                                                                                                                                                      | 3a-1.                                                  | Done (this PR) |
| **3b-2** | Client activity feed + bell badge: `apps/workshop/app/activity.tsx` cross-list feed (50/page, infinite scroll). Bell `IconButton` in the home header showing unread count from `GET /v1/activity` (clientside `unreadCount` derived from `lastReadAt` per list). Tapping the bell navigates to `activity.tsx` and fires `POST /v1/activity/read`. Add a "Share link" step to the create-list flow (`apps/workshop/app/create-list/share.tsx`) — copy-link only, no email. Playwright happy-path: actor adds an item → other browser sees the event in the feed → unread count clears after tap.                                                                                                                                                                                                                                                                           | 3a-2 (events) + 3b-1 (share UX surface) for the badge. | Done (this PR) |

#### 3.20 What 3a-1 actually shipped — start here for 3a-2

Files that landed in 3a-1 (read these before touching 3a-2):

- `apps/backend/src/routes/v1/invites.ts` — three handlers on a single
  router mounted under `/v1`:
  - `POST /v1/lists/:id/invites` (owner-only via `requireListMember +
requireListOwner`) — generates a 32-byte URL-safe base64 token
    (`crypto.randomBytes(32) → b64url`, 43 chars), stamps
    `expires_at = now() + 7d`, returns the row **with `token` included**
    so the owner can build the share URL. `email` on the request is
    accepted (forward-compat per the schema) but ignored at the handler
    in v1 — share-link only per spec §6.
  - `DELETE /v1/lists/:id/invites/:inviteId` (owner-only) — soft-revoke
    via `revoked_at = now()` rather than hard delete, so the audit
    trail survives. Idempotent: re-revoking already-revoked rows is
    guarded by an `IS NULL` clause and 404s.
  - `POST /v1/invites/:token/accept` (any auth user) — single tx:
    look up the invite by token, reject if revoked / expired / not
    found, look up the list, idempotent membership upsert (existing
    member keeps `role + joinedAt`), stamp `accepted_at` only on the
    first acceptance. **Multiple distinct users accepting the same
    token is intentional** (it's a share link) — we record the first
    acceptance for the audit trail and leave the row otherwise
    unchanged on subsequent accepts. Returns `{ list, member }` where
    `member` is a `ListMemberSummary` (with the joined user's display
    name pulled from `users` after the tx).
  - Exports `fetchPendingInvitesForList(listId)` — used by
    `lists.ts/GET /v1/lists/:id` to populate `pendingInvites` (token
    omitted from those shapes; only the `POST /invites` response
    includes it). Filters: `accepted_at IS NULL AND revoked_at IS NULL
AND (expires_at IS NULL OR expires_at > now())`.
- `apps/backend/src/routes/v1/members.ts` — single handler:
  `DELETE /v1/lists/:id/members/:userId`. Two flows fold into one:
  - **Owner removes anyone but themselves**: `requireListMember`
    middleware passes, then the handler checks `requesterRole ===
"owner"` and `targetRole !== "owner"`.
  - **Self-leave (non-owner)**: any member with `userId === me` can
    leave. Owners can't self-leave (must delete the list instead) —
    spec §2.5.

  Per spec §2.5, removing a member drops their `item_upvotes` rows
  scoped to items in this list (so the upvote counts re-aggregate
  correctly), but items they added remain with `added_by` attribution
  preserved. Both happen inside one transaction. The
  `users.id ON DELETE CASCADE` FK on `item_upvotes` doesn't help
  here because we're not deleting the user — only their `list_members`
  row — so the explicit scoped DELETE is the right move.

- `apps/backend/src/routes/v1/lists.ts` — `GET /:id` now calls
  `fetchPendingInvitesForList(listId)` when the requester is the
  owner; non-owners get the empty array (matches spec §4.9, "Pending
  invites — shown if the list has unaccepted email invites" — the
  share UX surface is owner-only). The hardcoded `pendingInvites: []`
  is gone.
- `apps/backend/src/app.ts` — mounts `memberRoutes` under `/v1/lists`
  alongside `listRoutes`, and mounts `inviteRoutes` under `/v1`
  (because the invite handlers split across `/v1/lists/:id/invites/...`
  and `/v1/invites/:token/accept` URL roots, which a single sub-router
  needs to span).
- `packages/shared/src/types.ts` — adds `Invite`,
  `CreateInviteRequest`, `InviteResponse`, `AcceptInviteResponse`,
  `MemberRemoveResponse`. Also rewrites the doc comment on
  `PendingInvite` (was "reserved for Phase 3") since 3a-1 is the phase.
  The existing `ListDetailResponse` already typed `pendingInvites:
PendingInvite[]` so no churn there. **`Invite.token` is optional and
  only populated on the `POST /lists/:id/invites` response** — every
  other read path omits it so a non-owner glance at `pendingInvites`
  doesn't leak a usable share token.
- `apps/backend/src/routes/v1/{invites,members}.test.ts` — 17 new
  vitest cases (13 + 4) covering the same surface as `lists.test.ts`:
  schema validation (forward-compat email handling), bearer-token
  gating (401 on missing/invalid), and UUID-bail (404 before DB on
  malformed list/user/invite ids). The handler-level DB path
  (token generation, accept idempotence, owner-only revoke,
  self-leave cascade-upvotes) is left for Playwright in 3b-1 once a
  client surface exists to drive it — same convention 1a-1 / 1a-2
  used.

Test counts: 17 new vitest cases (13 in `invites.test.ts`, 4 in
`members.test.ts`); previous 174 still green for a total of 191 backend
vitest tests. `pnpm run typecheck && lint && test` all pass; `knip`
output is unchanged from the pre-existing baseline.

Surprises / deviations from plan:

- **`Invite.token` is response-only.** The spec §6 storage shape lists
  `token` on the row, but exposing it on every list-detail fetch
  would let a non-owner snapshot the share URL out of `pendingInvites`.
  We solve this in the type layer (`token?` on the shared `Invite`
  shape) plus the route layer (`toInviteShape({ includeToken: bool })`
  emits or omits the field). Owners only see the token once — on
  the `POST /lists/:id/invites` response — and have to copy it then
  or revoke and regenerate. 3b-1 should mirror this: the share-link
  modal stores the token in component state on creation and never
  refetches it.
- **Email field on `CreateInviteRequest` is accepted but ignored.**
  Spec §6 explicitly defers email invites to v1.1 (SES is gone).
  Rather than 400ing on `email`, the route accepts the field for
  forward-compat and persists `email: null` regardless. Lets a future
  email-invite chunk land without touching the request type.
- **`accept` is idempotent and multi-user.** A share-link is by
  definition shareable — n users accepting one token is the happy
  path, not a bug. Spec §6 talks about "single-use or time-bounded";
  v1 went with **time-bounded** (7-day expiry) only. Single-use
  shareable tokens are an oxymoron; if we want single-use, that's the
  email-invite flow that doesn't ship in v1.
- **Owner-removes-anyone-but-themselves uses one handler, not two.**
  Spec §8 lists `DELETE /v1/lists/:id/members/:userId` once. Folding
  self-leave + owner-remove into one route + role check is cleaner
  than two routes; the test coverage flags both. The "owner can't
  self-leave" rule produces a 403 with a stable message
  (`"owner cannot leave; delete the list instead"`) that 3b-1 can
  surface to UI.
- **`fetchPendingInvitesForList` lives in `invites.ts`, not in
  `lists.ts`.** Avoids a circular-feeling import where a "list
  detail" function reaches into invite-row shaping logic that the
  invites route also owns. `lists.ts` imports the helper from
  `invites.ts` — same import direction as `lists.ts` ↔ `items.ts`.

What 3a-2 should do _first_: read `apps/backend/src/db/schema.ts` for
`activityEventTypeEnum` (already declared in 0a; the enum values are
the canonical list — `list_created`, `member_joined`, `member_left`,
`member_removed`, `item_added`, `item_updated`, `item_deleted`,
`item_upvoted`, `item_unupvoted`, `item_completed`, `item_uncompleted`,
`invite_created`, `invite_revoked`). Build `apps/backend/src/lib/events.ts`
with `recordEvent({ db?, listId, actorId, type, itemId?, payload? })`
that's `db?`-injectable for tests (mirror `metadata-cache.ts`).
Retrofit every mutating handler to call it: `lists.ts` POST/PATCH/DELETE,
`items.ts` POST/PATCH/DELETE/upvote/complete/uncomplete, `invites.ts`
POST/DELETE + `accept`'s membership insert, `members.ts` DELETE.
Synchronous insert is correct for v1 — defer the SQS queue
optimization to a v1.1 follow-up only if `recordEvent` becomes the
dominant latency contributor (per phase Risks).

Known constraints for 3a-2:

- **`activity_events.actor_id` is `ON DELETE RESTRICT`** in the
  schema. If a future "delete account" flow runs, restricted deletes
  will fail. That's spec-aligned ("activity rows survive deletes")
  but worth flagging — the cascade story for full user deletion is
  not yet sketched.
- **`POST /v1/activity/read`** should upsert `user_activity_reads`
  per `(user_id, list_id)`. The `list_members` membership of the
  actor scopes the result — only events on lists the user is a
  member of are visible per spec §4.7. Handler should reject (or
  silently skip) `listIds` the requester isn't a member of.
- **`GET /v1/activity` cursor**: spec §8 shows
  `?cursor=<ts>&limit=50`. Cursor-based pagination on
  `(created_at DESC)` with the cursor encoding both `created_at` and
  `id` avoids duplicate / skipped events at the boundary; just
  `created_at` is fine but watch for sub-millisecond ties when
  3a-2's retrofit fires multiple events in one transaction.
- **The auto-upvote on item create still inserts the creator's vote
  only.** `item_added` should record event-type but not also fire
  `item_upvoted` — the auto-upvote is an implementation detail of
  item creation, not a separate user action. `items.test.ts` already
  asserts the single-tenant case (creator is the only upvoter on a
  fresh insert); 3a-2's tests should preserve that.

#### 3.21 What 3a-2 actually shipped — start here for 3b-1 / 3b-2

Files that landed in 3a-2 (read these before touching 3b-1 / 3b-2):

- `apps/backend/src/lib/events.ts` — new `recordEvent({ listId,
actorId, type, itemId?, payload?, db? })` helper. `db?` defaults to
  the cached Drizzle client but accepts an open transaction (`tx`) so
  callers inside a `db.transaction(async (tx) => ...)` block can pass
  `tx` and the event row joins the same transaction (rolls back
  together on failure). Mirrors the `metadata-cache.ts` pattern.
  Synchronous insert per spec §4.7 — v1 traffic doesn't justify SQS;
  swap to a queue producer later if `recordEvent` becomes the dominant
  latency contributor.
- `apps/backend/src/routes/v1/activity.ts` — Hono router under
  `/v1/activity`:
  - `GET /` — cursor-paginated cross-list feed scoped to the
    requester's `list_members` rows. Cursor is base64url(`<ISO
ts>|<uuid>`); we encode **both** `(created_at, id)` so events from
    the same transaction don't collapse into a single boundary row.
    Postgres row-value comparison (`(e.created_at, e.id) < ($1, $2)`)
    handles the tuple natively. Fetches `limit + 1` to detect
    `nextCursor` without a separate COUNT.
  - `POST /read` — body `{ listIds? }`. Omit `listIds` to mark every
    membership read at once; provide `listIds` to scope the upsert.
    The `INSERT ... SELECT FROM list_members WHERE lm.user_id = $me`
    pattern guarantees we never write a row the requester isn't a
    member of — silent skip rather than 403, so non-membership
    isn't leaked.
  - Cursor decoder is defensive: 256-char DoS cap, base64-decode in a
    try, requires `|` separator, parseable timestamp, and UUID-shaped
    id segment. Garbage inputs return `null` (treated as "no cursor")
    rather than 400ing — a stale client refresh shouldn't error.
  - Test-only `__test = { encodeCursor, decodeCursor }` export so the
    cursor logic can be exercised without HTTP.
- `apps/backend/src/app.ts` — mounts `activityRoutes` at
  `/v1/activity` alongside the rest of the v1 router family.
- `apps/backend/src/routes/v1/lists.ts` — `POST /` (createList) emits
  `list_created` with `payload: { name, type }` inside the existing tx.
  PATCH/DELETE on lists.ts is **not** retrofitted yet — see "Surprises"
  below for the `list_renamed` / `list_deleted` enum gap.
- `apps/backend/src/routes/v1/items.ts` — `POST /` emits `item_added`
  inside tx (auto-upvote is intentionally not a separate event); PATCH
  emits `item_updated`; DELETE returns `id, title` and emits
  `item_deleted` with **`itemId: null`** because
  `activity_events.item_id` has `ON DELETE CASCADE` — populating it
  would cascade-delete the very event row we just wrote (title kept in
  `payload` for feed rendering). Upvote uses `RETURNING item_id` to
  detect a fresh insert and emit `item_upvoted` only then; unupvote
  uses Drizzle `.returning()` similarly. Complete / uncomplete emit
  unconditionally. Idempotency on upvote/unupvote means repeat-clicks
  don't spam the feed.
- `apps/backend/src/routes/v1/invites.ts` — POST emits `invite_created`
  with `payload: { inviteId, expiresAt }`; DELETE emits
  `invite_revoked` with `payload: { inviteId }`. The `accept` handler
  emits `member_joined` only when `newlyJoined` (fresh `list_members`
  insert) inside its existing tx, so re-accepting a token by the same
  user isn't recorded again.
- `apps/backend/src/routes/v1/members.ts` — folds self-leave and
  owner-removal into one event-type branch:
  `isSelfLeave ? "member_left" : "member_removed"`, with `payload: {
targetUserId }` so the feed can render "X removed Y" or "Y left".
- `packages/shared/src/types.ts` — adds `ActivityEvent` (with
  `actorDisplayName` populated server-side via the `users` LEFT JOIN),
  `ActivityFeedResponse` (`{ events, nextCursor }`),
  `MarkActivityReadRequest`, `MarkActivityReadResponse`. Note:
  `ActivityEventType` was already exported from 0a — we reuse it.
- `apps/backend/src/lib/events.test.ts` + `apps/backend/src/routes/v1/activity.test.ts`
  — 25 new vitest cases.

Test counts: 25 new vitest cases (4 in `events.test.ts`, 21 in
`activity.test.ts`); 191 previous tests still green for a total of 216
backend vitest tests across 19 files. `pnpm run typecheck && lint &&
test` all pass; `knip` baseline unchanged.

Surprises / deviations from plan:

- **`itemId` is null on `item_deleted` events.** Plan implied
  populating `itemId` for every item-scoped event. But
  `activity_events.item_id` has `ON DELETE CASCADE` from the 0a
  migration, so writing the just-deleted item's id would cascade-delete
  the event we just wrote (or, worse, race against the cascade and
  leave a stale FK). We store `itemId: null` and put `title` in
  `payload` instead so the feed can render "X deleted 'Foo'" without
  re-querying. 3b-2 should treat `item_deleted` events as
  payload-only.
- **`list_renamed` and `list_deleted` enum values don't exist.** Spec
  §4.7 mentions both, but the 0a migration only enumerated 13 types
  (no rename/delete for lists). The plan ("retrofit `lists.ts`
  POST/PATCH/DELETE") was overstated — only POST has a matching enum.
  Adding the missing values needs a new Drizzle migration with
  `ALTER TYPE ... ADD VALUE`; deferred to a follow-up to keep this
  chunk migration-free. Tracked in PR description.
- **Idempotent upvote/unupvote gate event emission on `RETURNING` row
  count.** Otherwise repeat-click on the same upvote button would emit
  duplicate `item_upvoted` events into the feed. The handler already
  used `ON CONFLICT DO NOTHING`; we now read the returned row count
  to decide whether to record. Same approach for unupvote (Drizzle
  `.returning({ id })` length).
- **Event recording rides existing transactions; no new ones
  introduced.** All retrofits pass `db: tx` from the parent op so
  events roll back if the parent fails. The two handlers that
  weren't already transactional (POST upvote, POST/DELETE
  complete/uncomplete) wrap their event call inside the same single
  query path — we don't open a new tx just to record the event when
  the parent op is itself a single statement.
- **`accept` only emits `member_joined` on fresh joins.** Re-accepting
  a still-valid token by the same user is intentionally idempotent
  (the `INSERT ... ON CONFLICT DO NOTHING` returns no row), so we
  don't record a second `member_joined` for the same membership. The
  invite row's `accepted_at` only stamps on first acceptance anyway,
  so the feed and the audit trail agree.
- **Cursor encodes `(createdAt, id)` not just `createdAt`.** Spec §8
  shows `?cursor=<ts>` but a tuple cursor is necessary because the
  retrofit can fire multiple events in a single tx (e.g. accept →
  `member_joined` is one event, but a future "auto-add invite acceptor
  to N lists" feature might fire several at once). Postgres handles
  the row-value comparison natively. Cursor is opaque to the client
  either way, so no API surface change.
- **`POST /read` accepts an empty `listIds: []` as a no-op.** Rather
  than 400ing, we generate `AND FALSE` in the WHERE clause so the
  upsert affects zero rows. This lets the client safely send an
  empty array on screens where the unread count is computed from a
  filtered list that happened to be empty.
- **`z.string().uuid()` quirk under zod 4.** v4's UUID regex requires
  a real version digit (1–8); the all-zero UUID sentinel that other
  tests use as a placeholder fails parse. `activity.test.ts` uses
  `00000000-0000-4000-8000-000000000001` (a valid v4 shape) instead.
  Worth knowing if any future test uses `z.string().uuid()` on a
  hardcoded UUID literal.

What 3b-1 should do _first_: it doesn't directly depend on 3a-2 — its
deliverable is the list-settings sheet + share-link UX + accept
deep-link, all of which use 3a-1 routes (invites + members). Read
`apps/workshop/src/api/lists.ts` for the typed-wrapper convention,
mirror it for `src/api/invites.ts` + `src/api/members.ts`, then build
the settings sheet under `apps/workshop/app/list/[id]/settings.tsx`.
The existing `useAuth` flow plus `expo-linking` config covers the
deep-link plumbing.

What 3b-2 should do _first_: read `apps/backend/src/routes/v1/activity.ts`
for the cursor + read-marker shapes, then mirror the 1b-2 TanStack
Query infinite-scroll pattern (see `app/list/[id]/index.tsx` for the
optimistic-update precedent). Add `src/api/activity.ts` typed
wrapper, then `apps/workshop/app/activity.tsx`. The bell badge in the
home header derives `unreadCount` clientside from `lastReadAt` per
list; tap → navigate → `POST /v1/activity/read` (no body to mark all,
or `{ listIds: [...] }` to scope).

Known constraints for 3b-1 / 3b-2:

- **`Invite.token` is response-only on `POST /lists/:id/invites`.**
  The 3a-1 doc above explains this; `pendingInvites` in
  `ListDetailResponse` omits the token. The settings sheet must store
  the token in component state on creation (or revoke + regenerate to
  recover it).
- **`item_deleted` events have `itemId: null`** — the feed renderer
  in 3b-2 must read `title` from `payload`, not try to re-fetch by
  `itemId`. Same goes for `member_removed` / `member_left` reading
  `targetUserId` from `payload`.
- **`list_renamed` / `list_deleted` events don't fire yet.** A future
  migration adds the enum values; until then the activity feed won't
  show list renames or deletions. 3b-2 should not assume they exist
  in the type set (the union type covers them only because spec §4.7
  listed them — the runtime emits the 13 currently-enumerated values).
- **`GET /v1/activity` is membership-scoped via JOIN, not WHERE.**
  Don't add a client-side filter for "lists I'm in" — the server
  already does it.
- **`POST /v1/activity/read` is idempotent and silently skips
  non-member listIds.** Surface only one Toast per user gesture, not
  per skipped list.

#### 3.22 What 3b-1 actually shipped — start here for 3b-2

Files that landed in 3b-1 (read these before touching 3b-2):

- `apps/workshop/src/api/invites.ts` — typed wrappers for the three
  invite routes from 3a-1: `createInvite`, `revokeInvite`,
  `acceptInvite`. Mirrors `src/api/lists.ts` shape (single-arg path
  builder + `apiRequest`); no manual JSON or status-code handling.
- `apps/workshop/src/api/members.ts` — `removeMember(listId, userId,
token)` wrapper for the 3a-1 `DELETE /v1/lists/:id/members/:userId`
  route (covers both owner-removal and self-leave).
- `apps/workshop/src/lib/queryKeys.ts` — added `invites.forList(id)` +
  `members.forList(id)` keys so 3b-2's feed-side invalidation can target
  these caches without redefining keys ad-hoc.
- `apps/workshop/src/lib/share.ts` — `buildInviteShareUrl(token)` (uses
  `window.location.origin` on web, `EXPO_PUBLIC_WEB_URL` env or the
  `https://workshop-a2v.pages.dev` Pages URL on native fallback) +
  `copyToClipboard(text)` (web: `navigator.clipboard.writeText`;
  native returns `false` — clipboard polish deferred to Phase 4 with
  `expo-clipboard`).
- `apps/workshop/src/lib/inviteStash.ts` — single exported constant
  `PENDING_INVITE_TOKEN_KEY = "workshop.pending-invite-token"`. Used in
  three places (accept-invite stash, AuthGate stash check, accept-invite
  cleanup) so the literal lives once.
- `apps/workshop/app/list/[id]/settings.tsx` — modal-presented settings
  sheet. Sections render conditionally on owner-vs-member:
  - **Details** (owner-only): name `TextInput`, emoji grid (12 picks),
    color grid (7 keys), description multi-line `TextInput`. `name`/
    `emoji`/`color`/`description` hydrate lazily from list-detail; a
    `detailsDirty` memo gates the Save button. Mutation hits
    `updateList` and invalidates both detail and list-keys caches.
  - **Members**: read-only list of `displayName + role` rows; owner
    sees `Remove` button on every non-owner non-self row (cf.
    `MemberRow.canActOn`). Removing fires `removeMember` mutation.
  - **Share link** (owner-only): `Generate share link` calls
    `createInvite`, stashes the response in component-scoped
    `freshInvite` state (the server only returns `token` on POST;
    `pendingInvites` from list-detail omits it for security),
    auto-copies the URL via `copyToClipboard`, and renders a
    selectable URL field + `Copy link` button. Below the generate
    button, an "Active links" list iterates `pendingInvites` from
    list-detail with per-row `Revoke` buttons. Revoking a row whose
    id matches `freshInvite.id` clears the cached fresh invite too.
  - **Danger zone**: owner sees `Delete list` (calls `deleteList` →
    invalidate lists → `router.replace("/")`). Non-owner sees
    `Leave list` which calls `removeMember(listId, self.id)` and
    navigates home on success.
- `apps/workshop/app/onboarding/accept-invite.tsx` — deep-link landing
  screen. Three effects: (1) on mount, stash the token in storage so a
  sign-in round-trip can recover it; (2) if `status === "signed-out"`,
  `router.replace("/sign-in")` (AuthGate exempts this screen from the
  auto-redirect so the stash effect runs first); (3) when signed-in,
  POST `/v1/invites/:token/accept`, drop the stash, invalidate lists
  query, and `router.replace(\`/list/${res.list.id}\`)`. An
`acceptedRef`ref makes the accept call fire exactly once even if
the effect re-runs. Renders an empty-token error card, a hard-failure
error card with`accept-error` testID, or a centered loading state
(`accept-invite-loading`).
- `apps/workshop/app/invite/[token].tsx` — three-line shim that reads
  `:token` from `useLocalSearchParams` and `<Redirect>`s to
  `/onboarding/accept-invite?token=...`. Both the web URL pattern
  `/invite/:token` and the iOS scheme deep link `workshop://invite/:token`
  resolve to this file via expo-router's automatic route → scheme
  mapping (no extra `expo-linking` config needed — the existing
  `app.json` `scheme: "workshop"` is sufficient).
- `apps/workshop/app/_layout.tsx` — three changes:
  - **Stack registrations**: `list/[id]/settings`
    (`presentation: "modal"`), `onboarding/accept-invite`,
    `invite/[token]`.
  - **AuthGate redirect exceptions**: signed-out users on
    `/invite/:token` or `/onboarding/accept-invite` are no longer
    forwarded to `/sign-in` until those screens have stashed the
    token. Signed-in users on `/onboarding/accept-invite` are no
    longer bounced to `/`.
  - **Stash-aware post-sign-in redirect**: a second effect with an
    `inviteCheckedRef` ref consults `PENDING_INVITE_TOKEN_KEY` exactly
    once per sign-in transition. If a stashed token exists and the
    user isn't already on the accept-invite screen, redirect to
    `/onboarding/accept-invite?token=...`. The accept-invite screen
    owns the eventual `removeItem` call (only it knows whether the
    accept succeeded or hard-failed).
- `apps/workshop/app/list/[id]/index.tsx` — replaces the static
  `headerSpacer` placeholder with an `IconButton` (`testID="list-settings"`,
  `⋯` glyph) that routes to `/list/${id}/settings`. The unused
  `headerSpacer` style was removed.
- `tests/e2e/helpers.ts` — new `signInAsDevUser(page, request, { email,
displayName })` helper. Calls `POST /v1/auth/dev` directly via the
  Playwright `request` fixture, then `addInitScript` seeds the
  resulting `token` into `localStorage["workshop.session.v1"]` BEFORE
  `page.goto`. Disables auto-dev-sign-in too. The dev-sign-in button
  hardcodes a single email — this is what lets one test sign in two
  contexts as different users (owner + invitee).
- `tests/e2e/share-link-accept.spec.ts` — happy-path spec. Owner
  context creates a trip list, opens settings, clicks
  `settings-generate-link`, reads the generated URL out of the
  `settings-fresh-invite-url` field. Guest context (different dev user)
  navigates to the invite path; the accept-invite screen joins the
  list and `router.replace`s to `/list/<id>`. Both then open settings
  and confirm both display names appear in the Members list.

Test counts: 1 new Playwright happy-path; existing 5 specs unchanged.
Backend vitest count is the same 216 across 19 files (no backend
changes in 3b-1). Client has no vitest by convention; the Playwright
spec is the regression net.

`pnpm run typecheck && pnpm run lint && pnpm run test` all pass.
`pnpm run e2e` was run after resetting the `dev@workshop.local` user's
displayName to `NULL` in the local Postgres so `sign-in.spec.ts` and
`list-flow.spec.ts` could see the display-name onboarding screen — see
"Surprises" below for details. Knip output is unchanged from the
pre-existing baseline.

Surprises / deviations from plan:

- **Token survives sign-in via storage stash, not URL roundtrip.** The
  plan said "Auto-join after OAuth sign-in" without specifying how the
  invite token reaches the post-sign-in flow. Two options were on
  the table — bake the token into the OAuth `state` parameter, or
  stash it in storage and read it back after sign-in. We chose stash
  because OAuth `state` round-trips through Apple/Google's redirect
  endpoints and any consumer of `state` couples the deep-link handler
  to the OAuth providers (which is the wrong layer). The
  `inviteStash.ts` constant + `setItem` on accept-invite mount + the
  `inviteCheckedRef`-gated effect in `_layout.tsx` is more local and
  works for any sign-in method (including the dev backdoor and any
  future provider). **3b-2 doesn't need to know about this** — the
  feed UI and share-step in create-list don't touch the invite stash.
- **`PendingInvite.token` stays response-only on the client too.** The
  settings sheet stores the most-recent generated invite (with token)
  in component-scoped `useState`. On first paint after a refresh, the
  fresh-invite UI is gone and the URL must be re-generated by clicking
  `Generate another link` — which mints a new token and lets the prior
  link continue to work in parallel until it expires. There's no UX
  for "show me the URL of an existing pending invite" because the
  server intentionally won't return the token. 3b-2's create-list
  share step should follow the same model: surface the URL only
  inside the create flow, never on a re-entry of an existing list.
- **No native clipboard yet.** `expo-clipboard` is not installed.
  `copyToClipboard` returns `false` on native; the Toast in that case
  reads "Share link generated" instead of "copied". This is fine for
  the web E2E and the Cloudflare Pages preview, but means the iOS app
  will currently copy the URL to nowhere on the share button. Phase 4
  (or sooner if iOS testing exposes the gap) should add
  `expo-clipboard` and a `setStringAsync(url)` call in the native
  branch of `share.ts`.
- **No Polite copy on revoke.** Plan said "Revoke" — handler hits
  `DELETE /v1/lists/:id/invites/:inviteId` and shows a Toast. We don't
  show a confirmation dialog for revoke; the action is two clicks
  away (open settings → revoke) and reversible by generating another
  link, so a confirm-step felt redundant. Delete-list does NOT show a
  confirm dialog either — same scope-control reasoning, plus the spec
  doesn't mandate one. If a future polish chunk wants confirm dialogs,
  fold both there.
- **Web bundle URL derivation matters for the share URL.** The
  Niteshift sandbox preview proxy means `window.location.host` resolves
  to a `ns-8081-<id>.preview.niteshift.dev` host that browsers can
  hit from anywhere. `buildInviteShareUrl(token)` reads
  `window.location.origin` on web, so a sandbox-generated link works
  off the same preview host. On native, the fallback is the canonical
  `workshop-a2v.pages.dev` Pages URL — which won't deep-link to the
  iOS app (that's the share-extension/universal-link work in Phase 4).
- **Dirty dev-DB state breaks `sign-in.spec.ts` after `list-flow.spec.ts`.**
  Both specs share the `dev@workshop.local` user. `list-flow.spec.ts`
  sets that user's displayName to `"E2E Tester"`; `sign-in.spec.ts`
  expects displayName `null` (so the onboarding screen renders). The
  full-suite run failed exactly once on this — pre-existing, not
  introduced by 3b-1 — and was confirmed by resetting `display_name
= NULL` in Postgres before re-running, after which both specs pass.
  3b-2 will hit the same trap if it exercises a fresh dev user; either
  use a unique email per spec (the pattern in `signInAsDevUser`) or
  add a beforeAll that nulls `display_name` for `dev@workshop.local`.

What 3b-2 should do _first_: read `apps/backend/src/routes/v1/activity.ts`
for the cursor + read-marker shapes (already documented in §3.21),
then mirror the TanStack Query infinite-scroll pattern from
`app/list/[id]/index.tsx`. Add `src/api/activity.ts`, then
`apps/workshop/app/activity.tsx`. The bell badge in the home header
derives `unreadCount` clientside from `lastReadAt` per list; tap →
navigate → `POST /v1/activity/read`. The "Share link" step in the
create-list flow lives at `apps/workshop/app/create-list/share.tsx`
and should reuse `src/api/invites.ts` + `src/lib/share.ts` from this
PR — no new wrappers needed. The existing settings-sheet share UX is
the canonical share surface; the create-list share step is just an
inline up-sell at the end of the create flow.

Known constraints for 3b-2:

- **Settings sheet's `Active links` list will need to refresh after
  3b-2's "Share link" create-flow step.** The sheet invalidates
  `queryKeys.lists.detail(id)` after generate/revoke; if the
  create-list share step also creates an invite, it needs to invalidate
  the same key (or the new `queryKeys.invites.forList(id)` key, which
  is currently unused — 3b-2 can wire it up).
- **`signInAsDevUser` is the canonical helper for multi-user E2E.** Two
  contexts in one spec, each with a different identity, is what the
  Playwright `request` fixture + `addInitScript` pattern unlocks.
  3b-2's "actor adds item → other browser sees event" test should
  follow the same shape.
- **Settings sheet doesn't show pending invites' tokens — they're
  server-omitted.** If 3b-2's share-step in create-list wants to
  surface the just-generated link, it has to capture the `POST`
  response and pass the URL forward (e.g. via router params or a
  zustand-style ephemeral store), NOT round-trip through
  `pendingInvites`.
- **Dev-DB drift between specs.** Already covered above; mention here
  so the next agent doesn't re-discover it.

#### 3.23 What 3b-2 actually shipped — Phase 3 complete

Files that landed in 3b-2 (read these before touching Phase 4):

- `apps/workshop/src/api/activity.ts` — typed wrappers for the two
  3a-2 routes: `fetchActivity({ cursor?, limit? }, token)` and
  `markActivityRead(body | undefined, token)`. The body arg is
  optional because `POST /v1/activity/read` with no body marks every
  membership read at once (the activity-screen-on-focus call uses
  this; the bell-tap-then-back-home flow does too).
- `apps/workshop/src/lib/lastViewed.ts` — three thin wrappers around
  `getItem`/`setItem`/`removeItem` over the
  `workshop.activity.last-viewed-at` key. The home screen reads this
  on focus to derive the bell badge count; the activity screen
  writes it on focus to clear the badge on a back-nav.
- `apps/workshop/src/lib/queryKeys.ts` — adds `activity.feedInfinite`
  alongside the existing `activity.feed`. The home screen uses
  `feed` (single-page `useQuery`); the activity screen uses
  `feedInfinite` (paginated `useInfiniteQuery`). **Splitting the
  keys is required**: TanStack Query stores `useQuery` and
  `useInfiniteQuery` data shapes under the same cache slot keyed by
  the query key, and reading the wrong shape from a populated cache
  yields runtime errors / empty pages. Hit this in the first e2e
  run — `activity-feed` testID never showed up because the cache
  had `useQuery` shape from the home bell.
- `apps/workshop/app/activity.tsx` — `useInfiniteQuery` over
  `fetchActivity` with `PAGE_SIZE = 50`, `getNextPageParam = (last)
=> last.nextCursor ?? undefined`, `onEndReachedThreshold = 0.5`.
  `useFocusEffect` writes `lastViewedAt = new Date().toISOString()`
  AND fires `markActivityRead(undefined, token).catch(() => {})`
  (best-effort; failures don't disrupt the screen). `describeEvent`
  is a single switch over all 13 `ActivityEventType` values with a
  `_exhaustive: never` check at the bottom; reads `payload.title`
  for `item_*` events because `item_deleted.itemId` is null per
  3a-2 (the title in the payload is the surviving identifier).
  Renders `formatRelative(createdAt)` (s/m/h/d ago, then locale
  date after 14 days). testIDs: `activity-feed` (FlatList),
  `activity-back` (header back button), `activity-row-${event.id}`.
- `apps/workshop/app/index.tsx` — adds the bell `IconButton` and an
  18×18 round badge to the home header. Reuses the existing
  `useQuery(queryKeys.activity.feed, fetchActivity({ limit: 50 }))`
  query; counts events where `actorId !== user?.id` AND
  `createdAt > lastViewedAt`. Cap at "9+" for >9. `useFocusEffect`
  rehydrates `lastViewedAt` from storage so a back-nav from the
  activity screen clears the badge immediately. testIDs:
  `open-activity` (the bell IconButton),
  `activity-unread-badge` (the badge overlay; only rendered when
  `unreadCount > 0`).
- `apps/workshop/app/create-list/share.tsx` — final step of the
  create-list flow. Calls `createInvite(listId, {}, token)` from
  3b-1, captures the response in component-scoped `useState`
  (server only emits `token` on POST; this matches the 3b-1
  settings-sheet convention). After generate, invalidates BOTH
  `queryKeys.lists.detail(listId)` AND
  `queryKeys.invites.forList(listId)` — the invites cache key was
  declared but unused in 3b-1; this is its first consumer per the
  §3.22 hint. testIDs: `create-list-share-generate`,
  `create-list-share-url`, `create-list-share-copy`,
  `create-list-share-done`, `create-list-share-skip-icon`. The
  `Done` / `Skip for now` button calls `router.dismissAll()` then
  `router.replace(\`/list/${listId}\`)` so the create-list stack
  doesn't sit underneath the list-detail screen.
- `apps/workshop/app/create-list/customize.tsx` — `onSuccess` now
  routes to `/create-list/share?listId=...` instead of straight to
  the list. The previous "list invalidation + replace to list"
  behaviour is preserved on the share screen's `goToList`.
- `apps/workshop/app/_layout.tsx` — two new Stack.Screen
  registrations: `create-list/share` and `activity` (both
  `animation: "slide_from_right"`). No AuthGate changes — both
  screens are part of the signed-in stack and AuthGate already
  leaves signed-in users alone outside `sign-in` / `onboarding`.
- `tests/e2e/activity-feed.spec.ts` — happy-path. Two contexts (owner
  - member) signed in as distinct users via `signInAsDevUser` from
    3b-1. Owner creates a trip list, generates a share link via the
    new create-list-share step, and reads the URL out of
    `create-list-share-url`. Member accepts via the share path,
    lands on list-detail. Owner clicks `create-list-share-done`,
    lands on the same list, adds an item via the empty-state CTA.
    Member reloads home, expects `activity-unread-badge` to appear
    (filtering out the member's own `member_joined` event as
    same-actor). Member taps `open-activity`, expects the feed +
    the item title to be visible. Member taps `activity-back`,
    expects the badge cleared (`toHaveCount(0)`).
- `tests/e2e/{add-link-preview,add-search,list-flow,share-link-accept}.spec.ts`
  — each gets a 2-line patch to dismiss the new share step
  (`expect(create-list-share-done).toBeVisible()` + click) before
  asserting on `empty-add-item` / `list-settings`. The share step
  is now the canonical create-list landing surface; the existing
  specs treat it as a transient step.

Test counts: 1 new Playwright happy-path (`activity-feed.spec.ts`); 4
existing specs touched with 2-line dismiss-step patches. Backend
vitest count is the same 216 across 19 files (no backend changes in
3b-2). `pnpm run typecheck && pnpm run lint && pnpm run test` all
pass. `pnpm run e2e` runs 7 specs — 6 pass green; the 7th
(`sign-in.spec.ts`) hits the documented §3.22 known-flake (dirty
`dev@workshop.local.display_name` from prior specs in the same batch),
unrelated to 3b-2. Reset via `UPDATE users SET display_name = NULL
WHERE email = 'dev@workshop.local'` and the spec passes.

Surprises / deviations from plan:

- **Client-side `lastViewedAt` instead of per-list `lastReadAt`.** The
  plan said "clientside `unreadCount` derived from `lastReadAt` per
  list." But `GET /v1/lists` doesn't surface
  `user_activity_reads.last_read_at` per list — the field exists in
  the schema (3a-2) but the list-detail / list-summary shapes don't
  expose it. Rather than expand the API in this chunk, we store a
  single client-side `lastViewedAt` ISO timestamp in localStorage
  and compare every event's `createdAt` against it. The activity
  screen's `useFocusEffect` also fires `POST /v1/activity/read` for
  cross-device parity (so a device that opens the feed clears the
  read marker on the server too — another device can then re-derive
  unread from any future `lastReadAt` exposure). Trade-off: a user
  signing in on a fresh device sees every event since the dawn of
  time as "unread" until they tap the bell once. Acceptable for v1
  since the feed itself is unbounded and showing it that way is
  technically correct. **A future Phase 4 polish chunk should
  surface `lastReadAt` on `GET /v1/lists` (per-list) and switch the
  bell badge to per-list math** — that's the spec'd model and
  matches the spec §4.7 "unread count per list" behaviour.
- **`useQuery` and `useInfiniteQuery` cache slots conflict on shared
  keys.** Hit this in the first e2e run — `activity-feed` testID was
  invisible because the home bell's `useQuery` had populated the cache
  with `ActivityFeedResponse` shape, then the activity screen's
  `useInfiniteQuery` read the wrong shape and rendered the empty
  state. Fix: separate query keys (`activity.feed` for the bell,
  `activity.feedInfinite` for the screen). Worth a note in
  CLAUDE.md? Not really — this is a TanStack Query default, not a
  Workshop-specific gotcha.
- **No native `expo-clipboard`.** Same as 3b-1 — `copyToClipboard`
  returns `false` on native; the toast says "generated" instead of
  "copied". Phase 4 should land `expo-clipboard` once and unblock
  both the settings sheet and the create-list share step.
- **No new `expo-clipboard`, no new migrations, no new backend
  routes.** All deliverables sat on top of 3a-1 / 3a-2 / 3b-1
  primitives.
- **`list_renamed` / `list_deleted` activity events still missing.**
  3a-2 marked these as a deviation — the `activityEventTypeEnum` only
  has `list_created`. 3b-2 doesn't add them either; that's a Phase 4
  follow-up (requires a Drizzle migration to extend the enum, which
  is out of scope for a client-only chunk).
- **The unread filter excludes the user's own actions.** Spec §4.7
  doesn't say it explicitly but it's the obvious UX rule: if you
  add an item, your own bell shouldn't ping. `activity-feed.spec.ts`
  exercises this — the member's own `member_joined` event from
  invite-accept does NOT cause the badge to appear; only the
  owner's subsequent `item_added` does.
- **Existing specs needed dismiss-step patches.** The plan didn't
  call this out, but routing the create-list flow through the share
  step is a backwards-incompatible UX change for the 4 specs that
  use the create-list flow. Fix is mechanical (2 lines per spec).
  Worth noting so future create-list-flow extensions know to update
  these specs in lockstep.

What Phase 4 should do _first_: Phase 4 is the **iOS share extension**
— it's a native-first chunk, not a client UI feature. Read §3 Phase
4 and §3 (Phase 4 chunks table, when one lands) for the
decomposition. The activity feed UI is feature-complete for v1; the
only outstanding follow-up specifically for the activity surface is
**surfacing `lastReadAt` per-list on `GET /v1/lists`** (Phase 4 polish
or a Phase 5 cleanup chunk) so the bell badge can switch from the
single-stamp client model to the per-list model the spec describes.

Known constraints for Phase 4 / future chunks:

- **Activity feed bell uses `staleTime: 30_000`.** The home query
  doesn't auto-refetch every render; cross-device unread propagation
  is not real-time. A future Phase 4 chunk that wants live updates
  should reach for `refetchInterval` or websockets — both out of
  scope for v1.
- **Create-list share step assumes `listId` is in the route params.**
  The customize step's `onSuccess` invalidates `queryKeys.lists.all`
  and routes via `router.replace`, so the share screen lands with the
  list freshly cached. If a future chunk changes how the create-list
  flow ends (e.g. routing through a "verify" step first), make sure
  `?listId=` survives the round-trip.
- **`activity.tsx`'s `markActivityRead(undefined, token)` call is
  best-effort.** Failures are intentionally swallowed because a
  missed read marker isn't user-facing — the next focus retries.
  If a Phase 4 polish chunk wants to surface "mark all read" failures
  (e.g. retry-with-toast), the existing call site is the place to
  hook it.
- **The bell badge filter excludes same-actor events.** If a future
  chunk wants per-event preferences (e.g. "notify me when someone
  upvotes my item even if I'm the actor"), the filter in
  `app/index.tsx`'s `events.reduce` is the place to extend.

#### 3.24 Phase 4 chunks

Phase 4 splits into a JS-only chunk (web-testable, no native build) followed
by a native chunk (config plugin + Swift + EAS build). Splitting in this order
means the JS landing surface lands on `main` first; the native extension just
needs to hand off a URL to the existing flow.

**4a-2 is deferred until Phase 5 polish lands** — see "Deferral rationale"
below the table. Pick up Phase 5 chunks (§3.26) before revisiting 4a-2.

| Chunk    | What ships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | External deps                                                                                                                                                                                                                           | Status                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **4a-1** | JS-only share-flow plumbing. New `app/share/pick-list.tsx` (list picker, accepts `?url=…`, "Create new list" row, on pick routes to `/list/[id]/add?prefillUrl=…`). New `app/share/index.tsx` thin redirect so `workshop://share?url=…` (4a-2 native) and `https://…/share?url=…` (web) both land on pick-list. `app/list/[id]/add.tsx` accepts `?prefillUrl=` and seeds the free-form URL field (search-flow lists ignore it). Two new Stack.Screen registrations in `app/_layout.tsx`. One Playwright happy-path.                                                                                                                               | None — pure code, web-testable.                                                                                                                                                                                                         | **Done**                              |
| **4a-2** | Native iOS share extension. New `apps/workshop/plugins/share-extension/` Expo config plugin (or vendored equivalent) that injects a Share Extension target, App Group entitlement (`group.dev.josh.workshop`), and the `public.url` / `public.plain-text` UTI declarations into the iOS project at prebuild. Minimal Swift extension code that writes the shared payload to app-group `UserDefaults` and opens `workshop://share?url=…`. `app/_layout.tsx` adds an `expo-linking` listener for app-resume cases (the initial URL is already covered by expo-router's file-based routing). EAS native build auto-triggers via `@expo/fingerprint`. | App Group `group.dev.josh.workshop` — already _registered_ in the Apple portal (see CLAUDE.md "iOS capabilities are config-as-code"); EAS sync re-enables the App ID capability when the config plugin lands a code declaration for it. | **Deferred** — pick up after Phase 5. |

**Deferral rationale (decided 2026-04-28):** the share extension is the
last native-only feature left in the redesign. Landing it before Phase 5
polish has three concrete drawbacks:

1. **Verification needs a real iPhone.** Acceptance ends with a manual
   TestFlight smoke test (Safari → Share → "Workshop" → list picker). No
   sandbox can close that loop, so the chunk would land code-complete but
   functionally unverified — opposite of every other chunk in the plan.
2. **EAS free-tier minutes are scarce (30/month).** Iterating on Swift +
   the config plugin against a moving JS surface (Phase 5 still polishing
   the screens the share extension hands off to) means rebuilds against
   targets that change, burning minutes for no shipped value.
3. **The JS landing surface (4a-1) already works on web.** The
   `workshop://share?url=…` → `/share/pick-list?url=…` →
   `/list/:id/add?prefillUrl=…` chain is verified end-to-end in
   `tests/e2e/share-pick-list.spec.ts`. Whenever 4a-2 lands, it just
   plugs into the existing flow — nothing about the wait costs us.

Phase 5 polish (offline cache, light theme, "new items" pill, haptics,
two-pane, full E2E) is mostly web-shippable, doesn't need native builds,
and stabilizes the surface 4a-2 will hand off to. Implementation guidance
for 4a-2 stays parked in §3.25 ("What 4a-2 should do _first_"); when the
chunk is revisited, that section is still the right starting point —
the App Group identifier remains registered in the Apple portal and the
JS plumbing hasn't moved.

#### 3.25 What 4a-1 actually shipped — start here for 4a-2

> **Note (2026-04-28):** 4a-2 is **deferred** until Phase 5 polish
> completes — see §3.24 "Deferral rationale" and §3.26 for the
> active Phase 5 chunks. The implementation guidance below is
> preserved verbatim because nothing about 4a-1's deliverables has
> moved; pick up here whenever 4a-2 is revisited.

Files that landed in 4a-1 (read these before touching 4a-2):

- `apps/workshop/app/share/pick-list.tsx` — list picker. Reads
  `?url=` via `useLocalSearchParams`, fetches `GET /v1/lists` via the
  existing `queryKeys.lists.all` cache slot, renders a row per list +
  a dashed-border "Create new list" footer card. On pick,
  `router.replace`s to `/list/${list.id}/add?prefillUrl=${url}`. The
  picker `replace`s rather than `push`es so the share-flow stack
  doesn't pile up under the add screen — the share entry-point is
  treated as transient. Free-form list rows (`date_idea`, `trip`)
  render at full opacity; search-flow rows (`movie`, `tv`, `book`)
  render at `opacity: 0.6` because `add.tsx` ignores `prefillUrl` for
  search-flow lists today. testIDs: `share-pick-cancel`,
  `share-pick-url`, `share-pick-list`, `share-pick-row-${list.id}`,
  `share-pick-create-new`.
- `apps/workshop/app/share/index.tsx` — thin `<Redirect>` shim.
  Forwards `/share?url=…` to `/share/pick-list?url=…` so both web
  (`https://workshop.dev/share?url=…`) and the future native share
  extension (`workshop://share?url=…`) hit the same picker via
  expo-router's file-based routing. Mirrors the
  `app/invite/[token].tsx` pattern.
- `apps/workshop/app/list/[id]/add.tsx` — accepts a new
  `prefillUrl?: string` search param via `useLocalSearchParams`.
  Seeds the free-form `url` `useState` initial value with it (and
  only it — search-flow lists' `query` field is unaffected). The
  existing 300ms `useDebouncedQuery` + `useQuery<LinkPreviewResponse>`
  chain auto-fires off the seeded URL, so the link-preview card
  renders without further user input. The submit-time
  `trimmedUrl === debouncedUrl.trim()` gate already in place from
  2b-2 keeps stale previews from being attached.
- `apps/workshop/app/_layout.tsx` — two new Stack.Screen
  registrations: `share/index` (no animation; it's a redirect) and
  `share/pick-list` (`animation: "slide_from_right"`, matching the
  `create-list/*` and `activity` screens). No AuthGate changes —
  the share flow is signed-in-only by default; a signed-out user
  arriving at `/share?url=…` (web) gets bounced to `/sign-in` and
  the URL is dropped. Stashing the share URL through sign-in (à la
  the invite token in `inviteStash.ts`) is a follow-up if the
  flow ever needs to support signed-out arrival.
- `tests/e2e/share-pick-list.spec.ts` — happy-path. Dev-sign-in →
  create date-idea list → skip create-list-share step → simulate the
  share-extension hand-off via `page.goto('/share?url=…')` → assert
  the picker renders + URL is visible → click the row by accessibility
  name (`Add to ${listName}`) → land on add-item with
  `add-item-url` populated and `link-preview-card` visible (mocked
  `/v1/link-preview` per the 2b-2 fixture pattern).

Test counts: 1 new Playwright happy-path
(`tests/e2e/share-pick-list.spec.ts`); 0 new vitest (no backend
changes). `pnpm run typecheck && pnpm run lint && pnpm run test` all
pass (216 backend tests; same as 3b-2). `pnpm run e2e` runs 8 specs
— 7 pass green; the 8th (`sign-in.spec.ts`) hits the documented
§3.22 / §3.23 known-flake (dirty `dev@workshop.local.display_name`
from prior specs in the same batch), unrelated to 4a-1.

Surprises / deviations from plan:

- **Plan said "deep-link handler in `_layout.tsx`"; we use file-based
  routing instead.** expo-router with `scheme: "workshop"` already
  maps `workshop://share?url=…` to `app/share/index.tsx`
  automatically — same machinery that powers `workshop://invite/:token`
  → `app/invite/[token].tsx` (3b-1). No `Linking.addEventListener`
  call is needed for app-launch deep links. The plan's wording is
  pre-3b-1 and reflects a more manual approach. **For app-_resume_
  deep links** (the share extension fires while the app is already
  open), expo-router's listener should still fire — but if 4a-2 sees
  app-resume drops, fall back to `Linking.addEventListener('url', …)`
  in `_layout.tsx` as the plan originally suggested.
- **`/share` (no query string) is also a valid entry point.** The
  plan implied `?url=…` is required, but the share extension may
  carry the payload via app-group `UserDefaults` instead of the URL
  query. 4a-1's `app/share/index.tsx` redirects `/share` → `/share/pick-list`
  even with no `url` param, so 4a-2 can either pass `?url=` _or_ stash
  the URL via UserDefaults (the latter requires a small read in the
  pick-list screen — currently it just renders without a URL header).
- **`router.replace` (not `push`) on pick.** Avoids piling the share
  stack under the add screen. The share entry-point is treated as
  transient; the user's "back" from the add screen goes to home, not
  to the picker. Matches `app/invite/[token].tsx`'s redirect
  semantics.
- **Search-flow list rows are dimmed but still tappable.** A
  `movie`/`tv`/`book` list pick will land on `add.tsx` with
  `prefillUrl` ignored — the search input takes focus and the URL
  param is silently dropped. Considered hiding search-flow lists
  entirely from the picker; rejected because (a) the user might
  share into a movie list to remember "watch this trailer URL"
  (defer to 4a-2 follow-up if needed) and (b) hiding rows would
  make the picker inconsistent with the home screen's list view.
  The dim-opacity hint signals "this list won't use the URL"
  without removing it.

What 4a-2 should do _first_:

1. Add `apps/workshop/plugins/share-extension/` as an Expo config
   plugin. There are off-the-shelf options (e.g.
   `expo-share-extension`, `react-native-share-menu`) — vet the
   maintenance state before adopting; otherwise vendor a minimal
   plugin that injects the Share Extension target + App Group
   entitlement. The App Group identifier `group.dev.josh.workshop`
   is already registered in the Apple portal per CLAUDE.md
   ("iOS capabilities are config-as-code") — the capability on the
   App ID auto-re-enables when the code declaration lands.
2. Add the Swift extension target (kept minimal). Read
   `extensionContext?.inputItems` for `public.url` / `public.plain-text`,
   write to `UserDefaults(suiteName: "group.dev.josh.workshop")`,
   then open `workshop://share?url=<encoded>`.
3. Add `expo-linking` `addEventListener('url', …)` in
   `apps/workshop/app/_layout.tsx` for app-resume cases (initial
   URL is already covered by expo-router file-based routing —
   verified in 4a-1 by the Playwright happy-path).
4. Confirm `@expo/fingerprint` sees the native change and the
   `testflight.yml` workflow auto-fires on merge. The
   `eas.json` `build.production.env` follow-up from §"Pending"
   (`EXPO_PUBLIC_APPLE_SERVICES_ID` /
   `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID`) belongs in 4a-2's PR since
   that's the next native build; native Google sign-in needs
   `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` baked at build time.
5. Manual TestFlight smoke test: install the build, share a URL
   from Safari → "Workshop" → list picker → land on add-item with
   the URL pre-filled. The web app remains unchanged.

Known constraints for 4a-2 / future chunks:

- **The share flow is signed-in-only.** AuthGate redirects
  signed-out users on `/share*` to `/sign-in`, dropping the URL.
  Stashing the share URL through sign-in (à la
  `PENDING_INVITE_TOKEN_KEY` in `src/lib/inviteStash.ts`) is a
  follow-up if the share extension can fire from a logged-out
  iOS app. Today the iOS app boots into the auth flow if no
  session is cached, so this is rare but possible.
- **`prefillUrl` is silently ignored on search-flow lists.** If
  4a-2 wants to surface "you can't share URLs into book/movie/TV
  lists" UI feedback, the place to wire it is `app/list/[id]/add.tsx`
  — currently it just drops the param when `isSearchType`. The
  picker dims those rows visually but doesn't block the tap.
- **Web-side `/share?url=…` is a public URL.** Anyone with the
  Cloudflare Pages deploy URL can hit `/share?url=…`; AuthGate
  redirects them but the param is logged in the browser history.
  Not a security issue (the URL itself is what was shared) but
  worth noting.
- **`router.replace` semantics matter for back-nav.** A future
  chunk that wants the share picker to remain in history (e.g.
  "back" from add returns to the picker) needs to flip to
  `router.push`. 4a-2's native extension flow assumes `replace`
  (the picker is transient).

#### 3.26 Phase 5 chunks

Phase 5 is the active phase as of 2026-04-28. The §3 narrative for
Phase 5 (further down in this doc) lists six deliverables; this table
decomposes them into shippable chunks. Each chunk is web-shippable —
no native build required — so they can land back-to-back without EAS
minutes or TestFlight smoke tests.

The order below is the recommended pickup order. Earlier chunks have
fewer dependencies and lower blast radius; later chunks (two-pane,
full E2E) build on the polish foundations the earlier chunks land.

| Chunk  | What ships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | External deps                                                        | Status             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------ |
| **5a** | Offline read cache. Wire `persistQueryClient` into `apps/workshop/src/lib/query.ts` with platform-split persisters: `createAsyncStoragePersister` (iOS, via `@react-native-async-storage/async-storage` or `expo-async-storage`) and `createSyncStoragePersister` (web, via `window.localStorage`). Set `maxAge: 24h` and a buster key derived from the shared-types version so a schema bump invalidates persisted state cleanly. Mutations attempted while offline revert + show a "Retry?" toast (re-uses 1b-2's optimistic-update infra). Add one Vitest unit for the buster key. | None.                                                                | **Done (this PR)** |
| **5b** | Light theme tokens + `useColorScheme` flip. Extend `apps/workshop/src/ui/theme.ts` with a `light` palette mirror of the existing `dark` palette (semantic tokens stay stable; only raw hex values change). `ThemeProvider` reads `useColorScheme()` and swaps the active palette without remounts. No new component code — every primitive already reads from semantic tokens. Vitest snapshot of the resolved tokens for both modes.                                                                                                                                                 | None.                                                                | **Pending**        |
| **5c** | "New items" pill (spec §12). On `useQuery` refetch of `items.byList(id)`, compare the new length against the previous length; if `delta > 0` and the user has scrolled past the top, render a sticky pill at the top of `app/list/[id]/index.tsx` ("3 new items — tap to refresh") that scrolls to top + clears on tap. Hidden when the user is already at the top (the new rows render in place). Re-uses TanStack Query's `dataUpdatedAt` to drive the comparison.                                                                                                                  | None.                                                                | **Pending**        |
| **5d** | Haptics + micro-animations. Wire `expo-haptics` on upvote / complete / delete (Light/Medium impact respectively) with a `.web.ts` no-op. Reanimated micro-animations: 1.05× scale-pulse on upvote tap, strikethrough fade-in on complete, sheet enter/exit easing tuned. All driven from primitives (`UpvotePill`, `Checkbox`, `Sheet`) so call sites don't change.                                                                                                                                                                                                                   | None.                                                                | **Pending**        |
| **5e** | Desktop two-pane layout. Add a 768px breakpoint in `apps/workshop/app/_layout.tsx`: above the threshold render a left pane (lists index, sticky) + right pane (current list/item/modal); below the threshold the existing stack navigator is unchanged. Modals open centered over the right pane on desktop, full-screen on mobile. Verify back-button + deep-link behavior on both modes.                                                                                                                                                                                            | None.                                                                | **Pending**        |
| **5f** | Full Playwright E2E sweep. Cover sign-in (Google, JWKS-stubbed), create each of 5 list types, add an item via every pathway (movie/TV via TMDB stub, book via Google Books stub, free-form date-idea + trip via link-preview stub), upvote/unvote, complete/uncomplete, share-link accept in a second browser context, activity feed unread→read. Wire into a new `e2e.yml` GitHub Actions job running against a Dockerized Postgres. Lands the `signInAsDev(page)` test helper recommended in `AGENT-REFLECTIONS.md` 2026-04-28.                                                     | None — runs entirely against a local backend + local Postgres in CI. | **Pending**        |

**Pickup order:** 5a → 5b → 5c → 5d → 5e → 5f. The order is not strict —
any 5a–5d chunk can land independently and in any order — but 5e
benefits from light-mode tokens being in place (it touches layout
primitives), and 5f benefits from everything else being stable
(otherwise the test sweep churns). Within each chunk, follow the same
"acceptance criteria from §3 Phase 5 narrative" verification gate the
existing chunks use.

**Notes for the next agent:**

- **Don't pick up 4a-2 unless explicitly asked.** It's deferred; see
  §3.24 "Deferral rationale". If the human asks to revisit it before
  Phase 5 is done, fine — but don't take it as the default next pick.
- **Phase 5 chunks are still chunks.** Apply the `/continue-redesign`
  skill the same way: one chunk per PR, "What 5x actually shipped"
  section after, plan-update in the same PR.
- **The "Original Phase 5 deliverable list" further down in this doc
  is the source narrative**; this table is the chunked PR plan.

#### 3.27 What 5a actually shipped — start here for 5b

Files that landed in 5a (read these before touching 5b):

- `apps/workshop/src/lib/query.ts` — refactored. Adds
  `PERSIST_MAX_AGE_MS` (24h), `PERSIST_TYPES_VERSION` (a local mirror
  of `SHARED_TYPES_VERSION`; see "Surprises" below), pure
  `getPersistBusterKey(typesVersion?)`, and `getPersistOptions()`
  which packages a `Persister`, `maxAge`, `buster`, and a
  `dehydrateOptions` filter (skip mutations + skip non-success
  queries). `createQueryClient` also gains a `gcTime: 24h` so the
  in-memory cache outlives the persisted snapshot's `maxAge`.
- `apps/workshop/src/lib/persister.ts` (native) — wraps
  `createAsyncStoragePersister` from
  `@tanstack/query-async-storage-persister` over
  `@react-native-async-storage/async-storage`.
- `apps/workshop/src/lib/persister.web.ts` (web) — wraps
  `createSyncStoragePersister` from
  `@tanstack/query-sync-storage-persister` over `window.localStorage`,
  with a Map-backed in-memory fallback for environments where
  `window` is undefined (SSR safety; not currently used).
- `apps/workshop/src/lib/offline.ts` — pure `isOfflineError(err)`
  helper. Detects offline by:
  1. `error instanceof ApiError` → not offline (the request reached
     the server, just got a 4xx/5xx).
  2. `navigator.onLine === false` → offline.
  3. `error instanceof TypeError` whose message matches
     `failed to fetch` (web) / `network request failed` (RN) /
     `networkerror` (Firefox).
- `apps/workshop/src/lib/OfflineRetryWatcher.tsx` — small
  component-shaped subscriber. Wires `useQueryClient` →
  `mutationCache.subscribe()`, dedupes per `mutation.mutationId`, and
  on the first `error` transition with `isOfflineError(error)` true,
  shows a `tone: "danger"` toast with `actionLabel: "Retry?"`. The
  retry calls `mutation.execute(mutation.state.variables)` so the
  same payload re-fires once the network is back. Mounted under
  `<ToastProvider>` (so `useToast()` resolves) and inside
  `<PersistQueryClientProvider>` (so `useQueryClient()` resolves).
  Per-component `onError` handlers still fire first and revert their
  optimistic updates — the global toast is purely additive.
- `apps/workshop/app/_layout.tsx` — swap
  `<QueryClientProvider client={queryClient}>` for
  `<PersistQueryClientProvider client={queryClient} persistOptions={...}>`
  and mount `<OfflineRetryWatcher />` directly under `<ToastProvider>`.
  The `useMemo` for the queryClient is unchanged; a sibling
  `useMemo(() => getPersistOptions(), [])` keeps the `Persister`
  instance stable across renders.
- `packages/shared/src/types.ts` — adds the
  `SHARED_TYPES_VERSION = "1"` constant. Bump on any breaking edit to
  a request/response type. Pure additions (new optional field, new
  endpoint) don't require a bump.
- `apps/workshop/src/lib/query.test.ts` — 4 vitest cases:
  `getPersistBusterKey` returns a stable key, changes when the
  version changes, defaults to `PERSIST_TYPES_VERSION`, and the
  in-package `PERSIST_TYPES_VERSION` matches `SHARED_TYPES_VERSION`
  (the lock-step gate).
- `apps/workshop/vitest.config.ts` — new; matches
  `apps/backend/vitest.config.ts` (Node env, `src/**/*.test.ts`).
- `apps/workshop/package.json` — `test` script flipped from
  `echo "no tests yet"` to `vitest run`. Adds devDep
  `vitest@2.1.9` (matches backend's pin) and runtime deps
  `@react-native-async-storage/async-storage@2.2.0` (via
  `npx expo install`),
  `@tanstack/react-query-persist-client@5.100.1`,
  `@tanstack/query-async-storage-persister@5.100.1`,
  `@tanstack/query-sync-storage-persister@5.100.1` (all pinned to
  match the existing `@tanstack/react-query@5.100.1` peer to avoid
  the peer-mismatch warning).

Tests landed (4 new vitest in apps/workshop; 0 backend churn):
`pnpm run typecheck && pnpm run lint && pnpm run test` all green
(216 backend + 4 workshop). `pnpm run knip` clean. `pnpm run e2e` —
all 8 specs pass (the `sign-in.spec.ts` flake from §3.22 / §3.23
didn't reproduce in this run; possibly fixed by the dev-server reset
midway through, possibly still flaky on cold runs).

Surprises / deviations from plan:

- **Buster key is a local constant, not a runtime import from
  `@workshop/shared`.** The plan said "buster key derived from the
  shared-types version." Implementing that as
  `import { SHARED_TYPES_VERSION } from "@workshop/shared"` at runtime
  in `query.ts` broke Metro bundling — `packages/shared/src/index.ts`
  uses `export * from "./types.js"` (the `.js` extension is required
  by the backend's NodeNext tsconfig), which Metro doesn't resolve.
  Existing app code only `import type`s from `@workshop/shared`, so
  Metro elides those imports during bundling and never tripped on the
  re-export. Workaround: keep `PERSIST_TYPES_VERSION` as a local
  constant in `query.ts` and gate the lock-step in vitest (which runs
  in Node with normal extension resolution). This is a one-time
  bookkeeping cost — bumping the version requires editing two files —
  but the test fails CI loudly if anyone forgets, and it sidesteps a
  Metro-resolver fight that doesn't belong in this chunk.
- **`SHARED_TYPES_VERSION` is exported but only consumed from tests.**
  At runtime nothing reads it (per the bullet above). Future chunks
  that need a shared runtime constant should wire a Metro extension
  override (`metro.config.js` `resolver.sourceExts` shenanigans) or
  add an `exports` map to `packages/shared/package.json` that exposes
  a `.ts` subpath bypassing the `.js` re-export. Out of scope for 5a.
- **`shouldDehydrateMutation: () => false`.** The plan said
  "mutations attempted while offline revert + show a 'Retry?' toast"
  but didn't say whether failed mutations should survive a cold
  start. Persisting them would mean a user's failed-while-offline
  mutation resurfaces a "Retry?" toast on the next app launch — but
  it would also race the live refetch, and the cached error doesn't
  carry the original variables in a way that survives serialization
  cleanly. Decision: don't persist mutations. The retry toast is an
  in-session affordance only.
- **`shouldDehydrateQuery: status === "success"`.** Persisting an
  error-shaped cache entry would render an error UI on cold start
  before the live refetch finishes. Tests + dev didn't show this in
  practice, but skipping non-success queries is the conservative
  default.
- **No `useIsRestoring()` hydration UX.** TanStack ships a hook for
  showing a spinner during cache restore; on web localStorage is
  synchronous so restore lands on the first render frame, and on
  native AsyncStorage restore typically completes within a few
  hundred ms. Adding the spinner felt out of scope; revisit if 5b's
  light-theme work shows visible flash-of-stale.
- **The "Retry?" toast surfaces on every offline-failed mutation,
  even ones that already had a per-component `onError` toast.** Two
  toasts on offline (component's "Couldn't update item" + global
  "You're offline. Couldn't save change. Retry?") is a tolerable
  cost for the alternative — coordinating per-component handlers
  against `isOfflineError` would touch every mutation site. The
  per-component toast disappears on its 3.5s timer; the Retry toast
  stays slightly shorter and offers the action. 5d's haptics work
  could revisit this if it adds a unified mutation feedback layer.
- **`packages/shared/src/index.ts` was NOT changed.** An
  intermediate edit replaced `./types.js` with `./types` to fix the
  Metro break — that breaks the backend's NodeNext typecheck. The
  edit was reverted; the bundler-vs-NodeNext extension fight is the
  trigger for the local-mirror constant approach above.

What 5b should do _first_:

1. Read `apps/workshop/src/ui/theme.ts` and the consumers in
   `apps/workshop/src/ui/*` — every primitive should already
   reference `tokens.bg.canvas` / `tokens.text.primary` / etc.
   without raw hex literals. If anything imports `palette.*`
   directly, fix that first (the spec calls it out as a v1 rule).
2. Restructure `theme.ts` from `tokens = {...}` to
   `tokens = { dark: {...}, light: {...} }` per Appendix §9
   "Tweakability rules". Keep the dark palette byte-identical to
   today's so this chunk is a strict superset.
3. Wire `useColorScheme` from `react-native` (works on web via
   `react-native-web`) into a small `ThemeProvider` in
   `src/ui/theme.ts` that exposes the active palette via a
   context. `useTheme()` already exists (`src/ui/useTheme.ts`) —
   extend it rather than introducing a parallel hook.
4. Snapshot test in vitest: resolve both palettes and assert the
   semantic-token keys match (no drift between dark and light).
5. Manual verification: toggle macOS / iOS appearance and confirm
   the app flips without remounts.

Known constraints for 5b / future chunks:

- **Don't import `SHARED_TYPES_VERSION` at runtime in
  `apps/workshop`.** Metro can't resolve the `.js` re-export in
  `packages/shared/src/index.ts`. Use `import type` (Metro elides
  it) or mirror the value locally with a vitest lock-step gate, like
  `PERSIST_TYPES_VERSION` does in `query.ts`.
- **`PersistQueryClientProvider` replaces `QueryClientProvider`.**
  Don't double-wrap; `PersistQueryClientProvider` already provides
  the QueryClient context. New providers should mount under it (see
  the `_layout.tsx` ordering: `PersistQueryClientProvider` →
  `ToastProvider` → `OfflineRetryWatcher` + `AuthProvider`).
- **Bump `PERSIST_TYPES_VERSION` (and `SHARED_TYPES_VERSION`)
  on breaking shape edits in `packages/shared/src/types.ts`.**
  Pure additions (new optional field, new endpoint) don't require a
  bump; renames, removed fields, or changed semantics do. The
  vitest lock-step test catches half-bumps.
- **`OfflineRetryWatcher` calls `mutation.execute(variables)`.**
  This re-fires the same mutation function with the original
  variables. Mutations whose `mutationFn` reads from non-deterministic
  module state (e.g. a debounced query, a singleton) must guard their
  own state. None of the current mutations do this; new ones should
  follow suit.

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
  allowlist must block _all_ private ranges, not just the obvious ones — use
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
- Deep-link handling on app _resume_ (not just launch) is easy to miss —
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
   builds/month is plenty for Phase 4 (~3–5 expected builds) _if_ CI doesn't
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

| Area                                     | Added                                                                                                                                               | Deleted                                                                                                                               | Renamed/Rewritten                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `apps/backend/src/routes/`               | `v1/auth.ts`, `v1/users.ts`, `v1/lists.ts`, `v1/items.ts`, `v1/invites.ts`, `v1/members.ts`, `v1/activity.ts`, `v1/search.ts`, `v1/link-preview.ts` | `auth.ts`, `items.ts`                                                                                                                 | —                                                           |
| `apps/backend/src/db/schema.ts`          | —                                                                                                                                                   | —                                                                                                                                     | Full rewrite (no `magic_tokens`)                            |
| `apps/backend/drizzle/`                  | `drop_v1_schema`, `v2_schema`, per-phase ALTERs                                                                                                     | —                                                                                                                                     | —                                                           |
| `apps/backend/src/lib/`                  | `response.ts`, `metadata-cache.ts`, `events.ts`, `oauth/apple.ts`, `oauth/google.ts`                                                                | `email.ts`                                                                                                                            | —                                                           |
| `apps/backend/src/middleware/`           | `rate-limit.ts`, `authorize.ts`                                                                                                                     | —                                                                                                                                     | `auth.ts` (now `requireAuth` + `requireListMember` helpers) |
| `packages/shared/src/types.ts`           | All v2 types                                                                                                                                        | `RecItem`, `RecCategory`, old request/response                                                                                        | —                                                           |
| `apps/workshop/app/`                     | `onboarding/`, `list/[id]/...`, `create-list/`, `activity.tsx`, `share/`, `settings.tsx`                                                            | existing `index.tsx`, `sign-in.tsx`                                                                                                   | Full rewrite (OAuth buttons)                                |
| `apps/workshop/src/components/`          | —                                                                                                                                                   | All existing (`ItemCard`, `AddEditModal`, `CategoryDropdown`, `Tabs`, `DataPanel`, `ContextMenu`, `HeaderMenu`, `Header`, `theme.ts`) | —                                                           |
| `apps/workshop/src/ui/`                  | Full primitives library (§5.3)                                                                                                                      | —                                                                                                                                     | —                                                           |
| `apps/workshop/plugins/share-extension/` | Phase 4 config plugin + Swift source                                                                                                                | —                                                                                                                                     | —                                                           |
| `infra/`                                 | `ssm.tf` — `apple_services_id`, `apple_bundle_id`, `google_ios_client_id`, `google_web_client_id`, `TMDB_API_KEY`, `GOOGLE_BOOKS_API_KEY`           | `ses.tf`; `ses_verified_email` variable; `SES_FROM_ADDRESS` env + SES IAM policy in `lambda.tf`                                       | `lambda.tf` (OAuth + API key env vars)                      |
| `docs/`                                  | This file; phase-specific handoff notes as written                                                                                                  | —                                                                                                                                     | —                                                           |

---

## 9. Appendix — Phase 0 placeholder palette

Arbitrary pick to unblock Phase 0; a designer pass later will revise.
Structured so that swap-out is a single-file edit.

**Structure in `apps/workshop/src/ui/theme.ts`**:

```ts
const palette = {
  // raw hex — edit these to reskin
  ink: {
    900: "#0E0E10",
    800: "#16161A",
    700: "#1F1F25",
    600: "#26262E",
    500: "#33333D",
    400: "#4A4A56",
  },
  paper: { 50: "#F2F2F5", 200: "#A8A8B3", 400: "#6E6E78" },
  amber: { 500: "#F5A524", 600: "#E89611", muted: "#F5A52422" },
  green: { 500: "#3DD68C" },
  red: { 500: "#F05252" },
  listColors: {
    sunset: "#F5A524",
    ocean: "#4CA7E8",
    forest: "#3DD68C",
    grape: "#A78BFA",
    rose: "#F472B6",
    sand: "#D4B896",
    slate: "#94A3B8",
  },
} as const;

export const tokens = {
  // semantic names — components only reference these
  bg: { canvas: palette.ink[900], surface: palette.ink[800], elevated: palette.ink[700] },
  text: {
    primary: palette.paper[50],
    secondary: palette.paper[200],
    muted: palette.paper[400],
    onAccent: palette.ink[900],
  },
  border: { subtle: palette.ink[600], default: palette.ink[500], strong: palette.ink[400] },
  accent: { default: palette.amber[500], hover: palette.amber[600], muted: palette.amber.muted },
  status: { success: palette.green[500], warning: palette.amber[500], danger: palette.red[500] },
  list: palette.listColors,
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
