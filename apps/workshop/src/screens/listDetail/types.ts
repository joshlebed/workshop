import type { Item } from "@workshop/shared";

/**
 * Flat-list entries the unified list-detail screen renders. Three visually-
 * distinct sections (ordered + unordered + completed) are encoded as one
 * array so a single drag-to-reorder library can drive all sections.
 * Headers + ordered-hint are non-draggable rows the library may animate
 * around but never reports as the drag source. Completed rows are also
 * non-draggable — completing an item parks it; users uncomplete first to
 * re-rank.
 */
export type ListEntry =
  | { kind: "ordered-header"; count: number }
  | { kind: "unordered-header"; count: number; isAlbumShelf: boolean }
  | { kind: "completed-header"; count: number }
  | { kind: "ordered-hint" }
  | { kind: "ordered-row"; item: Item; orderedIndex: number }
  | { kind: "unordered-row"; item: Item }
  | { kind: "completed-row"; item: Item };

export function entryId(e: ListEntry): string {
  switch (e.kind) {
    case "ordered-header":
      return "section:ordered";
    case "unordered-header":
      return "section:unordered";
    case "completed-header":
      return "section:completed";
    case "ordered-hint":
      return "hint:ordered";
    case "ordered-row":
      return `row:ordered:${e.item.id}`;
    case "unordered-row":
      return `row:unordered:${e.item.id}`;
    case "completed-row":
      return `row:completed:${e.item.id}`;
  }
}

export type DraggableRowEntry = Extract<ListEntry, { kind: "ordered-row" | "unordered-row" }>;

export type RowEntry = Extract<
  ListEntry,
  { kind: "ordered-row" | "unordered-row" | "completed-row" }
>;

export function isDraggableRow(e: ListEntry): e is DraggableRowEntry {
  return e.kind === "ordered-row" || e.kind === "unordered-row";
}

export function isRowEntry(e: ListEntry): e is RowEntry {
  return e.kind === "ordered-row" || e.kind === "unordered-row" || e.kind === "completed-row";
}
