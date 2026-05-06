// Web list-detail row container. Multiple `SortableContext`s (one per
// draggable section) inside a single `DndContext`, with section headers
// + ordered-hint + completed rows rendered as plain markup between them.
// Keeping per-section contexts contains dnd-kit's vertical strategy to
// each contiguous run of sortable rows and stops shifts across header
// gaps. Cross-section drag still works because the outer DndContext sees
// both `active` and `over` regardless of which inner SortableContext
// owns them. See the album-shelf web list (PR #126) for the original
// motivation.
//
// Completed rows are rendered but not registered with any
// SortableContext, so they aren't draggable; resolveReorder treats a
// drop into the completed band as a noop too.

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useMemo, useRef } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Text, tokens } from "../../ui/index";
import { ItemRow, OrderedHint, rowStyles, SectionHeader } from "./ItemRow";
import type { ItemListProps } from "./listProps";
import { entryId, type ListEntry } from "./types";

function makeRowsAreaModifier(rowsAreaRef: React.RefObject<View | null>): Modifier {
  return ({ transform, draggingNodeRect }) => {
    if (!draggingNodeRect) return transform;
    const node = rowsAreaRef.current as unknown as { getBoundingClientRect?: () => DOMRect } | null;
    const areaRect = node?.getBoundingClientRect?.();
    if (!areaRect) return transform;
    const proposedTop = draggingNodeRect.top + transform.y;
    const proposedBottom = draggingNodeRect.bottom + transform.y;
    if (proposedTop < areaRect.top) {
      return { ...transform, y: areaRect.top - draggingNodeRect.top };
    }
    if (proposedBottom > areaRect.bottom) {
      return { ...transform, y: areaRect.bottom - draggingNodeRect.bottom };
    }
    return transform;
  };
}

export function ItemList({
  entries,
  newItemIds,
  memberNameById,
  onReorder,
  onRowMenu,
  onRowPressBody,
}: ItemListProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const orderedRows = useMemo(
    () =>
      entries.filter(
        (e): e is Extract<ListEntry, { kind: "ordered-row" }> => e.kind === "ordered-row",
      ),
    [entries],
  );
  const unorderedRows = useMemo(
    () =>
      entries.filter(
        (e): e is Extract<ListEntry, { kind: "unordered-row" }> => e.kind === "unordered-row",
      ),
    [entries],
  );
  const completedRows = useMemo(
    () =>
      entries.filter(
        (e): e is Extract<ListEntry, { kind: "completed-row" }> => e.kind === "completed-row",
      ),
    [entries],
  );
  const orderedIds = useMemo(() => orderedRows.map((r) => entryId(r)), [orderedRows]);
  const unorderedIds = useMemo(() => unorderedRows.map((r) => entryId(r)), [unorderedRows]);
  const orderedHeader = entries.find((e) => e.kind === "ordered-header");
  const unorderedHeader = entries.find(
    (e): e is Extract<ListEntry, { kind: "unordered-header" }> => e.kind === "unordered-header",
  );
  const completedHeader = entries.find(
    (e): e is Extract<ListEntry, { kind: "completed-header" }> => e.kind === "completed-header",
  );
  const showHint = entries.some((e) => e.kind === "ordered-hint");
  const isAlbumShelfHint = unorderedHeader?.isAlbumShelf ?? false;

  const rowsAreaRef = useRef<View>(null);
  const rowsAreaModifier = useMemo(() => makeRowsAreaModifier(rowsAreaRef), []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = entries.findIndex((e) => entryId(e) === active.id);
      const overIdx = entries.findIndex((e) => entryId(e) === over.id);
      if (from < 0 || overIdx < 0) return;
      onReorder({ from, to: overIdx });
    },
    [entries, onReorder],
  );

  return (
    <ScrollView contentContainerStyle={styles.listContent} testID="list-detail-list">
      <DndContext
        sensors={sensors}
        onDragEnd={handleDragEnd}
        collisionDetection={closestCenter}
        modifiers={[rowsAreaModifier]}
      >
        {orderedHeader ? <SectionHeader kind="ordered" count={orderedHeader.count} /> : null}
        <View ref={rowsAreaRef}>
          {orderedRows.length > 0 ? (
            <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
              {orderedRows.map((row) => (
                <SortableRowEntry
                  key={entryId(row)}
                  entry={row}
                  isNew={false}
                  addedByName={memberNameById.get(row.item.addedBy) ?? null}
                  onMenu={() => onRowMenu(row)}
                  onPressBody={() => onRowPressBody(row)}
                />
              ))}
            </SortableContext>
          ) : null}
          {showHint ? <OrderedHint isAlbumShelf={isAlbumShelfHint} /> : null}
          {unorderedHeader ? (
            <SectionHeader
              kind="unordered"
              count={unorderedHeader.count}
              isAlbumShelf={unorderedHeader.isAlbumShelf}
            />
          ) : null}
          {unorderedRows.length > 0 ? (
            <SortableContext items={unorderedIds} strategy={verticalListSortingStrategy}>
              {unorderedRows.map((row) => (
                <SortableRowEntry
                  key={entryId(row)}
                  entry={row}
                  isNew={newItemIds.has(row.item.id)}
                  addedByName={memberNameById.get(row.item.addedBy) ?? null}
                  onMenu={() => onRowMenu(row)}
                  onPressBody={() => onRowPressBody(row)}
                />
              ))}
            </SortableContext>
          ) : null}
        </View>
        {completedHeader ? <SectionHeader kind="completed" count={completedHeader.count} /> : null}
        {completedRows.map((row) => (
          <ItemRow
            key={entryId(row)}
            item={row.item}
            section="completed"
            indexLabel="✓"
            isNew={false}
            isDragging={false}
            addedByName={memberNameById.get(row.item.addedBy) ?? null}
            onMenu={() => onRowMenu(row)}
            onPressBody={() => onRowPressBody(row)}
          />
        ))}
      </DndContext>
    </ScrollView>
  );
}

interface SortableRowEntryProps {
  entry: Extract<ListEntry, { kind: "ordered-row" | "unordered-row" }>;
  isNew: boolean;
  addedByName: string | null;
  onMenu: () => void;
  onPressBody: () => void;
}

function SortableRowEntry({
  entry,
  isNew,
  addedByName,
  onMenu,
  onPressBody,
}: SortableRowEntryProps) {
  const id = entryId(entry);
  const { setNodeRef, transform, transition, listeners, attributes, isDragging } = useSortable({
    id,
  });

  const webStyle = {
    transform: CSS.Transform.toString(transform) ?? undefined,
    transition: transition ?? undefined,
    touchAction: "none",
  } as unknown as object;

  const dragHandle = (
    <View
      {...((listeners ?? {}) as unknown as Record<string, unknown>)}
      {...((attributes ?? {}) as unknown as Record<string, unknown>)}
      accessibilityRole="button"
      accessibilityLabel={`Drag handle for ${entry.item.title}`}
      testID={`item-row-handle-${entry.item.id}`}
      style={[rowStyles.rowDragHandle, { cursor: "grab", userSelect: "none" } as unknown as object]}
    >
      <Text style={rowStyles.dragHandleGlyph}>≡</Text>
    </View>
  );

  const section = entry.kind === "ordered-row" ? "ordered" : "unordered";
  const indexLabel = entry.kind === "ordered-row" ? String(entry.orderedIndex + 1) : "•";

  return (
    <View ref={setNodeRef as unknown as React.Ref<View>} style={webStyle}>
      <ItemRow
        item={entry.item}
        section={section}
        indexLabel={indexLabel}
        isNew={isNew}
        isDragging={isDragging}
        addedByName={addedByName}
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
