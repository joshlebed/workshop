// Web album-shelf list. Uses `@dnd-kit/sortable` for drag-to-reorder
// + accessible keyboard reorder + animated sibling shifts. Native iOS
// uses a separate impl driven by `react-native-reorderable-list`. The
// section/promote/demote logic is shared via `resolveReorder`.
//
// dnd-kit gives us:
//   - `<DndContext>` wraps the area; owns sensors + drag state.
//   - `<SortableContext>` declares the sortable items in display order.
//   - `useSortable(id)` per item returns transform + transition + listeners.
// Non-row entries (section headers, the ordered-hint) deliberately do NOT
// call useSortable and do NOT appear in `SortableContext.items`. If they
// did, dnd-kit would still apply transforms to them while a sibling row
// is dragged (even with `disabled: true`), making the headers visually
// behave like sortable list items. We keep them in the entries array
// because resolveReorder needs them to detect cross-section drops.

import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Item } from "@workshop/shared";
import { useCallback, useMemo } from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
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

  // Only ROW ids are sortable. Headers + ordered-hint are static markup
  // between sortable siblings.
  const sortableIds = useMemo(() => entries.filter(isRowEntry).map((e) => entryId(e)), [entries]);

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
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {entries.map((entry) => {
            if (entry.kind === "ordered-header") {
              return <SectionHeader key={entryId(entry)} kind="ordered" count={entry.count} />;
            }
            if (entry.kind === "detected-header") {
              return <SectionHeader key={entryId(entry)} kind="detected" count={entry.count} />;
            }
            if (entry.kind === "ordered-hint") {
              return <OrderedHint key={entryId(entry)} />;
            }
            const isNew = entry.kind === "detected-row" && newItemIds.has(entry.item.id);
            const addedByName = memberNameById.get(entry.item.addedBy) ?? null;
            return (
              <SortableRow
                key={entryId(entry)}
                entry={entry}
                isNew={isNew}
                addedByName={addedByName}
                onMenu={() => onRowMenu(entry)}
                onPressBody={() => openSpotify(entry.item)}
              />
            );
          })}
        </SortableContext>
      </DndContext>
    </ScrollView>
  );
}

function openSpotify(item: Item) {
  const meta = item.metadata as { spotifyAlbumUrl?: string };
  const url = meta.spotifyAlbumUrl;
  if (!url) return;
  Linking.openURL(url).catch(() => {
    /* best effort — popup blocker / unsupported scheme is non-fatal */
  });
}

interface SortableRowProps {
  entry: Extract<ShelfEntry, { kind: "ordered-row" | "detected-row" }>;
  isNew: boolean;
  addedByName: string | null;
  onMenu: () => void;
  onPressBody: () => void;
}

function SortableRow({ entry, isNew, addedByName, onMenu, onPressBody }: SortableRowProps) {
  const id = entryId(entry);
  const { setNodeRef, transform, transition, listeners, attributes, isDragging } = useSortable({
    id,
  });

  // dnd-kit emits CSS transforms; on react-native-web that becomes a
  // `transform` style on the underlying div. We apply it via the platform-
  // specific style escape hatch (cast because RN's ViewStyle doesn't
  // include arbitrary CSS strings).
  const webStyle = {
    transform: CSS.Transform.toString(transform) ?? undefined,
    transition: transition ?? undefined,
    touchAction: "none",
  } as unknown as object;

  // Bind dnd-kit listeners to the drag handle only; the rest of the card
  // stays clickable (menu button, body click → Spotify).
  const dragHandle = (
    <View
      // RN's <View> on web is a div, so spreading DOM listeners + ARIA
      // attrs onto it works.
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
