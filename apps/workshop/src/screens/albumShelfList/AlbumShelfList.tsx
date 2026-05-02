// Native (iOS / Android) album-shelf list. Uses
// `react-native-reorderable-list` for drag-to-reorder + autoscroll +
// sibling animations + layout animations. The shelf has two visually
// distinct sections (ordered + detected) but is rendered as a single flat
// list so one library handles all the drag plumbing; cross-section
// drops are detected after the fact in `resolveReorder`.
//
// The web platform uses a separate impl (see `AlbumShelfList.web.tsx`)
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
import { AlbumShelfRow, OrderedHint, rowStyles, SectionHeader } from "./AlbumShelfRow";
import type { ShelfListProps } from "./shelfListProps";
import { entryId, type ShelfEntry } from "./types";

export function AlbumShelfList({
  entries,
  newItemIds,
  memberNameById,
  onReorder,
  onRowMenu,
}: ShelfListProps) {
  const renderItem = useCallback(
    ({ item: entry }: { item: ShelfEntry }) => {
      if (entry.kind === "ordered-header") {
        return <SectionHeader kind="ordered" count={entry.count} />;
      }
      if (entry.kind === "detected-header") {
        return <SectionHeader kind="detected" count={entry.count} />;
      }
      if (entry.kind === "ordered-hint") {
        return <OrderedHint />;
      }
      const isOrdered = entry.kind === "ordered-row";
      return (
        <DraggableShelfRow
          item={entry.item}
          isOrdered={isOrdered}
          indexLabel={isOrdered ? String(entry.orderedIndex + 1) : "•"}
          isNew={!isOrdered && newItemIds.has(entry.item.id)}
          addedByName={memberNameById.get(entry.item.addedBy) ?? null}
          onMenu={() => onRowMenu(entry)}
        />
      );
    },
    [newItemIds, memberNameById, onRowMenu],
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

interface DraggableShelfRowProps {
  item: import("@workshop/shared").Item;
  isOrdered: boolean;
  indexLabel: string;
  isNew: boolean;
  addedByName: string | null;
  onMenu: () => void;
}

function DraggableShelfRow({
  item,
  isOrdered,
  indexLabel,
  isNew,
  addedByName,
  onMenu,
}: DraggableShelfRowProps) {
  const drag = useReorderableDrag();
  const isActive = useIsActive();

  const onLongPress = useCallback(() => {
    Haptics.selectionAsync().catch(() => {
      /* haptics unavailable on simulator/web — non-fatal */
    });
    drag();
  }, [drag]);

  // The whole card is long-press-draggable, but a visible handle on the
  // left advertises the affordance and gives a quicker grab target for
  // power users.
  const dragHandle = (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={120}
      accessibilityRole="button"
      accessibilityLabel={`Drag handle for ${item.title}`}
      testID={`album-row-handle-${item.id}`}
      style={rowStyles.rowDragHandle}
      hitSlop={6}
    >
      <Text style={rowStyles.dragHandleGlyph}>≡</Text>
    </Pressable>
  );

  return (
    <Pressable onLongPress={onLongPress} delayLongPress={350} android_disableSound>
      <AlbumShelfRow
        item={item}
        isOrdered={isOrdered}
        indexLabel={indexLabel}
        isNew={isNew}
        isDragging={isActive}
        addedByName={addedByName}
        onMenu={onMenu}
        dragHandle={dragHandle}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.xxl * 2,
  },
});
