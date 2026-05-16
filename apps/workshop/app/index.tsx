import { useQuery } from "@tanstack/react-query";
import type { ActivityEvent, ListSummary, ListType } from "@workshop/shared";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, View } from "react-native";
import { fetchActivity } from "../src/api/activity";
import { fetchLists } from "../src/api/lists";
import { PullToRefresh } from "../src/components/PullToRefresh";
import { useAuth } from "../src/hooks/useAuth";
import { errorMessage } from "../src/lib/api";
import { confirm } from "../src/lib/confirm";
import { getActivityLastViewedAt } from "../src/lib/lastViewed";
import { queryKeys } from "../src/lib/queryKeys";
import { Button, EmptyState, type ListColorKey, Sheet, Text, tokens } from "../src/ui/index";

const TYPE_LABEL: Record<ListType, string> = {
  movie: "Movies",
  tv: "TV",
  book: "Books",
  date_idea: "Date ideas",
  trip: "Trips",
  album_shelf: "Album shelf",
  game: "Games",
};

// Past-tense, short, friend-y verb phrases. Used to attribute the latest
// activity per list on the home row subtitle.
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

function partOfDay(date = new Date()): "morning" | "afternoon" | "evening" | "night" {
  const h = date.getHours();
  if (h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 22) return "evening";
  return "night";
}

const DAY_LABEL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function buildContextLine(date = new Date()): string {
  const day = DAY_LABEL[date.getDay()] ?? "";
  return `${day} ${partOfDay(date)}`;
}

function buildHeadline(): string {
  // Personalizing the headline ("Sarah's shelf") loses to the calmer second-
  // person voice. "Your shelf" reads like a label on the room, not a greeting.
  return "Your shelf";
}

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

  // Re-use the activity feed for two purposes: (1) the unread dot on the
  // header activity affordance, and (2) the most-recent attribution line on
  // each list row. The same `staleTime` and 50-event window cover both.
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
  const hasUnread = events.some((e) => {
    if (e.actorId === user?.id) return false;
    if (lastViewedAt && new Date(e.createdAt).getTime() <= new Date(lastViewedAt).getTime()) {
      return false;
    }
    return true;
  });

  // The latest event per list — used as the subtitle when present.
  // events are returned newest-first by the API, so a Map captures the first
  // occurrence of each listId without sorting.
  const latestByList = useMemo(() => {
    const map = new Map<string, ActivityEvent>();
    for (const e of events) {
      if (!map.has(e.listId)) map.set(e.listId, e);
    }
    return map;
  }, [events]);

  // Sort lists by recency of their last activity (or updatedAt fallback).
  // Active lists rise; the dead inventory falls without the user needing to
  // archive anything.
  const sortedLists = useMemo(() => {
    const lists = listsQuery.data?.lists ?? [];
    return [...lists].sort((a, b) => {
      const ta = latestByList.get(a.id)?.createdAt ?? a.updatedAt;
      const tb = latestByList.get(b.id)?.createdAt ?? b.updatedAt;
      return new Date(tb).getTime() - new Date(ta).getTime();
    });
  }, [listsQuery.data, latestByList]);

  const [profileOpen, setProfileOpen] = useState(false);

  const onCreateList = () => router.push("/create-list/type");
  const onActivity = () => router.push("/activity");
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

  const headline = buildHeadline();
  const contextLine = buildContextLine();
  const initials = initialsFor(user?.displayName ?? user?.email);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerTitleBlock}>
          <Text variant="caption" tone="muted" style={styles.headerContext}>
            {contextLine.charAt(0).toUpperCase() + contextLine.slice(1)}
          </Text>
          <Text variant="title" testID="home-greeting" style={styles.title}>
            {headline}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hasUnread ? "Activity, unread" : "Activity"}
            onPress={onActivity}
            testID="open-activity"
            style={({ pressed }) => [styles.headerCircle, pressed && styles.headerCirclePressed]}
          >
            <View
              style={[styles.activityDot, hasUnread ? styles.activityDotUnread : null]}
              testID={hasUnread ? "activity-unread-badge" : undefined}
            />
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
              renderItem={({ item }) => (
                <ListRow
                  list={item}
                  latestEvent={latestByList.get(item.id) ?? null}
                  selfId={user?.id ?? null}
                  onPress={() => router.push(`/list/${item.id}`)}
                />
              )}
            />
          </PullToRefresh>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create new list"
        onPress={onCreateList}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        testID="fab-create-list"
      >
        <Text style={styles.fabGlyph} tone="onAccent">
          +
        </Text>
      </Pressable>

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
    </View>
  );
}

function ListRow({
  list,
  latestEvent,
  selfId,
  onPress,
}: {
  list: ListSummary;
  latestEvent: ActivityEvent | null;
  selfId: string | null;
  onPress: () => void;
}) {
  const accent = tokens.list[list.color as ListColorKey] ?? tokens.accent.default;
  const itemsLabel =
    list.itemCount === 0 ? "Empty" : `${list.itemCount} ${list.itemCount === 1 ? "item" : "items"}`;

  // Prefer last-action attribution when an actor name is known; fall back to
  // type + count. This is the multiplayer signal PRODUCT.md asks for.
  let subtitle: string;
  if (latestEvent && EVENT_VERB[latestEvent.type] && latestEvent.actorDisplayName?.trim()) {
    const isSelf = selfId && latestEvent.actorId === selfId;
    const who = isSelf ? "You" : latestEvent.actorDisplayName.trim().split(/\s+/)[0];
    subtitle = `${who} ${EVENT_VERB[latestEvent.type]} · ${relativeShort(latestEvent.createdAt)}`;
  } else if (list.description?.trim()) {
    subtitle = list.description.trim();
  } else {
    subtitle = `${TYPE_LABEL[list.type]} · ${itemsLabel}`;
  }

  // A list is "live" when the most recent activity is within 24h. This earns
  // a tiny accent dot at the top-right of the avatar — calm, not loud.
  const isLive = latestEvent
    ? Date.now() - new Date(latestEvent.createdAt).getTime() < 24 * 60 * 60 * 1000
    : false;

  const shared = list.memberCount > 1;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open list ${list.name}`}
      onPress={onPress}
      testID={`list-card-${list.id}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.avatarWrap}>
        {list.coverPhotoUrl ? (
          <Image
            source={{ uri: list.coverPhotoUrl }}
            style={styles.avatar}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={[styles.avatar, { backgroundColor: `${accent}1F` }]}>
            <Text style={styles.avatarEmoji}>{list.emoji}</Text>
          </View>
        )}
        {isLive ? (
          <View
            style={[styles.liveDot, { backgroundColor: accent, borderColor: tokens.bg.canvas }]}
            pointerEvents="none"
          />
        ) : null}
      </View>
      <View style={styles.rowBody}>
        <Text variant="label" numberOfLines={1} style={styles.rowTitle}>
          {list.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {shared ? (
        <View style={styles.memberBadge} accessibilityLabel={`${list.memberCount} members`}>
          <View style={styles.memberBadgeDot} />
          <Text variant="caption" tone="secondary" style={styles.memberBadgeText}>
            {list.memberCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.lg,
    gap: tokens.space.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.sm,
  },
  headerTitleBlock: { gap: 2, flex: 1, minWidth: 0 },
  headerContext: { letterSpacing: 0.4 },
  title: { fontSize: tokens.font.size.xl, letterSpacing: -0.3 },
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
  profileCircle: { borderColor: tokens.border.default },
  profileInitials: {
    fontSize: 12,
    fontWeight: tokens.font.weight.semibold,
    letterSpacing: 0.5,
  },
  activityDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: tokens.text.muted,
  },
  activityDotUnread: { backgroundColor: tokens.accent.default },
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
  },
  rowPressed: { backgroundColor: tokens.bg.surface },
  rowBody: { flex: 1, gap: 2, minWidth: 0 },
  rowTitle: { fontSize: tokens.font.size.md },
  rowSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.border.subtle,
    marginLeft: tokens.space.lg + 44 + tokens.space.md,
  },
  avatarWrap: { position: "relative" },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarEmoji: { fontSize: 22, lineHeight: 26 },
  liveDot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2.5,
  },
  memberBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.bg.surface,
  },
  memberBadgeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: tokens.text.muted,
  },
  memberBadgeText: { fontSize: 11, lineHeight: 14, fontWeight: tokens.font.weight.medium },
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
    boxShadow: "0px 4px 8px rgba(0, 0, 0, 0.3)",
    elevation: 5,
  },
  fabPressed: { backgroundColor: tokens.accent.hover },
  fabGlyph: { fontSize: 26, fontWeight: tokens.font.weight.semibold, lineHeight: 30 },
  profileSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
  },
  profileSheetAvatar: { width: 48, height: 48, borderRadius: 24 },
  profileSheetActions: { gap: tokens.space.sm },
});
