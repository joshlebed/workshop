// Web to-do list — @dnd-kit drag-to-reorder over today's unplayed games.
//
// No scroll container of its own: the rows render straight into the timeline's
// ScrollView. Two sensors, never one with mixed activation — MouseSensor stays
// snappy on desktop, TouchSensor's delay+tolerance lets a swipe scroll and a
// press-and-hold reorder.

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
import { View } from "react-native";
import type { TodoListProps } from "./todoListProps";

export function TodoList({ games, renderRow, onReorder }: TodoListProps) {
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
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <View testID="today-todo-list">
          {games.map((game) => (
            <SortableRow key={game.gameId} game={game} render={renderRow} />
          ))}
        </View>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ game, render }: { game: MyGame; render: TodoListProps["renderRow"] }) {
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
  // row's inner Pressables (also <button>s). Touch/mouse sensors only here, so
  // dropping them is safe.
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
