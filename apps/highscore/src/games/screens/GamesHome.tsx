// Games home (G1b, issue #284) — THE main page of the Games tab: My Games in
// my order, each rendered as a today's-leaderboard card (shared
// `StandingsCard`, same chrome as the Lists surface's leaderboard view).
//
// Solo a card shows just you; the standings array fills in as friends land
// (G2a already widens `GET /v1/games` to viewer ∪ friends — this screen just
// renders whatever the entries contain). The play→paste loop mirrors the
// Lists surface: Play opens the game and arms a paste-on-return prompt
// (`useReturnToPaste`, scope "games"); pasting posts to *today's* bucket.
//
// Empty state is the friends-first onboarding (G3, #293) — `GamesOnboarding`
// pushes "Add friends" when you have none, or your friends' games as one-tap
// suggestions when you do. The + sheet carries the same discovery suggestions
// above its URL field; the home card list itself stays purely your own games.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { createFriendInvite, fetchFriends } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type {
  DiscoveryGame,
  Game,
  GameStandingsEntry,
  GamesResponse,
  MyGame,
} from "@workshop/shared/games";
import {
  confirm,
  HomeHeader,
  haptics,
  homeLayout,
  openExternalUrl,
  Screen,
  Sheet,
  useToast,
} from "@workshop/ui";
import { type Href, useRouter } from "expo-router";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { HsButton, HsText, hs, hsGlow, PixelIcon } from "../../theme";
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
import { DayRail } from "../components/DayRail";
import { ReactionPickerSheet } from "../components/ReactionPickerSheet";
import { StandingsCard, type StandingsRow } from "../components/StandingsCard";
import { useReturnToPaste } from "../hooks/useReturnToPaste";
import { useScoreReactions } from "../hooks/useScoreReactions";
import { localDateKey } from "../lib/gameDate";
import { neighborsForOrderedReorder } from "../lib/reorder";
import { isGameReteachable, specForGame } from "../lib/scoreSpecs";
import { buildTodaysGameScoresSummary, summarizeGameScoreBody } from "../lib/scoresSummary";
import { copyToClipboard, shareOrCopyLink } from "../lib/share";
import { useGamesRuntime } from "../runtime";
import { GameScorePasteSheet, type TaughtScoreSpec } from "./GameScorePasteSheet";
import { AddGameSheet } from "./games/AddGameSheet";
import { GameCardList } from "./games/GameCardList";
import { GamesOnboarding } from "./games/GamesOnboarding";
import type { GameReorderEvent } from "./games/gameCardListProps";

function hasScore(entry: GameStandingsEntry): boolean {
  return entry.scoreRaw != null && entry.scoreRaw.length > 0;
}

/**
 * Turnout line for the viewed day. Unlike the Lists card there's no roster
 * denominator — the standings only carry players who posted — so the line
 * reads off the played count alone. Past days drop the present tense.
 */
function turnoutLine(playedCount: number, viewerHasPlayed: boolean, viewingToday: boolean): string {
  if (playedCount === 0) return viewingToday ? "No one's played yet" : "No one played";
  if (playedCount === 1 && viewerHasPlayed) {
    return viewingToday ? "You've played today" : "You played";
  }
  return `${playedCount} played${viewingToday ? " today" : ""}`;
}

export interface GamesHomeProps {
  headerLeft?: ReactNode;
  headerTrailing?: ReactNode;
}

export function GamesHome({ headerLeft = null, headerTrailing = null }: GamesHomeProps) {
  const { token, user, routes } = useGamesRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();

  const todayKey = localDateKey();
  const gamesKey = queryKeys.games.mine(todayKey);

  // The day rail re-dates every card's standings. Scores can only be POSTED
  // to today's bucket, so the play→paste loop below stays pinned to
  // `todayKey`; only the displayed standings follow `viewDate`.
  const [viewDate, setViewDate] = useState(todayKey);
  const viewingToday = viewDate === todayKey;

  const [addOpen, setAddOpen] = useState(false);
  const [menuGame, setMenuGame] = useState<MyGame | null>(null);
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

  // Emoji reactions on friends' scores (G2c). Targets the displayed day's
  // standings cache (`viewDate`), which equals `gamesKey` while viewing today.
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

  // Friends drive which empty-state variant shows; discovery powers both the
  // friends-but-no-games suggestions and the + sheet's suggestion list. Both
  // are only needed when the home is empty or the sheet is open.
  const friendsQuery = useQuery({
    queryKey: queryKeys.friends.all,
    queryFn: () => fetchFriends(token),
    enabled: !!token && isEmpty,
    refetchInterval: livePoll,
  });
  const friends = friendsQuery.data?.friends ?? [];

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
      // Standings follow the rail's selected day; the game list itself (which
      // games, what order) stays the today-pinned canonical My Games.
      const standings = viewStandings.get(mg.gameId);
      const entries = (standings?.entries ?? []).filter(hasScore);
      const rows: StandingsRow[] = entries.map((entry) => ({
        userId: entry.userId,
        displayName: entry.displayName,
        avatarUrl: userAvatarImageUrl(entry.userId),
        rank: entry.rank,
        body: summarizeGameScoreBody(mg.game, entry),
        reactions: entry.reactions,
      }));
      return (
        <StandingsCard
          key={mg.gameId}
          cardId={mg.gameId}
          title={mg.game.title}
          coverImageUrl={mg.game.iconUrl}
          coverGlyph="🎮"
          accent={tokens.accent.default}
          isDragging={isDragging}
          turnout={turnoutLine(rows.length, standings?.viewerHasPlayed ?? false, viewingToday)}
          // Streak rides on the today-pinned `mg` (not the rail's viewed day) so
          // the flame always reflects today's run — a stable "play today" nudge.
          streak={mg.standings.viewerStreak}
          rows={rows}
          selfId={user?.id ?? null}
          loading={!viewingToday && viewQuery.isPending}
          emptyFaces={[]}
          // Results can only be posted to today's bucket — past days are
          // read-only, so the Play / paste affordances hide off-today.
          showCta={viewingToday && !mg.standings.viewerHasPlayed}
          onPressBody={() => router.push(routes.game(mg.gameId) as Href)}
          {...(onLongPressBody ? { onLongPressBody } : {})}
          onMenu={() => setMenuGame(mg)}
          onPlay={() => markPlaying({ id: mg.gameId, url: mg.game.url })}
          onPaste={() => openPasteFor({ id: mg.gameId, url: mg.game.url })}
          onReact={(userId, emoji, currentlyReacted) =>
            reactionCtl.react(mg.gameId, userId, emoji, currentlyReacted)
          }
          onOpenReactionPicker={(userId) =>
            reactionCtl.openPicker(
              mg.gameId,
              userId,
              entries.find((e) => e.userId === userId)?.displayName ?? null,
            )
          }
        />
      );
    },
    [
      user?.id,
      router,
      markPlaying,
      openPasteFor,
      viewStandings,
      viewingToday,
      viewQuery.isPending,
      reactionCtl.react,
      reactionCtl.openPicker,
      routes.game,
    ],
  );

  return (
    <Screen style={styles.root} testID="games-home">
      <HomeHeader
        left={headerLeft}
        right={
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy today's scores to clipboard"
              onPress={onCopyScores}
              disabled={copyingScores}
              testID="games-copy-scores"
              hitSlop={8}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.headerIconBtn,
                (pressed || hovered) && styles.headerIconBtnHover,
                copyingScores && styles.headerIconBtnDisabled,
              ]}
            >
              {copyingScores ? (
                <ActivityIndicator size="small" color={tokens.text.primary} />
              ) : (
                <CopyIcon size={20} color={tokens.text.primary} />
              )}
            </Pressable>
            {headerTrailing}
          </>
        }
      />

      <View style={styles.body}>
        {gamesQuery.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator color={tokens.accent.default} />
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
          <>
            <View style={styles.dayRail}>
              <DayRail
                selectedDate={viewDate}
                today={todayKey}
                onSelectDate={setViewDate}
                testIDPrefix="games-day"
                horizontalInset={homeLayout.horizontalInset}
              />
            </View>
            <GameCardList
              games={myGames}
              renderCard={renderCard}
              onReorder={onReorder}
              refreshing={gamesQuery.isRefetching && !gamesQuery.isPending}
              onRefresh={() => gamesQuery.refetch()}
            />
          </>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a game"
        onPress={() => setAddOpen(true)}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.fab,
          hovered && styles.fabHovered,
          pressed && styles.fabPressed,
        ]}
        testID="fab-add-game"
      >
        <Text style={styles.fabGlyph} tone="onAccent">
          +
        </Text>
      </Pressable>

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
        // Admins can re-teach a game that already parses; everyone else only
        // gets the teach chips on a game's first paste (no spec yet). Registry
        // games are read-only for all (mirrors the backend score-spec gate).
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

      {/* Card menu — Open game / (admin) Re-teach scoring / Remove. */}
      <Sheet
        visible={!!menuGame}
        onRequestClose={() => setMenuGame(null)}
        onClosed={() => {
          // Chain the paste/teach sheet open only after this one is fully
          // closed — see `reteachAfterMenu`.
          if (reteachAfterMenu) {
            openPasteFor({ id: reteachAfterMenu.gameId, url: reteachAfterMenu.game.url });
            setReteachAfterMenu(null);
          }
        }}
        testID="game-menu-sheet"
      >
        {menuGame ? (
          <>
            <View style={styles.sheetHeader}>
              <Text variant="heading" numberOfLines={1}>
                {menuGame.game.title}
              </Text>
            </View>
            <View style={styles.sheetActions}>
              <Button
                testID="game-menu-open"
                label="Open game"
                onPress={() => {
                  setMenuGame(null);
                  openExternalUrl(menuGame.game.url);
                }}
              />
              {user?.isAdmin && isGameReteachable(menuGame.game) ? (
                <>
                  <View style={styles.sheetDivider} />
                  <Button
                    testID="game-menu-reteach"
                    variant="ghost"
                    label="Re-teach scoring"
                    onPress={() => {
                      // Remember the target, close this sheet; `onClosed` opens
                      // the paste sheet once the modal has animated away.
                      setReteachAfterMenu(menuGame);
                      setMenuGame(null);
                    }}
                  />
                </>
              ) : null}
              <View style={styles.sheetDivider} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${menuGame.game.title} from My Games`}
                onPress={() => onRemove(menuGame)}
                testID="game-menu-remove"
                hitSlop={6}
                style={({ pressed }) => [
                  styles.sheetDangerRow,
                  pressed && styles.sheetDangerPressed,
                ]}
              >
                <Text style={styles.sheetDangerLabel}>Remove from My Games</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingTop: tokens.space.lg,
    paddingBottom: tokens.space.lg,
  },
  body: { flex: 1 },
  headerIconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  headerIconBtnHover: { backgroundColor: tokens.bg.elevated },
  headerIconBtnDisabled: { opacity: 0.6 },
  dayRail: {
    paddingBottom: tokens.space.sm,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: tokens.space.lg,
  },
  fab: {
    position: "absolute",
    right: homeLayout.horizontalInset,
    bottom: homeLayout.horizontalInset,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: tokens.accent.default,
    alignItems: "center",
    justifyContent: "center",
    // Calm neutral elevation, not an amber glow (see DESIGN.md "calm by default").
    boxShadow: "0px 10px 24px rgba(0, 0, 0, 0.45), 0px 2px 6px rgba(0, 0, 0, 0.30)",
    elevation: 5,
  },
  fabHovered: {
    backgroundColor: tokens.accent.hover,
    transform: [{ scale: 1.04 }],
  },
  fabPressed: { backgroundColor: tokens.accent.hover, transform: [{ scale: 0.96 }] },
  fabGlyph: { fontSize: 28, fontWeight: tokens.font.weight.semibold, lineHeight: 32 },
  sheetHeader: { gap: 4 },
  sheetActions: { gap: tokens.space.sm },
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.border.subtle,
    marginVertical: tokens.space.xs,
  },
  sheetDangerRow: {
    paddingVertical: tokens.space.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  sheetDangerPressed: { backgroundColor: `${tokens.status.danger}1A` },
  sheetDangerLabel: {
    color: tokens.status.danger,
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.semibold,
  },
});
