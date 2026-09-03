// HighScore's one screen: a feed of days.
//
// Time is the primary axis. TODAY is the hero — how many of your games you've
// posted, the ones you still owe, and the recap action once you've posted
// something. Under it are today's standings, then yesterday, then every earlier
// day as a collapsed header you can open. There is no day rail and no bottom
// bar: the feed *is* the day navigation, and everything else (a game board, the
// friends list, a profile, your account) opens as a sheet over this feed
// without unmounting it. See `src/nav/SheetHost.tsx`.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import {
  createFriendInvite,
  fetchFriendRequests,
  fetchFriends,
} from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type { DiscoveryGame, Game, GamesResponse, MyGame } from "@workshop/shared/games";
import { haptics } from "@workshop/ui";
import { type Href, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import {
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";
import {
  addGame,
  createGameShareLink,
  fetchGameDiscovery,
  fetchMyGames,
  moveGame,
  setGameScoreSpec,
  upsertGameScore,
} from "../games/api/games";
import { ReactionPickerSheet } from "../games/components/ReactionPickerSheet";
import { useReturnToPaste } from "../games/hooks/useReturnToPaste";
import { localDateKey } from "../games/lib/gameDate";
import { neighborsForOrderedReorder } from "../games/lib/reorder";
import { isGameReteachable, specForGame } from "../games/lib/scoreSpecs";
import { buildTodaysGameScoresSummary } from "../games/lib/scoresSummary";
import { copyToClipboard, shareOrCopyLink } from "../games/lib/share";
import { useGamesRuntime } from "../games/runtime";
import { GameScorePasteSheet, type TaughtScoreSpec } from "../games/screens/GameScorePasteSheet";
import { AddGameSheet } from "../games/screens/games/AddGameSheet";
import { PixelIcon, Screen, Text, tokens, useToast } from "../theme";
import { DaySection, toLedgerRows } from "./DaySection";
import { dayHeading, pastDayKeys } from "./dayLabels";
import { EmptyTimeline } from "./EmptyTimeline";
import { FeedScroll } from "./FeedScroll";
import { SpineRule } from "./Spine";
import { TimelineTopBar } from "./TimelineTopBar";
import { TodayGame } from "./TodayGame";
import { TodayHero } from "./TodayHero";
import { TodoList } from "./TodoList";
import type { TodoReorderEvent } from "./todoListProps";
import { useFeedReactions } from "./useFeedReactions";

const INITIAL_PAST_DAYS = 6;
const PAST_DAYS_PAGE = 7;
const MAX_PAST_DAYS = 30;
/** Scroll distance past which the sticky day marker takes over the header. */
const STICKY_AFTER = 56;
/** Past days that fetch a one-line summary even while collapsed. */
const PRELOAD_PAST_DAYS = 5;

export function TimelineHome() {
  const { token, user, routes } = useGamesRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();

  const todayKey = localDateKey();
  const gamesKey = queryKeys.games.mine(todayKey);

  const [addOpen, setAddOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [scoreShareUrl, setScoreShareUrl] = useState<string | null>(null);
  const [copyingScores, setCopyingScores] = useState(false);
  const [addingDiscoveryIds, setAddingDiscoveryIds] = useState<string[]>([]);
  const [addedDiscoveryIds, setAddedDiscoveryIds] = useState<string[]>([]);
  const [pastDays, setPastDays] = useState(INITIAL_PAST_DAYS);
  // Yesterday opens with the feed — it's the comparison people actually want.
  // Everything older is a header until you ask for it.
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});

  const gamesQuery = useQuery({
    queryKey: gamesKey,
    queryFn: () => fetchMyGames(todayKey, token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const myGames = useMemo(() => gamesQuery.data?.games ?? [], [gamesQuery.data]);
  const isEmpty = !gamesQuery.isPending && !gamesQuery.isError && myGames.length === 0;

  const requestsQuery = useQuery({
    queryKey: queryKeys.friends.requests,
    queryFn: () => fetchFriendRequests(token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const pendingRequests = requestsQuery.data?.inbound.length ?? 0;

  const friendsQuery = useQuery({
    queryKey: queryKeys.friends.all,
    queryFn: () => fetchFriends(token),
    enabled: !!token && isEmpty,
    refetchInterval: livePoll,
  });
  const friends = friendsQuery.data?.friends ?? [];

  const discoveryQuery = useQuery({
    queryKey: queryKeys.games.discovery(),
    queryFn: () => fetchGameDiscovery(token, { includeOwned: true }),
    enabled: !!token && (addOpen || isEmpty),
    refetchInterval: livePoll,
  });
  const discovery = discoveryQuery.data?.games ?? [];

  const reactions = useFeedReactions({
    token,
    viewer: user ? { userId: user.id, displayName: user.displayName ?? null } : null,
  });

  // ---- mutations -----------------------------------------------------------

  const addMutation = useMutation({
    mutationFn: (url: string) => addGame(url, token),
    onSuccess: async (data) => {
      haptics.medium();
      setAddOpen(false);
      await queryClient.invalidateQueries({ queryKey: gamesKey });
      showToast({ message: `Added ${data.game.title}`, tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't add that game."), tone: "danger" });
    },
  });

  const addDiscoveryMutation = useMutation({
    mutationFn: (game: DiscoveryGame) => addGame(game.game.url, token),
    onMutate: (game) => {
      setAddingDiscoveryIds((ids) => [...ids, game.game.id]);
    },
    onSuccess: async (_data, game) => {
      haptics.medium();
      setAddedDiscoveryIds((ids) => (ids.includes(game.game.id) ? ids : [...ids, game.game.id]));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: gamesKey }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games.discovery() }),
      ]);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't add that game."), tone: "danger" });
    },
    onSettled: (_data, _e, game) => {
      setAddingDiscoveryIds((ids) => ids.filter((id) => id !== game.game.id));
    },
  });

  const inviteMutation = useMutation({
    mutationFn: () => createFriendInvite(token),
    onSuccess: async (data) => {
      haptics.medium();
      setInviteUrl(data.url);
      const result = await shareOrCopyLink(data.url);
      if (result === "copied") {
        showToast({ message: "Invite link copied", tone: "success" });
      } else if (result === "failed") {
        showToast({ message: "Couldn't copy — copy the link below manually.", tone: "danger" });
      }
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't create an invite link."), tone: "danger" });
    },
  });

  const moveMutation = useMutation<
    { position: number | null; rebalanced: boolean },
    Error,
    { gameId: string; beforeGameId: string | null; afterGameId: string | null; toIndex: number },
    { previous?: GamesResponse }
  >({
    mutationFn: ({ gameId, beforeGameId, afterGameId }) =>
      moveGame(gameId, { beforeGameId, afterGameId }, token),
    onMutate: async ({ gameId, toIndex }) => {
      await queryClient.cancelQueries({ queryKey: gamesKey });
      const previous = queryClient.getQueryData<GamesResponse>(gamesKey);
      if (previous) {
        const fromIndex = previous.games.findIndex((g) => g.gameId === gameId);
        if (fromIndex >= 0) {
          const next = previous.games.slice();
          const [moved] = next.splice(fromIndex, 1);
          if (moved) {
            next.splice(toIndex, 0, moved);
            queryClient.setQueryData<GamesResponse>(gamesKey, { ...previous, games: next });
          }
        }
      }
      return previous ? { previous } : {};
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(gamesKey, ctx.previous);
      showToast({ message: errorMessage(e, "Couldn't move that game."), tone: "danger" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: gamesKey });
    },
  });

  // Play-then-paste loop, scoped to the Games surface.
  const hasMyScore = useCallback(
    (gameId: string) =>
      myGames.find((g) => g.gameId === gameId)?.standings.viewerHasPlayed ?? false,
    [myGames],
  );
  const { promptItemId, markPlaying, openPasteFor, dismiss } = useReturnToPaste({
    todayKey,
    hasScoreForItem: hasMyScore,
    scope: "games",
  });
  const pasteTarget: Game | null =
    (promptItemId ? myGames.find((g) => g.gameId === promptItemId)?.game : null) ?? null;

  const upsertMutation = useMutation({
    mutationFn: async ({
      game,
      scoreRaw,
      taught,
    }: {
      game: Game;
      scoreRaw: string;
      taught?: TaughtScoreSpec;
    }) => {
      if (taught) await setGameScoreSpec(game.id, taught, token);
      return upsertGameScore(game.id, { periodKey: todayKey, scoreRaw }, token);
    },
    onSuccess: async (_data, { game }) => {
      haptics.medium();
      dismiss();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: gamesKey }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.games.leaderboard(game.id, todayKey),
        }),
      ]);
      showToast({ message: "Score posted", tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't save score"), tone: "danger" });
    },
  });

  // ---- derived feed data ---------------------------------------------------

  const postedCount = myGames.filter((g) => g.standings.viewerHasPlayed).length;
  // "Next up" is the first game you still owe, in your own order.
  const nextUpId = myGames.find((g) => !g.standings.viewerHasPlayed)?.gameId ?? null;
  const todayRows = useMemo(() => {
    const byGame = new Map<string, ReturnType<typeof toLedgerRows>>();
    for (const mg of myGames) byGame.set(mg.gameId, toLedgerRows(mg.game, mg.standings.entries));
    return byGame;
  }, [myGames]);

  const pastKeys = useMemo(() => pastDayKeys(todayKey, pastDays), [todayKey, pastDays]);
  const dayKeys = useMemo(() => [todayKey, ...pastKeys], [todayKey, pastKeys]);

  // ---- scroll + sticky day marker -----------------------------------------

  // Sticky marker offsets are built from block *heights*, not measured
  // positions: `onLayout` fires when a view resizes but not when a sibling
  // above it grows, so absolute y values go stale the moment a day section
  // loads its scores. Heights don't — a running total of them is always right.
  const heightsRef = useRef<Map<string, number>>(new Map());
  const marks = useSharedValue<number[]>([]);
  const [stickyIndex, setStickyIndex] = useState(-1);
  const scrollY = useSharedValue(0);

  const syncMarks = useCallback(() => {
    let running = 0;
    marks.value = dayKeys.map((key) => {
      const offset = running;
      running += heightsRef.current.get(key) ?? Number.MAX_SAFE_INTEGER / 2;
      return offset;
    });
  }, [dayKeys, marks]);

  const recordHeight = useCallback(
    (key: string, height: number) => {
      if (heightsRef.current.get(key) === height) return;
      heightsRef.current.set(key, height);
      syncMarks();
    },
    [syncMarks],
  );
  const onTodayLayout = useCallback(
    (event: LayoutChangeEvent) => recordHeight(todayKey, event.nativeEvent.layout.height),
    [recordHeight, todayKey],
  );

  const loadingMoreRef = useRef(false);
  const loadMore = useCallback(() => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setPastDays((n) => Math.min(MAX_PAST_DAYS, n + PAST_DAYS_PAGE));
    setTimeout(() => {
      loadingMoreRef.current = false;
    }, 400);
  }, []);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
    const distanceToEnd =
      event.contentSize.height - (event.contentOffset.y + event.layoutMeasurement.height);
    if (distanceToEnd < 320) runOnJS(loadMore)();
  });

  useAnimatedReaction(
    () => {
      if (scrollY.value < STICKY_AFTER) return -1;
      const ys = marks.value;
      let index = -1;
      for (let i = 0; i < ys.length; i += 1) {
        const y = ys[i];
        if (y !== undefined && y <= scrollY.value + STICKY_AFTER) index = i;
      }
      return index;
    },
    (next, prev) => {
      if (next !== prev) runOnJS(setStickyIndex)(next);
    },
  );

  const stickyKey = stickyIndex >= 0 ? dayKeys[stickyIndex] : undefined;
  const sticky = stickyKey ? dayHeading(stickyKey, todayKey) : null;

  // ---- actions -------------------------------------------------------------

  const openGame = useCallback(
    (gameId: string) => router.push(routes.game(gameId) as Href),
    [router, routes],
  );

  const onReorder = ({ fromIndex, toIndex }: TodoReorderEvent) => {
    const neighbors = neighborsForOrderedReorder(myGames, fromIndex, toIndex);
    const moved = myGames[fromIndex];
    if (!neighbors || !moved) return;
    moveMutation.mutate({
      gameId: moved.gameId,
      beforeGameId: neighbors.before?.gameId ?? null,
      afterGameId: neighbors.after?.gameId ?? null,
      toIndex,
    });
  };

  const onCopyRecap = async () => {
    const selfId = user?.id ?? null;
    const preview = buildTodaysGameScoresSummary({
      shareUrl: "",
      games: myGames,
      selfId,
      dateKey: todayKey,
    });
    if (!preview) {
      showToast({
        message: "No scores from you today yet. Post one to share a recap.",
        tone: "default",
      });
      return;
    }
    try {
      setCopyingScores(true);
      let url = scoreShareUrl;
      if (!url) {
        const link = await createGameShareLink(token);
        url = link.url;
        setScoreShareUrl(url);
      }
      const summary = buildTodaysGameScoresSummary({
        shareUrl: url,
        games: myGames,
        selfId,
        dateKey: todayKey,
      });
      if (!summary) return;
      const ok = await copyToClipboard(summary);
      if (ok) haptics.light();
      showToast({
        message: ok ? "Today's recap copied" : "Couldn't copy to clipboard",
        tone: ok ? "success" : "danger",
      });
    } catch (e) {
      showToast({ message: errorMessage(e, "Couldn't create a share link."), tone: "danger" });
    } finally {
      setCopyingScores(false);
    }
  };

  const onCopyInvite = async () => {
    if (!inviteUrl) return;
    const result = await shareOrCopyLink(inviteUrl);
    if (result === "copied") showToast({ message: "Invite link copied", tone: "success" });
  };

  const renderTodayGame = useCallback(
    (game: MyGame, dragging: boolean, onLongPressBody?: () => void) => (
      <TodayGame
        game={game}
        rows={todayRows.get(game.gameId) ?? []}
        selfId={user?.id ?? null}
        featured={nextUpId === game.gameId}
        dragging={dragging}
        {...(onLongPressBody ? { onLongPressBody } : {})}
        onPlay={() => markPlaying({ id: game.gameId, url: game.game.url })}
        onPaste={() => openPasteFor({ id: game.gameId, url: game.game.url })}
        onOpen={() => openGame(game.gameId)}
        onReact={(userId, emoji, cur) => reactions.react(todayKey, game.gameId, userId, emoji, cur)}
        onOpenReactionPicker={(userId) =>
          reactions.openPicker({
            dateKey: todayKey,
            gameId: game.gameId,
            scoreUserId: userId,
            name: game.standings.entries.find((e) => e.userId === userId)?.displayName ?? null,
          })
        }
      />
    ),
    [
      todayRows,
      nextUpId,
      user?.id,
      markPlaying,
      openPasteFor,
      openGame,
      reactions.react,
      reactions.openPicker,
      todayKey,
    ],
  );

  const canCopyRecap = postedCount > 0;

  // "You'd be #2 today" under the paste box. Today's standings are already in
  // cache, so this costs a comparison, not a request.
  const rankPreviewFor = (gameId: string | null) => {
    if (!gameId) return undefined;
    const target = myGames.find((g) => g.gameId === gameId);
    if (!target) return undefined;
    const better = target.game.scoreDirection === "asc";
    return (value: number) => {
      const ahead = target.standings.entries.filter((entry) => {
        if (entry.userId === user?.id || entry.scoreValue == null) return false;
        return better ? entry.scoreValue < value : entry.scoreValue > value;
      }).length;
      return ahead + 1;
    };
  };

  return (
    <Screen style={styles.root} testID="timeline-home">
      <TimelineTopBar
        pendingRequests={pendingRequests}
        sticky={sticky}
        user={user}
        onOpenFriends={() => router.push("/friends")}
        onOpenAccount={() => router.push("/profile")}
      />

      {gamesQuery.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.neon.pink} />
        </View>
      ) : gamesQuery.isError ? (
        <View style={styles.center}>
          <Text variant="heading">Couldn't load your games</Text>
          <Text tone="secondary" style={styles.centerText}>
            {errorMessage(gamesQuery.error)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry"
            onPress={() => gamesQuery.refetch()}
            style={styles.retry}
          >
            <Text variant="heading" tone="link">
              Retry
            </Text>
          </Pressable>
        </View>
      ) : isEmpty ? (
        <EmptyTimeline
          today={todayKey}
          friendsLoading={friendsQuery.isLoading}
          hasFriends={friends.length > 0}
          discovery={discovery}
          discoveryLoading={discoveryQuery.isLoading}
          invitePending={inviteMutation.isPending}
          inviteUrl={inviteUrl}
          onAddFriends={() => inviteMutation.mutate()}
          onCopyInvite={onCopyInvite}
          onAddByUrl={() => setAddOpen(true)}
          onAddDiscovery={(game) => addDiscoveryMutation.mutate(game)}
          addingGameIds={addingDiscoveryIds}
          addedGameIds={addedDiscoveryIds}
        />
      ) : (
        <FeedScroll
          onScroll={onScroll}
          contentContainerStyle={styles.feed}
          testID="timeline-feed"
          refreshControl={
            <RefreshControl
              refreshing={gamesQuery.isRefetching && !gamesQuery.isPending}
              onRefresh={() => gamesQuery.refetch()}
              tintColor={tokens.neon.pink}
              colors={[tokens.neon.pink]}
              progressBackgroundColor={tokens.bg.surface}
            />
          }
        >
          <SpineRule>
            <View onLayout={onTodayLayout}>
              <TodayHero
                today={todayKey}
                postedCount={postedCount}
                totalCount={myGames.length}
                games={
                  <TodoList games={myGames} renderRow={renderTodayGame} onReorder={onReorder} />
                }
                canCopyRecap={canCopyRecap}
                copyingRecap={copyingScores}
                onCopyRecap={onCopyRecap}
              />
            </View>

            {pastKeys.map((key, index) => (
              <DaySection
                key={key}
                dateKey={key}
                today={todayKey}
                expanded={expandedDays[key] ?? index === 0}
                preload={index <= PRELOAD_PAST_DAYS}
                onToggle={() =>
                  setExpandedDays((prev) => ({
                    ...prev,
                    [key]: !(prev[key] ?? index === 0),
                  }))
                }
                token={token}
                selfId={user?.id ?? null}
                onOpenGame={openGame}
                onReact={reactions.react}
                onOpenPicker={reactions.openPicker}
                onMeasure={recordHeight}
              />
            ))}
          </SpineRule>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a game"
            onPress={() => setAddOpen(true)}
            testID="feed-add-game"
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.addRow,
              (pressed || hovered) && styles.addRowActive,
            ]}
          >
            <PixelIcon name="plus" size={16} color={tokens.neon.pink} />
            <Text variant="heading" tone="link">
              Add a game
            </Text>
          </Pressable>
        </FeedScroll>
      )}

      <AddGameSheet
        visible={addOpen}
        pending={addMutation.isPending}
        onSubmit={(url) => addMutation.mutate(url)}
        onClose={() => setAddOpen(false)}
        discovery={discovery}
        discoveryLoading={discoveryQuery.isLoading}
        onAddDiscovery={(game) => addDiscoveryMutation.mutate(game)}
        addingGameIds={addingDiscoveryIds}
        addedGameIds={addedDiscoveryIds}
      />

      <GameScorePasteSheet
        item={pasteTarget}
        pending={upsertMutation.isPending}
        rankPreview={rankPreviewFor(promptItemId)}
        spec={pasteTarget ? specForGame(pasteTarget) : null}
        canReteach={!!user?.isAdmin && pasteTarget != null && isGameReteachable(pasteTarget)}
        onTeach={(game, scoreRaw, taught) => upsertMutation.mutate({ game, scoreRaw, taught })}
        onSubmit={(game, scoreRaw) => upsertMutation.mutate({ game, scoreRaw })}
        onClose={dismiss}
      />

      <ReactionPickerSheet
        visible={!!reactions.target}
        targetName={reactions.target?.name ?? null}
        current={reactions.currentEmoji}
        onPick={reactions.pick}
        onRemove={reactions.removeReaction}
        onClose={reactions.closePicker}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  feed: {
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.xxl * 2,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.xl,
  },
  centerText: { textAlign: "center" },
  retry: { paddingVertical: tokens.space.sm, paddingHorizontal: tokens.space.md },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    marginLeft: tokens.gutter,
    marginTop: tokens.space.md,
    paddingVertical: tokens.space.md,
  },
  addRowActive: { backgroundColor: tokens.bg.surface },
});
