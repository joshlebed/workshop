import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type { ActivityEvent, ListListResponse, ListSummary } from "@workshop/shared";
import {
  ActionSheet,
  type ActionSheetItem,
  Button,
  EmojiBadge,
  EmptyState,
  Fab,
  homeLayout,
  type ListColorKey,
  PullToRefresh,
  Screen,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  Text,
  TextField,
  tokens,
  useToast,
} from "@workshop/ui";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Platform, ScrollView, StyleSheet, View } from "react-native";
import { fetchActivity } from "../../../src/api/activity";
import {
  archiveList,
  fetchLists,
  muteList,
  pinList,
  unarchiveList,
  unmuteList,
  unpinList,
} from "../../../src/api/lists";
import { HeaderActivityButton } from "../../../src/components/HeaderActivityButton";
import { HomeAvatarButton } from "../../../src/components/HomeAvatarButton";
import { ShareListSheet } from "../../../src/components/ShareListSheet";
import { useAuth } from "../../../src/hooks/useAuth";
import { useCreateFromTemplate } from "../../../src/hooks/useCreateFromTemplate";
import { isNetworkError } from "../../../src/lib/errorCopy";
import { homeListOrder } from "../../../src/lib/homeListOrder";
import { HomeEmpty } from "../../../src/screens/home/HomeEmpty";
import { HomeListRow } from "../../../src/screens/home/HomeListRow";
import {
  HOME_SEARCH_THRESHOLD,
  homeRowCount,
  matchesListSearch,
} from "../../../src/screens/home/homeRow";

type ViewField = "pinnedAt" | "archivedAt" | "mutedAt";

type HomeEntry =
  | { kind: "header"; key: string; title: string }
  | { kind: "list"; key: string; list: ListSummary; lastInSection: boolean };

export default function Home() {
  const { user, token } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();

  // A cold-opened route gets home injected beneath it as the stack anchor, and
  // the anchor inherits the deep link's params (`/?id=<listId>` after backing
  // out). Home takes no params; drop them so the URL reads `/`.
  // `navigation.setParams` targets this screen's route even while it sits
  // beneath the cold-opened one (`router.setParams` would hit the focused one).
  const params = useLocalSearchParams<{ id?: string; itemId?: string }>();
  const navigation = useNavigation();
  useEffect(() => {
    if (params.id || params.itemId) {
      (navigation.setParams as unknown as (p: Record<string, undefined>) => void)({
        id: undefined,
        itemId: undefined,
      });
    }
  }, [params.id, params.itemId, navigation]);

  const listsQuery = useQuery({
    queryKey: queryKeys.lists.all,
    queryFn: () => fetchLists(token),
    enabled: !!token,
    refetchInterval: livePoll,
  });

  const activityFeedQuery = useQuery({
    queryKey: queryKeys.activity.feed,
    queryFn: () => fetchActivity({ limit: 50 }, token),
    enabled: !!token,
    staleTime: 30_000,
    refetchInterval: livePoll,
  });

  const allLists = listsQuery.data?.lists ?? [];

  // The bell sums the server-authored `unreadCount` across non-muted lists
  // (muted lists already report 0; filtered again to make the intent plain).
  const totalUnread = useMemo(
    () => allLists.reduce((n, l) => (l.mutedAt ? n : n + l.unreadCount), 0),
    [allLists],
  );

  // Latest event per list: the activity clause of each row's second line.
  const latestByList = useMemo(() => {
    const map = new Map<string, ActivityEvent>();
    for (const e of activityFeedQuery.data?.events ?? []) {
      if (!map.has(e.listId)) map.set(e.listId, e);
    }
    return map;
  }, [activityFeedQuery.data]);

  const visibleLists = useMemo(
    () => homeListOrder(allLists, (id) => latestByList.get(id)?.createdAt),
    [allLists, latestByList],
  );

  const [search, setSearch] = useState("");
  const showSearch = visibleLists.length > HOME_SEARCH_THRESHOLD;
  const query = showSearch ? search : "";
  const entries: HomeEntry[] = useMemo(() => {
    const matched = visibleLists.filter((l) => matchesListSearch(l.name, query));
    const pinned = matched.filter((l) => l.pinnedAt);
    const rest = matched.filter((l) => !l.pinnedAt);
    const toRows = (lists: ListSummary[]): HomeEntry[] =>
      lists.map((list, i) => ({
        kind: "list",
        key: list.id,
        list,
        lastInSection: i === lists.length - 1,
      }));
    if (pinned.length === 0) return toRows(rest);
    return [
      { kind: "header", key: "h-pinned", title: "Pinned" },
      ...toRows(pinned),
      ...(rest.length > 0
        ? [{ kind: "header", key: "h-rest", title: "Recent" } as HomeEntry, ...toRows(rest)]
        : []),
    ];
  }, [visibleLists, query]);

  // Row menu. `menuFor` outlives `menuOpen` so the sheet keeps its header
  // while it animates out; the chosen action runs after it closes.
  const [menuFor, setMenuFor] = useState<ListSummary | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = useCallback((list: ListSummary) => {
    setMenuFor(list);
    setMenuOpen(true);
  }, []);
  const [shareFor, setShareFor] = useState<ListSummary | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  // Per-viewer view state (pin / hide / mute), optimistic on the lists cache
  // with rollback and a toast on failure.
  const viewStateMutation = useMutation<
    { ok: true },
    Error,
    { id: string; field: ViewField; value: string | null; silent?: boolean },
    { previous?: ListListResponse }
  >({
    mutationFn: async ({ id, field, value }) => {
      if (field === "pinnedAt") return value ? pinList(id, token) : unpinList(id, token);
      if (field === "archivedAt") return value ? archiveList(id, token) : unarchiveList(id, token);
      return value ? muteList(id, token) : unmuteList(id, token);
    },
    onMutate: async ({ id, field, value }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.lists.all });
      const previous = queryClient.getQueryData<ListListResponse>(queryKeys.lists.all);
      if (previous) {
        queryClient.setQueryData<ListListResponse>(queryKeys.lists.all, {
          lists: previous.lists.map((l) =>
            l.id === id
              ? {
                  ...l,
                  [field]: value,
                  // Muting zeroes unread on the server; mirror it so the bell updates now.
                  ...(field === "mutedAt" && value ? { unreadCount: 0 } : null),
                }
              : l,
          ),
        });
      }
      return { previous };
    },
    onError: (e, { field, value }, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKeys.lists.all, ctx.previous);
      const what =
        field === "pinnedAt"
          ? value
            ? "pin"
            : "unpin"
          : field === "archivedAt"
            ? value
              ? "hide"
              : "unhide"
            : value
              ? "mute"
              : "unmute";
      showToast({ message: errorMessage(e, `Couldn't ${what} that list.`), tone: "danger" });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
    },
  });

  const setView = useCallback(
    (list: ListSummary, field: ViewField, on: boolean) =>
      viewStateMutation.mutate({
        id: list.id,
        field,
        value: on ? new Date().toISOString() : null,
      }),
    [viewStateMutation],
  );

  const hideList = useCallback(
    (list: ListSummary) => {
      setView(list, "archivedAt", true);
      showToast({
        key: "hide-list",
        message: `Hidden “${list.name}”`,
        actionLabel: "Undo",
        durationMs: 6000,
        onAction: () => setView(list, "archivedAt", false),
      });
    },
    [setView, showToast],
  );

  const menuItems: ActionSheetItem[] = menuFor
    ? [
        {
          label: menuFor.pinnedAt ? "Unpin" : "Pin to top",
          icon: "pin",
          onPress: () => setView(menuFor, "pinnedAt", !menuFor.pinnedAt),
          testID: "row-menu-pin",
        },
        {
          label: "Share…",
          icon: "share",
          onPress: () => {
            setShareFor(menuFor);
            setShareOpen(true);
          },
          testID: "row-menu-share",
        },
        {
          label: menuFor.mutedAt ? "Unmute activity" : "Mute activity",
          icon: "bell",
          onPress: () => setView(menuFor, "mutedAt", !menuFor.mutedAt),
          testID: "row-menu-mute",
        },
        {
          label: "List settings",
          icon: "settings",
          onPress: () => router.push(`/list/${menuFor.id}/settings`),
          testID: "row-menu-settings",
        },
        {
          label: "Hide",
          icon: "hide",
          onPress: () => hideList(menuFor),
          testID: "row-menu-hide",
        },
      ]
    : [];

  const onCreateList = useCallback(() => router.push("/create-list/type"), [router]);
  const { create: createFromTemplate, pendingTemplateId } = useCreateFromTemplate();
  const hiddenCount = allLists.length - visibleLists.length;
  const isEmpty = !listsQuery.isPending && !!listsQuery.data && visibleLists.length === 0;
  const onActivity = useCallback(() => router.push("/activity"), [router]);

  // Web-only keyboard shortcuts: Cmd/Ctrl+N → new list; Cmd/Ctrl+/ → activity.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        onCreateList();
      } else if (mod && e.key === "/") {
        e.preventDefault();
        onActivity();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCreateList, onActivity]);

  return (
    <Screen style={styles.root}>
      <ScreenHeader
        leading="none"
        title="Lists"
        testID="home-header"
        trailing={
          <>
            <HeaderActivityButton
              unreadCount={totalUnread}
              error={activityFeedQuery.isError && !activityFeedQuery.data}
              onPress={onActivity}
              onRetry={() => {
                void activityFeedQuery.refetch();
              }}
              testID="open-activity"
            />
            <HomeAvatarButton />
          </>
        }
      />

      <View style={styles.body}>
        {listsQuery.isPending ? (
          <View style={styles.listContent}>
            <Skeleton.Rows count={7} testID="home-skeleton" />
          </View>
        ) : listsQuery.isError && !listsQuery.data ? (
          <PullToRefresh
            refreshing={listsQuery.isRefetching}
            onRefresh={() => listsQuery.refetch()}
          >
            <ScrollView contentContainerStyle={styles.center}>
              <EmptyState
                title="Couldn't load your lists"
                description={
                  isNetworkError(listsQuery.error)
                    ? "Check your connection and try again."
                    : "Something went wrong on our side. Try again in a moment."
                }
                action={
                  <Button
                    label="Try again"
                    variant="secondary"
                    loading={listsQuery.isRefetching}
                    onPress={() => listsQuery.refetch()}
                  />
                }
              />
            </ScrollView>
          </PullToRefresh>
        ) : isEmpty ? (
          <PullToRefresh
            refreshing={listsQuery.isRefetching}
            onRefresh={() => listsQuery.refetch()}
          >
            <ScrollView>
              <HomeEmpty
                hiddenCount={hiddenCount}
                pendingTemplateId={pendingTemplateId}
                onCreate={(template) => createFromTemplate({ template })}
                onMoreTemplates={onCreateList}
                onOpenHidden={() => router.push("/settings/hidden")}
              />
            </ScrollView>
          </PullToRefresh>
        ) : (
          <PullToRefresh
            refreshing={listsQuery.isRefetching}
            onRefresh={() => listsQuery.refetch()}
          >
            <FlatList
              data={entries}
              keyExtractor={(e) => e.key}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                showSearch ? (
                  <View style={styles.search}>
                    <TextField
                      variant="search"
                      value={search}
                      onChangeText={setSearch}
                      onClear={() => setSearch("")}
                      placeholder="Search lists"
                      accessibilityLabel="Search lists by name"
                      returnKeyType="search"
                      testID="home-search"
                    />
                  </View>
                ) : undefined
              }
              ListEmptyComponent={
                <Text tone="muted" style={styles.noMatch} testID="home-search-empty">
                  No list called “{search.trim()}”.
                </Text>
              }
              renderItem={({ item }) =>
                item.kind === "header" ? (
                  <SectionHeader title={item.title} style={styles.sectionHeader} />
                ) : (
                  <>
                    <HomeListRow
                      list={item.list}
                      latestEvent={latestByList.get(item.list.id) ?? null}
                      selfId={user?.id ?? null}
                      onPress={() => router.push(`/list/${item.list.id}`)}
                      onOpenMenu={() => openMenu(item.list)}
                    />
                    {item.lastInSection ? null : <View style={styles.rowSeparator} />}
                  </>
                )
              }
            />
          </PullToRefresh>
        )}
      </View>

      {/* One create affordance: the empty home's starters replace the FAB. */}
      {isEmpty ? null : (
        <Fab
          accessibilityLabel="Create new list"
          accessibilityHint={Platform.OS === "web" ? "Keyboard shortcut: command N" : undefined}
          tooltip="New list  (⌘N)"
          onPress={onCreateList}
          testID="fab-create-list"
        />
      )}

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        testID="row-menu-sheet"
        header={
          menuFor ? (
            <View style={styles.menuHeader}>
              <EmojiBadge
                emoji={menuFor.emoji}
                color={tokens.list[menuFor.color as ListColorKey] ?? tokens.accent.default}
                imageUrl={menuFor.coverPhotoUrl}
              />
              <View style={styles.menuIdentity}>
                <Text variant="heading" numberOfLines={1}>
                  {menuFor.name}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {homeRowCount(menuFor)}
                </Text>
              </View>
            </View>
          ) : null
        }
        items={menuItems}
      />

      <ShareListSheet list={shareFor} visible={shareOpen} onClose={() => setShareOpen(false)} />
    </Screen>
  );
}

const ROW_BADGE = 44;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingBottom: tokens.space.lg,
  },
  body: { flex: 1 },
  center: { flexGrow: 1, alignItems: "center", justifyContent: "center", gap: tokens.space.lg },
  listContent: {
    paddingTop: homeLayout.contentTopGap,
    paddingBottom: homeLayout.bottomInset,
  },
  search: {
    paddingHorizontal: homeLayout.horizontalInset,
    paddingBottom: tokens.space.sm,
  },
  noMatch: { paddingHorizontal: homeLayout.horizontalInset, paddingTop: tokens.space.md },
  sectionHeader: {
    paddingHorizontal: homeLayout.horizontalInset,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xs,
  },
  rowSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.border.subtle,
    marginLeft: tokens.space.xs + tokens.space.md + ROW_BADGE + tokens.space.md,
    marginRight: tokens.space.xs,
  },
  menuHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.sm,
    paddingBottom: tokens.space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.subtle,
  },
  menuIdentity: { flex: 1, minWidth: 0 },
});
