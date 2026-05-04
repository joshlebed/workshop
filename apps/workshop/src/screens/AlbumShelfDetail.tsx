import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AlbumShelfItemsResponse,
  AlbumShelfListMetadata,
  AlbumShelfRefreshResponse,
  Item,
  ItemMetadata,
  List,
  ListMemberSummary,
} from "@workshop/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { fetchAlbumShelfItems, refreshAlbumShelf } from "../api/albumShelf";
import { deleteItem, updateItem } from "../api/items";
import { albumShelfErrorMessage } from "../lib/albumShelfErrors";
import { applyPositionPatch, midpointAt } from "../lib/albumShelfPositions";
import { queryKeys } from "../lib/queryKeys";
import { formatRelative } from "../lib/relativeTime";
import { Button, EmptyState, type ListColorKey, Text, tokens, useToast } from "../ui/index";
import { AlbumRowMenu, type AlbumRowMenuActions } from "./albumShelfList/AlbumRowMenu";
import { AlbumShelfList } from "./albumShelfList/AlbumShelfList";
import { resolveReorder } from "./albumShelfList/resolveReorder";
import type { ReorderEvent } from "./albumShelfList/shelfListProps";
import type { ShelfEntry } from "./albumShelfList/types";

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
 * ordered/detected sections + drag-to-reorder + per-row context menu) that
 * it lives in its own component rather than branching the standard one.
 *
 * Drag-to-reorder is delegated to a platform-specific list:
 *   - native: `AlbumShelfList.tsx` (uses react-native-reorderable-list,
 *     gets autoscroll + haptics + sibling animations for free)
 *   - web:    `AlbumShelfList.web.tsx` (uses @dnd-kit/sortable)
 *
 * Both libraries report drag end as `{from, to}` indices in the flat
 * entries list. The pure `resolveReorder` helper turns that into a
 * `{position}` mutation, handling cross-section promote/demote.
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

  // After a successful refresh we mark item ids that are newly arrived so
  // detected rows can render the "new" pill briefly. Per spec §4.4: the
  // pill fades after 3s.
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
      const meta = it.metadata as { artist?: string };
      const haystack = `${it.title} ${meta.artist ?? ""}`.toLowerCase();
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

  const entries: ShelfEntry[] = useMemo(() => {
    const out: ShelfEntry[] = [];
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

  const onReorder = (event: ReorderEvent) => {
    const result = resolveReorder({ entries, from: event.from, to: event.to });
    if (result.kind === "noop") return;
    const dragged = entries[event.from];
    if (!dragged || (dragged.kind !== "ordered-row" && dragged.kind !== "detected-row")) return;
    positionMutation.mutate({ item: dragged.item, nextPosition: result.nextPosition });
  };

  // The row menu sits above the list as a single bottom sheet rather than
  // recreating per-row triggers. `Alert.alert(title, undefined, actions)`
  // (the previous impl) silently no-ops on react-native-web with 3+
  // buttons, which is why the kebab menu was broken on the web build.
  const [menuItem, setMenuItem] = useState<Item | null>(null);
  const [menuActions, setMenuActions] = useState<AlbumRowMenuActions | null>(null);

  const closeMenu = () => {
    setMenuItem(null);
    setMenuActions(null);
  };

  const onRowMenu = (entry: Extract<ShelfEntry, { kind: "ordered-row" | "detected-row" }>) => {
    const isOrdered = entry.kind === "ordered-row";
    setMenuItem(entry.item);
    setMenuActions({
      isOrdered,
      onPromote: () =>
        positionMutation.mutate({
          item: entry.item,
          nextPosition: midpointAt(filtered.ordered, filtered.ordered.length),
        }),
      onPromoteToTop: () =>
        positionMutation.mutate({
          item: entry.item,
          nextPosition: midpointAt(filtered.ordered, 0),
        }),
      onDemote: () => positionMutation.mutate({ item: entry.item, nextPosition: null }),
      onDelete: () =>
        Alert.alert(
          "Remove this album?",
          "Removing this album won't stop it from coming back. If a track from this album is still on the source playlist, the next refresh will re-detect it.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: () => deleteMutation.mutate({ itemId: entry.item.id }),
            },
          ],
        ),
    });
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
        <View style={styles.listWrap}>
          <AlbumShelfList
            entries={entries}
            newItemIds={newItemIds}
            memberNameById={memberNameById}
            onReorder={onReorder}
            onRowMenu={onRowMenu}
          />
        </View>
      )}
      <AlbumRowMenu item={menuItem} actions={menuActions} onClose={closeMenu} />
    </KeyboardAvoidingView>
  );
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
  listWrap: { flex: 1 },
});
