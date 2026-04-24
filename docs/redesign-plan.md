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

### Phase 0 — Foundations (1 PR, or small stack)

**Goal**: Wipe v1, land the v2 schema, move auth + user profile under `/v1`,
capture `display_name`, ship the primitives library skeleton.

**Deliverables**:

1. **Migrations** (`apps/backend/drizzle/`)
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
2. **OAuth auth rewrite** (`apps/backend/src/routes/v1/auth.ts`, `users.ts`)
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
3. **Rate-limit middleware** (`apps/backend/src/middleware/rate-limit.ts`)
   - Table-backed by `rate_limits`. Applied to `/v1/auth/*` first (by IP —
     cheap abuse surface); item/search limits wired when those routes land.
4. **Response envelope helper** (`apps/backend/src/lib/response.ts`)
   - `ok(data)`, `err(code, message, details?)` — uniform `{ error, code }` per
     spec §8.
5. **Client — sign-in + display-name capture**
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
6. **Primitives library skeleton** (`apps/workshop/src/ui/`)
   - `theme.ts` (palette + tokens per §9 Appendix; dark-only initially),
     `useTheme.ts`, `Text.tsx`, `Button.tsx`, `IconButton.tsx`, `Card.tsx`,
     `EmptyState.tsx`. Enough to rebuild sign-in + onboarding. (No
     `TextField` needed for Phase 0 — OAuth has no inputs; defer to Phase 1.)
   - Old `src/components/theme.ts` — migrate sign-in to tokens, then delete
     the hex palette exports.
7. **Infra** (`infra/`)
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
8. **Shared types** (`packages/shared/src/types.ts`)
   - Remove `RecItem`, `RecCategory`, old auth request/response types.
   - Add `User` (with `authProvider`, `displayName`), `ListType`,
     `MemberRole`, `AppleAuthRequest`, `GoogleAuthRequest`,
     `AuthResponse` (`{ user, needsDisplayName }`), `Me`.

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

**Deliverables**:

1. **Backend routes** (`apps/backend/src/routes/v1/`)
   - `lists.ts` — `GET /v1/lists`, `POST`, `GET /:id`, `PATCH /:id`, `DELETE /:id`.
   - `items.ts` — `GET /v1/lists/:id/items`, `POST`, `GET /v1/items/:id`,
     `PATCH`, `DELETE`, `POST /:id/upvote`, `DELETE /:id/upvote`,
     `POST /:id/complete`, `POST /:id/uncomplete`.
   - Helpers: `assertListMember(userId, listId)` authorization guard used by
     every item route.
2. **Item creation transactionally inserts the creator's upvote** (spec §2.3).
3. **List query returns `upvote_count` as a computed column** via
   `LEFT JOIN ... COUNT(...)::int` (spec §7.7). Sort: `upvote_count DESC,
   created_at DESC`.
4. **Client**
   - `app/index.tsx` — Home with rich list cards, empty state, FAB.
   - `app/create-list/_layout.tsx` + `type.tsx` + `customize.tsx` —
     create-list modal stack (skip the Invite screen in P1; added in P3).
   - `app/list/[id]/index.tsx` — list detail with filter bar, upvote pill,
     completed section.
   - `app/list/[id]/item/[itemId].tsx` — item detail.
   - `app/list/[id]/add.tsx` — free-form add (date-idea/trip type only).
     Movie/TV/Book add pathway is a stub that routes to free-form until P2.
   - New primitives: `Sheet`, `Modal`, `UpvotePill`, `Avatar`, `Chip`, `Toast`.
5. **TanStack Query integration** (`apps/workshop/src/lib/query.ts`)
   - `QueryClient` setup with `refetchOnWindowFocus`, `refetchOnReconnect`.
   - `queryKeys.ts` — centralized key factory (`lists.all`, `lists.detail(id)`,
     `items.byList(id)`, `items.detail(id)`).
   - Optimistic update helpers for upvote, complete, add. Rollback with toast
     on error (spec §5.5).
6. **Shared types**: `List`, `Item`, `ListMemberSummary`, CRUD request bodies.
7. **Haptics**: wire `expo-haptics` on upvote / complete / delete (no-op on
   web — handle via `.web.ts` override).

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

