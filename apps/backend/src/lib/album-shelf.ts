// Album Shelf core: refresh logic + split ordered/detected reads. Used by
// both `POST /v1/lists` (initial refresh on creation), `POST /v1/lists/:id/refresh`,
// and `PATCH /v1/lists/:id` (re-refresh on source URL change). See
// docs/album-shelf.md §7.3.

import type {
  AlbumShelfItemMetadata,
  AlbumShelfListMetadata,
  Item,
  ItemMetadata,
} from "@workshop/shared";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { type AlbumExtract, fetchPlaylistAlbumExtracts } from "./spotify/app-client.js";

class AlbumShelfStateError extends Error {
  constructor(message = "list is not an album_shelf") {
    super(message);
    this.name = "AlbumShelfStateError";
  }
}

interface DbExec {
  execute: (q: ReturnType<typeof sql>) => Promise<unknown>;
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
  db: DbExec;
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
  db: DbExec;
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
  const inserted = (await args.db.execute(sql`
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
  `)) as Array<unknown> | { rows: Array<unknown> };
  const rows = Array.isArray(inserted) ? inserted : inserted.rows;
  return rows.length;
}

interface SplitItemsRow {
  id: string;
  list_id: string;
  type: string;
  title: string;
  url: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  added_by: string;
  completed: boolean;
  completed_at: Date | string | null;
  completed_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * Reads every item on an album_shelf and splits into ordered/detected per
 * spec §3.3. Single SQL query — section assignment + sort happen in one
 * pass.
 *
 * Ordered: `metadata.position` non-null, sorted by position ASC.
 * Detected: `metadata.position` null, sorted by `metadata.detectedAt` ASC.
 */
export async function fetchAlbumShelfItems(
  listId: string,
): Promise<{ ordered: Item[]; detected: Item[] }> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT
      i.id,
      i.list_id,
      i.type::text AS type,
      i.title,
      i.url,
      i.note,
      i.metadata,
      i.added_by,
      i.completed,
      i.completed_at,
      i.completed_by,
      i.created_at,
      i.updated_at
    FROM items i
    WHERE i.list_id = ${listId}
    ORDER BY
      (i.metadata->>'position') IS NULL,
      (i.metadata->>'position')::numeric ASC NULLS LAST,
      (i.metadata->>'detectedAt') ASC
  `)) as unknown as Array<SplitItemsRow> | { rows: Array<SplitItemsRow> };

  const list = Array.isArray(rows) ? rows : rows.rows;
  const ordered: Item[] = [];
  const detected: Item[] = [];
  for (const r of list) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const position = meta.position;
    const item = rowToItem(r);
    if (typeof position === "number") {
      ordered.push(item);
    } else {
      detected.push(item);
    }
  }
  return { ordered, detected };
}

function rowToItem(r: SplitItemsRow): Item {
  const createdAt = r.created_at instanceof Date ? r.created_at : new Date(String(r.created_at));
  const updatedAt = r.updated_at instanceof Date ? r.updated_at : new Date(String(r.updated_at));
  const completedAt =
    r.completed_at == null
      ? null
      : r.completed_at instanceof Date
        ? r.completed_at
        : new Date(String(r.completed_at));
  return {
    id: r.id,
    listId: r.list_id,
    type: r.type as Item["type"],
    title: r.title,
    url: r.url,
    note: r.note,
    metadata: (r.metadata ?? {}) as ItemMetadata,
    addedBy: r.added_by,
    completed: r.completed,
    completedAt: completedAt ? completedAt.toISOString() : null,
    completedBy: r.completed_by,
    upvoteCount: 0,
    hasUpvoted: false,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
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
