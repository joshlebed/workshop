import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type { ActivityEvent, ActivityFeedResponse, ItemKind } from "@workshop/shared";
import {
  alpha,
  Button,
  Chip,
  EmptyState,
  Icon,
  type IconName,
  type ListColorKey,
  ListRow,
  layout,
  PullToRefresh,
  Reveal,
  Screen,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  screenColumnStyle,
  Text,
  tokens,
  useRevealAfterLoading,
} from "@workshop/ui";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, View } from "react-native";
import { fetchActivity, markActivityRead } from "../src/api/activity";
import { fetchItem } from "../src/api/items";
import { fetchLists } from "../src/api/lists";
import { useAuth } from "../src/hooks/useAuth";
import {
  type ActivityMark,
  activityMark,
  describeActivity,
  firstName,
  newEventIds,
  shortAge,
  splitAtReadMarker,
} from "../src/lib/activityCopy";
import { loadErrorMessage } from "../src/lib/errorCopy";
import { goBack } from "../src/lib/goBack";

const PAGE_SIZE = 50;

type ListMeta = { name: string; emoji: string; color: string; itemKind: ItemKind | null };
type ListLookup = Map<string, ListMeta>;

type FeedItem =
  | { kind: "new"; id: string }
  | { kind: "heading"; id: string; label: string; afterNew: boolean }
  | { kind: "event"; id: string; event: ActivityEvent; showList: boolean; fresh: boolean };

type Filter = { kind: "actor"; id: string } | { kind: "list"; id: string } | null;

export default function Activity() {
  const { token, user } = useAuth();
  const selfId = user?.id ?? null;
  const router = useRouter();
  const queryClient = useQueryClient();
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

  const listsQuery = useQuery({
    queryKey: queryKeys.lists.all,
    queryFn: () => fetchLists(token),
    enabled: !!token,
    staleTime: 30_000,
  });
  const listLookup: ListLookup = useMemo(() => {
    const map: ListLookup = new Map();
    for (const l of listsQuery.data?.lists ?? []) {
      map.set(l.id, { name: l.name, emoji: l.emoji, color: l.color, itemKind: l.itemKind });
    }
    return map;
  }, [listsQuery.data]);

  const events: ActivityEvent[] = useMemo(
    () => feedQuery.data?.pages.flatMap((p) => p.events) ?? [],
    [feedQuery.data],
  );

  // The "New" divider (3.6). Snapshot which events were unread when the screen
  // opened: per list, the server's `unreadCount` names how many of its latest
  // events by other people are past the read marker. Taken once, so neither a
  // poll nor marking read moves the divider while the screen is up. Events by
  // other people that arrive later count as new too.
  const [snapshot, setSnapshot] = useState<{ ids: Set<string>; topAt: string | null } | null>(null);
  useEffect(() => {
    if (snapshot || !feedQuery.data || !listsQuery.data) return;
    const unread = new Map<string, number>();
    for (const l of listsQuery.data.lists) if (!l.mutedAt) unread.set(l.id, l.unreadCount);
    setSnapshot({
      ids: newEventIds(events, unread, selfId),
      topAt: events[0]?.createdAt ?? null,
    });
  }, [snapshot, feedQuery.data, listsQuery.data, events, selfId]);
  const isNew = useCallback(
    (e: ActivityEvent) =>
      !!snapshot &&
      (snapshot.ids.has(e.id) ||
        (e.actorId !== selfId && !!snapshot.topAt && e.createdAt > snapshot.topAt)),
    [snapshot, selfId],
  );

  // Mark read when leaving, not on arrival, so one visit doesn't wipe which
  // lists changed before the person has seen them. Refetch the lists so the
  // home bell clears.
  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      return () => {
        markActivityRead(undefined, token)
          .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.lists.all }))
          .catch(() => {});
      };
    }, [token, queryClient]),
  );

  const [filter, setFilter] = useState<Filter>(null);

  // People and lists in the loaded feed, in order of first appearance, capped
  // so the chip strip stays one short scroll.
  const FILTER_CHIP_CAP = 6;
  const filterChips = useMemo(() => {
    const people: Array<{ id: string; name: string }> = [];
    const lists: Array<{ id: string; name: string; emoji: string }> = [];
    const seenPeople = new Set<string>();
    const seenLists = new Set<string>();
    for (const e of events) {
      if (!seenPeople.has(e.actorId)) {
        seenPeople.add(e.actorId);
        people.push({
          id: e.actorId,
          name: e.actorId === selfId ? "You" : firstName(e.actorDisplayName),
        });
      }
      if (!seenLists.has(e.listId)) {
        seenLists.add(e.listId);
        const meta = listLookup.get(e.listId);
        if (meta) lists.push({ id: e.listId, name: meta.name, emoji: meta.emoji });
      }
    }
    return { people: people.slice(0, FILTER_CHIP_CAP), lists: lists.slice(0, FILTER_CHIP_CAP) };
  }, [events, listLookup, selfId]);

  const filteredEvents = useMemo(() => {
    if (!filter) return events;
    if (filter.kind === "actor") return events.filter((e) => e.actorId === filter.id);
    return events.filter((e) => e.listId === filter.id);
  }, [events, filter]);

  // New events first under a "New" heading, then everything else by day.
  // `showList` drops the list line on consecutive rows from the same list.
  const items: FeedItem[] = useMemo(() => {
    const newIds = new Set(filteredEvents.filter(isNew).map((e) => e.id));
    const { fresh, earlier } = splitAtReadMarker(filteredEvents, newIds);
    const suppressList = filter?.kind === "list";
    const out: FeedItem[] = [];
    let lastListId: string | null = null;
    if (fresh.length > 0) {
      out.push({ kind: "new", id: "new" });
      for (const e of fresh) {
        out.push({
          kind: "event",
          id: e.id,
          event: e,
          showList: !suppressList && e.listId !== lastListId,
          fresh: true,
        });
        lastListId = e.listId;
      }
    }
    let lastBucket: string | null = null;
    for (const e of earlier) {
      const bucket = dayBucketLabel(e.createdAt);
      const newBucket = bucket !== lastBucket;
      if (newBucket) {
        out.push({
          kind: "heading",
          id: `h-${bucket}-${e.id}`,
          label: bucket,
          afterNew: lastBucket === null && fresh.length > 0,
        });
        lastBucket = bucket;
        lastListId = null;
      }
      out.push({
        kind: "event",
        id: e.id,
        event: e,
        showList: !suppressList && (newBucket || e.listId !== lastListId),
        fresh: false,
      });
      lastListId = e.listId;
    }
    return out;
  }, [filteredEvents, filter, isNew]);

  // Deep-link to the item when the event names one that still exists;
  // otherwise (deleted since, or a list-level event) open the list.
  const openEvent = useCallback(
    async (event: ActivityEvent) => {
      if (event.itemId) {
        const itemId = event.itemId;
        try {
          const res = await queryClient.fetchQuery({
            queryKey: queryKeys.items.detail(itemId),
            queryFn: () => fetchItem(itemId, token),
            staleTime: 30_000,
          });
          if (res.item) {
            router.push(`/list/${event.listId}/item/${itemId}`);
            return;
          }
        } catch {
          // Gone (deleted or no access): fall back to the list.
        }
      }
      router.push(`/list/${event.listId}`);
    },
    [queryClient, router, token],
  );

  const toggle = (next: NonNullable<Filter>) =>
    setFilter(filter?.kind === next.kind && filter.id === next.id ? null : next);

  const isInitialLoading = feedQuery.isPending;
  const feedRevealed = useRevealAfterLoading(isInitialLoading);
  // Only an empty cache gets the error state; a failed background refetch
  // keeps the feed already on screen (0.9).
  const isError = feedQuery.isError && !feedQuery.data;
  const showChips =
    events.length > 0 && (filterChips.people.length > 1 || filterChips.lists.length > 1);

  return (
    <Screen style={styles.root}>
      <ScreenHeader
        leading="back"
        onLeadingPress={() => goBack("/")}
        leadingTestID="activity-back"
        title="Activity"
      />

      {showChips ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterStrip}
          style={[styles.filterScroll, screenColumnStyle]}
          testID="activity-filter-strip"
        >
          <Chip
            label="All"
            selected={filter === null}
            onPress={() => setFilter(null)}
            accessibilityLabel="Show all activity"
            testID="activity-filter-all"
          />
          {filterChips.people.length > 1 ? (
            <View style={styles.chipGroup} role="group" aria-label="People">
              <Text variant="eyebrow" style={styles.chipGroupLabel}>
                People
              </Text>
              {filterChips.people.map((p) => (
                <Chip
                  key={`actor-${p.id}`}
                  label={p.name}
                  selected={filter?.kind === "actor" && filter.id === p.id}
                  onPress={() => toggle({ kind: "actor", id: p.id })}
                  accessibilityLabel={`Only ${p.name}`}
                  testID={`activity-filter-actor-${p.id}`}
                />
              ))}
            </View>
          ) : null}
          {filterChips.lists.length > 1 ? (
            <View style={styles.chipGroup} role="group" aria-label="Lists">
              <View style={styles.chipDivider} />
              <Text variant="eyebrow" style={styles.chipGroupLabel}>
                Lists
              </Text>
              {filterChips.lists.map((l) => (
                <Chip
                  key={`list-${l.id}`}
                  label={`${l.emoji} ${l.name}`}
                  selected={filter?.kind === "list" && filter.id === l.id}
                  onPress={() => toggle({ kind: "list", id: l.id })}
                  accessibilityLabel={`Only ${l.name}`}
                  testID={`activity-filter-list-${l.id}`}
                />
              ))}
            </View>
          ) : null}
        </ScrollView>
      ) : null}

      {isInitialLoading ? (
        <View style={styles.skeleton}>
          <View style={screenColumnStyle}>
            <Skeleton.Rows count={8} testID="activity-skeleton" />
          </View>
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <EmptyState
            title="Couldn't load activity"
            description={loadErrorMessage(feedQuery.error)}
            action={
              <Button label="Try again" variant="secondary" onPress={() => feedQuery.refetch()} />
            }
          />
        </View>
      ) : events.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            title="No activity yet"
            description="When you or the people on your lists add, rank or finish something, it shows up here."
          />
        </View>
      ) : filteredEvents.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            title="Nothing matches this filter"
            action={<Button label="Show all" variant="secondary" onPress={() => setFilter(null)} />}
          />
        </View>
      ) : (
        <Reveal when={feedRevealed}>
          <PullToRefresh
            refreshing={feedQuery.isRefetching && !feedQuery.isFetchingNextPage}
            onRefresh={() => feedQuery.refetch()}
          >
            <FlatList
              testID="activity-feed"
              data={items}
              keyExtractor={(it) => it.id}
              contentContainerStyle={[styles.body, screenColumnStyle]}
              renderItem={({ item, index }) =>
                item.kind === "new" ? (
                  <SectionHeader
                    title="New"
                    first={index === 0}
                    trailing={<View style={styles.freshDot} />}
                    testID="activity-new-divider"
                  />
                ) : item.kind === "heading" ? (
                  <SectionHeader
                    title={item.label}
                    first={index === 0}
                    style={item.afterNew ? styles.afterNew : undefined}
                    testID={item.afterNew ? "activity-earlier" : `activity-day-${item.label}`}
                  />
                ) : (
                  <ActivityRow
                    event={item.event}
                    list={listLookup.get(item.event.listId) ?? null}
                    showList={item.showList}
                    fresh={item.fresh}
                    selfId={selfId}
                    onPress={() => void openEvent(item.event)}
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
                    <ActivityIndicator color={tokens.accent.default} accessibilityLabel="Loading" />
                  </View>
                ) : undefined
              }
            />
          </PullToRefresh>
        </Reveal>
      )}
    </Screen>
  );
}

interface ActivityRowProps {
  event: ActivityEvent;
  list: ListMeta | null;
  /** False on consecutive rows from the same list (a burst of adds). */
  showList: boolean;
  fresh: boolean;
  selfId: string | null;
  onPress: () => void;
}

function ActivityRow({ event, list, showList, fresh, selfId, onPress }: ActivityRowProps) {
  const who = event.actorId === selfId ? "You" : firstName(event.actorDisplayName);
  const description = describeActivity(event, { kind: list?.itemKind ?? null, quote: true });
  const when = shortAge(event.createdAt);
  const mark = MARKS[activityMark(event.type)];
  const accent =
    list && (list.color as ListColorKey) in tokens.list
      ? tokens.list[list.color as ListColorKey]
      : tokens.accent.default;

  return (
    <ListRow
      // Named by its own text (sentence, list, age; WCAG 2.5.3). New rows sit
      // under the visible "New" divider.
      onPress={onPress}
      testID={`activity-row-${event.id}`}
      leading={
        <View style={[styles.avatar, { backgroundColor: alpha(accent, 0.12) }]} aria-hidden>
          {mark.icon ? (
            <Icon name={mark.icon} size={16} color={accent} />
          ) : (
            <Text style={[styles.avatarGlyph, { color: accent }]}>{mark.text}</Text>
          )}
        </View>
      }
      title={
        <Text numberOfLines={2}>
          <Text style={styles.actorName}>{who}</Text>
          <Text> {description}</Text>
        </Text>
      }
      subtitle={
        list && showList ? (
          <View style={styles.listChipRow}>
            <Text variant="caption">{list.emoji}</Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {list.name}
            </Text>
          </View>
        ) : undefined
      }
      trailing={
        <View style={styles.trailing}>
          {fresh ? <View style={styles.freshDot} accessibilityElementsHidden /> : null}
          <Text variant="caption" tone="muted" style={styles.when}>
            {when}
          </Text>
        </View>
      }
    />
  );
}

// Leading glyph per event family. Glyphs the `Icon` set covers are drawn with
// it; the rest stay typographic marks.
const MARKS: Record<ActivityMark, { icon?: IconName; text?: string }> = {
  plus: { icon: "plus" },
  check: { icon: "check" },
  sync: { icon: "refresh" },
  minus: { text: "−" },
  undo: { text: "↺" },
  rank: { text: "↑" },
  unrank: { text: "↓" },
  in: { text: "→" },
  out: { text: "←" },
  edit: { text: "·" },
};

// Day bucket: Today / Yesterday / weekday name / date.
function dayBucketLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  filterScroll: { flexGrow: 0 },
  filterStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    paddingHorizontal: layout.gutter,
    paddingTop: tokens.space.xs,
    paddingBottom: tokens.space.sm,
  },
  chipGroup: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  chipGroupLabel: { marginLeft: tokens.space.sm, marginRight: tokens.space.xxs },
  chipDivider: {
    width: StyleSheet.hairlineWidth,
    height: 20,
    backgroundColor: tokens.border.default,
    marginLeft: tokens.space.xs,
  },
  body: { paddingBottom: layout.bottomInset },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: layout.gutter,
  },
  skeleton: { paddingTop: tokens.space.sm },
  // "Earlier", after the unread block: a rule above it closes "New".
  afterNew: {
    marginTop: tokens.space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.border.default,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: tokens.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarGlyph: { fontWeight: tokens.font.weight.semibold },
  actorName: { fontWeight: tokens.font.weight.semibold, color: tokens.text.primary },
  listChipRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  trailing: { flexDirection: "row", alignItems: "center", gap: tokens.space.xsm },
  freshDot: {
    width: 6,
    height: 6,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.accent.default,
  },
  when: { fontVariant: ["tabular-nums"] },
  footerLoader: { paddingVertical: tokens.space.lg, alignItems: "center" },
});
