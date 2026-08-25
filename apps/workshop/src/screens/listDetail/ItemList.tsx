// Native (iOS / Android) list-detail row container.
//
// Drag-to-reorder AND drag-to-promote share one `react-native-reorderable-list`
// whenever ranking is on and there's a ranked block: its data is
// `[...ordered, ...unordered]`, so a long-press drag can reorder within the
// ranked section, promote an unranked row up into it, or demote a ranked row
// back down — the same cross-section drag the web side already supports. The
// library can't move an item between two separate lists, so combining them is
// the only way; `resolveCombinedReorder` turns the library's `{from,to}` into
// the neighbor-relative `POST /v1/items/:id/move` the server understands.
//
// Section headers stay OUT of the reorderable *data* (a header row inside the
// list desyncs the library's per-cell layout — it could render below its rows).
// The "Ranked" header is plain markup above the list; the "Ideas" header is
// rendered as decoration on the first unranked cell (it isn't a draggable data
// row, so the desync can't happen). When the ranked block is empty there's
// nothing to drop into, so we fall back to the hint + menu-driven promote.
//
// Reorder activation: long-press anywhere on a row's *body* (not the position
// chip) calls `useReorderableDrag()`. The body Pressable fires `onLongPress`
// after 250ms (matched on the web side via dnd-kit's `TouchSensor` `delay`).

import type { Item, ItemKind } from "@workshop/shared";
import { hasModule } from "@workshop/shared/modules";
import { tokens } from "@workshop/ui";
import * as Haptics from "expo-haptics";
import { memo, type ReactNode, useCallback, useMemo, useState } from "react";
import { type ListRenderItemInfo, StyleSheet, View } from "react-native";
import {
  NestedReorderableList,
  type ReorderableListReorderEvent,
  ScrollViewContainer,
  useIsActive,
  useReorderableDrag,
} from "react-native-reorderable-list";
import { PullToRefresh } from "../../components/PullToRefresh";
import { REORDER_AUTOSCROLL } from "../../lib/reorderAutoscroll";
import { resolveCombinedReorder } from "./combinedReorder";
import { COMPLETED_COLLAPSE_THRESHOLD } from "./completedSection";
import { ItemRow, OrderedHint, SectionHeader } from "./ItemRow";
import type { ItemListProps } from "./listProps";

export function ItemList({
  ordered,
  unordered,
  completed,
  listItemKind,
  modules,
  isAlbumShelf,
  showOrderedHint,
  newItemIds,
  memberNameById,
  showProvenance,
  selfId,
  letterboxdBadgeByItem,
  accent,
  onMoveItemRelative,
  onRowMenu,
  onRowPressBody,
  onUncompleteItem,
  resolveRowPressCover,
  refreshing,
  onRefresh,
}: ItemListProps) {
  const rankingOn = hasModule(modules, "ranking");
  // Completed section auto-collapses past the threshold so the active part of
  // the list (ranked + unordered) stays in view. Tap the header to expand.
  // The toggle below the threshold is a no-op (the section is always shown),
  // so the affordance only appears when there's actually something to hide.
  const [completedCollapsed, setCompletedCollapsed] = useState(
    completed.length > COMPLETED_COLLAPSE_THRESHOLD,
  );
  const showCompletedToggle = completed.length > COMPLETED_COLLAPSE_THRESHOLD;
  const completedToRender = showCompletedToggle && completedCollapsed ? [] : completed;
  // Single-section lists drop their section header — the section IS the list.
  // Completed keeps its header when collapsible since the header hosts the
  // show/hide toggle.
  const visibleSectionCount =
    (ordered.length > 0 ? 1 : 0) + (unordered.length > 0 ? 1 : 0) + (completed.length > 0 ? 1 : 0);
  const showMultiSectionHeaders = visibleSectionCount > 1;
  // Resolve provenance attribution: shows the adder's name when collaboration
  // is enabled AND the adder isn't the viewer. The "added by you · 1m" line on
  // every row of a single-active-collaborator list reads as noise; suppressing
  // for self collapses the chrome down to just the rows your collaborators
  // contributed.
  const resolveAddedByName = useCallback(
    (item: Item): string | null => {
      if (!showProvenance) return null;
      if (selfId && item.addedBy === selfId) return null;
      return memberNameById.get(item.addedBy) ?? null;
    },
    [showProvenance, selfId, memberNameById],
  );

  // Letterboxd-match lists replace the per-row "Added by …" line with the
  // overlap badge ("On 3 watchlists · …"). `undefined` lets the row fall back
  // to the default provenance.
  const resolveProvenanceOverride = useCallback(
    (item: Item): string | undefined => letterboxdBadgeByItem?.get(item.id),
    [letterboxdBadgeByItem],
  );

  // Cross-section drag needs ranked + unranked rows in ONE reorderable list.
  // Only worthwhile when ranking is on AND there's a ranked block to drop into;
  // an empty ranked section keeps the hint + menu-driven promote (there's no
  // ranked region to drag into yet).
  const orderedCount = ordered.length;
  const useCombined = rankingOn && orderedCount > 0;
  const combinedData = useMemo(
    () => (useCombined ? [...ordered, ...unordered] : ordered),
    [useCombined, ordered, unordered],
  );

  const handleCombinedReorder = useCallback(
    ({ from, to }: ReorderableListReorderEvent) => {
      const move = resolveCombinedReorder(combinedData, orderedCount, from, to);
      if (move) onMoveItemRelative(move);
    },
    [combinedData, orderedCount, onMoveItemRelative],
  );

  const renderCombinedItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Item>) => {
      const isOrdered = index < orderedCount;
      const section = isOrdered ? "ordered" : "unordered";
      return (
        <DraggableRow
          item={item}
          section={section}
          rank={isOrdered ? index + 1 : null}
          isNew={!isOrdered && newItemIds.has(item.id)}
          // The "Ideas" header rides on the first unranked cell — decoration on
          // a real row, never a draggable data row (which would desync).
          ideasHeaderCount={
            !isOrdered && index === orderedCount && showMultiSectionHeaders
              ? unordered.length
              : null
          }
          listItemKind={listItemKind}
          addedByName={resolveAddedByName(item)}
          provenanceOverride={resolveProvenanceOverride(item)}
          accent={accent}
          onMenu={() => onRowMenu(item, section)}
          onPressBody={() => onRowPressBody(item, section)}
          onPressCover={resolveRowPressCover?.(item, section) ?? undefined}
        />
      );
    },
    [
      orderedCount,
      newItemIds,
      showMultiSectionHeaders,
      unordered.length,
      listItemKind,
      resolveAddedByName,
      resolveProvenanceOverride,
      accent,
      onRowMenu,
      onRowPressBody,
      resolveRowPressCover,
    ],
  );

  return (
    <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
      <ScrollViewContainer contentContainerStyle={styles.listContent} testID="list-detail-list">
        {useCombined ? (
          <>
            {showMultiSectionHeaders ? (
              <SectionHeader kind="ordered" count={ordered.length} listItemKind={listItemKind} />
            ) : null}
            <NestedReorderableList
              data={combinedData}
              keyExtractor={keyExtractor}
              renderItem={renderCombinedItem}
              onReorder={handleCombinedReorder}
              scrollable={false}
              autoscrollThreshold={REORDER_AUTOSCROLL.threshold}
              autoscrollSpeedScale={REORDER_AUTOSCROLL.speedScale}
              shouldUpdateActiveItem
            />
          </>
        ) : (
          <>
            {showOrderedHint ? <OrderedHint isAlbumShelf={isAlbumShelf} /> : null}

            {unordered.length > 0 ? (
              <>
                {showMultiSectionHeaders ? (
                  <SectionHeader
                    kind="unordered"
                    count={unordered.length}
                    listItemKind={listItemKind}
                  />
                ) : null}
                {unordered.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    section="unordered"
                    isNew={newItemIds.has(item.id)}
                    isDragging={false}
                    addedByName={resolveAddedByName(item)}
                    provenanceOverride={resolveProvenanceOverride(item)}
                    accent={accent}
                    onMenu={() => onRowMenu(item, "unordered")}
                    onPressBody={() => onRowPressBody(item, "unordered")}
                    onPressCover={resolveRowPressCover?.(item, "unordered") ?? undefined}
                  />
                ))}
              </>
            ) : null}
          </>
        )}

        {completed.length > 0 ? (
          <>
            {showMultiSectionHeaders || showCompletedToggle ? (
              <SectionHeader
                kind="completed"
                count={completed.length}
                listItemKind={listItemKind}
                collapsible={
                  showCompletedToggle
                    ? {
                        collapsed: completedCollapsed,
                        onToggle: () => setCompletedCollapsed((c) => !c),
                      }
                    : undefined
                }
              />
            ) : null}
            {completedToRender.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                section="completed"
                isNew={false}
                isDragging={false}
                addedByName={resolveAddedByName(item)}
                provenanceOverride={resolveProvenanceOverride(item)}
                accent={accent}
                onMenu={() => onRowMenu(item, "completed")}
                onPressBody={() => onRowPressBody(item, "completed")}
                onTapCompleted={
                  item.kind !== "spotify_album" ? () => onUncompleteItem(item) : undefined
                }
                onPressCover={resolveRowPressCover?.(item, "completed") ?? undefined}
              />
            ))}
          </>
        ) : null}
      </ScrollViewContainer>
    </PullToRefresh>
  );
}

function keyExtractor(item: Item): string {
  return item.id;
}

interface DraggableRowProps {
  item: Item;
  section: "ordered" | "unordered";
  /** 1-indexed rank for ranked rows; `null` renders the ≡ drag glyph instead. */
  rank: number | null;
  isNew: boolean;
  /** When set, renders the "Ideas" section header above this row (count value). */
  ideasHeaderCount: number | null;
  listItemKind: ItemKind | null;
  addedByName: string | null;
  provenanceOverride?: string;
  accent: string;
  onMenu: () => void;
  onPressBody: () => void;
  onPressCover?: () => void;
}

// One draggable cell for the combined list. Long-press anywhere on the body
// (handled by ItemRow's `onLongPressBody`) starts the drag; ranked rows show
// their rank, unranked rows show the ≡ glyph so the drag affordance is visible.
const DraggableRow = memo(function DraggableRow({
  item,
  section,
  rank,
  isNew,
  ideasHeaderCount,
  listItemKind,
  addedByName,
  provenanceOverride,
  accent,
  onMenu,
  onPressBody,
  onPressCover,
}: DraggableRowProps) {
  const drag = useReorderableDrag();
  const isActive = useIsActive();

  const onLongPressBody = useCallback(() => {
    Haptics.selectionAsync().catch(() => {
      /* haptics unavailable on simulator — non-fatal */
    });
    drag();
  }, [drag]);

  // The position chip is a visual affordance only — the whole row body is the
  // long-press target, matching the web side and iOS edit-mode lists.
  const dragHandle = (child: ReactNode) => <View style={styles.dragChip}>{child}</View>;

  return (
    <>
      {ideasHeaderCount !== null ? (
        <SectionHeader kind="unordered" count={ideasHeaderCount} listItemKind={listItemKind} />
      ) : null}
      <ItemRow
        item={item}
        section={section}
        rank={rank ?? undefined}
        isNew={isNew}
        isDragging={isActive}
        addedByName={addedByName}
        provenanceOverride={provenanceOverride}
        accent={accent}
        onMenu={onMenu}
        onPressBody={onPressBody}
        onPressCover={onPressCover}
        onLongPressBody={onLongPressBody}
        dragHandle={dragHandle}
      />
    </>
  );
});

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.xxl * 2,
  },
  dragChip: {
    alignItems: "center",
    justifyContent: "center",
  },
});
