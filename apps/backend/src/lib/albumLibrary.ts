// Album lab (admin-only experiment): a user's saved Spotify albums and the
// genre / vibe tags the lab clusters by. Rows arrive through
// `importAlbumLibrary` (scripts/import-album-library.ts); there is no in-app
// Spotify connection yet.

import type { AlbumLibraryAlbum } from "@workshop/shared";
import { resolveListModules } from "@workshop/shared/listKinds";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { items, listMembers, lists, spotifyAlbums, spotifyLibraryAlbums } from "../db/schema.js";
import { recordEvent } from "./events.js";
import { isUniqueViolation } from "./pgErrors.js";
import { topPositions } from "./positions.js";
import { requestOriginColumns } from "./requestContext.js";
import { generateShareSlug } from "./shareSlug.js";

const score = z.number().int().min(0).max(100).nullable();

export const albumLibraryImportSchema = z.array(
  z.object({
    id: z.string().min(1).max(64),
    name: z.string().max(2000),
    artists: z.array(z.string().max(500)).min(1).max(50),
    year: z.number().int().min(0).max(2200),
    savedAt: z.string().datetime(),
    albumType: z.string().max(32),
    trackCount: z.number().int().min(0).max(10_000),
    label: z.string().max(500).nullable(),
    popularity: score,
    imageUrl: z.string().max(2048).nullable(),
    imageSmallUrl: z.string().max(2048).nullable(),
    spotifyUrl: z.string().max(2048),
    genre: z.string().max(64).nullable(),
    subgenre: z.string().max(64).nullable(),
    vibes: z.array(z.string().max(32)).max(8),
    energy: score,
    mood: score,
    tags: z.array(z.string().max(64)).max(40),
    tagsKnown: z.boolean(),
  }),
);

/** The user's saved albums, most recently saved first. */
export async function readAlbumLibrary(userId: string): Promise<AlbumLibraryAlbum[]> {
  const rows = await getDb()
    .select({ album: spotifyAlbums, savedAt: spotifyLibraryAlbums.savedAt })
    .from(spotifyLibraryAlbums)
    .innerJoin(spotifyAlbums, eq(spotifyAlbums.spotifyAlbumId, spotifyLibraryAlbums.spotifyAlbumId))
    .where(eq(spotifyLibraryAlbums.userId, userId))
    .orderBy(desc(spotifyLibraryAlbums.savedAt), spotifyAlbums.spotifyAlbumId);
  return rows.map(({ album, savedAt }) => ({
    id: album.spotifyAlbumId,
    name: album.name,
    artists: album.artists,
    year: album.releaseYear,
    savedAt: savedAt.toISOString(),
    albumType: album.albumType,
    trackCount: album.trackCount,
    label: album.label,
    popularity: album.popularity,
    imageUrl: album.imageUrl,
    imageSmallUrl: album.imageSmallUrl,
    spotifyUrl: album.spotifyUrl,
    genre: album.genre,
    subgenre: album.subgenre,
    vibes: album.vibes,
    energy: album.energy,
    mood: album.mood,
    tags: album.tags,
    tagsKnown: album.tagsKnown,
  }));
}

/**
 * Replace the user's library with `albums`: upserts each album (and its
 * tags), sets the saved dates, and drops library rows no longer in the set.
 * Idempotent; other users' libraries are untouched.
 */
export async function importAlbumLibrary(
  userId: string,
  albums: AlbumLibraryAlbum[],
): Promise<{ albums: number; removed: number }> {
  const CHUNK = 200;
  return getDb().transaction(async (tx) => {
    for (let i = 0; i < albums.length; i += CHUNK) {
      const chunk = albums.slice(i, i + CHUNK);
      await tx
        .insert(spotifyAlbums)
        .values(
          chunk.map((a) => ({
            spotifyAlbumId: a.id,
            name: a.name,
            artists: a.artists,
            releaseYear: a.year,
            albumType: a.albumType,
            trackCount: a.trackCount,
            label: a.label,
            popularity: a.popularity,
            imageUrl: a.imageUrl,
            imageSmallUrl: a.imageSmallUrl,
            spotifyUrl: a.spotifyUrl,
            genre: a.genre,
            subgenre: a.subgenre,
            vibes: a.vibes,
            energy: a.energy,
            mood: a.mood,
            tags: a.tags,
            tagsKnown: a.tagsKnown,
          })),
        )
        .onConflictDoUpdate({
          target: spotifyAlbums.spotifyAlbumId,
          set: {
            name: sql`excluded.name`,
            artists: sql`excluded.artists`,
            releaseYear: sql`excluded.release_year`,
            albumType: sql`excluded.album_type`,
            trackCount: sql`excluded.track_count`,
            label: sql`excluded.label`,
            popularity: sql`excluded.popularity`,
            imageUrl: sql`excluded.image_url`,
            imageSmallUrl: sql`excluded.image_small_url`,
            spotifyUrl: sql`excluded.spotify_url`,
            genre: sql`excluded.genre`,
            subgenre: sql`excluded.subgenre`,
            vibes: sql`excluded.vibes`,
            energy: sql`excluded.energy`,
            mood: sql`excluded.mood`,
            tags: sql`excluded.tags`,
            tagsKnown: sql`excluded.tags_known`,
            updatedAt: sql`now()`,
          },
        });
      await tx
        .insert(spotifyLibraryAlbums)
        .values(chunk.map((a) => ({ userId, spotifyAlbumId: a.id, savedAt: new Date(a.savedAt) })))
        .onConflictDoUpdate({
          target: [spotifyLibraryAlbums.userId, spotifyLibraryAlbums.spotifyAlbumId],
          set: { savedAt: sql`excluded.saved_at` },
        });
    }
    const ids = albums.map((a) => a.id);
    const removed = await tx
      .delete(spotifyLibraryAlbums)
      .where(
        ids.length > 0
          ? and(
              eq(spotifyLibraryAlbums.userId, userId),
              notInArray(spotifyLibraryAlbums.spotifyAlbumId, ids),
            )
          : eq(spotifyLibraryAlbums.userId, userId),
      )
      .returning({ id: spotifyLibraryAlbums.spotifyAlbumId });
    return { albums: albums.length, removed: removed.length };
  });
}

export const createAlbumListSchema = z.object({
  name: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1).max(100))
    .refine((v) => !/[\r\n]/.test(v), "name must be a single line"),
  albumIds: z.array(z.string().min(1).max(64)).min(1).max(500),
});

/**
 * Make a Workshop album list from albums in the user's library, in the order
 * given (first = top). Album lists refuse manual adds, so this is the lab's
 * only way to build one by hand. Ids that are not in the user's library are
 * dropped; returns null when none are.
 */
export async function createListFromAlbumLibrary(
  userId: string,
  input: z.infer<typeof createAlbumListSchema>,
): Promise<{ listId: string; added: number } | null> {
  const wanted = [...new Set(input.albumIds)];
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select({ album: spotifyAlbums })
      .from(spotifyLibraryAlbums)
      .innerJoin(
        spotifyAlbums,
        eq(spotifyAlbums.spotifyAlbumId, spotifyLibraryAlbums.spotifyAlbumId),
      )
      .where(
        and(
          eq(spotifyLibraryAlbums.userId, userId),
          inArray(spotifyLibraryAlbums.spotifyAlbumId, wanted),
        ),
      );
    const byId = new Map(rows.map((r) => [r.album.spotifyAlbumId, r.album]));
    const albums = wanted.flatMap((id) => byId.get(id) ?? []);
    if (albums.length === 0) return null;

    const modules = resolveListModules({
      itemKind: "spotify_album",
      requested: [],
      syncSourceCount: 0,
    }).modules;
    let listId: string | undefined;
    for (let attempt = 0; attempt < 5 && !listId; attempt++) {
      try {
        // A savepoint, so a slug collision does not abort the outer transaction.
        listId = await tx.transaction(async (sp) => {
          const [row] = await sp
            .insert(lists)
            .values({
              name: input.name,
              emoji: "💿",
              color: "grape",
              ownerId: userId,
              itemKind: "spotify_album",
              modules,
              shareSlug: generateShareSlug(),
            })
            .returning({ id: lists.id });
          return row?.id;
        });
      } catch (e) {
        if (!isUniqueViolation(e, "lists_share_slug_unique")) throw e;
      }
    }
    if (!listId) throw new Error("album list insert: share_slug collision retries exhausted");
    const id = listId;

    await tx.insert(listMembers).values({ listId: id, userId, role: "owner" });
    await recordEvent({
      db: tx,
      listId: id,
      actorId: userId,
      type: "list_created",
      payload: { name: input.name, itemKind: "spotify_album", modules },
    });

    const positions = await topPositions(id, albums.length, tx);
    const detectedAt = new Date().toISOString();
    await tx.insert(items).values(
      albums.map((a, i) => ({
        listId: id,
        kind: "spotify_album" as const,
        title: a.name.slice(0, 500),
        url: a.spotifyUrl,
        content: {
          source: "spotify",
          spotifyAlbumId: a.spotifyAlbumId,
          spotifyAlbumUrl: a.spotifyUrl,
          title: a.name.slice(0, 500),
          artist: a.artists.join(", ").slice(0, 500),
          year: a.releaseYear,
          ...(a.imageUrl ? { coverUrl: a.imageUrl } : {}),
          trackCount: a.trackCount,
          detectedAt,
        },
        addedBy: userId,
        position: positions[i],
        ...requestOriginColumns(),
      })),
    );
    return { listId: id, added: albums.length };
  });
}
