// Native ledger container. Long-press anywhere on a line (except its own
// buttons) starts a reorder drag, matched to the web TouchSensor's 250ms.
// Reorder is disabled while a board is open: the open row is hundreds of
// pixels tall and dragging it is meaningless.

import type { MyGame } from "@workshop/shared/games";
import { haptics } from "@workshop/ui";
import { memo } from "react";
import type { ListRenderItemInfo } from "react-native";
import { Pressable, RefreshControl, StyleSheet } from "react-native";
import ReorderableList, {
  type ReorderableListReorderEvent,
  useIsActive,
  useReorderableDrag,
} from "react-native-reorderable-list";
import { homeLayout, tokens } from "../theme";
import type { LedgerListProps } from "./ledgerListProps";

export function LedgerList({
  games,
  renderRow,
  onReorder,
  reorderEnabled,
  refreshing,
  onRefresh,
  footer,
}: LedgerListProps) {
  return (
    <ReorderableList
      data={games}
      keyExtractor={keyExtractor}
      renderItem={({ item }: ListRenderItemInfo<MyGame>) => (
        <DraggableRow game={item} render={renderRow} enabled={reorderEnabled} />
      )}
      onReorder={({ from, to }: ReorderableListReorderEvent) =>
        onReorder({ fromIndex: from, toIndex: to })
      }
      contentContainerStyle={styles.listContent}
      testID="games-home-list"
      showsVerticalScrollIndicator={false}
      ListFooterComponent={footer}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={tokens.neon.pink}
          colors={[tokens.neon.pink]}
          progressBackgroundColor={tokens.bg.surface}
        />
      }
    />
  );
}

function keyExtractor(game: MyGame): string {
  return game.gameId;
}

const DraggableRow = memo(function DraggableRow({
  game,
  render,
  enabled,
}: {
  game: MyGame;
  render: LedgerListProps["renderRow"];
  enabled: boolean;
}) {
  const drag = useReorderableDrag();
  const isActive = useIsActive();
  const onLongPressBody = () => {
    haptics.selection();
    drag();
  };
  if (!enabled) return <>{render(game, isActive)}</>;
  return (
    <Pressable onLongPress={onLongPressBody} delayLongPress={250} accessible={false}>
      {render(game, isActive, onLongPressBody)}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: homeLayout.horizontalInset,
    paddingBottom: homeLayout.bottomInset,
  },
});
