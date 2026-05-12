// Shared props between the native (`ItemList.tsx`, react-native-reorderable-list)
// and web (`ItemList.web.tsx`, @dnd-kit/sortable) implementations of the
// list-detail row container. Lives in its own file so the .web variant can
// import it without dragging in the native list's runtime dependency.

import type { Item } from "@workshop/shared";
import type { Section } from "./types";

export interface ReorderEvent {
  /** Index of the dragged row in the ordered array, before the move. */
  fromIndex: number;
  /**
   * Index where the row was released, in post-removal-splice coords:
   * applying the move is `splice(toIndex, 0, splice(fromIndex, 1)[0])`.
   * Both libraries report drag end with this convention.
   */
  toIndex: number;
}

export interface ItemListProps {
  ordered: Item[];
  unordered: Item[];
  completed: Item[];
  /** Renames "UNORDERED" → "DETECTED" and tweaks the hint copy. */
  isAlbumShelf: boolean;
  /**
   * Render the "use the menu to start ranking" hint between the (empty)
   * ordered band and the rest of the list. Owned by the parent because
   * filtering can also suppress it.
   */
  showOrderedHint: boolean;
  /** Item ids that arrived in the most recent refresh — render the NEW pill. */
  newItemIds: Set<string>;
  /** Map from userId → display name for provenance lines. */
  memberNameById: Map<string, string>;
  /** True when more than one collaborator can add — gates the "added by @x" provenance. */
  showProvenance: boolean;
  /** List accent hex used to tint cover placeholders + the position chip. */
  accent: string;
  /** Drag inside the ordered section finished. Cross-section drags don't exist. */
  onReorderOrdered: (event: ReorderEvent) => void;
  /** Open the context menu for a row (kebab button). */
  onRowMenu: (item: Item, section: Section) => void;
  /** Body click on a row — type-specific handler (Spotify or item detail page). */
  onRowPressBody: (item: Item, section: Section) => void;
}
