# Lists & Leaderboards — engineering plan

Status: **proposed** · Opened: 2026-06-05 · Owner: @joshlebed

The _how_ for [`docs/lists-and-leaderboards-spec.md`](./lists-and-leaderboards-spec.md) (the
_what_). Same conventions as [`docs/redesign-plan.md`](./redesign-plan.md): each chunk is a PR
(or small stack) with file-level deliverables, dependencies, acceptance, and risks. The
foundation is unchanged — pnpm monorepo, Expo + expo-router, Hono on Lambda, Neon, Drizzle, EAS.

Two independent tracks. **Track L** (Lists: facets) and **Track B** (Games: leaderboards) share
no code below the app shell and can ship in either order or in parallel. Pickup order below is
the recommended one (L0 first — cheapest, directly answers the burgers/date-ideas ask).

---

## 0. Guiding principles

- **Shared types first.** Every API change starts in `packages/shared/src/types.ts` (or a
  subpath registry — `itemKinds.ts`, new `games.ts`). Backend + client both depend on it, so
  the type error is the to-do list.
- **Zod at the boundary.** Every route validates input before touching the DB. No `as` on
  `JSON.parse`/`Response.json()` (ts-reset is on).
- **One Playwright happy-path per chunk.** Don't defer E2E to the end.
- **Reuse the registries.** Item kinds, modules, source kinds, the permissions matrix, and the
  `gameScoreRegex` catalog are all append-only registries — extend, don't fork. The catalog
  doubles as the seed for the global `games` table.
- **Runtime-version discipline.** Only L2 (map view) adds a native module → it MUST bump
  `apps/workshop/app.json` `version` in the same PR (runtime-version guard). Everything else is
  JS/OTA-able.
- **Migrations:** `pnpm run db:generate -- --name=<desc>` from `apps/backend`; commit SQL +
  `meta/` + `_journal.json`. Neon-branch before any backfill (CLAUDE.md).

---

## 1. Cross-cutting workstreams

| Workstream              | Where                                               | Per-chunk meaning                                                                                                     |
| ----------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Shared types/registries | `packages/shared/src/*`                             | `place` kind; `facets.ts`; `games.ts` (Game/UserGame/GameScore/Friend types + `normalizeGameUrl`)                     |
| Zod validation          | `apps/backend/src/routes/v1/*`                      | tags, view config, merge body; game-add/score, friend invite/accept bodies                                            |
| Permissions             | `apps/backend/src/lib/permissions.ts` (lists)       | Lists keep the capability matrix; **Games has no role matrix** — reads gate on the friend graph, writes are self-only |
| Activity feed           | `apps/backend/src/lib/events.ts` + client renderers | new event types: `item_tagged`, `list_merged`, `friend_accepted`                                                      |
| Migrate smoke           | CI                                                  | every schema chunk green on fresh-DB + idempotent re-run                                                              |
| Tests                   | vitest beside each route/lib; Playwright per chunk  | matches existing `lists.test.ts` / `scores.test.ts` patterns                                                          |

---

## 2. Track L — Lists: facets, tags, views, places

### L0 — `place` kind + derived facets + filter chips (no new tables)

**Goal:** Date Ideas becomes immediately usable — auto category chips, no migration of other
lists required. Pure read-time derivation; the only schema touch is the `place` registry entry

- its dedup index.

**Deliverables:**

- `packages/shared/src/itemKinds.ts` — add `place` schema (spec §2.1) to `ITEM_KINDS`,
  `ITEM_KIND_NAMES`, `ITEM_KIND_DEDUP_FIELD` (`placeId`).
- `apps/backend/src/db/schema.ts` — partial unique index `(list_id, content->>'placeId') WHERE
kind='place'`; + Drizzle migration.
- `packages/shared/src/facets.ts` (new, subpath export) — `deriveFacets(item)` pure function:
  `place → {category, neighborhood, priceLevel}`, `movie/tv → {genre, decade}`, etc. Plus the
  Maps-place-type → category mapping table. **Pure, no zod barrel** (Metro-safe subpath).
- `apps/backend/src/routes/v1/items.ts` — include `facets` on each item in the list-items
  response (call `deriveFacets`).
- `apps/backend/src/routes/v1/lists.ts` — `GET /v1/lists/:id/facets` (dimensions + values +
  counts). Shared type `ListFacetsResponse`.
- `apps/workshop/src/ui/FacetBar.tsx` (new) — horizontal chip row (reuses `src/ui/Chip.tsx`),
  multi-select OR within a dimension, explicit "All", count badges.
- `apps/workshop/src/screens/listDetail/` — wire `FacetBar` + client-side filtering into
  `ItemList.tsx` / `ItemList.web.tsx`; `listProps.ts` resolves available facets.
- `apps/workshop/src/api/lists.ts` — `fetchListFacets`.
- One Playwright happy-path: open a place list, tap "Restaurant", assert filtered rows.

**Deps:** none. **Acceptance:** Date Ideas shows category chips derived from place type;
filtering is instant; no DB rows changed for existing items (kind backfill is L-migrate, below).
**Risks:** category mapping coverage (unknown Maps types → an "Other" bucket, never a crash).

### L1 — manual tags + saved views + merge tool

**Goal:** kill overlapping-list sprawl. "Burgers" becomes a saved view inside "Date Ideas".

**Deliverables:**

- Migration: `item_tags`, `list_saved_views` (spec §2.6).
- `apps/backend/src/routes/v1/items.ts` — `PUT /v1/items/:id/tags`; include `tags` on item
  reads. Activity `item_tagged`.
- `apps/backend/src/routes/v1/lists.ts` — saved-view CRUD (`/v1/lists/:id/views`) +
  `POST /v1/lists/:id/merge` (spec §2.7). Merge dedupes by `placeId`, unions tags, archives the
  emptied source, optional saved-view creation. Activity `list_merged`.
- `apps/backend/src/lib/permissions.ts` — view-delete uses `edit_list_metadata`; tag-edit uses
  `edit_items` (no matrix change, just call sites).
- `packages/shared/src/types.ts` — `SavedView`, `MergeListRequest/Response`, tag shapes.
- Client: tag picker (suggested chips over existing tags) in `list/[id]/item/[itemId].tsx`;
  saved-views row + "Save current view" in `ListDetail`/`FacetBar`; merge entry point in
  `list/[id]/settings.tsx`; `src/api/{items,lists}.ts` wrappers.
- `packages/shared/src/templates.ts` — `date_ideas` → `itemKind:'place'`; add `places`/"City
  Guide" template.
- Playwright: tag an item → it appears as a chip; save a view; run a merge → source archived,
  view present, no dupes.

**Deps:** L0. **Acceptance:** burgers merged into date-ideas as a reversible saved view, zero
data loss. **Risks:** merge is the sharp edge — owner-only on both lists, soft-delete source
(don't hard-delete), wrap in a transaction, emit one activity event.

### L2 — map view (native module; version bump)

**Goal:** place lists get a map view; category chips highlight matching pins.

**Deliverables:** `react-native-maps`/Expo Maps add (`app.json` plugins + **`version` bump**);
`apps/workshop/src/screens/listDetail/MapView.tsx` (native) + `.web.tsx` (lightweight); view-mode
toggle in `FacetBar`/saved-view config; chip selection drives pin highlight. Playwright covers
the web map only (native verified on TestFlight).

**Deps:** L0 (facets) + L1 (view modes). **Risks:** the one native-module PR — fingerprint guard

- TestFlight smoke; keep web on a non-native renderer.

### L-migrate — backfill existing `link` places → `place`

One-shot Drizzle migration + a backfill script: `items.kind='place'` where `kind='link'` and
`content` has `lat`+`lng`; derive+cache `category`/`neighborhood`. Neon-branch first. Ships
with or just after L0 (the registry accepts `place` before rows are backfilled, so order is
safe either way).

---

## 3. Track B — Games: global catalog + friend-graph leaderboards

The whole track is four small tables (`games`, `user_games`, `game_scores`, `friendships` +
`friend_requests`) and a per-viewer leaderboard query. No leagues, arenas, roles, seasons,
join-codes, or visibility flags. `game_scores` is `item_scores` re-keyed `item_id → game_id`.

### B0 — app shell: top-level Lists/Games switch

**Goal:** introduce the two-surface shell without changing any data model.

**Deliverables:**

- `apps/workshop/app/_layout.tsx` — restructure into a top-level switch: expo-router `Tabs` on
  native (`◧ Lists` / `◆ Games`), sidebar switch in `src/ui/Layout.tsx` on web. Existing list
  routes nest under the Lists surface; a new `app/games/` segment under Games.
- `apps/workshop/app/games/index.tsx` — placeholder Games home (real content in B1).
- Preserve deep links + back-stack + share-intent routing (verify both tabs reachable).
- Playwright: switch between surfaces on web; assert routes resolve.

**Deps:** none. **Risks:** navigation refactor touches the most central file; keep modals'
`presentation` options intact; verify the share-extension redirect still lands.

### B1 — global game catalog + "My Games" (ordered) + re-keyed scores

**Goal:** the Games surface works end-to-end for a **solo** user over real data — add games by
URL, reorder them, paste scores, see your own results. (Friends arrive in B2.)

**Deliverables:**

- Migration: `games`, `user_games`, `game_scores` (spec §3.6). Backfill: seed `games` from the
  `gameScoreRegex` catalog (canonical `game_key`/title/`score_direction`); migrate existing
  leaderboard-list items + their `item_scores` → `games` (dedup by normalized URL) +
  `game_scores`. Keep `item_scores` readable until B-migrate verifies.
- `packages/shared/src/games.ts` (new subpath) — `Game`/`UserGame`/`GameScore` types +
  `normalizeGameUrl()` (pure, Metro-safe: lowercase host, strip `www.`, drop query+fragment,
  trim trailing slash, keep path) + the catalog's URL→`game_key` canonicalization.
- `apps/backend/src/routes/v1/games.ts` (new) — `GET /v1/games` (my ordered games + today's
  status), `POST /v1/games` (find-or-create by normalized URL, append to `user_games`),
  `DELETE /v1/games/:id` (my row only), `POST /v1/games/:id/move` (reuse `positions.ts`),
  `PUT /v1/games/:id/scores` (upsert, auto-add to my games, idempotent),
  `GET /v1/games/:id/leaderboard` (self-only until B2). Score parsing via `gameScoreRegex.ts`.
- Client: `app/games/index.tsx` (my ordered, drag-reorder — reuse the `ItemList` drag pattern),
  `app/games/[id].tsx` (per-game board + paste slot), add-game flow (paste URL / pick from
  catalog); `src/api/games.ts`. Re-point capture: rename `app/share/pick-leaderboard.tsx` →
  `pick-game.tsx`, post to a game.
- Playwright: add a game by URL → paste a score → it lands on the board; reorder persists.

**Deps:** B0. **Acceptance:** the solo Games surface works on the real Geo-Games data.
**Risks:** **URL normalization is the sharp edge** — it's the dedup key for the whole catalog
(CLAUDE.md already documents the `dailytens.com/?ref=` junk). Heavily unit-test `normalizeGameUrl`;
the `item_scores`→`game_scores` backfill must collapse variants to one `games` row.

### B2 — friend graph (the social layer)

**Goal:** a friend's scores appear in your per-game leaderboards.

**Deliverables:**

- Migration: `friendships` (canonical `user_low < user_high`), `friend_requests` (spec §3.6).
- `apps/backend/src/lib/friends.ts` (new) — `friendsOf(userId)` (one indexed query over both
  columns); idempotent symmetric insert.
- `apps/backend/src/routes/v1/friends.ts` (new) — `GET /v1/friends`,
  `POST /v1/friends/invite` (token via `shareSlug.ts`), `GET /v1/friends/requests/:token`
  (preview inviter), `POST /v1/friends/requests/:token/accept`, `DELETE /v1/friends/:userId`.
  Rate-limit accept (reuse `middleware/rate-limit.ts`).
- `apps/backend/src/routes/v1/games.ts` — `GET /v1/games/:id/leaderboard` + `GET /v1/games`
  today-status now union `friendsOf(viewer)`.
- Client: `app/friends/index.tsx` (friends list + share-link invite + incoming pending) and an
  accept-landing route reusing the `onboarding/accept-invite.tsx` + `inviteStash.ts` deep-link
  round-trip; `src/api/friends.ts`. Friends entry from the Games header + Settings.
- Playwright: two dev users — A creates an invite link, B accepts, B's score on a shared game
  appears in A's leaderboard (and vice versa).

**Deps:** B1. **Risks:** the invite deep-link round-trip through sign-in (reuse the list-invite
stash); idempotent symmetric friendship insert; rate-limit accept against token-guessing.

### B-migrate — Geo Games list → games + friends; deprecate the module

One-shot (Neon-branch first): games + scores already migrated in B1's backfill — here insert
`user_games` for each scorer (preserve the owner's order) and turn every pair of co-members of a
leaderboard list into a mutual `friendships` edge (all pairs; sanity-cap large lists). Then
deprecate: drop `leaderboard` from `MODULE_NAMES`, remove the `daily_games` template, retire
`app/list/[id]/game/[itemId].tsx`, update `formatActivityEvent`, and drop the legacy
`item_scores` table once `game_scores` is verified. Ships **after** B2 is verified.

---

## 4. Dependency graph & recommended order

```
L0 ──> L1 ──> L2            (Lists track)
L0 ──> L-migrate
B0 ──> B1 ──> B2 ──> B-migrate   (Games track)

Tracks L and B are independent. Recommended pickup:
L0  →  L1  →  B0  →  B1  →  B2  →  L2  →  (L-migrate, B-migrate)
```

Rationale: L0 is the cheapest, highest-value, and directly answers the original ask; B1 makes the
Games surface work solo on real data; B2 adds the social layer; the two `-migrate` chunks land
last, each gated on its track being verified.

---

## 5. Risks & open engineering questions

- **URL normalization is the sharp edge of Track B.** It's the dedup key for the entire `games`
  catalog; CLAUDE.md already documents the `dailytens.com/?ref=` referral junk that poisoned
  score parsing. Ship a pure, heavily-tested `normalizeGameUrl`; let the catalog canonicalize
  known variants; unknown URLs dedup on the normalized form alone.
- **Map view is the only native dependency.** It forces a `version` bump + TestFlight build;
  everything else ships via OTA. Defer L2 if EAS minutes are tight — facets work without it.
- **Reverse-geocoding for `neighborhood`.** Needs a geocode call on write; cache in `content`
  (we already cache Maps thumbnails), never on read. Decide provider at L-migrate time.
- **Friend-invite deep-link round-trip** through sign-in — reuse the list-invite stash
  (`inviteStash.ts`); rate-limit accept against token-guessing.
- **`leaderboard` module deprecation timing.** Keep the module + the old `/list/[id]/game/...`
  route working until B-migrate verifies, so Geo Games is never unreachable. Migrate
  `item_scores`→`game_scores` in B1 but keep the old table readable until B-migrate drops it.
- **Cut from the earlier draft:** leagues / arenas / roles / seasons / join-codes / visibility
  flags / the placement-points overall rank. If a real multi-group or public-leaderboard need
  ever shows up, it's an additive layer on top of the friend graph — not a prerequisite.

---

## 6. Acceptance per track

- **Track L done:** Date Ideas renders auto category chips + map + Want-to-go/Been; Burgers is a
  saved view inside it; merge lost nothing and is reversible.
- **Track B done:** your Games home is your own ordered, reorderable list; pasting a result posts
  to a global, URL-deduped game; accepting a friend's invite link makes their scores appear in
  your per-game leaderboards for the games you both play; the `leaderboard` list module is
  retired.
