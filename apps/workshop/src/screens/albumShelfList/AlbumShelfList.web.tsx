// Web album-shelf list. Two `SortableContext`s (one per section) inside a
// single `DndContext`, with section headers + ordered-hint rendered as
// plain markup between them.
//
// Why per-section contexts: `verticalListSortingStrategy` translates
// non-active sortable siblings to make space for the dragged item. It
// uses each item's `getBoundingClientRect`, but ASSUMES items are
// contiguous in the layout. With section headers interleaved between
// sortable rows, the strategy's `arrayMove(rects, …)` shifts rows across
// header gaps — e.g. dragging an ordered row toward the detected band
// pulls the first detected row up by ord-row-height + header-height,
// visually colliding with the DETECTED header. PR #125 took headers out
// of `SortableContext.items` to stop them from animating, but the
// remaining sortable rows still shifted across the header gaps.
// Splitting into per-section contexts contains each strategy to its own
// contiguous run of rows; cross-section drag still works because the
// outer DndContext sees both `active` and `over` regardless of which
// inner SortableContext owns them.
//
// Cross-section drop: when the user releases over a row in the OTHER
// section, `over.id` resolves to that row in the full entries array, and
// `resolveReorder` figures out the section change + position math.

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
import type { Item } from "@workshop/shared";
import { useCallback, useMemo, useRef } from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import { Text, tokens } from "../../ui/index";
import { AlbumShelfRow, OrderedHint, rowStyles, SectionHeader } from "./AlbumShelfRow";
import type { ShelfListProps } from "./shelfListProps";
import { entryId, type ShelfEntry } from "./types";

/**
 * Custom dnd-kit modifier that clamps the active row's vertical movement
 * to be no higher than the top of the first row in the list (i.e. just
 * below the ORDERED section header) and no lower than the bottom of the
 * last row (just above the bottom padding). Without this clamp,
 * `restrictToFirstScrollableAncestor` only stops at the scroll
 * container's bounds — the section headers live INSIDE the ScrollView,
 * so the active row can be visually translated above the ORDERED header.
 */
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

  // Pre-compute section partitions so each SortableContext sees only its
  // own rows. The full `entries` array stays in scope for resolveReorder
  // (it needs to know about headers to detect cross-section drops).
  const orderedRows = useMemo(
    () =>
      entries.filter(
        (e): e is Extract<ShelfEntry, { kind: "ordered-row" }> => e.kind === "ordered-row",
      ),
    [entries],
  );
  const detectedRows = useMemo(
    () =>
      entries.filter(
        (e): e is Extract<ShelfEntry, { kind: "detected-row" }> => e.kind === "detected-row",
      ),
    [entries],
  );
  const orderedIds = useMemo(() => orderedRows.map((r) => entryId(r)), [orderedRows]);
  const detectedIds = useMemo(() => detectedRows.map((r) => entryId(r)), [detectedRows]);
  const orderedHeader = entries.find((e) => e.kind === "ordered-header");
  const detectedHeader = entries.find((e) => e.kind === "detected-header");
  const showHint = entries.some((e) => e.kind === "ordered-hint");

  // Wraps the rows area (everything between the headers — including
  // section headers and the hint between them, but NOT the section
  // headers at the very top/bottom). The custom modifier clamps the
  // dragged row's transform to within this area's bounding rect.
  const rowsAreaRef = useRef<View>(null);
  const rowsAreaModifier = useMemo(() => makeRowsAreaModifier(rowsAreaRef), []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = entries.findIndex((e) => entryId(e) === active.id);
      const overIdx = entries.findIndex((e) => entryId(e) === over.id);
      if (from < 0 || overIdx < 0) return;
      // dnd-kit's standard sortable mapping is the same `arrayMove(items,
      // oldIndex, newIndex)` semantics that resolveReorder expects. With
      // per-section SortableContexts, dnd-kit reports `over` as the row
      // currently under the cursor regardless of which section it's in,
      // so cross-section drops "just work" — resolveReorder reads the
      // post-splice section by walking back to the nearest header.
      onReorder({ from, to: overIdx });
    },
    [entries, onReorder],
  );

  return (
    <ScrollView contentContainerStyle={styles.listContent} testID="album-shelf-list">
      <DndContext
        sensors={sensors}
        onDragEnd={handleDragEnd}
        collisionDetection={closestCenter}
        // Clamp the active row's vertical translation to within the rows
        // area (everything strictly between the top ORDERED header and
        // the bottom padding). Without this, dragging up far enough
        // pulls the row above the ORDERED header — confusing because
        // that's not a valid drop slot. Cross-section drag (ordered ↔
        // detected) still works because the rows area spans both
        // sections, including the in-between DETECTED header.
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
                  onPressBody={() => openSpotify(row.item)}
                />
              ))}
            </SortableContext>
          ) : null}
          {showHint ? <OrderedHint /> : null}
          {detectedHeader ? <SectionHeader kind="detected" count={detectedHeader.count} /> : null}
          {detectedRows.length > 0 ? (
            <SortableContext items={detectedIds} strategy={verticalListSortingStrategy}>
              {detectedRows.map((row) => (
                <SortableRowEntry
                  key={entryId(row)}
                  entry={row}
                  isNew={newItemIds.has(row.item.id)}
                  addedByName={memberNameById.get(row.item.addedBy) ?? null}
                  onMenu={() => onRowMenu(row)}
                  onPressBody={() => openSpotify(row.item)}
                />
              ))}
            </SortableContext>
          ) : null}
        </View>
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

interface SortableRowEntryProps {
  entry: Extract<ShelfEntry, { kind: "ordered-row" | "detected-row" }>;
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
