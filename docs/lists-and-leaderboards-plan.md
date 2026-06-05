# Lists & Leaderboards — engineering plan

Status: **proposed** · Opened: 2026-06-05 · Owner: @joshlebed

The _how_ for [`docs/lists-and-leaderboards-spec.md`](./lists-and-leaderboards-spec.md) (the
_what_). Same conventions as [`docs/redesign-plan.md`](./redesign-plan.md): each chunk is a PR
(or small stack) with file-level deliverables, dependencies, acceptance, and risks. The
foundation is unchanged — pnpm monorepo, Expo + expo-router, Hono on Lambda, Neon, Drizzle, EAS.

Two independent tracks. **Track L** (Lists: facets) and **Track B** (Leaderboards: split) share
no code below the app shell and can ship in either order or in parallel. Pickup order below is
the recommended one (L0 first — cheapest, directly answers the burgers/date-ideas ask).

---

## 0. Guiding principles

- **Shared types first.** Every API change starts in `packages/shared/src/types.ts` (or a
  subpath registry — `itemKinds.ts`, new `leagues.ts`). Backend + client both depend on it, so
  the type error is the to-do list.
- **Zod at the boundary.** Every route validates input before touching the DB. No `as` on
  `JSON.parse`/`Response.json()` (ts-reset is on).
- **One Playwright happy-path per chunk.** Don't defer E2E to the end.
- **Reuse the registries.** Item kinds, modules, source kinds, the permissions matrix, and the
  `gameScoreRegex` catalog are all append-only registries — extend, don't fork.
- **Runtime-version discipline.** Only L2 (map view) adds a native module → it MUST bump
  `apps/workshop/app.json` `version` in the same PR (runtime-version guard). Everything else is
  JS/OTA-able.
- **Migrations:** `pnpm run db:generate -- --name=<desc>` from `apps/backend`; commit SQL +
  `meta/` + `_journal.json`. Neon-branch before any backfill (CLAUDE.md).

---

## 1. Cross-cutting workstreams

| Workstream              | Where                                                                      | Per-chunk meaning                                                        |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Shared types/registries | `packages/shared/src/*`                                                    | `place` kind; `facets.ts`; `leagues.ts` types + league permission matrix |
| Zod validation          | `apps/backend/src/routes/v1/*`                                             | tags, view config, merge body, league/arena/entry bodies                 |
| Permissions             | `apps/backend/src/lib/permissions.ts` (lists) + new `leaguePermissions.ts` | one matrix per domain; handlers ask for a capability                     |
| Activity feed           | `apps/backend/src/lib/events.ts` + client renderers                        | new event types: `item_tagged`, `list_merged`, league events             |
| Migrate smoke           | CI                                                                         | every schema chunk green on fresh-DB + idempotent re-run                 |
| Tests                   | vitest beside each route/lib; Playwright per chunk                         | matches existing `lists.test.ts` / `scores.test.ts` patterns             |

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

## 3. Track B — Leaderboards split

### B0 — app shell: top-level Lists/Boards switch

**Goal:** introduce the two-surface shell without changing any data model.

**Deliverables:**

- `apps/workshop/app/_layout.tsx` — restructure into a top-level switch: expo-router `Tabs` on
  native (`◧ Lists` / `◆ Boards`), sidebar switch in `src/ui/Layout.tsx` on web. Existing list
  routes nest under the Lists surface; a new `app/leaderboards/` segment under Boards.
- `apps/workshop/app/leaderboards/index.tsx` — placeholder Boards home (real content in B1).
- Preserve deep links + back-stack + share-intent routing (verify both tabs reachable).
- Playwright: switch between surfaces on web; assert routes resolve.

**Deps:** none. **Risks:** navigation refactor touches the most central file; keep modals'
`presentation` options intact; verify share-extension redirect still lands.

### B1 — read-only Leaderboards home (reuses `item_scores`)

**Goal:** the Boards surface feels alive over **existing** data — no new tables, no migration.

**Deliverables:**

- `apps/backend/src/routes/v1/leagues.ts` (new, read-only) — `GET /v1/leaderboards` aggregates
  the user's `modules:[leaderboard]` lists + their `item_scores` into today/week/all-time
  boards, streaks, participation, and the placement-points overall rank.
- `apps/backend/src/lib/leaderboard/aggregate.ts` (new) — pure aggregation + placement-points +
  streak/participation calculators (heavy unit-test target).
- `packages/shared/src/types.ts` — `LeaderboardWindow`, board/streak response types.
- Client: `app/leaderboards/index.tsx` (today's board, window switcher),
  `app/leaderboards/[gameId].tsx` (per-arena history); reuse `scoresSummary.ts`. `src/api/leaderboards.ts`.
- Playwright: Boards home shows today's per-game + overall standings from seeded scores.

**Deps:** B0. **Acceptance:** the Geo Games data renders as a live board in the Boards surface
while still stored as a list. **Risks:** aggregation correctness — cover the calculators
heavily; reuse `gameDate.ts`/`dates.ts` for puzzle-day keys.

### B2 — leagues as a first-class primitive (tables + sharing)

**Goal:** real leagues with their own membership, roles, join-by-code, visibility, seasons.

**Deliverables:**

- Migration: `leagues`, `league_members`, `arenas`, `league_entries` (spec §3.5).
- `apps/backend/src/lib/leaguePermissions.ts` (new) — capability matrix mirroring
  `lib/permissions.ts`: roles `admin|participant|spectator`.
- `apps/backend/src/routes/v1/leagues.ts` — full CRUD: leagues, join/join-code-reset, arenas,
  `PUT /v1/arenas/:id/entries` (idempotent on `(arena,user,period)`), members/role. Visibility
  gating for `view`. Activity events for league actions.
- `apps/backend/src/lib/shareSlug.ts` — reuse the rotatable-code generator for `join_code`.
- `packages/shared/src/leagues.ts` (new subpath) — league/arena/entry types + role enum +
  unplayed-policy enum + the capability list.
- Client: `app/leaderboards/create.tsx`, `app/leaderboards/[id]/settings.tsx` (admin), join flow,
  arena management; `src/api/leagues.ts`.
- Re-point capture: `app/share/pick-leaderboard.tsx` + `shareScoreDetection` post to an arena.
- Playwright: create league → join by code (2nd dev user) → post score via paste → board updates;
  spectator can view but not post; admin adds an arena.

**Deps:** B1 (aggregation logic generalizes to `league_entries`). **Risks:** the new permission
domain — test the matrix like `permissions.test.ts`; idempotent entry upsert; join-code abuse →
rate-limit `POST …/join` (reuse `middleware/rate-limit.ts`).

### B-migrate — Geo Games list → a League; deprecate the module

One-shot migration (Neon-branch first): for each `modules:[leaderboard]` list, create a league;
items → arenas; `item_scores` → `league_entries`; `list_members` → `league_members` (owner →
admin). Then deprecate: drop `leaderboard` from `MODULE_NAMES`, remove the `daily_games`
template, retire `app/list/[id]/game/[itemId].tsx`. Update `formatActivityEvent` for retired
event types. Ships **after** B2 is verified.

---

## 4. Dependency graph & recommended order

```
L0 ──> L1 ──> L2            (Lists track)
L0 ──> L-migrate
B0 ──> B1 ──> B2 ──> B-migrate   (Leaderboards track)

Tracks L and B are independent. Recommended pickup:
L0  →  L1  →  B0  →  B1  →  L2  →  B2  →  (L-migrate, B-migrate)
```

Rationale: L0 is the cheapest, highest-value, and directly answers the original ask; B0/B1 prove
the Leaderboards surface over existing data before committing to B2's tables; the two `-migrate`
chunks land last, each gated on its track being verified.

---

## 5. Risks & open engineering questions

- **Map view is the only native dependency.** It forces a `version` bump + TestFlight build;
  everything else ships via OTA. Consider deferring L2 if EAS minutes are tight (CLAUDE.md
  free-tier budget) — facets work without it.
- **Reverse-geocoding for `neighborhood`.** Needs a geocode call on write; cache in `content`
  (we already cache Maps thumbnails), never on read. Decide provider (Google vs the existing
  Maps key) at L-migrate time.
- **Placement-points formula** is a product call (F1-style 25/18/15… vs golf vs linear). Ship a
  single documented default in B1; make it a league setting only if asked.
- **Activity feed unification across surfaces.** The home bell currently sums list unread; decide
  whether league events feed the same bell or a separate Boards badge (recommend separate, per
  the per-surface notification split in the spec).
- **`leaderboard` module deprecation timing.** Keep the module + old route working until B-migrate
  verifies, to avoid a window where Geo Games is unreachable.

---

## 6. Acceptance per track

- **Track L done:** Date Ideas renders auto category chips + map + Want-to-go/Been; Burgers is a
  saved view inside it; merge lost nothing and is reversible.
- **Track B done:** Geo Games is a League with join-by-code, roles, and seasons; scores post via
  the share-extension to arenas; today's per-game + overall boards + streaks render; the
  `leaderboard` list module is retired.
