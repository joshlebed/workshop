# List data model redesign — modules + content_type + duplication

Status: proposal, not yet implemented.
Tracking branch: `joshlebed/rethink-list-data-model-3n415b`.

## 1. Motivation

The current schema couples four orthogonal concerns into a single `lists.type`
enum:

1. What shape an item has (movie has a poster, book has an author).
2. How items get into the list (manual, Spotify pull, future: TMDB watchlist).
3. What interactions items support (votes, completion, leaderboards, ranking).
4. How the list is displayed (per-type screens, per-type sections).

Every new combination of these — "Spotify-sourced list with a leaderboard,"
"reading list with weekly check-ins," "voting poll cloned from a personal
shortlist" — requires a new `type` value, a new `metadata`-blob shape, and
per-type branches across backend, mobile, and web.

Two behaviors that should be reusable primitives are wired to single types:

- Leaderboards (`game_scores`) only exist for `game` lists.
- External sources (Spotify, via `lists.metadata.spotifyPlaylistUrl`) only
  exist for `album_shelf` lists.

This redesign generalizes both, while keeping the **items belong to exactly
one list** invariant — list re-use is via duplication (deep copy), not by
reference.

## 2. Core concepts

Three changes replace the type-driven model:

### Items get a typed content shape

An item carries a `content_type` (movie, book, link, plain, spotify_album,
…) and a `content` jsonb whose shape is determined by that type. Items still
belong to exactly one list (`items.list_id` stays).

### Lists are compositions of modules

A list declares which **modules** are enabled (`todo`, `voting`, `ranking`,
`leaderboard`, `sources`). The current `lists.type` enum becomes a
client-side preset — picking "Movie Watchlist" sets `item_kind_default=movie`
and `modules=[voting,todo,ranking]`. The DB no longer knows about the preset.

### Sources are first-class, external-only

A `list_sources` table tracks zero or more external feeds attached to a list
(today: `spotify_playlist`; later: `tmdb_watchlist`, RSS, etc.) with their
per-source refresh state. **Lists are never sources for other lists** —
internal re-use is via duplication only.

### Duplication is a one-shot deep copy

`POST /v1/lists/:id/duplicate` clones a list and its items into a brand-new
list owned by the requester. Future changes on either side don't propagate.
The requester can override `modules` / `item_kind_default` in the duplicate
request — the album-shelf-to-voting-poll flow is exactly:

```
POST /v1/lists/:albumShelfId/duplicate
{ "name": "Best album for movie night?",
  "modules": ["voting"],
  "preserveCompletion": false }
```

The new list has the same items (titles, content) but its own modules, its
own members, its own votes, its own activity stream. Adding albums to the
original album shelf does nothing to the poll.

## 3. Schema diff

```sql
-- lists: drop type+metadata, add modules + item_kind_default
ALTER TABLE lists
  ADD COLUMN modules text[] NOT NULL DEFAULT '{}',
  ADD COLUMN item_kind_default text;
-- drop after migration: lists.type, lists.metadata

-- items: add typed content; list_id stays
ALTER TABLE items
  ADD COLUMN content_type text,
  ADD COLUMN content jsonb NOT NULL DEFAULT '{}'::jsonb;
-- drop after migration: items.type, items.metadata
-- keep: items.list_id, items.title, items.url, items.note, items.completed,
--       items.completed_at, items.completed_by, items.added_by,
--       items.created_at, items.updated_at, items.archived_at

CREATE TABLE list_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id         uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  kind            text NOT NULL,    -- 'spotify_playlist' | future kinds
  config          jsonb NOT NULL,   -- kind-specific (e.g. { url, externalId })
  last_synced_at  timestamptz,
  last_synced_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX list_sources_list_idx ON list_sources (list_id);

-- generalize game_scores
CREATE TABLE item_scores (
  item_id         uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key      text NOT NULL,    -- 'YYYY-MM-DD' | 'YYYY-WNN' | 'all-time'
  score_value     numeric,          -- parsed numeric if available, for sort
  score_raw       text NOT NULL,    -- original input, preserves emojis/lines
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, user_id, period_key)
);
CREATE INDEX item_scores_item_period_idx ON item_scores (item_id, period_key);
CREATE INDEX item_scores_user_period_idx ON item_scores (user_id, period_key);
-- drop after migration: game_scores table
```

Everything else — `item_upvotes`, `activity_events`, `list_members`,
`list_invites`, `user_activity_reads` — is **unchanged**. `item_upvotes`
still keys on `(item_id, user_id)`; activity events still reference
`item_id`. No re-keying needed because items still belong to one list.

The Spotify per-list partial unique index moves columns only:
`(list_id, metadata->>'spotifyAlbumId')` becomes
`(list_id, content->>'spotifyAlbumId')` — same shape, new column.

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

- **`todo`** — items expose complete/uncomplete; UI renders a done section.
- **`voting`** — items can be upvoted by members (one vote per item per member).
- **`ranking`** — items have a manual `position` and an ordered/unordered split.
- **`leaderboard`** — items accept score submissions per `period_key`; the
  per-item leaderboard surface is exposed.
- **`sources`** — list can be attached to one or more `list_sources`.

A module is a string. The DB stores names; the app interprets them. Adding a
future module is a value in `lists.modules`, no migration.

## 4. Migration plan

A single Drizzle migration. Solo-dev / low-traffic, so we don't need an
online-migration dance.

1. **Add new columns and tables.**
   - `lists.modules`, `lists.item_kind_default`
   - `items.content_type`, `items.content`
   - tables: `list_sources`, `item_scores`

2. **Backfill in one transaction.**
   - For each `items` row:
     - `content_type` ← map of old `items.type` (`album_shelf` → `spotify_album`).
     - `content` ← `items.metadata` as-is (every existing field already lives there).
   - For each `lists` row:
     - `item_kind_default`, `modules` ← from the mapping table above.
   - For each `lists` row with `type='album_shelf'` and a
     `metadata.spotifyPlaylistUrl`: insert a `list_sources` row with
     `kind='spotify_playlist'`,
     `config = { spotifyPlaylistUrl, spotifyPlaylistId }`,
     `last_synced_at`/`last_synced_by` carried over.
   - For each `game_scores` row: insert an `item_scores` row with
     `period_key ← date`, `score_raw ← score`, `score_value` parsed when
     possible.

3. **Make new columns NOT NULL.** `items.content_type`.

4. **Cut over code in the same PR.** All read/write paths use the new
   columns. No dual-write window — the old columns are dead the moment the
   migration commits.

5. **Drop legacy.** `items.type`, `items.metadata`, `lists.type`,
   `lists.metadata`, and the `game_scores` table.

### Rollback

The migration is one-shot. Safety net is the standard Neon-branching
workflow (CLAUDE.md "Spin a Neon branch for a risky migration"): branch
immediately before, verify with the `Migrate smoke (fresh DB + idempotent
re-run)` CI gate, then merge to `main`. Post-deploy rollback is "restore
from the Neon branch."

## 5. Endpoint sketch

The external API is almost unchanged. Two new surfaces (`list_sources` and
list duplication); items keep their current `/v1/items/:id` and
`/v1/lists/:id/items` shapes because items still belong to a single list.

### Lists

- `GET /v1/lists` — unchanged shape.
- `POST /v1/lists` — body: `{ name, emoji, color, description?,
itemKindDefault, modules[], sources?[] }`. Presets ("Movie Watchlist")
  are client-side templates that build the request body. `sources?[]` at
  create time replaces today's "create with a Spotify URL" special case.
- `GET /v1/lists/:id` — unchanged shape; response now includes `modules`,
  `itemKindDefault`, and attached `sources[]`.
- `PATCH /v1/lists/:id` — can update `modules`, `item_kind_default`, plus
  the existing presentation fields.

### Duplicate

- `POST /v1/lists/:id/duplicate` — body:
  `{ name?, emoji?, color?, description?, modules?, itemKindDefault?,
preserveCompletion?: boolean, copySources?: boolean }`.
  Creates a new list with the requester as owner and sole member.
  Deep-copies non-archived items (new IDs, copied
  title/url/note/content/content_type/position). Does **not** copy:
  upvotes, scores, activity events, invites, members. Completion state
  resets to false unless `preserveCompletion: true`. Sources are dropped
  unless `copySources: true` (in which case configs clone but
  `last_synced_at` resets to null — the duplicate does its own first
  refresh).

### List sources

- `GET /v1/lists/:id/sources` → `{ sources: ListSource[] }`.
- `POST /v1/lists/:id/sources` — body: `{ kind, config }`. Validates the
  config (e.g. Spotify URL → playlist exists, public) and triggers an
  initial sync.
- `DELETE /v1/lists/:id/sources/:sourceId` — detaches. Items already
  imported stay (they're just regular items now); no cascading delete.
- `POST /v1/lists/:id/sources/:sourceId/sync` — manual refresh. Replaces
  today's album-shelf-specific refresh trigger.
- `POST /v1/sources/preview` — body: `{ kind, config }` → preview of what
  would be imported. Used by the create-list flow before commit.

### Items / interactions

Essentially unchanged from today — minor field renames only.

- `GET /v1/lists/:id/items` — same three-way split (ordered / unordered /
  completed). Item shape now includes `contentType` + `content`.
- `POST /v1/lists/:id/items` — body: `{ contentType, content, title?, url?,
note? }`.
- `POST /v1/lists/:id/items/bulk` — unchanged.
- `GET /v1/items/:id`, `PATCH /v1/items/:id`, `DELETE /v1/items/:id` —
  unchanged.
- `POST /v1/items/:id/upvote`, `DELETE /v1/items/:id/upvote` — unchanged;
  gated on the parent list having the `voting` module.
- `POST /v1/items/:id/complete`, `POST /v1/items/:id/uncomplete` — gated
  on the `todo` module.

### Scores (generalized)

- `PUT /v1/items/:id/scores` — body: `{ periodKey, scoreRaw }`. Gated on
  the parent list having the `leaderboard` module.
- `GET /v1/items/:id/scores?periodKey=…` — per-item leaderboard.
- `GET /v1/lists/:id/scores?periodKey=…` — all leaderboards on the list.

### Activity

Unchanged. New event types: `module_enabled`, `module_disabled`,
`source_added`, `source_removed`, `source_synced`, `list_duplicated`
(payload includes the source list ID).

## 6. UX implications worth flagging

- **Duplicate affordance.** The list detail screen gets a "Duplicate"
  action. The duplicate flow lets the user rename, re-emoji, and toggle
  modules in one step. The album-shelf → voting-poll workflow is the
  canonical example to design against.
- **Module pickers.** The create-list flow needs a way to express modules
  beyond preset bundles. v1 can keep presets only ("Movie Watchlist,"
  "Voting Poll," "Reading List," "Daily Game Tracker") and surface module
  toggles in the list settings sheet. Custom-module-set creation from
  scratch can wait until the presets feel constraining.
- **`sources` module visibility.** The list detail header gets a "Synced
  from Spotify" affordance and a manual refresh button — generic across
  any list with the `sources` module on, not just album shelves.

## 7. Open questions

7.1. **Who can duplicate a list?** Three options: owner only / owner +
members / anyone with an accepted invite. Recommendation: any member.
The duplicate is fully independent, so there's no privacy leak beyond
what the duplicating user already saw — Discord-style "I can fork a
server I'm in."

7.2. **Can you change modules after create?** Yes — `PATCH /v1/lists/:id`
accepts a new `modules` array. Disabling a module is non-destructive:
data isn't deleted, just hidden (e.g., disabling `leaderboard` keeps
`item_scores` rows but hides the surface). Re-enabling brings the data
back. This makes "duplicate, then switch from `[ranking]` to
`[voting]`" a clean operation.

7.3. **Should completion state copy on duplicate?** Default no. Reason:
the common case (album-shelf → poll, watchlist → recommend-to-friend) is
a fresh start. `preserveCompletion: true` is the opt-in for "duplicate
this and let me keep going from where I left off."

7.4. **Mixed `content_type` in one list.** Schema allows it
(`item_kind_default` is only a default). v1 product can restrict to
homogeneous; lifting it later when use cases appear (a Trip list with
restaurants + flights + hotels) costs nothing.

7.5. **Sync cadence for `sources` module.** Manual refresh only (today's
album-shelf behavior, generalized). Scheduled pull and webhook-driven
sync are future work; the table has the columns ready.

## 8. Sequencing

Five PRs, each independently shippable. Only PR-A has a migration.

1. **PR-A: schema migration + code cut-over.** Adds new columns/tables,
   backfills, drops old columns, updates handlers in one shot. Protected
   by Neon-branch + migrate-smoke. Same external API shape — clients see
   `modules`/`itemKindDefault`/`contentType`/`content` fields appear,
   `type`/`metadata` disappear.
2. **PR-B: list_sources surface.** New endpoints + the `sources` module
   wired through. Album-shelf's Spotify integration moves onto the new
   primitive; legacy code paths deleted.
3. **PR-C: leaderboard generalization.** `item_scores` is the only path;
   game-specific code paths deleted. Leaderboard module surfaces in the
   list-detail UI.
4. **PR-D: duplicate endpoint + UI.** The album-shelf-to-poll flow lands
   here. Server-side endpoint + the duplicate sheet in the mobile/web
   client.
5. **PR-E: modules in create/edit flow.** Module toggles in the list
   settings sheet; preset bundles re-expressed as client-side templates;
   legacy `type`-driven UI branches removed.
