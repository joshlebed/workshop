// Web list-detail row container (@dnd-kit).
//
// One order per list (docs/list-types.md → "Order"): every open row drags
// anywhere in the list. On a list with a source, the sync inbox ("New from
// Spotify") follows the list under its heading; its rows drag up into the
// list (or join it from the menu), never reorder among themselves, and a list
// row dropped into the inbox lands at the bottom of the list. List rows, the
// inbox heading and inbox rows form ONE sortable list so a drag can cross the
// heading; `resolveDrop` (listOps.ts) turns the result into the
// neighbour-relative move. Done rows never drag.
//
// Activation (shared `REORDER_ACTIVATION`): mouse after 10px of travel, touch
// after a 500ms hold with 8px tolerance, so a tap still opens the row and a
// swipe still scrolls. A drag handle shows in the left gutter on hover/focus.

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Item } from "@workshop/shared";
import { listKind } from "@workshop/shared/listKinds";
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
import { ItemRow, ListDropZone, SectionHeader } from "./ItemRow";
import type { DragEntry } from "./listOps";
import { resolveDrop, withArticle } from "./listOps";
import type { ItemListProps } from "./listProps";
import { baseRowProps } from "./rowProps";

const DIVIDER_ID = "__inbox-divider__";

export function ItemList(props: ItemListProps) {
  const {
    open,
    inbox,
    completed,
    inboxTitle,
    listEmpty,
    listItemKind,
    scrollToItemId,
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
    const list = open.map((it) => ({ kind: "row" as const, id: it.id, section: "open" as const }));
    if (inbox.length === 0) return list;
    return [
      ...list,
      { kind: "divider" as const, id: DIVIDER_ID },
      ...inbox.map((it) => ({ kind: "row" as const, id: it.id, section: "inbox" as const })),
    ];
  }, [open, inbox]);
  const entryIds = useMemo(() => entries.map((e) => e.id), [entries]);
  const itemById = useMemo(() => {
    const m = new Map<string, Item>();
    for (const it of [...open, ...inbox]) m.set(it.id, it);
    return m;
  }, [open, inbox]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overListDrop, setOverListDrop] = useState(false);
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

  // With nothing placed yet, the heading sits first: an inbox row dragged
  // onto it (or above it) starts the list, and the drop cell lights up.
  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      setOverListDrop(listEmpty && event.over?.id === DIVIDER_ID);
    },
    [listEmpty],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      setOverListDrop(false);
      settle();
      const { active, over } = event;
      if (!over) return;
      const id = String(active.id);
      const from = entryIds.indexOf(id);
      const to = entryIds.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      const drop = resolveDrop(entries, from, to);
      if (drop) onDrop(drop);
    },
    [entries, entryIds, onDrop, settle],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setOverListDrop(false);
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

  const activeItem = activeId ? (itemById.get(activeId) ?? null) : null;
  const activeSection =
    activeItem && inbox.some((it) => it.id === activeItem.id) ? "inbox" : "open";
  const completedToRender = doneCollapsed ? [] : completed;
  const noun = listKind(listItemKind).noun.one;

  // Rows fade in (`base`) and out (`fast`) as they join or leave a section
  // (complete, reopen, delete, undo, a filter), and their neighbours slide to
  // close or open the gap (`base`). Reduced motion keeps the fades and drops
  // the slide.
  const layout = reduceMotion || settling ? undefined : motionPresets.move;
  const entering = motionPresets.enter;
  const exiting = motionPresets.exit;

  const renderEntry = (entry: DragEntry) => {
    if (entry.kind !== "row") {
      // The inbox heading (and, while nothing is placed, the drop cell above it).
      return (
        <SortableMarker key={entry.id} id={entry.id}>
          {listEmpty ? (
            <ListDropZone
              active={overListDrop}
              label={`Drag ${withArticle(noun)} here to start the list`}
            />
          ) : null}
          <SectionHeader
            kind="inbox"
            label={inboxTitle}
            count={inbox.length}
            first={open.length === 0 && !listEmpty}
          />
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
      collisionDetection={closestCenter}
    >
      <View style={styles.frame}>
        <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
          <ScrollView
            ref={scrollRef as never}
            contentContainerStyle={[styles.listContent, screenColumnStyle]}
            onScroll={(e) => {
              if (scrollY) scrollY.value = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            testID="list-detail-list"
          >
            {header ? <View style={styles.header}>{header}</View> : null}
            {/* Rows already there when the list opens appear at once; only
                rows that join later fade in. */}
            <LayoutAnimationConfig skipEntering>
              <SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
                {entries.map(renderEntry)}
              </SortableContext>

              {completed.length > 0 && (open.length + inbox.length > 0 || doneCollapsible) ? (
                <Animated.View layout={layout}>
                  <SectionHeader
                    kind="completed"
                    label={copy.done}
                    count={completed.length}
                    collapsible={
                      doneCollapsible
                        ? { collapsed: doneCollapsed, onToggle: onToggleDone }
                        : undefined
                    }
                    first={open.length === 0 && inbox.length === 0}
                  />
                </Animated.View>
              ) : null}
              {completedToRender.map((item) => (
                <Animated.View key={item.id} layout={layout} entering={entering} exiting={exiting}>
                  <ItemRow {...baseRowProps(props, item, "completed")} isDragging={false} />
                </Animated.View>
              ))}
            </LayoutAnimationConfig>
            {placeholder}
          </ScrollView>
        </PullToRefresh>
        {/* The lifted row follows the pointer in an overlay; its slot in the
            list stays behind as a faint placeholder showing where it lands. */}
        <DragOverlay
          dropAnimation={reduceMotion ? null : { duration: tokens.motion.base, easing: easeOutCss }}
        >
          {activeItem ? (
            <ItemRow
              {...baseRowProps(props, activeItem, activeSection)}
              isDragging
              dragHandle={<Icon name="drag" size={16} tone="muted" />}
            />
          ) : null}
        </DragOverlay>
      </View>
    </DndContext>
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
  // The header blocks carry their own gutter.
  header: { marginHorizontal: -pageLayout.gutter },
  listContent: {
    paddingHorizontal: pageLayout.gutter,
    paddingTop: tokens.space.sm,
    paddingBottom: pageLayout.bottomInset,
  },
});
