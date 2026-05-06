// Album Shelf core: refresh logic for the Spotify-driven shelf type. Used by
// `POST /v1/lists` (initial refresh on creation), `POST /v1/lists/:id/refresh`,
// and `PATCH /v1/lists/:id` (re-refresh on source URL change). The
// ordered/unordered/completed split read for every list type lives in
// `routes/v1/items.ts#fetchItemsForList`. See docs/album-shelf.md §7.3.

import type { AlbumShelfItemMetadata, AlbumShelfListMetadata } from "@workshop/shared";
import { sql } from "drizzle-orm";
import { type AlbumExtract, fetchPlaylistAlbumExtracts } from "./spotify/app-client.js";
import { executeRows, type SqlExecutor } from "./sql.js";

class AlbumShelfStateError extends Error {
  constructor(message = "list is not an album_shelf") {
    super(message);
    this.name = "AlbumShelfStateError";
  }
}

interface RefreshResult {
  addedCount: number;
  refreshedAt: Date;
  source: string;
}

/**
 * Pulls the current playlist from Spotify and inserts any new (list_id,
 * spotifyAlbumId) pairs as detected items (`metadata.position = null`). The
 * partial unique index `items_list_spotify_album_idx` makes this idempotent
 * under concurrent calls. Returns the count of newly-inserted rows so the
 * caller can render a "X new" toast.
 *
 * Caller responsibilities:
 *   - run inside the same transaction as `lists.metadata` update + activity event,
 *   - validate that the list is an album_shelf before calling.
 */
export async function refreshAlbumShelfItems(args: {
  listId: string;
  userId: string;
  spotifyPlaylistId: string;
  spotifyPlaylistUrl: string;
  db: SqlExecutor;
}): Promise<RefreshResult> {
  const extracts = await fetchPlaylistAlbumExtracts(args.spotifyPlaylistId);
  const refreshedAt = new Date();

  let addedCount = 0;
  for (const e of extracts) {
    addedCount += await insertExtractIfMissing({
      listId: args.listId,
      userId: args.userId,
      extract: e,
      detectedAt: refreshedAt,
      db: args.db,
    });
  }

  await args.db.execute(sql`
    UPDATE lists
    SET metadata = metadata
        || ${JSON.stringify({
          lastRefreshedAt: refreshedAt.toISOString(),
          lastRefreshedBy: args.userId,
        })}::jsonb,
      updated_at = NOW()
    WHERE id = ${args.listId}
  `);

  return { addedCount, refreshedAt, source: args.spotifyPlaylistUrl };
}

async function insertExtractIfMissing(args: {
  listId: string;
  userId: string;
  extract: AlbumExtract;
  detectedAt: Date;
  db: SqlExecutor;
}): Promise<number> {
  const meta: AlbumShelfItemMetadata = {
    source: "spotify",
    spotifyAlbumId: args.extract.spotifyAlbumId,
    spotifyAlbumUrl: args.extract.spotifyAlbumUrl,
    title: args.extract.title,
    artist: args.extract.artist,
    ...(args.extract.year !== undefined ? { year: args.extract.year } : {}),
    ...(args.extract.coverUrl !== undefined ? { coverUrl: args.extract.coverUrl } : {}),
    trackCount: args.extract.trackCount,
    position: null,
    detectedAt: args.detectedAt.toISOString(),
  };
  // Partial unique index `items_list_spotify_album_idx` enforces dedup on
  // (list_id, metadata->>'spotifyAlbumId') WHERE type = 'album_shelf'. The
  // bare `ON CONFLICT DO NOTHING` form catches any unique violation without
  // having to name a non-constraint index.
  const rows = await executeRows(
    args.db,
    sql`
      INSERT INTO items (list_id, type, title, url, metadata, added_by)
      VALUES (
        ${args.listId},
        'album_shelf'::list_type,
        ${args.extract.title},
        ${args.extract.spotifyAlbumUrl},
        ${JSON.stringify(meta)}::jsonb,
        ${args.userId}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `,
  );
  return rows.length;
}

/**
 * Type guard for `lists.metadata` blobs that should hold album-shelf state.
 * Throws AlbumShelfStateError if the shape is missing required fields.
 */
export function asAlbumShelfMetadata(meta: unknown): AlbumShelfListMetadata {
  if (typeof meta !== "object" || meta === null) {
    throw new AlbumShelfStateError("album shelf metadata missing");
  }
  const m = meta as Record<string, unknown>;
  if (typeof m.spotifyPlaylistUrl !== "string" || typeof m.spotifyPlaylistId !== "string") {
    throw new AlbumShelfStateError("album shelf playlist not configured");
  }
  return {
    spotifyPlaylistUrl: m.spotifyPlaylistUrl,
    spotifyPlaylistId: m.spotifyPlaylistId,
    lastRefreshedAt: typeof m.lastRefreshedAt === "string" ? m.lastRefreshedAt : null,
    lastRefreshedBy: typeof m.lastRefreshedBy === "string" ? m.lastRefreshedBy : null,
  };
}
