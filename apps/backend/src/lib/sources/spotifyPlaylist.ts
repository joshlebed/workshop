// Spotify playlist source implementation. Generalized from the legacy
// `lib/album-shelf.ts` so the same sync pattern works for any source kind
// in the registry.

import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { err } from "../response.js";
import {
  type AlbumExtract,
  fetchPlaylistAlbumExtracts,
  fetchPlaylistMeta,
} from "../spotify/app-client.js";
import { mapSpotifyError } from "../spotify/error-mapping.js";
import { InvalidPlaylistUrlError, parsePlaylistId } from "../spotify/playlist-parser.js";
import { type DbClient, executeRows } from "../sql.js";

export interface SpotifyPlaylistConfig {
  spotifyPlaylistUrl: string;
  spotifyPlaylistId: string;
}

export interface SpotifyPlaylistPreview {
  kind: "spotify_playlist";
  playlistId: string;
  name: string;
  ownerName: string | null;
  trackCount: number;
}

/**
 * Validate a Spotify playlist URL and return the normalized config + preview
 * shape. Returns the v1 error envelope on failure.
 */
export async function previewSpotifyPlaylist(
  c: Context,
  url: string,
): Promise<
  | { ok: true; config: SpotifyPlaylistConfig; preview: SpotifyPlaylistPreview }
  | { ok: false; response: Response }
> {
  let playlistId: string;
  try {
    playlistId = parsePlaylistId(url);
  } catch (e) {
    if (e instanceof InvalidPlaylistUrlError) {
      return {
        ok: false,
        response: err(c, "VALIDATION", "invalid playlist URL", { code: "INVALID_PLAYLIST_URL" }),
      };
    }
    throw e;
  }
  let meta: Awaited<ReturnType<typeof fetchPlaylistMeta>>;
  try {
    meta = await fetchPlaylistMeta(playlistId);
    if (meta.public === false) {
      return {
        ok: false,
        response: err(c, "VALIDATION", "playlist must be public", {
          code: "PLAYLIST_NOT_AVAILABLE",
        }),
      };
    }
  } catch (e) {
    const mapped = mapSpotifyError(c, e);
    if (mapped) return { ok: false, response: mapped };
    throw e;
  }
  return {
    ok: true,
    config: { spotifyPlaylistUrl: url, spotifyPlaylistId: playlistId },
    preview: {
      kind: "spotify_playlist",
      playlistId,
      name: meta.name,
      ownerName: meta.owner?.display_name ?? null,
      trackCount: meta.tracks.total,
    },
  };
}

/**
 * Sync a Spotify-playlist source — pull the playlist's albums and insert
 * any new (list_id, spotifyAlbumId) rows as `kind=spotify_album` items.
 * Returns the count of newly-inserted rows so the caller can render a
 * "X new" toast.
 *
 * Caller responsibilities:
 *   - update the source's `last_synced_at` / `last_synced_by`,
 *   - record the `source_synced` activity event,
 *   - assert the requester has the right capability.
 */
export async function syncSpotifyPlaylistSource(args: {
  listId: string;
  userId: string;
  config: SpotifyPlaylistConfig;
  db: DbClient;
}): Promise<{ addedCount: number; refreshedAt: Date }> {
  const extracts = await fetchPlaylistAlbumExtracts(args.config.spotifyPlaylistId);
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
  return { addedCount, refreshedAt };
}

async function insertExtractIfMissing(args: {
  listId: string;
  userId: string;
  extract: AlbumExtract;
  detectedAt: Date;
  db: DbClient;
}): Promise<number> {
  const content: Record<string, unknown> = {
    source: "spotify",
    spotifyAlbumId: args.extract.spotifyAlbumId,
    spotifyAlbumUrl: args.extract.spotifyAlbumUrl,
    title: args.extract.title,
    artist: args.extract.artist,
    trackCount: args.extract.trackCount,
    detectedAt: args.detectedAt.toISOString(),
  };
  if (args.extract.year !== undefined) content.year = args.extract.year;
  if (args.extract.coverUrl !== undefined) content.coverUrl = args.extract.coverUrl;

  // Partial unique index `items_list_spotify_album_content_idx` enforces
  // dedup on (list_id, content->>'spotifyAlbumId') WHERE kind = 'spotify_album'.
  const rows = await executeRows(
    args.db,
    sql`
      INSERT INTO items (list_id, kind, title, url, content, added_by, position)
      VALUES (
        ${args.listId},
        'spotify_album',
        ${args.extract.title},
        ${args.extract.spotifyAlbumUrl},
        ${JSON.stringify(content)}::jsonb,
        ${args.userId},
        NULL
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `,
  );
  return rows.length;
}

export function isSpotifyPlaylistConfig(config: unknown): config is SpotifyPlaylistConfig {
  if (typeof config !== "object" || config === null) return false;
  const c = config as Record<string, unknown>;
  return typeof c.spotifyPlaylistUrl === "string" && typeof c.spotifyPlaylistId === "string";
}
