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

function partOfDay(date = new Date()): "morning" | "afternoon" | "evening" | "night" {
  const h = date.getHours();
  if (h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 22) return "evening";
  return "night";
}

function buildGreeting(name: string | null | undefined): string {
  const trimmed = name?.trim();
  const handle = trimmed && trimmed.length > 0 ? trimmed : null;
  switch (partOfDay()) {
    case "morning":
      return handle ? `Morning, ${handle}` : "Good morning";
    case "afternoon":
      return handle ? `Afternoon, ${handle}` : "Good afternoon";
    case "evening":
      return handle ? `Evening, ${handle}` : "Good evening";
    case "night":
      return handle ? `Hi, ${handle}` : "Welcome back";
  }
}

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

  const greeting = buildGreeting(user?.displayName);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerTitleBlock}>
          <Text variant="title" testID="home-greeting" style={styles.title}>
            {greeting}
          </Text>
          <Text variant="caption" tone="muted" style={styles.eyebrow}>
            Your lists
          </Text>
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
            <Text tone="muted" style={styles.signOutGlyph}>
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
  const itemsLabel =
    list.itemCount === 0 ? "Empty" : `${list.itemCount} ${list.itemCount === 1 ? "item" : "items"}`;
  const description = list.description?.trim();
  const subtitle = description ? description : `${TYPE_LABEL[list.type]} · ${itemsLabel}`;
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
      </View>
      <View style={styles.rowBody}>
        <Text variant="label" numberOfLines={1} style={styles.rowTitle}>
          {list.name}
        </Text>
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
    paddingBottom: tokens.space.xs,
  },
  headerTitleBlock: { gap: tokens.space.xs, flex: 1, minWidth: 0 },
  title: { fontSize: tokens.font.size.xxl, letterSpacing: -0.5 },
  eyebrow: { letterSpacing: 0.6, textTransform: "uppercase" },
  rowTitle: { fontSize: tokens.font.size.md },
  rowChevron: { fontSize: tokens.font.size.xl, marginLeft: tokens.space.xs },
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
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: tokens.accent.default,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  fabPressed: { backgroundColor: tokens.accent.hover },
  fabGlyph: { fontSize: 26, fontWeight: tokens.font.weight.semibold, lineHeight: 30 },
});
