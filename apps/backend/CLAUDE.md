# apps/backend — coding agent guide

Hono app. Runs both as a Lambda handler (`src/lambda.ts`) and a local Node server
(`src/server.ts`); shared routes in `src/app.ts`.

## Adding a route

1. Handler at `src/routes/<area>.ts`.
2. Mount in `src/app.ts` (`app.route("/area", areaRoutes)`).
3. If auth is required, put `app.use("*", requireAuth)` at the top of the sub-router
   (see `routes/watchlist.ts`).
4. If request/response types are shared with the client, add them to
   `packages/shared/src/types.ts`.
5. Add a vitest beside the file if the logic is non-trivial.

## Adding a table

From this directory:

```bash
pnpm run db:generate --name=descriptive_name   # always pass --name; no "--" (drizzle-kit rejects it)
pnpm run db:migrate                                # apply locally
```

Commit the SQL file **and** the `drizzle/meta/` snapshot **and** `_journal.json`.
Migrations run automatically in CI on merge to `main` (`deploy-backend.yml` → `migrate`).

## Postgres pool: `postgres({ max: 1 })`

Correct for Lambda — each container has its own client. Don't raise it.

## Neon cold-starts: wrap the first DB touch in `withDbRetry`

Neon's serverless compute scales to zero after ~5min idle. The first request
back races its wake-up and, if it loses, postgres-js rejects with
`CONNECT_TIMEOUT` — which surfaced as a burst of 10s-then-500 reads after an
idle gap (the desktop app showed the logged-in shell but no data). The fix is
`withDbRetry` (`src/db/retry.ts`): it retries **transient connection-establishment
errors only** (never constraint/query errors) with bounded exponential backoff +
jitter, capped well under the 15s Lambda timeout. `connect_timeout` in
`client.ts` was lowered to 5s so a second attempt fits the budget — keep the two
in sync (`attemptCostMs`). Because the first successful connect warms the pooled
connection for the rest of the request, you only need to wrap the **first** DB
op on a path: authenticated routes are already covered (the `requireAuth`
session check in `lib/sessionRevocation.ts`); **new unauthenticated DB endpoints
must wrap their opening query themselves** (see the public list-preview handlers
in `routes/v1/lists.ts`). It's transparent on success, so wrapping is free on the
warm path. We do NOT keep Neon warm with a ping — retry is the chosen tradeoff.

## Logger: pass full errors, not strings

```ts
logger.error("failed to x", { error }); // good — keeps the stack
logger.error("failed to x", { error: error.message }); // bad — loses the stack
```

Source: `src/lib/logger.ts`.

## `JSON.parse` and `Response.json()` return `unknown`

ts-reset is enabled repo-wide. Validate with zod (see `src/lib/session.ts`) or a type
guard. Don't blind-cast.

## Leaderboard `score_regex` self-heals — don't rely on the backfill alone

A leaderboard item's `score_regex` / `score_direction` (used to parse a numeric
`score_value` out of the pasted share) is set two ways: the one-time
`scripts/backfill-score-regex.ts` for existing rows, **and** the score upsert
(`routes/v1/scores.ts`), which detects the game from the item's title/url/siteName/sourceId
and persists the regex the first time a score is posted. Without the self-heal, an item
created after the backfill falls back to "first number anywhere in the text" and stores
junk (e.g. the `dailytens.com/?ref=<id>` referral id) as the score. Both paths share the
catalog in `src/lib/gameScoreRegex.ts` — add a new game there and both pick it up. A
catalog entry's `scoreRegex` is normally a capture-group regex (group 1 = the number), but
`count:<pattern>` means the score is the **count** of global matches of `<pattern>` — Daily
Tens has no numeric score, so it counts 🏆 (`count:🏆`, desc). Both `tryParseScoreValue` and
the backfill's `parseScore` understand the `SCORE_COUNT_PREFIX` sentinel; keep them in sync.
**Changing a game's scoring rule only fixes _new_ posts** (self-heal sets the catalog regex on
items that lack one) — existing items keep their stored regex and existing `item_scores.score_value`
stays stale, so **re-run `scripts/backfill-score-regex.ts` on prod** after a catalog change
to update items + re-parse history. The client mirrors the same distillation for _display_:
the leaderboard row and the clipboard
recap both render through `summarizeScoreBody` (`apps/workshop/src/lib/scoresSummary.ts`),
which strips URLs/headers so a URL-only share shows "Played", never the raw link.

## `leaderboard` implies an ordered, reorderable game list (even without `ranking`)

A leaderboard's games are an ordered list the user can drag-reorder in the status-card view
(`GameLeaderboardCard`). Three spots in `routes/v1/items.ts` enforce this so it doesn't
depend on the `ranking` module being present:

- **`fetchItemsForList`** buckets a leaderboard's games into `ordered` (not `unordered`),
  in the SQL's position-ASC order. A null-position game (added before this rule) sorts last
  and earns a position the first time it's dragged.
- **`createItem`** assigns a `position` when the list has `leaderboard` (was previously
  gated on `ranking && leaderboard`), so a new game is immediately reorderable.
- **`POST /:id/move`** accepts `leaderboard` OR `ranking` (was `ranking`-only). Lists with
  neither still get the existing `ranking.disabled` 409.

If you add a leaderboard surface that buckets/gates on `ranking`, add `leaderboard` too, or
leaderboard-only lists (no `ranking` module — e.g. "Geo games") silently lose reorder.

## Letterboxd-match lists (`letterboxd` module) — three-layer model

The match feature splits across three storage layers; know which one you're touching:

1. **Account**: `users.letterboxd_username` + per-user cache `letterboxd_watchlist_films`
   (replaced wholesale by `syncUserWatchlist`, keyed by canonical film slug). Connect via
   `PUT /v1/users/me/letterboxd` — it scrape-validates and runs the initial sync inline.
2. **List**: the `letterboxd_match` source (config `{}`) joins members' caches and
   materializes films on ≥2 members' watchlists as `kind=movie` items
   (`lib/sources/letterboxdMatch.ts`). It refreshes member caches stale past 6h during
   sync; a member's failed scrape degrades to their stale cache. Dedup is by
   `content->>'letterboxdSlug'` **checked in code against archived rows too** (the tmdbId
   partial index only backstops enriched films) — an archived film must not resurface.
3. **Item**: `items.suggestion_state` (`'pending'` | NULL) + `item_acceptances` rows drive
   the suggest/accept flow (`routes/v1/letterboxd.ts`). The suggester gets an acceptance
   row at suggest time; the first acceptance from a _different_ member promotes
   (`suggestion_state → NULL`). Withdrawal never re-pends. Workshop **cannot write to
   Letterboxd** (no public API) — "accept" records intent and the client deep-links to the
   film page; the next watchlist sync verifies via the read-time `watchlistOf` state.

Read-time annotation (`annotateLetterboxd` in `routes/v1/items.ts`) attaches
`item.letterboxd = { watchlistOf, pending, acceptances }` when the module is on — never
stored on the row, always derived from the caches. Pending items bucket into the
`suggested` section of `ListItemsResponse` (empty array on every other list).

## Profile pictures live inline on `users.avatar_url` (base64 data URL)

`PATCH /v1/users/me` (`routes/v1/users.ts`) updates `displayName` and/or `avatarUrl`
independently — both optional, send only what changed; `avatarUrl: null` clears the
picture; an empty body 400s. The avatar is stored as a base64 `data:` URL (same approach
as list `cover_photo_url` — no object store yet), capped + raster-only by `avatarUrlSchema`
(reused shape from `coverPhotoUrlSchema`). `toUserShape` is duplicated in `users.ts` **and**
`auth.ts` — add new user fields to both. **`avatarUrl` is deliberately NOT joined into
leaderboard / activity / member payloads**: those fan out across many users and inlining
~1MB base64 per row would bloat responses. If you want other users' photos there, move
avatars to a URL/CDN store first — don't naively join the data URL column.

## Games surface (`routes/v1/games.ts`) is isolated from the Lists leaderboard

The Games tab (spec §3, G1a) has its own tables — `games` (global catalog, deduped by
`normalized_url` via `normalizeGameUrl` from `@workshop/shared/games`), `user_games`
(per-user ordered selection), `game_scores` (`(game_id,user_id,period_key)` PK) — and must
never read or write `items` / `item_scores`; a test in `games.test.ts` asserts the source
stays clean, so don't add such an import even for "harmless" reuse. Consequences of the
isolation: the score parser in `games.ts` (`parseGameScoreValue`) is a deliberate twin of
the one in `scores.ts` (keep both in sync when the `count:` sentinel semantics change), and
`lib/gamePositions.ts` twins `lib/positions.ts` for `user_games.position` (the pure helpers
are shared). The catalog seed lives in migration `0023_games_tables.sql` and must stay in
sync with `GAME_REGEX_CATALOG` (each entry's `title`/`canonicalUrl`); `games.test.ts`
enforces it. Routes are flag-gated **inside the router** (404 when off): on when
`STAGE=local`, otherwise requires `ENABLE_GAMES=1` in the Lambda env (set by Terraform).
Standings cover `viewer ∪ friends_of(viewer)` via `visibleUserIds()` (G2a) — the friend graph
lives in `friendships` (one canonical row per pair, `user_low < user_high`; `lib/friends.ts` is
the only writer and owns the invariant) with share-link invites in `friend_requests`
(`routes/v1/friends.ts`, same flag gate as games). `GET /v1/games/discovery` (friends' games I
haven't added) is registered **before** the `/:id` routes so the literal path isn't shadowed;
its `?friend=` filter 404s for non-friends so the endpoint can't be used to probe a stranger's
games. `games.test.ts` is also the repo's first real-DB vitest suite: it runs the actual `drizzle/`
migrations against in-memory PGlite (`@electric-sql/pglite`) with `getDb` mocked — copy that
pattern when a route's acceptance criteria are DB behaviors, not just schema validation.

## Lists and items are soft-deleted via `archived_at`

`DELETE /v1/lists/:id` (owner-only) and `DELETE /v1/items/:id` set the row's
`archived_at`; FKs stay configured for a future unarchive surface. **Every read path must
filter `archived_at IS NULL`** — `requireListMember` / `requireItemMember` 404 archived
rows, `GET /v1/lists` filters lists, item reads filter both item and parent list, the
activity feed joins through both, and the public invite preview/accept check the same.
When you add a new query touching `lists` or `items`, add the same filter. Action events
are `list_archived` / `item_archived` (legacy `item_deleted` is kept in the enum for old
rows). For album-shelf items the partial unique index on `(list_id, spotifyAlbumId)`
includes archived rows, so a refresh won't resurface an album the user archived.

## Per-(list, viewer) presentation state lives on `list_members`

`pinned_at`, `archived_at`, `muted_at` columns (NULL = not set). `last_read_at` for
unread-count derivation lives in the older `user_activity_reads` table — don't
duplicate it. `GET /v1/lists` joins both into `ListSummary`. Endpoints follow
`POST /v1/lists/:id/{pin,archive,mute,read}` to set + `DELETE` to clear; `read` is
one-way (no inverse semantic). Don't confuse this per-viewer `archived_at` with the
global soft-delete `archived_at` on `lists` / `items` above.

## Unread count is server-authored

The home bell badge is `sum(list.unreadCount across non-muted lists)` from
`ListSummary`. Don't reintroduce a client-side cutoff-against-`getActivityLastViewedAt`
derivation — it has no per-list granularity, and a single `/activity` visit clears
everything.

## Saved views are a separate list-scoped router (`routes/v1/views.ts`)

Saved views (spec §2.3 — named, stored tag filters) live in their own `listViewRoutes`
router mounted at `/v1/lists` alongside `memberRoutes` / `listScoresRoutes`, **not** inside
`lists.ts`. Routes: `GET/POST/PATCH/DELETE /v1/lists/:id/views[/:viewId]`; `requireListMember`
reads the list `:id`, so the `:viewId` uuid is re-validated inside the handler. They're
**shared per-list, not per-viewer** (unlike `list_members` view-state above): any member
creates (membership is the only gate, no capability), but `canMutateView` restricts PATCH +
DELETE to the view's `created_by` **or** the list owner. `created_by` is `ON DELETE SET NULL`
so a departed author's shared view survives. `config` is jsonb `{ tags, sort? }`; `config.tags`
is normalized with the **same** trim/lowercase/collapse/dedupe/≤40-char rules as item tags —
that zod `tagSchema` is duplicated from `items.ts` (kept local to avoid a cross-file import),
so if you change tag normalization, change it in both. Not module-gated — works on any list,
like tags. `position` is assigned `max+1` on create for strip ordering.

## CORS lives in Hono — and the allowed-origin list is a whitelist

Single source of truth: `cors()` in `src/app.ts`. API Gateway intentionally has **no**
`cors_configuration` block so OPTIONS preflights fall through to Lambda and Hono
answers them — that's the only place dynamic origin matching (Cloudflare Pages branch
previews) can happen.

When adding a new HTTP verb, also update `apiRequest`'s `method` union in
`apps/workshop/src/lib/api.ts`. When allowing a new web origin, add it to
`STATIC_ALLOWED_ORIGINS` (or `ALLOWED_ORIGIN_PATTERNS` for wildcards) in `src/app.ts`.
**Never** widen to `*` with `credentials: true` — that reflects every origin and
defeats CORS as a defense against cross-site reads.

Verify:

```bash
curl -X OPTIONS \
  -H "Origin: https://workshop-a2v.pages.dev" \
  -H "Access-Control-Request-Method: PUT" \
  <api>/v1/whatever -i
```

## Config + secrets

`src/lib/config.ts` validates env vars with zod and fails fast if anything is missing. In
prod, Terraform sets env vars on the Lambda function (`STAGE`, `DATABASE_URL`,
`SESSION_SECRET`, `APPLE_BUNDLE_ID`, `APPLE_SERVICES_ID`, `GOOGLE_IOS_CLIENT_ID`,
`GOOGLE_WEB_CLIENT_ID`, `TMDB_API_KEY`, `GOOGLE_BOOKS_API_KEY`, `LOG_LEVEL`). Locally,
`scripts/dev.sh` seeds `.env` from `.env.example` and generates a random
`SESSION_SECRET`.

## Lambda bundling

- `src/lambda.ts` is the handler — bundled by `scripts/bundle.mjs` (esbuild) into a
  single file.
- AWS SDK v3 is marked `external` (provided by the Lambda runtime) to shrink the zip.
- `postgres` (the pg driver) is bundled because there's no built-in.
- Cold start ~300–500ms for a bundled Node.js 20 Hono handler.

## Discord operator notifications are observable — grep the logs first

`notifyDiscord` (`src/lib/discord.ts`) logs **every** outcome, so "a `#workshop-admin`
message is missing" is triageable from CloudWatch without guessing. An event emits its
call-site line — `new signup` / `sign-in` (`routes/v1/auth.ts`), or nothing extra for a
new list — then one of: `discord notify sent` (delivered), `discord notify non-2xx` /
`discord notify threw` (Discord rejected — auto-retried once on 429/5xx/network), or
`discord notify skipped: webhook not configured` (the `DISCORD_NOTIFY_WEBHOOK_URL` Lambda
env is empty). **Every sign-in pings** (`notifySignIn`): a genuinely new user
(`createdUser: true`) emits `new signup` + the `:wave:` / `kind: "signup"` message, a
returning user (incl. a known email linking a second provider, `createdUser: false`) emits
`sign-in` + the `:bust_in_silhouette:` / `kind: "signin"` message. The dev auth route
(`/v1/auth/dev`) is deliberately silent — it's the sandbox/E2E auto-sign-in. **Every list
made pings** (`notifyNewList`): the create path (`kind: "new_list"`) and the duplicate path
(`kind: "new_list_duplicate"`). So "no message" means the event didn't happen (or the
webhook is unset) — cross-check the `users` / `lists` tables before assuming a delivery bug.

```bash
AWS_PROFILE=workshop-prod ./scripts/logs.sh --since 720h --filter '?"new signup" ?"sign-in" ?"discord notify"' --no-follow
```

## Request analytics

Every Lambda request emits one structured JSON line (`kind: "request"`) with
`request_id`, `method`, `path`, `route`, `status`, `duration_ms`, `user_id`, `platform`,
`app_version`, `ip`, `origin`, `referer`, `user_agent`. CloudWatch log group
`/aws/lambda/workshop-prod-api`, 30-day retention. Preset queries via
`scripts/log-analytics.sh` (e.g. `by-platform`, `top-paths`, `errors`, `slow`,
`user <user-id>`).
