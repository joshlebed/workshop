// Web sort mode — @dnd-kit sortable over the board order.
//
// Two sensors, never one with mixed activation: MouseSensor stays snappy on
// desktop, TouchSensor's delay+tolerance lets a swipe scroll and a press-and-
// hold reorder. `role`/`tabIndex` are stripped off dnd-kit's a11y attributes
// because react-native-web renders a `role="button"` View as an HTML <button>,
// which would nest around the row's own buttons.

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
import { useCallback, useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { DOCK_HEIGHT } from "../../../nav/dock";
import { tokens } from "../../../theme/tokens";
import { SortRow } from "./SortRow";
import type { SortListProps } from "./sortListProps";

export function SortList({ games, onReorder }: SortListProps) {
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
      <ScrollView contentContainerStyle={styles.listContent} testID="games-sort-list">
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {games.map((game, index) => (
            <SortableRow
              key={game.gameId}
              game={game}
              index={index}
              total={games.length}
              onReorder={onReorder}
            />
          ))}
        </SortableContext>
      </ScrollView>
    </DndContext>
  );
}

function SortableRow({
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
  const { setNodeRef, transform, transition, listeners, attributes, isDragging } = useSortable({
    id: game.gameId,
  });

  const webStyle = {
    transform: CSS.Transform.toString(transform) ?? undefined,
    transition: transition ?? undefined,
    touchAction: "pan-y",
    userSelect: "none",
  } as unknown as object;

  return (
    <View
      ref={setNodeRef as unknown as React.Ref<View>}
      style={webStyle}
      {...((listeners ?? {}) as unknown as Record<string, unknown>)}
      {...(stripButtonRole(attributes) as unknown as Record<string, unknown>)}
    >
      <SortRow
        game={game}
        index={index}
        total={total}
        dragging={isDragging}
        onMove={(delta) => onReorder({ fromIndex: index, toIndex: index + delta })}
      />
    </View>
  );
}

function stripButtonRole(attributes: unknown): Record<string, unknown> {
  if (!attributes || typeof attributes !== "object") return {};
  const { role: _role, tabIndex: _tabIndex, ...rest } = attributes as Record<string, unknown>;
  return rest;
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: DOCK_HEIGHT + tokens.space.xl },
});
