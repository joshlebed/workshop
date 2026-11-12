// Shared props between the native (`ItemList.tsx`, react-native-reorderable-list)
// and web (`ItemList.web.tsx`, @dnd-kit/sortable) implementations of the
// list-detail row container.

import type { Item, ItemKind } from "@workshop/shared";
import type { CompletionCopy, DropResult } from "./listOps";
import type { Section } from "./types";

export interface ItemListProps {
  /** Visible rows per section (already filtered). */
  ordered: Item[];
  unordered: Item[];
  completed: Item[];
  /**
   * 1-based rank of every ranked item in the whole (unfiltered) Ranked block.
   * Rows read their numeral from here so a filter never renumbers them.
   */
  rankById: Map<string, number>;
  listItemKind: ItemKind | null;
  isAlbumShelf: boolean;
  /** The Ranked block exists on this list (ranking feature on). */
  rankingOn: boolean;
  /** Completion is on: open rows get a checkbox, Done rows a filled one. */
  todoOn: boolean;
  copy: CompletionCopy;
  /** Artwork tiles on rows (media and link lists). */
  showCover: boolean;
  /** Album shelf: the detected block keeps its recency order. */
  openReorderable: boolean;
  newItemIds: Set<string>;
  /** Scroll this row into view once it renders (after a quick add). */
  scrollToItemId: string | null;
  memberNameById: Map<string, string>;
  showProvenance: boolean;
  selfId: string | null;
  /** Letterboxd-match lists: per-item overlap badge replacing "Added by …". */
  letterboxdBadgeByItem?: Map<string, string>;
  accent: string;
  /** Done section collapsed (the parent remembers it per list). */
  doneCollapsed: boolean;
  /** Whether the Done header offers Show / Hide at all. */
  doneCollapsible: boolean;
  onToggleDone: () => void;
  /** A drag finished somewhere new: the parent sends the move. */
  onDrop: (drop: DropResult) => void;
  onRowMenu: (item: Item, section: Section) => void;
  onRowPressBody: (item: Item, section: Section) => void;
  onToggleComplete: (item: Item, nextCompleted: boolean) => void;
  refreshing: boolean;
  onRefresh: () => void;
}
