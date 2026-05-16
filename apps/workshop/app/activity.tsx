import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ActivityEvent, ActivityFeedResponse } from "@workshop/shared";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from "react-native";
import { fetchActivity, markActivityRead } from "../src/api/activity";
import { fetchLists } from "../src/api/lists";
import { PullToRefresh } from "../src/components/PullToRefresh";
import { useAuth } from "../src/hooks/useAuth";
import { errorMessage } from "../src/lib/api";
import { goBack } from "../src/lib/goBack";
import { setActivityLastViewedAt } from "../src/lib/lastViewed";
import { queryKeys } from "../src/lib/queryKeys";
import { Button, EmptyState, type ListColorKey, Screen, Text, tokens } from "../src/ui/index";

const PAGE_SIZE = 50;

type ListLookup = Map<string, { name: string; emoji: string; color: string }>;

type FeedItem =
  | { kind: "heading"; id: string; label: string }
  | { kind: "event"; id: string; event: ActivityEvent; showList: boolean };

export default function Activity() {
  const { token } = useAuth();
  const router = useRouter();

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

  // Re-use the cached list summaries so each event row can show which list it
  // happened on (with the list's emoji + accent for instant recognition).
  // Falls back to the listId if a list isn't cached yet (rare; first load).
  const listsQuery = useQuery({
    queryKey: queryKeys.lists.all,
    queryFn: () => fetchLists(token),
    enabled: !!token,
    staleTime: 30_000,
  });
  const listLookup: ListLookup = useMemo(() => {
    const map: ListLookup = new Map();
    for (const l of listsQuery.data?.lists ?? []) {
      map.set(l.id, { name: l.name, emoji: l.emoji, color: l.color });
    }
    return map;
  }, [listsQuery.data]);

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

  // Interleave day-bucket headings into the flat event list so a single
  // FlatList renders both. Cheaper than two lists and keeps scroll behavior
  // sane. The bucket label is computed once per event boundary.
  //
  // `showList` collapses the list chip on consecutive same-list rows: when
  // someone bulk-adds 6 items to the same list, the chip becomes noise after
  // the first. The chip resets on a day-bucket boundary or a list change.
  const items: FeedItem[] = useMemo(() => {
    const out: FeedItem[] = [];
    let lastBucket: string | null = null;
    let lastListId: string | null = null;
    for (const e of events) {
      const bucket = dayBucketLabel(e.createdAt);
      const newBucket = bucket !== lastBucket;
      if (newBucket) {
        out.push({ kind: "heading", id: `h-${bucket}-${e.id}`, label: bucket });
        lastBucket = bucket;
        lastListId = null;
      }
      const showList = newBucket || e.listId !== lastListId;
      out.push({ kind: "event", id: e.id, event: e, showList });
      lastListId = e.listId;
    }
    return out;
  }, [events]);

  const isInitialLoading = feedQuery.isPending;
  const isError = feedQuery.isError;

  return (
    <Screen style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => goBack("/")}
          testID="activity-back"
          hitSlop={10}
          style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
        >
          <Text style={styles.navGlyph}>‹</Text>
        </Pressable>
        <Text variant="title" style={styles.title}>
          Activity
        </Text>
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
            title="Quiet for now"
            description="When you and your collaborators add or rank items, the action shows up here."
          />
        </View>
      ) : (
        <PullToRefresh
          refreshing={feedQuery.isRefetching && !feedQuery.isFetchingNextPage}
          onRefresh={() => feedQuery.refetch()}
        >
          <FlatList
            testID="activity-feed"
            data={items}
            keyExtractor={(it) => it.id}
            contentContainerStyle={styles.body}
            renderItem={({ item }) =>
              item.kind === "heading" ? (
                <DayHeading label={item.label} />
              ) : (
                <ActivityRow
                  event={item.event}
                  list={listLookup.get(item.event.listId) ?? null}
                  showList={item.showList}
                  onOpenList={() => router.push(`/list/${item.event.listId}`)}
                />
              )
            }
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
        </PullToRefresh>
      )}
    </Screen>
  );
}

function DayHeading({ label }: { label: string }) {
  return (
    <View style={styles.dayHeading} testID={`activity-day-${label}`}>
      <Text style={styles.dayHeadingText}>{label}</Text>
    </View>
  );
}

interface ActivityRowProps {
  event: ActivityEvent;
  list: { name: string; emoji: string; color: string } | null;
  /**
   * When false, the trailing list chip is suppressed because the previous
   * event in this day-bucket was on the same list — keeps a burst of adds
   * from rendering the same chip 5+ times in a row.
   */
  showList: boolean;
  onOpenList: () => void;
}

function ActivityRow({ event, list, showList, onOpenList }: ActivityRowProps) {
  const actor = event.actorDisplayName?.trim() || "Someone";
  const first = actor.split(/\s+/)[0] ?? actor;
  const description = describeEvent(event);
  const when = compactRelative(event.createdAt);
  const verb = verbGlyphFor(event.type);
  const accent =
    list && (list.color as ListColorKey) in tokens.list
      ? tokens.list[list.color as ListColorKey]
      : tokens.accent.default;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        list ? `${first} ${description} in ${list.name}` : `${first} ${description}`
      }
      onPress={onOpenList}
      testID={`activity-row-${event.id}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={[styles.avatar, { backgroundColor: `${accent}1F` }]}>
        <Text style={[styles.avatarGlyph, { color: accent }]}>{verb}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text variant="body" numberOfLines={2} style={styles.line}>
          <Text style={styles.actorName}>{first}</Text>
          <Text> {description}</Text>
        </Text>
        {list && showList ? (
          <View style={styles.listChipRow}>
            <Text style={styles.listChipEmoji}>{list.emoji}</Text>
            <Text variant="caption" tone="muted" numberOfLines={1} style={styles.listChipName}>
              {list.name}
            </Text>
          </View>
        ) : null}
      </View>
      <Text variant="caption" tone="muted" style={styles.when}>
        {when}
      </Text>
    </Pressable>
  );
}

// Single-glyph signal for each event family. Keeps the avatar position from
// being just a colored disc — the glyph adds a verb-specific visual that
// lets you scan a feed by action shape, not just by actor name.
function verbGlyphFor(type: ActivityEvent["type"]): string {
  switch (type) {
    case "item_added":
    case "list_created":
    case "invite_created":
      return "+";
    case "item_deleted":
    case "invite_revoked":
    case "member_removed":
      return "−";
    case "item_updated":
      return "·";
    case "item_upvoted":
      return "↑";
    case "item_unupvoted":
      return "↓";
    case "item_completed":
      return "✓";
    case "item_uncompleted":
      return "↺";
    case "item_promoted":
    case "album_promoted":
      return "★";
    case "item_demoted":
    case "album_demoted":
      return "☆";
    case "member_joined":
      return "→";
    case "member_left":
      return "←";
    case "album_shelf_refreshed":
      return "↻";
    case "album_shelf_source_changed":
      return "⇄";
    default:
      return "·";
  }
}

function describeEvent(event: ActivityEvent): string {
  const payload = event.payload;
  switch (event.type) {
    case "list_created":
      return `created this list${payloadString(payload, "name", (n) => ` (${n})`)}`;
    case "member_joined":
      return "joined";
    case "member_left":
      return "left";
    case "member_removed":
      return "removed a member";
    case "item_added":
      return `added${payloadString(payload, "title", (t) => ` "${t}"`)}`;
    case "item_updated":
      return `edited${payloadString(payload, "title", (t) => ` "${t}"`)}`;
    case "item_deleted":
      return `removed${payloadString(payload, "title", (t) => ` "${t}"`)}`;
    case "item_upvoted":
      return `upvoted${payloadString(payload, "title", (t) => ` "${t}"`)}`;
    case "item_unupvoted":
      return `removed an upvote${payloadString(payload, "title", (t) => ` from "${t}"`)}`;
    case "item_completed":
      return `checked off${payloadString(payload, "title", (t) => ` "${t}"`)}`;
    case "item_uncompleted":
      return `uncrossed${payloadString(payload, "title", (t) => ` "${t}"`)}`;
    case "item_promoted":
      return `pinned${payloadString(payload, "title", (t) => ` "${t}"`)} to ranked`;
    case "item_demoted":
      return `unpinned${payloadString(payload, "title", (t) => ` "${t}"`)} from ranked`;
    case "invite_created":
      return "shared a link";
    case "invite_revoked":
      return "revoked a share link";
    case "album_shelf_refreshed": {
      const added = typeof payload.added === "number" ? payload.added : 0;
      if (added === 0) return "refreshed the shelf · no new albums";
      return `refreshed · ${added} new album${added === 1 ? "" : "s"}`;
    }
    case "album_shelf_source_changed":
      return "changed the source playlist";
    case "album_promoted":
      return `pinned${payloadString(payload, "albumTitle", (t) => ` "${t}"`)}`;
    case "album_demoted":
      return `unpinned${payloadString(payload, "albumTitle", (t) => ` "${t}"`)}`;
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

// Compact: matches the home-row convention ("8m", "2h", "3d"). Verbose "ago"
// adds nothing in a feed already sorted newest-first and grouped by day.
function compactRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.max(1, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

// Day bucket: Today / Yesterday / weekday name / ISO date. Tracked across the
// feed so we emit one heading per day-bucket boundary.
function dayBucketLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const todayStart = startOfDay(now);
  const dayStart = startOfDay(d);
  const diffDays = Math.round((todayStart - dayStart) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
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
    gap: tokens.space.xs,
    paddingHorizontal: tokens.space.sm,
    paddingRight: tokens.space.lg,
    paddingBottom: tokens.space.md,
  },
  navButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  navButtonPressed: { backgroundColor: tokens.bg.elevated },
  navGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.xl },
  title: { fontSize: tokens.font.size.xl, letterSpacing: -0.3 },
  body: {
    paddingBottom: tokens.space.xxl * 2,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tokens.space.xl,
  },
  dayHeading: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.sm,
  },
  dayHeadingText: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.semibold,
    letterSpacing: -0.2,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.xl,
    paddingVertical: tokens.space.md,
  },
  rowPressed: { backgroundColor: tokens.bg.surface },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarGlyph: {
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.semibold,
    lineHeight: tokens.font.size.md + 2,
  },
  rowBody: { flex: 1, gap: 2, minWidth: 0 },
  line: { color: tokens.text.primary, fontSize: tokens.font.size.sm, lineHeight: 20 },
  actorName: { fontWeight: tokens.font.weight.semibold, color: tokens.text.primary },
  listChipRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  listChipEmoji: { fontSize: 12, lineHeight: 16 },
  listChipName: { letterSpacing: 0.1 },
  when: {
    fontVariant: ["tabular-nums"],
    paddingTop: 1,
  },
  footerLoader: { paddingVertical: tokens.space.lg, alignItems: "center" },
});
