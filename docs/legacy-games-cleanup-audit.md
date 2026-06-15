# Legacy game-list → Games migration: pre-cleanup audit

**Status: ✅ cleared to begin cleanup (in the staged order below).** Run date
2026-06-14. This is the objective "safe to delete" signal — prod evidence, not
code intent — gathered before retiring the legacy leaderboard-list surfaces.

Re-run any time with the two committed, **read-only** tools:

```bash
# Log side — legacy usage by operation / platform / app_version / list_id
scripts/legacy-games-audit.sh all --since 14d

# DB side — backfill invariants + item_scores drop-safety
DATABASE_URL="$(AWS_PROFILE=workshop-prod aws ssm get-parameter \
  --name /workshop-prod/db/url --with-decryption \
  --query Parameter.Value --output text)" \
  pnpm --filter @workshop/backend exec tsx scripts/legacy-games-db-audit.ts
```

(Niteshift sandbox: the assumed role already has `ssm:GetParameter` + CloudWatch
read, so both run without a profile.)

---

## Method & window

Two structured events landed in PR #343 (`apps/backend/src/lib/legacyGameLists.ts`),
deployed **2026-06-12 19:39 UTC**, right after the retirement PR #341 (19:14 UTC):

- **`legacy_game_list_access`** — an authorized legacy read/write still served
  through the compatibility bridge. Operations: `detail`, `read`, `items`,
  `views`, `preview_by_id`, `preview_by_slug`, `public_items_by_slug`,
  `item_score_read`, `item_score_upsert`, `item_score_delete`, `list_scores`.
- **`legacy_game_list_retired_rejected`** — a stale client trying to create or
  enable a retired config (400ed). Operations: `create`, `duplicate`,
  `update_config`, `config_preview`.

Observation window: **~48 h** since both retirement + logging went live
(2026-06-12 19:45 → 2026-06-14 19:11 UTC). CloudWatch retention is 365 days
(`infra/lambda.tf`), so a longer window is available on re-run. Caveat: this is a
low-volume personal app (~9 active users, 786 requests in the window), so 48 h is
_indicative_ — see the staged plan for which steps want a longer window first.

Pipeline sanity-checked before trusting any "no results": the same window shows
`request` (786), `client_telemetry`, and `game_added` events via identical query
syntax, and a raw substring grep for `legacy_game_list` returns nothing — so
"zero" is real absence of traffic, not a broken filter.

---

## 1. Log-side findings — zero legacy usage

Every `legacy-games-audit.sh` report over the window returns **no results**:

| Report                                               | Result |
| ---------------------------------------------------- | ------ |
| `summary` (both events × operation × status)         | ✅ 0   |
| `by-operation` (access)                              | ✅ 0   |
| `by-platform` (both events × platform × app_version) | ✅ 0   |
| `by-list` (access × list_id)                         | ✅ 0   |
| `rejected` (stale-client writes)                     | ✅ 0   |
| `score-backend` (item_scores vs game_scores)         | ✅ 0   |
| `samples` (raw event lines)                          | ✅ 0   |

**Request-log cross-check** (catches traffic even if the legacy detector never
fired) — the only score traffic is the canonical Games route; legacy score/item/
detail routes are silent:

| route                                                                    | method | hits  | users |
| ------------------------------------------------------------------------ | ------ | ----- | ----- |
| `/v1/games/:id/scores` (canonical Games)                                 | PUT    | 34    | 5     |
| `/v1/lists/by-slug/:slug/preview`                                        | GET    | 7     | 0     |
| `/v1/lists/:id/scores` (legacy `list_scores`)                            | —      | **0** | —     |
| `/v1/items/:id/scores` (legacy item score r/w/d)                         | —      | **0** | —     |
| `/v1/lists/:id` detail · `/v1/lists/:id/items` · `/v1/lists/:id/preview` | —      | **0** | —     |

### Classification of remaining hits

There are **no legacy hits to classify**. The only adjacent traffic is the 7
anonymous (`users = 0`) `by-slug/preview` calls. None tripped the legacy detector
(zero `preview_by_slug` / `public_items_by_slug` access events) — so they were
**bot / social-preview / share-link opens of non-game lists**, not legacy game
lists. (A by-slug preview of the `Geo games` leaderboard list _would_ have emitted
`preview_by_slug`; none did.) No "real user on stale app version", no "bug in the
new Games surface calling old routes", no "old share link to a game list".

---

## 2. DB invariant findings — all hold

From `legacy-games-db-audit.ts` against prod Neon (read-only session):

| #   | Invariant                                                 | Result                                                          | ✅  |
| --- | --------------------------------------------------------- | --------------------------------------------------------------- | --- |
| 1   | Every historically-scored game is in that user's My Games | `0` (user, game) pairs missing                                  | ✅  |
| 2   | Historical `game_scores` exist & queryable                | 346 scores · 9 games · 9 users · 28 days · through `2026-06-14` | ✅  |
| 3   | `user_games` order is a stored, stable position           | 66 rows, all positioned, **0** users with duplicate positions   | ✅  |
| 4   | Backfill added no automatic friend edges                  | 14 edges, all organic (see below)                               | ✅  |
| 5   | Legacy `Geo games` list intact + mapped (bridge resolves) | active, **8/8** items mapped to a canonical game                | ✅  |

Legacy list inventory: **2** lists carry `modules @> {leaderboard}` (neither uses
`item_kind = 'game'`):

| list                             | state    | items | mapped | note                                                             |
| -------------------------------- | -------- | ----- | ------ | ---------------------------------------------------------------- |
| `Geo games` (`96195e65…`)        | active   | 8     | 8/8    | the live bridge target                                           |
| `Geo games (copy)` (`63de6af9…`) | archived | 6     | 5/6    | archived → off every read path; the 1 unmapped item has 0 scores |

**Invariant 3 nuance.** Migration `0029` seeded the _initial_ position by play
count ("most played first") as a one-time backfill, then ordering became a stored
value. Confirmed in code: the My Games read path orders by
`user_games.position ASC NULLS LAST` (`routes/v1/games.ts:265-272`) and a search
for any score/play-count ordering in read paths returns nothing — order is **not**
re-derived per read.

**Invariant 4 detail.** No migration SQL inserts into `friendships` /
`friend_requests` (grep over `drizzle/*.sql`), and `0029` explicitly leaves friend
edges untouched. The 14 edges span 2026-06-11..06-12; the earliest (06-11 06:20)
predates the `0029` backfill apply time (06-11 16:24) by ~10 h and edges don't
cluster on a migration timestamp — organic friend-feature usage, not backfill.

---

## 3. `item_scores` drop-safety — data redundant, code still depends

The data is fully migrated and carries nothing non-game:

- **257** rows · 8 items · 9 users · last write **2026-06-10 19:09** (none since
  retirement — all writes now go to `game_scores`).
- **100 % mapped**: every row's parent item has `game_id` set. **0** unmapped
  (i.e. no non-game / non-migrated scores living only here — the exact risk the
  task flags).
- **100 % mirrored**: `0` mapped rows are missing from `game_scores`.

→ **The table holds only fully-migrated, game-mapped historical scores.** But the
**code** still references it, so the table drop is the _last_ step, after the
read/write bridge is gone (see plan). Current `item_scores` code references:

| reference                                                                                                                           | role                  | when to remove           |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------ |
| `routes/v1/scores.ts` — `itemScoreRoutes` (`PUT/DELETE/GET /v1/items/:id/scores`) + `listScoresRoutes` (`GET /v1/lists/:id/scores`) | the read/write bridge | with the read bridge     |
| `lib/moduleManifests.ts` — `leaderboard` module removal warning                                                                     | counts scores         | with the read bridge     |
| `lib/opsNotifications.ts` — `userHasAnyScore` spans both tables                                                                     | first-score ping      | when table dropped       |
| `app/(tabs)/(lists)/list/[id]/game/[itemId].tsx` — `fetchItemScores`                                                                | Lists-side board      | with client entry points |
| `scripts/{rescore-game,cleanup-invalid-scores,seed}.ts`                                                                             | admin / dev tooling   | when table dropped       |

---

## 4. Code-search inventory (what depends on the legacy concepts)

Ran the task's required searches: `item_scores`, `leaderboard`,
`itemKind === "game"` / `isGameKind`, `pick-leaderboard`, old list-score
endpoints, old copy/share paths. Summary of what still references legacy game-list
behavior and therefore must be retired in order:

**Backend**

- `lib/legacyGameLists.ts` — the `isLegacyGameListConfig` detector + both log
  events (detector = `itemKind === "game" || modules.includes("leaderboard")`).
- `routes/v1/scores.ts` — `itemScoreRoutes` + `listScoresRoutes` (the score
  bridge: legacy `item_id` → canonical `game_scores`, `item_scores` fallback for
  unmapped items).
- `routes/v1/lists.ts` — retired-rejected on `create`/`duplicate`/`update_config`/
  `config_preview`; legacy access logging on `detail`/`read`/`items`/previews;
  **already** hides legacy lists from `GET /v1/lists` (`AND NOT ('leaderboard' =
ANY(modules) OR item_kind='game')` + `isLegacyGameListSummaryRow` filter, #324).
- `routes/v1/views.ts` — legacy access logging on `views`.
- `lib/moduleManifests.ts` — `leaderboard` module removal-warning reads
  `item_scores`.

**Client**

- `app/share/pick-leaderboard.tsx` — pure `<Redirect>` to `/share/pick-game`
  (compat only, no posting UI).
- `app/(tabs)/(lists)/list/[id]/game/[itemId].tsx` — Lists-side per-game board
  (`fetchItemScores`).
- `screens/ListDetail.tsx` + `screens/listDetail/*` (`GameLeaderboardCard`,
  `ItemList` `isGameKind` branches, `onCopyScores`) — Lists-side leaderboard-card
  rendering + the old copy-scores behavior. `isGameKind` (client) =
  `modules.includes("leaderboard")`.

(`GameLeaderboardCard` / `StandingsCard` and `summarizeScoreBody` are _shared_
with the live Games tab — remove the Lists-side adapter, not the shared card.)

---

## 5. Recommended cleanup path (objective signal → staged plan)

The evidence clears the staged removal the task outlined. Safe to do now vs.
hold-for-a-longer-window:

1. **Now — remove client entry points.** The stale-client write path is provably
   dead (`legacy_game_list_retired_rejected` = 0). Server-side hiding from
   summaries already shipped (#324); finish hiding/removing remaining Lists-side
   game/leaderboard surfaces so customers only see Games.
2. **Now — remove stale-client write compatibility.** `create` / `duplicate` /
   `update_config` / `config_preview` rejection is quiet (0). Delete legacy
   leaderboard-list creation/update/duplicate support; keep explicit 400s only if
   useful.
3. **Hold, then remove the read bridge.** `legacy_game_list_access` = 0 over 48 h,
   but native (TestFlight) builds update slowly — a pre-migration build could
   still render the Lists-side card and call `/v1/lists/:id/scores`. **Re-run
   `legacy-games-audit.sh all --since 14d` and confirm still-zero before** deleting
   the legacy list-score adapters, Lists-side game cards, old copy behavior,
   `/share/pick-leaderboard`, and related branches.
4. **Last — DB cleanup.** Only after the read bridge is gone: take a Neon
   branch/restore point, then drop `item_scores` (data already proven redundant by
   §3). Archive/drop the `Geo games` legacy list rows/columns first if desired.
   Re-run the DB audit immediately before to confirm `0` unmapped `item_scores`.

When a cleanup PR removes one of these surfaces, delete the matching row from §3/§4
here and the corresponding gotcha in `apps/backend/CLAUDE.md`.

---

## 6. Remaining-work decision point (re-checked 2026-06-15)

Steps 1–3 of §5 are effectively **already shipped** (before this audit): legacy
lists are hidden from every client (#324), new leaderboard-list creation is
rejected (#341), and the monitoring is live (#343). So **customers already only
see Games.** What's left is §5 steps 3(hold)→4: the **read bridge + Lists-side
client surfaces** (one coupled unit per §4), then the **`item_scores` drop**.

Re-ran the audit at **55 h** post-retirement: `legacy_game_list_access` /
`legacy_game_list_retired_rejected` still **zero**; the only score traffic is the
canonical `/v1/games/:id/scores` (53 PUTs / 7 users). Unchanged conclusion.

### Why the read bridge can't come out yet — the gate is a _named_ stale tail

The app is still runtime version **`0.5.0`**, and the **entire Games migration
shipped as an OTA inside `0.5.0`** (#305–#320 all landed after the 0.5.0 bump on
2026-06-02). Runtime-version policy is `appVersion`, so clients on **`0.3.0` /
`0.4.0` can't receive the Games OTA** — they still render the old Lists UI where
`Geo games` is a leaderboard list that calls the legacy `/v1/lists/:id/scores` and
`/v1/items/:id/scores` endpoints. **That is the only thing the read bridge
protects**, and it's real people, not test accounts:

| User             | Build       | Platform  | Last seen   | Risk on bridge removal          |
| ---------------- | ----------- | --------- | ----------- | ------------------------------- |
| **Josh** (owner) | 0.3.0/0.4.0 | iOS + web | 2026-06-02  | own device — knowable           |
| **Renata Hoh**   | 0.3.0       | iOS       | 2026-06-03  | old app breaks on `Geo games`   |
| **Paloma**       | 0.4.0       | iOS       | ~2026-06-01 | old app breaks on `Geo games`   |
| **Roman Zinnes** | 0.4.0       | iOS       | ~2026-05-29 | old app breaks on `Geo games`   |
| Dagmawi Dereje   | 0.3.0       | web only  | 2026-06-05  | none — web self-heals on reload |

Web stale versions self-heal (next page load serves the latest deploy). The
**three stale-build native iOS friends** are stuck on their runtime version until
they install a newer TestFlight build; OTA can't move them. Zero legacy traffic
for 55 h, but none of the three has opened _any_ endpoint in 10–17 days — they're
dormant, not gone.

### The call (owner's to make)

- **Wait for the window (recommended):** re-run `legacy-games-audit.sh all --since
14d` around **2026-06-26**; if still zero and the three have updated or stayed
  dormant, remove the whole legacy surface in §4 order, then drop `item_scores`
  behind a Neon restore point.
- **Unblock sooner:** nudge Renata / Paloma / Roman to update to the latest
  TestFlight build (gets them onto `0.5.0` + the Games OTA, off the legacy path) —
  then the bridge can come out immediately.
- **Proceed now anyway:** accept that those three iOS apps show broken `Geo games`
  scores if reopened before updating. Reversible in code (revert + redeploy), but
  user-facing in the gap.

No destructive change was made in this session — the bridge still guards the three
stale clients, so removal awaits an explicit go-ahead or the window closing.
