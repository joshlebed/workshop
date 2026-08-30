// Web Games-home card container — @dnd-kit drag-to-reorder over My Games.
//
// Mirrors `ItemList.web.tsx`'s ordered-section wiring (same sensors, same
// activation feel, same `stripButtonRole` workaround) for a single flat
// ordered list: every card is sortable, there are no sections.

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { MyGame } from "@workshop/shared/games";
import { PullToRefresh } from "@workshop/ui";
import { useCallback, useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { homeLayout } from "../../../theme";
import type { GameCardListProps } from "./gameCardListProps";

export function GameCardList({
  games,
  renderCard,
  onReorder,
  refreshing,
  onRefresh,
}: GameCardListProps) {
  // Two sensors, never one with mixed activation (see ItemList.web.tsx):
  // MouseSensor stays snappy on desktop; TouchSensor's delay+tolerance lets
  // a swipe scroll and a press-and-hold reorder.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const ids = useMemo(() => games.map((g) => g.gameId), [games]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const fromIndex = games.findIndex((g) => g.gameId === active.id);
      const toIndex = games.findIndex((g) => g.gameId === over.id);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
      onReorder({ fromIndex, toIndex });
    },
    [games, onReorder],
  );

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd} collisionDetection={closestCenter}>
      <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
        <ScrollView contentContainerStyle={styles.listContent} testID="games-home-list">
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {games.map((game) => (
              <SortableCard key={game.gameId} game={game} render={renderCard} />
            ))}
          </SortableContext>
        </ScrollView>
      </PullToRefresh>
    </DndContext>
  );
}

interface SortableCardProps {
  game: MyGame;
  render: GameCardListProps["renderCard"];
}

// Whole-card drag target: listeners on the wrapper; a press-and-hold reorders,
// a tap falls through to the card's own Pressables.
function SortableCard({ game, render }: SortableCardProps) {
  const { setNodeRef, transform, transition, listeners, attributes, isDragging } = useSortable({
    id: game.gameId,
  });

  // `touchAction: "pan-y"` lets vertical scroll pass through until the
  // long-press activation fires (TouchSensor delay+tolerance).
  const webStyle = {
    transform: CSS.Transform.toString(transform) ?? undefined,
    transition: transition ?? undefined,
    touchAction: "pan-y",
    userSelect: "none",
  } as unknown as object;

  // Strip `role`/`tabIndex` from dnd-kit's a11y attributes — react-native-web
  // turns `role="button"` on a View into an HTML <button>, nesting around the
  // card's inner Pressables (also <button>s). Touch/mouse sensors only here,
  // so dropping them is safe. Same workaround as ItemList.web.tsx.
  const wrapperAttributes = stripButtonRole(attributes);

  return (
    <View
      ref={setNodeRef as unknown as React.Ref<View>}
      style={webStyle}
      {...((listeners ?? {}) as unknown as Record<string, unknown>)}
      {...(wrapperAttributes as unknown as Record<string, unknown>)}
    >
      {render(game, isDragging)}
    </View>
  );
}

function stripButtonRole(attributes: unknown): Record<string, unknown> {
  if (!attributes || typeof attributes !== "object") return {};
  const { role: _role, tabIndex: _tabIndex, ...rest } = attributes as Record<string, unknown>;
  return rest;
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: homeLayout.horizontalInset,
    paddingTop: homeLayout.contentTopGap,
    paddingBottom: homeLayout.bottomInset,
  },
});
