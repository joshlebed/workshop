import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type { ActivityEvent, ItemKind, ListSummary, ModuleName } from "@workshop/shared";
import {
  Button,
  EmptyState,
  HomeHeader,
  homeLayout,
  InlineTabSwitch,
  type ListColorKey,
  PullToRefresh,
  Screen,
  Sheet,
  Text,
  tokens,
} from "@workshop/ui";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
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
import { ProfileMenu } from "../../../src/components/ProfileMenu";
import { useAuth } from "../../../src/hooks/useAuth";
import { LEGACY_GAMES_TAB_ENABLED } from "../../../src/lib/featureFlags";

const KIND_LABEL: Partial<Record<ItemKind, string>> = {
  movie: "Movies",
  tv: "TV",
  book: "Books",
  link: "Links",
  spotify_album: "Album shelf",
  plain: "List",
};

function summaryLabel(list: { itemKind: ItemKind | null; modules: ModuleName[] }): string {
  if (list.itemKind && KIND_LABEL[list.itemKind]) return KIND_LABEL[list.itemKind]!;
  if (list.modules.includes("leaderboard")) return "Leaderboard";
  if (list.modules.includes("todo")) return "Checklist";
  return "List";
}

const EVENT_VERB: Partial<Record<ActivityEvent["type"], string>> = {
  item_added: "added",
  item_updated: "edited",
  item_tagged: "tagged",
  item_archived: "archived an item",
  list_archived: "archived the list",
  item_completed: "checked off",
  item_uncompleted: "uncrossed",
  item_promoted: "pinned",
  item_demoted: "unpinned",
  member_joined: "joined",
  member_left: "left",
};

function relativeShort(iso: string, now = Date.now()): string {
  const diffMs = now - new Date(iso).getTime();
  if (diffMs < 0) return "now";
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  return `${Math.floor(d / 30)}mo`;
}

// Visual "shared" cue for the home row. Returns a list of accent-alpha
// hex suffixes — one dot per other member, capped at three. Each dot is
// progressively more transparent so the eye picks up "more people"
// without having to literally count past three. The accessibility label
// always carries the real count.
function sharedDotAlphas(memberCount: number): string[] {
  const others = Math.max(0, memberCount - 1);
  if (others <= 0) return [];
  if (others === 1) return ["AA", "55"];
  if (others === 2) return ["BB", "77", "44"];
  return ["CC", "88", "44"];
}

export default function Home() {
  const { user, token } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
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
  const events = activityFeedQuery.data?.events ?? [];

  const allLists = listsQuery.data?.lists ?? [];

  // The header bell sums server-side `unreadCount` across non-muted lists.
  // Muted lists report 0 from the server, but we filter again here as
  // belt-and-braces and to make the intent obvious at the read site.
  const totalUnread = useMemo(() => {
    let n = 0;
    for (const l of allLists) {
      if (l.mutedAt) continue;
      n += l.unreadCount;
    }
    return n;
  }, [allLists]);

  // The latest event per list — used as the subtitle when present, and as
  // the attribution source for the "X new from Sarah" copy (we look up the
  // latest event with a non-self actor on a given list).
  const latestByList = useMemo(() => {
    const map = new Map<string, ActivityEvent>();
    for (const e of events) {
      if (!map.has(e.listId)) map.set(e.listId, e);
    }
    return map;
  }, [events]);

  // For attribution on unread rows: latest event on that list authored by
  // someone other than the viewer. The count itself comes from the server
  // (`list.unreadCount`); this just supplies the name + a hint at whether
  // multiple collaborators were involved (by checking if any earlier
  // non-self event on the same list has a different actorId).
  const latestUnreadByList = useMemo(() => {
    const map = new Map<string, { latest: ActivityEvent; actorIds: Set<string> }>();
    for (const e of events) {
      if (e.actorId === user?.id) continue;
      const prev = map.get(e.listId);
      if (!prev) map.set(e.listId, { latest: e, actorIds: new Set([e.actorId]) });
      else prev.actorIds.add(e.actorId);
    }
    return map;
  }, [events, user?.id]);

  // Pinned first (pinned-most-recently within pinned), then by recency of
  // last activity (or updatedAt fallback). Archived lists are filtered out
  // of the main view and only visible from the profile sheet.
  const visibleLists = useMemo(() => {
    const lists = allLists.filter((l) => !l.archivedAt);
    return [...lists].sort((a, b) => {
      const ap = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
      const bp = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
      if (ap !== bp) return bp - ap; // pinned (highest pinnedAt) first
      const ta = latestByList.get(a.id)?.createdAt ?? a.updatedAt;
      const tb = latestByList.get(b.id)?.createdAt ?? b.updatedAt;
      return new Date(tb).getTime() - new Date(ta).getTime();
    });
  }, [allLists, latestByList]);

  const archivedLists = useMemo(() => allLists.filter((l) => !!l.archivedAt), [allLists]);

  const [rowMenuFor, setRowMenuFor] = useState<ListSummary | null>(null);

  // Per-list view-state toggles. Each is optimistic on the query cache so the
  // row's pin/archive/mute affordance flips before the network round-trip.
  // On error we invalidate to snap back to server truth — the toast surfaces
  // the failure to the user.
  const viewStateMutation = useMutation<
    { ok: true },
    Error,
    { id: string; field: "pinnedAt" | "archivedAt" | "mutedAt"; value: string | null }
  >({
    mutationFn: async ({ id, field, value }) => {
      if (field === "pinnedAt") return value ? pinList(id, token) : unpinList(id, token);
      if (field === "archivedAt") return value ? archiveList(id, token) : unarchiveList(id, token);
      return value ? muteList(id, token) : unmuteList(id, token);
    },
    onMutate: async ({ id, field, value }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.lists.all });
      const prev = queryClient.getQueryData<{ lists: ListSummary[] }>(queryKeys.lists.all);
      if (prev) {
        queryClient.setQueryData<{ lists: ListSummary[] }>(queryKeys.lists.all, {
          lists: prev.lists.map((l) =>
            l.id === id
              ? {
                  ...l,
                  [field]: value,
                  // muting zeroes unread on the server; mirror that locally so
                  // the header bell updates immediately.
                  ...(field === "mutedAt" && value ? { unreadCount: 0 } : null),
                }
              : l,
          ),
        });
      }
      return prev ? { previous: prev } : {};
    },
    onError: (_e, _vars, ctx) => {
      const previous = (ctx as { previous?: { lists: ListSummary[] } } | undefined)?.previous;
      if (previous) queryClient.setQueryData(queryKeys.lists.all, previous);
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
    },
  });

  const onCreateList = useCallback(() => router.push("/create-list/type"), [router]);
  const onActivity = useCallback(() => router.push("/activity"), [router]);

  // Web-only keyboard shortcuts. Cmd/Ctrl+N → new list; cmd/ctrl+slash → activity.
  // Ignored on native (no DOM); ignored when focus is in an input.
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
      <HomeHeader
        left={LEGACY_GAMES_TAB_ENABLED ? <InlineTabSwitch /> : null}
        right={
          <>
            <HeaderActivityButton
              unreadCount={totalUnread}
              error={activityFeedQuery.isError}
              onPress={onActivity}
              onRetry={() => {
                void activityFeedQuery.refetch();
              }}
              testID="open-activity"
            />
            <ProfileMenu archivedLists={archivedLists} />
          </>
        }
      />

      <View style={styles.body}>
        {listsQuery.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator color={tokens.accent.default} />
          </View>
        ) : listsQuery.isError ? (
          <View style={styles.center}>
            <EmptyState
              title="Couldn't load your lists"
              description={errorMessage(listsQuery.error)}
              action={
                <Button label="Retry" variant="secondary" onPress={() => listsQuery.refetch()} />
              }
            />
          </View>
        ) : visibleLists.length === 0 ? (
          <View style={styles.center}>
            <View style={styles.emptyGlyphBadge}>
              <Text style={styles.emptyGlyph}>✦</Text>
            </View>
            <Button label="Create a list" onPress={onCreateList} />
          </View>
        ) : (
          <PullToRefresh
            refreshing={listsQuery.isRefetching}
            onRefresh={() => listsQuery.refetch()}
          >
            <FlatList
              data={visibleLists}
              keyExtractor={(l) => l.id}
              contentContainerStyle={styles.listContent}
              ItemSeparatorComponent={() => <View style={styles.rowSeparator} />}
              renderItem={({ item }) => {
                const unreadMeta = latestUnreadByList.get(item.id);
                return (
                  <ListRow
                    list={item}
                    latestEvent={latestByList.get(item.id) ?? null}
                    latestUnreadEvent={unreadMeta?.latest ?? null}
                    unreadActorCount={unreadMeta?.actorIds.size ?? 0}
                    selfId={user?.id ?? null}
                    onPress={() => router.push(`/list/${item.id}`)}
                    onContextMenu={() => setRowMenuFor(item)}
                  />
                );
              }}
            />
          </PullToRefresh>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create new list"
        accessibilityHint={Platform.OS === "web" ? "Keyboard shortcut: command N" : undefined}
        onPress={onCreateList}
        // @ts-expect-error: react-native-web threads native title through to <button title>
        title={Platform.OS === "web" ? "New list  (⌘N)" : undefined}
        style={({ pressed, hovered }: PressableState) => [
          styles.fab,
          hovered && styles.fabHovered,
          pressed && styles.fabPressed,
        ]}
        testID="fab-create-list"
      >
        <Text style={styles.fabGlyph} tone="onAccent">
          +
        </Text>
      </Pressable>

      <Sheet
        visible={rowMenuFor !== null}
        onRequestClose={() => setRowMenuFor(null)}
        testID="row-menu-sheet"
      >
        {rowMenuFor ? (
          <View>
            <View style={styles.rowMenuHeader}>
              <View
                style={[
                  styles.rowMenuAvatar,
                  {
                    backgroundColor: `${
                      tokens.list[rowMenuFor.color as ListColorKey] ?? tokens.accent.default
                    }26`,
                  },
                ]}
              >
                <Text style={styles.avatarEmoji}>{rowMenuFor.emoji}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="heading" numberOfLines={1}>
                  {rowMenuFor.name}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {summaryLabel(rowMenuFor)} ·{" "}
                  {rowMenuFor.itemCount === 0
                    ? "empty"
                    : `${rowMenuFor.itemCount} ${rowMenuFor.itemCount === 1 ? "item" : "items"}`}
                </Text>
              </View>
            </View>
            <View style={styles.rowMenuActions}>
              <RowMenuAction
                label="Open list"
                onPress={() => {
                  const id = rowMenuFor.id;
                  setRowMenuFor(null);
                  router.push(`/list/${id}`);
                }}
              />
              <RowMenuAction
                label={rowMenuFor.pinnedAt ? "Unpin from top" : "Pin to top"}
                onPress={() => {
                  viewStateMutation.mutate({
                    id: rowMenuFor.id,
                    field: "pinnedAt",
                    value: rowMenuFor.pinnedAt ? null : new Date().toISOString(),
                  });
                  setRowMenuFor(null);
                }}
              />
              <RowMenuAction
                label={rowMenuFor.mutedAt ? "Unmute" : "Mute notifications"}
                onPress={() => {
                  viewStateMutation.mutate({
                    id: rowMenuFor.id,
                    field: "mutedAt",
                    value: rowMenuFor.mutedAt ? null : new Date().toISOString(),
                  });
                  setRowMenuFor(null);
                }}
              />
              <RowMenuAction
                label={rowMenuFor.archivedAt ? "Unarchive" : "Archive"}
                onPress={() => {
                  viewStateMutation.mutate({
                    id: rowMenuFor.id,
                    field: "archivedAt",
                    value: rowMenuFor.archivedAt ? null : new Date().toISOString(),
                  });
                  setRowMenuFor(null);
                }}
              />
              <RowMenuAction
                label="List settings"
                onPress={() => {
                  const id = rowMenuFor.id;
                  setRowMenuFor(null);
                  router.push(`/list/${id}/settings`);
                }}
              />
            </View>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

function RowMenuAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.rowMenuAction,
        pressed && { backgroundColor: tokens.bg.elevated },
      ]}
    >
      <Text variant="label" style={styles.rowMenuActionLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingTop: tokens.space.lg,
    paddingBottom: tokens.space.lg,
  },
  body: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: tokens.space.lg },
  emptyGlyphBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.accent.muted,
  },
  emptyGlyph: { fontSize: 28, lineHeight: 32, color: tokens.accent.default },
  listContent: {
    paddingTop: homeLayout.contentTopGap,
    paddingBottom: homeLayout.bottomInset,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md,
    borderRadius: tokens.radius.md,
    marginHorizontal: tokens.space.xs,
  },
  rowHovered: { backgroundColor: tokens.bg.surface },
  rowFocused: {
    backgroundColor: tokens.bg.surface,
    outlineWidth: 0,
    boxShadow: `0 0 0 1.5px ${tokens.accent.default}`,
  },
  rowPressed: { backgroundColor: tokens.bg.elevated },
  rowBody: { flex: 1, gap: 3, minWidth: 0 },
  rowTitleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    minWidth: 0,
  },
  rowTitle: { fontSize: tokens.font.size.md, letterSpacing: -0.2, flexShrink: 1 },
  rowSharedDots: {
    flexDirection: "row",
    alignItems: "center",
    height: 14,
  },
  rowSharedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  rowSharedDotOverlap: {
    marginLeft: -2,
  },
  rowPinGlyph: {
    color: tokens.accent.default,
    fontSize: 11,
    lineHeight: 14,
  },
  rowMutedGlyph: {
    fontSize: 10,
    lineHeight: 14,
    color: tokens.text.muted,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontWeight: tokens.font.weight.semibold,
  },
  rowSubtitle: { fontSize: 12, lineHeight: 16 },
  rowSubtitleEmphasis: { color: tokens.text.secondary },
  rowSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.border.subtle,
    marginLeft: tokens.space.lg + tokens.space.xs + 48 + tokens.space.md,
    marginRight: tokens.space.xs,
  },
  avatarWrap: { position: "relative" },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  avatarEmoji: { fontSize: 24, lineHeight: 28 },
  unreadPip: {
    position: "absolute",
    top: -1,
    right: -1,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 2,
  },
  fab: {
    position: "absolute",
    right: homeLayout.horizontalInset,
    bottom: homeLayout.horizontalInset,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: tokens.accent.default,
    alignItems: "center",
    justifyContent: "center",
    // Calm neutral elevation, not an amber glow (see DESIGN.md "calm by default").
    boxShadow: "0px 10px 24px rgba(0, 0, 0, 0.45), 0px 2px 6px rgba(0, 0, 0, 0.30)",
    elevation: 5,
  },
  fabHovered: {
    backgroundColor: tokens.accent.hover,
    transform: [{ scale: 1.04 }],
  },
  fabPressed: { backgroundColor: tokens.accent.hover, transform: [{ scale: 0.96 }] },
  fabGlyph: { fontSize: 28, fontWeight: tokens.font.weight.semibold, lineHeight: 32 },
  rowMenuHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingBottom: tokens.space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.subtle,
    marginBottom: tokens.space.sm,
  },
  rowMenuAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  rowMenuActions: { gap: 2 },
  rowMenuAction: {
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.md,
    borderRadius: tokens.radius.md,
  },
  rowMenuActionLabel: {
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.medium,
  },
});

function ListRow({
  list,
  latestEvent,
  latestUnreadEvent,
  unreadActorCount,
  selfId,
  onPress,
  onContextMenu,
}: {
  list: ListSummary;
  latestEvent: ActivityEvent | null;
  latestUnreadEvent: ActivityEvent | null;
  unreadActorCount: number;
  selfId: string | null;
  onPress: () => void;
  onContextMenu: () => void;
}) {
  const accent = tokens.list[list.color as ListColorKey] ?? tokens.accent.default;
  const itemsLabel =
    list.itemCount === 0 ? "Empty" : `${list.itemCount} ${list.itemCount === 1 ? "item" : "items"}`;
  // Unread count is server-authored on `list.unreadCount`. Muted lists
  // report 0, so the per-row pip and accent subtitle naturally hide.
  const unreadCount = list.unreadCount;

  // Subtitle resolution. Priority:
  //  1. Unread events by collaborators since last view → "N new from Sarah".
  //  2. Most recent activity by another collaborator (read).
  //  3. Most recent activity by self → terse "Updated 1m".
  //  4. List description if set.
  //  5. Type + item count fallback.
  let subtitle: string;
  let subtitleEmphasis = false;
  if (unreadCount > 0 && latestUnreadEvent?.actorDisplayName?.trim()) {
    const who = latestUnreadEvent.actorDisplayName.trim().split(/\s+/)[0];
    if (unreadCount === 1) {
      subtitle = `1 new from ${who}`;
    } else if (unreadActorCount <= 1) {
      subtitle = `${unreadCount} new from ${who}`;
    } else {
      subtitle = `${unreadCount} new · ${who} and others`;
    }
    subtitleEmphasis = true;
  } else if (latestEvent && EVENT_VERB[latestEvent.type] && latestEvent.actorDisplayName?.trim()) {
    const isSelf = selfId && latestEvent.actorId === selfId;
    const when = relativeShort(latestEvent.createdAt);
    if (isSelf) {
      subtitle = `Updated ${when}`;
    } else {
      const who = latestEvent.actorDisplayName.trim().split(/\s+/)[0];
      subtitle = `${who} ${EVENT_VERB[latestEvent.type]} · ${when}`;
      subtitleEmphasis = true;
    }
  } else if (list.description?.trim()) {
    subtitle = list.description.trim();
  } else {
    subtitle = `${summaryLabel(list)} · ${itemsLabel}`;
  }

  const shared = list.memberCount > 1;
  const otherMembers = Math.max(0, list.memberCount - 1);
  const isUnread = unreadCount > 0;

  // On web, hook the native contextmenu event so right-click opens the row's
  // quick-action sheet. Long-press from React Native's Pressable handles touch.
  const webContextMenuProps =
    Platform.OS === "web"
      ? ({
          onContextMenu: (e: { preventDefault: () => void }) => {
            e.preventDefault();
            onContextMenu();
          },
        } as Record<string, unknown>)
      : {};

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open list ${list.name}`}
      accessibilityHint="Long press for more options"
      onPress={onPress}
      onLongPress={onContextMenu}
      delayLongPress={350}
      testID={`list-card-${list.id}`}
      {...webContextMenuProps}
      style={({ pressed, hovered, focused }: PressableState) => [
        styles.row,
        hovered && styles.rowHovered,
        focused && styles.rowFocused,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.avatarWrap}>
        {list.coverPhotoUrl ? (
          <Image
            source={{ uri: list.coverPhotoUrl }}
            style={[styles.avatar, { borderColor: `${accent}33` }]}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View
            style={[
              styles.avatar,
              {
                backgroundColor: `${accent}26`,
                borderColor: `${accent}3D`,
              },
            ]}
          >
            <Text style={styles.avatarEmoji}>{list.emoji}</Text>
          </View>
        )}
        {isUnread ? (
          <View
            style={[styles.unreadPip, { backgroundColor: accent, borderColor: tokens.bg.canvas }]}
            accessibilityLabel={`${unreadCount} unread`}
            pointerEvents="none"
          />
        ) : null}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTitleRow}>
          {list.pinnedAt ? (
            <Text style={styles.rowPinGlyph} accessibilityLabel="Pinned">
              ✦
            </Text>
          ) : null}
          <Text variant="label" numberOfLines={1} style={styles.rowTitle}>
            {list.name}
          </Text>
          {list.mutedAt ? (
            <Text style={styles.rowMutedGlyph} accessibilityLabel="Muted">
              muted
            </Text>
          ) : null}
          {shared && !subtitleEmphasis ? (
            <View
              style={styles.rowSharedDots}
              accessibilityLabel={`Shared with ${otherMembers} ${otherMembers === 1 ? "other" : "others"}`}
              importantForAccessibility="yes"
            >
              {sharedDotAlphas(list.memberCount).map((alpha, i) => (
                <View
                  // biome-ignore lint/suspicious/noArrayIndexKey: alphas array is stable per memberCount value
                  key={i}
                  style={[
                    styles.rowSharedDot,
                    i > 0 ? styles.rowSharedDotOverlap : null,
                    { backgroundColor: `${accent}${alpha}` },
                  ]}
                />
              ))}
            </View>
          ) : null}
        </View>
        <Text
          tone={subtitleEmphasis ? "secondary" : "muted"}
          numberOfLines={1}
          style={[
            styles.rowSubtitle,
            subtitleEmphasis ? styles.rowSubtitleEmphasis : null,
            isUnread ? { color: accent } : null,
          ]}
        >
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

type PressableState = {
  pressed?: boolean;
  hovered?: boolean;
  focused?: boolean;
};
