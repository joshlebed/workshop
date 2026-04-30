import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AlbumShelfItemMetadata,
  AlbumShelfItemsResponse,
  AlbumShelfListMetadata,
  AlbumShelfRefreshResponse,
  Item,
  ItemMetadata,
  List,
  ListColor,
  ListMemberSummary,
} from "@workshop/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { fetchAlbumShelfItems, refreshAlbumShelf } from "../api/albumShelf";
import { deleteItem, updateItem } from "../api/items";
import { ApiError } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { formatRelative } from "../lib/relativeTime";
import { Button, Card, EmptyState, type ListColorKey, Text, tokens, useToast } from "../ui/index";
import { type DropResult, type OrderedItem, resolveDrop } from "./albumShelfDrag";
import { useWebDragHandlers } from "./albumShelfWebDrag";

interface Props {
  list: List;
  members: ListMemberSummary[];
  token: string | null;
  onBack: () => void;
  onSettings: () => void;
}

// Entries we render in the flat scroll. We need stable per-row layouts to
// translate drag Y → drop slot, so headers / hint / rows are all entries
// with measurable heights.
type Entry =
  | { kind: "ordered-header"; count: number }
  | { kind: "detected-header"; count: number }
  | { kind: "ordered-hint" }
  | { kind: "ordered-row"; item: Item; orderedIndex: number }
  | { kind: "detected-row"; item: Item };

type EntryKey = string;

function entryKey(e: Entry, position: number): EntryKey {
  switch (e.kind) {
    case "ordered-header":
      return "ordered-header";
    case "detected-header":
      return "detected-header";
    case "ordered-hint":
      return "ordered-hint";
    case "ordered-row":
      return `ordered:${e.item.id}`;
    case "detected-row":
      return `detected:${e.item.id}:${position}`;
  }
}

const LONG_PRESS_MS = 350;

/**
 * Album Shelf list-detail screen. Distinct enough from the standard
 * list-detail (no upvote, no completed checkmark, no FAB; refresh button +
 * ordered/detected sections + drag-to-reorder + per-row context menu) that
 * it lives in its own component rather than branching the standard one.
 *
 * Drag flow: long-press a row to lift it, then drag across the divider to
 * promote/demote or within the same section to reorder. On web the same
 * gesture works with mouse-down. Position math is in `albumShelfDrag.ts`
 * (unit-tested separately) so this file only owns the rendering.
 */
export function AlbumShelfDetail({ list, members, token, onBack, onSettings }: Props) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [filter, setFilter] = useState("");
  const itemsKey = queryKeys.albumShelf.items(list.id);

  const itemsQuery = useQuery({
    queryKey: itemsKey,
    queryFn: () => fetchAlbumShelfItems(list.id, token),
    enabled: !!token,
  });

  // After a successful refresh we mark item ids that are newly arrived so the
  // detected rows can render the "new" pill briefly. Per spec §4.4: the pill
  // fades after 3s.
  const [newItemIds, setNewItemIds] = useState<Set<string>>(() => new Set());
  const beforeRefreshIdsRef = useRef<Set<string> | null>(null);

  const refreshMutation = useMutation<AlbumShelfRefreshResponse, Error, void>({
    mutationFn: () => refreshAlbumShelf(list.id, token),
    onMutate: () => {
      const cur = queryClient.getQueryData<AlbumShelfItemsResponse>(itemsKey);
      const prevIds = new Set<string>();
      if (cur) {
        for (const it of cur.ordered) prevIds.add(it.id);
        for (const it of cur.detected) prevIds.add(it.id);
      }
      beforeRefreshIdsRef.current = prevIds;
    },
    onSuccess: (res) => {
      queryClient.setQueryData<AlbumShelfItemsResponse>(itemsKey, {
        ordered: res.ordered,
        detected: res.detected,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(list.id) });
      const added = res.addedCount;
      const before = beforeRefreshIdsRef.current ?? new Set<string>();
      const fresh = new Set<string>();
      for (const it of res.detected) {
        if (!before.has(it.id)) fresh.add(it.id);
      }
      if (fresh.size > 0) setNewItemIds(fresh);
      showToast({
        message:
          added === 0
            ? "No new albums detected."
            : `Detected ${added} new album${added === 1 ? "" : "s"}.`,
        tone: added === 0 ? "default" : "success",
      });
    },
    onError: (e) => {
      showToast({
        message: errorMessage(e, "Couldn't refresh — try again?"),
        tone: "danger",
      });
    },
  });

  useEffect(() => {
    if (newItemIds.size === 0) return;
    const t = setTimeout(() => setNewItemIds(new Set()), 3000);
    return () => clearTimeout(t);
  }, [newItemIds]);

  const positionMutation = useMutation<
    Item,
    Error,
    { item: Item; nextPosition: number | null },
    { previous?: AlbumShelfItemsResponse }
  >({
    mutationFn: async ({ item, nextPosition }) => {
      const res = await updateItem(
        item.id,
        { metadata: { position: nextPosition } as unknown as ItemMetadata },
        token,
      );
      return res.item;
    },
    onMutate: async ({ item, nextPosition }) => {
      await queryClient.cancelQueries({ queryKey: itemsKey });
      const previous = queryClient.getQueryData<AlbumShelfItemsResponse>(itemsKey);
      if (previous) {
        const next = applyPositionPatch(previous, item.id, nextPosition);
        queryClient.setQueryData<AlbumShelfItemsResponse>(itemsKey, next);
      }
      return { previous };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(itemsKey, ctx.previous);
      showToast({ message: errorMessage(e, "Couldn't move that album."), tone: "danger" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: itemsKey });
    },
  });

  const deleteMutation = useMutation<{ ok: true }, Error, { itemId: string }>({
    mutationFn: ({ itemId }) => deleteItem(itemId, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: itemsKey });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't delete that album."), tone: "danger" });
    },
  });

  const data = itemsQuery.data;
  const orderedRaw = data?.ordered ?? [];
  const detectedRaw = data?.detected ?? [];

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return { ordered: orderedRaw, detected: detectedRaw };
    const matches = (it: Item) => {
      const m = it.metadata as Partial<AlbumShelfItemMetadata>;
      const haystack = `${it.title} ${m.artist ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    };
    return { ordered: orderedRaw.filter(matches), detected: detectedRaw.filter(matches) };
  }, [orderedRaw, detectedRaw, filter]);

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      if (m.displayName) map.set(m.userId, m.displayName);
    }
    return map;
  }, [members]);

  const accent =
    (list.color as ListColorKey) in tokens.list
      ? tokens.list[list.color as ListColorKey]
      : tokens.accent.default;
  const meta = list.metadata as Partial<AlbumShelfListMetadata>;
  const lastRefreshedAt = meta.lastRefreshedAt;
  const lastRefreshedByName = meta.lastRefreshedBy
    ? (memberNameById.get(meta.lastRefreshedBy) ?? null)
    : null;
  const refreshing = refreshMutation.isPending;

  const showOrderedHint =
    filtered.ordered.length === 0 && filtered.detected.length > 0 && filter.trim().length === 0;

  // Build the flat entry list. Order matters — drop-slot math depends on
  // ordered entries appearing first.
  const entries: Entry[] = useMemo(() => {
    const out: Entry[] = [];
    if (filtered.ordered.length > 0) {
      out.push({ kind: "ordered-header", count: filtered.ordered.length });
      filtered.ordered.forEach((it, i) => {
        out.push({ kind: "ordered-row", item: it, orderedIndex: i });
      });
    }
    if (showOrderedHint) {
      out.push({ kind: "ordered-hint" });
    }
    if (filtered.detected.length > 0) {
      out.push({ kind: "detected-header", count: filtered.detected.length });
      filtered.detected.forEach((it) => {
        out.push({ kind: "detected-row", item: it });
      });
    }
    return out;
  }, [filtered.ordered, filtered.detected, showOrderedHint]);

  // Layout cache: y + height for each entry index. The drag handler needs
  // these to translate touch Y → drop slot. Re-fill on every entries
  // change; the per-row onLayout hooks repopulate it.
  const layoutsRef = useRef<Array<{ y: number; height: number } | null>>([]);
  useEffect(() => {
    layoutsRef.current = entries.map(() => null);
  }, [entries]);

  const onEntryLayout = useCallback((index: number) => {
    return (e: LayoutChangeEvent) => {
      const { y, height } = e.nativeEvent.layout;
      const cur = layoutsRef.current;
      if (!cur[index] || cur[index].y !== y || cur[index].height !== height) {
        cur[index] = { y, height };
      }
    };
  }, []);

  // Drag state. We split shared values (UI thread, used in animated style)
  // from React state (re-renders the placeholder gap). When a drag is
  // active, `draggingId` is set and `hoverSlot` ticks through 0..entries.length.
  const draggingId = useSharedValue<string | null>(null);
  const dragY = useSharedValue(0);
  const dragHeight = useSharedValue(0);
  // Slot the dragged item would land in if released right now. Mirrored
  // from the worklet via runOnJS so we can re-render the placeholder gap.
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  const [draggingState, setDraggingState] = useState<{
    id: string;
    rowKind: "ordered" | "detected";
    height: number;
  } | null>(null);

  const beginDrag = useCallback(
    (info: { id: string; rowKind: "ordered" | "detected"; height: number; index: number }) => {
      setDraggingState({ id: info.id, rowKind: info.rowKind, height: info.height });
      const initial = layoutsRef.current[info.index];
      setHoverSlot(initial ? indexToInitialSlot(info.index) : info.index);
    },
    [],
  );

  const finishDrag = useCallback(
    (slot: number) => {
      const state = draggingState;
      setDraggingState(null);
      setHoverSlot(null);
      if (!state) return;
      const orderedItems: OrderedItem[] = filtered.ordered.map((it) => ({
        id: it.id,
        position: positionOf(it) ?? 0,
      }));
      const dropSlotInRows = entrySlotToRowSlot(entries, slot);
      const result: DropResult = resolveDrop({
        ordered: orderedItems,
        detectedCount: filtered.detected.length,
        draggedId: state.id,
        dropSlot: dropSlotInRows,
      });
      if (result.kind === "noop") return;
      const item =
        filtered.ordered.find((it) => it.id === state.id) ??
        filtered.detected.find((it) => it.id === state.id);
      if (!item) return;
      positionMutation.mutate({ item, nextPosition: result.nextPosition });
    },
    [entries, filtered.ordered, filtered.detected, draggingState, positionMutation],
  );

  const onRowDelete = (item: Item) => {
    Alert.alert(
      "Remove this album?",
      "Removing this album won't stop it from coming back. If a track from this album is still on the source playlist, the next refresh will re-detect it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteMutation.mutate({ itemId: item.id }),
        },
      ],
    );
  };

  const onPromote = (item: Item) => {
    const orderedItems: OrderedItem[] = filtered.ordered.map((it) => ({
      id: it.id,
      position: positionOf(it) ?? 0,
    }));
    const last = orderedItems[orderedItems.length - 1]?.position ?? 0;
    positionMutation.mutate({ item, nextPosition: orderedItems.length === 0 ? 1 : last + 1 });
  };
  const onPromoteToTop = (item: Item) => {
    const first = filtered.ordered[0];
    const next = first ? (positionOf(first) ?? 1) / 2 : 1;
    positionMutation.mutate({ item, nextPosition: next });
  };
  const onDemote = (item: Item) => {
    positionMutation.mutate({ item, nextPosition: null });
  };

  const headerSubline = useMemo(() => {
    if (refreshing) return "Refreshing…";
    const memberPart = `${members.length} ${members.length === 1 ? "member" : "members"}`;
    if (!lastRefreshedAt) {
      return `${memberPart} · pull from Spotify by tapping ↻`;
    }
    const rel = formatRelative(lastRefreshedAt);
    const actor = lastRefreshedByName ? ` by @${lastRefreshedByName}` : "";
    return `${memberPart} · last refreshed ${rel}${actor}`;
  }, [refreshing, members.length, lastRefreshedAt, lastRefreshedByName]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          testID="album-shelf-back"
          hitSlop={10}
        >
          <Text style={styles.headerGlyph}>‹</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitle}>
            <Text style={styles.headerEmoji}>{list.emoji}</Text>
            <Text variant="heading" numberOfLines={1} style={styles.headerName}>
              {list.name}
            </Text>
          </View>
          <View style={[styles.headerStripe, { backgroundColor: accent }]} />
          <Text variant="caption" tone="muted" style={styles.subline} testID="album-shelf-subline">
            {headerSubline}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh from Spotify"
            onPress={() => refreshMutation.mutate()}
            disabled={refreshing}
            testID="album-shelf-refresh"
            hitSlop={10}
          >
            {refreshing ? (
              <ActivityIndicator color={tokens.accent.default} />
            ) : (
              <Text style={styles.headerGlyph}>↻</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open list settings"
            onPress={onSettings}
            testID="album-shelf-settings"
            hitSlop={10}
          >
            <Text style={styles.headerGlyph}>⋯</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.toolbar}>
        <TextInput
          testID="album-shelf-filter"
          value={filter}
          onChangeText={setFilter}
          placeholder="Search this shelf"
          placeholderTextColor={tokens.text.muted}
          style={styles.filterInput}
          accessibilityLabel="Search this shelf"
        />
      </View>

      {itemsQuery.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.accent.default} />
        </View>
      ) : itemsQuery.isError ? (
        <View style={styles.center}>
          <EmptyState
            title="Couldn't load shelf"
            description={errorMessage(itemsQuery.error, "Unknown error")}
            action={
              <Button
                label="Retry"
                variant="secondary"
                onPress={() => itemsQuery.refetch()}
                testID="album-shelf-retry"
              />
            }
          />
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            title={lastRefreshedAt ? "No albums detected." : "Pulling albums from your playlist…"}
            description={
              lastRefreshedAt
                ? "Check that your playlist has tracks with album info, or change the source URL in settings."
                : undefined
            }
            action={
              lastRefreshedAt ? (
                <Button
                  label="Refresh now"
                  onPress={() => refreshMutation.mutate()}
                  loading={refreshing}
                  testID="album-shelf-empty-refresh"
                />
              ) : undefined
            }
          />
        </View>
      ) : (
        <ScrollView
          testID="album-shelf-list"
          contentContainerStyle={styles.listContent}
          // Disable scroll while a drag is active so the drag gesture owns
          // vertical movement. RN's gesture-handler should claim it via
          // simultaneousWithExternalGesture, but explicit is safer.
          scrollEnabled={!draggingState}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => refreshMutation.mutate()}
              tintColor={tokens.accent.default}
            />
          }
        >
          {entries.map((entry, index) => {
            const key = entryKey(entry, index);
            const isDragSource = isRowEntry(entry) && draggingState?.id === entry.item.id;
            // Insert a placeholder gap above the entry that would receive the
            // drop. Rendering it as a sibling sized like the dragged item gives
            // visual feedback that the drop slot is there.
            const showPlaceholderAbove = hoverSlot === index && draggingState && !isDragSource;
            return (
              <View
                key={key}
                style={isDragSource ? styles.entryHidden : null}
                onLayout={onEntryLayout(index)}
              >
                {showPlaceholderAbove ? <DropPlaceholder height={draggingState.height} /> : null}
                {renderEntry({
                  entry,
                  isDragSource: !!isDragSource,
                  isNew:
                    isRowEntry(entry) &&
                    entry.kind === "detected-row" &&
                    newItemIds.has(entry.item.id),
                  addedByName: isRowEntry(entry)
                    ? (memberNameById.get(entry.item.addedBy) ?? null)
                    : null,
                  onMenu: isRowEntry(entry)
                    ? () =>
                        showRowMenu({
                          item: entry.item,
                          isOrdered: entry.kind === "ordered-row",
                          isFirst: entry.kind === "ordered-row" && entry.orderedIndex === 0,
                          isLast:
                            entry.kind === "ordered-row" &&
                            entry.orderedIndex === filtered.ordered.length - 1,
                          onPromote: () => onPromote(entry.item),
                          onPromoteToTop: () => onPromoteToTop(entry.item),
                          onDemote: () => onDemote(entry.item),
                          onDelete: () => onRowDelete(entry.item),
                        })
                    : undefined,
                  onBeginDrag: isRowEntry(entry)
                    ? (height: number) =>
                        beginDrag({
                          id: entry.item.id,
                          rowKind: entry.kind === "ordered-row" ? "ordered" : "detected",
                          height,
                          index,
                        })
                    : undefined,
                  onDragMove: isRowEntry(entry)
                    ? (absY: number) => {
                        setHoverSlot(computeHoverSlot(layoutsRef.current, absY));
                      }
                    : undefined,
                  onDragEnd: isRowEntry(entry) ? () => finishDrag(hoverSlot ?? index) : undefined,
                  draggingId,
                  dragY,
                  dragHeight,
                })}
                {showPlaceholderAbove && index === entries.length - 1 ? null : null}
              </View>
            );
          })}
          {hoverSlot === entries.length && draggingState ? (
            <DropPlaceholder height={draggingState.height} />
          ) : null}
        </ScrollView>
      )}

      {draggingState ? (
        <View style={styles.dragHint} pointerEvents="none">
          <Text variant="caption" tone="onAccent">
            Drag across the divider to promote / demote · release to drop
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function isRowEntry(e: Entry): e is Extract<Entry, { kind: "ordered-row" | "detected-row" }> {
  return e.kind === "ordered-row" || e.kind === "detected-row";
}

function indexToInitialSlot(index: number): number {
  return index;
}

function entrySlotToRowSlot(entries: Entry[], entrySlot: number): number {
  // Map an entry-flat-list slot index → the "row-only" slot index that
  // resolveDrop expects (ordered rows + detected rows, no headers/hints).
  let rowsBefore = 0;
  for (let i = 0; i < entrySlot && i < entries.length; i++) {
    const e = entries[i];
    if (!e) continue;
    if (e.kind === "ordered-row" || e.kind === "detected-row") rowsBefore++;
  }
  return rowsBefore;
}

function computeHoverSlot(
  layouts: Array<{ y: number; height: number } | null>,
  absY: number,
): number {
  for (let i = 0; i < layouts.length; i++) {
    const l = layouts[i];
    if (!l) continue;
    const center = l.y + l.height / 2;
    if (absY < center) return i;
  }
  return layouts.length;
}

function showRowMenu(p: {
  item: Item;
  isOrdered: boolean;
  isFirst: boolean;
  isLast: boolean;
  onPromote: () => void;
  onPromoteToTop: () => void;
  onDemote: () => void;
  onDelete: () => void;
}) {
  type Action = { text: string; onPress?: () => void; style?: "destructive" | "cancel" };
  const actions: Action[] = [];
  if (p.isOrdered) {
    actions.push({ text: "Move to detected", onPress: p.onDemote });
  } else {
    actions.push({ text: "Move to ordered (bottom)", onPress: p.onPromote });
    actions.push({ text: "Move to ordered (top)", onPress: p.onPromoteToTop });
  }
  actions.push({ text: "Delete album", style: "destructive", onPress: p.onDelete });
  actions.push({ text: "Cancel", style: "cancel" });
  Alert.alert(p.item.title, undefined, actions);
}

interface RenderEntryArgs {
  entry: Entry;
  isDragSource: boolean;
  isNew: boolean;
  addedByName: string | null;
  onMenu?: () => void;
  onBeginDrag?: (height: number) => void;
  onDragMove?: (absY: number) => void;
  onDragEnd?: () => void;
  draggingId: ReturnType<typeof useSharedValue<string | null>>;
  dragY: ReturnType<typeof useSharedValue<number>>;
  dragHeight: ReturnType<typeof useSharedValue<number>>;
}

function renderEntry(args: RenderEntryArgs) {
  const { entry } = args;
  if (entry.kind === "ordered-header") {
    return (
      <View style={styles.sectionHeader} testID="album-shelf-section-ordered">
        <Text variant="label" tone="secondary">
          ORDERED ({entry.count})
        </Text>
      </View>
    );
  }
  if (entry.kind === "detected-header") {
    return (
      <View style={styles.sectionHeader} testID="album-shelf-section-detected">
        <Text variant="label" tone="secondary">
          DETECTED ({entry.count})
        </Text>
      </View>
    );
  }
  if (entry.kind === "ordered-hint") {
    return (
      <View style={styles.orderedHint} testID="album-shelf-ordered-hint">
        <Text variant="caption" tone="secondary">
          Long-press a detected album and drag it up here to start ranking your shelf.
        </Text>
      </View>
    );
  }
  return (
    <DraggableAlbumRow
      item={entry.item}
      isOrdered={entry.kind === "ordered-row"}
      indexLabel={entry.kind === "ordered-row" ? String(entry.orderedIndex + 1) : "•"}
      isNew={args.isNew}
      addedByName={args.addedByName}
      onMenu={args.onMenu ?? noop}
      onBeginDrag={args.onBeginDrag ?? noopHeight}
      onDragMove={args.onDragMove ?? noopAbs}
      onDragEnd={args.onDragEnd ?? noop}
    />
  );
}

const noop = () => {};
const noopHeight = (_height: number) => {};
const noopAbs = (_absY: number) => {};

interface DraggableAlbumRowProps {
  item: Item;
  isOrdered: boolean;
  indexLabel: string;
  isNew: boolean;
  addedByName: string | null;
  onMenu: () => void;
  onBeginDrag: (height: number) => void;
  onDragMove: (absY: number) => void;
  onDragEnd: () => void;
}

function DraggableAlbumRow({
  item,
  isOrdered,
  indexLabel,
  isNew,
  addedByName,
  onMenu,
  onBeginDrag,
  onDragMove,
  onDragEnd,
}: DraggableAlbumRowProps) {
  const meta = item.metadata as Partial<AlbumShelfItemMetadata>;
  const cover = meta.coverUrl;
  const artist = meta.artist ?? "";
  const year = meta.year;
  const subline = year ? `${artist} · ${year}` : artist;
  const detectedAt = typeof meta.detectedAt === "string" ? meta.detectedAt : null;
  const provenance = isOrdered
    ? addedByName
      ? `added ${formatRelative(item.createdAt)} by @${addedByName}`
      : `added ${formatRelative(item.createdAt)}`
    : detectedAt
      ? `detected ${formatRelative(detectedAt)}`
      : "detected";

  // Local shared values for the visual lift while this row is the drag
  // source. translateY follows the finger; scale gives a "picked up" cue.
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const elevation = useSharedValue(0);
  const heightRef = useRef(0);

  const startDragJS = useCallback(() => {
    onBeginDrag(heightRef.current);
  }, [onBeginDrag]);
  const moveDragJS = useCallback(
    (absY: number) => {
      onDragMove(absY);
    },
    [onDragMove],
  );
  const endDragJS = useCallback(() => {
    onDragEnd();
  }, [onDragEnd]);

  // Web-only fallback: drive the drag via DOM pointer events on the handle.
  // RNGH's web impl + Reanimated 4 don't reliably activate Pan from mouse
  // input in this version, so on web we bypass the gesture pipeline. On
  // native this hook returns an empty handler set.
  const webDragHandlers = useWebDragHandlers({
    onBegin: () => {
      scale.value = withTiming(1.02, { duration: 120 });
      elevation.value = 1;
      onBeginDrag(heightRef.current);
    },
    onMove: (absoluteY) => onDragMove(absoluteY),
    onEnd: () => {
      onDragEnd();
      scale.value = withTiming(1, { duration: 180 });
      translateY.value = withTiming(0, { duration: 180 });
      elevation.value = 0;
    },
    onCancel: () => {
      scale.value = withTiming(1, { duration: 180 });
      translateY.value = withTiming(0, { duration: 180 });
      elevation.value = 0;
    },
  });

  // Two-pronged activation:
  //  - Body Pan: hold-still-then-drag (long-press) — picks up touches anywhere on
  //    the row but waits 350ms so a normal tap or upward swipe-to-scroll wins.
  //  - Handle Pan: immediate-on-movement (no long-press) — clicking the ≡ icon
  //    is an explicit "grab to drag" gesture, useful especially on web where
  //    the long-press semantics aren't as discoverable with a mouse.
  const bodyPan = Gesture.Pan()
    .activateAfterLongPress(LONG_PRESS_MS)
    .onStart(() => {
      "worklet";
      scale.value = withTiming(1.02, { duration: 120 });
      elevation.value = 1;
      runOnJS(startDragJS)();
    })
    .onUpdate((e) => {
      "worklet";
      translateY.value = e.translationY;
      runOnJS(moveDragJS)(e.absoluteY);
    })
    .onEnd(() => {
      "worklet";
      runOnJS(endDragJS)();
      translateY.value = withTiming(0, { duration: 180 });
      scale.value = withTiming(1, { duration: 180 });
      elevation.value = 0;
    })
    .onFinalize(() => {
      "worklet";
      translateY.value = withTiming(0, { duration: 180 });
      scale.value = withTiming(1, { duration: 180 });
      elevation.value = 0;
    });

  const handlePan = Gesture.Pan()
    .minDistance(2)
    .onStart(() => {
      "worklet";
      scale.value = withTiming(1.02, { duration: 120 });
      elevation.value = 1;
      runOnJS(startDragJS)();
    })
    .onUpdate((e) => {
      "worklet";
      translateY.value = e.translationY;
      runOnJS(moveDragJS)(e.absoluteY);
    })
    .onEnd(() => {
      "worklet";
      runOnJS(endDragJS)();
      translateY.value = withTiming(0, { duration: 180 });
      scale.value = withTiming(1, { duration: 180 });
      elevation.value = 0;
    })
    .onFinalize(() => {
      "worklet";
      translateY.value = withTiming(0, { duration: 180 });
      scale.value = withTiming(1, { duration: 180 });
      elevation.value = 0;
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
    zIndex: elevation.value > 0 ? 999 : 0,
    elevation: elevation.value > 0 ? 8 : 0,
    shadowOpacity: elevation.value > 0 ? 0.35 : 0,
    shadowRadius: elevation.value > 0 ? 12 : 0,
  }));

  // touch-action: none on web so the browser doesn't steal the drag for
  // scroll. RNGH does this on iOS automatically.
  const webTouchAction = Platform.OS === "web" ? { touchAction: "none" as const } : null;

  return (
    <GestureDetector gesture={bodyPan}>
      <Animated.View
        style={[animatedStyle, webTouchAction]}
        onLayout={(e) => {
          heightRef.current = e.nativeEvent.layout.height;
        }}
      >
        <Card style={[styles.row, isNew && styles.rowNew]} testID={`album-row-${item.id}`}>
          <GestureDetector gesture={handlePan}>
            <View
              // biome-ignore lint/a11y/useSemanticElements: gesture handler needs a View
              accessibilityRole="button"
              accessibilityLabel={`Drag handle for ${item.title}`}
              testID={`album-row-handle-${item.id}`}
              style={[styles.rowDragHandle, webTouchAction]}
              {...(webDragHandlers as Record<string, unknown>)}
            >
              <Text style={styles.dragHandleGlyph}>≡</Text>
            </View>
          </GestureDetector>
          <View style={styles.rowIndex}>
            <Text variant="caption" tone="muted" style={styles.indexText}>
              {indexLabel}
            </Text>
          </View>
          {cover ? (
            <Image source={{ uri: cover }} style={styles.cover} accessibilityIgnoresInvertColors />
          ) : (
            <View style={[styles.cover, styles.coverPlaceholder]}>
              <Text style={styles.coverPlaceholderGlyph}>📀</Text>
            </View>
          )}
          <View style={styles.rowBody}>
            <View style={styles.rowTitleLine}>
              <Text numberOfLines={1} style={styles.rowTitle}>
                {item.title}
              </Text>
              {isNew ? (
                <View style={styles.newPill} testID={`album-row-new-${item.id}`}>
                  <Text variant="caption" tone="onAccent" style={styles.newPillText}>
                    NEW
                  </Text>
                </View>
              ) : null}
            </View>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {subline}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {provenance}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open menu for ${item.title}`}
            onPress={onMenu}
            testID={`album-row-menu-${item.id}`}
            style={({ pressed }) => [styles.menuBtn, pressed && styles.menuBtnPressed]}
            hitSlop={10}
          >
            <Text style={styles.menuGlyph}>⋮</Text>
          </Pressable>
        </Card>
      </Animated.View>
    </GestureDetector>
  );
}

function DropPlaceholder({ height }: { height: number }) {
  return <View style={[styles.dropPlaceholder, { height }]} />;
}

function positionOf(it: Item): number | null {
  const m = it.metadata as Partial<AlbumShelfItemMetadata>;
  return typeof m.position === "number" ? m.position : null;
}

function applyPositionPatch(
  data: AlbumShelfItemsResponse,
  itemId: string,
  nextPosition: number | null,
): AlbumShelfItemsResponse {
  const all = [...data.ordered, ...data.detected];
  const target = all.find((i) => i.id === itemId);
  if (!target) return data;
  const otherOrdered = data.ordered.filter((i) => i.id !== itemId);
  const otherDetected = data.detected.filter((i) => i.id !== itemId);
  const patched: Item = {
    ...target,
    metadata: {
      ...(target.metadata as unknown as AlbumShelfItemMetadata),
      position: nextPosition,
    } as unknown as ItemMetadata,
  };
  if (typeof nextPosition === "number") {
    const ordered = [...otherOrdered, patched].sort(
      (a, b) => (positionOf(a) ?? 0) - (positionOf(b) ?? 0),
    );
    return { ordered, detected: otherDetected };
  }
  return { ordered: otherOrdered, detected: [...otherDetected, patched] };
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const code = (err.details as { code?: string } | undefined)?.code;
    if (code === "PLAYLIST_NOT_AVAILABLE")
      return "Source playlist is private or deleted. Update the source URL in settings.";
    if (code === "SPOTIFY_UNAVAILABLE") return "Spotify is having a moment. Try again.";
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

// Keep `ListColor` referenced so the unused-import lint stays quiet. The
// type is used downstream by the public ListSummary type.
const _color: ListColor | null = null;
void _color;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingTop: tokens.space.xxl,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: tokens.space.md,
    gap: tokens.space.md,
  },
  headerGlyph: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.xl,
    paddingHorizontal: tokens.space.sm,
  },
  headerCenter: { flex: 1, alignItems: "center", gap: tokens.space.xs },
  headerTitle: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  headerEmoji: { fontSize: tokens.font.size.lg },
  headerName: { maxWidth: 240 },
  headerStripe: { height: 3, width: 48, borderRadius: 2 },
  headerActions: { flexDirection: "row", alignItems: "center" },
  subline: { textAlign: "center", paddingHorizontal: tokens.space.lg },
  toolbar: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
  },
  filterInput: {
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: 10,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    backgroundColor: tokens.bg.surface,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: tokens.space.xxl,
  },
  listContent: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.xxl * 2,
  },
  sectionHeader: {
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
  },
  orderedHint: {
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    padding: tokens.space.md,
  },
  rowNew: {
    borderColor: tokens.accent.default,
    borderWidth: 1,
  },
  rowDragHandle: {
    paddingHorizontal: tokens.space.xs,
    paddingVertical: tokens.space.sm,
  },
  dragHandleGlyph: {
    color: tokens.text.muted,
    fontSize: tokens.font.size.lg,
    lineHeight: tokens.font.size.lg + 2,
  },
  rowIndex: { width: 24, alignItems: "center" },
  indexText: { fontSize: tokens.font.size.md },
  cover: {
    width: 48,
    height: 48,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.bg.elevated,
  },
  coverPlaceholder: { alignItems: "center", justifyContent: "center" },
  coverPlaceholderGlyph: { fontSize: 22 },
  rowBody: { flex: 1, gap: 2 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  rowTitle: {
    flexShrink: 1,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.regular,
  },
  newPill: {
    backgroundColor: tokens.accent.default,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 2,
    borderRadius: tokens.radius.sm,
  },
  newPillText: { fontSize: 10, fontWeight: tokens.font.weight.bold, letterSpacing: 0.5 },
  menuBtn: { paddingHorizontal: tokens.space.sm, paddingVertical: tokens.space.xs },
  menuBtnPressed: { opacity: 0.6 },
  menuGlyph: { fontSize: tokens.font.size.lg, color: tokens.text.secondary },
  entryHidden: { opacity: 0 },
  dropPlaceholder: {
    borderRadius: tokens.radius.md,
    borderWidth: 2,
    borderColor: tokens.accent.default,
    borderStyle: "dashed",
    backgroundColor: tokens.accent.muted,
    marginVertical: tokens.space.xs / 2,
  },
  dragHint: {
    position: "absolute",
    bottom: tokens.space.lg,
    left: tokens.space.xl,
    right: tokens.space.xl,
    backgroundColor: tokens.accent.default,
    borderRadius: tokens.radius.md,
    paddingVertical: tokens.space.sm,
    alignItems: "center",
  },
});
