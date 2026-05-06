// Native (iOS / Android) list-detail row container. Uses
// `react-native-reorderable-list` for drag-to-reorder + autoscroll +
// sibling animations + layout animations. Three sections (ordered +
// unordered + completed) are rendered as a single flat list so one
// library handles all the drag plumbing; cross-section drops are
// detected after the fact in `resolveReorder`. Completed rows are
// displayed but skip the drag handle, so dragging in/out of them is a
// no-op at the resolve layer.
//
// The web platform uses a separate impl (see `ItemList.web.tsx`)
// driven by @dnd-kit/sortable since RNRL doesn't target react-native-web.

import * as Haptics from "expo-haptics";
import { useCallback } from "react";
import { Pressable, StyleSheet } from "react-native";
import ReorderableList, {
  type ReorderableListReorderEvent,
  useIsActive,
  useReorderableDrag,
} from "react-native-reorderable-list";
import { Text, tokens } from "../../ui/index";
import { ItemRow, OrderedHint, rowStyles, SectionHeader } from "./ItemRow";
import type { ItemListProps } from "./listProps";
import { entryId, type ListEntry } from "./types";

export function ItemList({
  entries,
  newItemIds,
  memberNameById,
  onReorder,
  onRowMenu,
  onRowPressBody,
}: ItemListProps) {
  const renderItem = useCallback(
    ({ item: entry }: { item: ListEntry }) => {
      if (entry.kind === "ordered-header") {
        return <SectionHeader kind="ordered" count={entry.count} />;
      }
      if (entry.kind === "unordered-header") {
        return (
          <SectionHeader kind="unordered" count={entry.count} isAlbumShelf={entry.isAlbumShelf} />
        );
      }
      if (entry.kind === "completed-header") {
        return <SectionHeader kind="completed" count={entry.count} />;
      }
      if (entry.kind === "ordered-hint") {
        const isAlbumShelfHint = entries.some(
          (e) => e.kind === "unordered-header" && e.isAlbumShelf,
        );
        return <OrderedHint isAlbumShelf={isAlbumShelfHint} />;
      }
      const section =
        entry.kind === "ordered-row"
          ? "ordered"
          : entry.kind === "unordered-row"
            ? "unordered"
            : "completed";
      const indexLabel =
        entry.kind === "ordered-row"
          ? String(entry.orderedIndex + 1)
          : section === "completed"
            ? "✓"
            : "•";
      const isDraggable = entry.kind !== "completed-row";
      return (
        <DraggableRow
          item={entry.item}
          section={section}
          indexLabel={indexLabel}
          isNew={section === "unordered" && newItemIds.has(entry.item.id)}
          addedByName={memberNameById.get(entry.item.addedBy) ?? null}
          onMenu={() => onRowMenu(entry)}
          onPressBody={() => onRowPressBody(entry)}
          draggable={isDraggable}
        />
      );
    },
    [entries, newItemIds, memberNameById, onRowMenu, onRowPressBody],
  );

  const handleReorder = useCallback(
    ({ from, to }: ReorderableListReorderEvent) => {
      onReorder({ from, to });
    },
    [onReorder],
  );

  return (
    <ReorderableList
      data={entries}
      keyExtractor={entryId}
      renderItem={renderItem}
      onReorder={handleReorder}
      autoscrollThreshold={0.15}
      autoscrollSpeedScale={1}
      contentContainerStyle={styles.listContent}
      shouldUpdateActiveItem
    />
  );
}

interface DraggableRowProps {
  item: import("@workshop/shared").Item;
  section: "ordered" | "unordered" | "completed";
  indexLabel: string;
  isNew: boolean;
  addedByName: string | null;
  onMenu: () => void;
  onPressBody: () => void;
  draggable: boolean;
}

function DraggableRow({
  item,
  section,
  indexLabel,
  isNew,
  addedByName,
  onMenu,
  onPressBody,
  draggable,
}: DraggableRowProps) {
  const drag = useReorderableDrag();
  const isActive = useIsActive();

  const onHandleLongPress = useCallback(() => {
    Haptics.selectionAsync().catch(() => {
      /* haptics unavailable on simulator — non-fatal */
    });
    drag();
  }, [drag]);

  const dragHandle = draggable ? (
    <Pressable
      onLongPress={onHandleLongPress}
      delayLongPress={120}
      accessibilityRole="button"
      accessibilityLabel={`Drag handle for ${item.title}`}
      testID={`item-row-handle-${item.id}`}
      style={rowStyles.rowDragHandle}
      hitSlop={6}
    >
      <Text style={rowStyles.dragHandleGlyph}>≡</Text>
    </Pressable>
  ) : undefined;

  return (
    <ItemRow
      item={item}
      section={section}
      indexLabel={indexLabel}
      isNew={isNew}
      isDragging={isActive}
      addedByName={addedByName}
      onMenu={onMenu}
      onPressBody={onPressBody}
      {...(dragHandle ? { dragHandle } : {})}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.xxl * 2,
  },
});
