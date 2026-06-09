# Lists & Leaderboards — build plan (stripped scope)

Status: **scope locked** (2026-06-09) · Owner: @joshlebed

The _how_ for [`docs/lists-and-leaderboards-spec.md`](./lists-and-leaderboards-spec.md). Scope
was cut hard on 2026-06-09 (see spec §1.1). This doc is the **list of independently-mergeable
pieces** — one piece ≈ one GitHub issue ≈ one PR an agent can own. Conventions unchanged: shared
types first, zod at the boundary, one Playwright happy-path per UI piece, Neon-branch before any
backfill, commit Drizzle SQL + `meta/` + `_journal.json`.

## What we're building (and not)

- **Lists:** tags + tag filter-chips + saved views. Kind-agnostic.
- **Games:** a **new, flag-gated, isolated tab** — global URL-deduped game catalog + per-user
  ordered "My Games" + a symmetric friend graph + per-viewer leaderboards. New tables, new
  routes, new screens. **Does not touch** the live `leaderboard` lists / `item_scores` / module.
- **Cut:** auto-categories, the `place` kind, the merge tool, the map view, cross-game ranking.
- **Deferred (not now):** migrating the old "Geo games" data into the new tables; retiring the
  old leaderboard module/route; re-pointing the share-extension. See spec §6.

No native modules are added in any piece (expo-router `Tabs` is JS), so everything ships via OTA
— no `app.json` version bump, no TestFlight gate.

---

## Pieces

Each piece is a self-contained PR. **[BE]** = backend + shared types + vitest (mergeable with no
user-visible change). **[FE]** = client UI + a Playwright happy-path.

### Track L — Lists

#### L1 — Tags + filter chips · **[BE+FE]** · size M

Manual tags on items + a client-side tag filter bar.

- **Backend:** migration `item_tags` (spec §2.4); `PUT /v1/items/:id/tags` (replace set, cap
  `edit_items`, emit `item_tagged`); add `tags: string[]` to item reads in
  `routes/v1/items.ts`; `GET /v1/lists/:id/tags` → `[{tag,count}]`; shared types
  (`packages/shared/src/types.ts`); vitest beside `items.test.ts`.
- **Client:** `apps/workshop/src/ui/TagFilterBar.tsx` (new; reuses `src/ui/Chip.tsx`,
  multi-select OR, explicit "All", count badges); tag editor (suggested-chip picker over the
  list's tags) in `app/list/[id]/item/[itemId].tsx`; client-side filter wired into
  `src/screens/listDetail/ItemList.tsx` + `ItemList.web.tsx`; `src/api/items.ts` +
  `src/api/lists.ts` wrappers; specific empty state.
- **Deps:** none. **Label:** `enhancement`.
- **Acceptance:** tag a date-ideas item `burgers`; chip bar shows `burgers (n)`; tapping filters
  the list instantly; "All" clears. Playwright: add tag → chip appears → filter narrows rows.

#### L2 — Saved views · **[BE+FE]** · size S–M

Persist a tag-filter as a named, shared view.

- **Backend:** migration `list_saved_views` (spec §2.4); `GET/POST/PATCH/DELETE
/v1/lists/:id/views` (any member creates; creator or owner deletes); `SavedView` shared type;
  vitest.
- **Client:** "Save current filter as a view" affordance on the filter bar; a views strip on the
  list detail (apply / delete); `src/api/views.ts`.
- **Deps:** **L1** (needs the filter UI + tags). **Label:** `enhancement`.
- **Acceptance:** filter to `burgers`, save as "Burgers" → it appears as a one-tap view for all
  members; reopening applies the filter. Playwright: save view → reload → apply.

### Track B — Games (new isolated tab)

#### G0 — Games tab shell (flag-gated) · **[FE]** · size M

The two-surface switch; an empty Games home behind a flag. The isolation boundary.

- `apps/workshop/app/_layout.tsx` — wrap the existing stack as the **Lists** tab and add a
  **Games** tab; expo-router `Tabs` on native, sidebar switch in `src/ui/Layout.tsx` on web.
  Existing routes/deep-links/share-intent unchanged.
- Gate the Games tab on a flag (`EXPO_PUBLIC_ENABLE_GAMES`, default off in prod; on in dev/e2e).
- `apps/workshop/app/games/index.tsx` — placeholder home (real content in G1b).
- **Deps:** none. **Label:** `enhancement`.
- **Acceptance:** with the flag on, both tabs render and all existing list routes work; with the
  flag off, the app looks exactly like today. Playwright (flag on): switch tabs; existing list
  flow still passes.

#### G1a — Games backend: catalog + My Games + scores · **[BE]** · size M–L

The data layer for a solo games tracker. New tables only — does not read or write `item_scores`.

- Migration: `games`, `user_games`, `game_scores` (spec §3.6); seed `games` from the
  `gameScoreRegex` catalog.
- `packages/shared/src/games.ts` (new subpath) — `Game`/`UserGame`/`GameScore` types +
  `normalizeGameUrl()` (pure, Metro-safe; **heavily unit-tested** incl. the `dailytens ?ref=`
  case, trailing slash, `www`, query/fragment).
- `apps/backend/src/routes/v1/games.ts` (new) — `GET /v1/games`, `POST /v1/games` (find-or-create
  by normalized URL), `DELETE /v1/games/:id`, `POST /v1/games/:id/move` (reuse
  `lib/positions.ts`), `PUT /v1/games/:id/scores` (upsert, auto-add, idempotent),
  `GET /v1/games/:id/leaderboard` (**self-only** until G2a). Parse via `lib/gameScoreRegex.ts`.
  Mount under the flag.
- **Deps:** none. **Label:** `enhancement`.
- **Acceptance:** vitest — add two URL variants of one game → one `games` row; post a score →
  idempotent re-post updates; reorder via `/move`. The live `item_scores` table is untouched.

#### G1b — Games UI: home + per-game board (solo) · **[FE]** · size M

The Games home and per-game screen for a single user (friends arrive in G2b).

- `apps/workshop/app/games/index.tsx` — my ordered games (drag-reorder, reuse the `ItemList`
  drag pattern), add-by-URL, per-row today status, paste affordance.
- `apps/workshop/app/games/[id].tsx` — my scores across days + a paste slot for today.
- `apps/workshop/src/api/games.ts`.
- **Deps:** **G0** (tab) + **G1a** (API). **Label:** `enhancement`.
- **Acceptance:** add a game by URL → paste a result → it lands on today's board; reorder
  persists. Playwright (flag on) covers add → paste → reorder.

#### G2a — Friends backend: graph + leaderboard union · **[BE]** · size M

- Migration: `friendships`, `friend_requests` (spec §3.6).
- `apps/backend/src/lib/friends.ts` — `friendsOf(userId)` (one indexed query over both columns);
  idempotent symmetric insert (`user_low < user_high`).
- `apps/backend/src/routes/v1/friends.ts` (new) — `GET /v1/friends`, `POST /v1/friends/invite`
  (token via `lib/shareSlug.ts`), `GET /v1/friends/requests/:token`,
  `POST /v1/friends/requests/:token/accept`, `DELETE /v1/friends/:userId`; rate-limit accept
  (reuse `middleware/rate-limit.ts`).
- Extend `GET /v1/games/:id/leaderboard` + `GET /v1/games` today-status to union
  `friendsOf(viewer)`.
- **Deps:** **G1a**. **Label:** `enhancement`.
- **Acceptance:** vitest — accept makes a symmetric edge (idempotent); a friend's score appears
  in my leaderboard for a shared game; non-friends never do.

#### G2b — Friends UI + social board · **[FE]** · size M

- `apps/workshop/app/friends/index.tsx` — friends list + share-link invite + incoming pending +
  accept; an accept-landing route reusing the `onboarding/accept-invite.tsx` + `lib/inviteStash.ts`
  deep-link round-trip; entry points from the Games header + Settings.
- Wire friends into the per-game board (ranked me + friends). `src/api/friends.ts`.
- **Deps:** **G1b** + **G2a**. **Label:** `enhancement`.
- **Acceptance:** Playwright with two dev users — A invites, B accepts, B's score on a shared
  game shows in A's board (and vice versa).

---

## Dependency graph & parallel waves

```
Lists:   L1 ─→ L2
Games:   G0 ─┐
             ├─→ G1b ─┐
        G1a ─┘        ├─→ G2b
        G1a ─→ G2a ───┘
```

| Wave  | Pieces (parallelizable)                        | Unblocks        |
| ----- | ---------------------------------------------- | --------------- |
| **1** | **L1**, **G0**, **G1a**                        | everything else |
| **2** | **L2** (L1) · **G1b** (G0+G1a) · **G2a** (G1a) | —               |
| **3** | **G2b** (G1b+G2a)                              | done            |

Tracks L and B are fully independent — you can ship all of Lists and none of Games, or stop after
any wave. Smallest first valuable PR = **L1**. The flag means Games pieces can merge to `main`
incrementally without showing an unfinished tab in production; flip `EXPO_PUBLIC_ENABLE_GAMES`
on once G2b lands.

---

## → GitHub issues

One tracking issue + one issue per piece (7 total), all labelled `enhancement`, each linking the
spec + this plan and stating its deps so agents can be assigned by wave:

- **Epic:** Lists tags/views + new Games tab (checklist of the 7)
- L1, L2, G0, G1a, G1b, G2a, G2b
