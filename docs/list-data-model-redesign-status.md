# List data model redesign — status

Companion to `docs/list-data-model-redesign.md` (the design spec). This doc tracks **what
shipped, what's tech debt, and what's still on the spec but not yet built.** Read top-down to
get the state in one pass; jump to a section heading to find the open work in your area.

**Last updated:** 2026-05-18. Shipping history:

- [#199](https://github.com/joshlebed/workshop/pull/199) — the core big-bang. Schema
  redesign (modules + item_kind + content + position), `list_sources` + `item_scores`
  tables, shared registries, every backend route on the new shape, the template picker, the
  module-toggle settings sheet.
- [#211](https://github.com/joshlebed/workshop/pull/211) — week-one follow-up. Backend
  route tests restored on the new shape; PR-F (Letterboxd source kind: scrape + TMDB
  enrichment + `letterboxd_watchlist` template); `dedupField` lifted into the item-kind
  manifest; source dispatch generalized via `lib/sources/registry.ts`; migration 0015
  dropping the legacy `lists.type` / `lists.metadata` / `items.type` / `items.metadata`
  columns + `game_scores` + `list_type` enum.
- [#213](https://github.com/joshlebed/workshop/pull/213) — cleanup + tier-3 scaffolding.
  `ActivityEventType` union trimmed; `/v1/album-shelf/preview` and `POST /v1/lists/:id/refresh`
  legacy aliases removed; `formatConfigWarning` pretty copy in the settings sheet;
  per-source secrets envelope (`secrets jsonb` + AES-256-GCM); webhook inbound route
  scaffolding (`webhook_slug` + signature verifier registry); scheduled-sync worker
  (`sync_schedule` + `runScheduledSyncTick`); rebalance overflow trigger; three reserved
  modules (`scheduling` / `comments` / `attachments`) with manifests + gate copy + "coming
  soon" labels; lib unit tests for `positions` / `moduleGate` / `moduleManifests` /
  `permissions` / `modules`.

**Quick links:** the design spec is at [`docs/list-data-model-redesign.md`](./list-data-model-redesign.md);
the punch list for the next contributor is §5 below.

## Status one-liner

The core redesign is **done.** Lists carry `modules` and `item_kind`, items carry
`kind` / `content` / `position`, sources are first-class with two consumers (Spotify +
Letterboxd) proving the registry pattern, leaderboards generalize via `item_scores`, the
template picker replaces the type picker, all legacy mobile-API aliases are gone, and the
deferred spec items have scaffolding waiting for a real consumer. What's left is
**product-pull work**: cron / webhook handlers for the first push-bearing source, UI for the
three reserved modules, and a handful of small polish items (see §5).

---

## 1. Shipped in #199

### Schema (migration 0014)

- ✅ `lists.modules text[]` (NOT NULL, default `{}`)
- ✅ `lists.item_kind text` (nullable)
- ✅ `items.kind text` (nullable through migration window; new writes always set it)
- ✅ `items.content jsonb` (NOT NULL, default `{}`)
- ✅ `items.position integer` (nullable; the new home for ordering)
- ✅ `list_sources` table (id, list_id, kind, config, last_synced_at, last_synced_by)
- ✅ `item_scores` table (item_id, user_id, period_key, score_value, score_raw)
- ✅ `activity_events.event_type` migrated `enum → text` (app-layer registry owns the set)
- ✅ Partial unique index on `(list_id, content->>'spotifyAlbumId') WHERE kind='spotify_album'`
- ✅ `items_list_position_idx` btree
- ✅ Backfill: every existing list/item migrated to the new shape in one transaction
- ✅ Activity events renamed in place: `album_shelf_refreshed → source_synced`,
  `album_shelf_source_changed → source_updated`, `album_promoted → item_promoted`,
  `album_demoted → item_demoted`
- ✅ `DROP TYPE activity_event_type` (column moved to text in the same tx)
- ✅ `game_scores` rows backfilled into `item_scores` (period_key ← date, score_raw ← score)

### Shared registries (`@workshop/shared/*` subpath exports)

- ✅ `itemKinds` — zod schemas for `movie`, `tv`, `book`, `link`, `spotify_album`, `plain` +
  `validateContent` + `assertItemFitsList`
- ✅ `sourceKinds` — manifest registry; `spotify_playlist` is the only entry today
- ✅ `modules` — `MODULE_NAMES`, `hasModule`, `normalizeModules`, warning code constants
- ✅ `templates` — 10 client-side templates (the legacy 7 + Voting Poll, Shared To-Do, Blank List)

### Backend

- ✅ `POST /v1/lists` — accepts `{ name, emoji, color, itemKind, modules, sources? }`
- ✅ `GET /v1/lists/:id` — returns `{ list, members, pendingInvites, sources }`
- ✅ `PATCH /v1/lists/:id` — itemKind tightening guard, modules-removal warning protocol,
  `acknowledgedWarnings` acknowledgement
- ✅ `POST /v1/lists/:id/config-preview` — module-removal warnings + item_kind tighten preview
- ✅ `POST /v1/lists/:id/duplicate` — deep copy with `preserveCompletion` / `copySources`
- ✅ `GET/POST/DELETE /v1/lists/:id/sources` + `POST /v1/lists/:id/sources/:id/sync`
- ✅ `POST /v1/sources/preview` (legacy `/v1/album-shelf/preview` kept as alias)
- ✅ `POST /v1/items/:id/move` — sparse-integer allocator + eager rebalance on collision
- ✅ `POST/DELETE /v1/items/:id/upvote` — previously not exposed; now consumed by the row menu
- ✅ `POST /v1/items/:id/{complete,uncomplete}` — gated on `todo` module
- ✅ `PUT/DELETE/GET /v1/items/:id/scores` + `GET /v1/lists/:id/scores` (replaces game-scores)
- ✅ `POST /v1/lists/:id/refresh` — legacy alias for `sources/:id/sync` so older mobile builds
  don't break
- ✅ Module-disabled writes return **409 with stable code** `<module>.disabled` (§5.1 contract)
- ✅ Permissions helper (`lib/permissions.ts`) + capability matrix from §5.2
- ✅ Module manifests (`lib/moduleManifests.ts`) with `inspectRemoval` warning hooks
- ✅ List/item read paths **strip module-gated fields** (`upvoteCount`, `completed*`, `position`)
  when the gating module is off — §5.1's "Listing endpoints omit module-gated fields"

### Client

- ✅ Create-list flow is a **template picker** (replaces the type picker)
- ✅ Settings sheet exposes raw module toggles + config-preview warning flow + Duplicate action
- ✅ ListDetail renders sections + chrome from `list.modules` / `list.itemKind`
- ✅ Drag-to-reorder talks to `/move`; optimistic update helper recomputes positions locally
- ✅ Spotify shelf preserves legacy affordance (body-press → Spotify, no Edit menu)
- ✅ Source sync chrome + "synced X ago by @Y" subline from `list_sources.last_synced_at`
- ✅ Activity feed renders new event types (`source_synced`, `module_enabled`, etc.) without
  changes — they fall through as generic event copy

### Verification

- ✅ `pnpm run typecheck` / `lint` / `test` (218/218 backend tests pass)
- ✅ Knip clean
- ✅ Migrate-smoke CI gate (fresh DB + idempotent re-run) passes
- ✅ Browser smoke against prod-shaped 7-list dataset: home + list-detail + create-list (Voting
  Poll) + album-shelf source sync all work

---

## 2. Tech debt taken on by #199

These are explicit tradeoffs the big-bang made. None of them block product; all can be retired
in small follow-up PRs.

### 2.1 ~~Old columns kept as nullable dead weight~~ — RETIRED in #211

Migration 0015 (#211) dropped `lists.type`, `lists.metadata`, `items.type`, `items.metadata`,
the `game_scores` table, and the `list_type` enum. Schema mirrors the live DB; no more
vestigial columns.

### 2.2 ~~Backend route tests deleted, not rewritten~~ — RETIRED in #211

#211 restored `items.test.ts`, `lists.test.ts`, `sources.test.ts`, `scores.test.ts`,
`duplicate.test.ts` on the new shape. #213 added lib unit tests for `positions`,
`moduleGate`, `moduleManifests`, `permissions`, and the new `modules.ts` helpers — covering
the DB-touching paths that the route tests don't exercise. 590 backend tests pass.

### 2.3 ~~Activity-event union still carries legacy values~~ — RETIRED in #213

Legacy values (`album_shelf_refreshed`, `album_shelf_source_changed`, `album_promoted`,
`album_demoted`, `item_deleted`) were dropped from `ActivityEventType` in #213. The
client-side renderer in `activity.tsx` and the home-screen verb map in `index.tsx` lost the
matching cases at the same time. Old rows had been renamed in place by the 0014 migration;
verify before merge with `SELECT DISTINCT event_type FROM activity_events;` on prod.

### 2.4 ~~`/v1/album-shelf/preview` legacy alias~~ — RETIRED in #213

`apps/backend/src/routes/v1/album-shelf.ts` deleted and its mount in `app.ts` removed. The
mobile client moved to `POST /v1/sources/preview` in #199.

### 2.5 ~~`POST /v1/lists/:id/refresh` legacy alias~~ — RETIRED in #213

The route handler in `lists.ts` is gone. The mobile client moved to
`POST /v1/lists/:id/sources/:sourceId/sync` in #199.

---

## 3. Spec items not yet built

These are open items from `docs/list-data-model-redesign.md` that are **deliberately not in
#199** — the spec called them out as future work or we scoped them out to ship.

### 3.1 ~~PR-F: Letterboxd source kind~~ — SHIPPED in #211

`letterboxd_list` source kind manifest + `lib/sources/letterboxdList.ts` (scrape + TMDB
enrichment) + `letterboxd_watchlist` template + the `dispatchFor(kind)` registry that
generalized the Spotify-only branches in `lists.ts` / `sources.ts`. Headline test:
`SOURCE_KINDS.letterboxd_list.producesItemKind === 'movie'` (not `letterboxd_film`).

### 3.2 ~~Module-removal warning UI on the client~~ — POLISHED in #213

Backend ships the warning contract; the settings sheet now renders per-code pretty copy via
`formatConfigWarning` in `@workshop/shared/modules`. The helper returns `{ headline, detail }`
per code with proper pluralization; unknown codes fall back to the server-authored message
(forward compatible). Test coverage in `packages/shared/src/modules.test.ts`.

Still deferred: full i18n layer (we're solo-dev English-only today) and the inline
"X completed items hidden" mini-banner on the list-detail screen when a module is re-enabled.

### 3.3 Bulk-convert items in a list (spec §6.4)

Out of scope per the spec ("A bulk 'convert all items in this list from X to Y' operation is
out of scope for v1"). Flag here only so it shows up in the inventory.

### 3.4 Item-kind conversion on individual items (spec §6.5)

Same — out of scope per the spec. A `[item_kind=movie]` list keeps its existing movie items
even when the user changes `item_kind` to `null`; the new items can be anything.

### 3.5 ~~Per-source secrets / OAuth-bearing sources~~ — SCAFFOLDED in #213

Migration 0016 adds `list_sources.secrets jsonb` (nullable). `lib/sources/secrets.ts` ships
`sealSecrets` / `openSecrets` — an AES-256-GCM envelope whose key is HKDF-derived from
`SESSION_SECRET` (domain-separated label). No source kind populates the column yet; the first
OAuth-bearing kind lands on top of this primitive. Test coverage in `secrets.test.ts`.

### 3.6 ~~Webhook / push-driven sources~~ — SCAFFOLDED in #213

Migration 0016 adds `list_sources.webhook_slug text` with a partial unique index.
`lib/sources/webhookSignature.ts` ships a generic HMAC-SHA-256 verifier and an empty
`WEBHOOK_VERIFIERS` registry; `POST /v1/sources/webhooks/:slug` is mounted unauthenticated (the
shared-secret signature is the auth) and dispatches to the kind's sync impl on verify. The
first push-bearing source kind registers a verifier and writes a `webhookSharedSecret` into
`secrets`.

### 3.7 ~~Scheduled source sync~~ — SCAFFOLDED in #213

Migration 0016 adds `list_sources.sync_schedule text` (interval encoded as seconds).
`lib/sources/scheduler.ts` ships `runScheduledSyncTick()` which selects elapsed sources and
re-syncs them via `dispatchFor`. Cron-rule wiring (Lambda EventBridge schedule + handler entry
point) is deferred until the first source row opts in.

### 3.8 ~~Negative-position rebalance trigger~~ — WIRED in #213

`moveItemPosition` now opportunistically rebalances when `MIN(position) < REBALANCE_FLOOR`
(-10⁹). The check is a single indexed MIN probe and amortizes across many moves before firing.
Tested via `shouldRebalanceForOverflow` in `positions.test.ts`.

### 3.9 ~~Per-item-kind dedup field declared in the registry~~ — PARTIALLY DONE in #211

`ITEM_KIND_DEDUP_FIELD` in `@workshop/shared/itemKinds` now declares the dedup field per kind
(`spotify_album → spotifyAlbumId`, `movie → tmdbId`). The partial unique indexes in
`schema.ts` are still hand-written — both reference the same field name as the manifest, but
they're not generated _from_ it. Lifting that last bit (a `schema.ts` factory that consumes
`ITEM_KIND_DEDUP_FIELD` and produces one `uniqueIndex` per entry) is mechanical and worth
~30 lines; do it when the third dedupping kind shows up.

### 3.10 ~~Module set extensions~~ — RESERVED SLOTS ADDED in #213

`scheduling`, `comments`, `attachments` are now in `MODULE_NAMES` with no-data
`inspectRemoval` manifests (disabling them is silent until the feature PR adds data), gate
copy in `moduleGate.ts`, and "coming soon" labels in the settings sheet. The feature surfaces
themselves (date pickers, comment threads, file attachments) still need their own PRs.

---

## 4. Inventory of decisions worth re-litigating

Decisions I made during the big-bang that future agents/humans may want to revisit. None of
them are obvious bugs — they're judgment calls where another answer would also be defensible.

### 4.1 `date_idea` / `trip` / `game` collapsed into `link` kind

Spec §3.1 calls for this collapse, and I implemented it. The semantic difference (a trip
itinerary vs a daily-game tracker) lives in **modules + template + section labels**, not in
the item kind. This is the right factoring per the spec but it means **section labels are now
kind-driven, not list-driven** (`ItemRow.tsx#UNORDERED_LABEL_BY_KIND`). Today a daily-game
list reads `link` items and shows "Up next" or "Tried" as section labels — slightly less
specific than the legacy "Backlog" / "Played" copy. If we want richer kind-driven labels per
template, the template ID would need to round-trip to the client which it currently doesn't.

### 4.2 Templates aren't persisted

Spec §7 is explicit: "The moment a list exists, its template ID is forgotten." I followed
this. Trade-off: there's no way to render "Hey, this looks like a Reading List" on a list
that was duplicated and modified, and there's no analytics axis on the template that seeded
the list. Spec §9.2 suggests deriving a best-match template from `(item_kind, modules)` at
render time if this turns out to be useful.

### 4.3 ~~Legacy event-type values still in the TS union~~ — RETIRED in #213

The union now lists only current values. Removed from §2.3 above.

### 4.4 `applyOptimisticMove` is purely client-side

Client recomputes plausible interim positions from neighbor IDs so the row doesn't snap while
the `/move` request is in flight. The server is the source of truth; the next `fetchItems`
invalidation replaces the optimistic value. This is the right shape but it means the optimistic
position can briefly disagree with the server's chosen position (different rebalance state).
Probably invisible; mentioned for completeness.

### 4.5 The home subline collapses kinds

`app/index.tsx#summaryLabel` shows "Links" for any `link` kind list. Movie lists show
"Movies", album shelves show "Album shelf", but trips, dates, and daily games all collapse
into "Links". Same trade-off as 4.1 — recoverable by reading the template ID if/when we
start round-tripping it.

### 4.6 ~~No PR-F (Letterboxd)~~ — RETIRED, shipped in #211

The source abstraction has two consumers (`spotify_playlist`, `letterboxd_list`) and the
registry pattern survived contact with the second. See §3.1.

### 4.7 ~~Backend route tests gone~~ — RETIRED, restored in #211 + #213

See §2.2.

---

## 5. What's left

The post-#199 plan landed across #199 (core), #211 (route tests, Letterboxd, drop legacy
columns), and #213 (cleanup + tier-3 scaffolding). Everything below is what's still open;
items are grouped by **what triggers the work** (product PR vs. ops PR vs. one-off polish)
rather than by spec section.

### 5.1 Wire up the deferred scaffolding when a consumer needs it

#213 added scaffolding for three spec items but didn't ship a consumer for any of them. Each
is **dead code** until the first feature pulls it in. **Don't activate them speculatively** —
the goal of landing them now was so the first consumer doesn't also have to do the plumbing.

| open item                                     | how to "finish" it                                                                                                                                                                                                                                           | trigger                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Scheduled-sync cron handler (§3.7)            | New Lambda handler that calls `runScheduledSyncTick()` from `lib/sources/scheduler.ts`. EventBridge rule in `infra/` firing every 5min. Settings UI to toggle a schedule on a `list_sources` row.                                                            | A user asks "can my Spotify shelf auto-refresh hourly?"                      |
| Webhook verifier + first push kind (§3.5–3.6) | Register an entry in `WEBHOOK_VERIFIERS` (`lib/sources/webhookSignature.ts`). Generate a `webhook_slug` at source-create time. Seal the shared secret via `sealSecrets` into `list_sources.secrets`. Hand the user the inbound URL.                          | A push-driven source kind shows up — RSS via WebSub, Trakt history, etc.     |
| OAuth-bearing source kind (§3.5)              | Persist refresh tokens via `sealSecrets` into `list_sources.secrets`. The first real reader is the kind's sync impl — it `openSecrets(source.secrets)` to get the refresh token.                                                                             | The first source kind needs per-user auth (e.g. private Letterboxd / Trakt). |
| Generalized dedup-index codegen (§3.9)        | `ITEM_KIND_DEDUP_FIELD` already declares the field per kind; the partial unique indexes in `schema.ts` are still hand-written. Replace with a factory that iterates the manifest. ~30 lines + a follow-up Drizzle migration when an additional kind opts in. | A third dedupping kind lands (e.g. `recipe`, `restaurant`).                  |

None of these have hard deadlines. The data model has the columns; the dispatch table is
ready; the helpers exist with tests. Each one is "wire a new consumer through plumbing that's
already covered."

### 5.2 Feature surfaces for the three reserved modules (§3.10)

`scheduling` / `comments` / `attachments` are in `MODULE_NAMES` with no-data manifests and
"coming soon" labels in settings. Each one is its own product PR shape:

- **`scheduling`** — per-item due date / reminder timeline. Needs a `due_at` column on
  `items` (or a sibling table for richer recurrences), a date-picker UI, push notifications
  on the iOS app. The `inspectRemoval` manifest in `moduleManifests.ts` tightens to count
  scheduled items.
- **`comments`** — threaded discussion per item. New `item_comments` table (probably
  `(id, item_id, author_id, parent_comment_id, body, created_at, edited_at, archived_at)`),
  thread UI on the item-detail screen, activity events. `inspectRemoval` counts the threads.
- **`attachments`** — files attached to items. Needs S3 (we don't have buckets yet — would
  be a Terraform addition), a presigned-URL upload flow, MIME-type validation, thumbnail
  generation for images. The biggest of the three.

Order them by perceived value to the actual product (it's a personal monorepo — pick the one
you'd use most). Each is independent.

### 5.3 Small polish

These have no scaffolding waiting; they're standalone polish PRs against the shipped UX.

- **Re-enable mini-banner on list detail.** Spec §6 mentions "re-enabling restores data and
  the activity-feed attribution"; today's UX only surfaces the _removal_ warning (the
  `formatConfigWarning` sheet). Inline "3 completed items restored" toast or pill on the
  list-detail screen when a module is re-enabled would close that loop.
- **i18n for warning copy.** `formatConfigWarning` is English-only. The redirect to a
  translation layer is one chunk if it ever ships; until the app has a non-English
  audience, defer.
- **Section-label richness for `link` items (§4.1, §4.5).** A daily-game list (`link` +
  `leaderboard`) shows generic "Up next" / "Tried" instead of the legacy "Backlog" /
  "Played" copy. Same for the home-screen subline ("Links" for trips/dates/games). The
  recovery is to round-trip the template id from create-list through to render time — spec
  §9.2 sketches the deriving-from-`(item_kind, modules)` alternative if persistence is
  unwelcome.
- **iOS TestFlight smoke for #213.** #213 was developed web-only by an agent that can't run
  TestFlight. Risky surfaces to eyeball on the next build: activity-feed renderer (the
  union shrank), settings sheet (three new "coming soon" toggles + new warning UX),
  album-shelf list (the legacy `/refresh` button is gone — verify the new sync button
  works).

### 5.4 Explicitly out of scope per the spec

These were called out as out-of-v1 in the design doc and remain so unless product asks:

- **§3.3 / §6.4 Bulk-convert items in a list** — change every `kind=link` item to `kind=movie`
  in one operation. Would be its own endpoint + warning surface if it ever ships.
- **§3.4 / §6.5 Item-kind conversion on individual items** — users edit items individually
  or duplicate-and-strip. No bulk operation.

### 5.5 Nothing else

If you found yourself here looking for "what's left in the redesign," the honest answer is:
**nothing structural.** The core redesign is live; the second source kind proved out the
abstraction; the deferred items have scaffolding waiting for a consumer. Pick from §5.1
(plumbing-to-product) or §5.2 (new modules) based on what the app needs next. If neither, the
redesign is done.
