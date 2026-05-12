import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AlbumShelfListMetadata,
  AlbumShelfRefreshResponse,
  Item,
  ItemMetadata,
  List,
  ListItemsResponse,
  ListMemberSummary,
} from "@workshop/shared";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { refreshAlbumShelf } from "../api/albumShelf";
import { completeItem, deleteItem, fetchItems, uncompleteItem, updateItem } from "../api/items";
import { albumShelfErrorMessage } from "../lib/albumShelfErrors";
import {
  applyPositionPatch,
  midpointAt,
  midpointForOrderedReorder,
} from "../lib/albumShelfPositions";
import { errorMessage } from "../lib/api";
import { haptics } from "../lib/haptics";
import { queryKeys } from "../lib/queryKeys";
import { formatRelative } from "../lib/relativeTime";
import { Button, EmptyState, type ListColorKey, Text, tokens, useToast } from "../ui/index";
import { ItemList } from "./listDetail/ItemList";
import { ItemRowMenu, type ItemRowMenuActions } from "./listDetail/ItemRowMenu";
import type { ReorderEvent } from "./listDetail/listProps";
import type { Section } from "./listDetail/types";

interface Props {
  list: List;
  members: ListMemberSummary[];
  token: string | null;
}

/**
 * Unified list-detail screen for every list type. The album-shelf pattern
 * (ordered + unordered + completed sections, drag-to-reorder, kebab menu)
 * generalises to all list types since the 2026-05 ordering refactor —
 * there is no separate standard / album-shelf screen any more.
 *
 * Type-specific behaviour:
 *   - album_shelf: refresh button (instead of FAB), body-press opens
 *     Spotify, "DETECTED" section label, NEW pill on freshly-detected
 *     rows, no Edit menu action (fields are server-derived from Spotify).
 *   - other types: FAB to add an item, body-press opens the item-detail
 *     screen, "UNORDERED" section label, kebab includes Edit.
 *
 * Drag-to-reorder is scoped to the ordered section only and delegated to
 * a platform-specific list:
 *   - native: `ItemList.tsx` (react-native-reorderable-list)
 *   - web:    `ItemList.web.tsx` (@dnd-kit/sortable)
 * Both libraries report drag end as `{fromIndex, toIndex}` inside the
 * ordered array; this screen translates that into a `{position}` PATCH.
 * Cross-section transitions (promote / demote / mark complete) all flow
 * through the kebab menu — keeping section headers out of any sortable
 * container is what fixed the layout glitch where a section header could
 * end up rendered below its rows after a cross-section drag.
 */
export function ListDetail({ list, members, token }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [filter, setFilter] = useState("");
  const isAlbumShelf = list.type === "album_shelf";
  const itemsKey = queryKeys.items.byList(list.id);

  const itemsQuery = useQuery({
    queryKey: itemsKey,
    queryFn: () => fetchItems(list.id, token),
    enabled: !!token,
  });

  // After a successful refresh we mark item ids that are newly arrived so
  // unordered rows can render the "new" pill briefly. Album-shelf only.
  const [newItemIds, setNewItemIds] = useState<Set<string>>(() => new Set());
  const beforeRefreshIdsRef = useRef<Set<string> | null>(null);

  const refreshMutation = useMutation<AlbumShelfRefreshResponse, Error, void>({
    mutationFn: () => refreshAlbumShelf(list.id, token),
    onMutate: () => {
      const cur = queryClient.getQueryData<ListItemsResponse>(itemsKey);
      const prevIds = new Set<string>();
      if (cur) {
        for (const it of cur.ordered) prevIds.add(it.id);
        for (const it of cur.unordered) prevIds.add(it.id);
        for (const it of cur.completed) prevIds.add(it.id);
      }
      beforeRefreshIdsRef.current = prevIds;
    },
    onSuccess: (res) => {
      queryClient.setQueryData<ListItemsResponse>(itemsKey, {
        ordered: res.ordered,
        unordered: res.unordered,
        completed: res.completed,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(list.id) });
      const added = res.addedCount;
      const before = beforeRefreshIdsRef.current ?? new Set<string>();
      const fresh = new Set<string>();
      for (const it of res.unordered) {
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
    { previous?: ListItemsResponse }
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
      const previous = queryClient.getQueryData<ListItemsResponse>(itemsKey);
      if (previous) {
        const next = applyPositionPatch(previous, item.id, nextPosition);
        queryClient.setQueryData<ListItemsResponse>(itemsKey, next);
      }
      return previous ? { previous } : {};
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(itemsKey, ctx.previous);
      showToast({
        message: errorMessage(e, "Couldn't move that item."),
        tone: "danger",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: itemsKey });
    },
  });

  const completeMutation = useMutation<Item, Error, { item: Item; nextCompleted: boolean }>({
    mutationFn: async ({ item, nextCompleted }) => {
      const res = nextCompleted
        ? await completeItem(item.id, token)
        : await uncompleteItem(item.id, token);
      return res.item;
    },
    onSuccess: () => {
      haptics.medium();
      queryClient.invalidateQueries({ queryKey: itemsKey });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't update item."), tone: "danger" });
    },
  });

  const deleteMutation = useMutation<{ ok: true }, Error, { itemId: string }>({
    mutationFn: ({ itemId }) => deleteItem(itemId, token),
    onSuccess: () => {
      haptics.medium();
      queryClient.invalidateQueries({ queryKey: itemsKey });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
    },
    onError: (e) => {
      showToast({
        message: errorMessage(e, "Couldn't delete that item."),
        tone: "danger",
      });
    },
  });

  const data = itemsQuery.data;
  const orderedRaw = data?.ordered ?? [];
  const unorderedRaw = data?.unordered ?? [];
  const completedRaw = data?.completed ?? [];

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return { ordered: orderedRaw, unordered: unorderedRaw, completed: completedRaw };
    const matches = (it: Item) => {
      const meta = it.metadata as { artist?: string; authors?: string[] };
      const haystack = [
        it.title,
        it.note ?? "",
        meta.artist ?? "",
        Array.isArray(meta.authors) ? meta.authors.join(" ") : "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    };
    return {
      ordered: orderedRaw.filter(matches),
      unordered: unorderedRaw.filter(matches),
      completed: completedRaw.filter(matches),
    };
  }, [orderedRaw, unorderedRaw, completedRaw, filter]);

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
    filtered.ordered.length === 0 &&
    (filtered.unordered.length > 0 || filtered.completed.length > 0) &&
    filter.trim().length === 0;

  const totalRows = filtered.ordered.length + filtered.unordered.length + filtered.completed.length;

  const onReorderOrdered = (event: ReorderEvent) => {
    const item = filtered.ordered[event.fromIndex];
    if (!item) return;
    const nextPosition = midpointForOrderedReorder(
      filtered.ordered,
      event.fromIndex,
      event.toIndex,
    );
    if (nextPosition === null) return;
    positionMutation.mutate({ item, nextPosition });
  };

  const [menuItem, setMenuItem] = useState<Item | null>(null);
  const [menuActions, setMenuActions] = useState<ItemRowMenuActions | null>(null);
  const closeMenu = () => {
    setMenuItem(null);
    setMenuActions(null);
  };

  const onRowMenu = (item: Item, section: Section) => {
    const confirmDelete = () => {
      Alert.alert(
        "Remove this item?",
        isAlbumShelf
          ? "Removing this album won't stop it from coming back. If a track from this album is still on the source playlist, the next refresh will re-detect it."
          : "Deleting this item is permanent.",
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
    setMenuItem(item);
    setMenuActions({
      section,
      isAlbumShelf,
      ...(section !== "ordered"
        ? {
            onPromote: () =>
              positionMutation.mutate({
                item,
                nextPosition: midpointAt(filtered.ordered, filtered.ordered.length),
              }),
            onPromoteToTop: () =>
              positionMutation.mutate({
                item,
                nextPosition: midpointAt(filtered.ordered, 0),
              }),
          }
        : {}),
      ...(section === "ordered"
        ? {
            onDemote: () => positionMutation.mutate({ item, nextPosition: null }),
          }
        : {}),
      ...(section !== "completed"
        ? {
            onComplete: () => completeMutation.mutate({ item, nextCompleted: true }),
          }
        : {}),
      ...(section === "completed"
        ? {
            onUncomplete: () => completeMutation.mutate({ item, nextCompleted: false }),
          }
        : {}),
      ...(!isAlbumShelf ? { onEdit: () => router.push(`/list/${list.id}/item/${item.id}`) } : {}),
      onDelete: confirmDelete,
    });
  };

  const onRowPressBody = (item: Item) => {
    if (isAlbumShelf) {
      const m = item.metadata as { spotifyAlbumUrl?: string };
      const url = m.spotifyAlbumUrl;
      if (!url) return;
      Linking.openURL(url).catch(() => {
        /* best effort — popup blocker / unsupported scheme is non-fatal */
      });
      return;
    }
    router.push(`/list/${list.id}/item/${item.id}`);
  };

  const headerSubline = useMemo(() => {
    const memberPart = `${members.length} ${members.length === 1 ? "member" : "members"}`;
    if (isAlbumShelf) {
      if (refreshing) return "Refreshing from Spotify…";
      if (!lastRefreshedAt) return `${memberPart} · tap ↻ to pull from Spotify`;
      const rel = formatRelative(lastRefreshedAt);
      const actor = lastRefreshedByName ? ` by @${lastRefreshedByName}` : "";
      return `${memberPart} · refreshed ${rel}${actor}`;
    }
    const total = orderedRaw.length + unorderedRaw.length + completedRaw.length;
    if (total === 0) return memberPart;
    return `${memberPart} · ${total} ${total === 1 ? "item" : "items"}`;
  }, [
    isAlbumShelf,
    refreshing,
    members.length,
    lastRefreshedAt,
    lastRefreshedByName,
    orderedRaw.length,
    unorderedRaw.length,
    completedRaw.length,
  ]);

  const isEmptyAfterFetch = !itemsQuery.isPending && !itemsQuery.isError && totalRows === 0;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.headerNav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          testID="list-detail-back"
          hitSlop={10}
          style={styles.navButton}
        >
          <Text style={styles.navGlyph}>‹</Text>
        </Pressable>
        <View style={styles.navActions}>
          {isAlbumShelf ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh from Spotify"
              onPress={() => refreshMutation.mutate()}
              disabled={refreshing}
              testID="list-detail-refresh"
              hitSlop={10}
              style={styles.navButton}
            >
              {refreshing ? (
                <ActivityIndicator color={tokens.accent.default} />
              ) : (
                <Text style={styles.navGlyph}>↻</Text>
              )}
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open list settings"
            onPress={() => router.push(`/list/${list.id}/settings`)}
            testID="list-detail-settings"
            hitSlop={10}
            style={styles.navButton}
          >
            <Text style={styles.navGlyph}>⋯</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.titleBlock}>
        <View style={[styles.titleBadge, { backgroundColor: `${accent}26` }]}>
          <Text style={styles.titleEmoji}>{list.emoji}</Text>
        </View>
        <View style={styles.titleText}>
          <Text variant="title" numberOfLines={2} style={styles.titleName}>
            {list.name}
          </Text>
          <Text variant="caption" tone="muted" style={styles.subline} testID="list-detail-subline">
            {headerSubline}
          </Text>
        </View>
      </View>

      <View style={styles.toolbar}>
        <View style={styles.filterWrap}>
          <Text style={styles.filterGlyph} tone="muted">
            ⌕
          </Text>
          <TextInput
            testID="list-detail-filter"
            value={filter}
            onChangeText={setFilter}
            placeholder={isAlbumShelf ? "Search this shelf" : "Filter items"}
            placeholderTextColor={tokens.text.muted}
            style={styles.filterInput}
            accessibilityLabel="Filter items"
          />
          {filter.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear filter"
              onPress={() => setFilter("")}
              hitSlop={8}
              style={styles.filterClear}
            >
              <Text tone="muted" style={styles.filterClearGlyph}>
                ✕
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {itemsQuery.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.accent.default} />
        </View>
      ) : itemsQuery.isError ? (
        <View style={styles.center}>
          <EmptyState
            title="Couldn't load list"
            description={
              isAlbumShelf
                ? albumShelfErrorMessage(itemsQuery.error, "Unknown error")
                : errorMessage(itemsQuery.error)
            }
            action={
              <Button
                label="Retry"
                variant="secondary"
                onPress={() => itemsQuery.refetch()}
                testID="list-detail-retry"
              />
            }
          />
        </View>
      ) : isEmptyAfterFetch ? (
        <View style={styles.center}>
          {isAlbumShelf ? (
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
                    testID="list-detail-empty-refresh"
                  />
                ) : undefined
              }
            />
          ) : (
            <EmptyState
              title="Nothing on the list"
              description="Add the first thing you want to remember."
              action={
                <Button
                  label="Add an item"
                  onPress={() => router.push(`/list/${list.id}/add`)}
                  testID="list-detail-empty-add"
                />
              }
            />
          )}
        </View>
      ) : (
        <View style={styles.listWrap}>
          <ItemList
            ordered={filtered.ordered}
            unordered={filtered.unordered}
            completed={filtered.completed}
            isAlbumShelf={isAlbumShelf}
            showOrderedHint={showOrderedHint}
            newItemIds={newItemIds}
            memberNameById={memberNameById}
            onReorderOrdered={onReorderOrdered}
            onRowMenu={onRowMenu}
            onRowPressBody={onRowPressBody}
          />
        </View>
      )}

      {!isAlbumShelf ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add item"
          onPress={() => router.push(`/list/${list.id}/add`)}
          style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
          testID="fab-add-item"
        >
          <Text style={styles.fabGlyph} tone="onAccent">
            +
          </Text>
        </Pressable>
      ) : null}

      <ItemRowMenu item={menuItem} actions={menuActions} onClose={closeMenu} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingTop: tokens.space.xl,
  },
  headerNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.sm,
  },
  navButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  navGlyph: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.xl,
  },
  navActions: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  titleBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.sm,
  },
  titleBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  titleEmoji: { fontSize: 26, lineHeight: 30 },
  titleText: { flex: 1, minWidth: 0, gap: 2 },
  titleName: { letterSpacing: -0.4 },
  subline: {},
  toolbar: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.lg,
    paddingBottom: tokens.space.sm,
  },
  filterWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: tokens.radius.pill,
    paddingHorizontal: tokens.space.md,
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
  },
  filterGlyph: { fontSize: tokens.font.size.md, marginRight: tokens.space.sm },
  filterInput: {
    flex: 1,
    paddingVertical: 9,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
  },
  filterClear: { paddingHorizontal: tokens.space.xs, paddingVertical: tokens.space.xs },
  filterClearGlyph: { fontSize: tokens.font.size.sm },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: tokens.space.xxl,
  },
  listWrap: { flex: 1 },
  fab: {
    position: "absolute",
    right: tokens.space.xl,
    bottom: tokens.space.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: tokens.accent.default,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPressed: { backgroundColor: tokens.accent.hover },
  fabGlyph: { fontSize: 28, fontWeight: tokens.font.weight.bold, lineHeight: 32 },
});
