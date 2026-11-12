import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type { ActivityEvent, ActivityFeedResponse } from "@workshop/shared";
import {
  alpha,
  Button,
  Chip,
  EmptyState,
  Icon,
  type IconName,
  type ListColorKey,
  ListRow,
  PullToRefresh,
  Screen,
  ScreenHeader,
  Skeleton,
  Text,
  tokens,
} from "@workshop/ui";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, View } from "react-native";
import { fetchActivity, markActivityRead } from "../src/api/activity";
import { fetchLists } from "../src/api/lists";
import { useAuth } from "../src/hooks/useAuth";
import { goBack } from "../src/lib/goBack";
import { setActivityLastViewedAt } from "../src/lib/lastViewed";

const PAGE_SIZE = 50;

type ListLookup = Map<string, { name: string; emoji: string; color: string }>;

type FeedItem =
  | { kind: "heading"; id: string; label: string }
  | { kind: "event"; id: string; event: ActivityEvent; showList: boolean };

export default function Activity() {
  const { token } = useAuth();
  const router = useRouter();
  const backFallback = "/";
  const livePoll = useLivePollingInterval();

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
    refetchInterval: livePoll,
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
  // The home bell is the sum of the server's per-list `unreadCount`, so the
  // cached list summaries are refetched once the read lands; otherwise the
  // badge stayed lit after visiting Activity until the next poll (0.17).
  const queryClient = useQueryClient();
  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      const stamp = new Date().toISOString();
      setActivityLastViewedAt(stamp).catch(() => {});
      markActivityRead(undefined, token)
        .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.lists.all }))
        .catch(() => {});
    }, [token, queryClient]),
  );

  const events: ActivityEvent[] = feedQuery.data?.pages.flatMap((p) => p.events) ?? [];

  // Filter strip: either an actor or a list, never both at once. A single-
  // dimension filter keeps the chip vocabulary simple ("Alex" or "Movie
  // Night", never "Alex's Movie Night activity"); the implementation drops
  // the corresponding tiny edge case ("show me Alex's activity but only on
  // Movie Night") in favour of a vocabulary the user can keep in their head
  // without a "filters cleared" affordance.
  const [filter, setFilter] = useState<
    { kind: "actor"; id: string } | { kind: "list"; id: string } | null
  >(null);

  // Unique actors / lists in the visible feed, used to render filter chips.
  // Order = first appearance in the feed (newest-first), so the people /
  // lists you're most likely to want to filter by sit at the front of the
  // scroll. Cap at 6 each so the chip row stays a single horizontal scroll
  // even with many collaborators.
  const FILTER_CHIP_CAP = 6;
  const filterChips = useMemo(() => {
    const actors: Array<{ id: string; name: string }> = [];
    const lists: Array<{ id: string; name: string; emoji: string; color: string }> = [];
    const seenActors = new Set<string>();
    const seenLists = new Set<string>();
    for (const e of events) {
      if (!seenActors.has(e.actorId)) {
        seenActors.add(e.actorId);
        const name = e.actorDisplayName?.trim().split(/\s+/)[0] ?? "someone";
        actors.push({ id: e.actorId, name });
      }
      if (!seenLists.has(e.listId)) {
        seenLists.add(e.listId);
        const meta = listLookup.get(e.listId);
        if (meta) lists.push({ id: e.listId, ...meta });
      }
      if (actors.length >= FILTER_CHIP_CAP && lists.length >= FILTER_CHIP_CAP) break;
    }
    return {
      actors: actors.slice(0, FILTER_CHIP_CAP),
      lists: lists.slice(0, FILTER_CHIP_CAP),
    };
  }, [events, listLookup]);

  const filteredEvents = useMemo(() => {
    if (!filter) return events;
    if (filter.kind === "actor") return events.filter((e) => e.actorId === filter.id);
    return events.filter((e) => e.listId === filter.id);
  }, [events, filter]);

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
    // When the filter pins us to a single list, every row would render the
    // same chip — collapse it to never-show in that mode.
    const suppressListChip = filter?.kind === "list";
    for (const e of filteredEvents) {
      const bucket = dayBucketLabel(e.createdAt);
      const newBucket = bucket !== lastBucket;
      if (newBucket) {
        out.push({ kind: "heading", id: `h-${bucket}-${e.id}`, label: bucket });
        lastBucket = bucket;
        lastListId = null;
      }
      const showList = !suppressListChip && (newBucket || e.listId !== lastListId);
      out.push({ kind: "event", id: e.id, event: e, showList });
      lastListId = e.listId;
    }
    return out;
  }, [filteredEvents, filter]);

  const isInitialLoading = feedQuery.isPending;
  // Only an empty cache gets the error state; a failed background refetch
  // keeps the feed already on screen (0.9).
  const isError = feedQuery.isError && !feedQuery.data;

  return (
    <Screen style={styles.root}>
      <ScreenHeader
        leading="back"
        onLeadingPress={() => goBack(backFallback)}
        leadingTestID="activity-back"
        title="Activity"
      />

      {events.length > 0 && (filterChips.actors.length > 1 || filterChips.lists.length > 0) ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterStrip}
          style={styles.filterScroll}
          testID="activity-filter-strip"
        >
          <FilterChip
            label="All"
            active={filter === null}
            onPress={() => setFilter(null)}
            testID="activity-filter-all"
          />
          {filterChips.actors.map((a) => (
            <FilterChip
              key={`actor-${a.id}`}
              label={a.name}
              active={filter?.kind === "actor" && filter.id === a.id}
              onPress={() =>
                setFilter(
                  filter?.kind === "actor" && filter.id === a.id
                    ? null
                    : { kind: "actor", id: a.id },
                )
              }
              testID={`activity-filter-actor-${a.id}`}
            />
          ))}
          {filterChips.lists.map((l) => (
            <FilterChip
              key={`list-${l.id}`}
              label={`${l.emoji} ${l.name}`}
              active={filter?.kind === "list" && filter.id === l.id}
              onPress={() =>
                setFilter(
                  filter?.kind === "list" && filter.id === l.id ? null : { kind: "list", id: l.id },
                )
              }
              testID={`activity-filter-list-${l.id}`}
            />
          ))}
        </ScrollView>
      ) : null}

      {isInitialLoading ? (
        <View style={styles.skeleton}>
          <Skeleton.Rows count={8} testID="activity-skeleton" />
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
            description="When you and your collaborators add or rank items, the action shows up here."
          />
        </View>
      ) : filteredEvents.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            title="Nothing matches this filter"
            description="Pick a different chip, or clear the filter to see everything."
            action={
              <Button label="Clear filter" variant="secondary" onPress={() => setFilter(null)} />
            }
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
              ) : undefined
            }
          />
        </PullToRefresh>
      )}
    </Screen>
  );
}

function FilterChip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Chip
      label={label}
      selected={active}
      onPress={onPress}
      accessibilityLabel={`Filter: ${label}`}
      testID={testID}
    />
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
    <ListRow
      accessibilityLabel={
        list ? `${first} ${description} in ${list.name}` : `${first} ${description}`
      }
      onPress={onOpenList}
      testID={`activity-row-${event.id}`}
      leading={
        <View style={[styles.avatar, { backgroundColor: alpha(accent, 0.12) }]}>
          {verb.icon ? (
            <Icon name={verb.icon} size={16} color={accent} />
          ) : (
            <Text style={[styles.avatarGlyph, { color: accent }]}>{verb.text}</Text>
          )}
        </View>
      }
      title={
        <Text variant="body" numberOfLines={2} style={styles.line}>
          <Text style={styles.actorName}>{first}</Text>
          <Text> {description}</Text>
        </Text>
      }
      subtitle={
        list && showList ? (
          <View style={styles.listChipRow}>
            <Text style={styles.listChipEmoji}>{list.emoji}</Text>
            <Text variant="caption" tone="muted" numberOfLines={1} style={styles.listChipName}>
              {list.name}
            </Text>
          </View>
        ) : undefined
      }
      trailing={
        <Text variant="caption" tone="muted" style={styles.when}>
          {when}
        </Text>
      }
    />
  );
}

// Single-glyph signal for each event family. Keeps the avatar position from
// being just a colored disc — the glyph adds a verb-specific visual that
// lets you scan a feed by action shape, not just by actor name. Glyphs the
// `Icon` set covers are drawn with it; the rest stay typographic marks.
type VerbGlyph = { icon: IconName; text?: undefined } | { icon?: undefined; text: string };

function verbGlyphFor(type: ActivityEvent["type"]): VerbGlyph {
  const mark = verbMarkFor(type);
  const icon = VERB_ICON[mark];
  return icon ? { icon } : { text: mark };
}

const VERB_ICON: Record<string, IconName> = { "+": "plus", "✓": "check", "↻": "refresh" };

function verbMarkFor(type: ActivityEvent["type"]): string {
  switch (type) {
    case "item_added":
    case "item_restored":
    case "list_created":
    case "list_duplicated":
    case "invite_created":
    case "source_added":
    case "module_enabled":
      return "+";
    case "item_archived":
    case "list_archived":
    case "invite_revoked":
    case "member_removed":
    case "source_removed":
    case "module_disabled":
      return "−";
    case "item_updated":
    case "item_tagged":
    case "source_updated":
      return "·";
    case "item_completed":
      return "✓";
    case "item_uncompleted":
      return "↺";
    case "item_promoted":
      return "★";
    case "item_demoted":
      return "☆";
    case "member_joined":
      return "→";
    case "member_left":
      return "←";
    case "source_synced":
      return "↻";
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
    case "item_archived":
      return `archived${payloadString(payload, "title", (t) => ` "${t}"`)}`;
    case "item_restored":
      return `restored${payloadString(payload, "title", (t) => ` "${t}"`)}`;
    case "item_tagged": {
      const tags = Array.isArray(payload.tags)
        ? payload.tags.filter((t): t is string => typeof t === "string")
        : [];
      const title = payloadString(payload, "title", (t) => ` "${t}"`);
      if (tags.length === 0) return `cleared tags on${title || " an item"}`;
      return `tagged${title || " an item"} ${tags.map((t) => `#${t}`).join(" ")}`;
    }
    case "list_archived":
      return `archived this list${payloadString(payload, "name", (n) => ` (${n})`)}`;
    case "list_duplicated":
      return `duplicated this list${payloadString(payload, "name", (n) => ` (${n})`)}`;
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
    case "module_enabled":
      return `turned on ${payloadString(payload, "module", (m) => m) || "a module"}`;
    case "module_disabled":
      return `turned off ${payloadString(payload, "module", (m) => m) || "a module"}`;
    case "source_added":
      return "attached a source";
    case "source_removed":
      return "detached a source";
    case "source_updated":
      return "updated a source";
    case "source_synced": {
      const added = typeof payload.addedCount === "number" ? payload.addedCount : 0;
      if (added === 0) return "refreshed the source · no new items";
      return `refreshed the source · ${added} new item${added === 1 ? "" : "s"}`;
    }
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
  },
  filterScroll: { flexGrow: 0 },
  filterStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.md,
  },
  body: {
    paddingBottom: tokens.space.xxl * 2,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tokens.space.xl,
  },
  skeleton: { paddingTop: tokens.space.sm },
  dayHeading: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.sm,
  },
  dayHeadingText: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.semibold,
    letterSpacing: -0.2,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarGlyph: {
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.semibold,
    lineHeight: tokens.font.size.md + 2,
  },
  line: { color: tokens.text.primary, fontSize: tokens.font.size.sm, lineHeight: 20 },
  actorName: { fontWeight: tokens.font.weight.semibold, color: tokens.text.primary },
  listChipRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  listChipEmoji: { fontSize: tokens.font.size.xs, lineHeight: 16 },
  listChipName: { letterSpacing: 0.1 },
  when: { fontVariant: ["tabular-nums"] },
  footerLoader: { paddingVertical: tokens.space.lg, alignItems: "center" },
});
