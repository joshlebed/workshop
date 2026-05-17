# List data model redesign — items as content, lists as projections

Status: proposal, not yet implemented.
Tracking branch: `joshlebed/rethink-list-data-model-3n415b`.

## 1. Motivation

The current schema couples four orthogonal concerns into a single `lists.type`
enum:

1. What shape an item has (movie has a poster, book has an author).
2. How items get into the list (manual, Spotify pull, future: TMDB watchlist).
3. What interactions items support (votes, completion, leaderboards, ranking).
4. How the list is displayed (per-type screens, per-type sections).

Every new combination of these — "Spotify-sourced list with a leaderboard," "a
poll inheriting from another user's list of restaurants," "a reading list with
weekly check-ins" — requires a new `type` value, new metadata-blob shape, and
per-type branches across backend, mobile, and web.

Two further patterns reinforce that this is structural rather than incidental:

- `items.list_id` makes items captives of one list. Any "fork this list,"
  "vote on someone else's list without changing it," or "follow a friend's
  reading list" feature has to either duplicate data or invent a sidecar.
- Behaviors that should be reusable primitives (leaderboards via
  `game_scores`, external sources via `lists.metadata.spotifyPlaylistUrl`)
  are wired to single types. The leaderboard table is useful for any "score
  this thing repeatedly" surface; the source concept is useful for any
  "auto-populate from somewhere" surface.

## 2. Core concepts

Three primitives replace the type-driven model:

### Items are list-agnostic content

An `item` is a piece of content (a movie, a restaurant, a Spotify album). It
has a `content_type` and a typed `content` jsonb payload. It is not owned by a
list. Items have a single canonical title, URL, and content blob; per-list
overlays live elsewhere.

### Lists are projections of items

A `list_item` row is the appearance of an item inside a list. It carries the
per-list state: `position`, `note`, `completed`, `added_by`, `added_at`, and
(if inherited) `source_list_id`. Votes and scores reference `list_item_id`,
not `item_id`, so votes on the poll list don't bleed into the upstream
restaurant list.

### Lists are compositions of modules and sources

A list declares which **modules** are enabled (`todo`, `voting`, `ranking`,
`leaderboard`, `sources`) and zero or more **sources** that populate it. A
source is either external (`spotify_playlist`, future `tmdb_watchlist`, etc.)
or another Workshop list (`workshop_list`). Sources have a sync mode:
snapshot, mirror, or curated.

The current `lists.type` enum becomes a UI preset — at create time, picking
"Movie Watchlist" sets `item_kind_default=movie` and
`modules=[voting,todo,ranking]`. The DB no longer knows about the preset.

## 3. Schema diff

```sql
-- lists: drop type+metadata, add modules + item_kind_default
ALTER TABLE lists
  ADD COLUMN modules text[] NOT NULL DEFAULT '{}',
  ADD COLUMN item_kind_default text;
-- drop after migration:
--   lists.type, lists.metadata

-- items: become list-agnostic content
ALTER TABLE items
  ADD COLUMN content_type text,
  ADD COLUMN content jsonb NOT NULL DEFAULT '{}'::jsonb;
-- drop after migration:
--   items.list_id, items.type, items.position-via-metadata,
--   items.note, items.completed, items.completed_at, items.completed_by,
--   items.metadata (after content extracted)
-- keep: items.title, items.url (canonical), items.created_by,
--       items.created_at, items.updated_at, items.archived_at

CREATE TABLE list_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id         uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  item_id         uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  position        integer,
  note            text,
  completed       boolean NOT NULL DEFAULT false,
  completed_at    timestamptz,
  completed_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  added_by        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  added_at        timestamptz NOT NULL DEFAULT now(),
  source_list_id  uuid REFERENCES lists(id) ON DELETE SET NULL,
  source_list_item_id uuid REFERENCES list_items(id) ON DELETE SET NULL,
  archived_at     timestamptz,
  UNIQUE (list_id, item_id)
);
CREATE INDEX list_items_list_idx
  ON list_items (list_id, completed, added_at);
CREATE INDEX list_items_item_idx ON list_items (item_id);
CREATE INDEX list_items_source_idx
  ON list_items (source_list_id) WHERE source_list_id IS NOT NULL;

CREATE TABLE list_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id         uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  kind            text NOT NULL,    -- 'spotify_playlist' | 'workshop_list' | ...
  config          jsonb NOT NULL,   -- kind-specific
  sync_mode       text NOT NULL,    -- 'snapshot' | 'mirror' | 'curated'
  last_synced_at  timestamptz,
  last_synced_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX list_sources_list_idx ON list_sources (list_id);

-- generalize game_scores; rename + point at list_items
CREATE TABLE item_scores (
  list_item_id    uuid NOT NULL REFERENCES list_items(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key      text NOT NULL,    -- 'YYYY-MM-DD' | 'YYYY-WNN' | 'all-time'
  score_value     numeric,          -- parsed numeric if available (for sort)
  score_raw       text NOT NULL,    -- original input, preserves emojis/lines
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_item_id, user_id, period_key)
);
CREATE INDEX item_scores_li_period_idx ON item_scores (list_item_id, period_key);
CREATE INDEX item_scores_user_period_idx ON item_scores (user_id, period_key);

-- item_upvotes: re-key on list_item_id
ALTER TABLE item_upvotes
  ADD COLUMN list_item_id uuid REFERENCES list_items(id) ON DELETE CASCADE;
-- backfill, then drop item_id and re-PK on (list_item_id, user_id)

-- activity_events: reference list_items
ALTER TABLE activity_events
  ADD COLUMN list_item_id uuid REFERENCES list_items(id) ON DELETE CASCADE;
-- keep item_id during transition so we can read both; drop later

-- album-shelf dedup moves from per-list to global
CREATE UNIQUE INDEX items_spotify_album_idx
  ON items ((content->>'spotifyAlbumId'))
  WHERE content_type = 'spotify_album';
-- drop the old (list_id, spotifyAlbumId) partial index
```

### Type → modules / item_kind mapping

| old `type`    | `item_kind_default` | `modules`                          |
| ------------- | ------------------- | ---------------------------------- |
| `movie`       | `movie`             | `voting`, `todo`, `ranking`        |
| `tv`          | `tv`                | `voting`, `todo`, `ranking`        |
| `book`        | `book`              | `voting`, `todo`, `ranking`        |
| `date_idea`   | `date_idea`         | `voting`, `todo`, `ranking`        |
| `trip`        | `trip`              | `voting`, `todo`, `ranking`        |
| `album_shelf` | `spotify_album`     | `voting`, `ranking`, `sources`     |
| `game`        | `game`              | `voting`, `leaderboard`, `ranking` |

### Module catalog (initial)

- **`todo`** — items have a completion section; UI exposes complete/uncomplete.
- **`voting`** — items can be upvoted by members (one vote per member per list_item).
- **`ranking`** — items have a manual `position` and an ordered/unordered split.
- **`leaderboard`** — items accept score submissions per `period_key`; the per-item leaderboard surface is exposed.
- **`sources`** — list can be attached to one or more `list_sources`.

A module is just a name. The DB stores it as a string; the app interprets it.
Adding a future module is a string in `lists.modules`, no migration.

## 4. Migration plan

This is large but mechanical. Solo-dev, low traffic, so a single Drizzle
migration with a maintenance window is acceptable.

### Order of operations (one migration)

1. **Create new structures (additive, no read-path impact yet).**
   - Tables: `list_items`, `list_sources`, `item_scores`.
   - Columns: `lists.modules`, `lists.item_kind_default`, `items.content_type`,
     `items.content`, `item_upvotes.list_item_id`, `activity_events.list_item_id`.

2. **Backfill in a single transaction.**
   - For each `items` row:
     - `content_type` ← derived from old `items.type` (with `album_shelf`
       items mapped to `spotify_album`).
     - `content` ← merge of `items.metadata` minus `position` (the latter
       moves to `list_items.position`).
   - For each `items` row, insert a `list_items` row:
     - `list_id` ← `items.list_id`
     - `item_id` ← `items.id`
     - `position` ← `items.metadata->>'position'::int`
     - `note` ← `items.note`
     - `completed`, `completed_at`, `completed_by` ← from `items`
     - `added_by` ← `items.added_by`
     - `added_at` ← `items.created_at`
     - `archived_at` ← `items.archived_at`
   - For each `item_upvotes` row: set `list_item_id` ← `list_items.id` where
     `(list_id, item_id)` matches the upvote's `(items.list_id, item_id)`.
   - For each `game_scores` row: insert `item_scores` with
     `list_item_id` ← matching `list_items.id`, `period_key` ← `date`,
     `score_raw` ← `score`.
   - For each `activity_events` row with non-null `item_id`: set
     `list_item_id` from the same `(list_id, item_id)` lookup.
   - For each `lists` row with `type = 'album_shelf'` and
     `metadata.spotifyPlaylistUrl`: insert a `list_sources` row with
     `kind = 'spotify_playlist'`,
     `config = { spotifyPlaylistUrl, spotifyPlaylistId }`,
     `sync_mode = 'mirror'`, `last_synced_at`/`last_synced_by` from
     `lists.metadata`.
   - For each `lists` row: set `modules` and `item_kind_default` from the
     mapping table above.

3. **Make new columns NOT NULL where appropriate.**
   - `items.content_type`, `list_items.list_id/item_id/added_by`,
     `item_upvotes.list_item_id`.

4. **Swap read paths.** Code-only change: all queries now read from
   `list_items` joined with `items`. Backend handlers updated in the same PR
   as the migration so there's no in-between state.

5. **Drop legacy.**
   - Columns: `items.list_id`, `items.type`, `items.note`, `items.completed*`,
     `items.metadata`, `lists.type`, `lists.metadata`.
   - Re-PK `item_upvotes` on `(list_item_id, user_id)`; drop `item_id`.
   - Drop `activity_events.item_id` (after a release where it's read-but-not-
     written, to be safe with any external consumers — internally we have
     none, so this can collapse into the same migration).
   - Drop table `game_scores`.
   - Drop the per-list Spotify partial unique index; rely on the new global
     `items_spotify_album_idx`.

### Rollback

The migration is one-shot and not trivially reversible. The safety net is the
existing `pnpm db:branch` Neon branching workflow (see CLAUDE.md "Spin a Neon
branch for a risky migration"). Take a branch immediately before running, run
`Migrate smoke (fresh DB + idempotent re-run)` CI gate on it, and only then
merge to `main`. If a rollback is needed post-deploy, restore from the Neon
branch — there's no in-place down-migration worth maintaining for a change
this structural.

### Album-shelf dedup change

Today `(list_id, spotifyAlbumId)` is the dedup key on items; refreshes
upsert per-list. In the new model, the same album shared across multiple
lists is a single `items` row, dedup'd on `content->>'spotifyAlbumId'`.
Each list has its own `list_items` row pointing at it. Refresh becomes:
`INSERT ... ON CONFLICT (content->>'spotifyAlbumId') DO NOTHING` on items,
then `INSERT ... ON CONFLICT (list_id, item_id) DO NOTHING` on list_items.

## 5. Endpoint sketch

The external API mostly keeps its shape. `list_item_id` becomes the
primary identifier for "an item, in a list" — what clients always actually
mean — while `item_id` is the canonical content ID that's rarely surfaced.

### Lists

- `GET /v1/lists` — unchanged shape; `ListSummary` derived from
  `lists` + `list_members` + `list_items`.
- `POST /v1/lists` — body: `{ name, emoji, color, description?,
itemKindDefault, modules[], sources?[] }`. Preset selection is client-side
  ("Movie Watchlist" maps to a default request body). `sources` at create
  time is the path to "create a Spotify-sourced list" or "create a list
  inheriting from another list" in one call.
- `GET /v1/lists/:id` — same response shape.
- `PATCH /v1/lists/:id` — can update `modules`, `item_kind_default`, plus
  the existing presentation fields. Sources managed via the source endpoints.

### List sources (new)

- `GET /v1/lists/:id/sources` → `{ sources: ListSource[] }`.
- `POST /v1/lists/:id/sources` — body: `{ kind, config, syncMode }`.
- `DELETE /v1/lists/:id/sources/:sourceId` — detaches; inherited
  `list_items` are kept (with `source_list_id` nulled out) or dropped, owner
  choice — flag in the delete body.
- `POST /v1/lists/:id/sources/:sourceId/sync` — manual refresh; replaces
  today's album-shelf-specific refresh trigger.
- `POST /v1/sources/preview` — body: `{ kind, config }` → returns a
  preview of what would be imported. Used by both the Spotify preview flow
  and the new "preview another list's items before inheriting" flow.

### Items / list_items

- `GET /v1/lists/:id/items` — same three-way split response (ordered /
  unordered / completed) but each entry is a `ListItem` joined with its
  `Item`. Includes `sourceListId` for UI affordances.
- `POST /v1/lists/:id/items` — body: `{ contentType, content, title?, url?,
note? }`. Server creates the item if it doesn't exist (e.g., by Spotify
  album ID) and the list_item in one transaction.
- `POST /v1/lists/:id/items/bulk` — same shape, batch.
- `POST /v1/lists/:id/items/from-list` — body: `{ sourceListId,
itemIds?, mode: 'snapshot' | 'mirror' }`. Bulk-creates `list_items`
  pointing at items from another list. With `mode: 'snapshot'`, items are
  cloned (independent edits); with `'mirror'`, they're referenced (live
  updates if the source list changes the item's content). The poll-list
  use case is exactly this endpoint.
- `GET /v1/list-items/:id` — list-item detail (the per-list view that
  includes votes, completion, position, plus the underlying item content).
- `PATCH /v1/list-items/:id` — update `note`, `position`, completion.
- `DELETE /v1/list-items/:id` — soft-delete this appearance only; the
  underlying item is untouched.
- `PATCH /v1/items/:id` — update canonical content (title, url, content).
  Permission: `created_by`, or owner of any list this item currently
  appears in. (See open question 7.2.)

### Interactions

- `POST /v1/list-items/:id/upvote`, `DELETE /v1/list-items/:id/upvote`.
- `POST /v1/list-items/:id/complete`, `POST /v1/list-items/:id/uncomplete`
  (requires `todo` module enabled on the list).
- `PUT /v1/list-items/:id/scores` — body: `{ periodKey, scoreRaw }`.
  Requires `leaderboard` module.
- `GET /v1/list-items/:id/scores?periodKey=…` — leaderboard for one item.
- `GET /v1/lists/:id/scores?periodKey=…` — all leaderboards on the list.

### Activity

Same surface. `ActivityEvent.listItemId` replaces `itemId`; payload still
includes a content snapshot for events whose target may later be archived.

## 6. UX implications worth flagging early

- **Inheritance UI.** A list inheriting from another shows a small "Based
  on @user's `<list name>`" affordance per item; the user-readable badge
  should make clear that votes/notes/completion live in this list and the
  source list isn't affected.
- **Forking.** Snapshot inheritance + a "make my own copy" affordance is
  effectively a fork. The current "duplicate this list" pattern (none
  exists yet) collapses into this.
- **Permissions on canonical content.** When two lists reference the same
  item, an edit to the item's title shows up in both lists. The product
  question is whether to default-warn ("this item is shared with N other
  lists") or just let it propagate silently. Recommendation: warn only
  when editing an item that's referenced by a list the editor doesn't own.
- **Source visibility.** Inheriting from a private list requires an
  explicit grant; the simplest v1 is "only public lists and lists you own
  can be a workshop_list source." Public-list-ness isn't currently a
  concept; add an `is_public` flag on lists in the same migration if we
  want to ship inheritance in this round.

## 7. Open questions

7.1. **Item ownership on edit.** Currently no per-item ACL. With items
shared across lists, do we let the original creator always edit? Always
allow owners of any list it appears in? Lock content for snapshot copies?
Proposal: `created_by` and owners-of-any-list-it-appears-in can edit
canonical fields; snapshot mode clones the item so the fork has its own
editable copy.

7.2. **Mirror mode and item edits.** If list A's owner renames an item
and list B mirrors from A, does B see the rename? Yes — that's the whole
point of mirror. If B's owner doesn't want that, they pick snapshot mode.

7.3. **Inheriting completion / votes.** Should B inherit A's completion
state at the moment of import? Proposal: no. Completion is a per-list
interaction; B starts clean. Same for votes and scores.

7.4. **Mixed item_kind in one list.** The schema allows it
(`item_kind_default` is only the default). v1 product can restrict to
homogeneous lists; the constraint is cheap to lift later when a use case
appears (Trip list with mixed restaurants/flights/hotels).

7.5. **Public lists.** Inheritance needs a privacy model. Adding
`lists.is_public boolean` to the same migration is cheap and unblocks
"inherit from a stranger's list" flows. Owner-curated invite-only sharing
stays as it is today via `list_invites`.

7.6. **Sync cadence for mirror sources.** Pull-on-read (every list view
re-checks) is the simplest but spendy; pull-on-schedule (cron-style) needs
infra; pull-on-demand (manual refresh button) is what album-shelf does
today. v1: manual refresh for `workshop_list` sources, scheduled pull
later.

## 8. Sequencing

Suggested PR sequence so each lands shippable on its own:

1. **PR-A: schema migration + shim.** Land the new tables/columns, run
   the backfill, keep both old and new columns populated by write
   handlers. No external API change. CI's migrate-smoke gate runs against
   it. _(One large PR, but mechanical.)_
2. **PR-B: cut read paths over to `list_items` and the join.** All API
   endpoints updated. Same external response shape. Mobile/web unchanged.
3. **PR-C: drop legacy columns** (`items.list_id`, `items.type`,
   `items.completed*`, `lists.type`, `lists.metadata`, etc.).
4. **PR-D: surface `modules` + `item_kind` in list create/update.** Adds
   `POST /v1/lists` body fields; mobile/web get a "what's in this list"
   picker + module toggles in the create flow.
5. **PR-E: list_sources for `workshop_list`.** Implements inheritance
   endpoints and the per-item "Based on @user's list" UI. Spotify
   sources migrate over to the same primitive in the same PR.
6. **PR-F: `leaderboard` module generalization.** `game_scores` deletes,
   `item_scores` is the only path. UI for "leaderboard on any list."
7. **PR-G: presets.** Movie/TV/Book/Date/Trip/Album/Game become
   client-side preset bundles applied at list-create time; the legacy
   `type`-driven UI branches are removed.

Each PR has a clean rollback (revert merge); only PR-A has the migration,
and that one's protected by the Neon branch + migrate-smoke gate.
