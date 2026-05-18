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
    source: z.enum(["tmdb", "manual"]).optional(),
    sourceId: optionalString(64),
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
    sourceId: optionalString(128),
    image: optionalString(2048),
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
