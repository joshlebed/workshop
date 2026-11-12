# List types: what each kind offers

One registry decides, for every kind of list, which features list settings offers, what each is
called in that list's words, how a row gets added, and what the list calls its things:
`packages/shared/src/listKinds.ts` (`@workshop/shared/listKinds`). List settings, Customize
first, list detail (empty state, header count, Done title, add affordance), the add surface,
home rows, activity copy and the backend's validation all read it. Change a kind there, not in a
screen.

Storage is unchanged: `lists.item_kind` (NULL = a blank list that takes anything) and
`lists.modules`. The registry is the rule that connects them.

## Features

| Feature                              | Storage       | How it is turned on                                                                                                                                      | Offered on                                         |
| ------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Check things off / Mark &lt;word&gt; | `todo`        | Owner toggle                                                                                                                                             | Every kind                                         |
| Letterboxd match                     | `letterboxd`  | Owner toggle. Turning it on attaches a `letterboxd_match` source; off removes it. Points to Settings → Connections when the viewer has no Letterboxd yet | `movie` only                                       |
| Synced from                          | `sources`     | **Not a toggle.** On exactly when the list has at least one attached source; attaching the first or removing the last flips it in the same transaction   | Kinds with a sync source: `movie`, `spotify_album` |
| Leaderboard                          | `leaderboard` | Retired. Never offered; legacy rows are left alone                                                                                                       | Nothing                                            |
| (Ranked section)                     | `ranking`     | Retired 2026-11 (one order per list, below). Dropped from every write; a stored copy is ignored                                                          | Nothing                                            |

## Kind × feature × copy

| Kind (`item_kind`) | Settings "Holds" | Noun           | Done word | Count line     | Check-off label  | Toggles offered             | Synced from      | Add                    | Paste many | Empty state (title → action)                       |
| ------------------ | ---------------- | -------------- | --------- | -------------- | ---------------- | --------------------------- | ---------------- | ---------------------- | ---------- | -------------------------------------------------- |
| blank (NULL)       | Anything         | item / items   | Done      | 3 to do        | Check things off | Check off                   | none             | Quick add              | yes        | Nothing here yet → Add an item                     |
| `plain`            | Text items       | item / items   | Done      | 3 to do        | Check things off | Check off                   | none             | Quick add              | yes        | Nothing here yet → Add an item                     |
| `link`             | Links and places | link / links   | Tried     | 3 to try       | Mark tried       | Check off                   | none             | Quick add (link first) | yes        | Nothing saved yet → Add a link                     |
| `movie`            | Movies           | film / films   | Watched   | 3 to watch     | Mark watched     | Check off, Letterboxd match | Letterboxd list  | Search TMDB            | yes        | No movies yet → Add a movie                        |
| `tv`               | TV shows         | show / shows   | Watched   | 3 to watch     | Mark watched     | Check off                   | none             | Search TMDB            | yes        | No shows yet → Add a show                          |
| `book`             | Books            | book / books   | Read      | 3 to read      | Mark read        | Check off                   | none             | Search Google Books    | yes        | Nothing on the shelf yet → Add a book              |
| `spotify_album`    | Albums           | album / albums | Listened  | 3 to listen to | Mark listened    | Check off                   | Spotify playlist | **None (sync only)**   | no         | No playlist connected → Connect a playlist (owner) |

Descriptions are generated from the noun and done word: "Ticked films move to a Watched
section." Activity reads "watched Past Lives", "listened to Currents", "marked Milk done",
"moved Currents".

## Templates

Templates (`packages/shared/src/templates.ts`) are bundles of a kind plus default toggles. They
never list `sources`: the backend derives it from the template's source.

| Template             | Kind            | Default toggles  | Source at create               |
| -------------------- | --------------- | ---------------- | ------------------------------ |
| Blank list           | blank           | (none)           |                                |
| To-do list           | `plain`         | Check off        |                                |
| Movie watchlist      | `movie`         | Check off        |                                |
| TV watchlist         | `tv`            | Check off        |                                |
| Reading list         | `book`          | Check off        |                                |
| Date ideas           | `link`          | Check off        |                                |
| Trip plan            | `link`          | Check off        |                                |
| Album shelf          | `spotify_album` | (none)           | Spotify playlist (asked for)   |
| Letterboxd watchlist | `movie`         | Check off        | Letterboxd list (asked for)    |
| Letterboxd match     | `movie`         | Letterboxd match | `letterboxd_match` (automatic) |

"Customize first" shows the kind's toggles with the template's defaults, so a list can start
without check-off.

## Order

A list is **one hand-ordered sequence of open items, plus Done.** There is no second block, no
numbering and no ordering switch.

- **Storage.** `items.position` (sparse integers, spacing 1024, ascending = top) is the order of
  every placed row; `apps/backend/src/lib/positions.ts` allocates and renumbers. Done and
  deleted rows keep their position, so reopening a row or undoing a delete puts it back where it
  was. `items.order_key` (the old second order) is no longer read or written; migration 0058
  mirrored `position` into it so the previous backend reads the same order, and it can be
  dropped in a later release.
- **New rows go to the top**: quick add, search add, bulk paste (in pasted order), the share
  extension, an accepted Letterboxd suggestion. They stay where a person drags them.
- **Moving.** Drag anywhere (web: mouse after 10px, touch after a 500ms hold; native: 500ms
  long-press), or the row menu's Move up / Move down / Move to top (with Undo). Under a filter a
  drop lands between the two rows the person saw.
- **Synced lists keep an inbox.** On a list with an attached source, rows a sync brought in that
  no person has placed yet (`position IS NULL`) sit **below** the list under a heading named for
  the source: "New from Spotify", "New from Letterboxd". They read newest first and do not
  reorder among themselves; one moves into the list by dragging it up or with "Add to list"
  (top of the list, with Undo). A list row dropped into the inbox lands at the bottom of the
  list. Nothing a person arranged ever moves on a sync, and nothing unplaced joins the
  arrangement by itself. Removing the last source folds the inbox in below the list.
- **Why below, not above, and not a "new" marker.** Above, every sync would push the
  arrangement down the screen; a marker with no block would put unplaced rows inside it. Below
  is where the album shelf's "detected" block always sat, so the shelf reads the same as before:
  the arrangement first, the pile to sort through after it. A fresh shelf (nothing placed yet)
  shows a dashed "Drag an album here to start the list" cell above the inbox.

### Old clients (previous bundles, binaries without the OTA, open web tabs)

| Old client does                                                         | Result                                                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Reads `GET /v1/lists/:id/items`                                         | `ordered: []`, `unordered: open + inbox`: one plain list in the right order, no Ranked header    |
| Reads `list.modules`                                                    | No `ranking` (0058 removed it), so it draws no Ranked block, no numerals, no rank menu items     |
| Drags / Move up / Move down (`section: "unranked"` + neighbours)        | Placed in the one order between the neighbours                                                   |
| `section: "unranked"` with no neighbours                                | Top of the list                                                                                  |
| `section: "ranked"` with or without neighbours (stale tab)              | Same as above: between the neighbours, or the top                                                |
| `ordered: true` (old promote into an empty Ranked block)                | Top of the list                                                                                  |
| No `section`, neighbours named (oldest move)                            | Between them                                                                                     |
| No `section`, no neighbours, no `ordered` (old "Remove from ranking")   | Back to the inbox on a list with a source (the shelf's old "Remove from order"); no-op elsewhere |
| Creates an item                                                         | Lands at the top                                                                                 |
| Sends `ranking` in `modules` (create, PATCH, config-preview, duplicate) | 200, ignored: never stored, no 400, no removal warning                                           |
| Old settings screen's "Ranked section" switch                           | Turning it on is ignored, so the switch reads off again after the save                           |
| Reads `position` on rows                                                | Every placed row has one; old clients only used it when `ranking` was on, which it never is now  |

Every shape is pinned by `apps/backend/src/routes/v1/item-order.test.ts`.

## Backend rules (`apps/backend/src/lib/listFeatures.ts`)

- `POST /v1/lists`, `PATCH /v1/lists/:id`, `POST /v1/lists/:id/config-preview` and
  `POST /v1/lists/:id/duplicate` run `resolveListModules`: a toggle the kind doesn't offer is
  `400 feature_not_offered` when the request turns it on, and kept when the list already has
  it. `sources` in a request is ignored and re-derived.
- `POST /v1/lists/:id/sources` no longer needs a `sources` switch first; it checks the kind
  (`400 source_not_offered`) and turns `sources` on in the same transaction.
  `DELETE …/sources/:id` turns it off when the last source goes, and turns Letterboxd match off
  when its source goes.
- A list with the retired `leaderboard` module is never re-derived.
- A kind change (`PATCH itemKind`) re-checks every toggle against the new kind and refuses to
  strand a source the new kind can't sync from.

## Old clients

Shipped binaries carry the old settings screen (every switch on every list, including
"Syncing") and old templates that send `sources`. What they can send, and what happens:

| Old client sends                                         | Result                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A template with `sources` in `modules` and its source    | Same list as before (`sources` derived on)                                        |
| The whole modules array with `sources`, toggling another | Works; `sources` follows what is attached                                         |
| "Syncing" on, with nothing attached                      | 200, ignored (nothing to sync)                                                    |
| "Syncing" off on an album shelf                          | 200, ignored (the playlist is still attached, so it stays on)                     |
| "Letterboxd matching" on a non-movie list                | 400 `feature_not_offered`; the old screen reverts the switch with its error toast |

Rejecting the `sources` toggle would have broken the old screen's whole Features section (it
sends the full array), so it is ignored. Letterboxd matching on a to-do list never did anything
useful, so refusing it costs an old client one error toast and nothing else.

## Kind conversion

Not built. `PATCH itemKind` already exists for the owner (blocked when rows of another kind
exist) and now re-checks features, but no screen offers it. The useful conversions are few
(blank → a typed kind once its rows agree; plain ↔ link) and each needs a row-by-row content
upgrade (a plain title has no TMDB id, poster or year), which is a product decision, not a
settings switch.
