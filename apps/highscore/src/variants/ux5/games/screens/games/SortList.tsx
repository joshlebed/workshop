// Native sort mode — long-press-to-drag over the board order.
//
// Same `react-native-reorderable-list` wiring as before, but scoped to the
// explicit sort mode rather than armed on every home row: outside sort mode a
// long press is free for other things, and a stray hold on a game band no
// longer picks it up mid-scroll.

import type { MyGame } from "@workshop/shared/games";
import { haptics, REORDER_AUTOSCROLL } from "@workshop/ui";
import type { ListRenderItemInfo } from "react-native";
import { StyleSheet } from "react-native";
import ReorderableList, {
  type ReorderableListReorderEvent,
  useIsActive,
  useReorderableDrag,
} from "react-native-reorderable-list";
import { DOCK_HEIGHT } from "../../../nav/dock";
import { tokens } from "../../../theme/tokens";
import { SortRow } from "./SortRow";
import type { SortListProps } from "./sortListProps";

export function SortList({ games, onReorder }: SortListProps) {
  return (
    <ReorderableList
      data={games}
      keyExtractor={(game: MyGame) => game.gameId}
      renderItem={({ item, index }: ListRenderItemInfo<MyGame>) => (
        <DraggableSortRow game={item} index={index} total={games.length} onReorder={onReorder} />
      )}
      onReorder={({ from, to }: ReorderableListReorderEvent) =>
        onReorder({ fromIndex: from, toIndex: to })
      }
      contentContainerStyle={styles.listContent}
      testID="games-sort-list"
      autoscrollThreshold={REORDER_AUTOSCROLL.threshold}
      autoscrollSpeedScale={REORDER_AUTOSCROLL.speedScale}
      shouldUpdateActiveItem
    />
  );
}

function DraggableSortRow({
  game,
  index,
  total,
  onReorder,
}: {
  game: MyGame;
  index: number;
  total: number;
  onReorder: SortListProps["onReorder"];
}) {
  const drag = useReorderableDrag();
  const isActive = useIsActive();
  return (
    <SortRow
      game={game}
      index={index}
      total={total}
      dragging={isActive}
      onMove={(delta) => onReorder({ fromIndex: index, toIndex: index + delta })}
      onLongPress={() => {
        haptics.selection();
        drag();
      }}
    />
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: DOCK_HEIGHT + tokens.space.xl },
});
