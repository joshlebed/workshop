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

## 8. UX implications worth flagging

- **Duplicate affordance.** The list detail screen gets a "Duplicate"
  action. The duplicate flow lets the user rename, re-emoji, and toggle
  modules in one step. The album-shelf → voting-poll workflow is the
  canonical example to design against.
- **Template picker as the entry point.** The create-list flow is a
  vertical list of template cards (the §7 catalog), each showing
  display name, description, and a representative emoji/color. Picking
  one drops the user into the per-template prompt (e.g., name + optional
  source URL for `album_shelf`); the "Blank List" template gives the
  power-user escape hatch into manual module selection.
- **`sources` module visibility.** The list detail header gets a "Synced
  from Spotify" affordance and a manual refresh button — generic across
  any list with the `sources` module on, not just album shelves.
- **Settings sheet ≠ template picker.** Once a list exists, the settings
  sheet exposes raw module toggles (§6) — templates aren't shown there.
  Re-deriving "this looks like a Reading List" from the current module
  set is possible but not worth the complexity; better to let the user
  shape the list freely.

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
from a disabled module is preserved but invisible. Should there be a
debug surface (or a "restore" action) that lets the user see _what_ would
come back if they re-enabled the module, without committing to it?
Cheapest answer: the confirmation sheet for _enabling_ a module shows the
preserved-data summary, mirroring the disable warning. No separate
viewer needed.

9.6. **Should templates be discoverable post-creation?** Currently no —
the template ID is lost the moment the list exists. If template browsing
turns out to be useful (e.g., "duplicate as a different template"), the
cheapest path is to derive a best-match template from the current
`(item_kind_default, modules)` tuple at render time; no schema needed.
Defer until use cases demand it.

## 10. Sequencing

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
5. **PR-E: templates + module-toggle UI + config-preview.** Ships the
   `@workshop/shared/templates` catalog (§7); the create-list flow
   becomes a template picker that builds the `POST /v1/lists` body
   accordingly; the settings sheet exposes raw module toggles; legacy
   `type`-driven UI branches removed; the `/config-preview` endpoint
   and the warning-acknowledgement protocol from §6 land here, since
   they only have a user-visible surface once the toggles are in the UI.
