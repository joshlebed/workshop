// Common props shared by ItemList (native) and ItemList.web. Keeping this in
// a separate file so the .web.tsx variant can import it without picking up
// the native list's runtime dependency on `react-native-reorderable-list`.

import type { DraggableRowEntry, ListEntry, RowEntry } from "./types";

export interface ReorderEvent {
  /** Index of the dragged row in the pre-drag entries list. */
  from: number;
  /**
   * Where the dragged row was released, in post-removal-splice
   * coordinates: applying it is `splice(to, 0, splice(from, 1))`. Both
   * libraries we drive use this convention.
   */
  to: number;
}

export interface ItemListProps {
  entries: ListEntry[];
  /** Item ids that arrived in the most recent refresh — render the NEW pill. */
  newItemIds: Set<string>;
  /** Map from userId → display name for provenance lines. */
  memberNameById: Map<string, string>;
  /** Drag finished — translate {from, to} into a backend mutation. */
  onReorder: (event: ReorderEvent) => void;
  /** Open the context menu for a row (kebab button). */
  onRowMenu: (entry: RowEntry) => void;
  /** Body click on a row — type-specific handler (Spotify or item detail page). */
  onRowPressBody: (entry: RowEntry) => void;
}

export type { DraggableRowEntry, RowEntry };
