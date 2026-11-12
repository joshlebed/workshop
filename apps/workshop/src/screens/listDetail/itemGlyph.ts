import type { ItemKind } from "@workshop/shared";

/**
 * The one placeholder glyph per item kind, shared by the list row's cover tile
 * and item detail's hero so the same item never wears two icons (2.12).
 */
export function itemPlaceholderGlyph(kind: ItemKind | null | undefined): string {
  switch (kind) {
    case "spotify_album":
      return "📀";
    case "movie":
      return "🎬";
    case "tv":
      return "📺";
    case "book":
      return "📚";
    case "link":
      return "🔗";
    default:
      return "📝";
  }
}
