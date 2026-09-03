// HighScore's one surface.
//
// There is no stack in the main loop. `/`, `/games/:id`, `/friends` and
// `/friends/:userId` are all this component: the ledger of your games, a game
// expanded in place, and the friends drawer sliding over the top. The router
// still owns the URL (deep links, refresh, browser/system back all behave) —
// it just isn't allowed to draw a new screen for any of it.

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { fetchFriendRequests, fetchFriends } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type { DiscoveryGame, Game, GamesResponse, MyGame } from "@workshop/shared/games";
import { confirm, haptics, openExternalUrl } from "@workshop/ui";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import {
  addGame,
  clearGameScore,
  createGameShareLink,
  fetchGameDiscovery,
  fetchMyGames,
  moveGame,
  removeGame,
  setGameScoreSpec,
  upsertGameScore,
} from "../games/api/games";
import { ReactionPickerSheet } from "../games/components/ReactionPickerSheet";
import { useReturnToPaste } from "../games/hooks/useReturnToPaste";
import { useScoreReactions } from "../games/hooks/useScoreReactions";
import { localDateKey, shiftDateKey } from "../games/lib/gameDate";
import { neighborsForOrderedReorder } from "../games/lib/reorder";
import { isGameReteachable, specForGame } from "../games/lib/scoreSpecs";
import { buildTodaysGameScoresSummary, summarizeGameScoreBody } from "../games/lib/scoresSummary";
import { copyToClipboard } from "../games/lib/share";
import { useGamesRuntime } from "../games/runtime";
import { GameScorePasteSheet, type TaughtScoreSpec } from "../games/screens/GameScorePasteSheet";
import { AddGameSheet } from "../games/screens/games/AddGameSheet";
import { GamesOnboarding } from "../games/screens/games/GamesOnboarding";
import {
  actionType,
  Button,
  EmptyState,
  homeLayout,
  PixelIcon,
  pixelType,
  Screen,
  tokens,
  useToast,
} from "../theme";
import { Text } from "../theme/Text";
import { DayTape } from "./DayTape";
import { FriendPanel } from "./FriendPanel";
import { FriendsDrawer } from "./FriendsDrawer";
import { FriendsPanel } from "./FriendsPanel";
import { GameBoardPanel, type HistoryCell } from "./GameBoardPanel";
import { LedgerList } from "./LedgerList";
import { type LedgerFace, LedgerRow, ledgerMetrics } from "./LedgerRow";
import { ProfileSheet } from "./ProfileSheet";
import { railScore } from "./railScore";
import { ShellHeader } from "./ShellHeader";
import { useShellNavigation } from "./useShellNavigation";

const HISTORY_DAYS = 7;
/** Per-row squeeze offset, growing with distance from the row you tapped. */
const STAGGER_MS = 28;
const STAGGER_MAX = 84;

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function shortDayLabel(key: string, today: string): string {
  if (key === today) return "TODAY";
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
}

export function Shell() {
  const { token, user } = useGamesRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();
  const nav = useShellNavigation();

  const todayKey = localDateKey();
  const gamesKey = queryKeys.games.mine(todayKey);

  // The tape re-dates what every row *shows*; scores only ever post to today,
  // so the play→paste loop below stays pinned to `todayKey`.
  const [viewDate, setViewDate] = useState(todayKey);
  const viewingToday = viewDate === todayKey;

  const [addOpen, setAddOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [scoreShareUrl, setScoreShareUrl] = useState<string | null>(null);
  const [copyingScores, setCopyingScores] = useState(false);
  // Set for ~1.2s after a post so the row's rail value blinks — posting a
  // score is the whole point of the app and used to end in a silent dismiss.
  const [celebrateGameId, setCelebrateGameId] = useState<string | null>(null);
  const [addingDiscoveryIds, setAddingDiscoveryIds] = useState<string[]>([]);
  const [addedDiscoveryIds, setAddedDiscoveryIds] = useState<string[]>([]);

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

  const expandedId = nav.expandedGameId;

  // Per-day history for the open board. Keyed on the same `games.mine(day)`
  // queries the tape uses, so scrubbing back through the week costs nothing
  // extra once these are warm.
  const historyDays = useMemo(
    () => Array.from({ length: HISTORY_DAYS }, (_, i) => shiftDateKey(todayKey, -i)),
    [todayKey],
  );
  const historyQueries = useQueries({
    queries: historyDays.map((day) => ({
      queryKey: queryKeys.games.mine(day),
      queryFn: () => fetchMyGames(day, token),
      enabled: !!token && !!expandedId,
    })),
  });
  // Cheap enough (seven cells) to derive every render — memoising it would
  // only add a dependency list over query objects that change identity anyway.
  const history: HistoryCell[] = !expandedId
    ? []
    : historyDays.map((day, i) => {
        const q = historyQueries[i];
        const game = q?.data?.games.find((g) => g.gameId === expandedId);
        const mine = game?.standings.entries.find((e) => e.userId === user?.id);
        return {
          dateKey: day,
          label: shortDayLabel(day, todayKey),
          body: game && mine ? summarizeGameScoreBody(game.game, mine) : null,
          loading: q?.isPending ?? false,
        };
      });

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
  const pendingRequests = requestsQuery.data?.inbound.length ?? 0;

  // One line of competitive signal per friend row: what they've done today,
  // read off the standings the ledger already has. A friends list that is
  // only names has nothing to do with this app.
  const friendSignals = useMemo(() => {
    const map = new Map<string, { played: number; leads: number }>();
    for (const g of gamesQuery.data?.games ?? []) {
      for (const e of g.standings.entries) {
        if (!e.scoreRaw) continue;
        const cur = map.get(e.userId) ?? { played: 0, leads: 0 };
        cur.played += 1;
        if (e.rank === 1) cur.leads += 1;
        map.set(e.userId, cur);
      }
    }
    return map;
  }, [gamesQuery.data]);

  // My compact result per game today, so a friend's profile can read as a
  // head-to-head instead of a list of their scores.
  const myScoresByGame = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const g of gamesQuery.data?.games ?? []) {
      const mine = g.standings.entries.find((e) => e.userId === user?.id && e.scoreRaw);
      map.set(g.gameId, mine ? railScore(g.game, mine) : null);
    }
    return map;
  }, [gamesQuery.data, user?.id]);

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
      await queryClient.invalidateQueries({ queryKey: ["games"] });
      showToast({ message: `Added ${data.game.title}`, tone: "success" });
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't add that game."), tone: "danger" }),
  });

  const addDiscoveryMutation = useMutation({
    mutationFn: (game: DiscoveryGame) => addGame(game.game.url, token),
    onMutate: (game) => setAddingDiscoveryIds((ids) => [...ids, game.game.id]),
    onSuccess: async (_data, game) => {
      haptics.medium();
      setAddedDiscoveryIds((ids) => (ids.includes(game.game.id) ? ids : [...ids, game.game.id]));
      await queryClient.invalidateQueries({ queryKey: ["games"] });
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't add that game."), tone: "danger" }),
    onSettled: (_d, _e, game) =>
      setAddingDiscoveryIds((ids) => ids.filter((id) => id !== game.game.id)),
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
    onSettled: () => queryClient.invalidateQueries({ queryKey: gamesKey }),
  });

  const removeMutation = useMutation({
    mutationFn: (gameId: string) => removeGame(gameId, token),
    onSuccess: async () => {
      haptics.medium();
      await queryClient.invalidateQueries({ queryKey: ["games"] });
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't remove that game."), tone: "danger" }),
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
      setDraft("");
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["games"] });
      // Say where the result landed, not just that it landed. The rank comes
      // from the freshly-invalidated standings, so it is the real one.
      const fresh = queryClient
        .getQueryData<GamesResponse>(gamesKey)
        ?.games.find((g) => g.gameId === game.id);
      const played = fresh?.standings.entries.filter((e) => e.scoreRaw) ?? [];
      const mine = played.find((e) => e.userId === user?.id);
      const message =
        mine?.rank === 1 && played.length > 1
          ? `You lead ${game.title} today`
          : mine?.rank && played.length > 1
            ? `Posted — #${mine.rank} of ${played.length}`
            : "Score posted";
      setCelebrateGameId(game.id);
      setTimeout(() => setCelebrateGameId(null), 1200);
      showToast({ message, tone: "success" });
    },
    onError: (e) => showToast({ message: errorMessage(e, "Couldn't save score"), tone: "danger" }),
  });

  const clearMutation = useMutation({
    mutationFn: (gameId: string) => clearGameScore(gameId, todayKey, token),
    onSuccess: async () => {
      haptics.medium();
      setDraft("");
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["games"] });
      showToast({ message: "Score cleared", tone: "success" });
    },
    onError: (e) => showToast({ message: errorMessage(e, "Couldn't clear score"), tone: "danger" }),
  });

  const onCopyScores = async () => {
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
  };

  const onReorder = ({ fromIndex, toIndex }: { fromIndex: number; toIndex: number }) => {
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

  const onRemoveGame = async (mg: MyGame) => {
    const ok = await confirm({
      title: `Remove ${mg.game.title} from My Games?`,
      message: "Your past scores stay — re-adding the game brings them back.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    if (nav.expandedGameId === mg.gameId) nav.collapseGame();
    removeMutation.mutate(mg.gameId);
  };

  const onSelectDate = useCallback((key: string) => {
    setViewDate(key);
    setDraft("");
    setEditing(false);
  }, []);

  const expandedIndex = expandedId ? myGames.findIndex((g) => g.gameId === expandedId) : -1;

  const renderRow = (mg: MyGame, isDragging: boolean, onLongPressBody?: () => void) => {
    const index = myGames.findIndex((g) => g.gameId === mg.gameId);
    const isOpen = mg.gameId === expandedId;
    const standings = viewStandings.get(mg.gameId);
    const entries = (standings?.entries ?? []).filter(
      (e) => e.scoreRaw != null && e.scoreRaw.length > 0,
    );
    const mine = user?.id ? entries.find((e) => e.userId === user.id) : undefined;
    const myScore = mine ? railScore(mg.game, mine) : null;
    // The day's leading result, beside the facepile, in the same compact form
    // as every other number in the app. Raw share grids live in exactly one
    // place — the open board — so the ledger reads as one score language
    // rather than one dialect per game.
    const leader = entries.find((e) => e.rank === 1);
    const bestScore = leader ? railScore(mg.game, leader) : null;
    const faces: LedgerFace[] = entries.slice(0, 6).map((e) => ({
      userId: e.userId,
      displayName: e.displayName,
      avatarUrl: userAvatarImageUrl(e.userId),
      rank: e.rank,
    }));
    const stagger =
      expandedIndex >= 0 ? Math.min(STAGGER_MAX, Math.abs(index - expandedIndex) * STAGGER_MS) : 0;

    return (
      <LedgerRow
        game={mg}
        mode={expandedId === null ? "row" : isOpen ? "board" : "strip"}
        stagger={stagger}
        myScore={myScore}
        myPlayed={!!mine}
        myScoreIsBest={mine?.rank === 1}
        faces={faces}
        bestScore={bestScore}
        streak={mg.standings.viewerStreak ?? 0}
        viewingToday={viewingToday}
        host={hostOf(mg.game.url)}
        isDragging={isDragging}
        onExpand={() => nav.expandGame(mg.gameId)}
        onCollapse={nav.collapseGame}
        onPlay={() => markPlaying({ id: mg.gameId, url: mg.game.url })}
        onPost={() => openPasteFor({ id: mg.gameId, url: mg.game.url })}
        celebrate={celebrateGameId === mg.gameId}
        {...(onLongPressBody ? { onLongPressBody } : {})}
        board={
          isOpen ? (
            <GameBoardPanel
              game={mg.game}
              entries={standings?.entries ?? []}
              loading={!viewingToday && viewQuery.isPending}
              selfId={user?.id ?? null}
              viewingToday={viewingToday}
              viewDate={viewDate}
              history={history}
              onSelectDate={onSelectDate}
              draft={draft}
              editing={editing}
              pending={upsertMutation.isPending}
              onChangeDraft={setDraft}
              onSubmit={() => {
                const trimmed = draft.trim();
                if (trimmed) upsertMutation.mutate({ game: mg.game, scoreRaw: trimmed });
              }}
              onCancelEdit={() => {
                setDraft("");
                setEditing(false);
              }}
              onStartEdit={() => {
                setDraft(mine?.scoreRaw ?? "");
                setEditing(true);
              }}
              onClear={async () => {
                const ok = await confirm({
                  title: "Clear your score for today?",
                  message: "Your result is removed. Scores on other days are kept.",
                  confirmLabel: "Clear",
                  destructive: true,
                });
                if (ok) clearMutation.mutate(mg.gameId);
              }}
              onPlay={() => markPlaying({ id: mg.gameId, url: mg.game.url })}
              onReact={(userId, emoji, cur) => reactionCtl.react(mg.gameId, userId, emoji, cur)}
              onOpenReactionPicker={(userId) =>
                reactionCtl.openPicker(
                  mg.gameId,
                  userId,
                  entries.find((e) => e.userId === userId)?.displayName ?? null,
                )
              }
              onOpenGame={() => openExternalUrl(mg.game.url)}
              onReteach={
                user?.isAdmin && isGameReteachable(mg.game)
                  ? () => openPasteFor({ id: mg.gameId, url: mg.game.url })
                  : undefined
              }
              onRemove={() => void onRemoveGame(mg)}
              myName={user?.displayName ?? null}
              myAvatarUrl={user?.avatarUrl ?? null}
            />
          ) : null
        }
      />
    );
  };

  const footer = (
    <View style={styles.footer}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a game"
        onPress={() => setAddOpen(true)}
        testID="fab-add-game"
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.footerRow,
          (pressed || hovered) && styles.footerRowHover,
        ]}
      >
        <View style={styles.footerIcon}>
          <PixelIcon name="plus" size={16} color={tokens.neon.pink} />
        </View>
        <Text style={styles.footerLabel}>Add a game</Text>
      </Pressable>
      {viewingToday ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy today's scores to clipboard"
          onPress={onCopyScores}
          disabled={copyingScores}
          testID="games-copy-scores"
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.footerRow,
            (pressed || hovered) && styles.footerRowHover,
            copyingScores && styles.dim,
          ]}
        >
          <View style={styles.footerIcon}>
            {copyingScores ? (
              <ActivityIndicator size="small" color={tokens.text.secondary} />
            ) : (
              <PixelIcon name="copy" size={16} color={tokens.text.secondary} />
            )}
          </View>
          <Text style={styles.footerLabelQuiet}>Copy today&apos;s recap</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <Screen style={styles.root} testID="games-home">
      <ShellHeader
        friends={friends}
        pendingRequests={pendingRequests}
        myName={user?.displayName ?? user?.email ?? null}
        myAvatarUrl={user?.avatarUrl ?? null}
        onOpenFriends={nav.openFriends}
        onOpenProfile={() => setProfileOpen(true)}
      />

      {gamesQuery.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.neon.pink} />
        </View>
      ) : gamesQuery.isError ? (
        <View style={styles.center}>
          <EmptyState
            title="Couldn't load your games"
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
          onAddFriends={nav.openFriends}
          onAddByUrl={() => setAddOpen(true)}
          onAddDiscovery={(game) => addDiscoveryMutation.mutate(game)}
          addingGameIds={addingDiscoveryIds}
          addedGameIds={addedDiscoveryIds}
        />
      ) : (
        <>
          <DayTape
            selectedDate={viewDate}
            today={todayKey}
            onSelectDate={onSelectDate}
            horizontalInset={homeLayout.horizontalInset}
          />
          {/* Column header — one 22px rule that turns the list into a
              high-score table and says out loud what the right rail holds. */}
          <View style={styles.columns}>
            <Text style={styles.columnLabel}>GAME</Text>
            <View style={styles.columnRight}>
              <Text style={[styles.columnLabel, styles.columnValue]}>BEST</Text>
              <Text style={[styles.columnLabel, styles.columnValue]}>YOU</Text>
            </View>
          </View>
          <View style={styles.ledger}>
            <LedgerList
              games={myGames}
              renderRow={renderRow}
              onReorder={onReorder}
              reorderEnabled={expandedId === null}
              refreshing={gamesQuery.isRefetching && !gamesQuery.isPending}
              onRefresh={() => gamesQuery.refetch()}
              footer={footer}
            />
          </View>
        </>
      )}

      <FriendsDrawer
        open={nav.drawer !== null}
        panel={nav.drawer?.kind === "friend" ? 1 : 0}
        onOpen={nav.openFriends}
        onClose={nav.closeDrawer}
        onBack={nav.drawerBack}
        listPanel={
          <FriendsPanel
            signals={friendSignals}
            onClose={nav.closeDrawer}
            onOpenFriend={nav.openFriend}
          />
        }
        friendPanel={
          nav.drawer?.kind === "friend" ? (
            <FriendPanel
              userId={nav.drawer.userId}
              via={nav.via}
              myScores={myScoresByGame}
              onBack={nav.drawerBack}
              onOpenGame={(gameId) => {
                nav.closeDrawer();
                nav.expandGame(gameId);
              }}
            />
          ) : null
        }
      />

      <ProfileSheet visible={profileOpen} onClose={() => setProfileOpen(false)} />

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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  ledger: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: tokens.space.lg },
  columns: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: homeLayout.horizontalInset,
    paddingTop: tokens.space.sm,
    paddingBottom: 4,
  },
  columnLabel: { ...pixelType(10), color: tokens.text.secondary, opacity: 0.7 },
  columnRight: { flexDirection: "row" },
  columnValue: { width: ledgerMetrics.COL_W, textAlign: "right" },
  footer: { paddingTop: tokens.space.lg },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    borderBottomWidth: 1,
    borderBottomColor: tokens.border.default,
  },
  footerRowHover: { backgroundColor: tokens.bg.surface },
  footerIcon: { width: ledgerMetrics.GUTTER, alignItems: "flex-start" },
  footerLabel: actionType(tokens.neon.pinkTint),
  footerLabelQuiet: actionType(tokens.text.secondary),
  dim: { opacity: 0.5 },
});
