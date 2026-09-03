// Shared props between the native (`SortList.tsx`, react-native-reorderable-list)
// and web (`SortList.web.tsx`, @dnd-kit) implementations of sort mode.

import type { MyGame } from "@workshop/shared/games";

export interface GameReorderEvent {
  fromIndex: number;
  toIndex: number;
}

export interface SortListProps {
  /** Your board in your order. */
  games: MyGame[];
  onReorder: (event: GameReorderEvent) => void;
}
