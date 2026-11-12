import type { ItemKind } from "@workshop/shared";
import { listKind } from "@workshop/shared/listKinds";

/**
 * The one placeholder glyph per item kind, shared by the list row's cover tile
 * and item detail's hero so the same item never wears two icons (2.12). The
 * glyphs live in the list-kind registry.
 */
export function itemPlaceholderGlyph(kind: ItemKind | null | undefined): string {
  return listKind(kind).glyph;
}
