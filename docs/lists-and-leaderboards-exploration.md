# Lists & Leaderboards — architecture exploration

Status: **graduated** · Opened: 2026-06-05 · Owner: @joshlebed

> **Direction chosen (2026-06-05): both halves, full architecture.** This exploration has
> graduated into a committed spec + plan — see
> [`docs/lists-and-leaderboards-spec.md`](./lists-and-leaderboards-spec.md) (the _what_) and
> [`docs/lists-and-leaderboards-plan.md`](./lists-and-leaderboards-plan.md) (the _how_). This
> doc is preserved as the option space + research rationale that led there.
>
> It lays out the option space (with tradeoffs + a recommendation) for two changes the product
> is pulling toward: **(A)** sub-structure _inside_ a list (tags / filters / saved views), and
> **(B)** splitting the app into two surfaces — a **Lists** app and a **Daily Leaderboards**
> app — with different primitives and different sharing/permissions. Read
> `docs/redesign-spec.md` for the original product vision and
> `docs/list-data-model-redesign.md` for the current modules+kind model this builds on.

---

## 0. TL;DR

The current model (post-#199) is **one object** — a list with `modules` + `item_kind`, items
with `kind` + `content`. Two real usage patterns are straining it in **opposite** directions:

- **Lists are under-structured.** "Date Ideas" (34 items) has obvious latent sub-categories
  — restaurants, bars, music, museums, activities, even movies-to-watch — with no way to
  express them. "Burgers" (8 items) is literally the `restaurants → burgers` slice that got
  promoted to its own list because there was no other way to carve it out. → **Fix: a facet /
  tag / saved-view primitive inside a list, plus a first-class `place` item kind.**
- **Leaderboards are over-unified.** "Geo games" is a `modules:[leaderboard]` list, but it
  behaves nothing like the others: **8 members** (every other list has 1–2), 155 daily scores
  over 19 days, a stable set of ~7 games while the _data_ (scores) churns every day. The
  central object is the **day**, which the list model has no concept of. → **Fix: extract
  Leaderboards into its own surface with its own primitives (League → Arena → Period → Entry)
  and its own sharing/permissions, inside the same Expo app behind a top-level switch.**

Recommended shape: **one app, two surfaces, shared account + share-extension + OTA pipeline;
diverging data models and permissions below the shell.**

---

## 1. What the data says (grounding)

Pulled from the local DB (a Neon branch off prod), 2026-06-05:

| List                           | kind            | modules          | items | members | notes                                      |
| ------------------------------ | --------------- | ---------------- | ----- | ------- | ------------------------------------------ |
| josh + renata date ideas       | `link`          | todo, ranking    | 34    | 2       | grab-bag; latent sub-categories            |
| **Burgers**                    | `link`          | todo, ranking    | 8     | 2       | **every item is an NYC burger restaurant** |
| Geo games                      | `link`          | **leaderboard**  | 7     | **8**   | daily puzzle leaderboard                   |
| My favorite albums of all time | `spotify_album` | ranking, sources | 4     | 1       |                                            |
| Afters albums                  | `spotify_album` | ranking, sources | 2     | 1       |                                            |
| Albums to listen to            | `spotify_album` | ranking, sources | 3     | 1       |                                            |

### 1.1 The "Date Ideas" latent taxonomy

The 34 items are already a multi-facet collection with no facets to express it:

- **Restaurants** — Lori Jayne, Leo (Detroit pizza), Mala Project, Taqueria Ramirez, Kazu
  Nori, Casa Adela, Buenos Aires steakhouse, Astoria Brazilian food tour
- **Bars** — Eavesdrop, Sauced wine bar, Maison Premiere, "Bar hopping"
- **Music / nightlife** — Ergot Records, Berimbau (listening room), Jazz club, Concert, Rave
- **Museums / design** — Cooper Hewitt, Apparatus showroom
- **Activities** — ice skating, yoga, board-game café, bike Manhattan, gym, thrifting, "take
  photos on the street", explore Bushwick/Greenpoint
- **Movies to watch** — Studio 54, Berlin Bouncer, "We Call It Techno" (these are not date
  _places_ at all — they belong on a watchlist)

Nearly every place item is a **saved Google Maps location** — it carries `lat`/`lng`, an
address, and a static-map thumbnail in `content`. **That metadata is the unlock**: the
category ("restaurant", "bar", "museum") can be _inferred from the Maps place type_ rather
than typed by hand. (See §3.2.)

### 1.2 "Burgers" ⊂ "Date Ideas restaurants"

Every burger spot (Au Cheval, Minetta Tavern, Red Hook Tavern, Raoul's…) is an NYC restaurant
— a strict sub-slice of the date-ideas restaurant set. It exists as a separate list only
because the app offers no way to say "show me the burger restaurants." In the Airtable/Notion
mental model, **Burgers is a saved view, not a container.**

### 1.3 "Geo games" is the social outlier

It is the most-shared object in the entire dataset by 4×, and the only one with recurring
daily engagement:

```
maptap      47 scores · 6 users · 19 days     https://maptap.gg/
Globle      28 scores · 4 users · 14 days     https://globle-game.com/game
Daily Tens  23 scores · 7 users · 11 days     https://dailytens.com/
travle      23 scores · 4 users · 12 days     https://travle.earth
Satle       23 scores · 4 users · 13 days     https://satle.ca/
Tradle       6 scores · 3 users ·  3 days     https://tradle.net
NYT Mini     5 scores · 2 users ·  5 days     https://nytimes.com/crosswords/game/mini
```

This is a friend-group **league**: a stable set of arenas (the games), a recurring **period**
(the puzzle-day), and an append-only stream of **entries** (scores) compared within a small
known cohort. None of those nouns exist in the list model — they're bolted onto
`items` + `item_scores` + a `leaderboard` flag.

---

## 2. Two problems, opposite directions

|                | Lists problem                                            | Leaderboards problem                                      |
| -------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| Symptom        | One list = many hidden categories; sibling lists overlap | One list behaves like a different product                 |
| Root cause     | No sub-structure below the list                          | A different primitive forced into the list model          |
| Correction     | **Add** structure (facets / tags / views / `place` kind) | **Extract** a primitive (League / Arena / Period)         |
| Sharing        | Small, symmetric, durable membership (have it)           | Open join, roles, seasons, public/private (don't have it) |
| Central object | the item                                                 | the **day** (period)                                      |

The rest of this doc explores each independently, then shows how they compose (§5).

---

## 3. Problem A — structure inside a list

Constraint from the spec (§1 non-goals): **an item belongs to exactly one list.** So the move
is _not_ "an item lives in many lists"; it's "one collection, sliced many ways." Tags/facets
inside a list don't violate this — they're attributes of an item, not extra parents.

### 3.1 The option space

Researched against Notion, Airtable, Things 3, Todoist, Bear, Raindrop, Pinterest, Google
Keep, Mapstr, Foursquare Swarm, Beli, Apple/Google Maps lists. Five archetypes:

| Option                              | Mechanic                              | Shines                                                            | Frustrates                                                           | Mobile verdict                                 |
| ----------------------------------- | ------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------- |
| **A1. Flat manual tags**            | Many-to-many labels                   | Cross-cutting facets; "both restaurant & bar" is free             | Users must build + maintain a vocabulary; tag rot                    | Good _if_ tags are tap-chips, not a text field |
| **A2. Nested sub-lists / sections** | One-to-one hierarchy                  | Easy to browse + reason about                                     | Forces a single classification — the sin that made "Burgers"         | One level OK; deep nesting = drill-down hell   |
| **A3. Saved views / filters**       | One dataset, stored filter+sort+group | Cleanest match for "one pile, many slices"; merge becomes trivial | "Views" is an abstraction casual users don't intuit                  | Hide the builder, ship presets                 |
| **A4. Kanban group-by**             | A field renders as columns            | Great for a _status_ axis (want-to-go → been)                     | One dimension at a time; horizontal drag is the worst mobile gesture | Use vertical grouped sections, not columns     |
| **A5. Smart / auto lists**          | Saved _query_ auto-populates          | Zero upkeep; always current                                       | Only works if items already carry the attribute                      | High fit **as the payoff** once facets exist   |

The decisive research finding (consistent across every source): **most people won't tag, and
manual taxonomies rot.** The winning consumer move is to **remove the human from tagging** —
derive the category from data you already have, and let the user only _correct_ it.

> Sources: "Tags Are the New Folders" (heaper.de), Evernote folders-vs-tags guidance, Notion
> vs Airtable views model, Mapstr tag-first places, Foursquare Swarm 6.0 saved places + map
> toggle, Beli comparative ranking, Pencil&Paper mobile-filters pattern analysis.

### 3.2 Recommended primitive: **facets** (derived + manual), surfaced as chips + views

Define one concept, **facet** = a `(dimension, value)` pair on an item, from two sources:

- **Derived facets** — computed from `item.kind` + `item.content`, no user effort:
  - `place` → `category` from the Google Maps place type (restaurant / bar / cafe / museum /
    park / venue…), `neighborhood` from reverse-geocoding lat/lng.
  - `movie`/`tv` → `genre`, `decade` from TMDB content already cached.
  - `spotify_album` → `artist`, `decade` from Spotify content.
- **Manual tags** — user labels (many-to-many), entered via a **suggested-chip picker** over
  the collection's existing tags (keeps the vocabulary tight; no free-text keyboard friction).

Both render through **one filter-chip bar** and feed **saved views**. This unifies "category",
"tag", and "smart list" into a single filter surface, and it generalizes across every list
type instead of being places-only.

**Why this over the alternatives:** A1 alone re-creates the "nobody tags" failure; A2 is the
problem we're escaping; A3 is the right _container_ idea but needs _something to filter on_ —
which derived facets provide for free. A2/A4 stay available as _view modes_ (grouped sections),
not as the storage model.

### 3.3 Promote `place` to a first-class item kind

A saved Maps location is currently `kind=link` with ad-hoc `content`. Places want things links
don't: a map view, a category, a neighborhood, want-to-go/been, price. Add:

```ts
// @workshop/shared/itemKinds — new kind
place: {
  source?: 'google_maps' | 'manual',
  placeId?: string,          // dedup key (mirrors the album-shelf partial-unique-index trick)
  lat?: number, lng?: number,
  address?: string,
  neighborhood?: string,     // derived
  category?: string,         // derived from Maps place type; user-overridable
  priceLevel?: 1|2|3|4,
  mapImageUrl?: string,
}
```

This is a code-only change (kinds are a registry, not a DB enum — see
`list-data-model-redesign.md` §3.1). `link` stays for true links; date-ideas places migrate to
`place`.

### 3.4 Status axis (want-to-go / been) — keep it separate from category

Every places app (Mapstr "To try/Tried", Swarm, Beli "Want-to-try/Been", Google "Want to go")
treats **want-to-go vs been** as its own first-class axis, never folded into category. We
already have `todo` (complete = "been"). Recommendation: when a place list has `todo`, render
that axis as a **segmented control (Want to go · Been · All)**, distinct from the category
chips. No new data needed.

### 3.5 What it looks like per list type

The facet bar is driven by `item_kind`; each kind contributes its derived facets, plus manual
tags are always available:

```
PLACES  (date ideas, burgers, restaurants)
┌───────────────────────────────────────────────┐
│  💡 Date Ideas            [ Map | List ]  ⋯     │
│  ( Want to go · Been · All )                    │   ← status segment (todo module)
│  [All] [Restaurant 12] [Bar 4] [Music 5]        │   ← derived category chips (auto)
│        [Museum 2] [Activity 8]  + #burgers      │   ← manual tag chip
│  ───────────────────────────────────────────   │
│  • Au Cheval        Restaurant · FiDi   🗺      │
│  • Eavesdrop        Bar · Greenpoint    🗺      │
│  • Cooper Hewitt    Museum · UES        🗺      │
└───────────────────────────────────────────────┘
  Saved views:  ⭐ Burgers   ⭐ Bars to try   ⭐ Brooklyn

MOVIES / TV (watchlist)          facets: Genre, Decade, Runtime  + Watched/Unwatched
BOOKS                            facets: Author, Genre, Length
ALBUM SHELF (spotify)            facets: Artist, Decade           (source-driven, read-only)
GENERIC / plain                  facets: manual tags only
```

The "movies to watch" buried in Date Ideas (Studio 54, Berlin Bouncer…) get a one-tap **"move
to a watchlist"** affordance — they're `movie`-kind items that wandered into a place list.

### 3.6 Merge / migration UX ("Burgers" → a saved view in "Date Ideas")

Non-destructive, reversible, the Airtable model:

1. Pick destination collection (Date Ideas).
2. Stamp every Burgers item with manual tag `#burgers`; auto-derive `category` for all places.
3. Dedupe by `placeId` (or name+address); union tags on collisions.
4. Auto-create a **saved view** `category=restaurant ∧ tag=burgers` named "Burgers".
5. Confirmation screen with **Undo** + a chip-filtered review to spot-correct auto-tags.

"Burgers" stops being a list and becomes a one-tap filter. Nothing is lost.

### 3.7 Data-model sketch (Problem A)

```sql
-- manual tags: many-to-many, scoped to an item (item already belongs to one list)
CREATE TABLE item_tags (
  item_id uuid REFERENCES items(id) ON DELETE CASCADE,
  tag     text NOT NULL,                 -- normalized lowercase
  PRIMARY KEY (item_id, tag)
);
CREATE INDEX item_tags_tag_idx ON item_tags (tag);

-- saved views: stored filter/sort/group over one list
CREATE TABLE list_saved_views (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    uuid REFERENCES lists(id) ON DELETE CASCADE,
  name       text NOT NULL,
  config     jsonb NOT NULL,            -- { filter, sort, groupBy, viewMode: 'list'|'map'|'grid' }
  created_by uuid REFERENCES users(id),
  position   integer
);
```

Derived facets are computed **at read time** from `items.content` (no storage, always fresh) —
or materialized into `item_tags` with a `source:'derived'` marker if filter perf ever needs it.
Start with read-time; the dataset is tiny.

**Open question:** does a "view" stay inside one list, or can it span the whole Lists surface
(a true smart list across collections)? The spec's one-item-one-list rule says scope views to a
single collection for now; cross-collection smart lists are a later, bigger step.

---

## 4. Problem B — Lists app vs Daily Leaderboards app

### 4.1 Why it's genuinely a different primitive

Collaboration and competition diverge at the **data model** and the **permission** layer:

- A **list** shares an _editable artifact_. Rights are about **mutating content** (add / edit /
  delete items). Membership is small, symmetric, durable. We have this:
  `list_members(owner|member)` + `share_visibility(off|view|join)`.
- A **league** shares a _recurring ranking arena_. Rights are about **who appears, who
  administers the rules, and who can watch**. Membership is open-join, role-stratified, and
  _seasonal_ (rosters roll over). We have **none** of this.

The central object of a league is the **Period** (the puzzle-day) — Lists have no equivalent.
Streaks, "who's played today", placement across games, and period-end reveals all hang off it.

### 4.2 Sharing & permissions divergence

Researched against Strava clubs/segments, Duolingo leagues, Discord game bots, NYT Games
leaderboard, GeoGuessr parties, Letterboxd, Apple Fitness, BeReal.

| Primitive                            | Leaderboards needs                                  | Lists has / needs            |
| ------------------------------------ | --------------------------------------------------- | ---------------------------- |
| Join-by-code / open link             | ✅ many join fast, nickname-only OK                 | Lists invite specific people |
| Participant vs **spectator** role    | ✅ watch-without-competing is real                  | n/a (you're in or out)       |
| League **admin** (rule-setter)       | ✅ sets games, period, scoring, unplayed-day policy | n/a (members symmetric)      |
| **Season** / period membership reset | ✅ rosters roll; rejoin per season                  | n/a (membership durable)     |
| Public / discoverable flag           | ✅ public leagues, shareable standings              | Lists are private            |
| Per-item edit rights                 | ✗ scores are append-only-by-self                    | ✅ core to lists             |
| Owner-transfer of the artifact       | ✗                                                   | ✅                           |

Bolting league semantics onto `list_members` would overload it badly. **This is the strongest
argument for the split.**

### 4.3 One app or two?

**Recommendation: one Expo app, top-level switch, shared account — not two apps.**

| Option                                                               | Pros                                                                                         | Cons                                                                                                  | Verdict         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------- |
| **One app, top-level switch** (bottom tab on native, sidebar on web) | Shared auth, share-extension, OTA/TestFlight pipeline; users plausibly use both; lowest cost | Two surfaces compete for one nav; must not bury either                                                | **Recommended** |
| Two separate apps, shared backend/auth                               | Each stays focused; independent brand                                                        | Doubles sign-in, share-extension, OTA, TestFlight, App Store listing — for a 3-week-old usage cluster | Premature       |
| Keep it a list module (status quo)                                   | Zero work                                                                                    | Can't give leagues their own sharing/period/streak primitives                                         | Insufficient    |

The deploy pipeline (EAS free-tier minutes, share-extension App Group, OTA fingerprinting) is a
real cost you do **not** want to double. Revisit "two apps" only if Leaderboards grows its own
brand/audience.

```
        Native (bottom tabs)                 Web (sidebar switch)
   ┌──────────────────────────┐        ┌─────────┬────────────────────┐
   │                          │        │ ◧ Lists │   Today's board     │
   │     (active surface)     │        │ ◆ Boards │   ...               │
   │                          │        │  ──────  │                     │
   │                          │        │  Lists   │                     │
   ├────────────┬─────────────┤        │  • Date  │                     │
   │  ◧ Lists   │  ◆ Boards   │        │  • Burg  │                     │
   └────────────┴─────────────┘        └─────────┴────────────────────┘
```

### 4.4 Leaderboards primitives & data model

The good news: **scoring is ~80% built.** `item_scores(item_id, user_id, period_key,
score_value, score_raw)` is _already_ the Entry table; an item _is already_ an arena;
`period_key` _is already_ the day; `shareScoreDetection.ts` (17 game parsers) + the
`expo-share-intent` capture flow already do frictionless entry. What's missing is the
**league / membership / period-aggregation / sharing** layer on top.

```sql
CREATE TABLE leagues (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  owner_id    uuid REFERENCES users(id),
  join_code   text UNIQUE,                 -- short, rotatable; GeoGuessr-style
  visibility  text NOT NULL DEFAULT 'private', -- private | unlisted | public
  season      text,                         -- current season key; NULL = no seasons
  created_at  timestamptz DEFAULT now()
);
CREATE TABLE league_members (
  league_id uuid REFERENCES leagues(id) ON DELETE CASCADE,
  user_id   uuid REFERENCES users(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'participant', -- participant | spectator | admin
  season    text,                                 -- membership can be per-season
  PRIMARY KEY (league_id, user_id)
);
CREATE TABLE arenas (                       -- the per-game thing (≈ today's items)
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   uuid REFERENCES leagues(id) ON DELETE CASCADE,
  game_key    text,                          -- 'wordle' | 'globle' | ... (parser registry key)
  title       text NOT NULL,
  url         text,
  score_direction text                        -- asc | desc
);
-- entries ≈ today's item_scores, re-parented to arena_id (or keep item_scores + a view)
```

Plus three derived/computed concepts the UI needs (no new tables required):

- **Period aggregation** — today / this week / all-time / rolling-7 (WordleBot's proven menu).
- **Placement-points meta-rank** — to compare across heterogeneous games (Globle=distance,
  Mini=seconds), rank within each game per day and award F1/golf-style points, then sum for an
  **overall daily** board. Scale-invariant; the only sane cross-game unification.
- **Streaks & participation** — per `(user, arena)` current/longest streak + "played N/M days".
  "Unplayed day" policy is a league setting (excluded-but-breaks-streak is the humane default).

### 4.5 What it looks like

```
◆ Geo Games (league)                     today · Thu Jun 5
┌──────────────────────────────────────────────────────┐
│  Today   This week   All-time            🔥 streaks    │
│  ── Overall (placement points) ──────────────────────  │
│   1. Renata   14 pts   ▓▓▓▓▓                            │
│   2. Josh     11 pts   ▓▓▓▓                             │
│   3. Sam       9 pts   ▓▓▓                              │
│  ── By game ─────────────────────────────────────────  │
│   maptap     5/8 played   leader: Renata               │
│   Globle     4/8 played   leader: Josh                 │
│   Daily Tens 7/8 played   leader: Sam      [Paste ＋]  │
│  ────────────────────────────────────────────────────  │
│   "You haven't played Satle today"        [Open game]  │
└──────────────────────────────────────────────────────┘
```

Capture stays exactly as today: share the game's result → Workshop share-extension → parsed →
one-tap "post to Geo Games". Idempotent by `(arena, user, period)`.

---

## 5. How they compose

```
                       ┌─────────────── Workshop app shell ───────────────┐
                       │   shared: auth · share-extension · OTA · profile  │
                       └───────────────┬───────────────────┬──────────────┘
                                       │                   │
                       ◧ LISTS (collab collections)   ◆ LEADERBOARDS (competition)
                       │                                   │
        list ──< items (kind: place/movie/book/…)     league ──< arenas (games)
          │        │                                     │          │
          │        ├─ derived facets (auto)              │          └─< entries (scores)
          │        └─ manual tags  ── saved views        │
          │                                              ├─ league_members (participant/
          ├─ list_members (owner/member)                 │     spectator/admin, seasonal)
          └─ share_visibility (off/view/join)            └─ join_code + public/private
```

- **Shared above the line:** account, the share-extension capture pipeline (already routes to
  both `/share/pick-list` and `/share/pick-leaderboard`), OTA/TestFlight, design system.
- **Divergent below the line:** Lists = editable artifact + symmetric durable membership;
  Leaderboards = ranking arena + open-join, role-stratified, seasonal membership.

Migration of today's data: Date Ideas + Burgers → one `place` collection with facets + a
"Burgers" saved view; Geo games → a League with 7 arenas.

---

## 6. Phasing (crawl → walk → run; each step ships value)

| Phase | Scope                                                                                                                                                        | Reuses                                                | Value                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------ |
| **0** | `place` item kind + derived `category`/`neighborhood` facets + filter-chip bar + map view on place lists                                                     | item-kind registry; existing content                  | Date Ideas instantly usable; **no merge needed** |
| **1** | Manual tags + saved views + merge tool (Burgers → saved view)                                                                                                | Phase 0 facets; album-shelf dedup-index pattern       | Kills overlapping-list sprawl                    |
| **2** | Top-level switch (tab/sidebar) + read-only Leaderboards home aggregating today across existing leaderboard lists; streaks + participation + placement-points | `item_scores`, `shareScoreDetection`, share-extension | Leagues _feel_ alive without new sharing model   |
| **3** | Leagues as a first-class primitive: `leagues`/`league_members`/`arenas`, join-by-code, roles, seasons, public/private; migrate Geo games                     | the permissions helper pattern; share-slug pattern    | Competitive sharing the list model can't express |

Phase 0–1 are the **Lists** correction; Phase 2–3 are the **Leaderboards** correction. They're
independent — either half can ship first.

---

## 7. Risks & counter-arguments (honest)

- **This partially reverses #199's "one unified object" thesis.** That redesign deliberately
  collapsed types into modules+kind. We're not undoing it — Lists stays modules+kind — but we
  _are_ saying the leaderboard module was a unification too far. Worth a deliberate "yes, we
  changed our mind, here's why" note when this graduates to a spec.
- **Facets add a maintenance surface.** Mitigated by deriving them (no upkeep) and only letting
  users _correct_, never _build from scratch_.
- **Two surfaces can bury each other.** A bottom tab is the cheapest insurance; revisit if
  either surface gets <X% of sessions.
- **Leagues are a 3-week-old pattern (n=1 group).** Phase 2 (read-only aggregation, no new
  sharing model) is the cheap way to validate before committing to Phase 3's tables.
- **`place` reverse-geocoding cost.** Neighborhood derivation needs a geocode; cache it in
  `content` on write (we already cache Maps thumbnails), don't geocode on read.

---

## 8. Decisions needed before this graduates to a spec

1. **Tag model:** derived-only (auto from place type) to start, or derived **+** manual tags
   from day one? (Recommendation: both, but derived ships first in Phase 0.)
2. **View scope:** saved views scoped to one list, or cross-collection smart lists later?
   (Recommendation: per-list now; the spec's one-item-one-list rule makes cross-collection a
   bigger, separate step.)
3. **App shell:** one app + top-level switch (recommended) vs two apps.
4. **Leagues now or aggregate-first?** Phase 2 (read-only board over existing data) before
   Phase 3 (real league tables + sharing)? (Recommendation: yes — validate cheaply.)
5. **Cross-game ranking:** ship per-game boards only, or the placement-points overall board
   too? (Recommendation: per-game first; placement-points is a fast-follow.)
