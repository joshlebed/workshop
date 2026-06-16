import type { Item } from "@workshop/shared";

/**
 * The unified list-detail screen renders three visually distinct sections.
 * Drag-to-reorder works within the ordered section and across the Ranked ↔
 * unranked boundary (promote/demote) on both platforms — web via
 * `@dnd-kit`, native via one combined `react-native-reorderable-list`. Moving
 * to/from the completed section still goes through the kebab menu (Mark
 * complete / Mark incomplete).
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
