// Shared props between the native (`GameCardList.tsx`,
// react-native-reorderable-list) and web (`GameCardList.web.tsx`, @dnd-kit)
// implementations of the Games-home card container.

import type { MyGame } from "@workshop/shared/games";
import type { ReactNode } from "react";

export interface GameReorderEvent {
  fromIndex: number;
  toIndex: number;
}

export interface GameCardListProps {
  /** My Games in my order — every card is reorderable. */
  games: MyGame[];
  /**
   * Renders one card. `onLongPressBody` is supplied by the native drag
   * wrapper (long-press activates reorder); web drags via wrapper pointer
   * listeners and passes none.
   */
  renderCard: (game: MyGame, isDragging: boolean, onLongPressBody?: () => void) => ReactNode;
  onReorder: (event: GameReorderEvent) => void;
  refreshing: boolean;
  onRefresh: () => void;
}
