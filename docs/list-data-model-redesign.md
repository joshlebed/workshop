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

An item carries a `content_type` (movie, tv, book, link, spotify_album,
plain) and a `content` jsonb whose shape is determined by that type. Items
still belong to exactly one list (`items.list_id` stays). Each
`content_type` has a zod schema in a shared registry (see §3.1) and writes
are validated server-side; unknown content_types are rejected. Adding a new
content_type is a code-only change.

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
-- content_type is text (not a Postgres enum) so adding new types is a
-- code-only change; the zod registry is the source of truth.
ALTER TABLE items
  ADD COLUMN content_type text,
  ADD COLUMN content jsonb NOT NULL DEFAULT '{}'::jsonb;
-- drop after migration: items.type, items.metadata
-- keep: items.list_id, items.title, items.url, items.note, items.completed,
--       items.completed_at, items.completed_by, items.added_by,
--       items.created_at, items.updated_at, items.archived_at

-- activity_events.event_type moves enum → text for the same reason; the
-- typed registry in @workshop/shared owns the set.
ALTER TABLE activity_events
  ALTER COLUMN event_type TYPE text USING event_type::text;
-- after migration: DROP TYPE activity_event_type;

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

### 3.1 Content schemas (the substrate beneath `items.content`)

Every `content_type` is defined by a zod schema in a shared registry. The
registry is the single source of truth for what `items.content` may contain
for each type, what's validated on write, and what TypeScript clients see
on read.

#### Where the registry lives

```
packages/shared/src/content.ts         // the registry + types + helpers
packages/shared/package.json           // add "./content": "./src/content.ts"
                                       // to the exports map (per the @workshop/shared
                                       // barrel constraint — same pattern as templates
                                       // and constants)
```

Backend (`apps/backend`) imports `validateContent`; mobile / web import
the inferred TypeScript types.

#### Initial catalog

Six content_types ship with the redesign. This is one fewer than today
because `date_idea`, `trip`, and the per-item content of `game` are all
structurally identical (open-graph link preview with optional geo); they
unify into `link`. Module-level differences (game scores, geo-aware
trip UI) are expressed through modules and template UX, not through
content_type.

| content_type    | shape (zod, all fields optional unless noted)                                                                                            | enrichment surface     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `movie`         | `{ source?: 'tmdb'\|'manual', sourceId?, posterUrl?, year?, runtimeMinutes?, overview? }`                                                | TMDB search            |
| `tv`            | `{ source?: 'tmdb'\|'manual', sourceId?, posterUrl?, year?, runtimeMinutes?, overview? }`                                                | TMDB search            |
| `book`          | `{ source?: 'google_books'\|'manual', sourceId?, coverUrl?, authors?: string[], year?, pageCount?, description? }`                       | Google Books search    |
| `link`          | `{ source?: 'link_preview'\|'manual', sourceId?, image?, siteName?, title?, description?, lat?, lng? }`                                  | OG/Twitter-card scrape |
| `spotify_album` | `{ source: 'spotify' (required), spotifyAlbumId (required), spotifyAlbumUrl, title, artist, year?, coverUrl?, trackCount?, detectedAt }` | Spotify sources        |
| `plain`         | `{ }` — empty object; uses `items.title` / `items.url` / `items.note` only                                                               | none                   |

`position` is **not** in any content schema — it lives on `items` proper
(see §3 schema diff), since it's a list-ordering concern that's
orthogonal to the content shape.

#### Shape of the registry

```ts
import { z } from "zod";

export const movieContent = z
  .object({
    source: z.enum(["tmdb", "manual"]).optional(),
    sourceId: z.string().optional(),
    posterUrl: z.string().url().optional(),
    year: z.number().int().optional(),
    runtimeMinutes: z.number().int().optional(),
    overview: z.string().optional(),
  })
  .strict(); // strict on write — see "Forward compatibility" below

// …tvContent, bookContent, linkContent, spotifyAlbumContent, plainContent…

export const CONTENT_SCHEMAS = {
  movie: movieContent,
  tv: tvContent,
  book: bookContent,
  link: linkContent,
  spotify_album: spotifyAlbumContent,
  plain: plainContent,
} as const;

export type ContentType = keyof typeof CONTENT_SCHEMAS;
export type ContentFor<T extends ContentType> = z.infer<(typeof CONTENT_SCHEMAS)[T]>;

export function validateContent<T extends ContentType>(
  contentType: T,
  content: unknown,
): ContentFor<T> {
  const schema = CONTENT_SCHEMAS[contentType];
  if (!schema) throw new UnknownContentTypeError(contentType);
  return schema.parse(content) as ContentFor<T>;
}
```

The discriminated-union helper `ContentFor<T>` gives clients
type-narrowed access to the content payload once `contentType` is known.

#### Write path

Item creation (`POST /v1/lists/:id/items`) and item update
(`PATCH /v1/items/:id`) both call `validateContent(contentType, content)`
before writing. Failures return `400 Bad Request` with the zod error path

- message (`{ error: "invalid_content", field: "content.year", message:
"Expected integer" }`).

Schemas are **strict on write**: unknown keys are rejected. This prevents
silent client drift (a typo or a stale field name landing in the DB
forever).

#### Read path

Reads do not re-validate. The server trusts what's in the DB and returns
the jsonb as-is. Older rows whose shape has drifted from the latest
schema (a field was added later, an enum value was retired) are still
readable; the client is responsible for treating all fields as optional
in TypeScript.

#### Forward compatibility

The hardening rules that keep this evolving cleanly:

- **Add new fields as optional, always.** Required fields can never be
  added retroactively without a data migration that backfills them; in
  practice, almost everything stays optional forever.
- **Don't remove fields you've already written.** If a field stops being
  used, mark it `.optional()` and `.describe("DEPRECATED")` rather than
  deleting it — strict-on-write will then reject new writes of it, but
  old rows still parse. Truly cleaning up is a one-shot Drizzle migration
  that rewrites `items.content` in place, and shouldn't be necessary
  until the schema accumulates real dead weight.
- **`content_type` is a registry key, not an enum value.** Adding a new
  type (`vinyl`, `recipe`, `restaurant`) is one entry in
  `CONTENT_SCHEMAS` plus the zod object. No Postgres migration. No
  client deploy required to read existing rows; writes of the new type
  fail at validation in the old client, which is correct behavior.

#### Why strict-on-write, not passthrough

The alternative — `z.object({...}).passthrough()` — lets unknown fields
through to the DB. Tempting because clients can ship new fields ahead of
the server, but the cost is permanent: any typo, stale field name, or
half-finished prototype field ends up in jsonb forever, polluting the
schema's signal. Strict-on-write is the cheap rule that keeps the
content shape honest; the cost (coordinated client+server deploys for
new fields) is small and we already pair-deploy via PR-A and friends.

### Type → modules / item_kind mapping

| old `type`    | `item_kind_default` | `modules`                          |
| ------------- | ------------------- | ---------------------------------- |
| `movie`       | `movie`             | `voting`, `todo`, `ranking`        |
| `tv`          | `tv`                | `voting`, `todo`, `ranking`        |
| `book`        | `book`              | `voting`, `todo`, `ranking`        |
| `date_idea`   | `link`              | `voting`, `todo`, `ranking`        |
| `trip`        | `link`              | `voting`, `todo`, `ranking`        |
| `album_shelf` | `spotify_album`     | `voting`, `ranking`, `sources`     |
| `game`        | `link`              | `voting`, `leaderboard`, `ranking` |

`date_idea`, `trip`, and `game` all collapse into the `link` content_type
because their stored item shape is structurally identical (OG-preview +
optional geo). The semantic difference (a trip itinerary vs a daily game
tracker) lives in the template, the modules, and the UI — not in the
content shape.

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
     - `content_type` ← map of old `items.type`:
       `movie`→`movie`, `tv`→`tv`, `book`→`book`, `album_shelf`→`spotify_album`,
       `date_idea`/`trip`/`game`→`link`.
     - `content` ← `items.metadata` minus any keys not in the new content
       schema (e.g., the old `position` jsonb key, which moves to a real
       column in a future revision; today it stays in `content` since
       `items.position` doesn't exist as a real column yet — see open
       question 9.7).
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

3. **Rename + generalize activity events** (in the same transaction). See
   §4.1 below for the full mapping. Net effect: four legacy event types
   are renamed in place via `UPDATE activity_events SET event_type = …`;
   no rows are deleted.

4. **Make new columns NOT NULL.** `items.content_type`.

5. **Cut over code in the same PR.** All read/write paths use the new
   columns. No dual-write window — the old columns are dead the moment the
   migration commits.

6. **Drop legacy.** `items.type`, `items.metadata`, `lists.type`,
   `lists.metadata`, and the `game_scores` table. `DROP TYPE
activity_event_type` (the column moved to `text` in step 1).

### 4.1 Activity event migration

The current `activity_event_type` Postgres enum has 22 values. The
redesign retires four album-shelf-specific events into the new generic
source/item events, adds seven new event types for the module / source /
duplicate surfaces, and migrates the column from a Postgres enum to a
typed-registry-backed text column (same reasoning as `content_type` and
`lists.modules`: app-layer registry, no `ALTER TYPE` ceremony to add a
new event).

**Rename in place (data-rewriting UPDATEs in the migration):**

| from                         | to               | payload change                     |
| ---------------------------- | ---------------- | ---------------------------------- | --- | ------------------------------- |
| `album_shelf_refreshed`      | `source_synced`  | `payload                           |     | { "kind": "spotify_playlist" }` |
| `album_shelf_source_changed` | `source_updated` | `payload                           |     | { "kind": "spotify_playlist" }` |
| `album_promoted`             | `item_promoted`  | none — semantics already identical |
| `album_demoted`              | `item_demoted`   | none — semantics already identical |

```sql
UPDATE activity_events
SET event_type = 'source_synced',
    payload    = payload || jsonb_build_object('kind', 'spotify_playlist')
WHERE event_type = 'album_shelf_refreshed';

UPDATE activity_events
SET event_type = 'source_updated',
    payload    = payload || jsonb_build_object('kind', 'spotify_playlist')
WHERE event_type = 'album_shelf_source_changed';

UPDATE activity_events SET event_type = 'item_promoted' WHERE event_type = 'album_promoted';
UPDATE activity_events SET event_type = 'item_demoted'  WHERE event_type = 'album_demoted';
```

**Kept as-is** (16 event types): `list_created`, `list_archived`,
`member_joined`, `member_left`, `member_removed`, `item_added`,
`item_updated`, `item_archived`, `item_upvoted`, `item_unupvoted`,
`item_completed`, `item_uncompleted`, `item_promoted`, `item_demoted`,
`invite_created`, `invite_revoked`. Plus the legacy `item_deleted` (no
new writes since 2026-05; kept readable for old rows).

**Added by the redesign** (7 new event types):

| event_type        | when fired                               | payload                                                             |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `module_enabled`  | `PATCH /v1/lists/:id` adds a module      | `{ module: string }`                                                |
| `module_disabled` | `PATCH /v1/lists/:id` removes a module   | `{ module: string, affectedCount: number, warningCodes: string[] }` |
| `source_added`    | `POST /v1/lists/:id/sources`             | `{ kind: string, config: jsonb (sanitized) }`                       |
| `source_removed`  | `DELETE /v1/lists/:id/sources/:sourceId` | `{ kind: string }`                                                  |
| `source_synced`   | sync run (manual or scheduled)           | `{ kind, addedCount, removedCount, errorMessage? }`                 |
| `source_updated`  | source config edited                     | `{ kind, previousConfig: jsonb, nextConfig: jsonb }` (sanitized)    |
| `list_duplicated` | `POST /v1/lists/:id/duplicate` (on dupe) | `{ sourceListId, sourceName, itemCount }`                           |

**Client-side copy templates** — the mobile/web `formatActivityEvent`
helper switches on `event_type`. Renaming the four legacy types means
the four old `case` branches go away; adding seven new types adds seven
branches. Trivial PR for the client.

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
  the existing presentation fields. Destructive module changes require an
  `acknowledgedWarnings: string[]` field echoing the warning codes returned
  by the config-preview endpoint below; without it, the server returns
  `409 Conflict` with the warning list. See §6.
- `POST /v1/lists/:id/config-preview` — body:
  `{ modules?: string[], itemKindDefault?: string }` → returns
  `{ warnings: ConfigWarning[] }` where each warning is
  `{ code: string, message: string, affectedCount?: number }`. The client
  uses this to render a confirmation sheet before applying. Always-empty
  for empty lists (no non-archived items). See §6.

### Duplicate

- `POST /v1/lists/:id/duplicate` — body:
  `{ name?, emoji?, color?, description?, modules?, itemKindDefault?,
preserveCompletion?: boolean, copySources?: boolean }`.
  Creates a new list with the requester as owner and sole member.
  Deep-copies non-archived items (new IDs, copied
  title/url/note/content/content_type/position). Does **not** copy:
  upvotes, scores, activity events, invites, members. Completion state
  resets to false unless `preserveCompletion: true`. Sources are dropped
  unless `copySources: true` (in which case configs clone with
  `last_synced_at` reset to null; the duplicate does **not** auto-sync
  — the user triggers a manual refresh from the duplicate list if they
  want a fresh pull). The duplicate is not transactionally consistent
  with concurrent edits on the source list: if items are being added /
  edited / archived mid-copy, the duplicate captures whatever was
  visible at row-read time. For this app's traffic profile (single-user
  - small groups), best-effort copy is the right tradeoff.

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
  gated on the parent list having the `voting` module (see §5.1).
- `POST /v1/items/:id/complete`, `POST /v1/items/:id/uncomplete` — gated
  on the `todo` module (see §5.1).

### Scores (generalized)

- `PUT /v1/items/:id/scores` — body: `{ periodKey, scoreRaw }`. Gated on
  the parent list having the `leaderboard` module.
- `GET /v1/items/:id/scores?periodKey=…` — per-item leaderboard.
- `GET /v1/lists/:id/scores?periodKey=…` — all leaderboards on the list.

### Activity

Surface unchanged. Event-type set is renormalized per §4.1.

### 5.1 Module gate semantics

A list's `modules` array is the single source of truth for which features
are active. Two distinct surfaces interact with module state:

**Listing endpoints** (`GET /v1/lists/:id`, `GET /v1/lists/:id/items`,
`GET /v1/items/:id`) **omit module-gated fields** from the response when
the relevant module is off. No `upvoteCount` when `voting` is off; no
`completed` / `completedAt` / `completedBy` when `todo` is off; no
`position` when `ranking` is off; no `scoresAvailable` when `leaderboard`
is off. The list's `modules` array is always in the response, so the
client can render visibility from a single source of truth and never
reads preserved-but-hidden data.

**Module-specific endpoints** (`POST /v1/items/:id/upvote`,
`POST /v1/items/:id/complete`, `PUT /v1/items/:id/scores`,
`GET /v1/items/:id/scores`, etc.) **return `409 Conflict`** when the
gating module is off — for both reads and writes. The 409 body uses a
stable error contract:

```json
HTTP 409 Conflict
{
  "error": "module_disabled",
  "code": "voting.disabled",
  "module": "voting",
  "message": "This list doesn't have voting enabled. Turn it on in list settings to upvote items."
}
```

The `code` is `<module>.disabled` for every gated module. The `message`
is server-authored, human-readable, and includes an actionable
instruction. Clients render the message inline (or as a toast) and, if
the requesting user is the list owner, may surface a deep link to the
settings sheet using the `module` field.

**Why 409 and not 404 or 403:** 409 ("Conflict") correctly captures
"the resource is in a state incompatible with this request"; 404 hides
the actionable reason ("does this not exist? am I missing access?"),
and 403 implies a permission failure the user can't fix from here. 409
with a stable code lets the client render the right recovery UI.

**Defense in depth.** Per §6, well-behaved clients shouldn't be calling
module-gated endpoints when the gating module is off — they read
`list.modules` and hide the affordances. The 409 protects against:
stale cached lists, race conditions where a module is disabled mid-flow,
buggy or out-of-date clients, and third-party API consumers.

## 6. Mutating list config after creation

A list's `modules` and `item_kind_default` aren't frozen at create time — a
user can switch a `[ranking]` shopping list into a `[voting]` poll, add a
`leaderboard` to a watchlist, or turn off `todo` and treat a list as a pure
notes board. Two principles govern how those mutations work:

**Principle 1 — empty lists are free to reshape.** If a list has no
non-archived items, any config change is silent. The
`/v1/lists/:id/config-preview` endpoint returns an empty warning array; the
client skips the confirmation sheet.

**Principle 2 — modules are display toggles over preserved data.** Disabling
a module never deletes rows. It hides the corresponding UI surface, gates
the related endpoints, and leaves the underlying rows untouched. Re-enabling
the module brings every prior datum back exactly as it was. This is the
contract that makes "experiment with the list shape" safe, and the contract
that makes the engineering side mechanical.

### Module change taxonomy

For a non-empty list, here's what each delta does and whether the user is
warned. Warnings have stable codes so clients can render localized copy and
echo them back on the PATCH:

| change                   | impact on data                                                    | warning code                 |
| ------------------------ | ----------------------------------------------------------------- | ---------------------------- |
| add `todo`               | new "Done" section appears; items default to incomplete           | none                         |
| remove `todo`            | done section hidden; `items.completed*` columns preserved         | `todo.hide_completed`        |
| add `voting`             | upvote affordance appears                                         | none                         |
| remove `voting`          | upvote affordance hidden; `item_upvotes` rows preserved           | `voting.hide_upvotes`        |
| add `ranking`            | items gain manual `position`; default to unordered                | none                         |
| remove `ranking`         | manual-order section hidden; `items.position` preserved           | `ranking.hide_order`         |
| add `leaderboard`        | score submission appears                                          | none                         |
| remove `leaderboard`     | scores hidden; `item_scores` rows preserved                       | `leaderboard.hide_scores`    |
| add `sources`            | source attachment becomes possible                                | none                         |
| remove `sources`         | sources stop syncing; `list_sources` rows preserved; items stay   | `sources.deactivate_sources` |
| change `itemKindDefault` | affects future items only; existing items keep their content_type | none (informational hint OK) |

Two rules read off this table: **adding any module is always silent** (the
new affordance turns on, no data is at risk); **removing a module that has
associated data emits exactly one warning code** carrying the affected-row
count. The warning is a confirmation prompt, not a permission gate — the
user can always proceed; nothing is lost if they do.

### Engineering abstraction: module manifests

To keep this from sprawling, every module is defined by a single
server-side manifest:

```ts
type ModuleManifest = {
  name: ModuleName;
  // Inspect the list state and report any warnings that would fire
  // if this module were removed. Called by /config-preview and by PATCH
  // when the module is being removed without acknowledgement.
  inspectRemoval: (listId: string, tx: DbConn) => Promise<ConfigWarning[]>;
  // Optional hooks — most modules don't need these because data is
  // preserved automatically. `sources` uses onDisable to stop scheduled
  // syncs (when those land); nothing else implements them today.
  onEnable?: (listId: string, tx: DbConn) => Promise<void>;
  onDisable?: (listId: string, tx: DbConn) => Promise<void>;
};
```

The list-config code path is then a small generic loop:

```ts
// /config-preview and PATCH both call this
async function previewModuleChange(listId, currentModules, nextModules, tx) {
  const removed = currentModules.filter((m) => !nextModules.includes(m));
  const warnings: ConfigWarning[] = [];
  for (const moduleName of removed) {
    const manifest = MODULE_REGISTRY[moduleName];
    warnings.push(...(await manifest.inspectRemoval(listId, tx)));
  }
  return warnings;
}
```

Adding a future module (`scheduling`, `comments`, `attachments`) means
registering one manifest. No changes to PATCH, to the preview endpoint, to
the client confirmation flow, or to activity logging. The abstraction is
the registry; everything else is generic.

### Content schema evolution (separate from modules)

Module toggles never touch `items.content`. The other axis of config drift
is the **shape** of `content` for a given `content_type` — e.g., we want
to add a `runtimeMinutes` field to `movie` items. The rule there is
forward-compatible: every `content` schema is a zod object with optional
fields and sensible defaults; readers never assume newer fields exist on
older rows. Adding a field is a code-only change. Removing a field is
allowed but the underlying jsonb is left intact (next-time-read just
ignores it). If a future content_type evolves enough to need a hard
migration, the path is a dedicated one-shot Drizzle migration that
rewrites `items.content` in place — but the v1 module/content_type set
shouldn't need that.

### Content-type conversion on existing items

Out of scope for v1. A user converting an `[item_kind_default=movie]` list
into a `[voting]` poll keeps the existing items as `content_type=movie`;
the list's poll affordances just operate on whatever items are present.
"Bulk-convert every item in this list to a different content_type" is a
sharper-edged operation that, if it ever ships, gets its own dedicated
endpoint with its own warning surface — not a side effect of changing
`item_kind_default`.

### Why not store derived flags on items

A tempting shortcut would be a `list.featuresHidden: { todo: true }`
flag, or per-item booleans that mirror the parent list's modules. Both
are anti-patterns: they let display state drift from the source of truth
(`lists.modules`), and they require write traffic on every toggle. The
single source of truth is the array on the list; the UI computes
visibility from it. The data rows underneath (`items.completed*`,
`item_upvotes`, `item_scores`, `items.position`) are oblivious to the
toggle state.

### Activity events for config changes

`module_enabled` / `module_disabled` events (already in the plan) get a
`payload.affectedCount` field when the disable surfaces hidden data, so
the activity feed can render "@josh turned off completion (3 done items
hidden)." Re-enabling restores both data and the activity-feed
attribution; the disable+enable pair forms a clean round-trip.

### 6.1 Display rules — what each module configuration looks like on screen

Disabled modules are invisible to the renderer **and** the server's read
path. Neither the client UI nor the GET endpoints surface data behind a
disabled module (§5.1). What's left is the question: given the modules
that **are** on, what does the list screen actually look like?

The display falls out of a small grid driven by two modules that affect
sectioning (`ranking` and `todo`); the other three (`voting`,
`leaderboard`, `sources`) decorate items or add list-header chrome and
don't affect sectioning. This keeps the rules first-principles and
trivially derivable from `list.modules`.

#### Sectioning grid (driven by `ranking` × `todo`)

| `ranking` | `todo` | sections on the list detail screen                                                                         |
| --------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| off       | off    | **Single section**, items sorted by `added_at` desc                                                        |
| off       | on     | **To do** (incomplete, `added_at` desc) + **Done** (completed, `completed_at` desc)                        |
| on        | off    | **Ordered** (items with `position` set, `position` asc) + **Unordered** (`position` null, `added_at` desc) |
| on        | on     | **Ordered** + **Unordered** + **Done**                                                                     |

Rules for the on/on case (today's default for most types):

- Completed items move to the **Done** section regardless of whether they
  had a `position` — completion takes precedence over ranking. Uncompleting
  restores the item to whichever of Ordered / Unordered its `position`
  dictates.
- The **Ordered** section uses drag-to-reorder; **Unordered** doesn't (it's
  sorted by recency). Dragging an item from Unordered into Ordered sets
  its `position`; dragging it back to Unordered nulls `position` (this
  matches today's `item_promoted` / `item_demoted` semantics).

#### Decoration rules (driven by the other modules)

Each rule applies independently of sectioning; mix freely:

- **`voting` on** — every item card shows an upvote pill (count +
  current-user toggle state). No re-sorting by upvote count by default
  (would conflict with `ranking`); a future sort-mode picker can add
  it as an option. **Off** — upvote pill not rendered, upvote endpoints
  return 409.
- **`leaderboard` on** — the item detail screen shows a per-period
  leaderboard table and a score-submission form; the list screen may
  show a small "today's top" inline strip when at least one item has
  scores for the current period. **Off** — both surfaces hidden, score
  endpoints return 409.
- **`sources` on** — the list header gets a "Synced from <X>" affordance
  and a manual refresh button; items whose `content.source` is set get
  a small provenance badge ("via Spotify"). **Off** — header chrome and
  badges hidden, source endpoints return 409.

#### Item detail screen

The item detail screen renders each section conditionally on its module:

- Title / URL / note — always shown.
- Content fields (poster, year, authors, lat/lng, etc.) — always shown
  if present, since they're content_type-driven, not module-driven.
- Upvote pill — only if `voting` is on.
- Completion toggle — only if `todo` is on.
- Position controls / Move to top / Move to bottom — only if `ranking` is on.
- Leaderboard + score-submission form — only if `leaderboard` is on.
- Source provenance badge — only if `sources` is on (and `content.source`
  is set).

#### Why these rules and not others

A few decisions worth naming explicitly so the next reviewer doesn't
re-litigate them:

- **Completion always wins over ranking.** A finished item in a
  reading-list-with-ordering shouldn't sit between "next up" items
  pretending to still need attention. The Done section is the right
  home; reactivating an item brings it back into Ordered or Unordered
  per its `position`.
- **Voting doesn't drive sort by default.** Mixing upvote-driven sort
  with manual ranking causes drag-to-reorder confusion ("I dragged it
  here, why did it move?"). Treating voting as a per-item decoration
  keeps the two orthogonal. A future "sort by upvotes" mode is a UI
  option, not a structural change.
- **No "Top voted" pinned section.** Tempting, but it'd be an
  inconsistent fourth section that fights the on/on layout. If we want
  to surface top-voted items, an inline header strip ("Most voted:
  Apocalypse Now (5 votes)") is cheaper and doesn't reorder anything.
- **`sources` doesn't section.** Sourced and manual items live
  side-by-side in the same sections; only the provenance badge
  distinguishes them. Mixing sourced + manual is a feature (you can
  add albums to a Spotify-sourced list), so segregating them visually
  would discourage exactly what we want to encourage.

## 7. Templates (the new home for "list types")

`lists.type` going away doesn't mean the user-facing concept of "a Movie
Watchlist" goes away — it just stops being a database column. The
replacement is a **template**: a hardcoded, client-side, named bundle of
defaults that the create-list flow uses to construct a `POST /v1/lists`
body. Templates exist only in the client; the server stores the
materialized config (`modules`, `item_kind_default`, attached `sources`)
and never learns which template seeded it.

### Continuity with today's `lists.type`

Every value of today's `type` enum maps 1:1 to an initial template. The
post-migration data is identical: a `type='movie'` list and a list
created from the `movie_watchlist` template both have
`item_kind_default='movie'` and `modules=['voting','todo','ranking']`.
Users see the same set of options in the create-list picker; the
underlying representation is just decoupled from it.

### Initial catalog

Shipped with the redesign:

| template id       | display name       | `item_kind_default` | `modules`                          | extras                                               |
| ----------------- | ------------------ | ------------------- | ---------------------------------- | ---------------------------------------------------- |
| `movie_watchlist` | Movie Watchlist    | `movie`             | `voting`, `todo`, `ranking`        | emoji 🎬, color sunset                               |
| `tv_watchlist`    | TV Watchlist       | `tv`                | `voting`, `todo`, `ranking`        | emoji 📺, color ocean                                |
| `reading_list`    | Reading List       | `book`              | `voting`, `todo`, `ranking`        | emoji 📚, color forest                               |
| `date_ideas`      | Date Ideas         | `date_idea`         | `voting`, `todo`, `ranking`        | emoji ✨, color rose                                 |
| `trip_plan`       | Trip Plan          | `trip`              | `voting`, `todo`, `ranking`        | emoji ✈️, color sand                                 |
| `album_shelf`     | Album Shelf        | `spotify_album`     | `voting`, `ranking`, `sources`     | prompts for Spotify playlist URL (`requiresSource`)  |
| `daily_games`     | Daily Game Tracker | `game`              | `voting`, `leaderboard`, `ranking` | emoji 🎮, color slate                                |
| `voting_poll`     | Voting Poll        | `plain`             | `voting`                           | new — flagship example of the redesign's flexibility |
| `shared_todo`     | Shared To-Do List  | `plain`             | `todo`, `ranking`                  | new                                                  |
| `blank_list`      | Blank List         | `plain`             | `ranking`                          | new — escape hatch for "just give me a list"         |

The first seven preserve today's product. The last three are new shapes
the redesign unlocks; they're worth shipping at the same time so users
feel the win.

### Where templates live

Pure-runtime constants in the workspace shared package, exported via a
dedicated subpath because of the `@workshop/shared` barrel constraint
documented in CLAUDE.md (the barrel re-exports `./types.js`, which Metro
can't resolve at runtime — runtime values must come from a subpath):

```
packages/shared/src/templates.ts          // catalog + type
packages/shared/package.json              // add "./templates": "./src/templates.ts"
                                          //   to the exports map
```

Shape:

```ts
export type ListTemplate = {
  id: string;
  displayName: string;
  description: string; // short copy for the picker card
  defaults: {
    itemKindDefault: ContentType;
    modules: ModuleName[];
    emoji?: string;
    color?: ListColor;
  };
  // Optional — if set, the create flow prompts for source config
  // (e.g., the Spotify playlist URL) before commit.
  requiresSource?: {
    kind: SourceKind;
    promptCopy: string;
  };
};

export const LIST_TEMPLATES: readonly ListTemplate[] = [
  /* … */
];
```

Both the mobile app and the web build import this catalog. The backend
does not — templates are a UI affordance, not a DB concept.

### How users diverge from a template

The moment a list exists, its template ID is forgotten. The user can:

- Change modules via the settings sheet (§6 governs the warnings).
- Change `item_kind_default` (new items only, see §6).
- Add or remove sources independently of `requiresSource`.

There's no "this list deviates from its template" UX — the list just is
what it is. This is intentional. Templates are nudges, not constraints;
binding the runtime config to a template would re-introduce the
`type`-enum coupling we're explicitly dismantling.

### Adding new templates

A new template is one entry in `LIST_TEMPLATES`. No schema migration, no
backend change, no API change. The expectation is that the catalog grows
freely (`fantasy_draft`, `book_club`, `weekend_chores`, etc.) as the
product surfaces more presets — each one is a few lines of TypeScript
and a copy review.

If a new template needs a module that doesn't exist yet, the module is
the migration-worthy step (register a manifest per §6); adding the
template afterward is trivial.

### Templates vs modules — a quick mental model

- **Module** — a durable, server-known unit of behavior on a list.
  Stored on `lists.modules`. The thing the engineer reasons about.
- **Template** — a friendly client-side preset that materializes into a
  module set at create time. The thing the user reasons about. Lives
  in `@workshop/shared/templates`, never touches the server.

The mapping is one-way: template → modules. Two lists from the same
template diverge the moment either is edited; that's fine.

### Where this leaves server-side derived UX (notifications, analytics)

Today the backend's Discord webhook (`apps/backend/src/lib/discord.ts`)
fires "new list created" pings that read `list.type` for the message
body. Post-redesign, that field doesn't exist; the server doesn't know
which template seeded the list. The replacement is to render the
notification from `list.name` + `list.modules` (and `itemKindDefault`
when worth surfacing): "Sarah created **Movie Watchlist** (movie list,
voting · todo · ranking)" or just "Sarah created **Movie Watchlist**"
when terse is fine. Analytics treat modules as the categorical axis,
not templates; this is strictly better than the old enum because it
exposes the actual capabilities of the list, not the bundle name that
shipped them.

## 8. UX implications worth flagging

§6.1 covers the per-config display rules. The points worth flagging
separately, mostly about flow entry points and chrome:

- **Duplicate affordance.** The list detail screen gets a "Duplicate"
  action available to any member (per 9.1). The duplicate sheet lets
  the user rename, re-emoji, and toggle modules in one step. The
  album-shelf → voting-poll workflow is the canonical example to
  design against.
- **Template picker as the create-list entry point.** Vertical list of
  template cards from the §7 catalog, each showing display name,
  description, and a representative emoji/color. Picking one drops the
  user into the per-template prompt (e.g., name + Spotify playlist URL
  for `album_shelf`); the "Blank List" template gives a power-user
  escape hatch into manual module selection.
- **Settings sheet ≠ template picker.** Once a list exists, the
  settings sheet exposes raw module toggles (§6) — templates aren't
  shown there. Re-deriving "this looks like a Reading List" from the
  current module set is possible but not worth the complexity (open
  question 9.6).

## 9. Open questions

9.1. **Who can duplicate a list?** Three options: owner only / owner +
members / anyone with an accepted invite. Recommendation: any member.
The duplicate is fully independent, so there's no privacy leak beyond
what the duplicating user already saw — Discord-style "I can fork a
server I'm in."

9.2. **Should completion state copy on duplicate?** Default no. Reason:
the common case (album-shelf → poll, watchlist → recommend-to-friend) is
a fresh start. `preserveCompletion: true` is the opt-in for "duplicate
this and let me keep going from where I left off."

9.3. **Mixed `content_type` in one list.** Schema allows it
(`item_kind_default` is only a default). v1 product can restrict to
homogeneous; lifting it later when use cases appear (a Trip list with
restaurants + flights + hotels) costs nothing.

9.4. **Sync cadence for `sources` module.** Manual refresh only (today's
album-shelf behavior, generalized). Scheduled pull and webhook-driven
sync are future work; the table has the columns ready.

9.5. **"Show hidden module data" as an admin escape hatch.** Per §6, data
from a disabled module is preserved but invisible. The confirmation
sheet for _enabling_ a module shows the preserved-data summary,
mirroring the disable warning. No separate viewer needed.

9.6. **Should templates be discoverable post-creation?** Currently no —
the template ID is lost the moment the list exists. If template browsing
turns out to be useful (e.g., "duplicate as a different template"), the
cheapest path is to derive a best-match template from the current
`(item_kind_default, modules)` tuple at render time; no schema needed.
Defer until use cases demand it.

9.7. **`items.position` should probably move out of `items.content`.**
Today's `metadata.position` jsonb key technically maps to a `content`
key under the literal-translation rule in §4, but `position` is a
list-ordering concern, not a content-shape concern — it makes more
sense as `items.position integer NULL` so the §3.1 zod schemas don't
have to carry it. The migration cost is one extra column and a
backfill step. Recommendation: promote in PR-A; flag here so the
next revision either lifts it into the §3 schema diff or explicitly
defers.

## 10. Sequencing

Six PRs total; one (PR-F) carries the next concrete source kind so the
sources abstraction proves itself beyond Spotify before it ossifies.
Only PR-A has a migration.

1. **PR-A: schema migration + code cut-over.** Adds new columns/tables,
   backfills (including the activity-event renames per §4.1), drops
   old columns, ships `@workshop/shared/content` with the §3.1 zod
   registry and server-side `validateContent`, updates handlers in one
   shot. Same external API shape — clients see
   `modules`/`itemKindDefault`/`contentType`/`content` fields appear,
   `type`/`metadata` disappear. Protected by Neon-branch + migrate-smoke.
2. **PR-B: list_sources surface.** New endpoints + the `sources` module
   wired through. Album-shelf's Spotify integration moves onto the new
   primitive; legacy `lists.metadata`-driven code paths deleted.
3. **PR-C: leaderboard generalization.** `item_scores` is the only path;
   game-specific code paths deleted. Leaderboard module surfaces in the
   list-detail UI.
4. **PR-D: duplicate endpoint + UI.** The album-shelf-to-poll flow lands
   here. Server-side endpoint + the duplicate sheet in the mobile/web
   client.
5. **PR-E: templates + module-toggle UI + config-preview + 5.1 errors.**
   Ships the `@workshop/shared/templates` catalog (§7); the create-list
   flow becomes a template picker that builds the `POST /v1/lists` body
   accordingly; the settings sheet exposes raw module toggles; legacy
   `type`-driven UI branches removed; the `/config-preview` endpoint
   and the warning-acknowledgement protocol from §6 land here; the
   module-gate 409 error contract (§5.1) is enforced server-side and
   rendered client-side. Discord notifications + analytics rewired to
   read `(name, modules, itemKindDefault)` instead of legacy `type`.
6. **PR-F: Letterboxd source kind.** Second `list_sources.kind` value
   (`letterboxd_list`). Proves the abstraction beyond a single
   integration before it ossifies; concrete deliverable is "import a
   Letterboxd public list into a movie watchlist." Validates that the
   `list_sources` shape is genuinely kind-agnostic (no Spotify-shaped
   leakage). Lives downstream of PR-B so the surface already exists;
   independent of the rest.
