// Item kind registry. Every item carries a `kind` (movie, tv, book, link,
// spotify_album, plain) and a `content` jsonb whose shape is determined by
// that kind. Zod schemas are the single source of truth — strict-on-write
// rejects unknown keys so stale clients can't smuggle typos into jsonb.
//
// Backend imports `validateContent` + `assertItemFitsList`; client code
// imports types only (`import type { ItemKind, ContentFor } from
// "@workshop/shared/itemKinds"`). TypeScript strips type-only imports at
// compile time, so the client bundle does not load zod via this module.

import { z } from "zod";

const optionalString = (max: number) => z.string().max(max).optional();
const optionalInt = (min: number, max: number) => z.number().int().min(min).max(max).optional();

const movieContent = z
  .object({
    source: z.enum(["tmdb", "manual", "letterboxd"]).optional(),
    sourceId: optionalString(64),
    /**
     * Canonical TMDB id (string form). Used as the per-list dedup field
     * so the same film added by manual TMDB search + Letterboxd sync
     * collapses to one row. See `ITEM_KIND_DEDUP_FIELD`.
     */
    tmdbId: optionalString(32),
    /** Original Letterboxd film URL — kept on the row for provenance. */
    letterboxdUrl: optionalString(2048),
    /**
     * Canonical Letterboxd film slug (`letterboxd.com/film/<slug>/`). Set by
     * the Letterboxd match sync + suggestion flows so read paths can join an
     * item against members' cached watchlists without re-deriving the slug
     * from `letterboxdUrl`.
     */
    letterboxdSlug: optionalString(256),
    posterUrl: optionalString(2048),
    year: optionalInt(1800, 2200),
    runtimeMinutes: optionalInt(0, 10_000),
    overview: optionalString(4000),
  })
  .strict();

const tvContent = movieContent;

const bookContent = z
  .object({
    source: z.enum(["google_books", "manual"]).optional(),
    sourceId: optionalString(64),
    coverUrl: optionalString(2048),
    authors: z.array(z.string().max(200)).max(20).optional(),
    year: optionalInt(0, 2200),
    pageCount: optionalInt(0, 100_000),
    description: optionalString(4000),
  })
  .strict();

const linkContent = z
  .object({
    source: z.enum(["link_preview", "manual"]).optional(),
    // Natural sourceId for a link item is its final URL (post-redirect).
    // Google Maps shortlinks (`https://maps.app.goo.gl/...`) expand to long
    // `https://www.google.com/maps/place/...` URLs; cap matches the `url`
    // and `image*` fields so the preview-driven add flow doesn't 400.
    sourceId: optionalString(2048),
    image: optionalString(2048),
    /**
     * CDN-proxied + resized variant of `image` (wsrv.nl wrapper). The
     * extractor stores both: `image` is the canonical upstream URL so we
     * can re-proxy or re-fetch later; `imageProxy` is what the client
     * actually renders so we never break when upstream hotlink-blocks.
     */
    imageProxy: optionalString(2048),
    siteName: optionalString(200),
    title: optionalString(500),
    description: optionalString(2000),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    // Carried over from the legacy `game` metadata shape so daily-game items
    // keep their thumbnails after migration. Equivalent to `image` for new
    // writes; keep both for back-compat with seeded data.
    thumbnailUrl: optionalString(2048),
  })
  .strict();

const spotifyAlbumContent = z
  .object({
    source: z.literal("spotify"),
    spotifyAlbumId: z.string().min(1).max(64),
    spotifyAlbumUrl: z.string().max(2048),
    title: z.string().max(500),
    artist: z.string().max(500),
    year: optionalInt(0, 2200),
    coverUrl: optionalString(2048),
    trackCount: z.number().int().min(0).max(10_000),
    detectedAt: z.string().max(64),
  })
  .strict();

const plainContent = z.object({}).strict();

export const ITEM_KINDS = {
  movie: movieContent,
  tv: tvContent,
  book: bookContent,
  link: linkContent,
  spotify_album: spotifyAlbumContent,
  plain: plainContent,
} as const;

export const ITEM_KIND_NAMES = ["movie", "tv", "book", "link", "spotify_album", "plain"] as const;

export type ItemKind = (typeof ITEM_KIND_NAMES)[number];

/**
 * Per-kind dedup field (§9.3). When set, the `(list_id, content->>'<field>')`
 * partial unique index gives "same source row syncs at most once per list"
 * semantics. Sources can then INSERT ... ON CONFLICT DO NOTHING and let the
 * DB enforce uniqueness instead of pre-checking. The migration ships the
 * per-kind index only when the manifest declares a dedupField; adding one
 * later is a code-only change followed by a one-shot index creation.
 *
 * The Letterboxd source uses `tmdbId` after enriching scraped films via
 * TMDB — that's why the dedupField lives on the *item* kind, not the
 * *source* kind: multiple sources (Letterboxd, future TMDB watchlist,
 * future Trakt) all produce `movie` items and should share a dedup key.
 */
export const ITEM_KIND_DEDUP_FIELD: Partial<Record<ItemKind, string>> = {
  spotify_album: "spotifyAlbumId",
  movie: "tmdbId",
};

export function getDedupField(kind: ItemKind): string | null {
  return ITEM_KIND_DEDUP_FIELD[kind] ?? null;
}

export type ContentFor<T extends ItemKind> = z.infer<(typeof ITEM_KINDS)[T]>;

export type ItemContent = Record<string, unknown>;

export function isItemKind(value: unknown): value is ItemKind {
  return typeof value === "string" && (ITEM_KIND_NAMES as readonly string[]).includes(value);
}

export class UnknownItemKindError extends Error {
  readonly kind: string;
  constructor(kind: string) {
    super(`unknown item kind: ${kind}`);
    this.name = "UnknownItemKindError";
    this.kind = kind;
  }
}

export class ItemKindMismatchError extends Error {
  readonly listItemKind: string;
  readonly itemKind: string;
  constructor(listItemKind: string, itemKind: string) {
    super(`item kind ${itemKind} does not match list item kind ${listItemKind}`);
    this.name = "ItemKindMismatchError";
    this.listItemKind = listItemKind;
    this.itemKind = itemKind;
  }
}

export function validateContent<T extends ItemKind>(kind: T, content: unknown): ContentFor<T>;
export function validateContent(kind: string, content: unknown): ItemContent;
export function validateContent(kind: string, content: unknown): ItemContent {
  if (!isItemKind(kind)) throw new UnknownItemKindError(kind);
  const schema = ITEM_KINDS[kind];
  return schema.parse(content ?? {}) as ItemContent;
}

export function assertItemFitsList(
  list: { itemKind: ItemKind | string | null },
  item: { kind: ItemKind | string },
): void {
  if (list.itemKind === null || list.itemKind === undefined) return;
  if (list.itemKind === item.kind) return;
  throw new ItemKindMismatchError(String(list.itemKind), String(item.kind));
}
