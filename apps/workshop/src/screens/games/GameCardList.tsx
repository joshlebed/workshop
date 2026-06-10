// Native (iOS / Android) Games-home card container.
//
// Mirrors `ItemList.tsx`'s ordered-section wiring for a single flat ordered
// list: long-press anywhere on a card's body activates reorder via
// `useReorderableDrag()` (250ms, matched to the web TouchSensor delay).

import type { MyGame } from "@workshop/shared/games";
import * as Haptics from "expo-haptics";
import { memo } from "react";
import type { ListRenderItemInfo } from "react-native";
import { StyleSheet } from "react-native";
import {
  NestedReorderableList,
  type ReorderableListReorderEvent,
  ScrollViewContainer,
  useIsActive,
  useReorderableDrag,
} from "react-native-reorderable-list";
import { PullToRefresh } from "../../components/PullToRefresh";
import { tokens } from "../../ui/index";
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
      <ScrollViewContainer contentContainerStyle={styles.listContent} testID="games-home-list">
        <NestedReorderableList
          data={games}
          keyExtractor={keyExtractor}
          renderItem={({ item }: ListRenderItemInfo<MyGame>) => (
            <DraggableCard game={item} render={renderCard} />
          )}
          onReorder={({ from, to }: ReorderableListReorderEvent) =>
            onReorder({ fromIndex: from, toIndex: to })
          }
          scrollable={false}
          autoscrollThreshold={0.15}
          autoscrollSpeedScale={1}
          shouldUpdateActiveItem
        />
      </ScrollViewContainer>
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

const DraggableCard = memo(function DraggableCard({ game, render }: DraggableCardProps) {
  const drag = useReorderableDrag();
  const isActive = useIsActive();
  const onLongPressBody = () => {
    Haptics.selectionAsync().catch(() => {
      /* haptics unavailable on simulator — non-fatal */
    });
    drag();
  };
  return <>{render(game, isActive, onLongPressBody)}</>;
});

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xxl * 2,
  },
});
