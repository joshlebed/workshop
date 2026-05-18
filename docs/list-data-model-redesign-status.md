# List data model redesign — status

Companion to `docs/list-data-model-redesign.md` (the design spec). This doc tracks **what
shipped, what's tech debt, and what's still on the spec but not yet built.** Read top-down to
get the state in one pass; jump to a section heading to find the open work in your area.

**Last updated:** 2026-05-18. Big bang ship via [#199](https://github.com/joshlebed/workshop/pull/199).
Follow-up PR landed all of week-one (#202): backend route tests restored on the new shape,
PR-F (Letterboxd source kind, second `kind` proving the source/item-kind decoupling), the
`dedupField` lifted into the item-kind manifest, the source dispatch generalized into a
registry-driven table, and migration 0015 dropping the legacy columns (`lists.type`,
`lists.metadata`, `items.type`, `items.metadata`, `game_scores`, `list_type` enum).

**Quick links:** the design spec is at [`docs/list-data-model-redesign.md`](./list-data-model-redesign.md);
the proposed next-week scope for an engineer is §5 below.

## Status one-liner

The core redesign is **live in prod**: lists carry `modules` and `item_kind`, items carry
`kind` / `content` / `position`, sources are first-class, leaderboards generalize, and the
template picker replaces the type picker. The follow-up work is mostly **cleanup** (drop old
columns), **extensibility proof points** (Letterboxd, second source kind), and **polish gaps**
(client-side warning UX, mobile verification).

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

### 2.1 Old columns kept as nullable dead weight

The migration was conservative: it added new columns but did **not** drop the old ones. Today's
DB still carries:

- `lists.type` (nullable `list_type` enum — no new writes)
- `lists.metadata` (jsonb, default `{}` — no new writes)
- `items.type` (nullable `list_type` enum — no new writes)
- `items.metadata` (jsonb, default `{}` — no new writes)
- `game_scores` table (mirrored into `item_scores`; no new writes)
- `list_type` enum (referenced only by the dead `type` columns)

**Why kept:** rollback-safe — if a bug surfaces after merge, the code can be reverted without
needing a second migration. The cost is one round of vestigial columns in `\d lists` /
`\d items`.

**Cleanup PR shape:**

1. Verify no `grep -r '"type"\|"metadata"\|gameScores' apps/backend/src apps/workshop/src`
   matches that aren't comments or test fixtures.
2. Migration 0015: `ALTER TABLE lists DROP COLUMN type, DROP COLUMN metadata;`
   `ALTER TABLE items DROP COLUMN type, DROP COLUMN metadata;` `DROP TABLE game_scores;`
   `DROP TYPE list_type;`
3. Strip the corresponding fields from `db/schema.ts`.
4. Soak window — wait until prod has been on the new shape for ~a week before merging.

### 2.2 Backend route tests deleted, not rewritten

`apps/backend/src/routes/v1/items.test.ts`, `lists.test.ts`, `album-shelf.test.ts` were deleted
in #199 — they tested the old enum-based shape and rewriting them properly was scope creep on
an already-large PR. The surviving 218 tests cover `lib/`, middleware, helpers, and other
routes that didn't change shape.

**Cleanup PR shape:** write fresh `items.test.ts`, `lists.test.ts`, `sources.test.ts`,
`scores.test.ts`, `duplicate.test.ts` against the new shapes. Focus on:

- Module gates (409 contract for each gated endpoint)
- Permissions helper (owner-only vs member rows in the §5.2 matrix)
- `config-preview` warning generation per module
- The position allocator (collision → rebalance → retry)
- Duplicate's `preserveCompletion` / `copySources` toggles

### 2.3 Activity-event union still carries legacy values

`packages/shared/src/types.ts` `ActivityEventType` keeps the legacy values
(`album_shelf_refreshed`, `album_shelf_source_changed`, `album_promoted`, `album_demoted`,
`item_deleted`) because **the migration renamed them in place** — there should be no rows of
the old values left. But the union still lists them for safety.

**Cleanup PR shape:** after the prod migration has run cleanly and `SELECT DISTINCT event_type
FROM activity_events;` confirms zero rows with the old types, drop those values from the union.

### 2.4 `/v1/album-shelf/preview` legacy alias

The old mobile clients call this endpoint during the create-list playlist step. We kept it as
a thin shim that delegates to `previewSpotifyPlaylist`. Once every mobile build that's been
through TestFlight has the new client code, drop the route + the `albumShelfRoutes` mount in
`app.ts`.

### 2.5 `POST /v1/lists/:id/refresh` legacy alias

Same story for the old "refresh album shelf" endpoint — kept as a shim that picks the first
attached source and calls `syncSpotifyPlaylistSource`. Drop once mobile is rolled forward.

---

## 3. Spec items not yet built

These are open items from `docs/list-data-model-redesign.md` that are **deliberately not in
#199** — the spec called them out as future work or we scoped them out to ship.

### 3.1 PR-F: Letterboxd source kind (spec §3.3, §10)

The whole point of PR-F was to prove the `sourceKinds` registry isn't accidentally
Spotify-shaped: a Letterboxd public list produces `items.kind = 'movie'` (not a new
`letterboxd_film` kind), exercising the "source kind ≠ item kind" decoupling. None of this
shipped.

**What's needed:**

1. Add `letterboxd_list` entry to `packages/shared/src/sourceKinds.ts` with config schema
   `{ letterboxdUrl, letterboxdUsername, letterboxdListSlug }` and `producesItemKind: 'movie'`.
2. Write `apps/backend/src/lib/sources/letterboxdList.ts` — `previewLetterboxdList` +
   `syncLetterboxdListSource`. Spec §3.3 calls out the dedup story (Letterboxd URL or enriched
   TMDB ID).
3. Wire it through `POST /v1/sources/preview` and `POST /v1/lists/:id/sources` in `lists.ts`
   (today both have an `if (kind === 'spotify_playlist')` branch — generalize).
4. Add the `letterboxd_watchlist` template to `LIST_TEMPLATES` (it's already designed in
   spec §7).
5. Per-kind dedup index: spec §9.3 floats lifting the dedup field into the item-kind manifest
   so each kind can declare its key. If Letterboxd needs a second dedup index, do this when it
   lands instead of hand-coding a second partial unique index.

### 3.2 Module-removal warning UI on the client (spec §6)

Backend ships the warning contract (`/v1/lists/:id/config-preview` + `acknowledgedWarnings` on
PATCH); the settings sheet implements the basic round-trip (preview → show warnings → "Apply
anyway"). What's missing is the **polish**:

- Pretty per-warning copy keyed off the code (today's UI renders the server-authored
  `message` verbatim).
- Localization story.
- Inline "X completed items hidden" mini-banner on the list-detail screen when a module is
  re-enabled — spec §6 mentions "re-enabling restores data and the activity-feed attribution".

### 3.3 Bulk-convert items in a list (spec §6.4)

Out of scope per the spec ("A bulk 'convert all items in this list from X to Y' operation is
out of scope for v1"). Flag here only so it shows up in the inventory.

### 3.4 Item-kind conversion on individual items (spec §6.5)

Same — out of scope per the spec. A `[item_kind=movie]` list keeps its existing movie items
even when the user changes `item_kind` to `null`; the new items can be anything.

### 3.5 Per-source secrets / OAuth-bearing sources (spec §3.3 "What it can't accommodate")

Today's only source (`spotify_playlist`) uses app-level credentials, so `config` is non-
secret. When the first OAuth-bearing source lands, `list_sources` needs a `secrets jsonb`
column (encrypted at rest) or an SSM-keyed mapping. Schema is ready (no FK constraints that
would block the column add).

### 3.6 Webhook / push-driven sources (spec §3.3 same section)

All sources today are pull-based via `POST /v1/lists/:id/sources/:id/sync`. A webhook source
would need an inbound URL keyed to `list_sources.id`, plus signature verification — the data
model is fine, the work is routing + verification.

### 3.7 Scheduled source sync (spec §9.1)

Manual refresh only today (the album-shelf behavior, generalized). The `last_synced_at`
column is ready for the cron worker that would set it; we just don't have the worker.

### 3.8 Negative-position rebalance trigger (spec §9.4)

Move-to-top forever pushes `position` ever more negative. Spec calls for triggering a
normalizing rebalance when `MIN(position) < -10⁹`. Not wired today — the rebalance code path
in `lib/positions.ts` is `moveItemPosition`'s collision recovery, not a periodic sweep.

**What's needed:** either a cron tick (cheap, predictable) or piggyback on the existing
collision-rebalance code: when `moveItemPosition` computes a new position, also check
`MIN(position) < threshold` and trigger a full rebalance if so.

### 3.9 Per-item-kind dedup field declared in the registry (spec §9.3)

Today `lib/sources/spotifyPlaylist.ts` hand-codes `spotifyAlbumId` as the dedup field in its
INSERT. Spec §9.3 floats lifting this into the item-kind manifest as `dedupField?: string` so
the partial unique indexes can be generated from the registry. Not wired today; do this when
the second dedupping kind lands (Letterboxd, probably).

### 3.10 Module set extensions (spec §6 "Module catalog (initial)")

The 5 modules shipped are the catalog. Spec floats `scheduling`, `comments`, `attachments` as
future additions — each one is one entry in `MODULE_NAMES`, one manifest in
`moduleManifests.ts`, and however much new UI the feature needs.

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

### 4.3 Legacy event-type values still in the TS union

See §2.3. Pragmatic safety net; trivially removable later.

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

### 4.6 No PR-F (Letterboxd)

See §3.1. The cleanest validation that the source abstraction isn't accidentally Spotify-
shaped is to ship a second kind. We didn't, so the abstraction is **tested by single use**.
Worth landing soon.

### 4.7 Backend route tests gone

See §2.2. Cost is real but bounded — the migration smoke test + browser verification + lib
unit tests carried the burden in #199.

---

## 5. One-week scope for the next engineer

If you have ~5 working days to spend on this, here's the recommended slice. The ordering
front-loads the foundation (tests before features) so the riskier feature work (PR-F) lands
on top of a safety net.

### Days 1–2 — Backend route tests for the new shape (§2.2)

Restore the test coverage that was deleted in #199. Five files, each in the pattern of the
surviving `activity.test.ts` / `members.test.ts`:

- `items.test.ts` — create / move / upvote / complete / archive, plus per-kind content
  validation, plus the module-gate 409 contract (≥3 assertions per gated endpoint).
- `lists.test.ts` — create with modules, PATCH with `acknowledgedWarnings`, config-preview,
  item_kind tightening guard, duplicate.
- `sources.test.ts` — CRUD + sync + preview (mock Spotify client per the existing pattern).
- `scores.test.ts` — upsert / delete / list, `period_key` shape.
- `duplicate.test.ts` — `preserveCompletion` × `copySources` matrix.

Sizing: ~300 lines each. Mostly mechanical.

### Days 3–4 — PR-F: Letterboxd source kind (§3.1, §3.9)

The headline extensibility proof. Touches:

- `packages/shared/src/sourceKinds.ts` — `letterboxd_list` manifest with
  `producesItemKind: 'movie'`.
- `apps/backend/src/lib/sources/letterboxdList.ts` — `previewLetterboxdList` +
  `syncLetterboxdListSource`. TMDB enrichment to fill `movie` content (poster, year,
  runtime).
- `lists.ts` — generalize the hard-coded `if (kind === 'spotify_playlist')` branches into a
  dispatch table over `SOURCE_KINDS`.
- `packages/shared/src/templates.ts` — add `letterboxd_watchlist` (already designed in
  §7).
- Per-kind dedup story: lift `dedupField` into the item-kind manifest (§3.9). Pull this
  follow-up in here naturally since you're touching the dedup index path.
- Tests follow Day 1–2's pattern.

The **headline assertion** to write: a Letterboxd source produces `items.kind = 'movie'` —
not `letterboxd_film` — proving the source-kind / item-kind decoupling is real.

### Day 5 — Cleanup + buffer

- Drop-old-columns migration (`lists.type`, `lists.metadata`, `items.type`,
  `items.metadata`, `game_scores`, `list_type` enum). Small and well-defined, see §2.1.
- iOS smoke against TestFlight, since #199 was web-only.
- Buffer for whichever Day 1–4 task slipped.

### Why this order

- **Tests before features.** Letterboxd will touch dispatch, dedup, and source plumbing;
  building those changes on top of a route-test gap is asking to break things invisibly.
- **PR-F before any polish.** It's the highest-information PR — if the source abstraction
  is subtly wrong, it'll surface here, which is much better than discovering it after six
  more source kinds have crystallized around the wrong shape.
- **Cleanup last** so it benefits from a few extra days of prod soak on the additive
  migration.

### What to defer past the week

The remaining items in §3 are product-pull work — land them when a feature pulls them in,
not on a calendar:

- §3.2 Module-removal warning UI polish (per-code copy + localization).
- §3.5–3.7 Future-source plumbing (per-source secrets, webhooks, scheduled sync).
- §3.8 Rebalance overflow trigger (no urgency until somebody moves to top 10⁹ times).
- §3.10 New modules (`scheduling`, `comments`, `attachments`).
