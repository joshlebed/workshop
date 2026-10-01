// Shared props between the native (`TodoList.tsx`, react-native-reorderable-list)
// and web (`TodoList.web.tsx`, @dnd-kit) implementations of today's to-do list.
//
// The to-do list is where My Games order is edited: it lives *inside* the
// timeline's scroll view rather than owning a scroll of its own, so the native
// side uses the library's nested API (`NestedReorderableList` inside the
// `ScrollViewContainer` that `FeedScroll.tsx` provides) and the web side just
// renders sortable Views.

import type { MyGame } from "@workshop/shared/games";
import type { ReactNode } from "react";

export interface TodoReorderEvent {
  fromIndex: number;
  toIndex: number;
}

export interface TodoListProps {
  /** Unplayed games, in My Games order. */
  games: MyGame[];
  /**
   * Renders one row. `onLongPressBody` is supplied by the native drag wrapper
   * (long-press activates reorder); web drags via wrapper pointer listeners.
   */
  renderRow: (game: MyGame, dragging: boolean, onLongPressBody?: () => void) => ReactNode;
  onReorder: (event: TodoReorderEvent) => void;
}
