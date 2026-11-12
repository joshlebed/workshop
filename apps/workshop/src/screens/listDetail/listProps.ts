// Shared props between the native (`ItemList.tsx`, react-native-reorderable-list)
// and web (`ItemList.web.tsx`, @dnd-kit/sortable) implementations of the
// list-detail row container.

import type { Item, ItemKind } from "@workshop/shared";
import type { ReactNode, RefObject } from "react";
import type { SharedValue } from "react-native-reanimated";
import type { CompletionCopy, DropResult } from "./listOps";
import type { Section } from "./types";

/** What the screen needs from the list's scroll view (web ScrollView, native container). */
export interface ListScrollHandle {
  scrollTo: (options: { y: number; animated?: boolean }) => void;
}

export interface ItemListProps {
  /**
   * Rendered at the top of the scroll content, above the rows: the list's
   * title block, search and filters, so they scroll away with the list and
   * only a compact bar stays pinned (UX pass 5 review).
   */
  header?: ReactNode;
  /**
   * Shown under the header in place of rows (no row matches the filter).
   * Rendering it here, not instead of the list, keeps the header and its
   * focused search field mounted while the person types.
   */
  placeholder?: ReactNode;
  /** Written with the scroll offset, for the pinned bar's title. */
  scrollY?: SharedValue<number>;
  /** Lets the screen scroll back to the search field. */
  scrollRef?: RefObject<ListScrollHandle | null>;
  /** Visible rows per section (already filtered). */
  open: Item[];
  inbox: Item[];
  completed: Item[];
  /** The inbox's heading ("New from Spotify"), named for the list's source. */
  inboxTitle: string;
  /**
   * Nothing placed yet while the inbox has rows (a freshly connected album
   * shelf): the list shows where to drop one.
   */
  listEmpty: boolean;
  listItemKind: ItemKind | null;
  /** Completion is on: open rows get a checkbox, Done rows a filled one. */
  todoOn: boolean;
  copy: CompletionCopy;
  /** Artwork tiles on rows (media and link lists). */
  showCover: boolean;
  newItemIds: Set<string>;
  /** Rows just ticked done, still in place while they settle (drawn checked). */
  heldDoneIds?: ReadonlyMap<string, unknown>;
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
