// Web list-detail row container.
//
// Section headers and the ordered hint render as plain markup outside any
// sortable context — keeping them out of the sortable items list is what
// fixed the cross-section layout glitch the native side was hitting too.
//
// Drag-to-reorder works within the ordered section, and unordered rows are
// draggable into the ordered section (drop on an ordered row inserts above
// it; drop on the trailing "Drop here" zone appends). Cross-section drag
// from completed isn't supported — that still goes through the kebab menu.

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Item } from "@workshop/shared";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Text, tokens } from "../../ui/index";
import { ItemRow, OrderedHint, rowStyles, SectionHeader } from "./ItemRow";
import type { ItemListProps } from "./listProps";

const ORDERED_DROP_END_ID = "ordered-drop-end";

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
  onPromoteToOrdered,
  onRowMenu,
  onRowPressBody,
}: ItemListProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const orderedIds = useMemo(() => ordered.map((it) => it.id), [ordered]);
  const orderedIdSet = useMemo(() => new Set(orderedIds), [orderedIds]);
  const [activeSection, setActiveSection] = useState<"ordered" | "unordered" | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const section = event.active.data.current?.section as "ordered" | "unordered" | undefined;
    setActiveSection(section ?? null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveSection(null);
      const { active, over } = event;
      if (!over) return;
      const fromSection = (active.data.current?.section ?? "ordered") as "ordered" | "unordered";

      if (fromSection === "ordered") {
        if (active.id === over.id) return;
        const fromIndex = ordered.findIndex((it) => it.id === active.id);
        if (fromIndex < 0) return;
        let toIndex: number;
        if (over.id === ORDERED_DROP_END_ID) {
          toIndex = ordered.length - 1;
        } else {
          toIndex = ordered.findIndex((it) => it.id === over.id);
          if (toIndex < 0) return;
        }
        if (fromIndex === toIndex) return;
        onReorderOrdered({ fromIndex, toIndex });
        return;
      }

      // Drag from unordered → ordered.
      const item = unordered.find((it) => it.id === active.id);
      if (!item) return;
      let toIndex: number;
      if (over.id === ORDERED_DROP_END_ID) {
        toIndex = ordered.length;
      } else if (orderedIdSet.has(String(over.id))) {
        toIndex = ordered.findIndex((it) => it.id === over.id);
        if (toIndex < 0) return;
      } else {
        return;
      }
      onPromoteToOrdered({ item, toIndex });
    },
    [ordered, unordered, orderedIdSet, onReorderOrdered, onPromoteToOrdered],
  );

  const handleDragCancel = useCallback(() => setActiveSection(null), []);

  const draggingFromUnordered = activeSection === "unordered";
  const showOrderedDropEnd = ordered.length > 0 || draggingFromUnordered;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      collisionDetection={closestCenter}
    >
      <ScrollView contentContainerStyle={styles.listContent} testID="list-detail-list">
        {ordered.length > 0 ? <SectionHeader kind="ordered" count={ordered.length} /> : null}
        <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
          {ordered.map((item) => (
            <SortableOrderedRow
              key={item.id}
              item={item}
              addedByName={showProvenance ? (memberNameById.get(item.addedBy) ?? null) : null}
              accent={accent}
              onMenu={() => onRowMenu(item, "ordered")}
              onPressBody={() => onRowPressBody(item, "ordered")}
            />
          ))}
        </SortableContext>

        {showOrderedDropEnd ? <OrderedDropEndZone highlighted={draggingFromUnordered} /> : null}

        {showOrderedHint ? <OrderedHint isAlbumShelf={isAlbumShelf} /> : null}

        {unordered.length > 0 ? (
          <>
            <SectionHeader kind="unordered" count={unordered.length} isAlbumShelf={isAlbumShelf} />
            {unordered.map((item) => (
              <DraggableUnorderedRow
                key={item.id}
                item={item}
                isNew={newItemIds.has(item.id)}
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
    </DndContext>
  );
}

interface SortableOrderedRowProps {
  item: Item;
  addedByName: string | null;
  accent: string;
  onMenu: () => void;
  onPressBody: () => void;
}

function SortableOrderedRow({
  item,
  addedByName,
  accent,
  onMenu,
  onPressBody,
}: SortableOrderedRowProps) {
  const { setNodeRef, transform, transition, listeners, attributes, isDragging } = useSortable({
    id: item.id,
    data: { section: "ordered" },
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

interface DraggableUnorderedRowProps {
  item: Item;
  isNew: boolean;
  addedByName: string | null;
  accent: string;
  onMenu: () => void;
  onPressBody: () => void;
}

function DraggableUnorderedRow({
  item,
  isNew,
  addedByName,
  accent,
  onMenu,
  onPressBody,
}: DraggableUnorderedRowProps) {
  const { setNodeRef, transform, listeners, attributes, isDragging } = useDraggable({
    id: item.id,
    data: { section: "unordered" },
  });

  const webStyle = {
    transform: CSS.Translate.toString(transform) ?? undefined,
    opacity: isDragging ? 0.7 : 1,
  } as unknown as object;

  // Listeners go on the leading drag handle, not the row wrapper — RN Web
  // Pressables inside the row body capture pointerdown and would otherwise
  // swallow the drag activation.
  const dragHandle = (child: ReactNode) => (
    <View
      {...((listeners ?? {}) as unknown as Record<string, unknown>)}
      {...((attributes ?? {}) as unknown as Record<string, unknown>)}
      accessibilityRole="button"
      accessibilityLabel={`Drag handle for ${item.title}`}
      testID={`item-row-handle-${item.id}`}
      style={
        [
          rowStyles.rowDragHandle,
          { cursor: "grab", userSelect: "none", touchAction: "none" },
        ] as unknown as object
      }
    >
      {child}
    </View>
  );

  return (
    <View ref={setNodeRef as unknown as React.Ref<View>} style={webStyle}>
      <ItemRow
        item={item}
        section="unordered"
        isNew={isNew}
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

function OrderedDropEndZone({ highlighted }: { highlighted: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: ORDERED_DROP_END_ID });
  if (!highlighted && !isOver) {
    // Invisible spacer so dropping at the end of ordered still works for
    // intra-ordered reorders, without showing the "drop zone" affordance.
    return (
      <View
        ref={setNodeRef as unknown as React.Ref<View>}
        style={styles.dropZoneSpacer}
        testID="list-detail-ordered-drop-end"
      />
    );
  }
  return (
    <View
      ref={setNodeRef as unknown as React.Ref<View>}
      style={[styles.dropZone, isOver && styles.dropZoneActive]}
      testID="list-detail-ordered-drop-end"
    >
      <Text variant="caption" tone="secondary">
        Drop here to add to ranked list
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.xxl * 2,
  },
  dropZoneSpacer: {
    height: tokens.space.sm,
  },
  dropZone: {
    marginTop: tokens.space.xs,
    marginBottom: tokens.space.sm,
    paddingVertical: tokens.space.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
  },
  dropZoneActive: {
    borderColor: tokens.accent.default,
    backgroundColor: `${tokens.accent.default}1A`,
  },
});
