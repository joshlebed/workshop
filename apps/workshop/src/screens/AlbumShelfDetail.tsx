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
} from "@workshop/shared";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { fetchAlbumShelfItems, refreshAlbumShelf } from "../api/albumShelf";
import { deleteItem, updateItem } from "../api/items";
import { ApiError } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { Button, Card, EmptyState, type ListColorKey, Text, tokens, useToast } from "../ui/index";

interface Props {
  list: List;
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
 * promotion/demotion is exposed via the row context menu (Promote /
 * Demote / Delete). Drag is a follow-up.
 */
export function AlbumShelfDetail({ list, token, onBack, onSettings }: Props) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [filter, setFilter] = useState("");
  const itemsKey = queryKeys.albumShelf.items(list.id);

  const itemsQuery = useQuery({
    queryKey: itemsKey,
    queryFn: () => fetchAlbumShelfItems(list.id, token),
    enabled: !!token,
  });

  const refreshMutation = useMutation<AlbumShelfRefreshResponse, Error, void>({
    mutationFn: () => refreshAlbumShelf(list.id, token),
    onSuccess: (res) => {
      queryClient.setQueryData<AlbumShelfItemsResponse>(itemsKey, {
        ordered: res.ordered,
        detected: res.detected,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(list.id) });
      const added = res.addedCount;
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

  const positionMutation = useMutation<
    Item,
    Error,
    { item: Item; nextPosition: number | null },
    { previous?: AlbumShelfItemsResponse }
  >({
    // The backend's `albumShelfItemPatchSchema` is `.strict()` and only accepts
    // `{ position }` — every other field on `AlbumShelfItemMetadata` is derived
    // from Spotify and immutable client-side. Sending the full merged blob
    // gets rejected with `invalid metadata for list type` because of the strict
    // unrecognized-keys check. Server merges `position` into the existing row.
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

  const accent =
    (list.color as ListColorKey) in tokens.list
      ? tokens.list[list.color as ListColorKey]
      : tokens.accent.default;
  const meta = list.metadata as Partial<AlbumShelfListMetadata>;
  const lastRefreshedAt = meta.lastRefreshedAt;
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

  const onPromote = (item: Item) => {
    const positions = orderedRaw
      .map((it) => (it.metadata as unknown as AlbumShelfItemMetadata).position)
      .filter((p): p is number => typeof p === "number");
    const nextPosition = positions.length === 0 ? 1 : Math.max(...positions) + 1;
    positionMutation.mutate({ item, nextPosition });
  };

  const onDemote = (item: Item) => {
    positionMutation.mutate({ item, nextPosition: null });
  };

  const sections: SectionData[] = [];
  if (filtered.ordered.length > 0) {
    sections.push({
      key: "ordered",
      title: "Ordered",
      items: filtered.ordered.map((it, i) => ({ item: it, indexLabel: String(i + 1) })),
    });
  }
  if (filtered.detected.length > 0) {
    sections.push({
      key: "detected",
      title: "Detected",
      items: filtered.detected.map((it) => ({ item: it, indexLabel: "•" })),
    });
  }

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
          {lastRefreshedAt ? (
            <Text variant="caption" tone="muted" style={styles.subline}>
              {`Last refreshed ${formatRelative(lastRefreshedAt)}`}
            </Text>
          ) : (
            <Text variant="caption" tone="muted" style={styles.subline}>
              Pull from Spotify by tapping refresh.
            </Text>
          )}
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
        <FlatList
          testID="album-shelf-list"
          data={sections}
          keyExtractor={(s) => s.key}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: tokens.space.lg }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => refreshMutation.mutate()}
              tintColor={tokens.accent.default}
            />
          }
          renderItem={({ item: section }) => (
            <View>
              <View style={styles.sectionHeader}>
                <Text variant="label" tone="secondary">
                  {section.title.toUpperCase()} ({section.items.length})
                </Text>
              </View>
              <View style={styles.sectionList}>
                {section.items.map(({ item, indexLabel }) => (
                  <AlbumRow
                    key={item.id}
                    item={item}
                    indexLabel={indexLabel}
                    isOrdered={section.key === "ordered"}
                    onPromote={() => onPromote(item)}
                    onDemote={() => onDemote(item)}
                    onDelete={() => onRowDelete(item)}
                  />
                ))}
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

interface SectionData {
  key: "ordered" | "detected";
  title: string;
  items: Array<{ item: Item; indexLabel: string }>;
}

interface AlbumRowProps {
  item: Item;
  indexLabel: string;
  isOrdered: boolean;
  onPromote: () => void;
  onDemote: () => void;
  onDelete: () => void;
}

function AlbumRow({ item, indexLabel, isOrdered, onPromote, onDemote, onDelete }: AlbumRowProps) {
  const meta = item.metadata as Partial<AlbumShelfItemMetadata>;
  const cover = meta.coverUrl;
  const artist = meta.artist ?? "";
  const year = meta.year;
  const subline = year ? `${artist} · ${year}` : artist;

  const onMenu = () => {
    const promoteOrDemote = isOrdered
      ? { text: "Move to detected", onPress: onDemote }
      : { text: "Move to ordered", onPress: onPromote };
    Alert.alert(item.title, undefined, [
      promoteOrDemote,
      { text: "Delete album", style: "destructive", onPress: onDelete },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <Card style={styles.row} testID={`album-row-${item.id}`}>
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
        <Text numberOfLines={1} style={styles.rowTitle}>
          {item.title}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {subline}
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
      (a, b) =>
        ((a.metadata as unknown as AlbumShelfItemMetadata).position ?? 0) -
        ((b.metadata as unknown as AlbumShelfItemMetadata).position ?? 0),
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

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.max(1, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
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
  subline: { textAlign: "center" },
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
  sectionHeader: { paddingBottom: tokens.space.sm },
  sectionList: { gap: tokens.space.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    padding: tokens.space.md,
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
  rowTitle: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.regular,
  },
  menuBtn: { paddingHorizontal: tokens.space.sm, paddingVertical: tokens.space.xs },
  menuBtnPressed: { opacity: 0.6 },
  menuGlyph: { fontSize: tokens.font.size.lg, color: tokens.text.secondary },
});
