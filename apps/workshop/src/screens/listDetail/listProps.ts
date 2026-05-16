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
  /**
   * Current viewer's userId. Used to suppress provenance lines when the row's
   * `addedBy` matches the viewer — a shared list with "Added by you · 1m" on
   * every row reads as noise. Null when not signed in (no rows render anyway).
   */
  selfId: string | null;
  /** List accent hex used to tint cover placeholders + the position chip. */
  accent: string;
  /** Drag inside the ordered section finished. */
  onReorderOrdered: (event: ReorderEvent) => void;
  /**
   * Drag from the unordered section finished on an ordered drop target.
   * `toIndex` is the position in the ordered array where the item should
   * be inserted (0 = top, ordered.length = bottom). Web only — native uses
   * the kebab menu for cross-section moves.
   */
  onPromoteToOrdered: (event: { item: Item; toIndex: number }) => void;
  /** Open the context menu for a row (kebab button). */
  onRowMenu: (item: Item, section: Section) => void;
  /** Body click on a row — type-specific handler (Spotify or item detail page). */
  onRowPressBody: (item: Item, section: Section) => void;
  /**
   * Per-row cover-press resolver. Return a handler when the row's
   * thumbnail should be its own tap target (launches the item's external
   * URL / Spotify album / game URL); return `null` for items where the
   * thumbnail should fold back into the body's tap target (no URL set,
   * or list type that doesn't expose an external launch).
   */
  resolveRowPressCover?: (item: Item, section: Section) => (() => void) | null;
  /** Whether a refresh is in flight — drives the pull-to-refresh spinner. */
  refreshing: boolean;
  /** Pull-to-refresh trigger (typically `itemsQuery.refetch()`). */
  onRefresh: () => void;
}
