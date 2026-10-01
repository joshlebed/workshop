// Native BY GAME scroller. Long-press anywhere on a row (except the peek and
// play keys) activates reorder via `useReorderableDrag()` at 280ms, matched to
// the web TouchSensor delay. The list owns the page scroll and carries the
// recap / add-game footer, so there is no nested VirtualizedList.

import type { MyGame } from "@workshop/shared/games";
import { haptics, REORDER_AUTOSCROLL } from "@workshop/ui";
import { memo } from "react";
import type { ListRenderItemInfo } from "react-native";
import { Pressable, StyleSheet } from "react-native";
import ReorderableList, {
  type ReorderableListReorderEvent,
  useIsActive,
  useReorderableDrag,
} from "react-native-reorderable-list";
import { layout, PullToRefresh, tokens } from "../../../theme";
import type { ByGameListProps } from "./byGameListProps";

export function ByGameList({
  games,
  renderRow,
  onReorder,
  footer,
  refreshing,
  onRefresh,
}: ByGameListProps) {
  return (
    <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
      <ReorderableList
        data={games}
        keyExtractor={keyExtractor}
        renderItem={({ item, index }: ListRenderItemInfo<MyGame>) => (
          <DraggableRow game={item} index={index} render={renderRow} />
        )}
        onReorder={({ from, to }: ReorderableListReorderEvent) =>
          onReorder({ fromIndex: from, toIndex: to })
        }
        ListFooterComponent={footer as React.ReactElement}
        contentContainerStyle={styles.content}
        testID="by-game-list"
        autoscrollThreshold={REORDER_AUTOSCROLL.threshold}
        autoscrollSpeedScale={REORDER_AUTOSCROLL.speedScale}
        shouldUpdateActiveItem
      />
    </PullToRefresh>
  );
}

function keyExtractor(game: MyGame): string {
  return game.gameId;
}

// The transparent wrapper catches a long-press on the gaps between the row's
// own Pressables; those take `onLongPressBody` themselves. `accessible={false}`
// keeps the inner buttons reachable by VoiceOver.
const DraggableRow = memo(function DraggableRow({
  game,
  index,
  render,
}: {
  game: MyGame;
  index: number;
  render: ByGameListProps["renderRow"];
}) {
  const drag = useReorderableDrag();
  const isActive = useIsActive();
  const onLongPressBody = () => {
    haptics.selection();
    drag();
  };
  return (
    <Pressable onLongPress={onLongPressBody} delayLongPress={280} accessible={false}>
      {render(game, index, isActive, onLongPressBody)}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: layout.inset,
    paddingBottom: tokens.space.xl,
  },
});
