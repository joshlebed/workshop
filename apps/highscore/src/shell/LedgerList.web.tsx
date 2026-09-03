// Web ledger container — @dnd-kit drag-to-reorder, same activation feel as
// the native long-press. See `LedgerList.tsx` for the shared contract.

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
import { homeLayout } from "../theme";
import type { LedgerListProps } from "./ledgerListProps";

export function LedgerList({
  games,
  renderRow,
  onReorder,
  reorderEnabled,
  footer,
}: LedgerListProps) {
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
      <ScrollView contentContainerStyle={styles.listContent} testID="games-home-list">
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {games.map((game) => (
            <SortableRow
              key={game.gameId}
              game={game}
              render={renderRow}
              disabled={!reorderEnabled}
            />
          ))}
        </SortableContext>
        {footer}
      </ScrollView>
    </DndContext>
  );
}

function SortableRow({
  game,
  render,
  disabled,
}: {
  game: MyGame;
  render: LedgerListProps["renderRow"];
  disabled: boolean;
}) {
  const { setNodeRef, transform, transition, listeners, attributes, isDragging } = useSortable({
    id: game.gameId,
    disabled,
  });

  const webStyle = {
    transform: CSS.Transform.toString(transform) ?? undefined,
    transition: transition ?? undefined,
    touchAction: "pan-y",
    userSelect: "none",
  } as unknown as object;

  // Strip dnd-kit's `role="button"` / `tabIndex`: react-native-web turns a
  // View with role="button" into an HTML <button>, which would wrap the row's
  // own <button> Pressables. Mouse/touch sensors only, so it's safe to drop.
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
    paddingBottom: homeLayout.bottomInset,
  },
});
