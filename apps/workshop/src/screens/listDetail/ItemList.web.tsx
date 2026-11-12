// Web list-detail row container (@dnd-kit).
//
// Every open row is draggable, on every list (2.7). On a ranking list the
// Ranked rows, a boundary marker and the open rows form ONE sortable list, so
// a drag can reorder inside either block or cross the boundary in both
// directions (2.8); `resolveDrop` (listOps.ts) turns the result into the
// neighbour-relative move. While Ranked is empty, a "Ranked" drop target
// appears above the list for the length of the drag. Done rows never drag.
//
// Activation (shared `REORDER_ACTIVATION`): mouse after 10px of travel, touch
// after a 500ms hold with 8px tolerance, so a tap still opens the row and a
// swipe still scrolls. A drag handle shows in the left gutter on hover/focus.

import {
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Item } from "@workshop/shared";
import {
  easeOutCss,
  Icon,
  motionPresets,
  PullToRefresh,
  layout as pageLayout,
  REORDER_ACTIVATION,
  screenColumnStyle,
  tokens,
  useMotionDuration,
} from "@workshop/ui";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View, type ViewInstance } from "react-native";
import Animated, { LayoutAnimationConfig, useReducedMotion } from "react-native-reanimated";
import { ItemRow, RankedDropZone, SectionHeader } from "./ItemRow";
import type { DragEntry } from "./listOps";
import { resolveDrop } from "./listOps";
import type { ItemListProps } from "./listProps";
import { baseRowProps } from "./rowProps";

const DIVIDER_ID = "__ranked-divider__";
const RANKED_DROP_ID = "__ranked-drop__";

// The empty-Ranked target wins whenever the pointer is inside it (it floats
// over the first rows); everywhere else, rows sort by closest center.
const collisionDetection: CollisionDetection = (args) => {
  const onTarget = pointerWithin(args).filter((c) => c.id === RANKED_DROP_ID);
  return onTarget.length > 0 ? onTarget : closestCenter(args);
};

export function ItemList(props: ItemListProps) {
  const {
    ordered,
    unordered,
    completed,
    listItemKind,
    rankingOn,
    openReorderable,
    scrollToItemId,
    copy,
    doneCollapsed,
    doneCollapsible,
    onToggleDone,
    onDrop,
    refreshing,
    onRefresh,
  } = props;
  const reduceMotion = useReducedMotion();

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: REORDER_ACTIVATION.mouseDistancePx },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: REORDER_ACTIVATION.longPressMs,
        tolerance: REORDER_ACTIVATION.touchTolerancePx,
      },
    }),
  );

  const entries = useMemo<DragEntry[]>(() => {
    const open = unordered.map((it) => ({
      kind: "row" as const,
      id: it.id,
      section: "unordered" as const,
    }));
    // No visible ranked rows (none yet, or a filter hides them): no boundary
    // to drop across, so no marker; ranking goes through the floating target.
    if (!rankingOn || ordered.length === 0) return open;
    return [
      ...ordered.map((it) => ({ kind: "row" as const, id: it.id, section: "ordered" as const })),
      { kind: "divider" as const, id: DIVIDER_ID },
      ...open,
    ];
  }, [ordered, unordered, rankingOn]);
  const entryIds = useMemo(() => entries.map((e) => e.id), [entries]);
  const itemById = useMemo(() => {
    const m = new Map<string, Item>();
    for (const it of [...ordered, ...unordered]) m.set(it.id, it);
    return m;
  }, [ordered, unordered]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overRankedDrop, setOverRankedDrop] = useState(false);
  // Layout transitions animate rows sliding into place after a complete or a
  // menu move, but must stay off around a drop: dnd-kit already shows the
  // row in its new slot, and a second animation would replay the move.
  const [settling, setSettling] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );
  const settle = useCallback(() => {
    setSettling(true);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    // Past dnd-kit's drop animation (`base`) and the optimistic re-render.
    settleTimer.current = setTimeout(() => setSettling(false), tokens.motion.base * 2);
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setSettling(true);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverRankedDrop(event.over?.id === RANKED_DROP_ID);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      setOverRankedDrop(false);
      settle();
      const { active, over } = event;
      if (!over) return;
      const id = String(active.id);
      if (over.id === RANKED_DROP_ID) {
        onDrop({ itemId: id, section: "ranked", beforeItemId: null, afterItemId: null });
        return;
      }
      const from = entryIds.indexOf(id);
      const to = entryIds.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      const drop = resolveDrop(entries, from, to, { openReorderable });
      if (drop) onDrop(drop);
    },
    [entries, entryIds, onDrop, openReorderable, settle],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setOverRankedDrop(false);
    settle();
  }, [settle]);

  // 2.6: bring the just-added row into view.
  useEffect(() => {
    if (!scrollToItemId || typeof document === "undefined") return;
    const t = setTimeout(() => {
      document
        .querySelector(`[data-testid="item-row-${scrollToItemId}"]`)
        ?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    }, 50);
    return () => clearTimeout(t);
  }, [scrollToItemId, reduceMotion]);

  const dragging = activeId !== null;
  const activeItem = activeId ? (itemById.get(activeId) ?? null) : null;
  const activeSection =
    activeItem && ordered.some((it) => it.id === activeItem.id) ? "ordered" : "unordered";
  const draggingOpenRow = dragging && unordered.some((it) => it.id === activeId);
  const sectionCount =
    (ordered.length > 0 ? 1 : 0) + (unordered.length > 0 ? 1 : 0) + (completed.length > 0 ? 1 : 0);
  const showHeaders = sectionCount > 1;
  const showDoneHeader = completed.length > 0 && (showHeaders || doneCollapsible);
  const completedToRender = doneCollapsed ? [] : completed;

  // Rows fade in (`base`) and out (`fast`) as they join or leave a section
  // (complete, reopen, delete, undo, a filter), and their neighbours slide to
  // close or open the gap (`base`). Reduced motion keeps the fades and drops
  // the slide.
  const layout = reduceMotion || settling ? undefined : motionPresets.move;
  const entering = motionPresets.enter;
  const exiting = motionPresets.exit;

  const renderEntry = (entry: DragEntry) => {
    if (entry.kind !== "row") {
      // The boundary: the open block's header (and, on a demote, the place to
      // drop). Zero-height when there is nothing to label.
      const showOpenHeader =
        (showHeaders && unordered.length > 0) || (dragging && ordered.length > 0);
      return (
        <SortableMarker key={entry.id} id={entry.id}>
          {showOpenHeader ? (
            <SectionHeader
              kind="unordered"
              count={unordered.length}
              listItemKind={listItemKind}
              doneWord={copy.done}
              first={ordered.length === 0}
            />
          ) : null}
        </SortableMarker>
      );
    }
    const item = itemById.get(entry.id);
    if (!item) return null;
    return (
      <Animated.View key={entry.id} layout={layout} entering={entering} exiting={exiting}>
        <SortableRow id={entry.id}>
          <ItemRow
            {...baseRowProps(props, item, entry.section)}
            isDragging={false}
            dragHandle={<Icon name="drag" size={16} tone="muted" />}
          />
        </SortableRow>
      </Animated.View>
    );
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      collisionDetection={collisionDetection}
    >
      <View style={styles.frame}>
        <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
          <ScrollView
            contentContainerStyle={[styles.listContent, screenColumnStyle]}
            testID="list-detail-list"
          >
            {/* Rows already there when the list opens appear at once; only
                rows that join later fade in. */}
            <LayoutAnimationConfig skipEntering>
              {ordered.length > 0 && showHeaders ? (
                <SectionHeader
                  kind="ordered"
                  count={ordered.length}
                  listItemKind={listItemKind}
                  doneWord={copy.done}
                  first
                />
              ) : null}
              <SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
                {entries.map(renderEntry)}
              </SortableContext>

              {showDoneHeader ? (
                <Animated.View layout={layout}>
                  <SectionHeader
                    kind="completed"
                    count={completed.length}
                    listItemKind={listItemKind}
                    doneWord={copy.done}
                    collapsible={
                      doneCollapsible
                        ? { collapsed: doneCollapsed, onToggle: onToggleDone }
                        : undefined
                    }
                    first={ordered.length === 0 && unordered.length === 0}
                  />
                </Animated.View>
              ) : null}
              {completedToRender.map((item) => (
                <Animated.View key={item.id} layout={layout} entering={entering} exiting={exiting}>
                  <ItemRow {...baseRowProps(props, item, "completed")} isDragging={false} />
                </Animated.View>
              ))}
            </LayoutAnimationConfig>
          </ScrollView>
        </PullToRefresh>
        {/* Floats over the top of the list instead of pushing it down, so the
          lifted row stays under the finger and the target is reachable
          without scrolling. */}
        {rankingOn && ordered.length === 0 && draggingOpenRow ? (
          <RankedDrop active={overRankedDrop} />
        ) : null}
        {/* The lifted row follows the pointer in an overlay; its slot in the
            list stays behind as a faint placeholder showing where it lands. */}
        <DragOverlay
          dropAnimation={reduceMotion ? null : { duration: tokens.motion.base, easing: easeOutCss }}
        >
          {activeItem ? (
            // Dimmed over the Ranked target so the highlighted target shows through.
            <View style={overRankedDrop ? styles.overlayOnTarget : undefined}>
              <ItemRow
                {...baseRowProps(props, activeItem, activeSection)}
                isDragging
                dragHandle={<Icon name="drag" size={16} tone="muted" />}
              />
            </View>
          ) : null}
        </DragOverlay>
      </View>
    </DndContext>
  );
}

function RankedDrop({ active }: { active: boolean }) {
  const { setNodeRef } = useDroppable({ id: RANKED_DROP_ID });
  return (
    <View ref={setNodeRef as unknown as React.Ref<ViewInstance>} style={styles.dropOverlay}>
      <RankedDropZone active={active} />
    </View>
  );
}

// Neighbours shuffle aside on the motion tokens while a row is dragged over
// them (dnd-kit's default is 250ms `ease`); none under reduced motion.
function useSortableTransition() {
  const duration = useMotionDuration("base");
  return duration ? { duration, easing: easeOutCss } : null;
}

function SortableMarker({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, transform, transition } = useSortable({
    id,
    disabled: true,
    transition: useSortableTransition(),
  });
  const style = {
    transform: CSS.Translate.toString(transform) ?? undefined,
    transition: transition ?? undefined,
  } as unknown as object;
  return (
    <View ref={setNodeRef as unknown as React.Ref<ViewInstance>} style={style}>
      {children}
    </View>
  );
}

function SortableRow({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, transform, transition, listeners, attributes, isDragging } = useSortable({
    id,
    transition: useSortableTransition(),
  });
  // `touchAction: "pan-y"` lets vertical scroll through until the hold
  // activates; the lifted row sits above its neighbours.
  const style = {
    transform: CSS.Translate.toString(transform) ?? undefined,
    transition: transition ?? undefined,
    touchAction: "pan-y",
    userSelect: "none",
    position: "relative",
    opacity: isDragging ? 0.3 : 1,
  } as unknown as object;
  return (
    <View
      ref={setNodeRef as unknown as React.Ref<ViewInstance>}
      style={style}
      {...((listeners ?? {}) as unknown as Record<string, unknown>)}
      {...(stripButtonRole(attributes) as unknown as Record<string, unknown>)}
    >
      {children}
    </View>
  );
}

// dnd-kit's attributes carry `role="button"` + `tabIndex`; react-native-web
// turns a View with role=button into a <button>, which would nest the row's
// own buttons. Pointer sensors only, so dropping them is safe.
function stripButtonRole(attributes: unknown): Record<string, unknown> {
  if (!attributes || typeof attributes !== "object") return {};
  const { role: _role, tabIndex: _tabIndex, ...rest } = attributes as Record<string, unknown>;
  return rest;
}

const styles = StyleSheet.create({
  frame: { flex: 1, position: "relative" },
  overlayOnTarget: { opacity: 0.75 },
  dropOverlay: {
    position: "absolute",
    top: 0,
    left: pageLayout.gutter,
    right: pageLayout.gutter,
    // Held to the reading column like the rows beneath it (5.7a): with
    // left/right set, a max width and auto margins centre it.
    maxWidth: pageLayout.columnMaxWidth - 2 * pageLayout.gutter,
    marginHorizontal: "auto",
    paddingBottom: tokens.space.sm,
    backgroundColor: tokens.bg.canvas,
    boxShadow: "0px 8px 16px rgba(0, 0, 0, 0.35)",
  },
  listContent: {
    paddingHorizontal: pageLayout.gutter,
    paddingTop: tokens.space.sm,
    paddingBottom: pageLayout.bottomInset,
  },
});
