import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AlbumShelfItemMetadata,
  AlbumShelfItemsResponse,
  AlbumShelfListMetadata,
  AlbumShelfRefreshResponse,
  Item,
  ItemMetadata,
  List,
  ListMemberSummary,
} from "@workshop/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { fetchAlbumShelfItems, refreshAlbumShelf } from "../api/albumShelf";
import { deleteItem, updateItem } from "../api/items";
import { albumShelfErrorMessage } from "../lib/albumShelfErrors";
import { applyPositionPatch, midpointAt, positionOf } from "../lib/albumShelfPositions";
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
        message: albumShelfErrorMessage(e, "Couldn't refresh — try again?"),
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
      showToast({
        message: albumShelfErrorMessage(e, "Couldn't move that album."),
        tone: "danger",
      });
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
      showToast({
        message: albumShelfErrorMessage(e, "Couldn't delete that album."),
        tone: "danger",
      });
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

  // Layout cache: y + height for each entry index, in ScrollView CONTENT
  // coordinates (what onLayout gives for direct ScrollView children). The
  // drag handler translates the touch's PAGE-Y back into this same content
  // coordinate space using the snapshot taken at drag-start.
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

  // We need to convert a touch's page-Y (what RNGH `absoluteY` and DOM
  // `clientY` both give us) into a ScrollView-CONTENT-Y so we can compare
  // it against `layoutsRef` (which holds onLayout-derived content-Y).
  //
  //   contentY = touchPageY - scrollViewPageY + scrollOffsetY
  //
  // `scrollViewPageY` is captured by giving the ScrollView's wrapper View a
  // ref + onLayout: the wrapper's measureInWindow gives us viewport-Y.
  // ScrollView's own ref is unreliable for measureInWindow on RN-Web, but a
  // plain View's ref maps cleanly to a DOM element on web and a host
  // component on native.
  const scrollWrapRef = useRef<View>(null);
  const scrollOffsetYRef = useRef(0);
  const dragOriginRef = useRef<{ scrollViewPageY: number; scrollOffsetY: number } | null>(null);
  // Layouts captured at drag-start. Used instead of layoutsRef during a
  // drag so any in-flight onLayout fires (e.g. from an indicator or a
  // collateral re-render) can't shift the slot math under our feet.
  const dragLayoutsRef = useRef<Array<{ y: number; height: number } | null>>([]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetYRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  // Slot the dragged item would land in if released right now.
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  const [draggingState, setDraggingState] = useState<{
    id: string;
    rowKind: "ordered" | "detected";
    height: number;
  } | null>(null);

  const beginDrag = useCallback(
    (info: { id: string; rowKind: "ordered" | "detected"; height: number; index: number }) => {
      setDraggingState({ id: info.id, rowKind: info.rowKind, height: info.height });
      setHoverSlot(info.index);
      // Freeze the layouts snapshot for the duration of this drag.
      dragLayoutsRef.current = layoutsRef.current.map((l) => (l ? { ...l } : null));
      // Snapshot the wrapper View's viewport-Y. measureInWindow is async on
      // native; the gap to the first move event is many frames in practice.
      // On RN-Web this falls through to getBoundingClientRect on the div.
      const wrap = scrollWrapRef.current as unknown as {
        measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void;
      } | null;
      const setOrigin = (y: number) => {
        dragOriginRef.current = {
          scrollViewPageY: y,
          scrollOffsetY: scrollOffsetYRef.current,
        };
      };
      if (wrap?.measureInWindow) {
        wrap.measureInWindow((_x, y) => setOrigin(y));
      }
      // Web fallback: getBoundingClientRect synchronously, in case
      // measureInWindow's callback is delayed past the first move event.
      if (Platform.OS === "web") {
        const node = scrollWrapRef.current as unknown as {
          getBoundingClientRect?: () => { top: number };
        } | null;
        const rect = node?.getBoundingClientRect?.();
        if (rect) setOrigin(rect.top);
      }
    },
    [],
  );

  // Convert a touch's page-Y (RNGH absoluteY on native, DOM clientY on web)
  // into a hover slot.
  const updateHoverFromPageY = useCallback((touchPageY: number) => {
    const origin = dragOriginRef.current;
    const layouts = dragLayoutsRef.current;
    if (!origin || layouts.length === 0) return;
    const contentY = touchPageY - origin.scrollViewPageY + origin.scrollOffsetY;
    setHoverSlot(computeHoverSlot(layouts, contentY));
  }, []);

  const finishDrag = useCallback(
    (slot: number) => {
      const state = draggingState;
      setDraggingState(null);
      setHoverSlot(null);
      dragOriginRef.current = null;
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
    // Append to bottom of the visible ordered list (filter-aware).
    positionMutation.mutate({
      item,
      nextPosition: midpointAt(filtered.ordered, filtered.ordered.length),
    });
  };
  const onPromoteToTop = (item: Item) => {
    positionMutation.mutate({ item, nextPosition: midpointAt(filtered.ordered, 0) });
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
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
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
            description={albumShelfErrorMessage(itemsQuery.error, "Unknown error")}
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
        <View ref={scrollWrapRef} style={styles.scrollWrap}>
          <ScrollView
            testID="album-shelf-list"
            contentContainerStyle={styles.listContent}
            // Disable scroll while a drag is active so the drag gesture owns
            // vertical movement. RN's gesture-handler should claim it via
            // simultaneousWithExternalGesture, but explicit is safer.
            scrollEnabled={!draggingState}
            onScroll={onScroll}
            scrollEventThrottle={16}
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
              return (
                <View key={key} onLayout={onEntryLayout(index)}>
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
                    onDragMove: isRowEntry(entry) ? updateHoverFromPageY : undefined,
                    onDragEnd: isRowEntry(entry) ? () => finishDrag(hoverSlot ?? index) : undefined,
                  })}
                </View>
              );
            })}
            {/*
            Drop indicator: a thin colored line at the gap where the dragged
            row would land. Absolutely positioned in CONTENT coordinates so
            it never shifts layout (which would otherwise invalidate
            dragLayoutsRef and feed back into the slot math).
          */}
            {draggingState && hoverSlot !== null ? (
              <View
                pointerEvents="none"
                style={[
                  styles.dropIndicator,
                  { top: dropIndicatorY(dragLayoutsRef.current, hoverSlot) },
                ]}
                testID="album-shelf-drop-indicator"
              />
            ) : null}
          </ScrollView>
        </View>
      )}

      {draggingState ? (
        <View style={styles.dragHint} pointerEvents="none">
          <Text variant="caption" tone="onAccent">
            Drag across the divider to promote / demote · release to drop
          </Text>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function isRowEntry(e: Entry): e is Extract<Entry, { kind: "ordered-row" | "detected-row" }> {
  return e.kind === "ordered-row" || e.kind === "detected-row";
}

function dropIndicatorY(
  layouts: Array<{ y: number; height: number } | null>,
  slot: number,
): number {
  // Y-position (in ScrollView CONTENT coords) of the gap between
  // entry[slot-1] and entry[slot]. Slot 0 → top of first entry. Slot N →
  // bottom of last entry. Missing layouts fall through to the next valid one.
  if (slot <= 0) {
    for (let i = 0; i < layouts.length; i++) {
      const l = layouts[i];
      if (l) return l.y;
    }
    return 0;
  }
  if (slot >= layouts.length) {
    for (let i = layouts.length - 1; i >= 0; i--) {
      const l = layouts[i];
      if (l) return l.y + l.height;
    }
    return 0;
  }
  const above = layouts[slot - 1];
  if (above) return above.y + above.height;
  const below = layouts[slot];
  if (below) return below.y;
  return 0;
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
  onDragMove?: (pageY: number) => void;
  onDragEnd?: () => void;
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
      isDragSource={args.isDragSource}
      addedByName={args.addedByName}
      onMenu={args.onMenu ?? noop}
      onBeginDrag={args.onBeginDrag ?? noopHeight}
      onDragMove={args.onDragMove ?? noopPageY}
      onDragEnd={args.onDragEnd ?? noop}
    />
  );
}

const noop = () => {};
const noopHeight = (_height: number) => {};
const noopPageY = (_pageY: number) => {};

interface DraggableAlbumRowProps {
  item: Item;
  isOrdered: boolean;
  indexLabel: string;
  isNew: boolean;
  isDragSource: boolean;
  addedByName: string | null;
  onMenu: () => void;
  onBeginDrag: (height: number) => void;
  onDragMove: (pageY: number) => void;
  onDragEnd: () => void;
}

function DraggableAlbumRow({
  item,
  isOrdered,
  indexLabel,
  isNew,
  isDragSource,
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
  const isWeb = Platform.OS === "web";

  // Local shared values for the visual lift while this row is the drag
  // source. translateY follows the finger; scale gives a "picked up" cue.
  // We do NOT hide the source row — keeping it visible (lifted) is what
  // gives the user a thing to follow with their finger / cursor.
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const elevation = useSharedValue(0);
  const heightRef = useRef(0);

  const startDragJS = useCallback(() => {
    onBeginDrag(heightRef.current);
  }, [onBeginDrag]);
  const moveDragJS = useCallback(
    (pageY: number) => {
      onDragMove(pageY);
    },
    [onDragMove],
  );
  const endDragJS = useCallback(() => {
    onDragEnd();
  }, [onDragEnd]);

  const settle = useCallback(() => {
    translateY.value = withTiming(0, { duration: 180 });
    scale.value = withTiming(1, { duration: 180 });
    elevation.value = 0;
  }, [elevation, scale, translateY]);

  const lift = useCallback(() => {
    scale.value = withTiming(1.03, { duration: 120 });
    elevation.value = 1;
  }, [elevation, scale]);

  // Web-only: drive the drag via DOM pointer events on the handle. RNGH's
  // web impl + Reanimated 4 don't reliably activate Pan from mouse input,
  // so on web we bypass the gesture pipeline entirely. On native this hook
  // returns an empty handler set (and we won't attach it anyway).
  const webDragHandlers = useWebDragHandlers({
    onBegin: () => {
      lift();
      onBeginDrag(heightRef.current);
    },
    onMove: (clientY, deltaY) => {
      translateY.value = deltaY;
      onDragMove(clientY);
    },
    onEnd: () => {
      onDragEnd();
      settle();
    },
    onCancel: () => {
      settle();
    },
  });

  // Native gestures: long-press anywhere on the row OR an immediate grab on
  // the handle. We don't compose them explicitly — RNGH's nesting semantics
  // already pick whichever activates first.
  const bodyPan = Gesture.Pan()
    .enabled(!isWeb)
    .activateAfterLongPress(LONG_PRESS_MS)
    .onStart(() => {
      "worklet";
      scale.value = withTiming(1.03, { duration: 120 });
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
    .enabled(!isWeb)
    .minDistance(2)
    .onStart(() => {
      "worklet";
      scale.value = withTiming(1.03, { duration: 120 });
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
  // Web-only style props (touchAction, cursor, userSelect) aren't in RN's
  // ViewStyle types but RN-Web honours them. Cast to unknown to keep TS quiet.
  const webTouchAction = isWeb ? ({ touchAction: "none" } as unknown as object) : null;
  const webHandleStyle = isWeb
    ? ({ touchAction: "none", cursor: "grab", userSelect: "none" } as unknown as object)
    : null;

  const handle = isWeb ? (
    <View
      accessibilityRole="button"
      accessibilityLabel={`Drag handle for ${item.title}`}
      testID={`album-row-handle-${item.id}`}
      style={[styles.rowDragHandle, webHandleStyle]}
      {...(webDragHandlers as Record<string, unknown>)}
    >
      <Text style={styles.dragHandleGlyph}>≡</Text>
    </View>
  ) : (
    <GestureDetector gesture={handlePan}>
      <View
        accessibilityRole="button"
        accessibilityLabel={`Drag handle for ${item.title}`}
        testID={`album-row-handle-${item.id}`}
        style={styles.rowDragHandle}
      >
        <Text style={styles.dragHandleGlyph}>≡</Text>
      </View>
    </GestureDetector>
  );

  const rowBody = (
    <Animated.View
      style={[animatedStyle, webTouchAction, isDragSource && styles.rowDragSource]}
      onLayout={(e) => {
        heightRef.current = e.nativeEvent.layout.height;
      }}
    >
      <Card style={[styles.row, isNew && styles.rowNew]} testID={`album-row-${item.id}`}>
        {handle}
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
  );

  if (isWeb) return rowBody;

  return <GestureDetector gesture={bodyPan}>{rowBody}</GestureDetector>;
}

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
  scrollWrap: { flex: 1 },
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
    paddingHorizontal: tokens.space.sm,
    paddingVertical: tokens.space.md,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 32,
  },
  dragHandleGlyph: {
    color: tokens.text.secondary,
    fontSize: tokens.font.size.xl,
    lineHeight: tokens.font.size.xl + 2,
  },
  rowDragSource: {
    opacity: 0.85,
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
  dropIndicator: {
    position: "absolute",
    left: tokens.space.xl,
    right: tokens.space.xl,
    height: 4,
    marginTop: -2,
    borderRadius: 2,
    backgroundColor: tokens.accent.default,
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
