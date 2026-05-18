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

export const SOURCE_KINDS = {
  spotify_playlist: {
    kind: "spotify_playlist",
    displayName: "Spotify Playlist",
    configSchema: spotifyPlaylistConfigSchema,
    producesItemKind: "spotify_album",
  } satisfies SourceKindManifest<SpotifyPlaylistConfig>,
} as const;

export type SourceKind = keyof typeof SOURCE_KINDS;

export const SOURCE_KIND_NAMES = ["spotify_playlist"] as const;

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
