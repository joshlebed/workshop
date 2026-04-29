// Zod validators for album_shelf list-level + item-level metadata.
// Per-list-type item validation is wired into `routes/v1/items.ts` via
// `validateMetadataForType`. List-level metadata validation runs at the
// list create/update boundary in `routes/v1/lists.ts`.

import { z } from "zod";

// --- Item metadata ---

export const albumShelfItemMetadataSchema = z
  .object({
    source: z.literal("spotify"),
    spotifyAlbumId: z.string().min(1).max(64),
    spotifyAlbumUrl: z.string().min(1).max(2048),
    title: z.string().min(1).max(500),
    artist: z.string().min(1).max(500),
    year: z.number().int().min(1800).max(2200).optional(),
    coverUrl: z.string().max(2048).optional(),
    trackCount: z.number().int().min(0).max(10000),
    position: z.union([z.number(), z.null()]),
    detectedAt: z.string().min(1),
  })
  .strict();

/**
 * Patch validator for album_shelf items. Only `position` is mutable client-
 * side: every other field is derived from Spotify and immutable. Returns the
 * sanitized patch (with `position` only) on success.
 */
export const albumShelfItemPatchSchema = z
  .object({
    position: z.union([z.number(), z.null()]).optional(),
  })
  .strict();

// --- List metadata ---

export const albumShelfListMetadataPatchSchema = z
  .object({
    spotifyPlaylistUrl: z.string().min(1).max(2048).optional(),
  })
  .strict();
