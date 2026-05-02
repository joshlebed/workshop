import type { Item } from "@workshop/shared";

/**
 * Flat-list entries the album-shelf renders. Two visually-distinct sections
 * (ordered + detected) are encoded as one array so a single drag-to-reorder
 * library can drive both. Headers + ordered-hint are non-draggable rows the
 * library may animate around but never reports as the drag source.
 */
export type ShelfEntry =
  | { kind: "ordered-header"; count: number }
  | { kind: "detected-header"; count: number }
  | { kind: "ordered-hint" }
  | { kind: "ordered-row"; item: Item; orderedIndex: number }
  | { kind: "detected-row"; item: Item };

export function entryId(e: ShelfEntry): string {
  switch (e.kind) {
    case "ordered-header":
      return "section:ordered";
    case "detected-header":
      return "section:detected";
    case "ordered-hint":
      return "hint:ordered";
    case "ordered-row":
      return `row:ordered:${e.item.id}`;
    case "detected-row":
      return `row:detected:${e.item.id}`;
  }
}

export function isRowEntry(
  e: ShelfEntry,
): e is Extract<ShelfEntry, { kind: "ordered-row" | "detected-row" }> {
  return e.kind === "ordered-row" || e.kind === "detected-row";
}
