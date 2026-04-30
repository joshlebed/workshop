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
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { fetchAlbumShelfItems, refreshAlbumShelf } from "../api/albumShelf";
import { deleteItem, updateItem } from "../api/items";
import { ApiError } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { formatRelative } from "../lib/relativeTime";
import { Button, Card, EmptyState, type ListColorKey, Text, tokens, useToast } from "../ui/index";

interface Props {
  list: List;
  members: ListMemberSummary[];
  token: string | null;
  onBack: () => void;
  onSettings: () => void;
}

/**
 * Album Shelf list-detail screen. Distinct enough from the standard
 * list-detail (no upvote, no completed checkmark, no FAB; refresh button +
 * ordered/detected sections + per-row context menu) that it lives in its
 * own component rather than branching the standard one.
 *
 * Drag-to-reorder is intentionally not in v1.1 — `react-native-draggable-
 * flatlist` doesn't drag across multiple FlatLists out of the box, so
 * promotion/demotion + reordering is exposed via the row context menu
 * (Move up / Move down / Move to top / Move to bottom / Move to ordered /
 * Move to detected / Delete). docs/album-shelf.md §10.7 explicitly allows
 * this fallback.
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
  // fades after 3s. We track ids in state because we need a re-render to
  // clear the highlight after the timer fires.
  const [newItemIds, setNewItemIds] = useState<Set<string>>(() => new Set());
  // Stash a snapshot of item ids before each refresh so we can diff after.
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
      // Compute the freshly-detected ids by diffing post-refresh items against
      // the snapshot taken in `onMutate`.
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

  // Clear "new" pills 3s after the latest refresh batch lands. Re-running
  // useEffect on every set transition is fine — we always replace the whole
  // set on success, so a single timer per set is enough.
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
    // The backend's `albumShelfItemPatchSchema` is `.strict()` and only accepts
    // `{ position }` — every other field on `AlbumShelfItemMetadata` is derived
    // from Spotify and immutable client-side. Server merges `position` into
    // the existing row.
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

  // userId → displayName lookup so per-row "added by @kira" + the header
  // subline can resolve names without an extra query. Unknown ids fall
  // through to "someone".
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

  // Move an item to a target position relative to the existing ordered list.
  // `index === 0` → top (midpoint with first or 0.5 if list empty).
  // `index === ordered.length` → bottom (max + 1 or 1).
  // Otherwise → midpoint between adjacent ordered rows (spec §3.3.1
  // gap-insert with floats).
  const computeInsertPosition = (index: number): number => {
    const positions = orderedRaw
      .map((it) => positionOf(it))
      .filter((p): p is number => typeof p === "number");
    if (positions.length === 0) return 1;
    if (index <= 0) {
      const first = positions[0] ?? 1;
      return first / 2;
    }
    if (index >= positions.length) {
      const last = positions[positions.length - 1] ?? 0;
      return last + 1;
    }
    const before = positions[index - 1] ?? 0;
    const after = positions[index] ?? before + 2;
    return (before + after) / 2;
  };

  const onPromote = (item: Item) => {
    // Default: append to bottom of ordered. Same UX pre-fix.
    positionMutation.mutate({ item, nextPosition: computeInsertPosition(orderedRaw.length) });
  };
  const onPromoteToTop = (item: Item) => {
    positionMutation.mutate({ item, nextPosition: computeInsertPosition(0) });
  };
  const onDemote = (item: Item) => {
    positionMutation.mutate({ item, nextPosition: null });
  };
  const onMoveUp = (item: Item) => {
    const idx = orderedRaw.findIndex((it) => it.id === item.id);
    if (idx <= 0) return; // already top
    // Insert at idx-1 (between row [idx-2] and row [idx-1]). Skip the target
    // itself so the recomputed positions reflect a list without `item`.
    const without = orderedRaw.filter((it) => it.id !== item.id);
    const next = midpointAt(without, idx - 1);
    positionMutation.mutate({ item, nextPosition: next });
  };
  const onMoveDown = (item: Item) => {
    const idx = orderedRaw.findIndex((it) => it.id === item.id);
    if (idx < 0 || idx >= orderedRaw.length - 1) return; // already bottom
    const without = orderedRaw.filter((it) => it.id !== item.id);
    // Move to idx+1 in the original list = idx in the without-self list
    // (because we removed self at idx).
    const next = midpointAt(without, idx + 1);
    positionMutation.mutate({ item, nextPosition: next });
  };

  const sections = useMemo(() => {
    type SectionLike = { key: "ordered" | "detected"; title: string; data: Item[] };
    const out: SectionLike[] = [];
    if (filtered.ordered.length > 0) {
      out.push({ key: "ordered", title: "Ordered", data: filtered.ordered });
    }
    if (filtered.detected.length > 0) {
      out.push({ key: "detected", title: "Detected", data: filtered.detected });
    }
    return out;
  }, [filtered.ordered, filtered.detected]);

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

  const showOrderedHint =
    filtered.ordered.length === 0 && filtered.detected.length > 0 && filter.trim().length === 0;

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
      ) : sections.length === 0 ? (
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
        <SectionList
          testID="album-shelf-list"
          sections={sections}
          stickySectionHeadersEnabled
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            showOrderedHint ? (
              <View style={styles.orderedHint} testID="album-shelf-ordered-hint">
                <Text variant="caption" tone="secondary">
                  Tap ⋮ on a detected album → "Move to ordered" to start ranking your shelf.
                </Text>
              </View>
            ) : null
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader} testID={`album-shelf-section-${section.key}`}>
              <Text variant="label" tone="secondary">
                {section.title.toUpperCase()} ({section.data.length})
              </Text>
            </View>
          )}
          ItemSeparatorComponent={SectionSpacer}
          renderItem={({ item, index, section }) => {
            const isOrdered = section.key === "ordered";
            const orderedIndex = isOrdered ? index : -1;
            const orderedTotal = isOrdered ? section.data.length : 0;
            const addedByName = memberNameById.get(item.addedBy) ?? null;
            return (
              <AlbumRow
                item={item}
                indexLabel={isOrdered ? String(index + 1) : "•"}
                isOrdered={isOrdered}
                isFirst={isOrdered && orderedIndex === 0}
                isLast={isOrdered && orderedIndex === orderedTotal - 1}
                isNew={!isOrdered && newItemIds.has(item.id)}
                addedByName={addedByName}
                onPromote={() => onPromote(item)}
                onPromoteToTop={() => onPromoteToTop(item)}
                onDemote={() => onDemote(item)}
                onMoveUp={() => onMoveUp(item)}
                onMoveDown={() => onMoveDown(item)}
                onDelete={() => onRowDelete(item)}
              />
            );
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => refreshMutation.mutate()}
              tintColor={tokens.accent.default}
            />
          }
        />
      )}
    </View>
  );
}

function SectionSpacer() {
  return <View style={{ height: tokens.space.sm }} />;
}

interface AlbumRowProps {
  item: Item;
  indexLabel: string;
  isOrdered: boolean;
  isFirst: boolean;
  isLast: boolean;
  isNew: boolean;
  addedByName: string | null;
  onPromote: () => void;
  onPromoteToTop: () => void;
  onDemote: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

function AlbumRow({
  item,
  indexLabel,
  isOrdered,
  isFirst,
  isLast,
  isNew,
  addedByName,
  onPromote,
  onPromoteToTop,
  onDemote,
  onMoveUp,
  onMoveDown,
  onDelete,
}: AlbumRowProps) {
  const meta = item.metadata as Partial<AlbumShelfItemMetadata>;
  const cover = meta.coverUrl;
  const artist = meta.artist ?? "";
  const year = meta.year;
  const subline = year ? `${artist} · ${year}` : artist;

  // Per spec §4.2 each row has a third subline: "added <date> by @<who>" for
  // ordered items, "detected <relative>" for detected items.
  const detectedAt = typeof meta.detectedAt === "string" ? meta.detectedAt : null;
  const provenance = isOrdered
    ? addedByName
      ? `added ${formatRelative(item.createdAt)} by @${addedByName}`
      : `added ${formatRelative(item.createdAt)}`
    : detectedAt
      ? `detected ${formatRelative(detectedAt)}`
      : "detected";

  const onMenu = () => {
    type Action = { text: string; onPress?: () => void; style?: "destructive" | "cancel" };
    const actions: Action[] = [];
    if (isOrdered) {
      if (!isFirst) actions.push({ text: "Move up", onPress: onMoveUp });
      if (!isLast) actions.push({ text: "Move down", onPress: onMoveDown });
      actions.push({ text: "Move to detected", onPress: onDemote });
    } else {
      actions.push({ text: "Move to ordered (bottom)", onPress: onPromote });
      actions.push({ text: "Move to ordered (top)", onPress: onPromoteToTop });
    }
    actions.push({ text: "Delete album", style: "destructive", onPress: onDelete });
    actions.push({ text: "Cancel", style: "cancel" });
    Alert.alert(item.title, undefined, actions);
  };

  return (
    <Card style={[styles.row, isNew && styles.rowNew]} testID={`album-row-${item.id}`}>
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
  );
}

function positionOf(it: Item): number | null {
  const m = it.metadata as Partial<AlbumShelfItemMetadata>;
  return typeof m.position === "number" ? m.position : null;
}

function midpointAt(orderedItems: Item[], index: number): number {
  const positions = orderedItems
    .map((it) => positionOf(it))
    .filter((p): p is number => typeof p === "number");
  if (positions.length === 0) return 1;
  if (index <= 0) {
    const first = positions[0] ?? 1;
    return first / 2;
  }
  if (index >= positions.length) {
    const last = positions[positions.length - 1] ?? 0;
    return last + 1;
  }
  const before = positions[index - 1] ?? 0;
  const after = positions[index] ?? before + 2;
  return (before + after) / 2;
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

// Use ListColor in a no-op assertion to keep ts-reset's unused-import nag
// quiet without changing the public API.
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
  // Sticky section headers need a non-transparent background; if the list
  // scrolls past them they otherwise overlap the rows below.
  sectionHeader: {
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
    backgroundColor: tokens.bg.canvas,
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
});
