import { useQuery } from "@tanstack/react-query";
import type { ListSummary, ListType } from "@workshop/shared";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from "react-native";
import { fetchActivity } from "../src/api/activity";
import { fetchLists } from "../src/api/lists";
import { useAuth } from "../src/hooks/useAuth";
import { getActivityLastViewedAt } from "../src/lib/lastViewed";
import { queryKeys } from "../src/lib/queryKeys";
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  type ListColorKey,
  Text,
  tokens,
} from "../src/ui/index";

const TYPE_LABEL: Record<ListType, string> = {
  movie: "Movies",
  tv: "TV",
  book: "Books",
  date_idea: "Date ideas",
  trip: "Trips",
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

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text variant="heading">Workshop.dev</Text>
          <Text tone="secondary" testID="home-greeting">
            {user?.displayName ? `Hi, ${user.displayName}` : "Signed in"}
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
          <IconButton
            accessibilityLabel="Open Spotify"
            onPress={() => router.push("/spotify")}
            testID="open-spotify"
          >
            <Text style={styles.spotifyGlyph}>🎧</Text>
          </IconButton>
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
              title="No lists yet"
              description="Create your first list to start collecting movies, books, trips, or date ideas."
              action={<Button label="Create a list" onPress={onCreateList} />}
            />
          </View>
        ) : (
          <FlatList
            data={listsQuery.data.lists}
            keyExtractor={(l) => l.id}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={{ height: tokens.space.md }} />}
            renderItem={({ item }) => (
              <ListCard list={item} onPress={() => router.push(`/list/${item.id}`)} />
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

function ListCard({ list, onPress }: { list: ListSummary; onPress: () => void }) {
  const accent = tokens.list[list.color as ListColorKey] ?? tokens.accent.default;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open list ${list.name}`}
      onPress={onPress}
      testID={`list-card-${list.id}`}
      style={({ pressed }) => [pressed && styles.cardPressed]}
    >
      <Card style={styles.card}>
        <View style={[styles.cardStripe, { backgroundColor: accent }]} />
        <View style={styles.cardBody}>
          <View style={styles.cardHead}>
            <Text style={styles.cardEmoji}>{list.emoji}</Text>
            <View style={styles.cardTitleBlock}>
              <Text variant="heading" numberOfLines={1}>
                {list.name}
              </Text>
              <Text variant="caption" tone="muted">
                {TYPE_LABEL[list.type]} · {list.role === "owner" ? "Owner" : "Member"}
              </Text>
            </View>
          </View>
          {list.description ? (
            <Text tone="secondary" numberOfLines={2}>
              {list.description}
            </Text>
          ) : null}
          <View style={styles.cardMeta}>
            <Text variant="caption" tone="muted">
              {pluralize(list.itemCount, "item")}
            </Text>
            <Text variant="caption" tone="muted">
              ·
            </Text>
            <Text variant="caption" tone="muted">
              {pluralize(list.memberCount, "member")}
            </Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function pluralize(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.xxl,
    paddingBottom: tokens.space.xl,
    gap: tokens.space.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.md,
  },
  signOutGlyph: { fontSize: tokens.font.size.lg },
  spotifyGlyph: { fontSize: tokens.font.size.lg },
  bellGlyph: { fontSize: tokens.font.size.lg },
  bellBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: tokens.accent.default,
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadgeText: { fontSize: 10, fontWeight: tokens.font.weight.bold },
  headerActions: { flexDirection: "row", gap: tokens.space.sm, alignItems: "center" },
  body: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: tokens.space.xxl * 2 },
  card: { padding: 0, overflow: "hidden", flexDirection: "row" },
  cardPressed: { opacity: 0.85 },
  cardStripe: { width: 6 },
  cardBody: { flex: 1, padding: tokens.space.lg, gap: tokens.space.sm },
  cardHead: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  cardEmoji: { fontSize: tokens.font.size.xl },
  cardTitleBlock: { flex: 1, gap: 2 },
  cardMeta: { flexDirection: "row", gap: tokens.space.sm, alignItems: "center" },
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
