// Web list-detail row container.
//
// Section headers and the ordered hint render as plain markup outside any
// sortable context — keeping them out of the sortable items list is what
// fixed the cross-section layout glitch the native side was hitting too
// (where the section header ended up rendered below its rows after a
// drag). Drag-to-reorder is scoped to the ordered section; cross-section
// transitions go through the kebab menu.

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Item } from "@workshop/shared";
import { type ReactNode, useCallback, useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { tokens } from "../../ui/index";
import { ItemRow, OrderedHint, rowStyles, SectionHeader } from "./ItemRow";
import type { ItemListProps } from "./listProps";

export function ItemList({
  ordered,
  unordered,
  completed,
  isAlbumShelf,
  showOrderedHint,
  newItemIds,
  memberNameById,
  showProvenance,
  accent,
  onReorderOrdered,
  onRowMenu,
  onRowPressBody,
}: ItemListProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const orderedIds = useMemo(() => ordered.map((it) => it.id), [ordered]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const fromIndex = ordered.findIndex((it) => it.id === active.id);
      const toIndex = ordered.findIndex((it) => it.id === over.id);
      if (fromIndex < 0 || toIndex < 0) return;
      onReorderOrdered({ fromIndex, toIndex });
    },
    [ordered, onReorderOrdered],
  );

  return (
    <ScrollView contentContainerStyle={styles.listContent} testID="list-detail-list">
      {ordered.length > 0 ? (
        <>
          <SectionHeader kind="ordered" count={ordered.length} />
          <DndContext
            sensors={sensors}
            onDragEnd={handleDragEnd}
            collisionDetection={closestCenter}
          >
            <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
              {ordered.map((item, i) => (
                <SortableOrderedRow
                  key={item.id}
                  item={item}
                  indexLabel={String(i + 1)}
                  addedByName={showProvenance ? (memberNameById.get(item.addedBy) ?? null) : null}
                  accent={accent}
                  onMenu={() => onRowMenu(item, "ordered")}
                  onPressBody={() => onRowPressBody(item, "ordered")}
                />
              ))}
            </SortableContext>
          </DndContext>
        </>
      ) : null}

      {showOrderedHint ? <OrderedHint isAlbumShelf={isAlbumShelf} /> : null}

      {unordered.length > 0 ? (
        <>
          <SectionHeader kind="unordered" count={unordered.length} isAlbumShelf={isAlbumShelf} />
          {unordered.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              section="unordered"
              indexLabel=""
              isNew={newItemIds.has(item.id)}
              isDragging={false}
              addedByName={showProvenance ? (memberNameById.get(item.addedBy) ?? null) : null}
              accent={accent}
              onMenu={() => onRowMenu(item, "unordered")}
              onPressBody={() => onRowPressBody(item, "unordered")}
            />
          ))}
        </>
      ) : null}

      {completed.length > 0 ? (
        <>
          <SectionHeader kind="completed" count={completed.length} />
          {completed.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              section="completed"
              indexLabel=""
              isNew={false}
              isDragging={false}
              addedByName={showProvenance ? (memberNameById.get(item.addedBy) ?? null) : null}
              accent={accent}
              onMenu={() => onRowMenu(item, "completed")}
              onPressBody={() => onRowPressBody(item, "completed")}
            />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

interface SortableOrderedRowProps {
  item: Item;
  indexLabel: string;
  addedByName: string | null;
  accent: string;
  onMenu: () => void;
  onPressBody: () => void;
}

function SortableOrderedRow({
  item,
  indexLabel,
  addedByName,
  accent,
  onMenu,
  onPressBody,
}: SortableOrderedRowProps) {
  const { setNodeRef, transform, transition, listeners, attributes, isDragging } = useSortable({
    id: item.id,
  });

  const webStyle = {
    transform: CSS.Transform.toString(transform) ?? undefined,
    transition: transition ?? undefined,
    touchAction: "none",
  } as unknown as object;

  const dragHandle = (child: ReactNode) => (
    <View
      {...((listeners ?? {}) as unknown as Record<string, unknown>)}
      {...((attributes ?? {}) as unknown as Record<string, unknown>)}
      accessibilityRole="button"
      accessibilityLabel={`Drag handle for ${item.title}`}
      testID={`item-row-handle-${item.id}`}
      style={[rowStyles.rowDragHandle, { cursor: "grab", userSelect: "none" } as unknown as object]}
    >
      {child}
    </View>
  );

  return (
    <View ref={setNodeRef as unknown as React.Ref<View>} style={webStyle}>
      <ItemRow
        item={item}
        section="ordered"
        indexLabel={indexLabel}
        isNew={false}
        isDragging={isDragging}
        addedByName={addedByName}
        accent={accent}
        onMenu={onMenu}
        onPressBody={onPressBody}
        dragHandle={dragHandle}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.xxl * 2,
  },
});
