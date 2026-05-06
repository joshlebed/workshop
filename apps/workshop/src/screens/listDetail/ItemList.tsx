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

import type { Item } from "@workshop/shared";
import * as Haptics from "expo-haptics";
import { memo, useCallback } from "react";
import { type ListRenderItemInfo, Pressable, StyleSheet } from "react-native";
import {
  NestedReorderableList,
  type ReorderableListReorderEvent,
  ScrollViewContainer,
  useIsActive,
  useReorderableDrag,
} from "react-native-reorderable-list";
import { Text, tokens } from "../../ui/index";
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
  onReorderOrdered,
  onRowMenu,
  onRowPressBody,
}: ItemListProps) {
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
        indexLabel={String(index + 1)}
        addedByName={memberNameById.get(item.addedBy) ?? null}
        onMenu={() => onRowMenu(item, "ordered")}
        onPressBody={() => onRowPressBody(item, "ordered")}
      />
    ),
    [memberNameById, onRowMenu, onRowPressBody],
  );

  return (
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
              indexLabel="•"
              isNew={newItemIds.has(item.id)}
              isDragging={false}
              addedByName={memberNameById.get(item.addedBy) ?? null}
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
              indexLabel="✓"
              isNew={false}
              isDragging={false}
              addedByName={memberNameById.get(item.addedBy) ?? null}
              onMenu={() => onRowMenu(item, "completed")}
              onPressBody={() => onRowPressBody(item, "completed")}
            />
          ))}
        </>
      ) : null}
    </ScrollViewContainer>
  );
}

function keyExtractor(item: Item): string {
  return item.id;
}

interface DraggableOrderedRowProps {
  item: Item;
  indexLabel: string;
  addedByName: string | null;
  onMenu: () => void;
  onPressBody: () => void;
}

const DraggableOrderedRow = memo(function DraggableOrderedRow({
  item,
  indexLabel,
  addedByName,
  onMenu,
  onPressBody,
}: DraggableOrderedRowProps) {
  const drag = useReorderableDrag();
  const isActive = useIsActive();

  const onHandleLongPress = useCallback(() => {
    Haptics.selectionAsync().catch(() => {
      /* haptics unavailable on simulator — non-fatal */
    });
    drag();
  }, [drag]);

  const dragHandle = (
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
  );

  return (
    <ItemRow
      item={item}
      section="ordered"
      indexLabel={indexLabel}
      isNew={false}
      isDragging={isActive}
      addedByName={addedByName}
      onMenu={onMenu}
      onPressBody={onPressBody}
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
});
