import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Item,
  ItemKind,
  List,
  ListItemsResponse,
  ListMemberSummary,
  ListSource,
} from "@workshop/shared";
import { hasModule } from "@workshop/shared/modules";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { archiveItem, completeItem, fetchItems, moveItem, uncompleteItem } from "../api/items";
import { fetchListScores, upsertItemScore } from "../api/scores";
import { syncSource } from "../api/sources";
import { useAuth } from "../hooks/useAuth";
import { useLivePollingInterval } from "../hooks/useLivePollingInterval";
import { applyOptimisticMove, neighborsForOrderedReorder } from "../lib/albumShelfPositions";
import { errorMessage } from "../lib/api";
import { confirm } from "../lib/confirm";
import { localDateKey } from "../lib/gameDate";
import { goBack } from "../lib/goBack";
import { haptics } from "../lib/haptics";
import { normalizeExternalUrl, openExternalUrl } from "../lib/openUrl";
import { queryKeys } from "../lib/queryKeys";
import { formatRelative } from "../lib/relativeTime";
import { buildTodaysScoresSummary } from "../lib/scoresSummary";
import { buildListShareUrl, copyToClipboard } from "../lib/share";
import { sourceErrorMessage } from "../lib/sourceErrors";
import {
  Button,
  CopyIcon,
  EmptyState,
  type ListColorKey,
  Screen,
  Text,
  tokens,
  useToast,
} from "../ui/index";
import { GameScorePasteSheet } from "./listDetail/GameScorePasteSheet";
import { ItemList } from "./listDetail/ItemList";
import { ItemRowMenu, type ItemRowMenuActions } from "./listDetail/ItemRowMenu";
import type { ReorderEvent } from "./listDetail/listProps";
import type { Section } from "./listDetail/types";
import { useReturnToPaste } from "./listDetail/useReturnToPaste";

interface Props {
  list: List;
  members: ListMemberSummary[];
  sources: ListSource[];
  token: string | null;
}

/**
 * Unified list-detail screen. The shape of the screen falls out of `list.modules`:
 *
 * - `ranking` on → Ordered + Unordered sections, drag-to-reorder.
 * - `todo` on    → Done section appears below.
 * - `sources` on → header refresh button and source provenance badges.
 *
 * `list.itemKind === "spotify_album"` keeps the legacy album-shelf
 * affordance — body-press opens Spotify, no Edit menu action (fields are
 * server-derived from the source sync).
 */
export function ListDetail({ list, members, sources, token }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { user } = useAuth();
  const selfId = user?.id ?? null;
  const filterInputRef = useRef<TextInput>(null);
  const [filter, setFilter] = useState("");
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const itemsKey = queryKeys.items.byList(list.id);
  const livePoll = useLivePollingInterval();

  const itemKind = list.itemKind;
  const isSpotifyShelf = itemKind === "spotify_album";
  const hasSources = sources.length > 0 && hasModule(list.modules, "sources");
  const isGameKind = list.modules.includes("leaderboard");
  const rankingOn = hasModule(list.modules, "ranking");
  const todoOn = hasModule(list.modules, "todo");

  const itemsQuery = useQuery({
    queryKey: itemsKey,
    queryFn: () => fetchItems(list.id, token),
    enabled: !!token,
    refetchInterval: livePoll,
  });

  // Leaderboard lists: pull today's scores so each row can show "X of Y
  // played today" in place of the per-row "Added by …" attribution — the
  // social signal users actually care about on a daily-games shelf.
  const todayKey = localDateKey();
  const listScoresQuery = useQuery({
    queryKey: queryKeys.gameScores.forList(list.id, todayKey),
    queryFn: () => fetchListScores(list.id, todayKey, token),
    enabled: !!token && isGameKind,
    refetchInterval: livePoll,
  });
  const playedByItem = useMemo(() => {
    const map = new Map<string, number>();
    const byItem = listScoresQuery.data?.scoresByItem;
    if (!byItem) return map;
    for (const itemId of Object.keys(byItem)) {
      const entries = byItem[itemId] ?? [];
      const played = entries.filter((e) => e.scoreRaw != null && e.scoreRaw.length > 0).length;
      map.set(itemId, played);
    }
    return map;
  }, [listScoresQuery.data]);

  const [newItemIds, setNewItemIds] = useState<Set<string>>(() => new Set());
  const beforeRefreshIdsRef = useRef<Set<string> | null>(null);

  const primarySource = sources[0] ?? null;

  const refreshMutation = useMutation({
    mutationFn: async () => {
      if (!primarySource) throw new Error("no source attached");
      return syncSource(list.id, primarySource.id, token);
    },
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
            ? "No new items detected."
            : `Detected ${added} new item${added === 1 ? "" : "s"}.`,
        tone: added === 0 ? "default" : "success",
      });
    },
    onError: (e) => {
      showToast({
        message: sourceErrorMessage(e, "Couldn't refresh. Try again?"),
        tone: "danger",
      });
    },
  });

  useEffect(() => {
    if (newItemIds.size === 0) return;
    const t = setTimeout(() => setNewItemIds(new Set()), 3000);
    return () => clearTimeout(t);
  }, [newItemIds]);

  const moveMutation = useMutation<
    Item,
    Error,
    { item: Item; beforeItemId: string | null; afterItemId: string | null },
    { previous?: ListItemsResponse }
  >({
    mutationFn: async ({ item, beforeItemId, afterItemId }) => {
      const res = await moveItem(item.id, { beforeItemId, afterItemId }, token);
      return res.item;
    },
    onMutate: async ({ item, beforeItemId, afterItemId }) => {
      await queryClient.cancelQueries({ queryKey: itemsKey });
      const previous = queryClient.getQueryData<ListItemsResponse>(itemsKey);
      if (previous) {
        const next = applyOptimisticMove(previous, item.id, beforeItemId, afterItemId);
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

  const archiveMutation = useMutation<{ ok: true }, Error, { itemId: string }>({
    mutationFn: ({ itemId }) => archiveItem(itemId, token),
    onSuccess: () => {
      haptics.medium();
      queryClient.invalidateQueries({ queryKey: itemsKey });
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
    },
    onError: (e) => {
      showToast({
        message: errorMessage(e, "Couldn't archive that item."),
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
      const c = it.content as { artist?: string; authors?: string[]; siteName?: string };
      const haystack = [
        it.title,
        it.note ?? "",
        c.artist ?? "",
        c.siteName ?? "",
        Array.isArray(c.authors) ? c.authors.join(" ") : "",
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
  const lastRefreshedAt = primarySource?.lastSyncedAt ?? null;
  const lastRefreshedByName = primarySource?.lastSyncedBy
    ? (memberNameById.get(primarySource.lastSyncedBy) ?? null)
    : null;
  const refreshing = refreshMutation.isPending;

  const showOrderedHint =
    rankingOn &&
    filtered.ordered.length === 0 &&
    (filtered.unordered.length > 0 || filtered.completed.length > 0) &&
    filter.trim().length === 0;

  const totalRows = filtered.ordered.length + filtered.unordered.length + filtered.completed.length;
  const filterActive = filter.trim().length > 0;
  const totalRowsUnfiltered = orderedRaw.length + unorderedRaw.length + completedRaw.length;

  const onReorderOrdered = (event: ReorderEvent) => {
    const ordered = filtered.ordered;
    const item = ordered[event.fromIndex];
    if (!item) return;
    const neighbors = neighborsForOrderedReorder(ordered, event.fromIndex, event.toIndex);
    if (!neighbors) return;
    moveMutation.mutate({
      item,
      beforeItemId: neighbors.before?.id ?? null,
      afterItemId: neighbors.after?.id ?? null,
    });
  };

  const onPromoteToOrdered = ({ item, toIndex }: { item: Item; toIndex: number }) => {
    const ordered = filtered.ordered;
    const clamped = Math.max(0, Math.min(toIndex, ordered.length));
    const beforeItem = clamped > 0 ? ordered[clamped - 1] : null;
    const afterItem = clamped < ordered.length ? ordered[clamped] : null;
    moveMutation.mutate({
      item,
      beforeItemId: beforeItem?.id ?? null,
      afterItemId: afterItem?.id ?? null,
    });
  };

  const onCopyTodaysScores = async () => {
    const summary = buildTodaysScoresSummary({
      listName: list.name,
      listUrl: buildListShareUrl(list.shareSlug),
      items: [...orderedRaw, ...unorderedRaw, ...completedRaw],
      scoresByItem: listScoresQuery.data?.scoresByItem ?? {},
      selfId,
      dateKey: todayKey,
    });
    if (!summary) {
      showToast({
        message: "No scores from you today yet. Post one to share a recap.",
        tone: "default",
      });
      return;
    }
    const ok = await copyToClipboard(summary);
    if (ok) haptics.light();
    showToast({
      message: ok ? "Today's scores copied to clipboard" : "Couldn't copy to clipboard",
      tone: ok ? "success" : "danger",
    });
  };

  const [menuItem, setMenuItem] = useState<Item | null>(null);
  const [menuActions, setMenuActions] = useState<ItemRowMenuActions | null>(null);
  const closeMenu = () => {
    setMenuItem(null);
    setMenuActions(null);
  };

  const onRowMenu = (item: Item, section: Section) => {
    const confirmDelete = async () => {
      const ok = await confirm({
        title: "Remove this item?",
        confirmLabel: "Delete",
        destructive: true,
      });
      if (ok) archiveMutation.mutate({ itemId: item.id });
    };
    setMenuItem(item);
    setMenuActions({
      section,
      isAlbumShelf: isSpotifyShelf,
      ...(section !== "ordered" && rankingOn
        ? {
            onPromote: () =>
              moveMutation.mutate({
                item,
                beforeItemId: filtered.ordered[filtered.ordered.length - 1]?.id ?? null,
                afterItemId: null,
              }),
            onPromoteToTop: () =>
              moveMutation.mutate({
                item,
                beforeItemId: null,
                afterItemId: filtered.ordered[0]?.id ?? null,
              }),
          }
        : {}),
      ...(section === "ordered" && rankingOn
        ? {
            onDemote: () => moveMutation.mutate({ item, beforeItemId: null, afterItemId: null }),
          }
        : {}),
      ...(section !== "completed" && todoOn
        ? {
            onComplete: () => completeMutation.mutate({ item, nextCompleted: true }),
          }
        : {}),
      ...(section === "completed" && todoOn
        ? {
            onUncomplete: () => completeMutation.mutate({ item, nextCompleted: false }),
          }
        : {}),
      ...(!isSpotifyShelf
        ? {
            onEdit: () =>
              router.push(
                isGameKind
                  ? `/list/${list.id}/game/${item.id}`
                  : `/list/${list.id}/item/${item.id}`,
              ),
          }
        : {}),
      onDelete: confirmDelete,
    });
  };

  const onRowPressBody = (item: Item) => {
    if (isSpotifyShelf) {
      const c = item.content as { spotifyAlbumUrl?: string };
      openExternalUrl(c.spotifyAlbumUrl);
      return;
    }
    if (isGameKind) {
      router.push(`/list/${list.id}/game/${item.id}`);
      return;
    }
    router.push(`/list/${list.id}/item/${item.id}`);
  };

  const resolveRowPressCover = (item: Item): (() => void) | null => {
    if (isSpotifyShelf) {
      const c = item.content as { spotifyAlbumUrl?: string };
      const url = normalizeExternalUrl(c.spotifyAlbumUrl);
      return url ? () => openExternalUrl(url) : null;
    }
    const url = normalizeExternalUrl(item.url);
    return url ? () => openExternalUrl(url) : null;
  };

  // Leaderboard "status card" plumbing. The cards read today's standings out of
  // `scoresByItem` (already fetched above for the row count); the play loop —
  // tap Play, then paste your result when you return to the page — is owned by
  // `useReturnToPaste` + a paste sheet.
  const scoresByItem = listScoresQuery.data?.scoresByItem;
  const hasMyScore = useCallback(
    (itemId: string): boolean => {
      if (!selfId) return false;
      const entries = scoresByItem?.[itemId];
      return !!entries?.some(
        (e) => e.userId === selfId && e.scoreRaw != null && e.scoreRaw.length > 0,
      );
    },
    [scoresByItem, selfId],
  );
  const {
    promptItemId,
    markPlaying,
    openPasteFor,
    dismiss: dismissPaste,
  } = useReturnToPaste({ todayKey, hasScoreForItem: hasMyScore });

  const pasteScoreMutation = useMutation({
    mutationFn: ({ item, scoreRaw }: { item: Item; scoreRaw: string }) =>
      upsertItemScore(item.id, { periodKey: todayKey, scoreRaw }, token),
    onSuccess: async (_data, { item }) => {
      haptics.medium();
      dismissPaste();
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.gameScores.forItem(item.id, todayKey),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.gameScores.forList(list.id, todayKey),
        }),
      ]);
      showToast({ message: "Score posted", tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't save score"), tone: "danger" });
    },
  });

  const promptItem = useMemo(() => {
    if (!promptItemId) return null;
    return (
      [...orderedRaw, ...unorderedRaw, ...completedRaw].find((i) => i.id === promptItemId) ?? null
    );
  }, [promptItemId, orderedRaw, unorderedRaw, completedRaw]);

  const headerSubline = useMemo(() => {
    const memberPart = `${members.length} ${members.length === 1 ? "member" : "members"}`;
    if (hasSources) {
      if (refreshing) return "Refreshing source…";
      if (!lastRefreshedAt) return `${memberPart} · tap ↻ to pull from source`;
      const rel = formatRelative(lastRefreshedAt);
      const actor = lastRefreshedByName ? ` by @${lastRefreshedByName}` : "";
      return `${memberPart} · synced ${rel}${actor}`;
    }
    const total = orderedRaw.length + unorderedRaw.length + completedRaw.length;
    if (total === 0) return memberPart;
    return `${memberPart} · ${total} ${total === 1 ? "item" : "items"}`;
  }, [
    hasSources,
    refreshing,
    members.length,
    lastRefreshedAt,
    lastRefreshedByName,
    orderedRaw.length,
    unorderedRaw.length,
    completedRaw.length,
  ]);

  const isEmptyAfterFetch =
    !itemsQuery.isPending && !itemsQuery.isError && totalRowsUnfiltered === 0;
  const isFilterEmpty =
    !itemsQuery.isPending &&
    !itemsQuery.isError &&
    filterActive &&
    totalRows === 0 &&
    totalRowsUnfiltered > 0;

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      if (e.key === "Escape" && inInput) {
        e.preventDefault();
        setFilter("");
        filterInputRef.current?.blur?.();
        return;
      }
      if (inInput) return;
      if (e.key === "/" || (e.metaKey && e.key === "k") || (e.ctrlKey && e.key === "k")) {
        e.preventDefault();
        filterInputRef.current?.focus?.();
      } else if (e.key === "n" && !e.metaKey && !e.ctrlKey && !isSpotifyShelf) {
        e.preventDefault();
        router.push(`/list/${list.id}/add`);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router, list.id, isSpotifyShelf]);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen style={styles.column}>
        <View style={styles.headerNav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => goBack("/")}
            testID="list-detail-back"
            hitSlop={10}
            style={styles.navButton}
          >
            <Text style={styles.navGlyph}>‹</Text>
          </Pressable>
          <View style={styles.navActions}>
            {hasSources ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sync source"
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
            {isGameKind ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copy today's scores to clipboard"
                onPress={onCopyTodaysScores}
                testID="list-detail-copy-scores"
                hitSlop={10}
                style={styles.navButton}
              >
                <CopyIcon size={20} color={tokens.text.primary} />
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
          {list.coverPhotoUrl ? (
            <Image
              source={{ uri: list.coverPhotoUrl }}
              style={[styles.titleBadge, { borderColor: `${accent}55` }]}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View
              style={[
                styles.titleBadge,
                { backgroundColor: `${accent}1F`, borderColor: `${accent}33` },
              ]}
            >
              <Text style={styles.titleEmoji}>{list.emoji}</Text>
            </View>
          )}
          <View style={styles.titleText}>
            <Text variant="title" numberOfLines={2} style={styles.titleName}>
              {list.name}
            </Text>
            <View style={styles.sublineRow}>
              {members.length > 0 ? <MemberStack members={members} accent={accent} /> : null}
              <Text
                variant="caption"
                tone="muted"
                style={styles.subline}
                testID="list-detail-subline"
              >
                {headerSubline}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.toolbar}>
          <View style={[styles.filterPill, filter.length > 0 && styles.filterPillActive]}>
            <Text style={styles.filterGlyph} tone="muted">
              ⌕
            </Text>
            <TextInput
              ref={filterInputRef}
              testID="list-detail-filter"
              value={filter}
              onChangeText={setFilter}
              placeholder={isSpotifyShelf ? "Search this shelf" : "Search this list"}
              placeholderTextColor={tokens.text.muted}
              style={styles.filterInput}
              accessibilityLabel="Search items in this list"
              onSubmitEditing={() => filterInputRef.current?.blur()}
            />
            {filterActive && totalRows > 0 && totalRows < totalRowsUnfiltered ? (
              <Text style={styles.filterCount} tone="muted" testID="list-detail-filter-count">
                {totalRows}/{totalRowsUnfiltered}
              </Text>
            ) : null}
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
            ) : Platform.OS === "web" ? (
              <Text style={styles.filterKbd} tone="muted" accessibilityElementsHidden>
                /
              </Text>
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
              motion
              illustration={<ListEmptyHalo accent={accent} emoji={list.emoji} />}
              title="Couldn't load this list"
              description={
                isSpotifyShelf
                  ? sourceErrorMessage(itemsQuery.error, "Unknown error")
                  : errorMessage(itemsQuery.error)
              }
              action={
                <Button
                  label="Try again"
                  variant="secondary"
                  onPress={() => itemsQuery.refetch()}
                  testID="list-detail-retry"
                />
              }
            />
          </View>
        ) : isFilterEmpty ? (
          <View style={styles.center}>
            <EmptyState
              title="No matches"
              description={`Nothing in this list matches “${filter.trim()}.”`}
              action={
                <Button
                  label="Clear search"
                  variant="secondary"
                  onPress={() => setFilter("")}
                  testID="list-detail-filter-clear"
                />
              }
            />
          </View>
        ) : isEmptyAfterFetch ? (
          <View style={styles.center}>
            {hasSources ? (
              <EmptyState
                motion
                illustration={<ListEmptyHalo accent={accent} emoji={list.emoji} />}
                title={lastRefreshedAt ? "No items detected" : "Pulling from source…"}
                description={
                  lastRefreshedAt
                    ? lastRefreshedByName
                      ? `Last refreshed by ${lastRefreshedByName}. Check the source URL in settings.`
                      : "Check the source URL in settings."
                    : "This usually takes a few seconds."
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
                motion
                illustration={<ListEmptyHalo accent={accent} emoji={list.emoji} />}
                title={kindEmptyCopy(itemKind).title}
                description={kindEmptyCopy(itemKind).description}
                accessibilityLabel={`${kindEmptyCopy(itemKind).title}. ${kindEmptyCopy(itemKind).description}`}
                action={
                  <Button
                    label={kindEmptyCopy(itemKind).action}
                    onPress={() => router.push(`/list/${list.id}/add`)}
                    testID="list-detail-empty-add"
                  />
                }
                hint={
                  <View style={styles.emptyHintGroup}>
                    {members.length > 1 ? (
                      <Text
                        variant="caption"
                        tone="muted"
                        style={styles.emptySharedLine}
                        testID="list-detail-empty-shared-line"
                      >
                        Shared with {members.length - 1} {members.length === 2 ? "other" : "others"}
                        {". "}Anything you add shows up for them too.
                      </Text>
                    ) : null}
                    {Platform.OS === "web" ? (
                      <View style={styles.emptyKbdRow} accessibilityElementsHidden>
                        <Text variant="caption" tone="muted">
                          press
                        </Text>
                        <Text style={styles.emptyKbd} tone="secondary">
                          n
                        </Text>
                        <Text variant="caption" tone="muted">
                          to add
                        </Text>
                      </View>
                    ) : null}
                  </View>
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
              listItemKind={itemKind}
              isAlbumShelf={isSpotifyShelf}
              modules={list.modules}
              showOrderedHint={showOrderedHint}
              newItemIds={newItemIds}
              memberNameById={memberNameById}
              showProvenance={members.length > 1}
              selfId={selfId}
              playedByItem={isGameKind ? playedByItem : undefined}
              totalPlayers={isGameKind ? members.length : undefined}
              isGameKind={isGameKind}
              scoresByItem={scoresByItem}
              members={members}
              scoresLoading={isGameKind && listScoresQuery.isPending}
              onPlayGame={markPlaying}
              onPasteScore={openPasteFor}
              accent={accent}
              onReorderOrdered={onReorderOrdered}
              onPromoteToOrdered={onPromoteToOrdered}
              onRowMenu={onRowMenu}
              onRowPressBody={onRowPressBody}
              onUncompleteItem={(item) => completeMutation.mutate({ item, nextCompleted: false })}
              resolveRowPressCover={resolveRowPressCover}
              refreshing={manualRefreshing}
              onRefresh={async () => {
                setManualRefreshing(true);
                try {
                  await itemsQuery.refetch();
                } finally {
                  setManualRefreshing(false);
                }
              }}
            />
          </View>
        )}

        {!isSpotifyShelf && !(isEmptyAfterFetch && !hasSources) ? (
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

        <GameScorePasteSheet
          item={promptItem}
          userName={user?.displayName ?? null}
          pending={pasteScoreMutation.isPending}
          onSubmit={(item, scoreRaw) => pasteScoreMutation.mutate({ item, scoreRaw })}
          onClose={dismissPaste}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}

function memberInitial(name: string | null): string {
  const trimmed = name?.trim();
  if (!trimmed) return "·";
  return (trimmed[0] ?? "·").toUpperCase();
}

// Per-list-color halo behind the list's emoji. Carries the list's identity
// (its hue, its emoji) into the zero-items canvas so the empty state belongs
// to *this* list, not to "lists in general." A single soft tinted disc; no
// border, no glow, no gradient — DESIGN.md "calm by default" + per-list
// color used only to identify the list.
function ListEmptyHalo({ accent, emoji }: { accent: string; emoji: string }) {
  return (
    <View
      style={[emptyHaloStyles.disc, { backgroundColor: `${accent}1F` }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Text style={emptyHaloStyles.emoji}>{emoji}</Text>
    </View>
  );
}

const emptyHaloStyles = StyleSheet.create({
  disc: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 48, lineHeight: 56 },
});

// Kind-aware copy for the zero-items empty state. The header has already
// told the user which list this is; the empty surface should echo that by
// naming the thing they haven't added yet. Falls back to the generic
// "things you want to remember" line for `plain` / unknown.
function kindEmptyCopy(kind: ItemKind | null): {
  title: string;
  description: string;
  action: string;
} {
  switch (kind) {
    case "movie":
      return {
        title: "No movies yet",
        description: "Add the first one you want to watch.",
        action: "Add a movie",
      };
    case "tv":
      return {
        title: "No shows yet",
        description: "Add the first one you want to watch.",
        action: "Add a show",
      };
    case "book":
      return {
        title: "Nothing on the shelf yet",
        description: "Add the first book you want to read.",
        action: "Add a book",
      };
    case "link":
      return {
        title: "Nothing saved yet",
        description: "Add the first link you want to come back to.",
        action: "Add a link",
      };
    case "spotify_album":
      return {
        title: "Nothing on the shelf yet",
        description: "Pulls from a Spotify playlist when one is connected.",
        action: "Add an album",
      };
    default:
      return {
        title: "Nothing here yet",
        description: "Add the first thing you want to remember.",
        action: "Add an item",
      };
  }
}

function MemberStack({ members, accent }: { members: ListMemberSummary[]; accent: string }) {
  const shown = members.slice(0, 3);
  return (
    <View style={memberStackStyles.row} accessibilityLabel={`${members.length} members`}>
      {shown.map((m, i) => (
        <View
          key={m.userId}
          style={[
            memberStackStyles.chip,
            { backgroundColor: `${accent}26`, borderColor: tokens.bg.canvas },
            i > 0 ? memberStackStyles.chipOverlap : null,
          ]}
        >
          <Text style={memberStackStyles.initials}>{memberInitial(m.displayName)}</Text>
        </View>
      ))}
    </View>
  );
}

const memberStackStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  chip: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOverlap: { marginLeft: -9 },
  initials: {
    fontSize: 12,
    fontWeight: tokens.font.weight.semibold,
    letterSpacing: 0.2,
    lineHeight: 14,
    color: tokens.text.primary,
  },
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingTop: tokens.space.xl,
  },
  column: { flex: 1 },
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
    gap: tokens.space.lg,
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
  },
  titleBadge: {
    width: 48,
    height: 48,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  titleEmoji: { fontSize: 24, lineHeight: 28 },
  titleText: { flex: 1, minWidth: 0, gap: 5 },
  titleName: { fontSize: 23, lineHeight: 28, letterSpacing: -0.3 },
  sublineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    flexWrap: "wrap",
  },
  subline: { letterSpacing: 0.1 },
  toolbar: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xs,
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: tokens.space.md,
    paddingVertical: 2,
    borderRadius: tokens.radius.md,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: tokens.border.subtle,
  },
  filterPillActive: {
    backgroundColor: tokens.bg.surface,
    borderColor: tokens.border.default,
  },
  filterGlyph: {
    fontSize: tokens.font.size.md,
    marginRight: tokens.space.sm,
    color: tokens.text.muted,
  },
  filterInput: {
    flex: 1,
    paddingVertical: 8,
    color: tokens.text.primary,
    fontSize: tokens.font.size.sm,
  },
  filterClear: { paddingHorizontal: tokens.space.xs, paddingVertical: tokens.space.xs },
  filterClearGlyph: { fontSize: tokens.font.size.sm },
  filterCount: {
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.4,
    paddingHorizontal: tokens.space.sm,
  },
  filterKbd: {
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
    lineHeight: 14,
    marginLeft: tokens.space.xs,
  },
  emptyHintGroup: {
    alignItems: "center",
    gap: tokens.space.sm,
  },
  emptySharedLine: {
    textAlign: "center",
    maxWidth: 320,
    lineHeight: 16,
  },
  emptyKbdRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
  },
  emptyKbd: {
    fontSize: 12,
    fontWeight: tokens.font.weight.semibold,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
    lineHeight: 16,
    fontVariant: ["tabular-nums"],
  },
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
    // Calm neutral elevation, not an amber glow. The accent fill carries the
    // warmth; a colored halo would read as the "glow aesthetic" the brand
    // explicitly avoids.
    boxShadow: "0px 10px 24px rgba(0, 0, 0, 0.45), 0px 2px 6px rgba(0, 0, 0, 0.30)",
    elevation: 6,
  },
  fabPressed: { backgroundColor: tokens.accent.hover, transform: [{ scale: 0.96 }] },
  fabGlyph: { fontSize: 28, fontWeight: tokens.font.weight.bold, lineHeight: 32 },
});
