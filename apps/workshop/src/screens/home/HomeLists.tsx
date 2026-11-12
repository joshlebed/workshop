import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  haptics,
  IconButton,
  type ListColorKey,
  layout,
  PullToRefresh,
  Reveal,
  Screen,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  screenColumnStyle,
  Text,
  TextField,
  tokens,
  useRevealAfterLoading,
  useToast,
} from "@workshop/ui";
import { type Href, useIsFocused, usePathname, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  type TextInputInstance,
  View,
} from "react-native";
import { fetchActivity } from "../../api/activity";
import {
  archiveList,
  fetchLists,
  muteList,
  pinList,
  unarchiveList,
  unmuteList,
  unpinList,
} from "../../api/lists";
import { HeaderActivityButton } from "../../components/HeaderActivityButton";
import { HomeAvatarButton } from "../../components/HomeAvatarButton";
import { ShareListSheet } from "../../components/ShareListSheet";
import { useAuth } from "../../hooks/useAuth";
import { useCreateFromTemplate } from "../../hooks/useCreateFromTemplate";
import { keepFocusNearRow, keepFocusOn } from "../../lib/a11y/keepFocusNear";
import { FAILURE_TOAST_KEY, failureMessage, isNetworkError } from "../../lib/errorCopy";
import { homeListOrder } from "../../lib/homeListOrder";
import { useShortcuts } from "../../lib/shortcuts/useShortcuts";
import { HomeEmpty } from "./HomeEmpty";
import { HomeListRow } from "./HomeListRow";
import { HOME_SEARCH_THRESHOLD, homeRowCount, matchesListSearch } from "./homeRow";

type ViewField = "pinnedAt" | "archivedAt" | "mutedAt";

type HomeEntry =
  | { kind: "header"; key: string; title: string }
  | { kind: "list"; key: string; list: ListSummary; lastInSection: boolean };

export interface HomeListsProps {
  /**
   * `page`: the phone home screen. `sidebar`: the left pane of the desktop
   * two-pane layout (5.7c), with the open list highlighted and a header
   * "New list" button instead of the FAB.
   */
  variant: "page" | "sidebar";
}

/** The lists: home on a phone, the sidebar on a wide screen. */
export function HomeLists({ variant }: HomeListsProps) {
  const { user, token } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast, dismissKey } = useToast();
  const livePoll = useLivePollingInterval();

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
      if (field === "archivedAt") dismissKey("hide-list");
      showToast({
        key: FAILURE_TOAST_KEY,
        message: failureMessage(e, `Couldn't ${what} that list.`),
        tone: "danger",
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
    },
  });

  const setView = useCallback(
    (list: ListSummary, field: ViewField, on: boolean) => {
      // Pin and mute are toggles (`selection`); hide / unhide commit (`light`).
      if (field === "archivedAt") haptics.light();
      else haptics.selection();
      viewStateMutation.mutate({
        id: list.id,
        field,
        value: on ? new Date().toISOString() : null,
      });
    },
    [viewStateMutation],
  );

  const hideList = useCallback(
    (list: ListSummary) => {
      // Web: the row is about to go; keep keyboard focus in the list.
      keepFocusNearRow("list-card-", list.id);
      setView(list, "archivedAt", true);
      showToast({
        key: "hide-list",
        message: `Hidden “${list.name}”`,
        actionLabel: "Undo",
        durationMs: 6000,
        onAction: () => {
          setView(list, "archivedAt", false);
          keepFocusOn(`list-card-${list.id}`, { force: true });
        },
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
  // Rows that replace the skeleton fade in; cached rows paint at once.
  const listsRevealed = useRevealAfterLoading(listsQuery.isPending);
  const onActivity = useCallback(() => router.push("/activity"), [router]);

  // Web shortcuts (5.7b): N for a new list, / or ⌘K for search. The page
  // variant answers only while home is the screen on top; the sidebar only
  // while the right pane shows the home placeholder.
  const isFocused = useIsFocused();
  const pathname = usePathname();
  const searchRef = useRef<TextInputInstance>(null);
  const shortcutsLive = variant === "page" ? isFocused : pathname === "/";
  useShortcuts(
    {
      new: onCreateList,
      search: showSearch ? () => searchRef.current?.focus?.() : undefined,
    },
    shortcutsLive,
  );

  // The sidebar keeps the stack shallow: opening a list from it replaces
  // whatever the right pane showed (home stays beneath), instead of piling
  // every list you click onto the stack.
  const selectedListId = variant === "sidebar" ? /^\/list\/([^/]+)/.exec(pathname)?.[1] : undefined;
  const openList = useCallback(
    (id: string) => {
      if (variant === "page") {
        router.push(`/list/${id}`);
        return;
      }
      if (pathname === `/list/${id}`) return;
      if (router.canDismiss()) router.dismissTo("/");
      router.push(`/list/${id}` as Href);
    },
    [variant, pathname, router],
  );

  const fab =
    variant === "page" && !isEmpty ? (
      // One create affordance: the empty home's starters replace the FAB.
      <Fab
        accessibilityLabel="New list"
        accessibilityHint={Platform.OS === "web" ? "Keyboard shortcut: N" : undefined}
        tooltip="New list  (N)"
        onPress={onCreateList}
        testID="fab-create-list"
      />
    ) : null;

  const content = (
    <>
      <ScreenHeader
        leading="none"
        title="Lists"
        // In the sidebar the open list (or the placeholder) holds the page's
        // one level-1 heading; the sidebar's own title is level 2.
        titleLevel={variant === "sidebar" ? 2 : 1}
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
            {variant === "sidebar" ? (
              <IconButton
                icon="plus"
                accessibilityLabel="New list"
                tooltip="New list  (N)"
                onPress={onCreateList}
                testID="sidebar-create-list"
              />
            ) : null}
          </>
        }
      />

      <View style={styles.body}>
        {listsQuery.isPending ? (
          <View style={[styles.listContent, screenColumnStyle]}>
            <Skeleton.Rows count={7} testID="home-skeleton" />
          </View>
        ) : listsQuery.isError && !listsQuery.data ? (
          <PullToRefresh
            refreshing={listsQuery.isRefetching}
            onRefresh={() => listsQuery.refetch()}
          >
            <ScrollView contentContainerStyle={[styles.center, screenColumnStyle]}>
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
            <ScrollView contentContainerStyle={screenColumnStyle}>
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
          <Reveal when={listsRevealed}>
            <PullToRefresh
              refreshing={listsQuery.isRefetching}
              onRefresh={() => listsQuery.refetch()}
            >
              <FlatList
                data={entries}
                keyExtractor={(e) => e.key}
                contentContainerStyle={[styles.listContent, screenColumnStyle]}
                keyboardShouldPersistTaps="handled"
                ListHeaderComponent={
                  showSearch ? (
                    <View style={styles.search}>
                      <TextField
                        ref={searchRef}
                        variant="search"
                        value={search}
                        onChangeText={setSearch}
                        onClear={() => setSearch("")}
                        placeholder="Search lists"
                        // Return opens the first match (5, critique).
                        submitBehavior="blurAndSubmit"
                        onSubmitEditing={() => {
                          const first = entries.find((e) => e.kind === "list");
                          if (first?.kind === "list") openList(first.list.id);
                        }}
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
                renderItem={({ item, index }) =>
                  item.kind === "header" ? (
                    <SectionHeader title={item.title} first={index === 0} />
                  ) : (
                    <>
                      <HomeListRow
                        list={item.list}
                        latestEvent={latestByList.get(item.list.id) ?? null}
                        selfId={user?.id ?? null}
                        selected={item.list.id === selectedListId}
                        onPress={() => openList(item.list.id)}
                        onOpenMenu={() => openMenu(item.list)}
                      />
                      {item.lastInSection ? null : <View style={styles.rowSeparator} />}
                    </>
                  )
                }
              />
            </PullToRefresh>
          </Reveal>
        )}
      </View>

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        testID="row-menu-sheet"
        accessibilityLabel={menuFor ? `Actions for ${menuFor.name}` : undefined}
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
    </>
  );

  if (variant === "page") {
    return (
      <Screen style={styles.root} overlay={fab}>
        {content}
      </Screen>
    );
  }
  return (
    <View style={styles.sidebar} role="navigation" aria-label="Lists" testID="lists-sidebar">
      {content}
    </View>
  );
}

const ROW_BADGE = 44;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingBottom: tokens.space.lg,
  },
  sidebar: { flex: 1, backgroundColor: tokens.bg.canvas },
  body: { flex: 1 },
  center: { flexGrow: 1, alignItems: "center", justifyContent: "center", gap: tokens.space.lg },
  listContent: {
    paddingTop: layout.contentTopGap,
    paddingBottom: layout.bottomInset,
  },
  search: {
    paddingHorizontal: layout.gutter,
    paddingBottom: tokens.space.sm,
  },
  noMatch: { paddingHorizontal: layout.gutter, paddingTop: tokens.space.md },
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
