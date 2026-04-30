import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Item, ItemListResponse, ItemResponse } from "@workshop/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import {
  completeItem,
  fetchItems,
  removeUpvote,
  uncompleteItem,
  upvoteItem,
} from "../../../src/api/items";
import { fetchListDetail } from "../../../src/api/lists";
import { useAuth } from "../../../src/hooks/useAuth";
import { ApiError } from "../../../src/lib/api";
import { haptics } from "../../../src/lib/haptics";
import { computeNewItemsDelta } from "../../../src/lib/newItemsPill";
import { queryKeys } from "../../../src/lib/queryKeys";
import { AlbumShelfDetail } from "../../../src/screens/AlbumShelfDetail";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  IconButton,
  type ListColorKey,
  NewItemsPill,
  Text,
  tokens,
  UpvotePill,
  useToast,
} from "../../../src/ui/index";

const NEW_ITEMS_SCROLL_THRESHOLD = 120;

export default function ListDetail() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [filter, setFilter] = useState("");
  const [newItemsCount, setNewItemsCount] = useState(0);
  const previousLengthRef = useRef<number | null>(null);
  const scrollYRef = useRef(0);
  const flatListRef = useRef<FlatList<Item>>(null);

  const listQuery = useQuery({
    queryKey: queryKeys.lists.detail(id ?? ""),
    queryFn: () => fetchListDetail(id ?? "", token),
    enabled: !!token && !!id,
  });

  // For album_shelf lists the server replies to /items with { ordered, detected }
  // (see lists.ts:512), not { items }. AlbumShelfDetail handles that route under
  // its own query — we must not fire the standard items queries because their
  // data shape would crash this screen's render path on `data.items.length`.
  const isAlbumShelf = listQuery.data?.list.type === "album_shelf";

  const activeQuery = useQuery({
    queryKey: queryKeys.items.byListFiltered(id ?? "", false),
    queryFn: () => fetchItems(id ?? "", { completed: false }, token),
    enabled: !!token && !!id && !isAlbumShelf,
  });

  const completedQuery = useQuery({
    queryKey: queryKeys.items.byListFiltered(id ?? "", true),
    queryFn: () => fetchItems(id ?? "", { completed: true }, token),
    enabled: !!token && !!id && !isAlbumShelf,
  });

  const upvoteKey = id ? queryKeys.items.byListFiltered(id, false) : undefined;

  const upvoteMutation = useMutation<
    ItemResponse,
    Error,
    { itemId: string; nextHasUpvoted: boolean },
    { previous?: ItemListResponse }
  >({
    mutationFn: ({ itemId, nextHasUpvoted }) =>
      nextHasUpvoted ? upvoteItem(itemId, token) : removeUpvote(itemId, token),
    onMutate: async ({ itemId, nextHasUpvoted }) => {
      if (!upvoteKey) return {};
      await queryClient.cancelQueries({ queryKey: upvoteKey });
      const previous = queryClient.getQueryData<ItemListResponse>(upvoteKey);
      if (previous) {
        queryClient.setQueryData<ItemListResponse>(upvoteKey, {
          items: previous.items.map((it) =>
            it.id === itemId
              ? {
                  ...it,
                  hasUpvoted: nextHasUpvoted,
                  upvoteCount: it.upvoteCount + (nextHasUpvoted ? 1 : -1),
                }
              : it,
          ),
        });
      }
      haptics.light();
      return { previous };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous && upvoteKey) {
        queryClient.setQueryData(upvoteKey, ctx.previous);
      }
      showToast({
        message: e instanceof ApiError ? e.message : "Couldn't update upvote",
        tone: "danger",
      });
    },
    onSettled: () => {
      if (upvoteKey) queryClient.invalidateQueries({ queryKey: upvoteKey });
    },
  });

  const completeMutation = useMutation<
    ItemResponse,
    Error,
    { itemId: string; nextCompleted: boolean }
  >({
    mutationFn: ({ itemId, nextCompleted }) =>
      nextCompleted ? completeItem(itemId, token) : uncompleteItem(itemId, token),
    onSuccess: async () => {
      haptics.medium();
      if (id) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.items.byListFiltered(id, false) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.items.byListFiltered(id, true) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.lists.all }),
        ]);
      }
    },
    onError: (e) => {
      showToast({
        message: e instanceof ApiError ? e.message : "Couldn't update item",
        tone: "danger",
      });
    },
  });

  // Defensive `?.items?.length`: a previously-persisted offline cache (PR #86)
  // could still hold a wrong-shape payload from before the album_shelf gate
  // above existed. The first render after upgrade would otherwise crash on
  // `undefined.length`.
  const activeCount = activeQuery.data?.items?.length;

  useEffect(() => {
    if (activeCount === undefined) return;
    const delta = computeNewItemsDelta({
      previousLength: previousLengthRef.current,
      currentLength: activeCount,
      scrollY: scrollYRef.current,
      threshold: NEW_ITEMS_SCROLL_THRESHOLD,
    });
    if (delta > 0) setNewItemsCount((c) => c + delta);
    previousLengthRef.current = activeCount;
  }, [activeCount]);

  const onListScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    scrollYRef.current = y;
    if (y <= NEW_ITEMS_SCROLL_THRESHOLD && newItemsCount > 0) {
      setNewItemsCount(0);
    }
  };

  const onPillPress = () => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    setNewItemsCount(0);
  };

  const filteredActive = useMemo(() => {
    const items = activeQuery.data?.items ?? [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => it.title.toLowerCase().includes(needle));
  }, [activeQuery.data?.items, filter]);

  const filteredCompleted = useMemo(() => {
    const items = completedQuery.data?.items ?? [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => it.title.toLowerCase().includes(needle));
  }, [completedQuery.data?.items, filter]);

  if (!id) {
    return (
      <View style={styles.center}>
        <EmptyState title="Missing list id" />
      </View>
    );
  }

  const list = listQuery.data?.list;
  // Album shelves render an entirely separate detail screen — different
  // sections (ordered/detected), no upvote, no completed checkmark, no FAB,
  // refresh button instead of add. See src/screens/AlbumShelfDetail.tsx.
  if (list?.type === "album_shelf") {
    return (
      <AlbumShelfDetail
        list={list}
        token={token}
        onBack={() => router.back()}
        onSettings={() => router.push(`/list/${id}/settings`)}
      />
    );
  }
  const accent = list?.color
    ? (tokens.list[list.color as ListColorKey] ?? tokens.accent.default)
    : tokens.accent.default;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton accessibilityLabel="Back" onPress={() => router.back()} testID="list-back">
          <Text style={styles.headerGlyph}>‹</Text>
        </IconButton>
        <View style={styles.headerCenter}>
          {list ? (
            <>
              <View style={styles.headerTitle}>
                <Text style={styles.headerEmoji}>{list.emoji}</Text>
                <Text variant="heading" numberOfLines={1} style={styles.headerName}>
                  {list.name}
                </Text>
              </View>
              <View style={[styles.headerStripe, { backgroundColor: accent }]} />
            </>
          ) : (
            <Text variant="heading">List</Text>
          )}
        </View>
        <IconButton
          accessibilityLabel="Open list settings"
          onPress={() => router.push(`/list/${id}/settings`)}
          testID="list-settings"
        >
          <Text style={styles.headerGlyph}>⋯</Text>
        </IconButton>
      </View>

      <View style={styles.toolbar}>
        <TextInput
          testID="list-filter"
          value={filter}
          onChangeText={setFilter}
          placeholder="Filter items"
          placeholderTextColor={tokens.text.muted}
          style={styles.filterInput}
          accessibilityLabel="Filter items"
        />
      </View>

      {listQuery.isError ? (
        <View style={styles.center}>
          <EmptyState
            title="Couldn't load list"
            description={errorMessage(listQuery.error)}
            action={
              <Button label="Retry" variant="secondary" onPress={() => listQuery.refetch()} />
            }
          />
        </View>
      ) : activeQuery.isPending || completedQuery.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.accent.default} />
        </View>
      ) : activeQuery.data?.items?.length === 0 && completedQuery.data?.items?.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            title="No items yet"
            description="Add the first thing on your list."
            action={
              <Button
                label="Add an item"
                onPress={() => router.push(`/list/${id}/add`)}
                testID="empty-add-item"
              />
            }
          />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={filteredActive}
          keyExtractor={(it) => it.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: tokens.space.sm }} />}
          onScroll={onListScroll}
          scrollEventThrottle={16}
          renderItem={({ item }) => (
            <ItemRow
              item={item}
              onUpvote={() =>
                upvoteMutation.mutate({ itemId: item.id, nextHasUpvoted: !item.hasUpvoted })
              }
              onComplete={() => completeMutation.mutate({ itemId: item.id, nextCompleted: true })}
              onPress={() => router.push(`/list/${id}/item/${item.id}`)}
            />
          )}
          refreshing={activeQuery.isRefetching}
          onRefresh={() => {
            activeQuery.refetch();
            completedQuery.refetch();
          }}
          ListEmptyComponent={
            filter.trim().length > 0 ? (
              <View style={styles.center}>
                <Text tone="secondary">No matches.</Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            filteredCompleted.length > 0 ? (
              <View style={styles.completedSection}>
                <View style={styles.completedHeader}>
                  <Text variant="label" tone="secondary">
                    Completed
                  </Text>
                  <Chip label={`${filteredCompleted.length}`} />
                </View>
                <View style={styles.completedList}>
                  {filteredCompleted.map((it) => (
                    <ItemRow
                      key={it.id}
                      item={it}
                      onUpvote={() =>
                        upvoteMutation.mutate({
                          itemId: it.id,
                          nextHasUpvoted: !it.hasUpvoted,
                        })
                      }
                      onComplete={() =>
                        completeMutation.mutate({ itemId: it.id, nextCompleted: false })
                      }
                      onPress={() => router.push(`/list/${id}/item/${it.id}`)}
                      isCompleted
                    />
                  ))}
                </View>
              </View>
            ) : null
          }
        />
      )}

      {newItemsCount > 0 ? (
        <View pointerEvents="box-none" style={styles.pillViewport}>
          <NewItemsPill count={newItemsCount} onPress={onPillPress} testID="new-items-pill" />
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add item"
        onPress={() => router.push(`/list/${id}/add`)}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        testID="fab-add-item"
      >
        <Text style={styles.fabGlyph} tone="onAccent">
          +
        </Text>
      </Pressable>
    </View>
  );
}

interface ItemRowProps {
  item: Item;
  onUpvote: () => void;
  onComplete: () => void;
  onPress: () => void;
  isCompleted?: boolean;
}

function ItemRow({ item, onUpvote, onComplete, onPress, isCompleted = false }: ItemRowProps) {
  const completedProgress = useSharedValue(isCompleted ? 1 : 0);

  useEffect(() => {
    completedProgress.value = withTiming(isCompleted ? 1 : 0, { duration: 220 });
  }, [isCompleted, completedProgress]);

  const baseTitleStyle = useAnimatedStyle(() => ({ opacity: 1 - completedProgress.value }));
  const strikeTitleStyle = useAnimatedStyle(() => ({ opacity: completedProgress.value }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open item ${item.title}`}
      onPress={onPress}
      testID={`item-row-${item.id}`}
      style={({ pressed }) => [pressed && styles.itemPressed]}
    >
      <Card style={styles.itemCard}>
        <UpvotePill
          count={item.upvoteCount}
          hasUpvoted={item.hasUpvoted}
          onPress={onUpvote}
          testID={`item-upvote-${item.id}`}
        />
        <View style={styles.itemBody}>
          <View style={styles.titleStack}>
            <Animated.Text
              numberOfLines={2}
              style={[styles.itemTitle, baseTitleStyle]}
              testID={`item-title-${item.id}`}
            >
              {item.title}
            </Animated.Text>
            <Animated.Text
              numberOfLines={2}
              pointerEvents="none"
              style={[
                styles.itemTitle,
                styles.itemTitleCompleted,
                styles.titleOverlay,
                strikeTitleStyle,
              ]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {item.title}
            </Animated.Text>
          </View>
          {item.note ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {item.note}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isCompleted ? "Mark as not done" : "Mark as done"}
          onPress={onComplete}
          testID={`item-complete-${item.id}`}
          style={({ pressed }) => [
            styles.completeBtn,
            isCompleted && styles.completeBtnDone,
            pressed && styles.completeBtnPressed,
          ]}
        >
          <Text style={styles.completeGlyph} tone={isCompleted ? "onAccent" : "secondary"}>
            ✓
          </Text>
        </Pressable>
      </Card>
    </Pressable>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingTop: tokens.space.xxl,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: tokens.space.md,
    gap: tokens.space.md,
  },
  headerGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.xl },
  headerCenter: { flex: 1, alignItems: "center", gap: tokens.space.xs },
  headerTitle: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  headerEmoji: { fontSize: tokens.font.size.lg },
  headerName: { maxWidth: 240 },
  headerStripe: { height: 3, width: 48, borderRadius: 2 },
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
  itemPressed: { opacity: 0.85 },
  itemCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    padding: tokens.space.md,
  },
  itemBody: { flex: 1, gap: 2 },
  titleStack: { position: "relative" },
  titleOverlay: { ...StyleSheet.absoluteFillObject },
  itemTitle: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.regular,
  },
  itemTitleCompleted: { textDecorationLine: "line-through", color: tokens.text.muted },
  completeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: tokens.border.default,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.elevated,
  },
  completeBtnDone: { backgroundColor: tokens.status.success, borderColor: tokens.status.success },
  completeBtnPressed: { opacity: 0.7 },
  completeGlyph: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.bold },
  completedSection: { marginTop: tokens.space.xl, gap: tokens.space.md },
  completedHeader: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  completedList: { gap: tokens.space.sm },
  pillViewport: {
    position: "absolute",
    top: 140,
    left: 0,
    right: 0,
    alignItems: "center",
  },
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
