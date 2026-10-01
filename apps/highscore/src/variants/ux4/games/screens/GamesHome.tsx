// TODAY — the home surface, and the whole of UX-4's idea.
//
// One day's data, two readings. BY GAME is the per-game standings (a game per
// row, its players ranked left to right). BY PLAYER is the transpose: a player
// per row, one aligned column per game, so the day is a scoreboard you can read
// in either direction. The switch flips between them *in place* — no push, no
// back — and the rows restagger from the direction of travel.
//
// Everything that used to be chrome has been moved to where it's earned:
//   • the day rail → a two-chevron stepper in the header
//   • the copy-scores header icon → the recap block at the bottom of the page
//   • the + FAB → the last row of BY GAME, where new games actually land
//   • the per-card kebab → the game's peek (hold a row, or tap its cover)
//
// The play → return → paste loop, drag reorder, reactions, discovery and the
// friends-first onboarding all survive; they just live on surfaces that suit
// them.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import {
  createFriendInvite,
  fetchFriendRequests,
  fetchFriends,
} from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type {
  DiscoveryGame,
  Game,
  GameStandings,
  GamesResponse,
  MyGame,
} from "@workshop/shared/games";
import { haptics, neighborsForOrderedReorder } from "@workshop/ui";
import { type Href, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { DateStepper } from "../../components/DateStepper";
import { type Measurable, useFlight } from "../../components/Flight";
import { KeyPanel } from "../../components/KeyPanel";
import { usePeek } from "../../components/Peek";
import { type Projection, ProjectionSwitch } from "../../components/ProjectionSwitch";
import {
  Avatar,
  Button,
  EmptyState,
  layout,
  PixelIcon,
  Screen,
  Text,
  tokens,
  useToast,
} from "../../theme";
import {
  addGame,
  createGameShareLink,
  fetchGameDiscovery,
  fetchMyGames,
  moveGame,
  setGameScoreSpec,
  upsertGameScore,
} from "../api/games";
import { GameCover } from "../components/GameCover";
import { ReactionPickerSheet } from "../components/ReactionPickerSheet";
import { StandingsRows } from "../components/StandingsRows";
import { useReturnToPaste } from "../hooks/useReturnToPaste";
import { useScoreReactions } from "../hooks/useScoreReactions";
import { localDateKey } from "../lib/gameDate";
import { buildPlayerRows, gameStandingCells, type PlayerRow } from "../lib/matrix";
import { isGameReteachable, specForGame } from "../lib/scoreSpecs";
import { buildTodaysGameScoresSummary } from "../lib/scoresSummary";
import { copyToClipboard, shareOrCopyLink } from "../lib/share";
import { useGamesRuntime } from "../runtime";
import { GameScorePasteSheet, type TaughtScoreSpec } from "./GameScorePasteSheet";
import { AddGameSheet } from "./games/AddGameSheet";
import { GamesOnboarding } from "./games/GamesOnboarding";
import { ByGameList } from "./home/ByGameList";
import { ByPlayer } from "./home/ByPlayer";
import type { GameReorderEvent } from "./home/byGameListProps";
import { GameRow } from "./home/GameRow";
import { PlayerDay } from "./home/PlayerDay";
import { RecapCard } from "./home/RecapCard";
import { Stagger } from "./home/Stagger";
import { YourTurn } from "./home/YourTurn";

const EMPTY_STANDINGS: GameStandings = {
  periodKey: "",
  entries: [],
  viewerHasPlayed: false,
  viewerStreak: 0,
};

export function GamesHome() {
  const { token, user, routes } = useGamesRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { openPeek } = usePeek();
  const { fly } = useFlight();
  const livePoll = useLivePollingInterval();

  const todayKey = localDateKey();
  const gamesKey = queryKeys.games.mine(todayKey);
  const selfId = user?.id ?? null;

  const [viewDate, setViewDate] = useState(todayKey);
  const [projection, setProjection] = useState<Projection>("game");
  const viewingToday = viewDate === todayKey;

  const [addOpen, setAddOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [scoreShareUrl, setScoreShareUrl] = useState<string | null>(null);
  const [copyingScores, setCopyingScores] = useState(false);
  const [addingDiscoveryIds, setAddingDiscoveryIds] = useState<string[]>([]);
  const [addedDiscoveryIds, setAddedDiscoveryIds] = useState<string[]>([]);

  // My Games, its order and my streaks are always today's; only the standings
  // follow the stepper.
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
  const dayGames = useMemo(() => {
    const byId = new Map<string, GameStandings>();
    for (const g of viewQuery.data?.games ?? []) byId.set(g.gameId, g.standings);
    return myGames.map((mg) => ({ ...mg, standings: byId.get(mg.gameId) ?? EMPTY_STANDINGS }));
  }, [myGames, viewQuery.data]);
  const dayLoading = !viewingToday && viewQuery.isPending;

  const friendsQuery = useQuery({
    queryKey: queryKeys.friends.all,
    queryFn: () => fetchFriends(token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const friends = useMemo(() => friendsQuery.data?.friends ?? [], [friendsQuery.data]);

  const requestsQuery = useQuery({
    queryKey: queryKeys.friends.requests,
    queryFn: () => fetchFriendRequests(token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const inbound = requestsQuery.data?.inbound ?? [];

  const discoveryQuery = useQuery({
    queryKey: queryKeys.games.discovery(),
    queryFn: () => fetchGameDiscovery(token, { includeOwned: true }),
    enabled: !!token && (addOpen || isEmpty),
    refetchInterval: livePoll,
  });
  const discovery = discoveryQuery.data?.games ?? [];

  const playerRows = useMemo(
    () =>
      buildPlayerRows({
        games: dayGames,
        friends,
        selfId,
        selfName: user?.displayName ?? null,
      }),
    [dayGames, friends, selfId, user?.displayName],
  );

  const gameIcons = useMemo(
    () => new Map(myGames.map((mg) => [mg.gameId, mg.game.iconUrl])),
    [myGames],
  );

  // Reactions target the displayed day's cache (equal to `gamesKey` on today).
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
    onMutate: (game) => setAddingDiscoveryIds((ids) => [...ids, game.game.id]),
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
      if (result === "copied") showToast({ message: "Invite link copied", tone: "success" });
      else if (result === "failed") {
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
        queryClient.invalidateQueries({ queryKey: queryKeys.games.leaderboard(game.id, todayKey) }),
      ]);
      showToast({ message: "Score posted", tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't save score"), tone: "danger" });
    },
  });

  const recapPreview = useMemo(
    () => buildTodaysGameScoresSummary({ shareUrl: "", games: myGames, selfId, dateKey: todayKey }),
    [myGames, selfId, todayKey],
  );

  const onCopyScores = async () => {
    if (!recapPreview) return;
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
        message: ok ? "Today's scores copied" : "Couldn't copy to clipboard",
        tone: ok ? "success" : "danger",
      });
    } catch (e) {
      showToast({ message: errorMessage(e, "Couldn't create a share link."), tone: "danger" });
    } finally {
      setCopyingScores(false);
    }
  };

  const onReorder = ({ fromIndex, toIndex }: GameReorderEvent) => {
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

  // Navigation. The tapped identity block flies into the destination's header
  // (see components/Flight.tsx); when there's nothing to measure, it's a
  // plain push.
  const openBoard = useCallback(
    (mg: MyGame, source: Measurable | null) => {
      fly({
        source,
        node: <GameCover iconUrl={mg.game.iconUrl} size={44} />,
        navigate: () => router.push(routes.game(mg.gameId) as Href),
      });
    },
    [fly, router, routes],
  );

  const openPlayer = useCallback(
    (userId: string, displayName: string | null, source: Measurable | null) => {
      fly({
        source,
        node: <Avatar name={displayName} imageUrl={userAvatarImageUrl(userId)} size="lg" />,
        navigate: () => router.push(routes.friendProfile(userId) as Href),
      });
    },
    [fly, router, routes],
  );

  // A peek is a glance, not a second copy of the board: top five, no controls.
  // Everything you can *do* to a game lives on the board (open, re-teach,
  // remove, react) so the two surfaces aren't the same screen twice.
  const peekGame = useCallback(
    (mg: MyGame) => {
      const cells = gameStandingCells(dayGames.find((g) => g.gameId === mg.gameId) ?? mg, selfId);
      openPeek({
        title: mg.game.title,
        subtitle:
          cells.length === 0
            ? viewingToday
              ? "Nobody's played yet"
              : "Nobody played"
            : `${cells.length} played`,
        content: <StandingsRows cells={cells} limit={5} testIDPrefix="peek" />,
        commitLabel: "Board",
        onCommit: () => router.push(routes.game(mg.gameId) as Href),
      });
    },
    [dayGames, selfId, viewingToday, openPeek, router, routes],
  );

  const peekPlayer = useCallback(
    (row: PlayerRow) => {
      const name = row.isSelf ? "You" : row.displayName?.trim() || "Someone";
      openPeek({
        title: name,
        subtitle: playerSummary(row, viewingToday),
        content: (
          <PlayerDay cells={row.cells} icons={gameIcons} viewingToday={viewingToday} playedOnly />
        ),
        commitLabel: "Profile",
        onCommit: () => router.push(routes.friendProfile(row.userId) as Href),
      });
    },
    [gameIcons, openPeek, router, routes, viewingToday],
  );

  const recapFooter = recapPreview ? (
    <View style={styles.footerBlock}>
      <RecapCard preview={recapPreview} copying={copyingScores} onCopy={onCopyScores} />
    </View>
  ) : null;

  const byGameFooter = (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a game"
        onPress={() => setAddOpen(true)}
        testID="add-game-row"
        style={({ pressed }) => [styles.addRow, pressed && styles.addRowPressed]}
      >
        <PixelIcon name="plus" size={24} color={tokens.neon.pink} />
        <Text variant="heading" style={styles.addLabel}>
          Add a game
        </Text>
      </Pressable>
      {recapFooter}
    </>
  );

  return (
    <Screen style={styles.root} testID="games-home">
      <View style={styles.header}>
        <DateStepper date={viewDate} today={todayKey} onChange={setViewDate} />
        {!isEmpty ? <ProjectionSwitch value={projection} onChange={setProjection} /> : null}
      </View>

      <View style={styles.body}>
        {gamesQuery.isPending ? (
          // The frame plus skeleton rows, not a spinner in a void: the shape of
          // the board is known before the data is, and on a slow connection a
          // centred spinner is the whole first impression.
          <View style={styles.skeletonList}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={styles.skeletonRow}>
                <View style={styles.skeletonCover} />
                <View style={styles.skeletonTitle} />
              </View>
            ))}
          </View>
        ) : gamesQuery.isError ? (
          <View style={styles.center}>
            <EmptyState
              title="Can't load your games"
              description={errorMessage(gamesQuery.error)}
              action={
                <Button label="Retry" variant="secondary" onPress={() => gamesQuery.refetch()} />
              }
            />
          </View>
        ) : isEmpty ? (
          <GamesOnboarding
            friendsLoading={friendsQuery.isLoading}
            hasFriends={friends.length > 0}
            discovery={discovery}
            discoveryLoading={discoveryQuery.isLoading}
            invitePending={inviteMutation.isPending}
            inviteUrl={inviteUrl}
            onAddFriends={() => inviteMutation.mutate()}
            onCopyInvite={async () => {
              if (!inviteUrl) return;
              const result = await shareOrCopyLink(inviteUrl);
              if (result === "copied") {
                showToast({ message: "Invite link copied", tone: "success" });
              }
            }}
            onAddByUrl={() => setAddOpen(true)}
            onAddDiscovery={(game) => addDiscoveryMutation.mutate(game)}
            addingGameIds={addingDiscoveryIds}
            addedGameIds={addedDiscoveryIds}
          />
        ) : projection === "game" ? (
          <ByGameList
            key="by-game"
            games={dayGames}
            onReorder={onReorder}
            footer={byGameFooter}
            refreshing={gamesQuery.isRefetching && !gamesQuery.isPending}
            onRefresh={() => gamesQuery.refetch()}
            renderRow={(mg, index, isDragging, onLongPressBody) => (
              <Stagger index={index} direction={-1}>
                <GameRow
                  game={mg}
                  cells={gameStandingCells(mg, selfId)}
                  streak={myGames.find((g) => g.gameId === mg.gameId)?.standings.viewerStreak ?? 0}
                  viewingToday={viewingToday}
                  viewerHasPlayed={
                    myGames.find((g) => g.gameId === mg.gameId)?.standings.viewerHasPlayed ?? false
                  }
                  viewerName={user?.displayName ?? null}
                  viewerId={selfId}
                  loading={dayLoading}
                  isDragging={isDragging}
                  onOpenBoard={(source) => openBoard(mg, source)}
                  onPeek={() => peekGame(mg)}
                  onPlay={() => markPlaying({ id: mg.gameId, url: mg.game.url })}
                  onPaste={() => openPasteFor({ id: mg.gameId, url: mg.game.url })}
                  onPressPlayer={(userId) =>
                    openPlayer(
                      userId,
                      mg.standings.entries.find((e) => e.userId === userId)?.displayName ?? null,
                      null,
                    )
                  }
                  {...(onLongPressBody ? { onLongPressBody } : {})}
                />
              </Stagger>
            )}
          />
        ) : (
          <ScrollView key="by-player" contentContainerStyle={styles.playerScroll}>
            {inbound.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${inbound.length} friend requests waiting`}
                onPress={() => router.navigate("/friends" as Href)}
                testID="requests-block"
                style={({ pressed }) => [styles.requests, pressed && styles.requestsPressed]}
              >
                <PixelIcon name="user-plus" size={16} color={tokens.neon.yellow} />
                <Text variant="label" style={styles.requestsLabel}>
                  {inbound.length === 1
                    ? `${inbound[0]?.displayName?.trim() || "Someone"} wants to play with you`
                    : `${inbound.length} people want to play with you`}
                </Text>
                <PixelIcon name="chevron-right" size={16} color={tokens.text.secondary} />
              </Pressable>
            ) : null}
            <ByPlayer
              rows={playerRows}
              games={dayGames}
              viewingToday={viewingToday}
              onOpenPlayer={(userId, source) =>
                openPlayer(
                  userId,
                  playerRows.find((r) => r.userId === userId)?.displayName ?? null,
                  source,
                )
              }
              onPeekPlayer={peekPlayer}
              onOpenGame={(gameId, source) => {
                const mg = dayGames.find((g) => g.gameId === gameId);
                if (mg) openBoard(mg, source);
              }}
              onPeekGame={(gameId) => {
                const mg = dayGames.find((g) => g.gameId === gameId);
                if (mg) peekGame(mg);
              }}
            />
            {viewingToday ? (
              <YourTurn
                games={myGames.filter((mg) => !mg.standings.viewerHasPlayed)}
                onPlay={(mg) => markPlaying({ id: mg.gameId, url: mg.game.url })}
              />
            ) : null}
            {friends.length === 0 ? (
              <View style={styles.noFriends}>
                <Text variant="caption" tone="secondary">
                  It's just you so far. Invite someone and their day lands in this grid.
                </Text>
                <Button
                  label="Invite a player"
                  pixel
                  size="sm"
                  onPress={() => inviteMutation.mutate()}
                  loading={inviteMutation.isPending}
                  testID="matrix-invite"
                />
              </View>
            ) : null}
            {recapFooter}
          </ScrollView>
        )}
      </View>

      <KeyPanel active="today" pending={inbound.length} />

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
    </Screen>
  );
}

function playerSummary(row: PlayerRow, viewingToday: boolean): string {
  if (row.playedCount === 0) return viewingToday ? "Nothing posted yet" : "Didn't play";
  const played = `${row.playedCount} of ${row.cells.length} played`;
  if (row.firsts === 0) return played;
  return `${played} · ${row.firsts === 1 ? "1 first place" : `${row.firsts} first places`}`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.inset,
    paddingTop: tokens.space.xs,
    paddingBottom: tokens.space.sm,
  },
  body: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: tokens.space.lg },
  skeletonList: { paddingHorizontal: layout.inset },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    height: 84,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  skeletonCover: { width: 32, height: 32, backgroundColor: tokens.bg.surface },
  skeletonTitle: { width: 120, height: 13, backgroundColor: tokens.bg.surface },
  playerScroll: {
    paddingHorizontal: layout.inset,
    paddingBottom: tokens.space.xl,
    gap: tokens.space.md,
  },
  requests: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 44,
    paddingHorizontal: tokens.space.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.yellow,
  },
  requestsPressed: { backgroundColor: tokens.bg.surface },
  requestsLabel: { flex: 1, minWidth: 0, color: tokens.text.primary },
  noFriends: { gap: tokens.space.sm, alignItems: "flex-start", paddingTop: tokens.space.sm },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 56,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  addRowPressed: { backgroundColor: tokens.bg.surface },
  addLabel: { color: tokens.neon.pinkTint },
  footerBlock: { paddingTop: tokens.space.md },
});
