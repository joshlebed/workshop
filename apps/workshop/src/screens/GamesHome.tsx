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
import type {
  DiscoveryGame,
  Game,
  GameStandingsEntry,
  GamesResponse,
  MyGame,
} from "@workshop/shared/games";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from "react-native";
import { fetchActivity } from "../api/activity";
import { createFriendInvite, fetchFriends } from "../api/friends";
import {
  addGame,
  fetchGameDiscovery,
  fetchMyGames,
  moveGame,
  removeGame,
  upsertGameScore,
} from "../api/games";
import { fetchLists } from "../api/lists";
import { HeaderActivityButton } from "../components/HeaderActivityButton";
import { ProfileMenu } from "../components/ProfileMenu";
import { StandingsCard, type StandingsRow } from "../components/StandingsCard";
import { useAuth } from "../hooks/useAuth";
import { useLivePollingInterval } from "../hooks/useLivePollingInterval";
import { neighborsForOrderedReorder } from "../lib/albumShelfPositions";
import { errorMessage } from "../lib/api";
import { userAvatarImageUrl } from "../lib/avatar";
import { confirm } from "../lib/confirm";
import { GAMES_TAB_ENABLED } from "../lib/featureFlags";
import { localDateKey } from "../lib/gameDate";
import { haptics } from "../lib/haptics";
import { openExternalUrl } from "../lib/openUrl";
import { queryKeys } from "../lib/queryKeys";
import { buildTodaysGameScoresSummary, summarizeGameScoreBody } from "../lib/scoresSummary";
import { copyToClipboard, shareOrCopyLink } from "../lib/share";
import { CopyIcon } from "../ui/CopyIcon";
import {
  Button,
  EmptyState,
  HomeHeader,
  homeLayout,
  InlineTabSwitch,
  Screen,
  Sheet,
  Text,
  tokens,
  useToast,
} from "../ui/index";
import { AddGameSheet } from "./games/AddGameSheet";
import { GameCardList } from "./games/GameCardList";
import { GamesOnboarding } from "./games/GamesOnboarding";
import type { GameReorderEvent } from "./games/gameCardListProps";
import { GameScorePasteSheet } from "./listDetail/GameScorePasteSheet";
import { useReturnToPaste } from "./listDetail/useReturnToPaste";

function hasScore(entry: GameStandingsEntry): boolean {
  return entry.scoreRaw != null && entry.scoreRaw.length > 0;
}

/**
 * Today-only turnout line. Unlike the Lists card there's no roster
 * denominator — the standings only carry players who posted — so the line
 * reads off the played count alone.
 */
function turnoutLine(playedCount: number, viewerHasPlayed: boolean): string {
  if (playedCount === 0) return "No one's played yet";
  if (playedCount === 1 && viewerHasPlayed) return "You've played today";
  return `${playedCount} played today`;
}

export function GamesHome() {
  const { token, user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();

  const todayKey = localDateKey();
  const gamesKey = queryKeys.games.mine(todayKey);

  const [addOpen, setAddOpen] = useState(false);
  const [menuGame, setMenuGame] = useState<MyGame | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
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

  const listsQuery = useQuery({
    queryKey: queryKeys.lists.all,
    queryFn: () => fetchLists(token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const allLists = listsQuery.data?.lists ?? [];
  const archivedLists = useMemo(() => allLists.filter((l) => !!l.archivedAt), [allLists]);
  const totalUnread = useMemo(() => {
    let n = 0;
    for (const l of allLists) {
      if (l.mutedAt) continue;
      n += l.unreadCount;
    }
    return n;
  }, [allLists]);

  const activityFeedQuery = useQuery({
    queryKey: queryKeys.activity.feed,
    queryFn: () => fetchActivity({ limit: 50 }, token),
    enabled: Platform.OS === "web" && !!token,
    staleTime: 30_000,
    refetchInterval: livePoll,
  });

  // Friends drive which empty-state variant shows; discovery powers both the
  // friends-but-no-games suggestions and the + sheet's suggestion list. Both
  // are only needed when the home is empty or the sheet is open.
  const friendsQuery = useQuery({
    queryKey: queryKeys.friends.all,
    queryFn: () => fetchFriends(token),
    enabled: !!token && GAMES_TAB_ENABLED && isEmpty,
    refetchInterval: livePoll,
  });
  const friends = friendsQuery.data?.friends ?? [];

  const discoveryQuery = useQuery({
    queryKey: queryKeys.games.discovery(),
    queryFn: () => fetchGameDiscovery(token),
    enabled: !!token && GAMES_TAB_ENABLED && (addOpen || isEmpty),
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
      friendUrl: "",
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
      let url = inviteUrl;
      if (!url) {
        const invite = await createFriendInvite(token);
        url = invite.url;
        setInviteUrl(url);
      }
      const summary = buildTodaysGameScoresSummary({
        friendUrl: url,
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
      showToast({ message: errorMessage(e, "Couldn't create an invite link."), tone: "danger" });
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
    mutationFn: ({ game, scoreRaw }: { game: Game; scoreRaw: string }) =>
      upsertGameScore(game.id, { periodKey: todayKey, scoreRaw }, token),
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
  const onActivity = useCallback(() => router.push("/activity?from=games"), [router]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "/") {
        e.preventDefault();
        onActivity();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onActivity]);

  const renderCard = useCallback(
    (mg: MyGame, isDragging: boolean, onLongPressBody?: () => void) => {
      const entries = mg.standings.entries.filter(hasScore);
      const rows: StandingsRow[] = entries.map((entry) => ({
        userId: entry.userId,
        displayName: entry.displayName,
        avatarUrl: userAvatarImageUrl(entry.userId),
        rank: entry.rank,
        body: summarizeGameScoreBody(mg.game, entry),
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
          turnout={turnoutLine(rows.length, mg.standings.viewerHasPlayed)}
          rows={rows}
          selfId={user?.id ?? null}
          emptyFaces={[]}
          emptyText="Be the first to play today."
          showCta={!mg.standings.viewerHasPlayed}
          onPressBody={() => router.push(`/games/${mg.gameId}`)}
          {...(onLongPressBody ? { onLongPressBody } : {})}
          onMenu={() => setMenuGame(mg)}
          onPlay={() => markPlaying({ id: mg.gameId, url: mg.game.url })}
          onPaste={() => openPasteFor({ id: mg.gameId, url: mg.game.url })}
        />
      );
    },
    [user?.id, router, markPlaying, openPasteFor],
  );

  return (
    <Screen style={styles.root} testID="games-home">
      <HomeHeader
        left={GAMES_TAB_ENABLED ? <InlineTabSwitch /> : null}
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
            {Platform.OS === "web" ? (
              <HeaderActivityButton
                unreadCount={totalUnread}
                error={activityFeedQuery.isError}
                onPress={onActivity}
                onRetry={() => {
                  void activityFeedQuery.refetch();
                }}
                testID="open-activity"
              />
            ) : null}
            <ProfileMenu archivedLists={archivedLists} />
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
          <GameCardList
            games={myGames}
            renderCard={renderCard}
            onReorder={onReorder}
            refreshing={gamesQuery.isRefetching && !gamesQuery.isPending}
            onRefresh={() => gamesQuery.refetch()}
          />
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
        onSubmit={(game, scoreRaw) => upsertMutation.mutate({ game, scoreRaw })}
        onClose={dismiss}
      />

      {/* Card menu — Open game / Remove. */}
      <Sheet visible={!!menuGame} onRequestClose={() => setMenuGame(null)} testID="game-menu-sheet">
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
