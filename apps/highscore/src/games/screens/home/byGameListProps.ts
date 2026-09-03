// Shared props between the native (`ByGameList.tsx`, react-native-reorderable-list)
// and web (`ByGameList.web.tsx`, @dnd-kit) implementations of the BY GAME
// projection's scroller. Both own the page's vertical scroll and render the
// recap / add-game footer inside it, so home is one scroll surface.

import type { MyGame } from "@workshop/shared/games";
import type { ReactNode } from "react";

export interface GameReorderEvent {
  fromIndex: number;
  toIndex: number;
}

export interface ByGameListProps {
  /** My Games in my order — every row is reorderable. */
  games: MyGame[];
  /**
   * Renders one row. `onLongPressBody` is supplied by the native drag wrapper
   * (long-press activates reorder); web drags via wrapper pointer listeners and
   * passes none.
   */
  renderRow: (
    game: MyGame,
    index: number,
    isDragging: boolean,
    onLongPressBody?: () => void,
  ) => ReactNode;
  onReorder: (event: GameReorderEvent) => void;
  footer: ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
}
