# Lists & Leaderboards — product + design spec

Status: **proposed** · Date: 2026-06-05 · Owner: @joshlebed

This is the product/design spec (the _what_) for Workshop.dev's next chapter. The engineering
plan (the _how_ — phases, PR decomposition, file-level deliverables) is
[`docs/lists-and-leaderboards-plan.md`](./lists-and-leaderboards-plan.md). The option space and
the research that led here are in
[`docs/lists-and-leaderboards-exploration.md`](./lists-and-leaderboards-exploration.md).

It builds on — and in one place deliberately walks back — the modules+kind model from
[`docs/list-data-model-redesign.md`](./list-data-model-redesign.md). Read that first; this
spec assumes it.

---

## 1. Vision: two surfaces, one app

Workshop.dev splits into **two product surfaces** that share an account, a design system, a
share-extension capture pipeline, and the OTA/TestFlight deploy pipeline — but diverge in their
data model and their sharing/permissions below the shell:

- **Lists** — collaborative collections of things a small circle wants to do together
  (places, movies, books, albums…). Membership is small, symmetric, durable. _This is today's
  app, plus internal structure (facets / tags / saved views) and a first-class `place` kind._
- **Daily Leaderboards** — recurring competitive score-sharing for a friend group (the daily
  puzzle league). Membership is open-join, role-stratified, seasonal. _This is a new primitive
  extracted out of the `leaderboard` list module._

### 1.1 What changes vs. #199 (the modules+kind redesign)

|                             | #199 model                        | This spec                                     |
| --------------------------- | --------------------------------- | --------------------------------------------- |
| Date/place lists            | `kind=link`, flat                 | `kind=place`, **facets + tags + saved views** |
| "Burgers" as a sibling list | a separate list                   | a **saved view** inside one places collection |
| Daily games                 | `modules:[leaderboard]` on a list | a **League** in its own surface               |
| `leaderboard` module        | a list module                     | **deprecated** (migrated to leagues)          |
| Top-level nav               | one stack                         | **two surfaces** behind a switch              |

This **partially reverses** #199's "every behavior is a list module" thesis. We keep it for
Lists; we reject it for leaderboards, because competition needs sharing/period/role primitives
the list model cannot express without overloading `list_members`. (See exploration §7.)

### 1.2 Non-goals (carried from `redesign-spec.md` unless noted)

- An item still belongs to **exactly one list**. Facets/tags are item _attributes_, not extra
  parents. (Cross-collection smart lists are explicitly future work — §2.5.)
- No public profiles / follow graph for **Lists**. (Leagues introduce a _public/unlisted_
  visibility flag — that's scoped to leagues, not lists.)
- No AI auto-categorization beyond deterministic derivation from existing metadata.
- No per-user completion. Completion stays a shared boolean (used as the "been" signal).

---

## 2. Surface 1 — Lists

### 2.1 The `place` item kind

A saved location is currently `kind=link` with ad-hoc geo fields. Promote it to a first-class
kind (kinds are a code-only registry — `@workshop/shared/itemKinds`, no DB enum):

```ts
place: {
  source?: 'google_maps' | 'manual',
  placeId?: string,        // dedup key → ITEM_KIND_DEDUP_FIELD.place = 'placeId'
  lat?: number, lng?: number,
  address?: string,
  neighborhood?: string,   // derived once on write (reverse geocode), cached in content
  category?: string,       // derived from Maps place type; user-overridable
  priceLevel?: 1|2|3|4,
  mapImageUrl?: string,    // static-map thumbnail (we already cache these)
  mapImageProxy?: string,
}
```

`link` stays for true links. Existing geo-bearing `link` items migrate to `place` (§5).

### 2.2 Facets — the categorization primitive

A **facet** is a `(dimension, value)` pair on an item, from two sources:

- **Derived facets** — computed from `item.kind` + `item.content`. No user effort:
  | kind | derived dimensions |
  | --- | --- |
  | `place` | `category` (Maps type), `neighborhood`, `priceLevel` |
  | `movie`/`tv` | `genre`, `decade` (from TMDB content) |
  | `book` | `author`, `decade` |
  | `spotify_album` | `artist`, `decade` |
- **Manual tags** — user-applied labels, **many-to-many**, entered through a suggested-chip
  picker over the collection's existing tags (never a free-text keyboard field).

Both are filterable through **one chip bar** and feed **saved views**. Derived facets are
computed at read time (the dataset is tiny); manual tags are stored.

**Design rules** (from the research; exploration §3.1):

- Never make the user build a taxonomy from scratch — derive, then let them _correct_.
- Within one dimension, multi-select reads as **OR** ("Restaurant OR Bar"); across dimensions,
  combine as **AND**. No AND/OR toggle exposed.
- Always provide an explicit **"All"** chip; "nothing selected" is ambiguous.
- Empty results get a _specific_ empty state + one-tap "Clear filters", never a blank screen.

### 2.3 Status axis (want-to-go / been)

Every places app treats want-to-go vs been as its own axis, never folded into category. We
already have it: the `todo` module's `completed` boolean = "been". When a list has `todo`,
render a **segmented control (Want to go · Been · All)** distinct from the category chips. No
new data.

### 2.4 Saved views

A **saved view** is a stored `{ filter, sort, groupBy, viewMode }` over one list. A former
sibling list becomes a saved view — "Burgers" = `category=restaurant ∧ tag=burgers`. View
modes: **list** (default), **grid** (thumbnails), **map** (place lists only, driven by
lat/lng). Views are list-scoped and shared by all members (not per-viewer).

### 2.5 What it looks like per list type

```
PLACES  (date ideas, restaurants, burgers)        view: List | Grid | Map
( Want to go · Been · All )                        ← status segment (todo)
[All] [Restaurant 12] [Bar 4] [Music 5] [Museum 2] [Activity 8]  + #burgers
Saved views:  ⭐ Burgers   ⭐ Bars to try   ⭐ Brooklyn

MOVIES / TV    facets: Genre · Decade · Runtime    + Watched/Unwatched (todo)
BOOKS          facets: Author · Genre · Length
ALBUM SHELF    facets: Artist · Decade             (source-driven, read-only)
GENERIC/plain  facets: manual tags only
```

The map view and the category chips drive the **same** highlight (tap "Restaurant" → matching
pins light up; Foursquare Swarm pattern). Stray off-kind items (the "movies to watch" sitting
in Date Ideas) get a one-tap **"Move to a watchlist"** affordance.

### 2.6 Data model (additions only)

```sql
CREATE TABLE item_tags (
  item_id uuid REFERENCES items(id) ON DELETE CASCADE,
  tag     text NOT NULL,                  -- normalized lowercase, ≤40 chars
  PRIMARY KEY (item_id, tag)
);
CREATE INDEX item_tags_tag_idx ON item_tags (tag);

CREATE TABLE list_saved_views (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    uuid REFERENCES lists(id) ON DELETE CASCADE,
  name       text NOT NULL,
  config     jsonb NOT NULL,              -- { filter, sort, groupBy, viewMode }
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  position   integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX list_saved_views_list_idx ON list_saved_views (list_id);
```

Plus `place` added to `ITEM_KINDS` + `ITEM_KIND_NAMES` + `ITEM_KIND_DEDUP_FIELD` (`placeId`),
and a partial unique index `(list_id, content->>'placeId') WHERE kind='place'` mirroring the
existing `spotify_album` / `movie` indexes in `schema.ts`.

### 2.7 API (additions; existing list/item routes unchanged in shape)

- `GET /v1/lists/:id/items` — each item gains `tags: string[]` and `facets: Record<string,
string>` (server-derived). No new endpoint to read tags.
- `GET /v1/lists/:id/facets` → `{ dimensions: [{ key, label, values: [{ value, count }] }] }`
  — powers the chip bar with counts. Derived per request from the list's items.
- `PUT /v1/items/:id/tags` — body `{ tags: string[] }` (replace set). Member capability
  `edit_items`. Emits `item_tagged` activity.
- `GET/POST/PATCH/DELETE /v1/lists/:id/views` — saved-view CRUD. Member can create; only the
  creator or owner can delete (capability `edit_items` to create, `edit_list_metadata` to
  delete others').
- `POST /v1/lists/:id/merge` — body `{ sourceListId, tag?, createSavedView?: boolean }`.
  Owner-only on **both** lists. Moves non-archived items from source → target, stamps `tag`,
  dedupes by `placeId` (union tags on collision), optionally creates a saved view, archives the
  now-empty source list. Returns `{ movedCount, dedupedCount, viewId? }`. Emits `list_merged`.
  Reversible within a session via the standard archive (source is soft-deleted, not dropped).

### 2.8 Template changes

`@workshop/shared/templates`:

- `date_ideas` → `itemKind: 'place'` (was `link`); add a generic **`places` / "City Guide"**
  template (`itemKind: 'place'`, `modules: ['todo','ranking']`).
- `daily_games` template **removed** (leagues are created in the Leaderboards surface, §3).

---

## 3. Surface 2 — Daily Leaderboards

### 3.1 Primitives

```
League ─< Arena (one per game) ─< Entry (one per user per period)
   │
   └─< LeagueMember (participant | spectator | admin; per-season)
```

- **League** — the friend-group container. Has a name, an owner, a rotatable **join code**, a
  **visibility** (`private | unlisted | public`), and a current **season**.
- **Arena** — one tracked game (MapTap, Globle, NYT Mini…). Carries the game's parser key,
  title, URL, and **score direction** (asc = lower better, desc = higher better). ≈ today's
  leaderboard-list _items_.
- **Period** — the recurring unit, keyed by **puzzle-day** (`period_key`, e.g. `2026-06-05`),
  anchored to the game's puzzle number where available so late pastes land on the right day.
  Not a table — it's a key on entries.
- **Entry** — one user's result for one arena in one period. ≈ today's `item_scores` rows.
- **LeagueMember** — a user's role + season membership. **Distinct from `list_members`.**

### 3.2 Aggregations & ranking (computed, no tables)

- **Windows:** today / this week / all-time / rolling-7 (the proven WordleBot menu). Home
  defaults to **today** — "today" is what makes a board feel alive.
- **Per-arena board:** rank entries by `score_value` honoring the arena's `score_direction`.
- **Overall daily board (placement points):** within each arena, rank players 1st/2nd/3rd…,
  award F1/golf-style points, sum across arenas for an overall daily rank. Scale-invariant —
  the only sane way to compare distance (Globle) vs seconds (Mini) vs guesses (Wordle).
- **Streaks & participation:** per `(user, arena)` current + longest streak; per-period "played
  N/M". **Unplayed-day policy** is a league setting (`excluded-but-breaks-streak` is the
  humane default; `counts-as-loss` for hardcore leagues).

### 3.3 Sharing & permissions (the divergence)

Leagues get their **own** capability matrix (mirroring `lib/permissions.ts`, not reusing it):

| operation                                           | admin | participant | spectator |        non-member        |
| --------------------------------------------------- | :---: | :---------: | :-------: | :----------------------: |
| view boards / streaks                               |   ✓   |      ✓      |     ✓     | ✗ (unless league public) |
| submit own entry                                    |   ✓   |      ✓      |     ✗     |            ✗             |
| edit/delete own entry                               |   ✓   |      ✓      |     ✗     |            ✗             |
| add/remove arenas, set rules/season/unplayed-policy |   ✓   |      ✗      |     ✗     |            ✗             |
| rotate join code, set visibility                    |   ✓   |      ✗      |     ✗     |            ✗             |
| remove member / change role                         |   ✓   |      ✗      |     ✗     |            ✗             |
| join via code                                       |  n/a  |     n/a     |    n/a    |            ✓             |

Primitives leagues need that lists do **not**: join-by-code, participant/spectator/admin roles,
seasonal membership, public/unlisted/private visibility. Primitives lists need that leagues do
**not**: per-item edit rights, owner-transfer of the artifact. (Entries are append-only-by-self;
you never edit someone else's entry.)

### 3.4 Score capture (reuse what exists)

Capture is unchanged from today's best-in-class flow — it just targets a league arena instead
of a list item:

- Share the game's result → Workshop share-extension → `app/share/index.tsx` → detect game via
  `shareScoreDetection.ts` (17 parsers) → "Post to **MapTap** in **Geo Games**" → one tap.
- Idempotent on `(arena_id, user_id, period_key)` — re-pasting the same puzzle updates, never
  duplicates (same pattern as the album-shelf dedup index).
- In-app paste fallback for web. `gameScoreRegex.ts` (score parsing) + `scoresSummary.ts`
  (display) are reused; `score_direction` moves from `items` onto `arenas`.

### 3.5 Data model

```sql
CREATE TABLE leagues (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  emoji       text NOT NULL DEFAULT '🏆',
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE restrict,
  join_code   text NOT NULL UNIQUE,             -- short base62, rotatable
  visibility  text NOT NULL DEFAULT 'private',  -- private | unlisted | public
  season      text,                              -- current season key; NULL = no seasons
  unplayed_policy text NOT NULL DEFAULT 'exclude_break_streak',
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE TABLE league_members (
  league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'participant', -- participant | spectator | admin
  season    text,                                 -- NULL = all seasons
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, user_id)
);
CREATE TABLE arenas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id       uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  game_key        text,                           -- shareScoreDetection key; NULL = manual
  title           text NOT NULL,
  url             text,
  score_direction text NOT NULL DEFAULT 'desc',
  position        integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE league_entries (
  arena_id    uuid NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key  text NOT NULL,                       -- 'YYYY-MM-DD' (puzzle-day)
  score_value numeric,
  score_raw   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (arena_id, user_id, period_key)
);
CREATE INDEX league_entries_arena_period_idx ON league_entries (arena_id, period_key);
```

`league_entries` is `item_scores` re-parented to `arena_id`. Phase 2 reads the existing
`item_scores`; Phase 3 migrates them (§5).

### 3.6 API

- `GET /v1/leagues` — leagues the user belongs to (+ today's quick standings).
- `POST /v1/leagues` — create; creator becomes admin.
- `GET /v1/leagues/:id?window=today|week|all|rolling7&season=` — boards (per-arena + overall),
  streaks, participation.
- `POST /v1/leagues/:id/join` — body `{ code }`. `POST /v1/leagues/:id/join-code/reset` (admin).
- `PATCH /v1/leagues/:id` (admin) — name/emoji/visibility/season/unplayed_policy.
- `GET/POST/PATCH/DELETE /v1/leagues/:id/arenas` (admin for writes).
- `PUT /v1/arenas/:id/entries` — body `{ periodKey, scoreRaw }`. Participant only; idempotent.
- `DELETE /v1/leagues/:id/members/:userId` / `PATCH …/role` (admin).

### 3.7 UX / IA

```
◆ Geo Games                              today · Thu Jun 5      ⋯ (admin: settings)
[ Today  This week  All-time ]                        🔥 streaks
── Overall ────────────────────────────
 1. Renata  14 pts    2. Josh  11    3. Sam  9
── By game ─────────────────────────────
 maptap      5/8 played   leader Renata
 Globle      4/8 played   leader Josh        [Paste ＋]
 Daily Tens  7/8 played   leader Sam
"You haven't played Satle today"            [Open game]
```

A league screen defaults to **today**. Past periods are scrollable (NYT "scroll back and
gloat"). A gentle "you haven't played X today" nudge — never a hard window.

---

## 4. App shell

- **One Expo app.** A top-level switch between the two surfaces:
  - **Native:** a bottom tab bar — `◧ Lists` · `◆ Boards` — via expo-router `Tabs` (JS-only,
    no native module, no fingerprint bump).
  - **Web:** a sidebar switch in the `Screen`/`Layout` shell (web already constrains to a
    reading column).
- **Shared above the line:** account/auth, the share-extension capture pipeline (already routes
  to both `/share/pick-list` and `/share/pick-leaderboard`), OTA/TestFlight, design system,
  activity/notifications surface (extended to carry league events).
- **Divergent below the line:** the two data models and permission systems in §2 and §3.
- **Native-module note:** the places **map view** (`react-native-maps` or Expo Maps) _is_ a
  native module → requires an `app.json` `version` bump + a TestFlight build (CLAUDE.md runtime
  version guard). It's the only native addition in this spec; everything else is JS/OTA-able.
  Web map uses a lightweight non-native renderer.

---

## 5. Migration

One-shot, in the style of #199 — branch a Neon DB first (CLAUDE.md), verify on the migrate
smoke gate, merge.

**Lists:**

1. Add `place` to the kind registry; backfill `items.kind = 'place'` for `link` items whose
   `content` has `lat`/`lng` (the Google-Maps-backed rows). `link` stays for the rest.
2. Derive `category`/`neighborhood` into `content` for migrated places (one-time backfill via a
   reverse-geocode + Maps-type pass; cached, not re-derived on read).
3. "Date Ideas" → place collection. "Burgers" → `POST /merge` into "Date Ideas" with
   `tag=burgers` + a "Burgers" saved view; source list archived.

**Leaderboards (Phase 3):**

4. Create a `league` per existing `modules:[leaderboard]` list ("Geo Games"). Its items →
   `arenas` (carry `game_key`, `url`, `score_direction`); its `item_scores` → `league_entries`
   (`arena_id` ← migrated item); its `list_members` → `league_members` (owner → admin, members →
   participant). Archive the source list.
5. Deprecate the `leaderboard` module: remove from `MODULE_NAMES`, drop the `daily_games`
   template, retire the `/list/[id]/game/[itemId]` route.

(Phase 2 ships before any of step 4–5 and reads the un-migrated `item_scores` directly, so the
Leaderboards surface is live before the data moves.)

---

## 6. Resolved decisions

These were the open questions in exploration §8; resolved here as the spec's defaults (each can
still flip during planning):

1. **Tag model:** derived **and** manual. Derived ships first (Phase 0); manual tags + views in
   Phase 1.
2. **View scope:** **per-list** saved views. Cross-collection smart lists are future work (would
   relax the one-item-one-list rule — out of scope).
3. **App shell:** **one app + top-level switch.** Not two apps.
4. **Leagues rollout:** **aggregate-first.** Phase 2 = read-only Leaderboards home over existing
   `item_scores`; Phase 3 = real league tables + sharing + migration.
5. **Cross-game ranking:** **per-game boards first**, placement-points overall board as a
   fast-follow within the same phase.

---

## 7. Acceptance (what "done" means for the whole arc)

- "Date Ideas" renders category chips auto-derived from place type, a map view, and a
  Want-to-go/Been segment; "Burgers" exists as a one-tap saved view inside it, not a sibling
  list. No item was lost in the merge.
- A friend can join "Geo Games" with a code, post today's scores via the share-extension, and
  see today's per-game + overall board with streaks — with the league owning its own
  roles/visibility, independent of any list's membership.
- Native app shows a Lists/Boards bottom tab; web shows the sidebar switch. Auth, the
  share-extension, and OTA are unchanged and shared.
