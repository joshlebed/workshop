# Lists & Leaderboards — product + design spec

Status: **scope locked** (2026-06-09) · Owner: @joshlebed

Product/design spec (the _what_). Build breakdown (the _how_, → GitHub issues) is in
[`docs/lists-and-leaderboards-plan.md`](./lists-and-leaderboards-plan.md). The research and the
fuller option space (including ideas we **cut** — see §6) are in
[`docs/lists-and-leaderboards-exploration.md`](./lists-and-leaderboards-exploration.md).

Builds on the modules+kind model from [`docs/list-data-model-redesign.md`](./list-data-model-redesign.md).

---

## 1. Vision: two surfaces, one app

Two surfaces sharing one account + design system + deploy pipeline, diverging below the shell:

- **Lists** — today's collaborative collections, plus three additions: **tags**, **filter
  chips**, and **saved views**. Kind-agnostic — works on any list (places, movies, books…).
- **Games** — a **new, fully independent tab** for daily-puzzle score-sharing: a **global game
  catalog** + a per-user **ordered "My Games"** list + a **symmetric friend graph**. A
  leaderboard is a _query_ (your friends' scores on a game you both play), not an object.

**Isolation is a hard requirement.** The Games tab is **additive and built behind a feature
flag**. It uses its own new tables and routes and does **not** touch the existing
`modules:[leaderboard]` lists, their `item_scores`, the `/list/[id]/game/[itemId]` flow, or the
`leaderboard` module. The current leaderboard ("Geo games") keeps running in production,
untouched, the whole time we build the new tab.

### 1.1 Cut and deferred (decided 2026-06-09)

**Cut entirely** (do not build):

- Auto-derived categories from Google-Maps place type, and the geocoding/enrichment behind it.
- The **`place` item kind** (it only existed to power auto-categories).
- The **merge tool** (folding one list into another).
- The **map view** for place lists.
- Any cross-game / overall leaderboard ranking.

**Deferred — a separate decision, explicitly NOT in this build:**

- Migrating the existing "Geo games" list + `item_scores` into the new Games tables.
- Retiring the `leaderboard` module, the `daily_games` template, or the old game route.

The old leaderboard surface stays live and untouched until — in some future, separate effort —
we decide whether and how to cut over. Until then, two leaderboard surfaces coexist (the old one
inside Lists, the new flag-gated Games tab), by design.

---

## 2. Surface 1 — Lists: tags, filter chips, saved views

All three are **kind-agnostic** — no `place` kind, no derived facets. Just manual labels and a
filter over them.

### 2.1 Tags

- A tag is a manual, lowercase label on an item, **many-to-many**: `item_tags(item_id, tag)`.
- Edited via a **suggested-chip picker** over the list's existing tags (tap to add/remove; type
  to create a new one). Never a bare free-text field.
- Any list member can tag any item (capability `edit_items`).

### 2.2 Filter chips

- A horizontal chip bar above the list shows the list's in-use tags with counts.
- Multi-select within the bar reads as **OR** ("burgers OR cocktails"). An explicit **"All"**
  chip clears the filter. Filtering is **client-side** (lists are small).
- No-match shows a specific empty state + one-tap "Clear filters".

### 2.3 Saved views

- A **saved view** is a named, stored filter on a list: `list_saved_views(list_id, name,
config)` where `config = { tags: string[], sort?: string }`.
- "Save current filter as a view" → it appears as a one-tap chip/row ("Burgers", "Cocktail
  bars"). Views are **shared by all list members**, not per-viewer.
- This is the answer to overlapping sibling lists: instead of a separate "Burgers" list, you tag
  items `burgers` and save a "Burgers" view inside the bigger list. (We are **not** building an
  automated merge tool — you re-tag by hand or via normal multi-select; §1.1.)

### 2.4 Data model (additions only)

```sql
CREATE TABLE item_tags (
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag     text NOT NULL,                       -- normalized lowercase, ≤40 chars
  PRIMARY KEY (item_id, tag)
);
CREATE INDEX item_tags_tag_idx ON item_tags (tag);

CREATE TABLE list_saved_views (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name       text NOT NULL,
  config     jsonb NOT NULL,                   -- { tags: string[], sort?: string }
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  position   integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX list_saved_views_list_idx ON list_saved_views (list_id);
```

### 2.5 API (additions; existing list/item routes unchanged)

- `GET /v1/lists/:id/items` — each item gains `tags: string[]`.
- `GET /v1/lists/:id/tags` → `[{ tag, count }]` — powers the chip bar + suggestions.
- `PUT /v1/items/:id/tags` — body `{ tags: string[] }` (replace set); capability `edit_items`;
  emits `item_tagged`.
- `GET/POST/PATCH/DELETE /v1/lists/:id/views` — saved-view CRUD. Any member creates; creator or
  list owner deletes.

---

## 3. Surface 2 — Games (new, isolated tab)

Tiny model: **a global game catalog, a personal ordered selection, a symmetric friend graph,
and scores.** No leagues, arenas, roles, seasons, join-codes, or visibility flags. A leaderboard
is a per-viewer query. All new tables/routes/screens; flag-gated; never touches the old surface.

### 3.1 Primitives

- **Game** — a tracked daily game. **Global, deduped by normalized URL** (exists once, shared).
  Holds title, icon, score-parser key (`gameScoreRegex`), and `score_direction` (asc = lower is
  better).
- **My Games** — a per-user **ordered selection** (`user_games`). You pick which games and the
  order; add / remove / reorder affects only you. Reuses the Lists drag-reorder `positions.ts`.
- **Score** — `(game_id, user_id, period_key)`, `period_key` = puzzle-day (`YYYY-MM-DD`). Stored
  in a **new** `game_scores` table (not the existing `item_scores` — the old surface keeps its).
- **Friendship** — a **symmetric** edge. The only sharing primitive. Share-link → accept.

### 3.2 The leaderboard is a per-viewer query

For game `G`, viewer `V`, day `P`: `game_scores WHERE game_id=G AND period_key=P AND user_id IN
(V ∪ friends_of(V))`, ordered by `score_direction`. Consequences (all simplifications): personal
not global; one sharing primitive; privacy automatic (friends-only); posting decoupled from any
membership; a friend's game you haven't added never clutters your home.

### 3.3 Global catalog, deduped by normalized URL

The one sharp edge. Normalize: lowercase host, strip `www.`, drop query+fragment, trim trailing
slash, keep path; make `games.normalized_url` unique. (This is the `dailytens.com/?ref=` junk
CLAUDE.md already documents.) Seed from the `gameScoreRegex` catalog (canonical key/title/icon/
direction); unknown URLs dedup on the normalized form and get a hostname title. Game metadata is
not user-editable in v1.

### 3.4 Friendship — share-link → accept

Reuses the list-invite token machinery (`shareSlug.ts` + an accept endpoint): you get a personal
invite link; the recipient opens it, signs in if new, and taps **Accept** → a symmetric
`friendships` edge. Stored canonically as one row per unordered pair (`user_low < user_high`).
`DELETE /v1/friends/:userId` unfriends (scores stay, just stop being mutually visible).

### 3.5 Score capture (v1)

In-app **paste** is the v1 capture path: paste a result → `shareScoreDetection` identifies the
game → resolve-or-create the global `games` row → upsert `(game_id, you, today)`. Idempotent.
Reuses `gameScoreRegex.ts` (parse) + `scoresSummary.ts` (display). _(The iOS share-extension
already routes shares to the existing leaderboard flow; re-pointing it at the new tab is a
deferred follow-up — §6 — so we don't disturb the live capture path while building.)_

### 3.6 Data model (all new tables)

```sql
CREATE TABLE games (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_url  text NOT NULL UNIQUE,
  url             text NOT NULL,
  title           text NOT NULL,
  icon_url        text,
  game_key        text,
  score_direction text NOT NULL DEFAULT 'desc',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_games (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id  uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  position integer,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);
CREATE INDEX user_games_user_position_idx ON user_games (user_id, position);
CREATE TABLE game_scores (
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key  text NOT NULL,
  score_value numeric,
  score_raw   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, user_id, period_key)
);
CREATE INDEX game_scores_game_period_idx ON game_scores (game_id, period_key);
CREATE TABLE friendships (
  user_low   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- user_low < user_high
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_low, user_high)
);
CREATE INDEX friendships_high_idx ON friendships (user_high);
CREATE TABLE friend_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,
  invitee_id   uuid REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending',     -- pending | accepted | declined
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
```

### 3.7 API (all new, mounted under the flag)

- `GET /v1/games` — my ordered games + my today status. `POST /v1/games` `{ url }` — find/create
  by normalized URL, append to my list. `DELETE /v1/games/:id` — remove from my list.
  `POST /v1/games/:id/move` — reorder. `PUT /v1/games/:id/scores` `{ periodKey, scoreRaw }` —
  upsert my score (auto-adds to my list). `GET /v1/games/:id/leaderboard?period=` — me + friends.
- `GET /v1/friends` · `POST /v1/friends/invite` → `{ token, url }` ·
  `GET /v1/friends/requests/:token` · `POST /v1/friends/requests/:token/accept` ·
  `DELETE /v1/friends/:userId`.

No role matrix: friendship is binary; you only ever read/write your own scores and your own
`user_games`; others' scores are gated solely by `friends_of(viewer)`.

### 3.8 UX

```
◆ Games                                            ＋ Add game
(your own ordered list — drag to reorder)
 🟢 Globle      You 4 · 3 friends · 2nd
 🗺  MapTap       — not played —            [Paste ＋]
tap → ◆ Globle · Thu Jun 5    1. 🥇 Renata 2   2. You 4   3. Sam 5
```

Home = your ordered games. A game's board defaults to today, past days scrollable. No overall
cross-game rank.

---

## 4. App shell

Add a top-level **Lists / Games** switch — a bottom tab on native (`◧ Lists` · `◆ Games`), a
sidebar switch on web. **Additive and safe:** existing Lists routes/deep-links nest under the
Lists tab unchanged; the Games tab is **gated behind a feature flag** (off in production) until
all Games pieces land, then flipped on. No native module is added (expo-router `Tabs` is JS).

---

## 5. Acceptance

- On any list, you can tag items, filter by tag chips, and save a filter as a named view that
  all members see. "Burgers" lives as a view inside "Date Ideas" without a separate list.
- Behind the flag, the **Games** tab is your own ordered list of games; you add a game by URL,
  paste a result, and see your score; accepting a friend's invite link makes their scores appear
  in your per-game leaderboards for games you both play. The **existing** "Geo games" list and
  its scoring are completely unaffected throughout.

---

## 6. Out of scope / deferred follow-ups

Not in this build; revisit only after the new Games tab is proven:

- Cutover: migrate "Geo games" + `item_scores` → the new tables; retire the `leaderboard`
  module, `daily_games` template, and `/list/[id]/game/[itemId]` route.
- Re-point the iOS share-extension to post into the new Games tab.
- (Cut, not merely deferred:) auto-categories / `place` kind, the merge tool, map view,
  cross-game ranking.
