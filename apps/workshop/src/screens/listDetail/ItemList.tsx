// Native (iOS / Android) list-detail row container.
//
// Every open row reorders by long-press (2.7), on every list. The library
// (`react-native-reorderable-list`) can only reorder inside one list's `data`,
// so on a ranking list Ranked and open rows share one list:
//
// - Ranked non-empty: `[...ranked, ...open]`; the boundary is implicit (a row
//   lands Ranked when it is at the top or directly beneath a ranked row).
// - Ranked empty: `[slot, ...open]`, where `slot` is a constant-height
//   "Ranked" drop cell (2.8): a row dropped onto it or right beneath it ranks.
//
// `resolveDrop` (listOps.ts, shared with web) turns `{from, to}` into the
// neighbour-relative move. Section headers stay OUT of the data except that
// one slot cell (a header row inside the list once desynced the library's
// per-cell layout); the open block's header decorates its first cell.

import type { Item } from "@workshop/shared";
import { PullToRefresh, REORDER_AUTOSCROLL, tokens } from "@workshop/ui";
import * as Haptics from "expo-haptics";
import { memo, useCallback, useMemo } from "react";
import { type ListRenderItemInfo, StyleSheet } from "react-native";
import Animated, { FadeIn, FadeOut, useReducedMotion } from "react-native-reanimated";
import {
  NestedReorderableList,
  type ReorderableListReorderEvent,
  ScrollViewContainer,
  useIsActive,
  useReorderableDrag,
} from "react-native-reorderable-list";
import { ItemRow, RankedDropZone, SectionHeader } from "./ItemRow";
import { type DragEntry, resolveDrop } from "./listOps";
import type { ItemListProps } from "./listProps";
import { baseRowProps } from "./rowProps";

const SLOT_ID = "__ranked-slot__";
type Cell =
  | { kind: "slot"; id: string }
  | { kind: "row"; item: Item; section: "ordered" | "unordered" };

export function ItemList(props: ItemListProps) {
  const {
    ordered,
    unordered,
    completed,
    listItemKind,
    rankingOn,
    openReorderable,
    copy,
    doneCollapsed,
    doneCollapsible,
    onToggleDone,
    onDrop,
    refreshing,
    onRefresh,
  } = props;
  const reduceMotion = useReducedMotion();

  const cells = useMemo<Cell[]>(() => {
    const open = unordered.map((item) => ({
      kind: "row" as const,
      item,
      section: "unordered" as const,
    }));
    if (!rankingOn) return open;
    if (ordered.length === 0) return [{ kind: "slot" as const, id: SLOT_ID }, ...open];
    return [
      ...ordered.map((item) => ({ kind: "row" as const, item, section: "ordered" as const })),
      ...open,
    ];
  }, [ordered, unordered, rankingOn]);

  const entries = useMemo<DragEntry[]>(
    () =>
      cells.map((c) =>
        c.kind === "slot" ? c : { kind: "row" as const, id: c.item.id, section: c.section },
      ),
    [cells],
  );

  const handleReorder = useCallback(
    ({ from, to }: ReorderableListReorderEvent) => {
      const drop = resolveDrop(entries, from, to, { openReorderable });
      if (drop) onDrop(drop);
    },
    [entries, onDrop, openReorderable],
  );

  const sectionCount =
    (ordered.length > 0 ? 1 : 0) + (unordered.length > 0 ? 1 : 0) + (completed.length > 0 ? 1 : 0);
  const showHeaders = sectionCount > 1;
  const firstOpenIndex = cells.findIndex((c) => c.kind === "row" && c.section === "unordered");

  const renderCell = useCallback(
    ({ item: cell, index }: ListRenderItemInfo<Cell>) => {
      if (cell.kind === "slot") return <RankedDropZone active={false} />;
      return (
        <DraggableRow
          rowProps={baseRowProps(props, cell.item, cell.section)}
          openHeader={
            index === firstOpenIndex && showHeaders && ordered.length > 0 ? (
              <SectionHeader
                kind="unordered"
                count={unordered.length}
                listItemKind={listItemKind}
                doneWord={copy.done}
              />
            ) : null
          }
        />
      );
    },
    [props, firstOpenIndex, showHeaders, ordered.length, unordered.length, listItemKind, copy.done],
  );

  const completedToRender = doneCollapsed ? [] : completed;
  const entering = reduceMotion ? undefined : FadeIn.duration(tokens.motion.base);
  const exiting = reduceMotion ? undefined : FadeOut.duration(tokens.motion.fast);

  return (
    <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
      <ScrollViewContainer contentContainerStyle={styles.listContent} testID="list-detail-list">
        {ordered.length > 0 && showHeaders ? (
          <SectionHeader
            kind="ordered"
            count={ordered.length}
            listItemKind={listItemKind}
            doneWord={copy.done}
          />
        ) : null}
        <NestedReorderableList
          data={cells}
          keyExtractor={keyExtractor}
          renderItem={renderCell}
          onReorder={handleReorder}
          scrollable={false}
          autoscrollThreshold={REORDER_AUTOSCROLL.threshold}
          autoscrollSpeedScale={REORDER_AUTOSCROLL.speedScale}
          shouldUpdateActiveItem
        />

        {completed.length > 0 && (showHeaders || doneCollapsible) ? (
          <SectionHeader
            kind="completed"
            count={completed.length}
            listItemKind={listItemKind}
            doneWord={copy.done}
            collapsible={
              doneCollapsible ? { collapsed: doneCollapsed, onToggle: onToggleDone } : undefined
            }
          />
        ) : null}
        {completedToRender.map((item) => (
          <Animated.View key={item.id} entering={entering} exiting={exiting}>
            <ItemRow {...baseRowProps(props, item, "completed")} isDragging={false} />
          </Animated.View>
        ))}
      </ScrollViewContainer>
    </PullToRefresh>
  );
}

function keyExtractor(cell: Cell): string {
  return cell.kind === "slot" ? cell.id : cell.item.id;
}

// One draggable cell. Long-press on the body lifts the row with a haptic.
const DraggableRow = memo(function DraggableRow({
  rowProps,
  openHeader,
}: {
  rowProps: ReturnType<typeof baseRowProps>;
  openHeader: React.ReactNode;
}) {
  const drag = useReorderableDrag();
  const isActive = useIsActive();
  const onLongPressBody = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {
      /* haptics unavailable on simulator — non-fatal */
    });
    drag();
  }, [drag]);
  return (
    <>
      {openHeader}
      <ItemRow {...rowProps} isDragging={isActive} onLongPressBody={onLongPressBody} />
    </>
  );
});

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.xxl * 2,
  },
});
