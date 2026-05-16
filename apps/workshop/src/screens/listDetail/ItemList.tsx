// Native (iOS / Android) list-detail row container.
//
// Section headers and the ordered hint are plain markup outside any
// sortable container — keeping them out of the reorderable data avoids
// react-native-reorderable-list's per-cell layout state from desyncing
// when an item crosses sections (the symptom that motivated this rewrite:
// after a drag the section header could end up rendered below its rows).
//
// Drag-to-reorder is scoped to the ordered section only. Cross-section
// transitions (promote / demote / mark complete) go through the kebab
// menu, which has had explicit actions for those moves since the
// 2026-05 ordering refactor.
//
// Reorder activation: long-press anywhere on an ordered row's *body*
// (not the position chip) calls `useReorderableDrag()`. The body Pressable
// fires `onLongPress` after 250ms (matched on the web side via dnd-kit's
// `TouchSensor` `delay`), so the activation feel is the same on both
// platforms even though the underlying libraries are different.

import type { Item } from "@workshop/shared";
import * as Haptics from "expo-haptics";
import { memo, type ReactNode, useCallback } from "react";
import { type ListRenderItemInfo, StyleSheet, View } from "react-native";
import {
  NestedReorderableList,
  type ReorderableListReorderEvent,
  ScrollViewContainer,
  useIsActive,
  useReorderableDrag,
} from "react-native-reorderable-list";
import { PullToRefresh } from "../../components/PullToRefresh";
import { tokens } from "../../ui/index";
import { ItemRow, OrderedHint, SectionHeader } from "./ItemRow";
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
  selfId,
  accent,
  onReorderOrdered,
  onRowMenu,
  onRowPressBody,
  onUncompleteItem,
  resolveRowPressCover,
  refreshing,
  onRefresh,
}: ItemListProps) {
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

  const handleOrderedReorder = useCallback(
    ({ from, to }: ReorderableListReorderEvent) => {
      onReorderOrdered({ fromIndex: from, toIndex: to });
    },
    [onReorderOrdered],
  );

  const renderOrderedItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Item>) => (
      <DraggableOrderedRow
        item={item}
        rank={index + 1}
        addedByName={resolveAddedByName(item)}
        accent={accent}
        onMenu={() => onRowMenu(item, "ordered")}
        onPressBody={() => onRowPressBody(item, "ordered")}
        onPressCover={resolveRowPressCover?.(item, "ordered") ?? undefined}
      />
    ),
    [resolveAddedByName, accent, onRowMenu, onRowPressBody, resolveRowPressCover],
  );

  return (
    <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
      <ScrollViewContainer contentContainerStyle={styles.listContent} testID="list-detail-list">
        {ordered.length > 0 ? (
          <>
            <SectionHeader kind="ordered" count={ordered.length} />
            <NestedReorderableList
              data={ordered}
              keyExtractor={keyExtractor}
              renderItem={renderOrderedItem}
              onReorder={handleOrderedReorder}
              scrollable={false}
              autoscrollThreshold={0.15}
              autoscrollSpeedScale={1}
              shouldUpdateActiveItem
            />
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
                isNew={newItemIds.has(item.id)}
                isDragging={false}
                addedByName={resolveAddedByName(item)}
                accent={accent}
                onMenu={() => onRowMenu(item, "unordered")}
                onPressBody={() => onRowPressBody(item, "unordered")}
                onPressCover={resolveRowPressCover?.(item, "unordered") ?? undefined}
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
                addedByName={resolveAddedByName(item)}
                accent={accent}
                onMenu={() => onRowMenu(item, "completed")}
                onPressBody={() => onRowPressBody(item, "completed")}
                onTapCompleted={
                  item.type !== "album_shelf" ? () => onUncompleteItem(item) : undefined
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

interface DraggableOrderedRowProps {
  item: Item;
  rank: number;
  addedByName: string | null;
  accent: string;
  onMenu: () => void;
  onPressBody: () => void;
  onPressCover?: () => void;
}

const DraggableOrderedRow = memo(function DraggableOrderedRow({
  item,
  rank,
  addedByName,
  accent,
  onMenu,
  onPressBody,
  onPressCover,
}: DraggableOrderedRowProps) {
  const drag = useReorderableDrag();
  const isActive = useIsActive();

  const onLongPressBody = useCallback(() => {
    Haptics.selectionAsync().catch(() => {
      /* haptics unavailable on simulator — non-fatal */
    });
    drag();
  }, [drag]);

  // The position chip is still rendered as a visual drag affordance but no
  // longer hosts the activation gesture — the whole row body is now the
  // long-press target, matching the web side and what users expect from
  // iOS edit-mode lists.
  const dragHandle = (child: ReactNode) => <View style={styles.dragChip}>{child}</View>;

  return (
    <ItemRow
      item={item}
      section="ordered"
      rank={rank}
      isNew={false}
      isDragging={isActive}
      addedByName={addedByName}
      accent={accent}
      onMenu={onMenu}
      onPressBody={onPressBody}
      onPressCover={onPressCover}
      onLongPressBody={onLongPressBody}
      dragHandle={dragHandle}
    />
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
