// Scoreboard home — THE main page. The day is the document: a pinned
// DayHeader says which day you are looking at and moves it; below it, one
// box-score row per game in my rotation (`GameResultRow`): title, turnout,
// my rank/score (or a lit POST), and the rank strip of everyone who posted,
// as faces in rank order. Tap a row → that game's board on the same day; tap
// a face → that person; POST → the paste sheet in place. PASTE in the bottom
// bar is the global write (recognises the game from the text).
//
// Data: `GET /v1/games?period=` already returns, per game in my rotation,
// the standings of me ∪ my friends — the whole day in one request. The
// today-pinned query drives the game list + streaks + the paste loop; the
// viewed-day query drives the standings. Both share a key when the view is
// today. Adjacent days are prefetched so ‹ › feel instant.
//
// Empty state is the friends-first onboarding (G3, #293). The + in the title
// bar opens the add sheet (URL + what friends play).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
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
  GameStandingsEntry,
  GamesResponse,
  MyGame,
} from "@workshop/shared/games";
import { confirm, haptics } from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { BottomBar } from "../../components/BottomBar";
import { DayHeader } from "../../components/DayHeader";
import { Button, Notice, PixelIcon, Screen, Sheet, Text, tokens, useToast } from "../../theme";
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
import { setScoreDirection } from "../api/teach";
import { GameResultRow } from "../components/GameResultRow";
import { useOpenProfile } from "../hooks/useOpenProfile";
import { useReturnToPaste } from "../hooks/useReturnToPaste";
import { askScoreDirection } from "../lib/askScoreDirection";
import { localDateKey, shiftDateKey } from "../lib/gameDate";
import { prewarmGameShareCard } from "../lib/prewarmShareCard";
import { neighborsForOrderedReorder } from "../lib/reorder";
import { isGameReteachable, specForGame } from "../lib/scoreSpecs";
import { buildTodaysGameScoresSummary } from "../lib/scoresSummary";
import { copyToClipboard, shareOrCopyLink } from "../lib/share";
import { teachAfterPost, teachOutcomeMessage } from "../lib/teachAfterPost";
import { type ScorePostExtras, useTeachAvailable } from "../lib/useScoreCheck";
import { useGamesRuntime } from "../runtime";
import { useViewDay } from "../state/viewDay";
import { GameScorePasteSheet, type TaughtScoreSpec } from "./GameScorePasteSheet";
import { AddGameSheet } from "./games/AddGameSheet";
import { GameCardList } from "./games/GameCardList";
import { GamesOnboarding } from "./games/GamesOnboarding";
import type { GameReorderEvent } from "./games/gameCardListProps";

function hasScore(entry: GameStandingsEntry): boolean {
  return entry.scoreRaw != null && entry.scoreRaw.length > 0;
}

export interface GamesHomeProps {
  headerLeft?: ReactNode;
  headerTrailing?: ReactNode;
}

export function GamesHome({ headerLeft = null, headerTrailing = null }: GamesHomeProps) {
  const params = useLocalSearchParams<{ d?: string }>();
  const { token, user, routes } = useGamesRuntime();
  const router = useRouter();
  const openProfile = useOpenProfile();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();

  const todayKey = localDateKey();
  const gamesKey = queryKeys.games.mine(todayKey);

  // The day rail re-dates every card's standings. The home play→paste loop
  // stays pinned to `todayKey`; only the displayed standings follow
  // `viewDate`. Posting to a past day lives on the per-game board. The
  // selection is shared with each game board (state/viewDay.tsx), so paging
  // days over there leaves home on the same day when you come back.
  const { viewDate, setViewDate } = useViewDay();
  const viewingToday = viewDate === todayKey;
  // `?d=` deep link (web refresh / shared URL) seeds the shared day once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only param sync
  useEffect(() => {
    const raw = Array.isArray(params.d) ? params.d[0] : params.d;
    if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw <= todayKey) setViewDate(raw);
  }, []);

  const [addOpen, setAddOpen] = useState(false);
  const [menuGame, setMenuGame] = useState<MyGame | null>(null);
  // Teach v2 gates the direction control in the row menu.
  const teachAvailable = useTeachAvailable();
  // Admin "Re-teach scoring": remembered while the kebab menu sheet animates
  // out, then handed to the paste sheet in the menu's `onClosed` — never open
  // the second Sheet in the same tick (two stacked Modals wedge iOS).
  const [reteachAfterMenu, setReteachAfterMenu] = useState<MyGame | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  // The copy-scores recap appends a per-day "play with me" link (`/g/:token`),
  // distinct from the friend-invite link the empty-state "Add friends" CTA uses.
  const [scoreShareUrl, setScoreShareUrl] = useState<string | null>(null);
  const [copyingScores, setCopyingScores] = useState(false);
  // Track in-flight + completed one-tap discovery adds by game id so each row
  // can show its own spinner / "✓ Added" pill (one mutation, many rows).
  const [addingDiscoveryIds, setAddingDiscoveryIds] = useState<string[]>([]);
  const [addedDiscoveryIds, setAddedDiscoveryIds] = useState<string[]>([]);

  const gamesQuery = useQuery({
    queryKey: gamesKey,
    queryFn: () => fetchMyGames(todayKey, token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const myGames = gamesQuery.data?.games ?? [];
  const isEmpty = !gamesQuery.isPending && !gamesQuery.isError && myGames.length === 0;

  // Standings for the selected day. When viewing today this shares the
  // today-pinned query's key, so it costs nothing extra; it only does work
  // once the rail points at a past day.
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

  // Friends drive which empty-state variant shows; discovery powers both the
  // friends-but-no-games suggestions and the + sheet's suggestion list. Both
  // are only needed when the home is empty or the sheet is open.
  const friendsQuery = useQuery({
    queryKey: queryKeys.friends.all,
    queryFn: () => fetchFriends(token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const friends = friendsQuery.data?.friends ?? [];
  const requestsQuery = useQuery({
    queryKey: queryKeys.friends.requests,
    queryFn: () => fetchFriendRequests(token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const pendingRequests = requestsQuery.data?.inbound.length ?? 0;

  // `includeOwned` so the + sheet shows the full ranked list of what friends
  // play — including games already in My Games (rendered non-addable). The
  // empty state shares this query but has no owned games, so it's unaffected.
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

  // One-tap add of a discovery suggestion (sheet + empty state). Unlike the
  // URL add it keeps the sheet open so the user can add several, and it drops
  // the added game off the discovery feed.
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

  // Empty-state "Add friends": mint a share-link invite and hand it to the
  // system share sheet (native) / clipboard (web) — same machinery as the
  // Friends screen.
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
        prewarmGameShareCard(url);
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

  // Play-then-paste loop, scoped to the Games surface so a pending play
  // armed here never pops the Lists surface's sheet (and vice versa).
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
    // `taught` (the tap-the-score flow, see GameScorePasteSheet) stores the
    // learned parser on the game first, so this very post parses with it.
    // `extras` is the teach v2 equivalent: the pick rides on the post itself.
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
      // A pick that can teach the game does so after the post has landed:
      // the score is already saved whatever comes of it.
      const taught = await teachAfterPost({
        gameId: game.id,
        periodKey: todayKey,
        hint: data.teach,
        scoreDirection: extras?.scoreDirection ?? null,
        askDirection: askScoreDirection(game.title),
        token,
      });
      if (taught) {
        // A taught game reads texts differently: cached previews are stale.
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

  // Teach v2: whoever set a game's direction changes it outright; anyone
  // else's request waits for a second player asking for the same thing.
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
  // Mirror the day into the URL (`/?d=YYYY-MM-DD`, bare `/` for today) so a
  // web refresh or a shared link lands on the same day.
  useEffect(() => {
    const raw = Array.isArray(params.d) ? params.d[0] : params.d;
    const want = viewingToday ? undefined : viewDate;
    if ((raw ?? undefined) === want) return;
    router.setParams({ d: want ?? "" });
  }, [viewDate, viewingToday, params.d, router]);

  // Prefetch the neighbouring days so ‹ › never show a spinner on the
  // common "yesterday / back to today" hops.
  useEffect(() => {
    if (!token) return;
    for (const key of [shiftDateKey(viewDate, -1), shiftDateKey(viewDate, 1)]) {
      if (key > todayKey) continue;
      void queryClient.prefetchQuery({
        queryKey: queryKeys.games.mine(key),
        queryFn: () => fetchMyGames(key, token),
        staleTime: 60_000,
      });
    }
  }, [viewDate, todayKey, token, queryClient]);

  const dayStats = useMemo(() => {
    let played = 0;
    const players = new Set<string>();
    for (const [, standings] of viewStandings) {
      const entries = standings.entries.filter(hasScore);
      if (entries.length > 0) played += 1;
      for (const e of entries) players.add(e.userId);
    }
    return { played, players: players.size };
  }, [viewStandings]);
  const caption =
    myGames.length === 0
      ? null
      : dayStats.players === 0
        ? viewingToday
          ? "Nobody has posted yet"
          : "Nobody posted"
        : `${dayStats.played} of ${myGames.length} games · ${dayStats.players} ${dayStats.players === 1 ? "player" : "players"}`;

  const renderCard = useCallback(
    (mg: MyGame, isDragging: boolean, onLongPressBody?: () => void) => {
      const standings = viewStandings.get(mg.gameId);
      const entries = (standings?.entries ?? []).filter(hasScore);
      return (
        <GameResultRow
          key={mg.gameId}
          gameId={mg.gameId}
          title={mg.game.title}
          iconUrl={mg.game.iconUrl}
          entries={entries}
          selfId={user?.id ?? null}
          viewingToday={viewingToday}
          streak={mg.standings.viewerStreak}
          loading={!viewingToday && viewQuery.isPending}
          isDragging={isDragging}
          onPress={() => router.push(routes.game(mg.gameId, viewDate) as Href)}
          onPressPlayer={openProfile}
          {...(viewingToday && !mg.standings.viewerHasPlayed
            ? { onPost: () => openPasteFor({ id: mg.gameId, url: mg.game.url }) }
            : {})}
          {...(onLongPressBody ? { onLongPress: onLongPressBody } : {})}
          onMenu={() => setMenuGame(mg)}
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
    ],
  );

  return (
    <Screen style={styles.root} testID="games-home">
      <View style={styles.titleBar}>
        <View style={styles.titleBarLeft}>{headerLeft}</View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy today's scores to clipboard"
          onPress={onCopyScores}
          disabled={copyingScores}
          testID="games-copy-scores"
          hitSlop={8}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
        >
          {copyingScores ? (
            <ActivityIndicator size="small" color={tokens.text.primary} />
          ) : (
            <PixelIcon name="copy" size={24} color={tokens.text.secondary} />
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a game"
          onPress={() => setAddOpen(true)}
          testID="fab-add-game"
          hitSlop={8}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
        >
          <PixelIcon name="plus" size={24} color={tokens.text.secondary} />
        </Pressable>
        {headerTrailing}
      </View>

      {!isEmpty ? <DayHeader caption={caption} testIDPrefix="games-day" /> : null}

      <View style={styles.body}>
        {gamesQuery.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator color={tokens.neon.pink} />
          </View>
        ) : gamesQuery.isError ? (
          <View style={styles.pad}>
            <Notice
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

      <BottomBar active="board" friendRequests={pendingRequests} />

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

      {/* Row menu — Open game / direction / (admin) Re-teach / Remove. */}
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
            <Text variant="title" numberOfLines={1} style={styles.sheetTitle}>
              {menuGame.game.title}
            </Text>
            <View style={styles.sheetActions}>
              <Button
                testID="game-menu-open"
                label="Open game"
                onPress={() => {
                  setMenuGame(null);
                  // Arms the paste-on-return prompt (useReturnToPaste).
                  markPlaying({ id: menuGame.gameId, url: menuGame.game.url });
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
                  <Text variant="caption" tone="muted" testID="game-menu-direction-current">
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
              <Button
                testID="game-menu-remove"
                variant="danger"
                label="Remove from my games"
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
  titleBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: tokens.space.lg,
    paddingRight: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    gap: tokens.space.xs,
  },
  titleBarLeft: { flex: 1, minWidth: 0 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  iconBtnPressed: { backgroundColor: tokens.bg.elevated },
  body: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: tokens.space.lg },
  pad: { padding: tokens.space.lg },
  sheetTitle: { fontSize: 13, lineHeight: 20 },
  sheetActions: { gap: tokens.space.sm },
});
