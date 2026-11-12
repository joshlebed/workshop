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
| Ranked section                       | `ranking`     | Owner toggle. Off still leaves every open row draggable (UX pass 2.7); the copy says so                                                                  | Every kind                                         |
| Letterboxd match                     | `letterboxd`  | Owner toggle. Turning it on attaches a `letterboxd_match` source; off removes it. Points to Settings → Connections when the viewer has no Letterboxd yet | `movie` only                                       |
| Synced from                          | `sources`     | **Not a toggle.** On exactly when the list has at least one attached source; attaching the first or removing the last flips it in the same transaction   | Kinds with a sync source: `movie`, `spotify_album` |
| Leaderboard                          | `leaderboard` | Retired. Never offered; legacy rows are left alone                                                                                                       | Nothing                                            |

## Kind × feature × copy

| Kind (`item_kind`) | Settings "Holds" | Noun           | Done word | Count line     | Check-off label  | Toggles offered                     | Synced from      | Add                    | Paste many | Empty state (title → action)                       |
| ------------------ | ---------------- | -------------- | --------- | -------------- | ---------------- | ----------------------------------- | ---------------- | ---------------------- | ---------- | -------------------------------------------------- |
| blank (NULL)       | Anything         | item / items   | Done      | 3 to do        | Check things off | Check off, Ranked                   | none             | Quick add              | yes        | Nothing here yet → Add an item                     |
| `plain`            | Text items       | item / items   | Done      | 3 to do        | Check things off | Check off, Ranked                   | none             | Quick add              | yes        | Nothing here yet → Add an item                     |
| `link`             | Links and places | link / links   | Tried     | 3 to try       | Mark tried       | Check off, Ranked                   | none             | Quick add (link first) | yes        | Nothing saved yet → Add a link                     |
| `movie`            | Movies           | film / films   | Watched   | 3 to watch     | Mark watched     | Check off, Ranked, Letterboxd match | Letterboxd list  | Search TMDB            | yes        | No movies yet → Add a movie                        |
| `tv`               | TV shows         | show / shows   | Watched   | 3 to watch     | Mark watched     | Check off, Ranked                   | none             | Search TMDB            | yes        | No shows yet → Add a show                          |
| `book`             | Books            | book / books   | Read      | 3 to read      | Mark read        | Check off, Ranked                   | none             | Search Google Books    | yes        | Nothing on the shelf yet → Add a book              |
| `spotify_album`    | Albums           | album / albums | Listened  | 3 to listen to | Mark listened    | Check off, Ranked                   | Spotify playlist | **None (sync only)**   | no         | No playlist connected → Connect a playlist (owner) |

Descriptions are generated from the noun and done word: "Ticked films move to a Watched
section.", "Number your top films above the rest. Dragging works either way." Activity reads
"watched Past Lives", "listened to Currents", "marked Milk done".

## Templates

Templates (`packages/shared/src/templates.ts`) are bundles of a kind plus default toggles. They
never list `sources`: the backend derives it from the template's source.

| Template             | Kind            | Default toggles          | Source at create               |
| -------------------- | --------------- | ------------------------ | ------------------------------ |
| Blank list           | blank           | Ranked                   |                                |
| To-do list           | `plain`         | Check off, Ranked        |                                |
| Movie watchlist      | `movie`         | Check off, Ranked        |                                |
| TV watchlist         | `tv`            | Check off, Ranked        |                                |
| Reading list         | `book`          | Check off, Ranked        |                                |
| Date ideas           | `link`          | Check off, Ranked        |                                |
| Trip plan            | `link`          | Check off, Ranked        |                                |
| Album shelf          | `spotify_album` | Ranked                   | Spotify playlist (asked for)   |
| Letterboxd watchlist | `movie`         | Check off, Ranked        | Letterboxd list (asked for)    |
| Letterboxd match     | `movie`         | Ranked, Letterboxd match | `letterboxd_match` (automatic) |

"Customize first" shows the kind's toggles with the template's defaults, so a list can start
without check-off or the ranked section.

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
