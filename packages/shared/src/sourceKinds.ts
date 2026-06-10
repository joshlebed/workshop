// Source kind registry. A `list_sources` row carries a `kind`, a `config`
// jsonb whose shape is determined by the kind, and per-source sync state.
// Same factoring as item kinds: small typed registry that grows by appending
// entries, no schema migration per kind.

import { z } from "zod";
import type { ItemKind } from "./itemKinds.js";

export interface SourceKindManifest<C> {
  kind: string;
  displayName: string;
  configSchema: z.ZodType<C>;
  producesItemKind: ItemKind;
}

export const spotifyPlaylistConfigSchema = z
  .object({
    spotifyPlaylistUrl: z.string().min(1).max(2048),
    spotifyPlaylistId: z.string().min(1).max(64),
  })
  .strict();

export type SpotifyPlaylistConfig = z.infer<typeof spotifyPlaylistConfigSchema>;

export const letterboxdListConfigSchema = z
  .object({
    letterboxdUrl: z.string().min(1).max(2048),
    letterboxdUsername: z.string().min(1).max(64),
    letterboxdListSlug: z.string().min(1).max(128),
  })
  .strict();

export type LetterboxdListConfig = z.infer<typeof letterboxdListConfigSchema>;

/**
 * The Letterboxd match source has no per-source config — the data it syncs
 * is derived from the list's members (each member's account-level Letterboxd
 * username + their cached watchlist). An empty strict object keeps the
 * config column honest.
 */
export const letterboxdMatchConfigSchema = z.object({}).strict();

export type LetterboxdMatchConfig = z.infer<typeof letterboxdMatchConfigSchema>;

export const SOURCE_KINDS = {
  spotify_playlist: {
    kind: "spotify_playlist",
    displayName: "Spotify Playlist",
    configSchema: spotifyPlaylistConfigSchema,
    producesItemKind: "spotify_album",
  } satisfies SourceKindManifest<SpotifyPlaylistConfig>,
  letterboxd_list: {
    kind: "letterboxd_list",
    displayName: "Letterboxd List",
    configSchema: letterboxdListConfigSchema,
    // Letterboxd lists are scraped, then each film is enriched via TMDB —
    // the produced items are plain `movie`s, not a Letterboxd-specific kind.
    // Spec §3.3: "source kind tells us where the data came from; the item
    // kind tells us what shape the content has."
    producesItemKind: "movie",
  } satisfies SourceKindManifest<LetterboxdListConfig>,
  letterboxd_match: {
    kind: "letterboxd_match",
    displayName: "Letterboxd Match",
    configSchema: letterboxdMatchConfigSchema,
    // Films on ≥2 members' Letterboxd watchlists, enriched via TMDB into
    // plain `movie` items (same shape as letterboxd_list output).
    producesItemKind: "movie",
  } satisfies SourceKindManifest<LetterboxdMatchConfig>,
} as const;

export type SourceKind = keyof typeof SOURCE_KINDS;

export const SOURCE_KIND_NAMES = [
  "spotify_playlist",
  "letterboxd_list",
  "letterboxd_match",
] as const;

export function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === "string" && (SOURCE_KIND_NAMES as readonly string[]).includes(value);
}

export class UnknownSourceKindError extends Error {
  readonly kind: string;
  constructor(kind: string) {
    super(`unknown source kind: ${kind}`);
    this.name = "UnknownSourceKindError";
    this.kind = kind;
  }
}

export function getSourceManifest<T extends SourceKind>(kind: T): (typeof SOURCE_KINDS)[T] {
  return SOURCE_KINDS[kind];
}

export function validateSourceConfig<T extends SourceKind>(
  kind: T,
  config: unknown,
): z.infer<(typeof SOURCE_KINDS)[T]["configSchema"]>;
export function validateSourceConfig(kind: string, config: unknown): unknown;
export function validateSourceConfig(kind: string, config: unknown): unknown {
  if (!isSourceKind(kind)) throw new UnknownSourceKindError(kind);
  const manifest = SOURCE_KINDS[kind];
  return manifest.configSchema.parse(config);
}
