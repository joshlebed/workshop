import type { Item } from "@workshop/shared";

/**
 * The unified list-detail screen renders three visually distinct sections.
 * Drag-to-reorder is scoped to the ordered section only — cross-section
 * transitions go through the kebab menu (Promote / Demote / Mark complete /
 * Mark incomplete). Headers + the ordered hint are plain markup outside
 * any sortable container.
 */
export type Section = "ordered" | "unordered" | "completed";

/**
 * Items split by the section they belong in. The list-view consumes this
 * shape directly; no flat-array entry list is needed any more.
 */
export interface SectionedItems {
  ordered: Item[];
  unordered: Item[];
  completed: Item[];
}
