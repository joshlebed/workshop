// Web album-shelf list. Uses `@dnd-kit/sortable` for drag-to-reorder
// + accessible keyboard reorder + animated sibling shifts. Native iOS
// uses a separate impl driven by `react-native-reorderable-list`. The
// section/promote/demote logic is shared via `resolveReorder`.
//
// dnd-kit gives us:
//   - `<DndContext>` wraps the area; owns sensors + drag state.
//   - `<SortableContext>` declares the sortable items in display order.
//   - `useSortable(id)` per item returns transform + transition + listeners.
// We bind `listeners` to the drag handle (so only the handle initiates
// drag, not the whole row), and `setNodeRef` to the row container so the
// CSS transform follows the cursor. `onDragEnd` reports {active, over}
// → we map it to library-style {from, to} for `resolveReorder`.

import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Text, tokens } from "../../ui/index";
import { AlbumShelfRow, OrderedHint, rowStyles, SectionHeader } from "./AlbumShelfRow";
import type { ShelfListProps } from "./shelfListProps";
import { entryId, isRowEntry, type ShelfEntry } from "./types";

export function AlbumShelfList({
  entries,
  newItemIds,
  memberNameById,
  onReorder,
  onRowMenu,
}: ShelfListProps) {
  // `distance: 4` keeps the click on the menu button (⋮) from accidentally
  // initiating a drag — the user has to actually move the cursor before
  // the gesture is owned by dnd-kit.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const itemIds = useMemo(() => entries.map(entryId), [entries]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = entries.findIndex((e) => entryId(e) === active.id);
      const overIdx = entries.findIndex((e) => entryId(e) === over.id);
      if (from < 0 || overIdx < 0) return;
      // dnd-kit's standard sortable mapping is the same `arrayMove(items,
      // oldIndex, newIndex)` semantics that `react-native-reorderable-list`
      // already gives us in `onReorder`: take the OVER item's pre-move
      // index as `to` and let `splice(from, 1) → splice(to, 0)` do the
      // right thing. Drag DOWN: from < to → active lands BELOW over (over
      // shifts up to fill the gap). Drag UP: from > to → active lands
      // ABOVE over.
      onReorder({ from, to: overIdx });
    },
    [entries, onReorder],
  );

  return (
    <ScrollView contentContainerStyle={styles.listContent} testID="album-shelf-list">
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {entries.map((entry) => {
            const row = isRowEntry(entry) ? entry : null;
            const isNew = row?.kind === "detected-row" && newItemIds.has(row.item.id);
            const addedByName = row ? (memberNameById.get(row.item.addedBy) ?? null) : null;
            return (
              <SortableEntry
                key={entryId(entry)}
                entry={entry}
                isNew={isNew}
                addedByName={addedByName}
                onMenu={() => {
                  if (row) onRowMenu(row);
                }}
              />
            );
          })}
        </SortableContext>
      </DndContext>
    </ScrollView>
  );
}

interface SortableEntryProps {
  entry: ShelfEntry;
  isNew: boolean;
  addedByName: string | null;
  onMenu: () => void;
}

function SortableEntry({ entry, isNew, addedByName, onMenu }: SortableEntryProps) {
  const id = entryId(entry);
  const draggable = isRowEntry(entry);
  const sortable = useSortable({ id, disabled: !draggable });
  const { setNodeRef, transform, transition, listeners, attributes, isDragging } = sortable;

  // dnd-kit emits CSS transforms; on react-native-web that becomes a
  // `transform` style on the underlying div. We apply it via the platform-
  // specific style escape hatch (cast to `any` because RN's ViewStyle
  // doesn't include arbitrary CSS strings).
  const webStyle = {
    transform: CSS.Transform.toString(transform) ?? undefined,
    transition: transition ?? undefined,
    touchAction: "none",
  } as unknown as object;

  if (entry.kind === "ordered-header") {
    return (
      <View ref={setNodeRef as unknown as React.Ref<View>} style={webStyle}>
        <SectionHeader kind="ordered" count={entry.count} />
      </View>
    );
  }
  if (entry.kind === "detected-header") {
    return (
      <View ref={setNodeRef as unknown as React.Ref<View>} style={webStyle}>
        <SectionHeader kind="detected" count={entry.count} />
      </View>
    );
  }
  if (entry.kind === "ordered-hint") {
    return (
      <View ref={setNodeRef as unknown as React.Ref<View>} style={webStyle}>
        <OrderedHint />
      </View>
    );
  }

  // Row case. Bind dnd-kit listeners to the drag handle only; the rest of
  // the card stays clickable (e.g. the ⋮ menu button).
  const dragHandle = (
    <View
      // Pass-through any DOM listeners + ARIA attrs dnd-kit gives us.
      // RN's <View> on web is a div, so spreading these works.
      {...((listeners ?? {}) as unknown as Record<string, unknown>)}
      {...((attributes ?? {}) as unknown as Record<string, unknown>)}
      accessibilityRole="button"
      accessibilityLabel={`Drag handle for ${entry.item.title}`}
      testID={`album-row-handle-${entry.item.id}`}
      style={[rowStyles.rowDragHandle, { cursor: "grab", userSelect: "none" } as unknown as object]}
    >
      <Text style={rowStyles.dragHandleGlyph}>≡</Text>
    </View>
  );

  return (
    <View ref={setNodeRef as unknown as React.Ref<View>} style={webStyle}>
      <AlbumShelfRow
        item={entry.item}
        isOrdered={entry.kind === "ordered-row"}
        indexLabel={entry.kind === "ordered-row" ? String(entry.orderedIndex + 1) : "•"}
        isNew={isNew}
        isDragging={isDragging}
        addedByName={addedByName}
        onMenu={onMenu}
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
