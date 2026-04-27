import { useInfiniteQuery } from "@tanstack/react-query";
import type { ActivityEvent, ActivityFeedResponse } from "@workshop/shared";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { fetchActivity, markActivityRead } from "../src/api/activity";
import { useAuth } from "../src/hooks/useAuth";
import { setActivityLastViewedAt } from "../src/lib/lastViewed";
import { queryKeys } from "../src/lib/queryKeys";
import { Button, Card, EmptyState, IconButton, Text, tokens } from "../src/ui/index";

const PAGE_SIZE = 50;

export default function Activity() {
  const router = useRouter();
  const { token } = useAuth();

  const feedQuery = useInfiniteQuery<ActivityFeedResponse>({
    queryKey: queryKeys.activity.feedInfinite,
    queryFn: ({ pageParam }) =>
      fetchActivity(
        { cursor: typeof pageParam === "string" ? pageParam : undefined, limit: PAGE_SIZE },
        token,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!token,
  });

  // On focus, mark every membership read both server-side (POST /read, idempotent)
  // and client-side (lastViewedAt in storage so the home bell badge clears the
  // moment we navigate back). Failures on the server-side call are intentionally
  // swallowed — a missed read marker is not user-facing.
  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      const stamp = new Date().toISOString();
      setActivityLastViewedAt(stamp).catch(() => {});
      markActivityRead(undefined, token).catch(() => {});
    }, [token]),
  );

  const events: ActivityEvent[] = feedQuery.data?.pages.flatMap((p) => p.events) ?? [];
  const isInitialLoading = feedQuery.isPending;
  const isError = feedQuery.isError;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton accessibilityLabel="Back" onPress={() => router.back()} testID="activity-back">
          <Text style={styles.headerGlyph}>‹</Text>
        </IconButton>
        <Text variant="heading">Activity</Text>
        <View style={styles.headerSpacer} />
      </View>

      {isInitialLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.accent.default} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <EmptyState
            title="Couldn't load activity"
            description={errorMessage(feedQuery.error)}
            action={
              <Button label="Retry" variant="secondary" onPress={() => feedQuery.refetch()} />
            }
          />
        </View>
      ) : events.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            title="No activity yet"
            description="When you and your collaborators add or upvote items, you'll see it here."
          />
        </View>
      ) : (
        <FlatList
          testID="activity-feed"
          data={events}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.body}
          ItemSeparatorComponent={() => <View style={{ height: tokens.space.sm }} />}
          renderItem={({ item }) => <ActivityRow event={item} />}
          refreshing={feedQuery.isRefetching && !feedQuery.isFetchingNextPage}
          onRefresh={() => feedQuery.refetch()}
          onEndReached={() => {
            if (feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) {
              feedQuery.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            feedQuery.isFetchingNextPage ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator color={tokens.accent.default} />
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

interface ActivityRowProps {
  event: ActivityEvent;
}

function ActivityRow({ event }: ActivityRowProps) {
  const actor = event.actorDisplayName ?? "Someone";
  const description = describeEvent(event);
  const when = formatRelative(event.createdAt);
  return (
    <Card style={styles.row} testID={`activity-row-${event.id}`}>
      <View style={styles.rowBody}>
        <Text variant="body">
          <Text variant="body" style={styles.actorName}>
            {actor}
          </Text>{" "}
          {description}
        </Text>
        <Text variant="caption" tone="muted">
          {when}
        </Text>
      </View>
    </Card>
  );
}

function describeEvent(event: ActivityEvent): string {
  const payload = event.payload;
  switch (event.type) {
    case "list_created":
      return `created the list${payloadString(payload, "name", (n) => ` "${n}"`)}`;
    case "member_joined":
      return "joined the list";
    case "member_left":
      return "left the list";
    case "member_removed":
      return "removed a member";
    case "item_added":
      return `added${payloadString(payload, "title", (t) => ` "${t}"`)}`;
    case "item_updated":
      return `updated${payloadString(payload, "title", (t) => ` "${t}"`)}`;
    case "item_deleted":
      return `deleted${payloadString(payload, "title", (t) => ` "${t}"`)}`;
    case "item_upvoted":
      return `upvoted${payloadString(payload, "title", (t) => ` "${t}"`)}`;
    case "item_unupvoted":
      return `removed an upvote${payloadString(payload, "title", (t) => ` from "${t}"`)}`;
    case "item_completed":
      return `completed${payloadString(payload, "title", (t) => ` "${t}"`)}`;
    case "item_uncompleted":
      return `reopened${payloadString(payload, "title", (t) => ` "${t}"`)}`;
    case "invite_created":
      return "created a share link";
    case "invite_revoked":
      return "revoked a share link";
    default: {
      const _exhaustive: never = event.type as never;
      void _exhaustive;
      return "did something";
    }
  }
}

function payloadString(
  payload: Record<string, unknown>,
  key: string,
  fmt: (s: string) => string,
): string {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? fmt(v) : "";
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.max(1, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
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
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.md,
  },
  headerSpacer: { width: 40 },
  headerGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.xl },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.xxl * 2,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: { padding: tokens.space.lg },
  rowBody: { gap: tokens.space.xs },
  actorName: { fontWeight: tokens.font.weight.semibold },
  footerLoader: { paddingVertical: tokens.space.lg, alignItems: "center" },
});
