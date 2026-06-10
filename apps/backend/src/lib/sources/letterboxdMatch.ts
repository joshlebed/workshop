// Letterboxd match source (Letterboxd-match lists). The third source kind —
// and the first whose input is the *list's members* rather than an external
// URL: it joins every connected member's cached watchlist
// (`letterboxd_watchlist_films`, maintained per-user by
// `letterboxdWatchlist.ts`) and materializes films on ≥2 members' watchlists
// as `kind=movie` items.
//
// Config is `{}` — everything the sync needs is derived from
// (listId → members → usernames → caches). Sync refreshes stale member
// caches first (best-effort, a member's failed scrape degrades to their
// stale cache), then computes the overlap and inserts what's new.
//
// Net surface:
//   - `previewLetterboxdMatch(c)` → { ok: true, config: {}, preview }
//   - `syncLetterboxdMatchSource({ listId, userId, config, db, deps? })`
//     → { addedCount, refreshedAt }

import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import { type DbClient, executeRows } from "../sql.js";
import {
  type Fetcher,
  type ScrapedFilm,
  searchTmdbMovie,
  type TmdbMovieRecord,
} from "./letterboxdList.js";
import { syncUserWatchlist } from "./letterboxdWatchlist.js";

/** Member watchlist caches older than this are re-scraped during a match sync. */
const WATCHLIST_STALE_MS = 6 * 60 * 60 * 1000;

/** Films must be on at least this many members' watchlists to materialize. */
export const MATCH_THRESHOLD = 2;

interface LetterboxdMatchPreview {
  kind: "letterboxd_match";
}

export async function previewLetterboxdMatch(
  _c: Context,
): Promise<{ ok: true; config: Record<string, never>; preview: LetterboxdMatchPreview }> {
  // Nothing to validate — the source has no config. Membership/usernames are
  // checked at sync time (an empty overlap is a valid state, not an error).
  return { ok: true, config: {}, preview: { kind: "letterboxd_match" } };
}

interface ConnectedMember {
  user_id: string;
  letterboxd_username: string;
  letterboxd_synced_at: Date | string | null;
}

interface OverlapFilm {
  film_slug: string;
  title: string | null;
  year: number | null;
  member_count: number;
}

interface SyncDeps {
  fetcher?: Fetcher;
  /** Inject for tests; defaults to the real TMDB search. */
  enrich?: (scraped: ScrapedFilm) => Promise<TmdbMovieRecord | null>;
  /** Injectable clock for staleness checks. */
  now?: () => number;
}

async function defaultEnrich(
  scraped: ScrapedFilm,
  fetcher: Fetcher,
): Promise<TmdbMovieRecord | null> {
  const apiKey = getConfig().tmdbApiKey;
  if (!apiKey || !scraped.title) return null;
  try {
    return await searchTmdbMovie(scraped.title, scraped.year, apiKey, fetcher);
  } catch (e) {
    logger.warn("tmdb enrich failed (letterboxd match)", { slug: scraped.slug, error: e });
    return null;
  }
}

/**
 * Run the match sync for one list. Steps:
 *   1. Members with a connected username; refresh caches stale past
 *      `WATCHLIST_STALE_MS` (failures degrade to the stale cache).
 *   2. Overlap = slugs on ≥ MATCH_THRESHOLD members' caches.
 *   3. Insert overlap films not already on the list (by slug or tmdbId,
 *      archived rows included so an archived film stays archived).
 */
export async function syncLetterboxdMatchSource(args: {
  listId: string;
  userId: string;
  config: Record<string, unknown>;
  db: DbClient;
  deps?: SyncDeps;
}): Promise<{ addedCount: number; refreshedAt: Date }> {
  const deps = args.deps ?? {};
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? Date.now;
  const refreshedAt = new Date();

  const members = await executeRows<ConnectedMember>(
    args.db,
    sql`
      SELECT u.id AS user_id, u.letterboxd_username, u.letterboxd_synced_at
      FROM list_members m
      JOIN users u ON u.id = m.user_id
      WHERE m.list_id = ${args.listId} AND u.letterboxd_username IS NOT NULL
    `,
  );

  // Refresh stale caches sequentially — page fetches inside each user sync
  // are already concurrent, and a failed member scrape must not sink the
  // whole sync (their previous cache still participates in the overlap).
  for (const member of members) {
    const syncedAtMs = member.letterboxd_synced_at
      ? new Date(member.letterboxd_synced_at).getTime()
      : 0;
    if (now() - syncedAtMs < WATCHLIST_STALE_MS) continue;
    try {
      await syncUserWatchlist({
        userId: member.user_id,
        username: member.letterboxd_username,
        db: args.db,
        deps: { fetcher },
      });
    } catch (error) {
      logger.warn("letterboxd watchlist refresh failed during match sync", {
        userId: member.user_id,
        username: member.letterboxd_username,
        error,
      });
    }
  }

  if (members.length < MATCH_THRESHOLD) {
    // Not enough connected members for any overlap — done, but still a
    // successful sync (the status endpoint tells the client why it's empty).
    return { addedCount: 0, refreshedAt };
  }

  const overlap = await executeRows<OverlapFilm>(
    args.db,
    sql`
      SELECT
        w.film_slug,
        MAX(w.title) AS title,
        MAX(w.year)::int AS year,
        COUNT(DISTINCT w.user_id)::int AS member_count
      FROM letterboxd_watchlist_films w
      JOIN list_members m ON m.user_id = w.user_id AND m.list_id = ${args.listId}
      GROUP BY w.film_slug
      HAVING COUNT(DISTINCT w.user_id) >= ${MATCH_THRESHOLD}
    `,
  );

  if (overlap.length === 0) return { addedCount: 0, refreshedAt };

  // Existing films on the list, archived included — a film the group archived
  // must not resurface on the next sync (same discipline as the album shelf).
  const existing = await executeRows<{ slug: string | null; tmdb_id: string | null }>(
    args.db,
    sql`
      SELECT content->>'letterboxdSlug' AS slug, content->>'tmdbId' AS tmdb_id
      FROM items
      WHERE list_id = ${args.listId} AND kind = 'movie'
    `,
  );
  const existingSlugs = new Set(existing.map((r) => r.slug).filter(Boolean));
  const existingTmdbIds = new Set(existing.map((r) => r.tmdb_id).filter(Boolean));

  let addedCount = 0;
  for (const film of overlap) {
    if (existingSlugs.has(film.film_slug)) continue;

    const scraped: ScrapedFilm = {
      slug: film.film_slug,
      title: film.title,
      year: film.year,
      letterboxdUrl: `https://letterboxd.com/film/${film.film_slug}/`,
    };
    const enriched = deps.enrich
      ? await deps.enrich(scraped)
      : await defaultEnrich(scraped, fetcher);
    if (enriched?.tmdbId && existingTmdbIds.has(enriched.tmdbId)) continue;

    const content: Record<string, unknown> = {
      source: enriched ? "tmdb" : "letterboxd",
      letterboxdUrl: scraped.letterboxdUrl,
      letterboxdSlug: scraped.slug,
    };
    if (enriched) {
      content.sourceId = enriched.tmdbId;
      content.tmdbId = enriched.tmdbId;
      if (enriched.posterUrl) content.posterUrl = enriched.posterUrl;
      content.year = enriched.year ?? scraped.year ?? undefined;
      if (content.year === undefined) delete content.year;
      if (enriched.runtimeMinutes !== null) content.runtimeMinutes = enriched.runtimeMinutes;
      if (enriched.overview) content.overview = enriched.overview;
    } else if (scraped.year !== null) {
      content.year = scraped.year;
    }

    const title = enriched?.title ?? scraped.title ?? scraped.slug;
    const rows = await executeRows(
      args.db,
      sql`
        INSERT INTO items (list_id, kind, title, url, content, added_by, position)
        VALUES (
          ${args.listId},
          'movie',
          ${title},
          ${scraped.letterboxdUrl},
          ${JSON.stringify(content)}::jsonb,
          ${args.userId},
          NULL
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `,
    );
    addedCount += rows.length;
    if (enriched?.tmdbId) existingTmdbIds.add(enriched.tmdbId);
    existingSlugs.add(film.film_slug);
  }

  return { addedCount, refreshedAt };
}
