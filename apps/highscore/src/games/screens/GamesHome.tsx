// Games home — the board.
//
// Every game is a full-bleed ledger band (`GameRow`); there is no card stack
// and no floating button. Navigation and the day's actions live in the dock at
// the bottom of the screen (`useDock`), so the whole screen is reachable
// without moving your thumb: swipe a band right to play, left to paste, tap it
// to open its board, and use the dock for ADD / RECAP / PLAYERS / YOU.
//
// The day scrubber is hidden chrome. It sits above the top of the list and the
// list starts scrolled past it, so pulling down reveals it and choosing Today
// puts it away. The header's date marker always names the day on screen and
// doubles as the non-gesture way in and out.
//
// Reorder is a mode, not an always-armed long press: SORT in the section header
// swaps the bands for compact rows with drag plus explicit ▲▼ keys, and the
// dock collapses to a single DONE key while it's on.
//
// Everything else is unchanged product behavior: the play→paste loop
// (`useReturnToPaste`, scope "games"), the teach flow, reactions, the
// copy-scores recap with its `/g/:token` play link, and the friends-first
// onboarding empty state.

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
import { confirm, haptics, openExternalUrl } from "@workshop/ui";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { type QuickAction, QuickMenu } from "../../components/QuickMenu";
import { Wordmark } from "../../components/Wordmark";
import { DOCK_HEIGHT, type DockKey, useDock } from "../../nav/dock";
import { Button } from "../../theme/Button";
import { EmptyState } from "../../theme/EmptyState";
import { homeLayout, Screen } from "../../theme/layout";
import { PixelIcon } from "../../theme/PixelIcon";
import { Sheet } from "../../theme/Sheet";
import { Text } from "../../theme/Text";
import { useToast } from "../../theme/Toast";
import { tokens } from "../../theme/tokens";
import {
  addGame,
  createGameShareLink,
  fetchGameDiscovery,
  fetchMyGames,
  moveGame,
  removeGame,
  setGameScoreSpec,
  upsertGameScore,
} from "../api/games";
import { DayScrubber, dayMarkerLabel, SCRUBBER_HEIGHT } from "../components/DayScrubber";
import { ReactionPickerSheet } from "../components/ReactionPickerSheet";
import { useReturnToPaste } from "../hooks/useReturnToPaste";
import { useScoreReactions } from "../hooks/useScoreReactions";
import { localDateKey } from "../lib/gameDate";
import { neighborsForOrderedReorder } from "../lib/reorder";
import { isGameReteachable, specForGame } from "../lib/scoreSpecs";
import { buildTodaysGameScoresSummary } from "../lib/scoresSummary";
import { copyToClipboard, shareOrCopyLink } from "../lib/share";
import { useGamesRuntime } from "../runtime";
import { GameScorePasteSheet, type TaughtScoreSpec } from "./GameScorePasteSheet";
import { AddGameSheet } from "./games/AddGameSheet";
import { GameRow } from "./games/GameRow";
import { GamesOnboarding } from "./games/GamesOnboarding";
import { SortList } from "./games/SortList";

/** Settle delay after the last scroll event before the scrubber snaps. */
const SNAP_DELAY_MS = 140;

export function GamesHome() {
  const { token, user, routes } = useGamesRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();

  const todayKey = localDateKey();
  const gamesKey = queryKeys.games.mine(todayKey);

  // The scrubber re-dates every band's standings. Scores can only be POSTED to
  // today's bucket, so the play→paste loop below stays pinned to `todayKey`;
  // only the displayed standings follow `viewDate`.
  const [viewDate, setViewDate] = useState(todayKey);
  const viewingToday = viewDate === todayKey;

  const [addOpen, setAddOpen] = useState(false);
  const [menuGame, setMenuGame] = useState<MyGame | null>(null);
  // Admin "Re-teach scoring": remembered while the menu sheet animates out,
  // then handed to the paste sheet in the menu's `onClosed` — never open the
  // second Sheet in the same tick (two stacked Modals wedge iOS).
  const [reteachAfterMenu, setReteachAfterMenu] = useState<MyGame | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [scoreShareUrl, setScoreShareUrl] = useState<string | null>(null);
  const [copyingScores, setCopyingScores] = useState(false);
  const [addingDiscoveryIds, setAddingDiscoveryIds] = useState<string[]>([]);
  const [addedDiscoveryIds, setAddedDiscoveryIds] = useState<string[]>([]);
  const [sorting, setSorting] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);

  const gamesQuery = useQuery({
    queryKey: gamesKey,
    queryFn: () => fetchMyGames(todayKey, token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const myGames = useMemo(() => gamesQuery.data?.games ?? [], [gamesQuery.data]);
  const isEmpty = !gamesQuery.isPending && !gamesQuery.isError && myGames.length === 0;

  const viewQuery = useQuery({
    queryKey: queryKeys.games.mine(viewDate),
    queryFn: () => fetchMyGames(viewDate, token),
    enabled: !!token,
    refetchInterval: viewingToday ? livePoll : false,
  });
  const viewStandings = useMemo(() => {
    const byGameId = new Map<string, MyGame["standings"]>();
    for (const g of viewQuery.data?.games ?? []) byGameId.set(g.gameId, g.standings);
    return byGameId;
  }, [viewQuery.data]);

  // Drives the pink notch on the dock's YOU key.
  const requestsQuery = useQuery({
    queryKey: queryKeys.friends.requests,
    queryFn: () => fetchFriendRequests(token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const pendingRequests = requestsQuery.data?.inbound.length ?? 0;

  const reactionCtl = useScoreReactions<GamesResponse>({
    periodKey: viewDate,
    token,
    viewer: user ? { userId: user.id, displayName: user.displayName ?? null } : null,
    queryKey: queryKeys.games.mine(viewDate),
    readReactions: (data, gameId, scoreUserId) =>
      data.games
        .find((g) => g.gameId === gameId)
        ?.standings.entries.find((e) => e.userId === scoreUserId)?.reactions ?? [],
    writeReactions: (data, gameId, scoreUserId, next) => ({
      ...data,
      games: data.games.map((g) =>
        g.gameId === gameId
          ? {
              ...g,
              standings: {
                ...g.standings,
                entries: g.standings.entries.map((e) =>
                  e.userId === scoreUserId ? { ...e, reactions: next } : e,
                ),
              },
            }
          : g,
      ),
    }),
  });

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

  const onCopyInvite = async () => {
    if (!inviteUrl) return;
    const result = await shareOrCopyLink(inviteUrl);
    if (result === "copied") showToast({ message: "Invite link copied", tone: "success" });
  };

  const onCopyScores = useCallback(async () => {
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
        message: ok ? "Today's scores copied to clipboard" : "Couldn't copy to clipboard",
        tone: ok ? "success" : "danger",
      });
    } catch (e) {
      showToast({ message: errorMessage(e, "Couldn't create a share link."), tone: "danger" });
    } finally {
      setCopyingScores(false);
    }
  }, [myGames, scoreShareUrl, showToast, todayKey, token, user?.id]);

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

  const removeMutation = useMutation({
    mutationFn: (gameId: string) => removeGame(gameId, token),
    onSuccess: async () => {
      haptics.medium();
      await queryClient.invalidateQueries({ queryKey: gamesKey });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't remove that game."), tone: "danger" });
    },
  });

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

  const onReorder = useCallback(
    ({ fromIndex, toIndex }: { fromIndex: number; toIndex: number }) => {
      const neighbors = neighborsForOrderedReorder(myGames, fromIndex, toIndex);
      if (!neighbors) return;
      const moved = myGames[fromIndex];
      if (!moved) return;
      moveMutation.mutate({
        gameId: moved.gameId,
        beforeGameId: neighbors.before?.gameId ?? null,
        afterGameId: neighbors.after?.gameId ?? null,
        toIndex,
      });
    },
    [myGames, moveMutation],
  );

  const onRemove = async (mg: MyGame) => {
    setMenuGame(null);
    const ok = await confirm({
      title: `Remove ${mg.game.title} from your board?`,
      message: "Your past scores stay — re-adding the game brings them back.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) removeMutation.mutate(mg.gameId);
  };

  // ── Hidden day scrubber ──────────────────────────────────────────────────
  // The list starts scrolled past the scrubber, so "pull down" is just
  // scrolling up; no gesture competes with the list's own scroll, on either
  // platform. The snap is debounced off the scroll stream because RN Web
  // doesn't emit scroll-end events.
  const scrollRef = useRef<ScrollView>(null);
  const settledRef = useRef(false);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [scrubberHeight, setScrubberHeight] = useState(SCRUBBER_HEIGHT);
  const [scrubberOpen, setScrubberOpen] = useState(false);

  // Park the list past the scrubber once, as soon as both measurements exist —
  // `contentOffset` is iOS-only and `onContentSizeChange` can beat the first
  // layout, so neither one alone is enough.
  useEffect(() => {
    if (settledRef.current || viewportHeight === 0) return;
    if (scrubberHeight === 0) return;
    if (contentHeight < viewportHeight + scrubberHeight - 1) return;
    settledRef.current = true;
    scrollRef.current?.scrollTo({ y: scrubberHeight, animated: false });
  }, [viewportHeight, contentHeight, scrubberHeight]);

  const settle = useCallback(
    (y: number) => {
      if (y <= 0 || y >= scrubberHeight) {
        setScrubberOpen(y <= 0);
        return;
      }
      const target = y > scrubberHeight / 2 ? scrubberHeight : 0;
      scrollRef.current?.scrollTo({ y: target, animated: true });
      setScrubberOpen(target === 0);
    },
    [scrubberHeight],
  );

  const onScroll = useCallback(
    (y: number) => {
      if (snapTimer.current) clearTimeout(snapTimer.current);
      snapTimer.current = setTimeout(() => settle(y), SNAP_DELAY_MS);
    },
    [settle],
  );

  const toggleScrubber = useCallback(() => {
    const target = scrubberOpen ? scrubberHeight : 0;
    scrollRef.current?.scrollTo({ y: target, animated: true });
    setScrubberOpen(!scrubberOpen);
  }, [scrubberOpen, scrubberHeight]);

  const onSelectDate = useCallback(
    (key: string) => {
      setViewDate(key);
      if (key === localDateKey()) {
        scrollRef.current?.scrollTo({ y: scrubberHeight, animated: true });
        setScrubberOpen(false);
      }
    },
    [scrubberHeight],
  );

  // ── Dock ─────────────────────────────────────────────────────────────────
  const dockKeys = useMemo<DockKey[]>(() => {
    if (sorting) {
      return [
        {
          id: "done",
          label: "Done",
          glyph: "check",
          tone: "primary",
          weight: 1,
          onPress: () => {
            settledRef.current = false;
            setSorting(false);
          },
          testID: "dock-done",
        },
      ];
    }
    const keys: DockKey[] = [
      {
        id: "add",
        label: "Add",
        glyph: "plus",
        onPress: () => setAddOpen(true),
        testID: "dock-add",
        accessibilityLabel: "Add a game",
      },
    ];
    // Nothing to recap until there's a board to recap — the dock says so by
    // dropping the key rather than showing a dead one.
    if (!isEmpty) {
      keys.push({
        id: "recap",
        label: "Recap",
        glyph: "share",
        disabled: copyingScores,
        onPress: () => void onCopyScores(),
        testID: "games-copy-scores",
        accessibilityLabel: "Copy today's scores to clipboard",
      });
    }
    keys.push(
      {
        id: "players",
        label: "Players",
        glyph: "users",
        onPress: () => router.push(routes.friends as Href),
        testID: "dock-players",
      },
      {
        id: "you",
        label: "You",
        glyph: "user",
        weight: 0.9,
        notch: pendingRequests > 0,
        onPress: () => router.push("/you"),
        onLongPress: () => {
          haptics.selection();
          setQuickOpen(true);
        },
        testID: "profile-menu-trigger",
        accessibilityLabel: pendingRequests > 0 ? `You, ${pendingRequests} friend requests` : "You",
      },
    );
    return keys;
  }, [sorting, isEmpty, copyingScores, onCopyScores, pendingRequests, router, routes.friends]);
  useDock(dockKeys);

  const quickActions = useMemo<QuickAction[]>(
    () => [
      {
        id: "edit",
        label: "Edit profile",
        glyph: "pencil",
        onPress: () => router.push("/profile" as Href),
        testID: "open-edit-profile",
      },
      {
        id: "invite",
        label: "Invite a player",
        glyph: "link",
        onPress: () => inviteMutation.mutate(),
        testID: "quick-invite",
      },
    ],
    [router, inviteMutation],
  );

  const dayLabel = dayMarkerLabel(viewDate, todayKey);

  return (
    <Screen style={styles.root} testID="games-home">
      <View style={styles.header}>
        <Wordmark />
        {/* The marker reveals the scrubber, and the scrubber only exists when
            there is a board to re-date. */}
        {sorting || isEmpty ? (
          <Text variant="heading" tone="secondary" style={styles.dayMarkerLabel}>
            {sorting ? "Sorting" : ""}
          </Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Showing ${dayLabel}. Change day.`}
            onPress={toggleScrubber}
            testID="games-day-marker"
            hitSlop={8}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.dayMarker,
              !viewingToday && styles.dayMarkerPast,
              (pressed || hovered) && styles.dayMarkerActive,
            ]}
          >
            <Text
              variant="heading"
              tone={viewingToday ? "spotlight" : "secondary"}
              style={styles.dayMarkerLabel}
            >
              {dayLabel}
            </Text>
          </Pressable>
        )}
      </View>

      {gamesQuery.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.neon.pink} />
        </View>
      ) : gamesQuery.isError ? (
        <View style={styles.center}>
          <EmptyState
            title="Board offline"
            description={errorMessage(gamesQuery.error)}
            action={
              <Button label="Retry" variant="secondary" onPress={() => gamesQuery.refetch()} />
            }
          />
        </View>
      ) : isEmpty ? (
        <ScrollView contentContainerStyle={styles.emptyBody}>
          <GamesOnboarding
            friendsLoading={friendsQuery.isLoading}
            hasFriends={friends.length > 0}
            discovery={discovery}
            discoveryLoading={discoveryQuery.isLoading}
            invitePending={inviteMutation.isPending}
            inviteUrl={inviteUrl}
            onAddFriends={() => inviteMutation.mutate()}
            onCopyInvite={onCopyInvite}
            onAddDiscovery={(game) => addDiscoveryMutation.mutate(game)}
            addingGameIds={addingDiscoveryIds}
            addedGameIds={addedDiscoveryIds}
          />
        </ScrollView>
      ) : sorting ? (
        <SortList games={myGames} onReorder={onReorder} />
      ) : (
        <ScrollView
          ref={scrollRef}
          testID="games-home-list"
          scrollEventThrottle={16}
          onScroll={(e) => onScroll(e.nativeEvent.contentOffset.y)}
          onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}
          onContentSizeChange={(_w, h) => setContentHeight(h)}
          contentContainerStyle={[
            styles.listContent,
            // Guarantee the scrubber is always scrollable-to, even with two
            // games on the board.
            viewportHeight > 0 ? { minHeight: viewportHeight + scrubberHeight } : null,
          ]}
        >
          <View onLayout={(e) => setScrubberHeight(e.nativeEvent.layout.height)}>
            <DayScrubber selectedDate={viewDate} today={todayKey} onSelectDate={onSelectDate} />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reorder your board"
            onPress={() => setSorting(true)}
            onLongPress={() => setSorting(true)}
            delayLongPress={260}
            testID="games-sort-enter"
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.sectionHeader,
              (pressed || hovered) && styles.sectionHeaderActive,
            ]}
          >
            <Text variant="heading" tone="secondary" style={styles.sectionLabel}>
              {`${myGames.length} games`}
            </Text>
            <View style={styles.sortKey}>
              <Text variant="heading" tone="secondary" style={styles.sortLabel}>
                Sort
              </Text>
              <PixelIcon name="sliders" size={16} color={tokens.text.secondary} />
            </View>
          </Pressable>

          {myGames.map((mg) => (
            <GameRow
              key={mg.gameId}
              game={mg}
              standings={viewStandings.get(mg.gameId)}
              selfId={user?.id ?? null}
              viewingToday={viewingToday}
              loading={!viewingToday && viewQuery.isPending}
              onOpen={() => router.push(routes.game(mg.gameId) as Href)}
              onPlay={() => markPlaying({ id: mg.gameId, url: mg.game.url })}
              onPaste={() => openPasteFor({ id: mg.gameId, url: mg.game.url })}
              onReact={(userId, displayName) =>
                reactionCtl.openPicker(mg.gameId, userId, displayName)
              }
            />
          ))}
        </ScrollView>
      )}

      <QuickMenu visible={quickOpen} actions={quickActions} onClose={() => setQuickOpen(false)} />

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
        userName={user?.displayName ?? null}
        userAvatarUrl={user?.avatarUrl ?? null}
        pending={upsertMutation.isPending}
        spec={pasteTarget ? specForGame(pasteTarget) : null}
        canReteach={!!user?.isAdmin && pasteTarget != null && isGameReteachable(pasteTarget)}
        onTeach={(game, scoreRaw, taught) => upsertMutation.mutate({ game, scoreRaw, taught })}
        onSubmit={(game, scoreRaw) => upsertMutation.mutate({ game, scoreRaw })}
        onClose={dismiss}
      />

      <ReactionPickerSheet
        visible={!!reactionCtl.target}
        targetName={reactionCtl.target?.name ?? null}
        current={reactionCtl.currentEmoji}
        onPick={reactionCtl.pick}
        onRemove={reactionCtl.removeReaction}
        onClose={reactionCtl.closePicker}
      />

      {/* Per-game menu — reachable from sort mode; admins also re-teach here. */}
      <Sheet
        visible={!!menuGame}
        onRequestClose={() => setMenuGame(null)}
        onClosed={() => {
          if (reteachAfterMenu) {
            openPasteFor({ id: reteachAfterMenu.gameId, url: reteachAfterMenu.game.url });
            setReteachAfterMenu(null);
          }
        }}
        testID="game-menu-sheet"
      >
        {menuGame ? (
          <>
            <Text variant="heading" numberOfLines={1}>
              {menuGame.game.title}
            </Text>
            <View style={styles.sheetActions}>
              <Button
                testID="game-menu-open"
                variant="secondary"
                label="Open game"
                onPress={() => {
                  setMenuGame(null);
                  openExternalUrl(menuGame.game.url);
                }}
              />
              {user?.isAdmin && isGameReteachable(menuGame.game) ? (
                <Button
                  testID="game-menu-reteach"
                  variant="ghost"
                  label="Re-teach scoring"
                  onPress={() => {
                    setReteachAfterMenu(menuGame);
                    setMenuGame(null);
                  }}
                />
              ) : null}
              <Button
                testID="game-menu-remove"
                variant="danger"
                label="Remove from board"
                onPress={() => onRemove(menuGame)}
              />
            </View>
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.md,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.md,
  },
  dayMarker: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingLeft: tokens.space.md,
    paddingRight: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  dayMarkerPast: { borderColor: tokens.neon.pink },
  dayMarkerActive: { backgroundColor: tokens.bg.surface },
  dayMarkerLabel: { fontSize: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: tokens.space.lg },
  emptyBody: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: homeLayout.horizontalInset,
    paddingBottom: DOCK_HEIGHT + tokens.space.xl,
  },
  listContent: { paddingBottom: DOCK_HEIGHT + tokens.space.xl },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  sectionHeaderActive: { backgroundColor: tokens.bg.surface },
  sectionLabel: { fontSize: 10 },
  sortKey: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  sortLabel: { fontSize: 10 },
  sheetActions: { gap: tokens.space.sm },
});
