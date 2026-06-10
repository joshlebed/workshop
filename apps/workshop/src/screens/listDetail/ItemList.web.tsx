// Web list-detail row container.
//
// Section headers and the ordered hint render as plain markup outside any
// sortable context — keeping them out of the sortable items list is what
// fixed the cross-section layout glitch the native side was hitting too.
//
// Drag-to-reorder works within the ordered section, and unordered rows are
// draggable into the ordered section (drop on an ordered row inserts above
// it; drop on the trailing "Drop here" zone appends). Cross-section drag
// from completed isn't supported — that still goes through the kebab menu.
//
// Reorder activation: dnd-kit `TouchSensor` is configured with
// `{ delay: 250, tolerance: 8 }` so a press-and-hold anywhere on a row
// activates the drag, while a short tap fires the row's `onPress`. The
// drag listeners spread onto the *row wrapper* (not a leading handle)
// and the row sets `touchAction: "pan-y"` so vertical scroll passes
// through until the long-press fires. Native uses RN `Pressable`'s
// `onLongPress` against the same delay so the activation feel matches.

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Item, LeaderboardEntry, ListMemberSummary } from "@workshop/shared";
import { hasModule } from "@workshop/shared/modules";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { PullToRefresh } from "../../components/PullToRefresh";
import { Text, tokens } from "../../ui/index";
import { COMPLETED_COLLAPSE_THRESHOLD } from "./completedSection";
import { GameLeaderboardCard } from "./GameLeaderboardCard";
import { ItemRow, OrderedHint, SectionHeader } from "./ItemRow";
import type { ItemListProps } from "./listProps";

const ORDERED_DROP_END_ID = "ordered-drop-end";

// Stable empty refs so leaderboard cards without scores still hit the memo.
const EMPTY_ENTRIES: LeaderboardEntry[] = [];
const EMPTY_MEMBERS: ListMemberSummary[] = [];

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
  playedByItem,
  letterboxdBadgeByItem,
  totalPlayers,
  isGameKind,
  viewingToday,
  scoresByItem,
  members,
  scoresLoading,
  onPlayGame,
  onPasteScore,
  accent,
  onReorderOrdered,
  onPromoteToOrdered,
  onRowMenu,
  onRowPressBody,
  onUncompleteItem,
  resolveRowPressCover,
  refreshing,
  onRefresh,
}: ItemListProps) {
  // When `ranking` is off the backend collapses every item into `unordered`,
  // so there's no Ranked section to drag into. Drop the drag affordances on
  // unordered rows and the cross-section drop zone — otherwise the row offers
  // a "drop here to add to ranked list" target that the backend rejects with
  // `module_disabled`.
  const rankingOn = hasModule(modules, "ranking");
  // Mirror the native side: auto-collapse the completed section past the
  // shared threshold; users can expand by tapping the section header.
  const [completedCollapsed, setCompletedCollapsed] = useState(
    completed.length > COMPLETED_COLLAPSE_THRESHOLD,
  );
  const showCompletedToggle = completed.length > COMPLETED_COLLAPSE_THRESHOLD;
  const completedToRender = showCompletedToggle && completedCollapsed ? [] : completed;
  // See ItemList.tsx for rationale: suppresses "added by you" provenance on
  // every row when the viewer is also the adder; collapses chrome to the
  // collaborator-attributed rows only.
  const resolveAddedByName = (item: Item): string | null => {
    if (!showProvenance) return null;
    if (selfId && item.addedBy === selfId) return null;
    return memberNameById.get(item.addedBy) ?? null;
  };
  // Leaderboard lists swap the "Added by …" line for "X of Y played today",
  // the actual social signal on a daily-games shelf. Returns `undefined` to
  // leave the default provenance untouched.
  const resolveProvenanceOverride = (item: Item): string | undefined => {
    const letterboxdBadge = letterboxdBadgeByItem?.get(item.id);
    if (letterboxdBadge) return letterboxdBadge;
    if (!playedByItem || totalPlayers == null) return undefined;
    const played = playedByItem.get(item.id) ?? 0;
    return `${played} of ${totalPlayers} played today`;
  };
  // Leaderboard lists swap the plain row for a rich standings card. The card
  // is the same on web and native; web drags via the wrapper's pointer
  // listeners, so there's no `onLongPressBody` here.
  const renderGameCard = useCallback(
    (item: Item, section: "ordered" | "unordered" | "completed", isDragging: boolean) => (
      <GameLeaderboardCard
        key={item.id}
        item={item}
        section={section}
        isDragging={isDragging}
        accent={accent}
        entries={scoresByItem?.[item.id] ?? EMPTY_ENTRIES}
        members={members ?? EMPTY_MEMBERS}
        selfId={selfId}
        viewingToday={viewingToday ?? true}
        loading={scoresLoading}
        onPressBody={() => onRowPressBody(item, section)}
        onMenu={() => onRowMenu(item, section)}
        onPlay={() => onPlayGame?.(item)}
        onPaste={() => onPasteScore?.(item)}
      />
    ),
    [
      accent,
      scoresByItem,
      members,
      selfId,
      viewingToday,
      scoresLoading,
      onRowPressBody,
      onRowMenu,
      onPlayGame,
      onPasteScore,
    ],
  );
  // Two sensors, never one with mixed activation:
  //   - MouseSensor with `distance: 4`  → desktop stays snappy (no delay).
  //   - TouchSensor with `delay: 250, tolerance: 8` → mobile web uses
  //     press-and-hold; a finger movement > 8px before 250ms cancels the
  //     pending activation so a regular swipe scrolls instead of dragging.
  // This is the official dnd-kit recommendation for lists that must scroll
  // on touch but reorder on hold (docs.dndkit.com/api-documentation/sensors/touch).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const orderedIds = useMemo(() => ordered.map((it) => it.id), [ordered]);
  const orderedIdSet = useMemo(() => new Set(orderedIds), [orderedIds]);
  const [activeSection, setActiveSection] = useState<"ordered" | "unordered" | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const section = event.active.data.current?.section as "ordered" | "unordered" | undefined;
    setActiveSection(section ?? null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveSection(null);
      const { active, over } = event;
      if (!over) return;
      const fromSection = (active.data.current?.section ?? "ordered") as "ordered" | "unordered";

      if (fromSection === "ordered") {
        if (active.id === over.id) return;
        const fromIndex = ordered.findIndex((it) => it.id === active.id);
        if (fromIndex < 0) return;
        let toIndex: number;
        if (over.id === ORDERED_DROP_END_ID) {
          toIndex = ordered.length - 1;
        } else {
          toIndex = ordered.findIndex((it) => it.id === over.id);
          if (toIndex < 0) return;
        }
        if (fromIndex === toIndex) return;
        onReorderOrdered({ fromIndex, toIndex });
        return;
      }

      // Drag from unordered → ordered.
      const item = unordered.find((it) => it.id === active.id);
      if (!item) return;
      let toIndex: number;
      if (over.id === ORDERED_DROP_END_ID) {
        toIndex = ordered.length;
      } else if (orderedIdSet.has(String(over.id))) {
        toIndex = ordered.findIndex((it) => it.id === over.id);
        if (toIndex < 0) return;
      } else {
        return;
      }
      onPromoteToOrdered({ item, toIndex });
    },
    [ordered, unordered, orderedIdSet, onReorderOrdered, onPromoteToOrdered],
  );

  const handleDragCancel = useCallback(() => setActiveSection(null), []);

  const draggingFromUnordered = activeSection === "unordered";
  const showOrderedDropEnd = rankingOn && (ordered.length > 0 || draggingFromUnordered);
  const visibleSectionCount =
    (ordered.length > 0 ? 1 : 0) + (unordered.length > 0 ? 1 : 0) + (completed.length > 0 ? 1 : 0);
  // Single-section lists don't need a section header — the section IS the
  // list. The completed section keeps its header when collapsible since the
  // header hosts the show/hide toggle.
  const showMultiSectionHeaders = visibleSectionCount > 1;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      collisionDetection={closestCenter}
    >
      <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
        <ScrollView contentContainerStyle={styles.listContent} testID="list-detail-list">
          {ordered.length > 0 && showMultiSectionHeaders ? (
            <SectionHeader kind="ordered" count={ordered.length} listItemKind={listItemKind} />
          ) : null}
          <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
            {ordered.map((item, index) =>
              isGameKind ? (
                <SortableGameCard key={item.id} item={item} render={renderGameCard} />
              ) : (
                <SortableOrderedRow
                  key={item.id}
                  item={item}
                  rank={index + 1}
                  addedByName={resolveAddedByName(item)}
                  provenanceOverride={resolveProvenanceOverride(item)}
                  accent={accent}
                  onMenu={() => onRowMenu(item, "ordered")}
                  onPressBody={() => onRowPressBody(item, "ordered")}
                  onPressCover={resolveRowPressCover?.(item, "ordered") ?? undefined}
                />
              ),
            )}
          </SortableContext>

          {showOrderedDropEnd ? <OrderedDropEndZone highlighted={draggingFromUnordered} /> : null}

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
              {unordered.map((item) =>
                isGameKind ? (
                  renderGameCard(item, "unordered", false)
                ) : (
                  <UnorderedRow
                    key={item.id}
                    draggable={rankingOn}
                    item={item}
                    isNew={newItemIds.has(item.id)}
                    addedByName={resolveAddedByName(item)}
                    provenanceOverride={resolveProvenanceOverride(item)}
                    accent={accent}
                    onMenu={() => onRowMenu(item, "unordered")}
                    onPressBody={() => onRowPressBody(item, "unordered")}
                    onPressCover={resolveRowPressCover?.(item, "unordered") ?? undefined}
                  />
                ),
              )}
            </>
          ) : null}

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
              {completedToRender.map((item) =>
                isGameKind ? (
                  renderGameCard(item, "completed", false)
                ) : (
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
                ),
              )}
            </>
          ) : null}
        </ScrollView>
      </PullToRefresh>
    </DndContext>
  );
}

interface SortableOrderedRowProps {
  item: Item;
  rank: number;
  addedByName: string | null;
  provenanceOverride?: string;
  accent: string;
  onMenu: () => void;
  onPressBody: () => void;
  onPressCover?: () => void;
}

function SortableOrderedRow({
  item,
  rank,
  addedByName,
  provenanceOverride,
  accent,
  onMenu,
  onPressBody,
  onPressCover,
}: SortableOrderedRowProps) {
  const { setNodeRef, transform, transition, listeners, attributes, isDragging } = useSortable({
    id: item.id,
    data: { section: "ordered" },
  });

  // `touchAction: "pan-y"` lets vertical scroll pass through the row when
  // the user swipes — TouchSensor's `delay`+`tolerance` constraint cancels
  // the pending drag activation if the finger moves > 8px before 250ms,
  // so scroll wins on a swipe and reorder wins on a hold.
  const webStyle = {
    transform: CSS.Transform.toString(transform) ?? undefined,
    transition: transition ?? undefined,
    touchAction: "pan-y",
    userSelect: "none",
  } as unknown as object;

  // Position chip is purely visual now — the whole row is the touch target
  // for drag activation (listeners spread onto the row wrapper below).
  const dragHandle = (child: ReactNode) => <View>{child}</View>;

  // Strip `role`/`tabIndex` from dnd-kit's a11y attributes — react-native-web
  // turns `role="button"` on a View into an HTML <button>, and the inner
  // ItemRow already contains <Pressable>s (also rendered as buttons), which
  // produces a DOM nesting warning. We're touch/mouse-only here (no keyboard
  // sensor), so dropping these on the wrapper is safe.
  const wrapperAttributes = stripButtonRole(attributes);

  return (
    <View
      ref={setNodeRef as unknown as React.Ref<View>}
      style={webStyle}
      {...((listeners ?? {}) as unknown as Record<string, unknown>)}
      {...(wrapperAttributes as unknown as Record<string, unknown>)}
    >
      <ItemRow
        item={item}
        section="ordered"
        rank={rank}
        isNew={false}
        isDragging={isDragging}
        addedByName={addedByName}
        provenanceOverride={provenanceOverride}
        accent={accent}
        onMenu={onMenu}
        onPressBody={onPressBody}
        onPressCover={onPressCover}
        dragHandle={dragHandle}
      />
    </View>
  );
}

function stripButtonRole(attributes: unknown): Record<string, unknown> {
  if (!attributes || typeof attributes !== "object") return {};
  const { role: _role, tabIndex: _tabIndex, ...rest } = attributes as Record<string, unknown>;
  return rest;
}

interface SortableGameCardProps {
  item: Item;
  render: (
    item: Item,
    section: "ordered" | "unordered" | "completed",
    isDragging: boolean,
  ) => ReactNode;
}

// Ordered leaderboard cards: same @dnd-kit wiring as SortableOrderedRow, but
// renders the rich card. The whole card is the drag target (listeners on the
// wrapper); a press-and-hold reorders, a tap falls through to the card's own
// Pressables.
function SortableGameCard({ item, render }: SortableGameCardProps) {
  const { setNodeRef, transform, transition, listeners, attributes, isDragging } = useSortable({
    id: item.id,
    data: { section: "ordered" },
  });

  const webStyle = {
    transform: CSS.Transform.toString(transform) ?? undefined,
    transition: transition ?? undefined,
    touchAction: "pan-y",
    userSelect: "none",
  } as unknown as object;

  const wrapperAttributes = stripButtonRole(attributes);

  return (
    <View
      ref={setNodeRef as unknown as React.Ref<View>}
      style={webStyle}
      {...((listeners ?? {}) as unknown as Record<string, unknown>)}
      {...(wrapperAttributes as unknown as Record<string, unknown>)}
    >
      {render(item, "ordered", isDragging)}
    </View>
  );
}

interface UnorderedRowProps {
  item: Item;
  isNew: boolean;
  addedByName: string | null;
  provenanceOverride?: string;
  accent: string;
  onMenu: () => void;
  onPressBody: () => void;
  onPressCover?: () => void;
}

// Dispatches between the draggable variant (when `ranking` is on, so the row
// can be promoted into the Ranked section) and a plain non-draggable row.
// `useDraggable` is a hook so the variants have to live in separate
// components — gating inside one component would violate rules-of-hooks.
function UnorderedRow({ draggable, ...props }: UnorderedRowProps & { draggable: boolean }) {
  if (draggable) {
    return <DraggableUnorderedRow {...props} />;
  }
  return (
    <ItemRow
      item={props.item}
      section="unordered"
      isNew={props.isNew}
      isDragging={false}
      addedByName={props.addedByName}
      provenanceOverride={props.provenanceOverride}
      accent={props.accent}
      onMenu={props.onMenu}
      onPressBody={props.onPressBody}
      onPressCover={props.onPressCover}
    />
  );
}

function DraggableUnorderedRow({
  item,
  isNew,
  addedByName,
  provenanceOverride,
  accent,
  onMenu,
  onPressBody,
  onPressCover,
}: UnorderedRowProps) {
  const { setNodeRef, transform, listeners, attributes, isDragging } = useDraggable({
    id: item.id,
    data: { section: "unordered" },
  });

  const webStyle = {
    transform: CSS.Translate.toString(transform) ?? undefined,
    opacity: isDragging ? 0.7 : 1,
    touchAction: "pan-y",
    userSelect: "none",
  } as unknown as object;

  // Drag handle is now visual-only; listeners hang on the row wrapper so
  // a long-press anywhere on the row (not just the chip) starts a drag.
  const dragHandle = (child: ReactNode) => <View>{child}</View>;

  // See SortableOrderedRow — `role="button"` from dnd-kit's attributes turns
  // the wrapper into an HTML <button>, nesting around the inner Pressables.
  const wrapperAttributes = stripButtonRole(attributes);

  return (
    <View
      ref={setNodeRef as unknown as React.Ref<View>}
      style={webStyle}
      {...((listeners ?? {}) as unknown as Record<string, unknown>)}
      {...(wrapperAttributes as unknown as Record<string, unknown>)}
    >
      <ItemRow
        item={item}
        section="unordered"
        isNew={isNew}
        isDragging={isDragging}
        addedByName={addedByName}
        provenanceOverride={provenanceOverride}
        accent={accent}
        onMenu={onMenu}
        onPressBody={onPressBody}
        onPressCover={onPressCover}
        dragHandle={dragHandle}
      />
    </View>
  );
}

function OrderedDropEndZone({ highlighted }: { highlighted: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: ORDERED_DROP_END_ID });
  if (!highlighted && !isOver) {
    // Invisible spacer so dropping at the end of ordered still works for
    // intra-ordered reorders, without showing the "drop zone" affordance.
    return (
      <View
        ref={setNodeRef as unknown as React.Ref<View>}
        style={styles.dropZoneSpacer}
        testID="list-detail-ordered-drop-end"
      />
    );
  }
  return (
    <View
      ref={setNodeRef as unknown as React.Ref<View>}
      style={[styles.dropZone, isOver && styles.dropZoneActive]}
      testID="list-detail-ordered-drop-end"
    >
      <Text variant="caption" tone="secondary">
        Drop here to add to ranked list
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.xxl * 2,
  },
  dropZoneSpacer: {
    height: tokens.space.sm,
  },
  dropZone: {
    marginTop: tokens.space.xs,
    marginBottom: tokens.space.sm,
    paddingVertical: tokens.space.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
  },
  dropZoneActive: {
    borderColor: tokens.accent.default,
    backgroundColor: `${tokens.accent.default}1A`,
  },
});
