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
pnpm run db:generate -- --name=descriptive_name   # always pass --name
pnpm run db:migrate                                # apply locally
```

Commit the SQL file **and** the `drizzle/meta/` snapshot **and** `_journal.json`.
Migrations run automatically in CI on merge to `main` (`deploy-backend.yml` → `migrate`).

## Postgres pool: `postgres({ max: 1 })`

Correct for Lambda — each container has its own client. Don't raise it.

## Logger: pass full errors, not strings

```ts
logger.error("failed to x", { error }); // good — keeps the stack
logger.error("failed to x", { error: error.message }); // bad — loses the stack
```

Source: `src/lib/logger.ts`.

## `JSON.parse` and `Response.json()` return `unknown`

ts-reset is enabled repo-wide. Validate with zod (see `src/lib/session.ts`) or a type
guard. Don't blind-cast.

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

## Request analytics

Every Lambda request emits one structured JSON line (`kind: "request"`) with
`request_id`, `method`, `path`, `route`, `status`, `duration_ms`, `user_id`, `platform`,
`app_version`, `ip`, `origin`, `referer`, `user_agent`. CloudWatch log group
`/aws/lambda/workshop-prod-api`, 30-day retention. Preset queries via
`scripts/log-analytics.sh` (e.g. `by-platform`, `top-paths`, `errors`, `slow`,
`user <user-id>`).
