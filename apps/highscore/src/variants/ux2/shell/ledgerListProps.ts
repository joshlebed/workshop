import type { MyGame } from "@workshop/shared/games";
import type { ReactElement, ReactNode } from "react";

export interface LedgerReorderEvent {
  fromIndex: number;
  toIndex: number;
}

export interface LedgerListProps {
  games: MyGame[];
  /**
   * Renders one ledger line. `onLongPressBody` is supplied by the native drag
   * wrapper; web drags through the wrapper's pointer listeners and passes none.
   */
  renderRow: (game: MyGame, isDragging: boolean, onLongPressBody?: () => void) => ReactNode;
  onReorder: (event: LedgerReorderEvent) => void;
  /** Reorder is off while a board is open — you can't drag a 600px row. */
  reorderEnabled: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  /** Add-a-game + copy-recap live at the foot of the ledger, not in a FAB. */
  footer: ReactElement;
}
