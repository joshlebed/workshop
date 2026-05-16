import { useQuery } from "@tanstack/react-query";
import type { ActivityEvent, ListSummary, ListType } from "@workshop/shared";
import { useFocusEffect, useRouter } from "expo-router";
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
import { fetchActivity } from "../src/api/activity";
import { fetchLists } from "../src/api/lists";
import { PullToRefresh } from "../src/components/PullToRefresh";
import { useAuth } from "../src/hooks/useAuth";
import { errorMessage } from "../src/lib/api";
import { confirm } from "../src/lib/confirm";
import { getActivityLastViewedAt } from "../src/lib/lastViewed";
import { queryKeys } from "../src/lib/queryKeys";
import {
  Button,
  EmptyState,
  type ListColorKey,
  Screen,
  Sheet,
  Text,
  tokens,
} from "../src/ui/index";

const TYPE_LABEL: Record<ListType, string> = {
  movie: "Movies",
  tv: "TV",
  book: "Books",
  date_idea: "Date ideas",
  trip: "Trips",
  album_shelf: "Album shelf",
  game: "Games",
};

const EVENT_VERB: Partial<Record<ActivityEvent["type"], string>> = {
  item_added: "added",
  item_updated: "edited",
  item_deleted: "removed an item",
  item_upvoted: "upvoted",
  item_unupvoted: "unupvoted",
  item_completed: "checked off",
  item_uncompleted: "uncrossed",
  item_promoted: "pinned",
  item_demoted: "unpinned",
  member_joined: "joined",
  member_left: "left",
  album_promoted: "pinned an album",
  album_demoted: "unpinned an album",
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

function initialsFor(name: string | null | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) return "·";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts[parts.length - 1]?.[0] ?? "";
  const initials = parts.length === 1 ? first : `${first}${last}`;
  return initials.toUpperCase() || "·";
}

export default function Home() {
  const { user, token, signOut } = useAuth();
  const router = useRouter();
  const listsQuery = useQuery({
    queryKey: queryKeys.lists.all,
    queryFn: () => fetchLists(token),
    enabled: !!token,
  });

  const activityFeedQuery = useQuery({
    queryKey: queryKeys.activity.feed,
    queryFn: () => fetchActivity({ limit: 50 }, token),
    enabled: !!token,
    staleTime: 30_000,
  });
  const events = activityFeedQuery.data?.events ?? [];

  const [lastViewedAt, setLastViewedAt] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getActivityLastViewedAt()
        .then((v) => {
          if (!cancelled) setLastViewedAt(v);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const unreadCount = useMemo(() => {
    let n = 0;
    for (const e of events) {
      if (e.actorId === user?.id) continue;
      if (lastViewedAt && new Date(e.createdAt).getTime() <= new Date(lastViewedAt).getTime()) {
        continue;
      }
      n++;
    }
    return n;
  }, [events, user?.id, lastViewedAt]);
  const hasUnread = unreadCount > 0;

  // The latest event per list — used as the subtitle when present.
  const latestByList = useMemo(() => {
    const map = new Map<string, ActivityEvent>();
    for (const e of events) {
      if (!map.has(e.listId)) map.set(e.listId, e);
    }
    return map;
  }, [events]);

  // Per-list unread state: count + latest unread event from another collaborator
  // since the user last viewed /activity. Drives the per-row accent affordance,
  // the multiplayer signal PRODUCT.md asks to make first-class. We track the
  // latest unread event separately (not just count) so the subtitle attributes
  // accurately — using the overall latestEvent would credit "Preview and others"
  // when self made the most recent action but Friend's earlier actions are unread.
  const unreadByList = useMemo(() => {
    const map = new Map<string, { count: number; latest: ActivityEvent; actorIds: Set<string> }>();
    const cutoff = lastViewedAt ? new Date(lastViewedAt).getTime() : 0;
    for (const e of events) {
      if (e.actorId === user?.id) continue;
      if (cutoff && new Date(e.createdAt).getTime() <= cutoff) continue;
      const prev = map.get(e.listId);
      if (!prev) {
        // events are newest-first, so the first one we see per list is the latest.
        map.set(e.listId, {
          count: 1,
          latest: e,
          actorIds: new Set([e.actorId]),
        });
      } else {
        prev.count++;
        prev.actorIds.add(e.actorId);
      }
    }
    return map;
  }, [events, user?.id, lastViewedAt]);

  // Sort lists by recency of their last activity (or updatedAt fallback).
  const sortedLists = useMemo(() => {
    const lists = listsQuery.data?.lists ?? [];
    return [...lists].sort((a, b) => {
      const ta = latestByList.get(a.id)?.createdAt ?? a.updatedAt;
      const tb = latestByList.get(b.id)?.createdAt ?? b.updatedAt;
      return new Date(tb).getTime() - new Date(ta).getTime();
    });
  }, [listsQuery.data, latestByList]);

  const [profileOpen, setProfileOpen] = useState(false);
  const [rowMenuFor, setRowMenuFor] = useState<ListSummary | null>(null);

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
  const onSignOut = async () => {
    setProfileOpen(false);
    const ok = await confirm({
      title: "Sign out?",
      message: "You'll need to sign in again to access your lists.",
      confirmLabel: "Sign out",
      destructive: true,
    });
    if (ok) signOut();
  };

  const initials = initialsFor(user?.displayName ?? user?.email);
  const displayName = user?.displayName?.trim();
  const greeting = displayName ? `Hi, ${displayName}` : "Your lists";

  return (
    <Screen style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerTitleBlock}>
          <Text variant="title" testID="home-greeting" style={styles.title}>
            {greeting}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              activityFeedQuery.isError
                ? "Activity (couldn't load, tap to retry)"
                : hasUnread
                  ? `Activity, ${unreadCount} new`
                  : "Activity"
            }
            onPress={() => {
              if (activityFeedQuery.isError) {
                activityFeedQuery.refetch();
                return;
              }
              onActivity();
            }}
            // @ts-expect-error: react-native-web threads native title through to <button title>
            title={Platform.OS === "web" ? "Activity  (⌘/)" : undefined}
            testID="open-activity"
            style={({ pressed }) => [styles.headerCircle, pressed && styles.headerCirclePressed]}
          >
            <ActivityGlyph unread={hasUnread} error={activityFeedQuery.isError} />
            {hasUnread && !activityFeedQuery.isError ? (
              <View style={styles.unreadBadge} testID="activity-unread-badge">
                <Text style={styles.unreadBadgeText} tone="onAccent">
                  {unreadCount > 9 ? "9+" : String(unreadCount)}
                </Text>
              </View>
            ) : null}
            {activityFeedQuery.isError ? (
              <View
                style={[styles.unreadBadge, { backgroundColor: tokens.status.danger }]}
                accessibilityLabel="Activity load failed"
              >
                <Text style={styles.unreadBadgeText} tone="onAccent">
                  !
                </Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Profile and settings"
            onPress={() => setProfileOpen(true)}
            testID="open-profile"
            style={({ pressed }) => [
              styles.headerCircle,
              styles.profileCircle,
              pressed && styles.headerCirclePressed,
            ]}
          >
            <Text style={styles.profileInitials} tone="secondary">
              {initials}
            </Text>
          </Pressable>
        </View>
      </View>

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
        ) : sortedLists.length === 0 ? (
          <View style={styles.center}>
            <View style={styles.emptyGlyphBadge}>
              <Text style={styles.emptyGlyph}>✦</Text>
            </View>
            <EmptyState
              title="Start your first list"
              description="Movies, books, trips, albums, date ideas. Anything you want to remember together."
              action={<Button label="Create a list" onPress={onCreateList} />}
            />
          </View>
        ) : (
          <PullToRefresh
            refreshing={listsQuery.isRefetching}
            onRefresh={() => listsQuery.refetch()}
          >
            <FlatList
              data={sortedLists}
              keyExtractor={(l) => l.id}
              contentContainerStyle={styles.listContent}
              ItemSeparatorComponent={() => <View style={styles.rowSeparator} />}
              renderItem={({ item }) => {
                const unread = unreadByList.get(item.id);
                return (
                  <ListRow
                    list={item}
                    latestEvent={latestByList.get(item.id) ?? null}
                    unreadCount={unread?.count ?? 0}
                    latestUnreadEvent={unread?.latest ?? null}
                    unreadActorCount={unread?.actorIds.size ?? 0}
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
                  {TYPE_LABEL[rowMenuFor.type]} ·{" "}
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
                label="List settings"
                onPress={() => {
                  const id = rowMenuFor.id;
                  setRowMenuFor(null);
                  router.push(`/list/${id}/settings`);
                }}
              />
              <RowMenuAction
                label={rowMenuFor.memberCount > 1 ? "Share again" : "Share with someone"}
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

      <Sheet
        visible={profileOpen}
        onRequestClose={() => setProfileOpen(false)}
        testID="profile-sheet"
      >
        <View style={styles.profileSheetHeader}>
          <View style={[styles.headerCircle, styles.profileCircle, styles.profileSheetAvatar]}>
            <Text style={styles.profileInitials} tone="secondary">
              {initials}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="heading" numberOfLines={1}>
              {user?.displayName?.trim() || "You"}
            </Text>
            {user?.email ? (
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {user.email}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.profileSheetActions}>
          <Button label="Sign out" variant="secondary" onPress={onSignOut} testID="sign-out" />
        </View>
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

// Activity affordance: three stacked horizontal bars of decreasing length,
// drawn from Views. Reads as "feed" / "list of recent things" without a
// dependency on an icon library, and stays calm at 16px.
function ActivityGlyph({ unread, error }: { unread: boolean; error?: boolean }) {
  const color = error ? tokens.text.muted : unread ? tokens.text.primary : tokens.text.secondary;
  return (
    <View style={styles.activityGlyph} pointerEvents="none">
      <View style={[styles.activityBar, { backgroundColor: color, width: 14 }]} />
      <View style={[styles.activityBar, { backgroundColor: color, width: 10 }]} />
      <View style={[styles.activityBar, { backgroundColor: color, width: 6 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingTop: tokens.space.lg,
    paddingBottom: tokens.space.lg,
    gap: tokens.space.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.xs,
  },
  headerTitleBlock: { flex: 1, minWidth: 0 },
  title: { fontSize: tokens.font.size.xl, letterSpacing: -0.4 },
  headerActions: { flexDirection: "row", gap: tokens.space.sm, alignItems: "center" },
  headerCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.surface,
  },
  headerCirclePressed: { backgroundColor: tokens.bg.elevated },
  activityGlyph: {
    gap: 3,
    alignItems: "flex-start",
    width: 14,
    height: 13,
    justifyContent: "center",
  },
  activityBar: {
    height: 1.5,
    borderRadius: 1,
  },
  unreadBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: tokens.accent.default,
    borderWidth: 2,
    borderColor: tokens.bg.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadBadgeText: {
    fontSize: 10,
    fontWeight: tokens.font.weight.bold,
    lineHeight: 12,
    letterSpacing: 0.1,
  },
  profileCircle: { borderColor: tokens.border.default },
  profileInitials: {
    fontSize: 12,
    fontWeight: tokens.font.weight.semibold,
    letterSpacing: 0.5,
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
  emptyGlyph: { fontSize: 28, color: tokens.accent.default },
  listContent: { paddingBottom: tokens.space.xxl * 2 },
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
  rowMembersInline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: tokens.font.weight.semibold,
    color: tokens.text.muted,
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.2,
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
    right: tokens.space.lg,
    bottom: tokens.space.lg,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: tokens.accent.default,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0px 6px 16px rgba(245, 165, 36, 0.28), 0px 2px 4px rgba(0, 0, 0, 0.3)",
    elevation: 5,
  },
  fabHovered: {
    backgroundColor: tokens.accent.hover,
    transform: [{ scale: 1.04 }],
  },
  fabPressed: { backgroundColor: tokens.accent.hover, transform: [{ scale: 0.96 }] },
  fabGlyph: { fontSize: 26, fontWeight: tokens.font.weight.semibold, lineHeight: 30 },
  profileSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
  },
  profileSheetAvatar: { width: 48, height: 48, borderRadius: 24 },
  profileSheetActions: { gap: tokens.space.sm },
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
  unreadCount,
  latestUnreadEvent,
  unreadActorCount,
  selfId,
  onPress,
  onContextMenu,
}: {
  list: ListSummary;
  latestEvent: ActivityEvent | null;
  unreadCount: number;
  latestUnreadEvent: ActivityEvent | null;
  unreadActorCount: number;
  selfId: string | null;
  onPress: () => void;
  onContextMenu: () => void;
}) {
  const accent = tokens.list[list.color as ListColorKey] ?? tokens.accent.default;
  const itemsLabel =
    list.itemCount === 0 ? "Empty" : `${list.itemCount} ${list.itemCount === 1 ? "item" : "items"}`;

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
    subtitle = `${TYPE_LABEL[list.type]} · ${itemsLabel}`;
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
          <Text variant="label" numberOfLines={1} style={styles.rowTitle}>
            {list.name}
          </Text>
          {shared ? (
            <Text
              style={styles.rowMembersInline}
              accessibilityLabel={`${list.memberCount} members`}
            >
              +{otherMembers}
            </Text>
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
