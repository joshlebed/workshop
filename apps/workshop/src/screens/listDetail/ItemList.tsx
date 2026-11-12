// Native (iOS / Android) list-detail row container.
//
// One order per list (docs/list-types.md → "Order"): every open row reorders
// by long-press. The library (`react-native-reorderable-list`) can only
// reorder inside one list's `data`, so the list and, on a list with a source,
// the sync inbox share one list:
//
// - `[...list, ...inbox]`; the boundary is implicit (a row lands in the list
//   at the top or directly beneath a list row). The inbox heading decorates
//   its first cell. An inbox row dropped inside the inbox stays put; a list
//   row dropped there lands at the bottom of the list.
// - Nothing placed yet: `[slot, ...inbox]`, where `slot` is a constant-height
//   drop cell: an inbox row dropped onto it or right beneath it starts the list.
//
// `resolveDrop` (listOps.ts, shared with web) turns `{from, to}` into the
// neighbour-relative move. Section headings stay OUT of the data except that
// one slot cell (a header row inside the list once desynced the library's
// per-cell layout).

import type { Item } from "@workshop/shared";
import { listKind } from "@workshop/shared/listKinds";
import {
  haptics,
  layout,
  motionPresets,
  PullToRefresh,
  REORDER_AUTOSCROLL,
  tokens,
  useMotionDuration,
} from "@workshop/ui";
import { memo, useCallback, useMemo } from "react";
import { type ListRenderItemInfo, StyleSheet, View } from "react-native";
import Animated, {
  LayoutAnimationConfig,
  runOnJS,
  useAnimatedScrollHandler,
} from "react-native-reanimated";
import {
  NestedReorderableList,
  type ReorderableListIndexChangeEvent,
  type ReorderableListReorderEvent,
  ScrollViewContainer,
  useIsActive,
  useReorderableDrag,
} from "react-native-reorderable-list";
import { ItemRow, ListDropZone, SectionHeader } from "./ItemRow";
import { type DragEntry, resolveDrop, withArticle } from "./listOps";
import type { ItemListProps } from "./listProps";
import { baseRowProps } from "./rowProps";

const SLOT_ID = "__list-slot__";
type Cell = { kind: "slot"; id: string } | { kind: "row"; item: Item; section: "open" | "inbox" };

export function ItemList(props: ItemListProps) {
  const {
    open,
    inbox,
    completed,
    inboxTitle,
    listEmpty,
    listItemKind,
    copy,
    doneCollapsed,
    doneCollapsible,
    onToggleDone,
    onDrop,
    refreshing,
    onRefresh,
    header,
    placeholder,
    scrollY,
    scrollRef,
  } = props;
  // The drop's slide into place, on the token (the library defaults to 200ms
  // `Easing.out(ease)`); instant under reduced motion.
  const dropDuration = useMotionDuration("base");

  const cells = useMemo<Cell[]>(() => {
    const list = open.map((item) => ({ kind: "row" as const, item, section: "open" as const }));
    const waiting = inbox.map((item) => ({
      kind: "row" as const,
      item,
      section: "inbox" as const,
    }));
    if (listEmpty && waiting.length > 0)
      return [{ kind: "slot" as const, id: SLOT_ID }, ...waiting];
    return [...list, ...waiting];
  }, [open, inbox, listEmpty]);

  const entries = useMemo<DragEntry[]>(
    () =>
      cells.map((c) =>
        c.kind === "slot" ? c : { kind: "row" as const, id: c.item.id, section: c.section },
      ),
    [cells],
  );

  const handleReorder = useCallback(
    ({ from, to }: ReorderableListReorderEvent) => {
      const drop = resolveDrop(entries, from, to);
      if (drop) onDrop(drop);
    },
    [entries, onDrop],
  );

  const firstInboxIndex = cells.findIndex((c) => c.kind === "row" && c.section === "inbox");
  const noun = listKind(listItemKind).noun.one;

  const renderCell = useCallback(
    ({ item: cell, index }: ListRenderItemInfo<Cell>) => {
      if (cell.kind === "slot") {
        return (
          <ListDropZone
            active={false}
            label={`Hold ${withArticle(noun)} and drag it here to start the list`}
          />
        );
      }
      return (
        <DraggableRow
          rowProps={baseRowProps(props, cell.item, cell.section)}
          heading={
            index === firstInboxIndex ? (
              <SectionHeader
                kind="inbox"
                label={inboxTitle}
                count={inbox.length}
                first={index === 0}
              />
            ) : null
          }
        />
      );
    },
    [props, firstInboxIndex, inboxTitle, inbox.length, noun],
  );

  const completedToRender = doneCollapsed ? [] : completed;

  // The pinned bar fades the list name in once the title block scrolls away.
  const scrollHandler = useAnimatedScrollHandler((e) => {
    if (scrollY) scrollY.value = e.contentOffset.y;
  });

  return (
    <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
      <ScrollViewContainer
        ref={scrollRef as never}
        contentContainerStyle={styles.listContent}
        onScroll={scrollHandler}
        testID="list-detail-list"
      >
        {header ? <View style={styles.header}>{header}</View> : null}
        <NestedReorderableList
          data={cells}
          keyExtractor={keyExtractor}
          renderItem={renderCell}
          onReorder={handleReorder}
          scrollable={false}
          autoscrollThreshold={REORDER_AUTOSCROLL.threshold}
          autoscrollSpeedScale={REORDER_AUTOSCROLL.speedScale}
          animationDuration={dropDuration}
          onIndexChange={onIndexChange}
          shouldUpdateActiveItem
        />

        {completed.length > 0 && (cells.length > 0 || doneCollapsible) ? (
          <SectionHeader
            kind="completed"
            label={copy.done}
            count={completed.length}
            collapsible={
              doneCollapsible ? { collapsed: doneCollapsed, onToggle: onToggleDone } : undefined
            }
            first={cells.length === 0}
          />
        ) : null}
        {/* Done rows fade in as they join (a completion, expanding Done) and
            out as they leave; the ones there when the list opens just appear. */}
        <LayoutAnimationConfig skipEntering>
          {completedToRender.map((item) => (
            <Animated.View
              key={item.id}
              entering={motionPresets.enter}
              exiting={motionPresets.exit}
            >
              <ItemRow {...baseRowProps(props, item, "completed")} isDragging={false} />
            </Animated.View>
          ))}
        </LayoutAnimationConfig>
        {placeholder}
      </ScrollViewContainer>
    </PullToRefresh>
  );
}

function keyExtractor(cell: Cell): string {
  return cell.kind === "slot" ? cell.id : cell.item.id;
}

function tickSelection() {
  haptics.selection();
}

// A selection tick for each slot the lifted row crosses (a UI-thread worklet).
function onIndexChange(_event: ReorderableListIndexChangeEvent) {
  "worklet";
  runOnJS(tickSelection)();
}

// One draggable cell. Long-press on the body lifts the row with a selection
// tick, the same one each crossed slot gives.
const DraggableRow = memo(function DraggableRow({
  rowProps,
  heading,
}: {
  rowProps: ReturnType<typeof baseRowProps>;
  heading: React.ReactNode;
}) {
  const drag = useReorderableDrag();
  const isActive = useIsActive();
  const onLongPressBody = useCallback(() => {
    haptics.selection();
    drag();
  }, [drag]);
  return (
    <>
      {heading}
      <ItemRow {...rowProps} isDragging={isActive} onLongPressBody={onLongPressBody} />
    </>
  );
});

const styles = StyleSheet.create({
  // The header blocks carry their own gutter.
  header: { marginHorizontal: -layout.gutter },
  listContent: {
    paddingHorizontal: layout.gutter,
    paddingTop: tokens.space.sm,
    paddingBottom: layout.bottomInset,
  },
});
