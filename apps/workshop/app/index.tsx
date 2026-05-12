import { useQuery } from "@tanstack/react-query";
import type { ListSummary, ListType } from "@workshop/shared";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from "react-native";
import { fetchActivity } from "../src/api/activity";
import { fetchLists } from "../src/api/lists";
import { useAuth } from "../src/hooks/useAuth";
import { errorMessage } from "../src/lib/api";
import { getActivityLastViewedAt } from "../src/lib/lastViewed";
import { queryKeys } from "../src/lib/queryKeys";
import { Button, EmptyState, IconButton, type ListColorKey, Text, tokens } from "../src/ui/index";

const TYPE_LABEL: Record<ListType, string> = {
  movie: "Movies",
  tv: "TV",
  book: "Books",
  date_idea: "Date ideas",
  trip: "Trips",
  album_shelf: "Album shelf",
};

export default function Home() {
  const { user, token, signOut } = useAuth();
  const router = useRouter();
  const listsQuery = useQuery({
    queryKey: queryKeys.lists.all,
    queryFn: () => fetchLists(token),
    enabled: !!token,
  });

  // Bell badge: re-derive unread count from the first page of the activity
  // feed. Server-side `lastReadAt` per list isn't surfaced on `GET /v1/lists`
  // yet, so we compare each event's `createdAt` against a client-side
  // `lastViewedAt` stamped by the activity screen on focus. The activity
  // screen also fires `POST /v1/activity/read` for cross-device parity.
  const activityFeedQuery = useQuery({
    queryKey: queryKeys.activity.feed,
    queryFn: () => fetchActivity({ limit: 50 }, token),
    enabled: !!token,
    staleTime: 30_000,
  });
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
  const events = activityFeedQuery.data?.events ?? [];
  const unreadCount = events.reduce((acc, e) => {
    if (e.actorId === user?.id) return acc;
    if (lastViewedAt && new Date(e.createdAt).getTime() <= new Date(lastViewedAt).getTime()) {
      return acc;
    }
    return acc + 1;
  }, 0);
  const cappedUnread = unreadCount > 9 ? "9+" : String(unreadCount);

  const onCreateList = () => {
    router.push("/create-list/type");
  };

  const lists = listsQuery.data?.lists ?? [];
  const totalItems = lists.reduce((acc, l) => acc + l.itemCount, 0);
  const greeting = user?.displayName ? `Hi, ${user.displayName.split(" ")[0]}` : "Welcome back";
  const summary =
    lists.length === 0
      ? null
      : `${lists.length} ${lists.length === 1 ? "list" : "lists"}, ${totalItems} ${totalItems === 1 ? "item" : "items"}`;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerTitleBlock}>
          <Text variant="caption" tone="muted" testID="home-greeting" style={styles.greeting}>
            {greeting}
          </Text>
          <Text variant="title">Lists</Text>
          {summary ? (
            <Text variant="caption" tone="muted" style={styles.summary}>
              {summary}
            </Text>
          ) : null}
        </View>
        <View style={styles.headerActions}>
          <View>
            <IconButton
              accessibilityLabel={unreadCount > 0 ? `Activity, ${unreadCount} unread` : "Activity"}
              onPress={() => router.push("/activity")}
              testID="open-activity"
            >
              <Text style={styles.bellGlyph}>🔔</Text>
            </IconButton>
            {unreadCount > 0 ? (
              <View style={styles.bellBadge} testID="activity-unread-badge" pointerEvents="none">
                <Text style={styles.bellBadgeText} tone="onAccent">
                  {cappedUnread}
                </Text>
              </View>
            ) : null}
          </View>
          <IconButton accessibilityLabel="Sign out" onPress={signOut} testID="sign-out">
            <Text tone="secondary" style={styles.signOutGlyph}>
              ⎋
            </Text>
          </IconButton>
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
        ) : listsQuery.data.lists.length === 0 ? (
          <View style={styles.center}>
            <EmptyState
              title="Nothing here yet"
              description="Start a list for movies, books, trips, or whatever you're collecting."
              action={<Button label="Create your first list" onPress={onCreateList} />}
            />
          </View>
        ) : (
          <FlatList
            data={listsQuery.data.lists}
            keyExtractor={(l) => l.id}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.rowSeparator} />}
            renderItem={({ item }) => (
              <ListRow list={item} onPress={() => router.push(`/list/${item.id}`)} />
            )}
            refreshing={listsQuery.isRefetching}
            onRefresh={() => listsQuery.refetch()}
          />
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
    </View>
  );
}

function ListRow({ list, onPress }: { list: ListSummary; onPress: () => void }) {
  const accent = tokens.list[list.color as ListColorKey] ?? tokens.accent.default;
  const countText = `${list.itemCount} ${list.itemCount === 1 ? "item" : "items"}`;
  const subtitle = list.description?.trim()
    ? list.description
    : `${TYPE_LABEL[list.type]} · ${countText}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open list ${list.name}`}
      onPress={onPress}
      testID={`list-card-${list.id}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={[styles.avatar, { backgroundColor: `${accent}1F` }]}>
        <Text style={styles.avatarEmoji}>{list.emoji}</Text>
        <View style={[styles.avatarDot, { backgroundColor: accent }]} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text variant="label" numberOfLines={1} style={styles.rowTitle}>
            {list.name}
          </Text>
          <Text variant="caption" tone="muted" style={styles.rowCount}>
            {list.itemCount}
          </Text>
        </View>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Text tone="muted" style={styles.rowChevron}>
        ›
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
    gap: tokens.space.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.xs,
  },
  headerTitleBlock: { gap: 2, flex: 1, minWidth: 0 },
  greeting: { letterSpacing: 0.3, textTransform: "uppercase" },
  summary: { marginTop: 2 },
  rowTitleLine: { flexDirection: "row", alignItems: "baseline", gap: tokens.space.sm },
  rowTitle: { flexShrink: 1, fontSize: tokens.font.size.md },
  rowCount: { fontVariant: ["tabular-nums"] },
  rowChevron: { fontSize: tokens.font.size.xl, marginLeft: tokens.space.xs },
  avatarDot: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: tokens.bg.canvas,
  },
  signOutGlyph: { fontSize: tokens.font.size.md },
  bellGlyph: { fontSize: tokens.font.size.md },
  bellBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: tokens.accent.default,
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadgeText: { fontSize: 9, fontWeight: tokens.font.weight.bold },
  headerActions: { flexDirection: "row", gap: tokens.space.xs, alignItems: "center" },
  body: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: tokens.space.xxl * 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.sm,
  },
  rowPressed: { backgroundColor: tokens.bg.surface },
  rowBody: { flex: 1, gap: 2, minWidth: 0 },
  rowSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.border.subtle,
    marginLeft: tokens.space.lg + 44 + tokens.space.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarEmoji: { fontSize: 22, lineHeight: 26 },
  fab: {
    position: "absolute",
    right: tokens.space.lg,
    bottom: tokens.space.lg,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: tokens.accent.default,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  fabPressed: { backgroundColor: tokens.accent.hover },
  fabGlyph: { fontSize: 24, fontWeight: tokens.font.weight.semibold, lineHeight: 28 },
});
