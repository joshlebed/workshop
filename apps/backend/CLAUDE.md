# apps/backend — coding agent guide

Hono app. Runs both as a Lambda handler (`src/lambda.ts`) and a local Node server
(`src/server.ts`); shared routes in `src/app.ts`.

## Adding a route

1. Handler at `src/routes/<area>.ts`.
2. Mount in `src/app.ts` (`app.route("/area", areaRoutes)`).
3. If auth is required, put `app.use("*", requireAuth)` at the top of the sub-router
   (see `routes/watchlist.ts`) — **only if the router is mounted under its own prefix**.
   A router mounted at bare `/v1` (`moderationRoutes`, `publicListRoutes`, `webhookRoutes`,
   `inviteRoutes`) shares that prefix with every router registered after it, so a blanket
   `use("*", requireAuth)` there 401s the anonymous crawler routes too (share-link previews,
   `/v1/game-share/:token`, webhooks). Attach `requireAuth` per route on `/v1` routers;
   `app.test.ts` ("anonymous /v1 routes") pins this.
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

## Managed device sessions

`auth_sessions` owns refresh rotation and device revocation. Managed access tokens carry `sessionId`
and last one hour; refreshes rotate a deterministic HMAC credential, extend the 180-day idle window,
and stop at the one-year absolute expiry. A previous version is accepted for 10 seconds only to absorb
parallel tabs/requests; later reuse revokes the row. Never store a raw refresh token. Browser callers
are identified by `Origin` (with the platform header as a compatibility fallback), receive the token
only as an HttpOnly cookie, and reach the API through the Pages `/api/*` proxy. Preserve the
`X-Workshop-Session-Version: 2` negotiation and legacy sign-in path: removing it logs out older native
builds that cannot consume refresh credentials. `/v1/auth/session` upgrades a valid legacy token;
managed access tokens must never be allowed to mint a replacement refresh session.

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

## Score parsing is spec-driven via the shared game registry

Per-game knowledge (identify patterns, share-text patterns, the parser, direction, display
formatter) lives in ONE place: `packages/shared/src/gameRegistry.ts` (`GAME_REGISTRY`).
Parsers are declarative **ScoreSpecs** (`packages/shared/src/scoreParsing.ts`) — small JSON
rules (`capture`, `count`, `countLines`, `duration`, `tokenPosition`, `wordMap`,
first-match-wins) interpreted identically on backend and client. To add a game: one registry
entry + a seed migration row (follow 0032's ON CONFLICT DO UPDATE shape so a pre-existing
unknown row gets claimed); `games.test.ts` enforces the seed sync against
`CATALOG_GAME_DEFINITIONS`. Never extend per-game code — add a spec primitive to the
interpreter if a share shape doesn't fit.

Parser resolution at post time (`lib/gameCatalog.ts`): registry spec by `games.game_key` →
user-taught `games.score_spec` jsonb (written by `PUT /v1/games/:id/score-spec`, the
tap-the-score teach flow — server re-runs the spec against the teaching example and rejects
non-reproducing specs; registry games are read-only. The same endpoint optionally stores a
**`games.summary_spec`** — a `SummarySpec` from `@workshop/shared/summarySpec`, the taught
recap formatter built in the teach flow's line-picking preview; it must render the teaching
example to something, and an absent `summarySpec` on a re-teach clears the stored one) →
the item's stored rule string
`items.score_regex` (three generations decode: bare regex, `count:<token>`, `spec:<json>`)
→ first-number-anywhere fallback only when no parser exists at all.

**First-teach is open; re-teach is admin-only; both are audited.** Any signed-in user can
teach a non-registry game's FIRST spec (the tap-the-score flow the client surfaces on a
game's first paste, when `games.score_spec IS NULL`). Once a spec exists, only an admin
(`isAdminUser`) may overwrite it — `PUT /:id/score-spec` 403s a non-admin re-teach — so a
stranger can't silently repoison a shared rule a teammate already fixed (it's the one write
surface that mutates a global catalog row). Registry games stay read-only for everyone. Every
successful teach appends a `game_spec_revisions` row (same transaction: `taught_by`, both
specs, direction, `example_raw`) and pings `#workshop-admin` (`score_spec_taught` in
`opsNotifications.ts`). Revert a poisoned config by copying the prior revision's values back
onto `games`, then `scripts/rescore-game.ts`. If you add another path that writes
`games.score_spec` / `summary_spec` / `score_direction`, write the revision row there too and
apply the same first-teach-vs-admin-reteach gate. The client mirrors the gate: admins get a
"Re-teach scoring" entry in a game's kebab menu (`GamesHome`) + the teach chips even when a
spec exists (`canReteach` on `GameScorePasteSheet`); non-admins only see chips on first paste.

A leaderboard item's `game_id` was set by migrations 0027/0029 for historical rows and
still self-heals on item create/edit (`routes/v1/items.ts`). Daily-game scores are now
**Games-only** (`/v1/games/:id/scores`): the legacy Lists-side score bridge
(`/v1/items/:id/scores` + `/v1/lists/:id/scores`, the old `routes/v1/scores.ts`) and its
structured-log monitoring (`lib/legacyGameLists.ts`, the `legacy_game_list_access` /
`legacy_game_list_retired_rejected` events) were **removed** once prod usage hit zero — see
`docs/legacy-games-cleanup-audit.md`. New leaderboard-list creation stays blocked: list
create/duplicate/config changes that introduce `leaderboard` or old `item_kind='game'` get a
400 `legacy_game_lists_retired` (`isRetiredGameListConfig` in `routes/v1/lists.ts`), and the
lone legacy "Geo games" row is hidden from `GET /v1/lists`. The legacy `item_scores` table
was **dropped** (migration `0038`, applied to prod) once it was proven 100% mirrored into
`game_scores`; `rescore-game.ts` now operates on `game_scores` only.
**Changing a game's scoring rule only fixes new posts** unless you also run
`scripts/rescore-game.ts` (`--game-key=<key>` / `--game-id=<uuid>` / `--all`; `--dry` first)
— it replays the current parser over stored `score_raw` in both `game_scores` and legacy
`item_scores`, importing the real parser so it can't drift. The client mirrors the same
distillation for _display_: Games standings rows and the Games clipboard recap render through
`summarizeGameScoreBody` in `apps/highscore/src/games/lib/scoresSummary.ts` (formatters live on the
registry), which strips URLs/headers so a URL-only share shows "Played", never the raw link;
Games recaps append a **play link** (`/g/:token`, see `game_share_links` below), not a
friend-invite or list link. The paste sheet previews the parse client-side
(`apps/highscore/src/games/lib/scoreSpecs.ts` mirrors the backend chain) — keep the two chains in
sync. Workshop's `src/legacyGames` versions are frozen snapshots, not the live mirror.

## Game code sandbox (`lib/gameCode/`) — stored JS runs in QuickJS, in a worker thread

The runtime for per-game `parse(raw)` / `format(raw)` code stored in the DB. The code is
untrusted (LLM-written from pasted text, or operator-written). Call it only through
`lib/gameCode/runtime.ts` (`runParse`, `runFormat`, `validateCode`) — those never throw or
reject for anything the code does and always settle within a bounded time. The contract the
stored code must satisfy, every limit, and the measured latency are in
`lib/gameCode/README.md`; the teach prompt is written from that file, so keep it exact.

- **Parse is tri-state and the three must stay distinct**: `score` (a number), `noResult`
  (`parse` returned `null` — a legitimate loss), `failed` (threw, timed out, returned
  anything else). Never collapse `noResult` and `failed` into one null, and never add a
  "first number in the text" fallback.
- **Two timers.** An instruction budget inside QuickJS (deterministic; stops loops and regex
  backtracking in 10–70 ms) and a 250 ms wall clock enforced by **killing the worker
  thread**, because QuickJS built-ins (`indexOf`, `repeat`) never yield to the interrupt
  handler. Don't move execution onto the request thread: an in-thread run cannot be stopped.
- **Fresh runtime + context per run, no host functions, input passed as a value.** If you
  ever expose a host function to the VM, that function is the new attack surface.
- **The stack limit is two numbers sized together** (`STACK_LIMIT_BYTES`, `WORKER_STACK_MB`
  in `limits.ts`). QuickJS's cap can't see the native stack its parser and `JSON.parse`
  recurse on; on Node's default 4 MB worker stack, source nested to the code-size cap trapped
  the WASM module and cost a worker restart per hit. The worker gets 64 MB, and the prelude
  removes `eval` and the function constructors so depth stays bounded by `MAX_CODE_CHARS`.
  Raising the code cap, or giving stored code a way to compile source, means re-measuring.
- **`sandbox_unavailable` is about the sandbox, never the code.** `validateCode` returns
  `unavailable: true` for it instead of a mismatch; anything that gates on validation must
  retry or fail soft on that, not reject the code.
- **The sandbox is its own bundle file.** `scripts/bundle.mjs` emits
  `dist/gameCodeWorker.cjs` (QuickJS WASM embedded, ~890 KB) beside `lambda.js` and tells
  `runtime.ts` where it is through an esbuild `define`; from source (tsx, vitest) `runtime.ts`
  bundles the worker in memory with esbuild instead. `bundle.test.ts` runs the real bundler
  and executes a job in the output, so a broken worker build fails CI, not a deploy.
- **QuickJS is compiled with `--liftoff-only`** (set process-wide in `loadQuickJS`). With
  V8's default WASM tiering the first run after a cold start took ~410 ms on a throttled
  Lambda, past the kill timer. Re-run `scripts/bench-game-code.mjs` (see its header for the
  Lambda-like docker invocation) after changing a limit or the Node runtime.

### Where the code lives: `games.parse_code` / `format_code`, versioned

- **The database is the source of truth.** `games.parse_code`, `games.format_code` and
  `games.code_version` hold what runs; every write appends a `game_code_revisions` row
  (`version`, both code blocks, `source` = `seed` | `spec` | `operator` | `teach`,
  `authored_by`, `note`, the `examples` it was validated against). Revert = write the
  previous version's code back as a new version. `parse_code IS NULL` means untaught: its
  scores are `failed` (reason `no_code`), never a guessed number.
- **`lib/gameCode/builtin.ts` is the seed, not the source of truth.** It holds the registry
  games' `spec` + `formatShareBody` ported to stored code; migration `0043` (generated from
  it by `scripts/generate-game-code-seed.ts`, pinned by `seed.test.ts`) installed it. Editing
  it after `0043` has shipped fails that test on purpose — change a game in the DB, or write a
  new migration. `builtin.parity.test.ts` checks every fixture in the legacy parser/formatter
  test files against the registry, so adding a fixture there tests the stored code too.
- **Taught specs become code through `lib/gameCode/specCode.ts`**: `var SPEC = <json>;` plus
  a fixed interpreter. `0043` builds the same text in SQL for specs taught before it. If you
  change an interpreter, existing rows keep the old text (they are data now).
- **A registry game has its code from the moment its row exists.** Rows that existed when
  `0043` ran were seeded by it; every row created later goes through `findOrCreateGame`,
  which writes `builtinGameCodeFor(...)` and a `seed` revision in the same transaction. The
  one path that bypasses it is a catalog-row migration (the `0036` shape, a raw `INSERT`):
  that migration must set `parse_code` / `format_code` / `code_version = 1` and insert the
  `game_code_revisions` row itself (copy a statement pair from `0043`), and the game needs an
  entry in `builtin.ts`.
- **`game_scores.parse_status`** (`score` | `no_result` | `failed`, CHECK-constrained),
  **`score_summary`**, **`code_version`** and **`score_source`** (`parsed` | `picked`,
  CHECK-constrained; nothing writes `picked` yet — it is for the correction flow in
  `docs/highscore-score-validation-spec.md`) record what the code made of each row at upload.
  All NULL = written by the legacy parser; `score_value` NULL then means "loss or unread",
  indistinguishably. `lib/gameCode/scoring.ts` (`scoreWithGameCode`) is the one function that
  turns sandbox results into those three values — use it, don't re-derive them.
- **Re-check against real data before changing a game's code:**
  `EVAL_DATABASE_URL=<read-only prod/branch url> pnpm --filter @workshop/backend exec tsx
scripts/compare-game-code.ts --examples=3` prints, per game, legacy parser vs stored code
  and legacy display text vs new summary, with every class of difference. The sandbox's
  local Postgres is the dev seed (6 scores), not prod — use `--snapshot` / `--save-snapshot`
  with a read-only export, and keep the snapshot (real users' text) out of the repo.

## Migration journal `when` values must be monotonic

The drizzle migrator records each migration's journal `when` as `created_at` and only
applies migrations whose `when` exceeds the newest applied `created_at`. Migration 0031
shipped with a hand-mangled future `when` (1781590000000 = 2026-06-16), which silently
blocked every later migration on any DB that had applied it; the journal entry was
corrected and `src/db/migrate.ts` carries a one-time fixup that rewrites the recorded row
(delete it once prod has run it). If you ever hand-edit `drizzle/meta/_journal.json`, keep
`when` strictly increasing and never in the future.

## `leaderboard` implies `ordered` bucketing in `items.ts` (even without `ranking`)

> Note: the Lists-side reorderable game card (`GameLeaderboardCard`) was removed with the
> Games migration, so no live client surface drives this anymore — only the hidden legacy
> "Geo games" row still carries the `leaderboard` module. The `items.ts` bucketing below is
> kept so that row stays coherent; don't build new behavior on it.

A leaderboard's games bucket as an ordered list. Three spots in `routes/v1/items.ts` enforce
this so it doesn't depend on the `ranking` module being present:

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

The per-user watchlist cache write must stay schema-aware. A raw
`INSERT INTO letterboxd_watchlist_films ... VALUES ${sql.join(...)}` looked fine in unit tests
but failed in prod on large public watchlists after the scrape had already succeeded
(`ERR_INVALID_ARG_TYPE` from postgres-js during the first 200-row bind), surfacing to the client
as a generic `/v1/users/me/letterboxd` 500. Use Drizzle `.insert(letterboxdWatchlistFilms)`
chunks inside the existing transaction so timestamp/text/null encoders stay attached and a failed
refresh cannot leave the cache half-cleared.

## Profile pictures live inline on `users.avatar_url` (base64 data URL)

`PATCH /v1/users/me` (`routes/v1/users.ts`) updates `displayName` and/or `avatarUrl`
independently — both optional, send only what changed; `avatarUrl: null` clears the
picture; an empty body 400s. The avatar is stored as a base64 `data:` URL (same approach
as list `cover_photo_url` — no object store yet), capped + raster-only by `avatarUrlSchema`
(reused shape from `coverPhotoUrlSchema`). `toUserShape` is duplicated in `users.ts` **and**
`auth.ts` — add new user fields to both. **Do not join `avatarUrl` into leaderboard /
activity / member payloads**: those fan out across many users and inlining ~1MB base64 per
row would bloat responses. User-facing facepiles/leaderboards should point `Avatar` at
`GET /v1/users/:id/avatar` (public image response, 404 = initials fallback) until avatars move
to a real URL/CDN store.

## Games surface is canonical for daily-game scores

The Games tab (spec §3, G1a) has its own tables — `games` (global catalog, deduped by
`normalized_url` via `normalizeGameUrl` from `@workshop/shared/games`), `user_games`
(per-user ordered selection), `game_scores` (`(game_id,user_id,period_key)` PK). The Games
router still owns only those tables directly, but leaderboard-list items can point at the
same `games` row through `items.game_id`; the list score routes translate legacy `item_id`
requests into canonical `game_scores` reads/writes and return the old response shape keyed by
item id. Shared helpers live in `lib/gameCatalog.ts` (URL normalization, registry lookup,
parser) and `lib/userGames.ts` (idempotently add to My Games). The catalog seed lives in
migrations `0023`/`0031`/`0032` and must stay in sync with the shared registry's
`CATALOG_GAME_DEFINITIONS` (each entry's `title`/`canonicalUrl`); `games.test.ts` enforces it. Every `games` row carries an
`icon_url` (the Games tab card thumbnail): `findOrCreateGame` sets it at insert — preview
favicon when the caller passes hints (POST `/v1/games` wires `resolveLinkPreview` as a lazy
provider, awaited only when a row is actually created), Google s2 favicon otherwise — and
unknown games prefer the preview's page title (via `cleanGameTitle`) over the hostname.
Migration `0028` backfilled s2 favicons for pre-existing rows;
`scripts/backfill-game-metadata.ts` upgrades rows to real favicons / preview titles and is
safe to re-run. Routes are flag-gated **inside
the router** (404 when off): on when `STAGE=local`, otherwise requires `ENABLE_GAMES=1` in
the Lambda env (set by Terraform). Standings cover `viewer ∪ friends_of(viewer)` via
`visibleUserIds()` (G2a) — the friend graph lives in `friendships` (one canonical row per
pair, `user_low < user_high`; `lib/friends.ts` is the only writer and owns the invariant)
with invites in `friend_requests` (`routes/v1/friends.ts`, same flag gate as
games). **Two row shapes share `friend_requests`, discriminated by `invitee_id`**: share-link
invites (`invitee_id IS NULL`, `token` set) and directed user-to-user requests (`invitee_id`
set, `token` NULL). Share links stay **reusable, not single-use**: anyone who opens
`/friends/accept/:token` can accept and form an edge, any number of times — the `friendships`
table is the source of truth and the insert is idempotent. `POST /v1/friends/invite` returns
one stable link per inviter (reuses the oldest `invitee_id IS NULL` row — keep that filter on
any query that touches link rows); `POST /v1/friends/invite/reset` rotates the slug on that
one row (mirrors `POST /v1/lists/:id/share/reset` via the shared `isUniqueViolation` in
`lib/pgErrors.ts`), invalidating the old URL (preview + accept 404) and minting a fresh one —
it only touches the oldest/canonical link row, so legacy multi-row users don't self-collide.
Directed requests (mutuals / profile flow) exist **only while pending**: accept (`POST
/v1/friends/requests/user/:userId/accept`, or accepting the sender's share link, or a
cross-request via `POST /v1/friends/requests`) forms the edge and deletes the row; `DELETE
/v1/friends/requests/user/:userId` is both cancel and silent deny (re-requesting is allowed).
A partial unique index keeps one pending row per (inviter, invitee); the legacy `status` /
`responded_at` columns stay at defaults. `GET /v1/friends/mutuals` is a two-hop walk over
`friendships` computed in app code, and `GET /v1/friends/users/:userId` 404s when the viewer
has no relationship AND no mutual friends with the target (profiles can't probe strangers) —
**unless** the request carries `?via=<token>`, a valid play link (`game_share_links`) for the
target, which vouches the viewer in so a play-link recipient can see who they are and add them;
it attaches the target's games + period scores only for friends/self.
`GET /v1/games/discovery` (friends' games, ranked by how many friends play each) is
registered **before** the `/:id` routes so the literal path isn't shadowed; its `?friend=`
filter 404s for non-friends so the endpoint can't be used to probe a stranger's games. The
default feed omits games I already added; `?includeOwned=1` keeps them in the list (tagged
`inMyGames`, rendered non-addable client-side, sorted after every addable game) so the +
add-game sheet shows the full "what my friends play" picture instead of an empty section
when I already play everything my friends do. All ranking reads `user_games` (people's lists), never scores. `games.test.ts` and
`scores.integration.test.ts` run actual `drizzle/` migrations against in-memory PGlite
(`@electric-sql/pglite`) with `getDb` mocked — copy that pattern when a route's acceptance
criteria are DB behaviors, not just schema validation.

**Play links (`game_share_links`, `routes/v1/gameShare.ts`)** are the Games-tab copy-scores
CTA — a per-(user, UTC-day) short link (`/g/:token`). Mounted at `/v1/game-share` (a
**distinct** path, not `/v1/games/...`, so it doesn't inherit `gameRoutes`' blanket
`requireAuth` — the resolve must serve link crawlers). `POST /v1/game-share` mints/reuses my
link for today (idempotent via the `(user_id, date_key)` unique index; old days' tokens keep
resolving). `GET /v1/game-share/:token` is **optional-auth** (`optionalAuth` in
`middleware/auth.ts`): a crawler / signed-out request gets just `{ user }` for the OG card; a
signed-in request also gets `{ viewer: { isSelf, isFriend } }`, which the in-app `/g/:token`
resolver uses to route (already-connected → Games home, else → the sharer's profile via the
`?via=` vouch above). Unlike `friend_requests` share links this is **not** an accept surface —
opening a play link never forms an edge. Helpers: `lib/gameShareLinks.ts`
(`findOrCreateGameShareLink` / `resolveGameShareLink`); same games flag gate; OG card +
`/g/:token` Pages function live in `functions/`. Tests: `gameShare.test.ts` (PGlite).

**Emoji reactions on scores (G2c)** live in `game_score_reactions`
(`(game_id, period_key, score_user_id, reactor_user_id)` PK — one reaction per reactor per
score, tapback-style; re-reacting upserts the emoji). A composite FK to `game_scores` keeps a
reaction from outliving the score it decorates. `PUT /v1/games/:id/reactions/:periodKey/:scoreUserId`
sets/replaces, `DELETE` clears — both echo the score's full reaction summary. The setter gates
on `friendsOf(viewer)` (a non-friend / missing score both 404, so it can't probe a stranger)
and rejects reacting to your own score. **Reactions are attached to every standings entry by
`loadStandingsByGame`** (so both `GET /v1/games` and `/leaderboard` carry them), and the
reactor set is gated to `visibleUserIds(viewer)` exactly like the scores — a non-mutual
friend's reaction on a shared friend's score never reveals who they are. The emoji string is
validated by `isReactionEmoji` (`@workshop/shared/games`). When you add a new code path that
builds `GameStandingsEntry`, populate `reactions` (it's a required field now).

## Game-score recognition (`lib/gameRecognition.ts`) — which game is this paste for?

`recognizeGame(raw, candidates, { loadExamples, judge })` → `{ gameId, confidence, method } | null`.
Nothing is taught: every stored `game_scores.score_raw` is a labelled example of its game, so a
user-added game is recognizable from its first score. Evidence runs cheapest-first and stops at the
first answer: **url** (the text contains the game's host/path) → **label** (its title, or the name a
wholly-owned domain carries) → **fingerprint** (the tokens most of its stored examples share,
digit-blind and order-blind; needs ≥3 examples) → **jev** (one TypeSafe Choice over a
fingerprint-ranked shortlist of 8 plus "none", `lib/jev.ts`). The module is pure — the Jev call and
the example loader are injected — so the eval harness, the endpoint and the shadow log run the same
code; `lib/gameRecognitionService.ts` adds the DB side (candidates = My Games + catalog games the
text names; examples = the 20 most recent distinct usable scores, any player's).

- **Its queries must stay index-bounded — it runs on every score post in shadow mode.**
  Candidates are two probes: `user_games` by user, and `games` by exact `normalized_url` for the
  URLs the text links (`gameUrlKeysIn`) plus the registry games it names. Examples are one
  `LIMIT`ed backward scan per game on the existing `game_scores (game_id, period_key)` index
  ("recent" = latest puzzle day, which is why no `created_at` index was added). Never filter
  `games` by an expression on title/url or window over a game's whole score history: at 20k games
  / 1.2M scores those cost 5 ms and 840 ms per post.
- **Everything runs inside a time budget** (`SHADOW_BUDGET_MS` = 400 on a score post, 2.5 s on the
  endpoint). Each DB step runs in a transaction with `SET LOCAL statement_timeout` (150 ms), so a
  stuck query is cancelled by Postgres and settles instead of being abandoned on the container's
  one connection; Jev gets whatever time is left; a final `Promise.race` cap logs
  `outcome: "capped"` for the one case those can't reach (a socket that stops answering). PGlite
  does not enforce `statement_timeout`, so the tests exercise the cap, not the cancel.

- **Games beta accounts get it regardless of the flag.** `lib/gamesBeta.ts` hardcodes a short
  allowlist of `users.id`s (ids only — no emails or names in code) and `isGamesBetaUser(userId)`;
  it is deliberately not recognition-specific, so gate other pre-release Games features on it
  too. Hardcoded because an env-var list would have to travel through Terraform. The mode in
  force for a user is `recognitionModeFor(userId)` — `on` for beta accounts, else the global
  flag — and every gate reads that, never `getConfig().gameRecognition`. Pass `c.get("userId")`:
  during an admin impersonation that is the impersonated account, so the admin sees what that
  user sees. `GET /v1/games` reports the result as `capabilities.recognition`; clients read
  that instead of probing the endpoint, so a caller without the feature never requests it.
- **Flag: `GAME_RECOGNITION` = `off` (default) | `shadow` | `on`** (`var.game_recognition` in
  Terraform) is the mode for everyone else. `shadow` logs one `kind: "game_recognition_shadow"` line per score post — predicted vs
  the game the user chose, `outcome: agree | disagree | none` — and changes nothing; `on` also
  serves `POST /v1/games/recognize` (404 otherwise), which returns a match only at or above
  `RECOGNITION_SURFACE_THRESHOLD`. Query shadow results with
  `./scripts/logs.sh --filter game_recognition_shadow`.
- **It must never make posting depend on Jev.** `lib/jev.ts` is one attempt with a 1.5s timeout and
  returns null on any failure; every caller treats null as "no detection". Don't add retries, and
  don't swap in `@typesafe-ai/sdk` without overriding its 10s × 3-attempt default.
- **Re-measure before changing a threshold, the prompt or the Jev model**
  (`JEV_MODEL` is pinned on purpose):
  `EVAL_DATABASE_URL=<read-only prod/branch url> pnpm --filter @workshop/backend exec tsx scripts/eval-game-recognition.ts`.
  It opens the DB read-only, holds each stored score out, and prints precision/recall per method,
  the threshold curve, confusable pairs, and Jev latency/cost. `--save-snapshot` / `--snapshot`
  reuse one export; the snapshot is real users' score text — keep it out of the repo.
- **Known limit:** sister games with one layout (GeoSports / GeoHistory) are only separable by name
  or link. A paste with both stripped is genuinely ambiguous and Jev will pick one confidently.
  `linksElsewhere` rejects a pick when the text links a site that game's shares never carry.
- **Examples are any player's scores, including players the caller has blocked.** They are sent
  to Jev as examples and never returned to the caller, so the block rules don't apply — but if
  examples ever become visible to users, filter with `blockedEitherWay` first.
- **A catalog game outside My Games is matched by its link always, by its name only if it is a
  registry game** (`catalogGameNamedBy`). Titles of user-added games are user-controlled; one named
  "Final Score" must not claim everyone's MapTap pastes.

## `GameStandings.viewerStreak` — the Games-home streak flame

`GameStandings` carries `viewerStreak` (required): the viewer's consecutive-day play streak
for that game **as of `periodKey`**, computed by `loadViewerStreaksByGame` in `routes/v1/games.ts`
and only populated by `GET /v1/games` (the per-game `/leaderboard` doesn't build a
`GameStandings`, so it doesn't carry one). The math is the pure `computeGameStreak` in
`@workshop/shared/games`: a run only counts as "live" when the latest play is `periodKey` or
the day before — so a streak that reached yesterday but isn't continued today still counts
(that's the "play today to keep it" nudge), but a full-day gap resets it to 0. The query is
bounded by `STREAK_LOOKBACK_DAYS` (a longer real streak reports as the window length — fine for
a nudge). The client shows a 🔥 flame next to the title once it hits `STREAK_MIN_DAYS` (2). When
you add a new path that builds `GameStandings`, set `viewerStreak` (it's required) — usually
`loadViewerStreaksByGame(...).get(gameId) ?? 0`.

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
`packages/api-client/src/api.ts`. When allowing a new web origin, add it to
`STATIC_ALLOWED_ORIGINS` (or `ALLOWED_ORIGIN_PATTERNS` for wildcards) in `src/app.ts`.
**Never** widen to `*` with `credentials: true` — that reflects every origin and
defeats CORS as a defense against cross-site reads.

HighScore's entries (`https://highscore.live` + the `highscore(-<suffix>)?.pages.dev`
patterns) are pre-landed and inert until the client exists. The Pages project name isn't
chosen yet, so the pattern tolerates an optional suffix — **pin it to the exact project
once OP-7 creates it**, since `*.pages.dev` names are globally unique across Cloudflare
accounts and the tolerant form could match a stranger's similarly-named project.

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

**The four OAuth audience vars are comma-separated lists.** `APPLE_BUNDLE_ID` /
`APPLE_SERVICES_ID` / `GOOGLE_IOS_CLIENT_ID` / `GOOGLE_WEB_CLIENT_ID` all run through the
`csv` transform (trim, drop empties, de-dupe), so one backend can verify sign-in tokens
issued to more than one client app — Workshop (`dev.josh.workshop`) plus HighScore. A
single value with no comma yields a one-element list, i.e. unchanged behavior. Consume
them through `appleAudiences()` / `googleAudiences()` (never the raw config field) and
pass the whole array to `verifyIdentityToken`, which accepts a token whose `aud` matches
any entry. Adding an audience is an ops action — `aws ssm put-parameter --overwrite` +
Lambda env refresh — not a code or Terraform change.

## Lambda bundling

- `src/lambda.ts` is the handler — bundled by `scripts/bundle.mjs` (esbuild) into a
  single file.
- AWS SDK v3 is marked `external` (provided by the Lambda runtime) to shrink the zip.
- `postgres` (the pg driver) is bundled because there's no built-in.
- A second entry, `dist/gameCodeWorker.cjs`, is the game-code sandbox's worker thread (see
  "Game code sandbox" above). It is loaded lazily on first use, so it adds nothing to init.
- The build shells out to `zip`; the Niteshift sandbox image doesn't ship it
  (`apt-get install -y zip`). `--out-dir=<dir> --no-zip` builds without it.
- Cold start ~300–500ms for a bundled Node.js 20 Hono handler.

## Discord operator notifications are observable — grep the logs first

`notifyDiscord` (`src/lib/discord.ts`) logs **every** outcome, so "a `#workshop-admin`
message is missing" is triageable from CloudWatch without guessing. An event emits its
call-site line — `new signup` / `sign-in` (`routes/v1/auth.ts`), or nothing extra for a
new list — then one of: `discord notify sent` (delivered), `discord notify non-2xx` /
`discord notify threw` (Discord rejected — auto-retried once on 429/5xx/network), or
`discord notify skipped: webhook not configured` (the `DISCORD_NOTIFY_WEBHOOK_URL` Lambda
env is empty). **Every sign-in pings** (`notifySignIn`): a genuinely new user
(`createdUser: true`) emits `new signup` + the `👋` / `kind: "signup"` message, a
returning user (incl. a known email linking a second provider, `createdUser: false`) emits
`sign-in` + the `👤` / `kind: "signin"` message. The dev auth route
(`/v1/auth/dev`) is deliberately silent — it's the sandbox/E2E auto-sign-in. **Every admin
impersonation start pings** (`kind: "impersonation"`); the signed session stores
`impersonatorUserId`, `/v1/auth/me` reflects it, and `/v1/auth/impersonation/stop` mints a
normal original-account session again. **Every list made pings** (`notifyNewList`): the create path
(`kind: "new_list"`) and the duplicate path (`kind: "new_list_duplicate"`). So "no message"
means the event didn't happen (or the webhook is unset) — cross-check the `users` / `lists`
tables before assuming a delivery bug.

**The broader ops-observability pings live in `src/lib/opsNotifications.ts`** — one catalog
of pure `build*Notification()` builders (unit-tested in `opsNotifications.test.ts`, no DB /
Discord) plus thin async `notify*` wrappers that resolve human labels and call
`notifyDiscord`. Every wrapper routes through `safeNotify`, which swallows + logs failures so
a missing/failed ping can never break the user action that triggered it (the action has
already committed by the time we ping). **Delivery is awaited, not fire-and-forget** — the
Lambda freezes its container the moment the (buffered) response resolves, so an unawaited POST
would be paused mid-flight and dropped when the container is reaped (see `discord.ts` header).
`safeNotify` short-circuits the moment it sees no webhook (`opsNotificationsEnabled()`),
**before** resolving any labels, so an unconfigured env (local dev) pays nothing. Callers that
do notification-only DB work gate it on the same check — see the `opsNotificationsEnabled() &&
userHasAnyScore(...)` guard on the hot score paths, which skips the existence query entirely
when no webhook is set. Tiers + kinds:

- **Social graph**: `friend_request` (directed request sent — only on a _fresh_ pending row),
  `friend_added` (any new edge — directed accept, invite-link accept, or mutual auto-accept;
  gated on `addFriendship` returning `true` so re-accepts don't spam), `list_joined`
  (share-link or legacy-invite join — gated on `newlyJoined` so re-hits don't re-ping).
- **Activation**: `first_score` (first-ever score, item or game path — `userHasAnyScore` is
  checked **before** the upsert, spanning both `game_scores` and the legacy `item_scores`, and
  only when a webhook is configured), `letterboxd_connected`, `game_added` (gated on
  `addToMyGames` returning `created: true`).
- **Ops/safety**: `sessions_revoked` (sign-out-all), `list_archived`, `ownership_transferred`,
  `source_webhook` (verified inbound webhook — scaffolding surface, no traffic yet).
  When you add a new gated-by-newness ping, return a created/newly-X boolean from the writer
  (see `addFriendship` / `addToMyGames`) rather than re-querying — and add a builder + test here.

**Every ping ends with the requesting client — `· HighScore · iOS 1.4.0`.** `notifyDiscord`
appends `describeRequestClient()` (`src/lib/requestContext.ts`), which reads
`X-Workshop-Client` / `X-Workshop-Platform` / `X-Workshop-App-Version` off an
`AsyncLocalStorage` store that the `requestLog` middleware enters for the lifetime of each
request — so `notify*` wrappers deep in `opsNotifications.ts` need no `c` threaded through.
A request with none of the three headers (inbound source webhooks, curl, crawlers) gets no
suffix; a pre-header client shows `unknown app`. Pass `withClient: false` for a message with
no human client behind it. If you spawn work outside the request's async chain
(`setTimeout`, a detached promise), the store is gone — resolve the label first.

**Use real Unicode emoji in ping text, never Discord `:shortcodes:`.** Discord renders
`:wave:` in-app but the iOS push notification preview shows the literal `:wave:` text.

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
