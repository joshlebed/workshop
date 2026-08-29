// Native (iOS / Android) Games-home card container.
//
// Mirrors `ItemList.tsx`'s ordered-section wiring for a single flat ordered
// list: long-press anywhere on a card (except the kebab menu) activates reorder
// via `useReorderableDrag()` (250ms, matched to the web TouchSensor delay).
//
// The list owns its own scroll. It used to be a `NestedReorderableList` inside a
// `ScrollViewContainer` — the library's nesting API — but Games home has no
// sibling content to co-scroll (the DayRail is pinned above the list, outside
// it), so the outer ScrollView bought nothing and cost two things: RN's
// VirtualizedList dev check fired "VirtualizedLists should never be nested
// inside plain ScrollViews with the same orientation" on every launch, and
// `scrollable={false}` disabled windowing, mounting every card up front.

import type { MyGame } from "@workshop/shared/games";
import { haptics, homeLayout, PullToRefresh, REORDER_AUTOSCROLL } from "@workshop/ui";
import { memo } from "react";
import type { ListRenderItemInfo } from "react-native";
import { Pressable, StyleSheet } from "react-native";
import ReorderableList, {
  type ReorderableListReorderEvent,
  useIsActive,
  useReorderableDrag,
} from "react-native-reorderable-list";
import type { GameCardListProps } from "./gameCardListProps";

export function GameCardList({
  games,
  renderCard,
  onReorder,
  refreshing,
  onRefresh,
}: GameCardListProps) {
  return (
    <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
      <ReorderableList
        data={games}
        keyExtractor={keyExtractor}
        renderItem={({ item }: ListRenderItemInfo<MyGame>) => (
          <DraggableCard game={item} render={renderCard} />
        )}
        onReorder={({ from, to }: ReorderableListReorderEvent) =>
          onReorder({ fromIndex: from, toIndex: to })
        }
        contentContainerStyle={styles.listContent}
        testID="games-home-list"
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

interface DraggableCardProps {
  game: MyGame;
  render: GameCardListProps["renderCard"];
}

// Whole-card reorder target — see ItemList.tsx's DraggableGameCard. The card's
// own Pressables (cover / Play / paste / title / standings) take
// `onLongPressBody`; this transparent wrapper catches a long-press on the gaps
// between them. The kebab menu stays out so a press there opens the menu, not a
// drag. `accessible={false}` keeps the inner buttons reachable by VoiceOver.
const DraggableCard = memo(function DraggableCard({ game, render }: DraggableCardProps) {
  const drag = useReorderableDrag();
  const isActive = useIsActive();
  const onLongPressBody = () => {
    haptics.selection();
    drag();
  };
  return (
    <Pressable onLongPress={onLongPressBody} delayLongPress={250} accessible={false}>
      {render(game, isActive, onLongPressBody)}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: homeLayout.horizontalInset,
    paddingTop: homeLayout.contentTopGap,
    paddingBottom: homeLayout.bottomInset,
  },
});
