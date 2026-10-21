// Home — the scoreboard. One day (the shared `viewDay`), every game in My
// Games as a compact card: podium, your placing, turnout. See
// apps/highscore/UX-EXPLORATION.md for the model; this file owns the data and
// mutations, `GameScoreCard` owns the pixels.
//
// Writes: a card's PASTE opens the paste sheet for that game (today only);
// the bottom PASTE SCORE button goes to the share flow, which recognises the
// game from the text. Play→paste still works through `useReturnToPaste`.
// Posting to a past day lives on the box score.
//
// Empty state is the friends-first onboarding (`GamesOnboarding`).

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
import { confirm, haptics, openExternalUrl, useToast } from "@workshop/ui";
import { type Href, useRouter } from "expo-router";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ReportSheet } from "../../moderation/ReportSheet";
import { useScoreReportFlow } from "../../moderation/useScoreReportFlow";
import { Button, IconButton, PixelIcon, Screen, Sheet, Text, tokens } from "../../theme";
import {
  addGame,
  fetchGameDiscovery,
  fetchMyGames,
  moveGame,
  removeGame,
  setGameScoreSpec,
  upsertGameScore,
} from "../api/games";
import { setScoreDirection } from "../api/teach";
import { DateBar } from "../components/DateBar";
import { DayPickerSheet } from "../components/DayPickerSheet";
import { FixScoreSheet, type FixScoreTarget } from "../components/FixScoreSheet";
import { GameScoreCard } from "../components/GameScoreCard";
import { ReactionPickerSheet } from "../components/ReactionPickerSheet";
import { useDayRange } from "../hooks/useDayRange";
import { useOpenProfile } from "../hooks/useOpenProfile";
import { useReturnToPaste } from "../hooks/useReturnToPaste";
import { useScoreReactions } from "../hooks/useScoreReactions";
import { askScoreDirection } from "../lib/askScoreDirection";
import { localDateKey } from "../lib/gameDate";
import { neighborsForOrderedReorder } from "../lib/reorder";
import { isGameReteachable, specForGame } from "../lib/scoreSpecs";
import { shareOrCopyLink } from "../lib/share";
import { teachAfterPost, teachOutcomeMessage } from "../lib/teachAfterPost";
import { type ScorePostExtras, useTeachAvailable } from "../lib/useScoreCheck";
import { useGamesRuntime } from "../runtime";
import { useViewDay } from "../state/viewDay";
import { GameScorePasteSheet, type TaughtScoreSpec } from "./GameScorePasteSheet";
import { AddGameSheet } from "./games/AddGameSheet";
import { GameCardList } from "./games/GameCardList";
import { GamesOnboarding } from "./games/GamesOnboarding";
import type { GameReorderEvent } from "./games/gameCardListProps";

export interface GamesHomeProps {
  headerLeft?: ReactNode;
  headerTrailing?: ReactNode;
}

export function GamesHome({ headerLeft = null, headerTrailing = null }: GamesHomeProps) {
  const { token, user, routes } = useGamesRuntime();
  const router = useRouter();
  const openProfile = useOpenProfile();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();
  const insets = useSafeAreaInsets();

  const todayKey = localDateKey();
  const gamesKey = queryKeys.games.mine(todayKey);
  const { viewDate, setViewDate } = useViewDay();
  const viewingToday = viewDate === todayKey;

  const [addOpen, setAddOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuGame, setMenuGame] = useState<MyGame | null>(null);
  const teachAvailable = useTeachAvailable();
  const [fixTarget, setFixTarget] = useState<FixScoreTarget | null>(null);
  const [reteachAfterMenu, setReteachAfterMenu] = useState<MyGame | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [addingDiscoveryIds, setAddingDiscoveryIds] = useState<string[]>([]);
  const [addedDiscoveryIds, setAddedDiscoveryIds] = useState<string[]>([]);

  // Today's My Games is canonical: which games, in what order, streaks.
  const gamesQuery = useQuery({
    queryKey: gamesKey,
    queryFn: () => fetchMyGames(todayKey, token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const myGames = gamesQuery.data?.games ?? [];
  const isEmpty = !gamesQuery.isPending && !gamesQuery.isError && myGames.length === 0;

  // Standings for the viewed day. Same key as `gamesKey` on today.
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
  // Warm the last week so stepping back is instant (and the box score's
  // strip is already there).
  useDayRange(todayKey);

  // Friend requests badge on the header's friends button.
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
  const reportFlow = useScoreReportFlow(reactionCtl.closePicker);

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
  // A game no friend plays: discovery tags owned games with the friends who
  // play them; owned + zero friends = solo. Only known while the feed is loaded.
  const soloGameIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of discovery) if (d.inMyGames && d.friends.length === 0) ids.add(d.game.id);
    return ids;
  }, [discovery]);

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
      extras,
    }: {
      game: Pick<Game, "id" | "title">;
      scoreRaw: string;
      taught?: TaughtScoreSpec;
      extras?: ScorePostExtras;
    }) => {
      if (taught) await setGameScoreSpec(game.id, taught, token);
      return upsertGameScore(
        game.id,
        { periodKey: todayKey, scoreRaw, entrySource: "paste", ...extras?.body },
        token,
      );
    },
    onSuccess: async (data, { game, extras }) => {
      haptics.medium();
      dismiss();
      const refresh = () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: gamesKey }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.games.leaderboard(game.id, todayKey),
          }),
        ]);
      await refresh();
      showToast({ message: "Score posted", tone: "success" });
      const taught = await teachAfterPost({
        gameId: game.id,
        periodKey: todayKey,
        hint: data.teach,
        scoreDirection: extras?.scoreDirection ?? null,
        askDirection: askScoreDirection(game.title),
        token,
      });
      if (taught) {
        await Promise.all([
          refresh(),
          queryClient.invalidateQueries({ queryKey: ["game-score-check"] }),
        ]);
      }
      const message = teachOutcomeMessage(taught, game.title);
      if (message) showToast({ message, tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't save score"), tone: "danger" });
    },
  });

  const directionMutation = useMutation({
    mutationFn: ({ game, to }: { game: Game; to: "asc" | "desc" }) =>
      setScoreDirection(game.id, to, token),
    onSuccess: async (data, { game }) => {
      setMenuGame(null);
      if (data.applied) await queryClient.invalidateQueries({ queryKey: ["games"] });
      showToast({
        message: data.applied
          ? `${game.title} now ranks ${data.game.scoreDirection === "asc" ? "lower" : "higher"} scores first.`
          : "Noted. It changes when one more player asks for the same.",
        tone: "success",
      });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't change the ranking"), tone: "danger" });
    },
  });

  const onReorder = ({ fromIndex, toIndex }: GameReorderEvent) => {
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
  };

  const onRemove = async (mg: MyGame) => {
    setMenuGame(null);
    const ok = await confirm({
      title: `Remove ${mg.game.title} from My Games?`,
      message: "Your past scores stay — re-adding the game brings them back.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) removeMutation.mutate(mg.gameId);
  };

  const renderCard = useCallback(
    (mg: MyGame, isDragging: boolean, onLongPressBody?: () => void) => {
      const standings = viewStandings.get(mg.gameId);
      return (
        <GameScoreCard
          key={mg.gameId}
          gameId={mg.gameId}
          title={mg.game.title}
          iconUrl={mg.game.iconUrl}
          entries={standings?.entries ?? []}
          selfId={user?.id ?? null}
          streak={mg.standings.viewerStreak}
          isToday={viewingToday}
          loading={!viewingToday && viewQuery.isPending}
          isDragging={isDragging}
          soloGame={soloGameIds.has(mg.gameId)}
          onPress={() => router.push(routes.game(mg.gameId, viewDate) as Href)}
          onPressPlayer={openProfile}
          onPaste={() => openPasteFor({ id: mg.gameId, url: mg.game.url })}
          onMenu={() => setMenuGame(mg)}
          {...(onLongPressBody ? { onLongPressBody } : {})}
        />
      );
    },
    [
      user?.id,
      router,
      openPasteFor,
      viewStandings,
      viewDate,
      viewingToday,
      viewQuery.isPending,
      routes.game,
      openProfile,
      soloGameIds,
    ],
  );

  return (
    <Screen style={styles.root} testID="games-home">
      <View style={styles.header}>
        <View style={styles.headerLeft}>{headerLeft}</View>
        <View style={styles.headerRight}>
          <IconButton
            accessibilityLabel={
              pendingRequests > 0 ? `Friends, ${pendingRequests} requests` : "Friends"
            }
            onPress={() => router.push(routes.friends as Href)}
            testID="games-friends"
          >
            <PixelIcon name="users" color={tokens.text.primary} />
            {pendingRequests > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{pendingRequests > 9 ? "9+" : pendingRequests}</Text>
              </View>
            ) : null}
          </IconButton>
          {headerTrailing}
        </View>
      </View>

      {isEmpty ? null : (
        <DateBar
          date={viewDate}
          today={todayKey}
          onChange={setViewDate}
          onOpenPicker={() => setPickerOpen(true)}
          testIDPrefix="home-date"
        />
      )}

      <View style={styles.body}>
        {gamesQuery.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator color={tokens.neon.pink} />
          </View>
        ) : gamesQuery.isError ? (
          <View style={styles.center}>
            <Text variant="heading">COULDN'T LOAD</Text>
            <Text tone="secondary" style={styles.centerText}>
              {errorMessage(gamesQuery.error)}
            </Text>
            <Button label="Retry" variant="secondary" onPress={() => gamesQuery.refetch()} />
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
            onCopyInvite={onCopyInvite}
            onAddByUrl={() => setAddOpen(true)}
            onAddDiscovery={(game) => addDiscoveryMutation.mutate(game)}
            addingGameIds={addingDiscoveryIds}
            addedGameIds={addedDiscoveryIds}
          />
        ) : (
          <GameCardList
            games={myGames}
            renderCard={renderCard}
            onReorder={onReorder}
            refreshing={gamesQuery.isRefetching && !gamesQuery.isPending}
            onRefresh={() => gamesQuery.refetch()}
          />
        )}
      </View>

      {/* The only two writes, always reachable, one-handed. */}
      {isEmpty ? null : (
        <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, tokens.space.md) }]}>
          <Button
            label="+ GAME"
            variant="secondary"
            onPress={() => setAddOpen(true)}
            testID="fab-add-game"
            style={styles.actionSecondary}
          />
          <Button
            label="PASTE SCORE"
            onPress={() => router.push("/share" as Href)}
            testID="home-paste-score"
            style={styles.actionPrimary}
          />
        </View>
      )}

      <DayPickerSheet
        visible={pickerOpen}
        selected={viewDate}
        today={todayKey}
        onSelect={setViewDate}
        onClose={() => setPickerOpen(false)}
      />

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
        {...(pasteTarget && (!pasteTarget.hasParser || user?.isAdmin)
          ? {
              onTeach: (game: Game, scoreRaw: string, taught: TaughtScoreSpec) =>
                upsertMutation.mutate({ game, scoreRaw, taught }),
            }
          : {})}
        periodKey={todayKey}
        onSubmit={(game, scoreRaw, extras) =>
          upsertMutation.mutate({ game, scoreRaw, ...(extras ? { extras } : {}) })
        }
        onPostToOther={(other, scoreRaw) => {
          upsertMutation.mutate({
            game: other,
            scoreRaw,
            ...(pasteTarget
              ? {
                  extras: {
                    body: { wrongGame: { gameId: pasteTarget.id, choice: "there" } },
                    scoreDirection: null,
                  },
                }
              : {}),
          });
        }}
        onClose={dismiss}
      />

      <ReactionPickerSheet
        visible={!!reactionCtl.target}
        targetName={reactionCtl.target?.name ?? null}
        current={reactionCtl.currentEmoji}
        onPick={reactionCtl.pick}
        onRemove={reactionCtl.removeReaction}
        onClose={reactionCtl.closePicker}
        onClosed={reportFlow.onPickerClosed}
        onReport={() => {
          const t = reactionCtl.target;
          if (!t) return;
          reportFlow.requestReport({
            userId: t.scoreUserId,
            name: t.name,
            kind: "score",
            gameId: t.gameId,
            periodKey: viewDate,
          });
        }}
      />
      <ReportSheet target={reportFlow.target} token={token} onClose={reportFlow.close} />
      <FixScoreSheet target={fixTarget} today={todayKey} onClose={() => setFixTarget(null)} />

      {/* Card menu — Open game / Play / (admin) Re-teach / direction / Remove. */}
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
                label="Play now"
                onPress={() => {
                  setMenuGame(null);
                  markPlaying({ id: menuGame.gameId, url: menuGame.game.url });
                }}
              />
              <Button
                testID="game-menu-open-link"
                variant="secondary"
                label="Open game site"
                onPress={() => {
                  setMenuGame(null);
                  openExternalUrl(menuGame.game.url);
                }}
              />
              {user?.isAdmin && !teachAvailable && isGameReteachable(menuGame.game) ? (
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
              {teachAvailable ? (
                <>
                  <Text variant="caption" tone="secondary" testID="game-menu-direction-current">
                    {menuGame.game.scoreDirection === "asc"
                      ? "Ranking: lower is better."
                      : "Ranking: higher is better."}
                  </Text>
                  <Button
                    testID="game-menu-direction"
                    variant="ghost"
                    label={
                      menuGame.game.scoreDirection === "asc"
                        ? "Change to higher is better"
                        : "Change to lower is better"
                    }
                    loading={directionMutation.isPending}
                    onPress={() =>
                      directionMutation.mutate({
                        game: menuGame.game,
                        to: menuGame.game.scoreDirection === "asc" ? "desc" : "asc",
                      })
                    }
                  />
                </>
              ) : null}
              {teachAvailable && menuGame.standings.viewerHasPlayed ? (
                <Button
                  testID="game-menu-fix"
                  variant="ghost"
                  label="Fix today's score"
                  onPress={() => {
                    const mine = menuGame.standings.entries.find((e) => e.userId === user?.id);
                    setMenuGame(null);
                    if (mine) {
                      setFixTarget({
                        gameId: menuGame.gameId,
                        gameTitle: menuGame.game.title,
                        periodKey: todayKey,
                        scoreRaw: mine.scoreRaw ?? "",
                      });
                    }
                  }}
                />
              ) : null}
              <Button
                testID="game-menu-remove"
                variant="danger"
                label="Remove from My Games"
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
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: tokens.space.lg,
    paddingRight: tokens.space.sm,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.xs,
  },
  headerLeft: { flex: 1, minWidth: 0 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  badge: {
    position: "absolute",
    top: 4,
    right: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    backgroundColor: tokens.neon.pink,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontFamily: tokens.font.pixel,
    fontSize: 8,
    lineHeight: 12,
    color: tokens.text.onAccent,
  },
  body: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.md,
    padding: tokens.space.xl,
  },
  centerText: { textAlign: "center" },
  actions: {
    flexDirection: "row",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.sm,
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
    backgroundColor: tokens.bg.canvas,
  },
  actionSecondary: { flex: 1 },
  actionPrimary: { flex: 2 },
  sheetActions: { gap: tokens.space.sm },
});
