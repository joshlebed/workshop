# Album Shelf — Spec + Plan (post-redesign feature)

Status: proposed · Date: 2026-04-27 · Owner: @joshlebed · Picks up after Phase 5 of [`redesign-plan.md`](./redesign-plan.md)

This doc covers a single post-redesign feature: a 6th list type, **Album
Shelf**, that builds a curated album collection from a public Spotify
playlist. It also covers stripping the existing PR #52 Spotify integration
(per-user OAuth, saved albums, now-playing, playlists hub), which is replaced
wholesale.

It depends on the v1 redesign (Phases 0–5) being complete: list/items CRUD,
shared list permissions, activity events, OAuth sign-in, web hosting. None of
this work runs in parallel with redesign Phases 4 or 5 — both chunks below
are post-Phase-5.

See [`redesign-spec.md`](./redesign-spec.md) for the product framing this
extends, and [`redesign-plan.md`](./redesign-plan.md) for the chunk-level
plan-doc convention.

---

## 1. Goal

Lift the "playlist → albums → shelf" flow from Spotify into Workshop without
inheriting Spotify's auth model. Each user's primary Workshop sign-in stays
Apple/Google. The Spotify connection is **app-level** (Workshop's developer
credentials) and is used to read public playlists only — no per-user Spotify
OAuth, no user-specific scopes, no token refresh.

### 1.1 Why this approach (replacing PR #52)

PR #52's per-user-OAuth Spotify hub (saved albums, now-playing, playlists)
never shipped to users in any meaningful form. It was wired during the
redesign but was always going to bump into a structural Spotify constraint:

- As of **Feb 11, 2026**, newly-created Spotify Developer apps in
  Development Mode cap at **5 allowlisted Premium testers** and require the
  developer to hold Premium themselves. Apps created before that date keep
  the legacy **25-tester** cap. Workshop's app
  (`9b0cd8357c5b43a1ae84554ed29a6f65`) is grandfathered into the 25-tester
  cap — that's the only reason per-user OAuth is even theoretically viable.
- Extended Quota Mode (the "any user can sign in" tier) requires a
  **legally registered business**, **250k MAU**, and an active launched
  service. Spotify hasn't accepted applications from individuals since
  May 15, 2025. For a personal monorepo, that path is closed.

So per-user OAuth is permanently capped at 25 friends-of-Josh on Workshop.
That makes it a poor backbone for a feature that wants to feel like
"Workshop just knows your music" — every shared list with a Spotify-using
member would hit the cap quickly.

The Album Shelf design **sidesteps the quota problem entirely**: app-level
credentials read **public playlists**. No per-user Spotify accounts. No
tester allowlist. Any Workshop user, even one without a Spotify Premium
account, can have an album shelf — they just need a public playlist URL
(theirs or someone else's). The tester cap stops mattering because no
end-user goes through Spotify's OAuth.

That's why Chunk A strips PR #52 wholesale and Chunk B builds something
that uses only the bottom layer (`SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`).

### 1.2 Use cases

- **Saturday Vinyl**: a partner curates a "what we want to spin this weekend"
  Spotify playlist; Workshop turns it into an ordered shelf of albums to play
  through.
- **Album Club**: a friend group rotates "album of the week" picks via
  playlist; Workshop tracks which ones were chosen, in what order.
- **Listening pile**: a single user maintains a personal "to listen" Spotify
  playlist and wants a clean shelf UI to rank what they actually want to keep.

Non-goals:

- Per-user Spotify accounts in Workshop (all Spotify access is via app token).
- Playback / now-playing / saved-album sync (that was PR #52's scope; it
  ships nothing user-facing in v1.1).
- Private playlists (would require user OAuth — explicitly out of scope).
- Album metadata enrichment beyond what Spotify returns (no Discogs / RYM
  cross-lookup in v1.1).
- Track-level granularity (the unit is the album).

---

## 2. Sequencing — two chunks, strip then add

The work splits into two PRs that can ship independently. Chunk A leaves the
repo compiling and the redesign feature set unchanged minus the Spotify hub.
Chunk B is purely additive. If Chunk B's design changes after A merges, A
still stands.

### Chunk A — strip existing Spotify integration (~1 day)

Removes everything PR #52 added that's user-facing. Keeps only what the
new feature needs: the two SSM secrets (`SPOTIFY_CLIENT_ID`,
`SPOTIFY_CLIENT_SECRET`) and the registered Spotify Developer app
(`9b0cd8357c5b43a1ae84554ed29a6f65`). The HTTP client itself is **rewritten**
in Chunk B for app-token auth — the existing `lib/spotify/client.ts` does
per-user `spotify_accounts.access_token` lookups with auto-refresh, which is
a fundamentally different code path.

**Backend deletes:**

- `apps/backend/src/routes/v1/spotify.ts` (all 752 lines)
- `apps/backend/src/lib/spotify/auth.ts` (PKCE + Authorization Code flow)
- `apps/backend/src/lib/spotify/scopes.ts` (10 user-scopes that no app-token
  flow needs)
- `apps/backend/src/lib/spotify/client.ts` (per-user client; rewrite in
  Chunk B as `lib/spotify/app-client.ts`)
- Drizzle migration: `drop_spotify_user_tables.sql` — drops
  `spotify_accounts` and `spotify_album_saves`. Both are self-contained
  (no external FKs); no cascade work needed. `db/schema.ts` exports
  removed: `spotifyAccounts`, `spotifyAlbumSaves`, `DbSpotifyAccount`,
  `DbSpotifyAlbumSave`.
- `apps/backend/src/app.ts` — unmount `/v1/spotify` router.

**Client deletes:**

- `apps/workshop/app/spotify/index.tsx`
- `apps/workshop/app/spotify/albums.tsx`
- `apps/workshop/app/spotify/now-playing.tsx`
- `apps/workshop/app/spotify/playlists.tsx`
- `apps/workshop/app/spotify/playlist/[id].tsx`
- `apps/workshop/src/api/spotify.ts`
- `apps/workshop/src/hooks/useSpotifyConnect.ts`
- The 🎧 button in `apps/workshop/app/index.tsx` (header IconButton + the
  `spotifyGlyph` style).
- The 5 `<Stack.Screen name="spotify/...">` registrations in
  `apps/workshop/app/_layout.tsx`.
- `queryKeys.spotify.*` constants.

**Shared types deletes:**

- `SpotifyTrackSummary`, `SpotifyAuthorizeResponse`, `SpotifyStatus`, etc.
  in `packages/shared/src/types.ts`. Anything referenced only by the deleted
  client/server surface.

**Infra changes (`infra/`):**

- Remove `aws_ssm_parameter.spotify_redirect_uri` and
  `aws_ssm_parameter.spotify_app_redirect_uri` resources (and corresponding
  `var.spotify_redirect_uri` / `var.spotify_app_redirect_uri`).
- Remove `SPOTIFY_REDIRECT_URI` and `SPOTIFY_APP_REDIRECT_URI` from
  `aws_lambda_function.api.environment.variables` in `lambda.tf`.
- Remove the two values from `infra/terraform.tfvars`.
- `terraform apply` — destroys 2 SSM resources, updates Lambda env (4 keys
  → 2 keys for Spotify).

**Spotify dashboard cleanup (manual, post-merge):**

- On the Workshop.dev app
  (`https://developer.spotify.com/dashboard/9b0cd8357c5b43a1ae84554ed29a6f65`),
  remove the 2 Workshop OAuth callback redirect URIs:
  `https://flaqpucm3f.execute-api.us-east-1.amazonaws.com/v1/spotify/auth/callback`
  and `http://127.0.0.1:8787/v1/spotify/auth/callback`. Leave the 3 legacy
  libsync URIs alone. The Workshop app uses Client Credentials flow which
  doesn't need any redirect URIs registered.

**Tests:**

- Delete `apps/backend/src/routes/v1/spotify.test.ts` (if it exists) and
  any spotify-named test fixtures.
- Existing test suite passes after deletes; nothing else to change.

**Acceptance:**

- `pnpm typecheck && pnpm lint && pnpm test` green.
- `terraform plan` shows 2 destroys + 1 Lambda env change, nothing else.
- App builds; home screen has no 🎧 button; `/spotify/*` routes return 404.

---

### Chunk B — add Album Shelf list type (~1 week)

Builds entirely on top of Chunk A's clean slate. Decomposed into 4
sub-chunks: B1 (schema + Spotify app-client), B2 (backend routes), B3
(client UI), B4 (activity events + polish).

Detailed in §3–§9 below.

---

## 3. Product model

### 3.1 Album Shelf as a 6th `list_type`

Extends [`redesign-spec.md` §2.1](./redesign-spec.md#21-lists). New enum
value `album_shelf` joins `movie | tv | book | date_idea | trip`. Inherits
the standard list entity:

- Standard fields: `id`, `name`, `emoji` (default 📀, overridable), `color`,
  `description`, `owner_id`, `created_at`, `updated_at`.
- Standard sharing model: `list_members` membership, share-link invites,
  activity events. **All actions are member-level — including changing the
  source URL and triggering refresh.** Activity events provide accountability
  ("@kira changed source URL").
- **Items** on the list are individual albums (one row per Spotify album).

List-level metadata extends `lists.metadata` jsonb:

```json
{
  "spotifyPlaylistUrl": "https://open.spotify.com/playlist/7xQ...",
  "spotifyPlaylistId": "7xQABC123",
  "lastRefreshedAt": "2026-05-01T12:34:56Z",
  "lastRefreshedBy": "<user-uuid>"
}
```

`spotifyPlaylistUrl` is what the user pasted; `spotifyPlaylistId` is parsed
from it once and stored to skip re-parsing on every refresh. Set on list
creation; mutable via `PATCH /v1/lists/:id`.

### 3.2 What an item is

One row in `items` per album (deduped by Spotify album id). Item-level
metadata:

```json
{
  "source": "spotify",
  "spotifyAlbumId": "4SZko61aMnmgvNhfhgWqNn",
  "spotifyAlbumUrl": "https://open.spotify.com/album/4SZko...",
  "title": "Random Access Memories",
  "artist": "Daft Punk",
  "year": 2013,
  "coverUrl": "https://i.scdn.co/image/ab67616d0000b273...",
  "trackCount": 13,
  "position": 2.0,
  "detectedAt": "2026-05-01T12:34:56Z"
}
```

The standard item columns (`title`, `url`) are populated:

- `items.title` = album title (denormalized for search + activity feed
  rendering).
- `items.url` = `spotifyAlbumUrl`.
- `items.note` = unused for now (future: per-album notes? tracked as a
  follow-up open question, §10).

### 3.3 Ordered vs detected — derived from `metadata.position`

The two-section UI is computed from a single column inside `metadata`:

- `metadata.position: number | null`
- **Detected** (unordered) = items with `position == null`.
- **Ordered** (ranked) = items with `position != null`, sorted ASC.

Sort within sections:

- **Ordered**: `metadata.position ASC` (lowest first = top of the shelf).
- **Detected**: `metadata.detectedAt ASC` (oldest first; new arrivals
  append at the bottom of the pile, matching the "FIFO listening queue"
  mental model the user requested).

#### 3.3.1 Position values — floats with gap-insert

Use `1.0`, `2.0`, `3.0` for the initial ordered set. To insert between two
adjacent items, take the midpoint (`1.5`). When repeated inserts collapse
gaps below a tolerance (e.g. two adjacent positions differ by less than
`0.001`), renumber the entire ordered list to fresh integers in a single
transaction.

Pragmatic for the small-N case (a shelf has 10–100 items, not 10,000).
Sparse integers + renumber-on-every-move was the alternative; rejected
because every drag-reorder would update every row below the insertion
point, vs floats which update one row 99% of the time.

### 3.4 Promotion / demotion semantics

- **Detected → Ordered (promote)**: user drags a detected row up into the
  ordered section. `metadata.position` is set to the midpoint between the
  positions of the rows above and below the drop target (or `0.5` for the
  top, or `max + 1` for the bottom). `metadata.detectedAt` is preserved (so
  if demoted later, it goes back to its original detected slot).
- **Ordered → Detected (demote)**: user drags an ordered row down past the
  divider, OR uses the row context menu's "Remove from order".
  `metadata.position` is cleared (set to `null`). The album returns to the
  detected section and sorts by `detectedAt`.
- **Reorder within ordered**: standard drag-to-reorder. Position updated.
- **Delete**: hard-deletes the row. No tombstone. On next refresh, if a
  track on the source playlist still maps to this album, the row is
  re-inserted as a fresh detected item (with a new `detectedAt`).

The delete confirmation must warn: _"Removing this album won't stop it
from coming back. If a track from this album is still on the source
playlist, the next refresh will re-detect it."_

### 3.5 Permissions

Per the user's call: **any member can do anything** except delete the
list (owner-only, per redesign-spec §2.5). Specifically:

| Action                     | Who        |
| -------------------------- | ---------- |
| Change source playlist URL | Any member |
| Trigger refresh            | Any member |
| Drag-reorder               | Any member |
| Promote / demote albums    | Any member |
| Delete an album from shelf | Any member |
| Rename / emoji / color     | Owner-only |
| Delete the list            | Owner-only |
| Invite / remove members    | Owner-only |

Activity events provide attribution for every member action (§7).

---

## 4. UX

### 4.1 Create-list flow

Extends [`redesign-spec.md` §4.5](./redesign-spec.md#45-create-list-flow).
Type picker gains a 6th card: **📀 Album Shelf**. Picking it adds one extra
screen between _Customize_ and _Invite_:

**Source playlist screen** (new):

- "Paste a public Spotify playlist URL"
- Text field accepts `open.spotify.com/playlist/<id>` or
  `spotify:playlist:<id>` URI form.
- Validation on blur:
  - Parse the URL/URI to extract the playlist id (regex).
  - Hit `GET https://api.spotify.com/v1/playlists/{id}?fields=name,owner,public`
    with the app token — confirm the playlist exists and is public.
  - On success: render a small preview card (playlist name, owner, track
    count). "Continue" enables.
  - On 404 / private / malformed: inline error ("That playlist isn't
    public" or "Not a Spotify playlist URL"). "Continue" stays disabled.
- This step is **required** for `album_shelf` lists. No "skip" affordance.

After "Continue", the create flow finishes (Customize screen, then Invite,
then land in the new list). On landing, the backend has already fetched the
initial set of albums from the playlist — the detected section is pre-
populated. No ordered items yet.

### 4.2 List detail screen

The list-detail screen ([`redesign-spec.md` §4.2](./redesign-spec.md#42-list-detail))
gets a type-specific layout for `album_shelf`:

```
┌─────────────────────────────────────────────────────┐
│ ← 📀 Saturday Vinyl              ⚙             ↻   │  ← header
│   3 members · last refreshed 2h ago by @kira        │
├─────────────────────────────────────────────────────┤
│ Search this shelf…                                  │  ← client filter
├─────────────────────────────────────────────────────┤
│ ORDERED (8)                                         │
│ ┌──────────────────────────────────────────────────┐│
│ │ 1  [cover] Random Access Memories                ││
│ │            Daft Punk · 2013                      ││
│ │            added 2026-04-30 by @josh        [⋮]  ││
│ │ 2  [cover] Currents                              ││
│ │            Tame Impala · 2015                    ││
│ │            ...                              [⋮]  ││
│ └──────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────┤
│ DETECTED (5)                                        │
│ ┌──────────────────────────────────────────────────┐│
│ │ • [cover] In Rainbows                            ││
│ │           Radiohead · 2007                       ││
│ │           detected 2026-04-15                [⋮] ││
│ │ • [cover] Blonde                                 ││
│ │           Frank Ocean · 2016                     ││
│ │           detected 2026-04-22 (just now)     [⋮] ││
│ └──────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
   No FAB — adding albums happens via refresh, not manually.
```

**Differences from other list types:**

- No "+" FAB. Albums come from the playlist; users don't add manually.
- No upvote pill, no completed checkmark. Per the user's call: drop both.
- Refresh button (↻) in the header — kicks off a fresh playlist pull.
- Two visual sections separated by a divider. Section headers show counts.
- Section headers are stuck at the top during scroll (sticky).
- Each row's overflow menu (`⋮`) shows: "Remove from order" (ordered rows
  only) and "Delete album". Delete shows the warning copy.
- Drag-handle on the left of each row enables long-press-and-drag (iOS) /
  drag-handle-grab (web). Drag works **across the divider** in both
  directions (promote and demote).
- Header subline shows: `<n> members · last refreshed <relative> by @<who>`
  (uses `metadata.lastRefreshedAt` + `metadata.lastRefreshedBy`).

**Empty states:**

- Both sections empty after creation but before first refresh completes:
  "Pulling albums from your playlist…" with a spinner. Auto-refreshes
  when the create-flow's initial fetch finishes.
- Detected empty, ordered populated: divider hides; just shows the
  ordered list without a section header.
- Ordered empty, detected populated: shows "Drag an album up to start
  ordering your shelf" hint above the divider.
- Both empty after a refresh: "No albums detected. Check that your
  playlist has tracks with album info." with a button to open list
  settings to change the source URL.

### 4.3 List settings (info modal)

Extends [`redesign-spec.md` §4.9](./redesign-spec.md#49-list-settings--info)
with one new section for `album_shelf` lists:

**Source playlist** section:

- Current URL displayed (clickable, opens in Spotify).
- "Change source URL" button → modal with the same paste + validate UX
  from the create flow.
- "Refresh now" button → triggers an immediate refresh.
- Last refreshed timestamp + actor name.

The Members and Share-link sections are unchanged from other list types.

### 4.4 Refresh behavior

- Trigger: header ↻ button OR list-settings "Refresh now" OR auto on
  list creation.
- Optimistic UI: spinner replaces the ↻ icon; "Refreshing…" shown in the
  header subline; no other UI change yet.
- On success: detected section animates new arrivals in at the bottom
  (highlighted briefly with a "new" pill that fades after 3s). Header
  subline updates to "last refreshed just now by @<you>".
- On error: toast "Couldn't refresh — try again?" with a retry. Status
  in subline reverts to the previous timestamp.
- **Pure additive**: rows that were on the shelf before refresh stay,
  even if their tracks left the playlist. Only delete removes a row.

### 4.5 Source URL change

- From list settings, "Change source URL" opens a paste modal (same UX
  as create flow).
- On save: backend persists the new URL, then **automatically triggers a
  refresh** against it.
- **Existing items are preserved across the URL change.** A URL change
  does not wipe ordered or detected. New playlist's albums merge into
  detected (additive). This is consistent with the "pure additive on
  refresh" rule generalized: refresh never removes, regardless of source.
- Activity event `album_shelf_source_changed` records the swap with old
  and new URL in payload.

---

## 5. Data model

### 5.1 New `list_type` enum value

Drizzle migration adds `'album_shelf'` to the `list_type` enum.

### 5.2 New `metadata` shape on `lists`

For `lists.type = 'album_shelf'` rows, `metadata` is non-empty:

```ts
type AlbumShelfListMetadata = {
  spotifyPlaylistUrl: string;
  spotifyPlaylistId: string; // parsed once, cached
  lastRefreshedAt: string | null; // ISO-8601
  lastRefreshedBy: string | null; // user uuid
};
```

Validated by zod at the API boundary via the existing per-type validator
pattern ([`redesign-spec.md` §9.4](./redesign-spec.md#94-type-validation)).
For all other list types, `metadata` stays `{}`.

### 5.3 New `metadata` shape on `items`

For `items.type = 'album_shelf'` rows:

```ts
type AlbumShelfItemMetadata = {
  source: "spotify";
  spotifyAlbumId: string;
  spotifyAlbumUrl: string;
  title: string;
  artist: string;
  year?: number;
  coverUrl?: string;
  trackCount: number;
  position: number | null; // null = detected, non-null = ordered
  detectedAt: string; // ISO-8601, set on first insert
};
```

Same validator pattern. The standard `items.title` column is denormalized
from `metadata.title` (for search and feed rendering), and `items.url` is
denormalized from `metadata.spotifyAlbumUrl`.

### 5.4 Unique constraint for refresh idempotency

```sql
CREATE UNIQUE INDEX items_list_spotify_album_idx
  ON items (list_id, (metadata->>'spotifyAlbumId'))
  WHERE type = 'album_shelf';
```

A partial unique index keyed by `(list_id, metadata.spotifyAlbumId)` — only
applied when `type = 'album_shelf'` so it doesn't constrain other list types.

This solves the refresh-concurrency problem: two members hitting refresh at
the same instant both insert their detected album rows with `INSERT ... ON
CONFLICT DO NOTHING`. Whoever wins the race owns the `detectedAt` timestamp;
the loser silently no-ops on each duplicate. No per-shelf locking, no
in-flight flag, no race window where the same album appears twice.

### 5.5 No new tables

Everything fits in the existing `lists` + `items` schema using metadata
JSONB. No `album_shelf_items` separate table. Trade-off: per-album columns
aren't queryable by the type system, but Drizzle gives us strongly-typed
JSONB access via zod and the items table indexes (`list_id`,
`(list_id, completed, created_at DESC)`) cover the access patterns.

The dropped tables from Chunk A (`spotify_accounts`, `spotify_album_saves`)
do **not** come back in any form. This feature is built fresh.

### 5.6 New activity event types

Adds to the `activityEventTypeEnum` in `db/schema.ts`:

- `album_shelf_refreshed` — payload `{ added: number, source: string }`
- `album_shelf_source_changed` — payload `{ from: string, to: string }`
- `album_promoted` — payload `{ albumTitle: string, position: number }`
- `album_demoted` — payload `{ albumTitle: string }`

The standard `item_added` (on insert from refresh) and `item_deleted` (on
manual delete) also fire, per the existing convention ([`redesign-plan.md`
§3.20](./redesign-plan.md#320-what-3a-2-actually-shipped--start-here-for-3b-1--3b-2)).

Reorder _within_ the ordered section is high-frequency (drag = many small
updates). It does **not** fire an event per drag — only the
promote/demote enum values fire on section-crossing. Pure within-section
position changes are silent. Otherwise the activity feed becomes spammy.

---

## 6. Spotify HTTP client (rewrite)

Built fresh as `apps/backend/src/lib/spotify/app-client.ts`. Not a refactor
of the deleted per-user client — different auth model.

### 6.1 Token cache

Client Credentials flow:

```
POST https://accounts.spotify.com/api/token
  Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)
  Content-Type: application/x-www-form-urlencoded
  Body: grant_type=client_credentials
```

Response: `{ access_token, token_type: "Bearer", expires_in: 3600 }`.

Cache the token in **module scope** (not per-Lambda-invocation). Each
Lambda container shares one token until it expires; refresh-on-401 logic
catches rotation. No DB write, no SSM write — token is ephemeral and
trivial to re-fetch (~50ms cost amortized over hundreds of API calls per
container lifetime).

```ts
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value;
  }
  // ... fetch fresh, cache with expiresAt = now + (expires_in * 1000)
}
```

### 6.2 Endpoints used

- `GET /v1/playlists/{id}` — playlist metadata (name, owner, public,
  track count). One call, used during URL validation.
- `GET /v1/playlists/{id}/tracks?fields=items(track(album(id,name,artists,release_date,total_tracks,images,external_urls))),next&limit=100`
  — paginated. Walk `next` URLs to fetch up to 1000 tracks (10 pages).
  Beyond 1000 tracks per refresh is out of scope (~3 pages covers ~95% of
  real-world playlists; cap protects rate limits and Lambda cold-start
  cost).
- No write endpoints. Read-only client.

### 6.3 Edge cases

- **404** (playlist deleted / made private after creation): refresh returns
  `{ error: "PLAYLIST_NOT_AVAILABLE" }`. Client surfaces "Source playlist
  is private or deleted. Update the source URL?" with a settings deep-link.
- **Track without album** (rare: local files, podcasts in playlists, removed
  tracks): track entry has `track: null` or `track.album: null`. Skip
  silently during album extraction; don't error.
- **Album appears N times** (multiple tracks from same album on the
  playlist): one item created. The `(list_id, spotifyAlbumId)` unique
  index plus `ON CONFLICT DO NOTHING` makes this naturally idempotent.
- **Rate limiting**: app tokens have a generous quota (~180 requests/sec
  sustained). For our scale (one playlist fetch per refresh, ≤10 pages),
  we won't hit it. No retry-with-backoff in v1.1 — fail loud, surface to
  user. Add backoff if it bites.
- **Token refresh**: if a request returns 401, invalidate the cached token,
  fetch a new one, retry once. Beyond that, fail loud.

### 6.4 What's reused vs rewritten

| File                               | Chunk A action | Chunk B action                      |
| ---------------------------------- | -------------- | ----------------------------------- |
| `lib/spotify/auth.ts` (PKCE)       | delete         | —                                   |
| `lib/spotify/scopes.ts`            | delete         | —                                   |
| `lib/spotify/client.ts` (per-user) | delete         | —                                   |
| `lib/spotify/app-client.ts`        | —              | create (~150 LOC)                   |
| `lib/spotify/playlist-parser.ts`   | —              | create (URL → playlist id, ~30 LOC) |

The dashboard credentials are the only thing that survives the round-trip.

---

## 7. API surface

All new routes are namespaced under existing list/item endpoints — no
top-level `/v1/spotify/*` prefix.

### 7.1 List creation

Existing `POST /v1/lists` accepts a new optional field for `album_shelf`:

```ts
type CreateListRequest = {
  type: ListType;
  name: string;
  emoji: string;
  color: string;
  description?: string;
  // NEW — required iff type === "album_shelf"
  spotifyPlaylistUrl?: string;
};
```

Backend validates:

- If `type === "album_shelf"` and `spotifyPlaylistUrl` is missing → 400.
- Parse playlist id; if invalid → 400 with `code: "INVALID_PLAYLIST_URL"`.
- Hit Spotify; if not public / 404 → 400 with `code: "PLAYLIST_NOT_AVAILABLE"`.
- Persist list with `metadata: { spotifyPlaylistUrl, spotifyPlaylistId,
lastRefreshedAt: null, lastRefreshedBy: null }`.
- **In the same transaction**, fire an initial refresh (insert detected
  items). On Spotify error: rollback list creation, return 502.

### 7.2 List fetch — split sections in response

`GET /v1/lists/:id` already returns `{ list, members, pendingInvites }`.
Items come from `GET /v1/lists/:id/items`. For album_shelf lists, the items
endpoint returns **two arrays** instead of one:

```ts
type AlbumShelfItemsResponse = {
  ordered: Item[]; // sorted by metadata.position ASC
  detected: Item[]; // sorted by metadata.detectedAt ASC
};
```

For all other list types, the response is unchanged (`{ items: Item[] }`).
The client picks the response shape from the list type. This keeps the
ordering logic server-side (no client-side filtering / sorting of mixed
items by metadata).

Alternative considered: keep one array, let client filter. Rejected
because (a) the server has the type info anyway, (b) filter-on-client
fights TanStack Query's cache key normalization, (c) the response shape
asymmetry is small and the client conditional is local to the list-detail
screen.

### 7.3 Refresh endpoint

```
POST /v1/lists/:id/refresh
  → 200 { ordered, detected, refreshedAt, refreshedBy, addedCount }
  → 403 if not a member
  → 404 if list not found
  → 400 if list type !== 'album_shelf'
  → 502 on Spotify error (with error.code = "SPOTIFY_UNAVAILABLE")
```

Implementation:

1. Auth: requireListMember (any member can refresh).
2. Read `lists.metadata.spotifyPlaylistId`.
3. Page through Spotify tracks (cap 10 pages).
4. Extract unique album ids.
5. For each album: `INSERT INTO items ... ON CONFLICT DO NOTHING`. Capture
   `addedCount` from `RETURNING`.
6. Update `lists.metadata.lastRefreshedAt = now()`,
   `lists.metadata.lastRefreshedBy = me`.
7. Fire `album_shelf_refreshed` event with `{ added: addedCount, source: url }`.
8. Return updated `{ ordered, detected }` plus `addedCount` so the client
   can render the "X new" toast.

Single transaction — entire refresh either commits or rolls back.

### 7.4 Position update endpoint (promote / demote / reorder)

Reuse `PATCH /v1/items/:id` with `metadata` updates:

```ts
PATCH /v1/items/:id
  body: { metadata: { position: 1.5 } }     // promote / move within ordered
  body: { metadata: { position: null } }    // demote to detected
```

The standard handler runs the per-type metadata zod validator. For album
shelf items, only `position` is mutable (other fields are derived from
Spotify and immutable client-side). Validator rejects writes to `title`,
`artist`, etc.

Activity events:

- `position null → number` → `album_promoted`.
- `position number → null` → `album_demoted`.
- `position number → number` → silent (within-section reorder).

### 7.5 Source URL change endpoint

Reuse `PATCH /v1/lists/:id` with `metadata` updates:

```ts
PATCH /v1/lists/:id
  body: { metadata: { spotifyPlaylistUrl: "https://..." } }
  → validates, parses id, confirms public, persists, fires
    album_shelf_source_changed event, kicks off refresh.
```

No standalone `/source-url` endpoint. The list-level metadata patch is the
right primitive; refresh-after-update is implicit (per §4.5).

### 7.6 Existing endpoints unchanged

`POST /v1/lists/:id/items`, `POST /v1/items/:id/upvote`,
`POST /v1/items/:id/complete` are not used for album_shelf lists. The
client doesn't expose them. Backend permits them (returning 200) for
schema simplicity, but they have no UX entry point. Documented as
"no-op for album_shelf" in the API doc.

---

## 8. Build phasing — Chunk B sub-chunks

Chunk B itself decomposes into 4 sub-chunks. Each is a shippable PR.

### B1 — schema + Spotify app-client (~2 days)

- Drizzle migration: add `'album_shelf'` to `list_type` enum, partial
  unique index `items_list_spotify_album_idx`, 4 new
  `activityEventTypeEnum` variants.
- `lib/spotify/app-client.ts` (Client Credentials token cache + paginated
  playlist fetch). Vitest: token caching, 401-retry, pagination boundary.
- `lib/spotify/playlist-parser.ts` (URL/URI → id). Vitest covers all
  formats including malformed.
- Per-type metadata zod validators in `lib/validators/album-shelf.ts`.
  Wired into existing `validateItemMetadata` switch.

**Acceptance:** schema migration applies cleanly on a dev DB; vitest green;
`pnpm typecheck` green; nothing user-facing yet (no routes, no client UI).

### B2 — backend routes (~2 days)

- `POST /v1/lists` extended for album_shelf type (initial refresh in tx).
- `POST /v1/lists/:id/refresh`.
- `PATCH /v1/items/:id` extended for `metadata.position` (promote/demote
  events).
- `PATCH /v1/lists/:id` extended for `metadata.spotifyPlaylistUrl`
  (source-changed event + refresh).
- `GET /v1/lists/:id/items` returns `{ ordered, detected }` for album_shelf.
- Vitest: route auth, validator gating, refresh idempotency under
  concurrent inserts.

**Acceptance:** routes work end-to-end against a real Spotify app token in
a dev environment; integration test creates a shelf, refreshes, asserts
detected populated.

### B3 — client UI (~3 days)

- Extend create-list flow: add the 6th type card, source-playlist input
  screen with validation.
- New `<AlbumShelfDetail>` component for list-detail screen — sticky
  section headers, two FlatLists (ordered + detected), drag-to-reorder
  using `react-native-draggable-flatlist` (already a dep candidate; or
  `@quidone/react-native-wheel-picker`-style approach).
- Header refresh button + loading state.
- Per-row context menu (Remove from order / Delete) with delete warning
  modal.
- List settings: Source playlist section with change-URL modal.
- TanStack Query hooks: `useAlbumShelfItems`, `useRefresh`,
  `usePromoteToOrdered`, `useDemoteToDetected`, optimistic updates for
  promote/demote.
- Type-aware empty states.

**Acceptance:** Playwright E2E happy path: create shelf with a real public
playlist URL → see detected populated → drag one to ordered → reorder →
delete one with warning → refresh → see deleted album re-detected.

### B4 — activity events + polish (~1 day)

- Wire all 4 new activity events into the bell feed UI (`activity.tsx`).
- Per-event payload rendering (e.g. "@kira refreshed Saturday Vinyl —
  3 new albums").
- "X new" pill animation on detected rows after refresh.
- Loading shimmer on initial fetch.
- Knip cleanup of any dead exports from Chunk A.

**Acceptance:** activity feed shows refresh / promote / demote / source-
changed events with sensible copy. Knip clean.

---

## 9. Testing strategy

Per [`redesign-spec.md` §13](./redesign-spec.md#13-testing) — vitest for
backend logic, Playwright for E2E.

**Vitest coverage targets (≥70% per redesign convention):**

- `lib/spotify/app-client.ts` — token cache, expiry, 401-retry, pagination
  boundary, malformed Spotify response handling.
- `lib/spotify/playlist-parser.ts` — every URL/URI variant + malformed.
- `routes/v1/lists.ts` — album_shelf creation flow, source-URL change.
- `routes/v1/items.ts` — position validator, promote/demote events.
- New refresh endpoint — concurrent refresh idempotency, partial Spotify
  failure rollback.

**Playwright happy-path E2E (one new spec):**

```ts
// tests/e2e/album-shelf.spec.ts
test("album shelf — full lifecycle", async ({ page }) => {
  // 1. Sign in
  // 2. Create album_shelf with a known public test playlist (we maintain
  //    a stable test playlist on a Workshop-owned Spotify account)
  // 3. Assert detected section populated, ordered empty
  // 4. Drag first detected row into ordered; assert it shows position 1
  // 5. Delete a detected album with confirmation; assert removed
  // 6. Refresh; assert deleted album re-appears in detected
  // 7. Change source URL to a different test playlist; assert merge
  //    (old detected items still present, new detected items added)
});
```

The stable test playlist is a one-time setup task: create a playlist on a
Workshop-owned Spotify account with ~5 known tracks across ~3 albums, mark
public, paste URL into the test config. Document in
`docs/recovery-runbook.md` so it's not lost.

---

## 10. Open questions / explicit deferrals

To pin down before B1 starts:

1. **Per-album notes.** Should `items.note` be exposed in album shelf row
   detail? (e.g., "skip side B" or "play after dinner".) Easy to add;
   defer to a follow-up unless surfaced as a need during B3.
2. **Bulk operations.** Promote-all-detected, delete-all-detected.
   Marginal value; defer.
3. **Duplicate-album merging across shelves.** If the same album appears
   on two shelves, it's two separate items by spec. Confirm.
4. **Spotify track-level metadata.** We currently store album-level only.
   If users want to see _which_ tracks on the playlist contributed to the
   album's detection, we'd need to store track ids per item or compute
   on-the-fly during render. Defer; surface only if asked.
5. **Position float renumbering threshold.** §3.3.1 picks `0.001` as the
   tolerance before renumbering. That gives ~30 inserts between any two
   adjacent items before renumber — generous for a shelf of 100. Tune in
   B2 if needed.
6. **URL change wipe option.** Pure-additive on URL change is the chosen
   behavior. If users keep building muscle memory of "change URL = reset
   shelf," consider a future "wipe and reset" toggle in the change-URL
   modal. Not v1.1.
7. **Mobile drag-across-sections gesture conflicts.** `react-native-
draggable-flatlist` typically uses per-list dragging; cross-list drag
   needs a wrapping component or a custom gesture handler. Spike during
   B3 design; fall back to "tap to promote / tap to demote" if drag-across
   proves brittle on iOS.
8. **EmptyState copy.** §4.2's strings are placeholders; pass through
   final-copy review during B3.

Explicitly out of scope for v1.1:

- Apple Music / Tidal / YouTube Music sources.
- Album metadata enrichment (Discogs, RYM scores, genre tags).
- Now-playing or any playback integration.
- Per-user album preferences inside a shared shelf.
- Track-level UI (it's an album shelf, not a track shelf).
- Push notifications on refresh ("new album detected!").
- iOS share extension support for Spotify URLs (the share extension flow
  in [`redesign-spec.md` §10](./redesign-spec.md#10-ios-share-extension)
  routes to the standard add-item confirm — for album_shelf the relevant
  flow is "create new shelf from this URL," which is a separate chunk if
  asked for).

---

## 11. Acceptance for v1.1 release

- Both chunks merged.
- Web build deployed; iOS TestFlight build cut (drag interactions are
  native code — needs a fingerprint bump).
- A live shelf running off a real public playlist, refreshed at least once
  by each shared member, with a representative ordered + detected split.
- Activity events visible in the cross-list bell feed.
- No regressions in the redesign Phases 0–5 surface.
