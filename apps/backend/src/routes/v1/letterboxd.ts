// Letterboxd-match surface (the `letterboxd` module):
//
//   - `GET  /v1/lists/:id/letterboxd`          — per-member connection + sync status
//   - `POST /v1/lists/:id/letterboxd/suggest`  — bring a film from Letterboxd as a suggestion
//   - `POST /v1/items/:id/accept`              — accept a suggestion (and confirm "added on Letterboxd")
//   - `DELETE /v1/items/:id/accept`            — withdraw an acceptance
//
// Two routers because the path roots differ: `listLetterboxdRoutes` mounts at
// `/v1/lists` alongside memberRoutes/listScoresRoutes, `itemAcceptRoutes` at
// `/v1/items`. Same factoring as views.ts / scores.ts.
//
// Acceptance model (per-member opt-in): the suggester gets an acceptance row
// at suggest time; the first acceptance from a *different* member promotes
// the item out of `suggestion_state = 'pending'` into the main list. Rows
// survive promotion — they power the "who's in" badge. Workshop can't write
// to Letterboxd (no public API), so "accept" deep-links the member to the
// film page client-side and records intent here; the next watchlist sync
// shows whether the film actually landed via the `watchlistOf` read state.

import type { ActivityEventType, LetterboxdMemberStatus } from "@workshop/shared";
import type { ModuleName } from "@workshop/shared/modules";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { itemAcceptances, items, listSources, lists } from "../../db/schema.js";
import { getConfig } from "../../lib/config.js";
import { recordEvent } from "../../lib/events.js";
import { logger } from "../../lib/logger.js";
import { requireModule } from "../../lib/moduleGate.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import {
  InvalidLetterboxdUrlError,
  LetterboxdScrapeError,
  searchTmdbMovie,
  type TmdbMovieRecord,
} from "../../lib/sources/letterboxdList.js";
import { fetchFilmInfo, parseLetterboxdFilmUrl } from "../../lib/sources/letterboxdWatchlist.js";
import { executeRows } from "../../lib/sql.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireItemMember, requireListMember } from "../../middleware/authorize.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { fetchItemShape } from "./items.js";

export const listLetterboxdRoutes = new Hono();
export const itemAcceptRoutes = new Hono();

listLetterboxdRoutes.use("*", requireAuth);
itemAcceptRoutes.use("*", requireAuth);

async function getListModules(listId: string): Promise<ModuleName[]> {
  const [row] = await getDb()
    .select({ modules: lists.modules })
    .from(lists)
    .where(eq(lists.id, listId))
    .limit(1);
  return (row?.modules ?? []) as ModuleName[];
}

// --- GET /v1/lists/:id/letterboxd ---

listLetterboxdRoutes.get("/:id/letterboxd", requireListMember, async (c) => {
  const listId = c.req.param("id");
  const gate = requireModule(c, await getListModules(listId), "letterboxd");
  if (gate) return gate;
  const db = getDb();

  const memberRows = await executeRows<{
    user_id: string;
    display_name: string | null;
    letterboxd_username: string | null;
    letterboxd_synced_at: Date | string | null;
    film_count: number;
  }>(
    db,
    sql`
      SELECT
        u.id AS user_id, u.display_name, u.letterboxd_username, u.letterboxd_synced_at,
        (SELECT COUNT(*)::int FROM letterboxd_watchlist_films w WHERE w.user_id = u.id) AS film_count
      FROM list_members m
      JOIN users u ON u.id = m.user_id
      WHERE m.list_id = ${listId}
      ORDER BY m.joined_at ASC
    `,
  );

  const members: LetterboxdMemberStatus[] = memberRows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    letterboxdUsername: r.letterboxd_username,
    filmCount: Number(r.film_count),
    syncedAt: r.letterboxd_synced_at ? new Date(r.letterboxd_synced_at).toISOString() : null,
  }));

  const [source] = await db
    .select({ id: listSources.id, lastSyncedAt: listSources.lastSyncedAt })
    .from(listSources)
    .where(and(eq(listSources.listId, listId), eq(listSources.kind, "letterboxd_match")))
    .limit(1);

  return ok(c, {
    members,
    sourceId: source?.id ?? null,
    lastSyncedAt: source?.lastSyncedAt ? source.lastSyncedAt.toISOString() : null,
  });
});

// --- POST /v1/lists/:id/letterboxd/suggest ---

const suggestSchema = z.object({
  letterboxdUrl: z.string().min(1).max(2048),
});

listLetterboxdRoutes.post(
  "/:id/letterboxd/suggest",
  requireListMember,
  rateLimit({
    family: "v1.letterboxd.suggest",
    limit: 30,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const parsed = await parseJsonBody(c, suggestSchema);
    if (!parsed.ok) return parsed.response;
    const listId = c.req.param("id");
    const userId = c.get("userId");
    const gate = requireModule(c, await getListModules(listId), "letterboxd");
    if (gate) return gate;

    let film: { slug: string; url: string };
    try {
      film = parseLetterboxdFilmUrl(parsed.data.letterboxdUrl);
    } catch (e) {
      if (e instanceof InvalidLetterboxdUrlError) {
        return err(c, "VALIDATION", "paste a Letterboxd film URL (letterboxd.com/film/…)", {
          code: "INVALID_LETTERBOXD_FILM_URL",
        });
      }
      throw e;
    }

    const db = getDb();

    // Already on the list (any state, archived included)? Point at the
    // existing row instead of minting a duplicate suggestion.
    const dupRows = await executeRows<{ id: string; suggestion_state: string | null }>(
      db,
      sql`
        SELECT id, suggestion_state FROM items
        WHERE list_id = ${listId} AND kind = 'movie'
          AND content->>'letterboxdSlug' = ${film.slug}
        LIMIT 1
      `,
    );
    const dup = dupRows[0];
    if (dup) {
      return err(
        c,
        "CONFLICT",
        "already_on_list",
        { code: "already_on_list", itemId: dup.id, pending: dup.suggestion_state === "pending" },
        409,
      );
    }

    // Best-effort metadata: film page title/year, then TMDB. Neither failing
    // blocks the suggestion — worst case the item carries a humanized slug.
    let info: { title: string; year: number | null };
    try {
      info = await fetchFilmInfo(film.slug);
    } catch (e) {
      if (e instanceof LetterboxdScrapeError) {
        return err(c, "VALIDATION", "could not read that film page", {
          code: "LETTERBOXD_FETCH_FAILED",
        });
      }
      throw e;
    }
    let enriched: TmdbMovieRecord | null = null;
    const apiKey = getConfig().tmdbApiKey;
    if (apiKey) {
      try {
        enriched = await searchTmdbMovie(info.title, info.year, apiKey);
      } catch (e) {
        logger.warn("tmdb enrich failed (suggest)", { slug: film.slug, error: e });
      }
    }

    const content: Record<string, unknown> = {
      source: enriched ? "tmdb" : "letterboxd",
      letterboxdUrl: film.url,
      letterboxdSlug: film.slug,
    };
    if (enriched) {
      content.sourceId = enriched.tmdbId;
      content.tmdbId = enriched.tmdbId;
      if (enriched.posterUrl) content.posterUrl = enriched.posterUrl;
      if (enriched.year !== null) content.year = enriched.year;
      else if (info.year !== null) content.year = info.year;
      if (enriched.runtimeMinutes !== null) content.runtimeMinutes = enriched.runtimeMinutes;
      if (enriched.overview) content.overview = enriched.overview;
    } else if (info.year !== null) {
      content.year = info.year;
    }
    const title = enriched?.title ?? info.title;

    const itemId = await db.transaction(async (tx) => {
      const rows = await executeRows<{ id: string }>(
        tx,
        sql`
          INSERT INTO items (list_id, kind, title, url, content, added_by, position, suggestion_state)
          VALUES (
            ${listId}, 'movie', ${title}, ${film.url},
            ${JSON.stringify(content)}::jsonb, ${userId}, NULL, 'pending'
          )
          ON CONFLICT DO NOTHING
          RETURNING id
        `,
      );
      const row = rows[0];
      if (!row) return null;
      // The suggester is implicitly in — they brought the film.
      await tx.insert(itemAcceptances).values({ itemId: row.id, userId });
      await recordEvent({
        db: tx,
        listId,
        actorId: userId,
        type: "item_suggested",
        itemId: row.id,
        payload: { title, letterboxdSlug: film.slug },
      });
      return row.id;
    });

    if (!itemId) {
      // tmdbId dedup index fired — same film already present under a
      // different slug spelling.
      return err(c, "CONFLICT", "already_on_list", { code: "already_on_list" }, 409);
    }

    const item = await fetchItemShape(itemId);
    if (!item) return err(c, "NOT_FOUND", "item not found");
    return ok(c, { item }, 201);
  },
);

// --- POST /v1/items/:id/accept + DELETE /v1/items/:id/accept ---

async function getItemForAccept(itemId: string): Promise<{
  listId: string;
  suggestionState: string | null;
  title: string;
  addedBy: string;
  modules: ModuleName[];
} | null> {
  const rows = await executeRows<{
    list_id: string;
    suggestion_state: string | null;
    title: string;
    added_by: string;
    modules: string[] | null;
  }>(
    getDb(),
    sql`
      SELECT i.list_id, i.suggestion_state, i.title, i.added_by, l.modules
      FROM items i JOIN lists l ON l.id = i.list_id
      WHERE i.id = ${itemId} AND i.archived_at IS NULL
      LIMIT 1
    `,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    listId: r.list_id,
    suggestionState: r.suggestion_state,
    title: r.title,
    addedBy: r.added_by,
    modules: (r.modules ?? []) as ModuleName[],
  };
}

itemAcceptRoutes.post(
  "/:id/accept",
  requireItemMember,
  rateLimit({
    family: "v1.letterboxd.accept",
    limit: 60,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const itemId = c.req.param("id");
    const userId = c.get("userId");
    const row = await getItemForAccept(itemId);
    if (!row) return err(c, "NOT_FOUND", "item not found");
    const gate = requireModule(c, row.modules, "letterboxd");
    if (gate) return gate;

    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.insert(itemAcceptances).values({ itemId, userId }).onConflictDoNothing();

      // First acceptance from someone other than the suggester promotes the
      // item into the main list. (A film synced from the overlap is never
      // pending, so this is a no-op for it.)
      if (row.suggestionState === "pending" && userId !== row.addedBy) {
        await tx
          .update(items)
          .set({ suggestionState: null, updatedAt: new Date() })
          .where(and(eq(items.id, itemId), eq(items.suggestionState, "pending")));
        await recordEvent({
          db: tx,
          listId: row.listId,
          actorId: userId,
          type: "suggestion_accepted" satisfies ActivityEventType,
          itemId,
          payload: { title: row.title },
        });
      }
    });

    const item = await fetchItemShape(itemId);
    if (!item) return err(c, "NOT_FOUND", "item not found");
    return ok(c, { item });
  },
);

itemAcceptRoutes.delete("/:id/accept", requireItemMember, async (c) => {
  const itemId = c.req.param("id");
  const userId = c.get("userId");
  const row = await getItemForAccept(itemId);
  if (!row) return err(c, "NOT_FOUND", "item not found");
  const gate = requireModule(c, row.modules, "letterboxd");
  if (gate) return gate;

  // Withdrawing never re-pends a promoted item — rank stability over churn.
  await getDb()
    .delete(itemAcceptances)
    .where(and(eq(itemAcceptances.itemId, itemId), eq(itemAcceptances.userId, userId)));

  const item = await fetchItemShape(itemId);
  if (!item) return err(c, "NOT_FOUND", "item not found");
  return ok(c, { item });
});
