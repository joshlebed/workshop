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
- **Games** (daily leaderboards) — recurring score-sharing for daily puzzle games, built on a
  **global game catalog** + a **symmetric friend graph**. Your leaderboard for a game is just
  your friends' scores on it. There is no league, no membership, no container — a leaderboard
  is a _query_, not an object. _This replaces the `leaderboard` list module._

### 1.1 What changes vs. #199 (the modules+kind redesign)

|                             | #199 model                        | This spec                                                 |
| --------------------------- | --------------------------------- | --------------------------------------------------------- |
| Date/place lists            | `kind=link`, flat                 | `kind=place`, **facets + tags + saved views**             |
| "Burgers" as a sibling list | a separate list                   | a **saved view** inside one places collection             |
| Daily games                 | `modules:[leaderboard]` on a list | a **global game** + friend-graph leaderboard, own surface |
| `leaderboard` module        | a list module                     | **deprecated** (replaced by the Games surface)            |
| Top-level nav               | one stack                         | **two surfaces** behind a switch                          |

This **partially reverses** #199's "every behavior is a list module" thesis. We keep it for
Lists; we reject it for daily games — they're better served by a tiny global-catalog +
friend-graph model than by a list carrying a module, because the social unit is a friend graph,
not a per-list roster.

### 1.2 Non-goals (carried from `redesign-spec.md` unless noted)

- An item still belongs to **exactly one list**. Facets/tags are item _attributes_, not extra
  parents. (Cross-collection smart lists are explicitly future work — §2.5.)
- No public profiles / discoverability. The friend graph (§3.4) is the only social primitive;
  it's mutual and private. No followers, no public leaderboards.
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
- `daily_games` template **removed** — games are added in the Games surface (§3), not created as
  lists.

---

## 3. Surface 2 — Games (daily leaderboards)

The model is deliberately tiny: **a global catalog of games, a personal ordered selection, a
symmetric friend graph, and scores.** There is **no container** — no league, no arena, no
membership, no roles, no seasons, no visibility flags. A leaderboard is not an object you create
or manage; it's a **query**: _your friends' scores on a game you both play, for a given day._

### 3.1 Primitives

- **Game** — a tracked daily game (MapTap, Globle, NYT Mini…). **Global, and deduped by
  normalized URL** — it exists in the DB exactly once and is shared by everyone. Carries title,
  icon, the score-parser key (`gameScoreRegex`/`shareScoreDetection`), and `score_direction`
  (asc = lower is better, desc = higher is better).
- **My Games** — a per-user **ordered selection** of games (`user_games`). You pick which games
  you care about and the order; add / remove / reorder affects **only you**. This is your Games
  home screen. (Reuses the Lists drag-reorder + `positions.ts` allocator.)
- **Score** — one result: `(game_id, user_id, period_key)`, where `period_key` is the puzzle-day
  (`YYYY-MM-DD`). This is today's `item_scores`, re-keyed from `item_id` to `game_id`.
- **Friendship** — a **symmetric** edge between two users. The only sharing primitive. Created
  via a share-link → request → accept flow. No roles.

### 3.2 The leaderboard is a per-viewer query (what falls out)

For game `G`, viewer `V`, day `P`:

```sql
SELECT s.* FROM game_scores s
WHERE s.game_id = G AND s.period_key = P
  AND s.user_id IN ( V  ∪  friends_of(V) )
ORDER BY s.score_value          -- ASC or DESC per games.score_direction
```

Every consequence is a simplification:

- **Leaderboards are personal, not global.** Your Globle board and mine differ because our
  friend circles differ. There's no shared "standings" object to create, name, own, configure,
  or invite to — and nothing to keep in sync.
- **One sharing primitive replaces six.** Friend once → you each see the other's scores on every
  game you both play, retroactively and forever. No league membership, roles, seasons, join
  codes, or visibility flags.
- **Privacy is automatic.** You see exactly your friends' scores — nothing public, no flags.
  Zero friends = a private solo tracker; add friends = it turns social. Progressive by default.
- **Posting is decoupled from membership** (there is none). Paste a result → resolve the game by
  URL → upsert your score → it auto-joins your Games home. No "am I in this league?" check.
- **A friend's game you haven't added doesn't clutter your home.** Your home is _your_ ordered
  list; friendships decide _whose scores appear_ when you open a game. (Optional later: a "3
  friends play Strands — add it?" discovery nudge.)
- **Fully decoupled from Lists.** No `leaderboard` module, no list container. The two surfaces
  share only the app shell, auth, and the capture pipeline.

### 3.3 Games are a global catalog, deduped by normalized URL

The one part that needs care is the **dedup key**. Normalize the URL — lowercase host, strip
`www.`, drop query + fragment, trim a trailing slash, keep the path — and make `games` unique on
it. This is the exact hazard CLAUDE.md already flags: the `dailytens.com/?ref=<id>` referral
junk that poisoned score parsing; stripping query params kills it. The existing `gameScoreRegex`
catalog seeds the table with a canonical `game_key`, title, icon, and `score_direction`, and can
canonicalize known URL variants to one row; **unknown** URLs dedup on the normalized URL alone
and get a hostname-derived title. Game metadata is **not user-editable in v1** — that sidesteps
the "who owns the shared row?" question (a curated catalog + best-effort derivation is enough).

### 3.4 Friendship — share-link → request → accept

Reuses the list-invite token machinery (`shareSlug.ts` + an accept endpoint):

1. You open **Add friend** → get a personal invite link carrying a rotatable token.
2. You send it; the recipient opens it (signing in if new) and sees "Be friends with Josh?".
3. **Accept** creates the symmetric `friendships` edge. (Decline / ignore leaves it pending.)

Stored canonically as one row per unordered pair (`user_low < user_high`) so "are A and B
friends?" is a single PK lookup and `friends_of(V)` is one indexed query. `DELETE
/v1/friends/:userId` unfriends — the edge is removed, scores stay (they just stop being visible
to each other). _(Default: the link is an offer from its creator and one accept by the recipient
forms the edge. A stricter two-sided "request then the inviter approves" variant is a trivial
extension if wanted — see plan §5.)_

### 3.5 Score capture (unchanged)

Identical to today's flow, just re-targeted at a global game instead of a list item: share the
result → share-extension → `shareScoreDetection.ts` identifies the game → resolve-or-create the
global `games` row by normalized URL → upsert `(game_id, you, today)`. Idempotent — re-pasting
the same day updates, never duplicates. In-app paste fallback for web. `gameScoreRegex.ts`
(parse) + `scoresSummary.ts` (display) reused as-is; `score_direction` lives on the `games` row.

### 3.6 Data model

```sql
CREATE TABLE games (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_url  text NOT NULL UNIQUE,            -- dedup key (§3.3)
  url             text NOT NULL,                    -- canonical display URL
  title           text NOT NULL,
  icon_url        text,
  game_key        text,                             -- gameScoreRegex/shareScoreDetection key when known
  score_direction text NOT NULL DEFAULT 'desc',     -- asc = lower better
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_games (                           -- a user's personal ordered selection
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id  uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  position integer,                                 -- reuse positions.ts allocator
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);
CREATE INDEX user_games_user_position_idx ON user_games (user_id, position);

CREATE TABLE game_scores (                          -- item_scores, re-keyed item_id → game_id
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key  text NOT NULL,                         -- 'YYYY-MM-DD' (puzzle-day)
  score_value numeric,
  score_raw   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, user_id, period_key)
);
CREATE INDEX game_scores_game_period_idx ON game_scores (game_id, period_key);

CREATE TABLE friendships (                          -- symmetric; one row per unordered pair
  user_low   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- enforce user_low < user_high
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_low, user_high)
);
CREATE INDEX friendships_high_idx ON friendships (user_high);

CREATE TABLE friend_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,                 -- rotatable share-link token (like share_slug)
  invitee_id   uuid REFERENCES users(id) ON DELETE CASCADE,   -- set on open/accept
  status       text NOT NULL DEFAULT 'pending',      -- pending | accepted | declined
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
```

Four small tables — and `game_scores` is just `item_scores` re-keyed. No leagues, arenas,
members, roles, or seasons.

### 3.7 API

- `GET /v1/games` — my ordered games, each with today's compact status (my result · # friends
  who played · my rank).
- `POST /v1/games` — body `{ url }`: find-or-create the global game by normalized URL, append to
  my `user_games`. Returns the game.
- `DELETE /v1/games/:id` — remove from **my** list (my `user_games` row only; scores untouched).
- `POST /v1/games/:id/move` — `{ beforeId?, afterId? }` reorder (reuses `positions.ts`).
- `GET /v1/games/:id/leaderboard?period=today|YYYY-MM-DD` — me + friends who played, ranked by
  `score_direction`.
- `PUT /v1/games/:id/scores` — `{ periodKey, scoreRaw }`: upsert my score; auto-adds the game to
  my Games home if absent. Idempotent on `(game_id, me, periodKey)`.
- Friends: `GET /v1/friends` · `POST /v1/friends/invite` → `{ token, url }` ·
  `GET /v1/friends/requests/:token` (preview the inviter) ·
  `POST /v1/friends/requests/:token/accept` · `DELETE /v1/friends/:userId`.

No permission matrix: friendship is binary, and you can only ever read/write **your own** scores
or **your** `user_games`. Visibility of others' scores is gated solely by `friends_of(viewer)`.

### 3.8 UX / IA

```
◆ Games                                                    ⋯   ＋ Add game
(drag to reorder — your own list, nobody else's)
┌──────────────────────────────────────────────────────────┐
│ 🟢 Globle       You 4  ·  3 friends played  ·  you're 2nd  │
│ 🗺  MapTap        — not played today —              [Paste ＋] │
│ 🔢 Daily Tens   You 81 ·  5 friends played  ·  1st 🥇      │
└──────────────────────────────────────────────────────────┘

tap a game →    ◆ Globle · Thu Jun 5            ‹ scroll past days ›
                1. 🥇 Renata  2     2. You  4     3. Sam  5
                [ Paste your result ＋ ]      (only if you haven't played today)
```

Games home = your own reorderable list. A game's leaderboard defaults to **today**, past days
scrollable. **No "overall" cross-game rank in v1** — that implied a league/season frame; each
game has its own board. (An optional personal "today summary" can come later.)

---

## 4. App shell

- **One Expo app.** A top-level switch between the two surfaces:
  - **Native:** a bottom tab bar — `◧ Lists` · `◆ Games` — via expo-router `Tabs` (JS-only, no
    native module, no fingerprint bump).
  - **Web:** a sidebar switch in the `Screen`/`Layout` shell (web already constrains to a reading
    column).
- **Shared above the line:** account/auth, the share-extension capture pipeline (already routes
  to both `/share/pick-list` and the score path), OTA/TestFlight, design system, and the
  activity/notifications surface (extended to carry friend-request + score events).
- **Divergent below the line:** the two data models in §2 and §3. Lists has owner/member +
  capabilities; Games has only the binary friend graph.
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

**Games:**

4. For each `modules:[leaderboard]` list ("Geo Games"), turn its items into global `games`
   (dedup by normalized URL; the catalog supplies `game_key` / title / `score_direction`), and
   move its `item_scores` → `game_scores` keyed by the migrated `game_id`.
5. Re-create each scorer's personal selection: insert `user_games` rows for the games each user
   actually scored, preserving the source list's item order for the list owner.
6. Re-create the social graph: every pair of co-members of a leaderboard list becomes a mutual
   `friendships` edge (so "everyone saw everyone" carries over). For Geo Games (8 members) that's
   28 edges — fine; add a sanity cap for any larger list.
7. Deprecate the `leaderboard` module: remove it from `MODULE_NAMES`, drop the `daily_games`
   template, retire the `/list/[id]/game/[itemId]` route. Archive the source lists.

(Steps 4–7 land only after the Games surface is verified — see plan Track B.)

---

## 6. Resolved decisions

These were the open questions in exploration §8; resolved here as the spec's defaults (each can
still flip during planning):

1. **Tag model:** derived **and** manual. Derived ships first (Track L0); manual tags + views in
   L1.
2. **View scope:** **per-list** saved views. Cross-collection smart lists are future work (would
   relax the one-item-one-list rule — out of scope).
3. **App shell:** **one app + top-level switch** (Lists / Games). Not two apps.
4. **Leaderboards model:** a **global, URL-deduped game catalog + a per-user ordered selection +
   a symmetric friend graph**; the leaderboard is a per-viewer query. **No** leagues, arenas,
   roles, seasons, join codes, or visibility flags. (Supersedes the earlier league model.)
5. **Cross-game ranking:** **none in v1** — per-game boards only. (An overall rank implied a
   league/season frame we're cutting.)
6. **Friend invite:** **share-link token → accept** (reuses list-invite machinery). One accept by
   the recipient forms the mutual edge; a stricter inviter-approves variant is an easy follow-up.

---

## 7. Acceptance (what "done" means for the whole arc)

- "Date Ideas" renders category chips auto-derived from place type, a map view, and a
  Want-to-go/Been segment; "Burgers" exists as a one-tap saved view inside it, not a sibling
  list. No item was lost in the merge.
- Your **Games** home is your own ordered list of games — add / remove / reorder affects nobody
  else. A friend accepts your invite link; thereafter their scores appear in your per-game
  leaderboards for the games you both play (and yours in theirs), with no league or membership to
  manage. Daily games are no longer lists.
- Native app shows a Lists/Games bottom tab; web shows the sidebar switch. Auth, the
  share-extension, and OTA are unchanged and shared.
