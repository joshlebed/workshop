// Home — "this day, every game, everyone". The day spine at the top is the
// app's one global control; everything below is the selected day's slice of
// day × game × player: a scorecard for you, then one box-score row per game
// in your rotation, split into "to play" and "played". See UX-EXPLORATION.md.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { createFriendInvite, fetchFriends } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type { DiscoveryGame, Game, MyGame } from "@workshop/shared/games";
import {
  confirm,
  haptics,
  neighborsForOrderedReorder,
  openExternalUrl,
  shareOrCopyLink,
} from "@workshop/ui";
import { copyToClipboard } from "@workshop/ui/clipboard";
import { type Href, useRouter } from "expo-router";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { ScreenHeader } from "../../components/ScreenHeader";
import { DaySpine } from "../../day/DaySpine";
import {
  Button,
  IconButton,
  Notice,
  PixelIcon,
  Screen,
  Sheet,
  Text,
  tokens,
  useToast,
} from "../../theme";
import {
  addGame,
  createGameShareLink,
  fetchGameDiscovery,
  moveGame,
  removeGame,
  setGameScoreSpec,
  upsertGameScore,
} from "../api/games";
import { setScoreDirection } from "../api/teach";
import { BoxScoreRow } from "../components/BoxScoreRow";
import { useDayWindow } from "../hooks/useDayWindow";
import { useOpenProfile } from "../hooks/useOpenProfile";
import { useReturnToPaste } from "../hooks/useReturnToPaste";
import { askScoreDirection } from "../lib/askScoreDirection";
import { dayScorecard, groupRows, rowSummary } from "../lib/dayRows";
import { prewarmGameShareCard } from "../lib/prewarmShareCard";
import { isGameReteachable, specForGame } from "../lib/scoreSpecs";
import { buildTodaysGameScoresSummary } from "../lib/scoresSummary";
import { teachAfterPost, teachOutcomeMessage } from "../lib/teachAfterPost";
import { type ScorePostExtras, useTeachAvailable } from "../lib/useScoreCheck";
import { useGamesRuntime } from "../runtime";
import { useViewDay } from "../state/viewDay";
import { GameScorePasteSheet, type TaughtScoreSpec } from "./GameScorePasteSheet";
import { AddGameSheet } from "./games/AddGameSheet";
import { GamesOnboarding } from "./games/GamesOnboarding";

export interface GamesHomeProps {
  headerLeft?: ReactNode;
  headerTrailing?: ReactNode;
}

export function GamesHome({ headerLeft, headerTrailing }: GamesHomeProps) {
  const { token, user, routes } = useGamesRuntime();
  const router = useRouter();
  const openProfile = useOpenProfile();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();
  const { viewDate } = useViewDay();
  const teachAvailable = useTeachAvailable();

  const { today, day, playedDays, activeDays, byDay } = useDayWindow(viewDate);
  const viewingToday = viewDate === today;
  const selfId = user?.id ?? null;
  const dayKey = queryKeys.games.mine(viewDate);
  const todayKey = queryKeys.games.mine(today);

  // Rows come from the selected day; while it loads, borrow the rotation from
  // any day already in the window so the list doesn't blank between taps.
  const fallback = useMemo(
    () => byDay.get(today) ?? byDay.values().next().value ?? null,
    [byDay, today],
  );
  const myGames: MyGame[] = day.data?.games ?? fallback?.games ?? [];
  const dayLoading = !day.data;
  const isEmpty = !day.isPending && !day.isError && myGames.length === 0;

  const [addOpen, setAddOpen] = useState(false);
  const [menuGame, setMenuGame] = useState<MyGame | null>(null);
  const [reteachAfterMenu, setReteachAfterMenu] = useState<MyGame | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [scoreShareUrl, setScoreShareUrl] = useState<string | null>(null);
  const [copyingScores, setCopyingScores] = useState(false);
  const [addingDiscoveryIds, setAddingDiscoveryIds] = useState<string[]>([]);
  const [addedDiscoveryIds, setAddedDiscoveryIds] = useState<string[]>([]);

  const friendsQuery = useQuery({
    queryKey: queryKeys.friends.all,
    queryFn: () => fetchFriends(token),
    enabled: !!token,
    refetchInterval: isEmpty ? livePoll : false,
    staleTime: 60_000,
  });
  const discoveryQuery = useQuery({
    queryKey: queryKeys.games.discovery(),
    queryFn: () => fetchGameDiscovery(token, { includeOwned: true }),
    enabled: !!token && (addOpen || isEmpty),
    refetchInterval: livePoll,
  });

  const invalidateGames = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["games"] });
  }, [queryClient]);

  const addMutation = useMutation({
    mutationFn: (url: string) => addGame(url, token),
    onSuccess: (data) => {
      haptics.medium();
      setAddOpen(false);
      invalidateGames();
      showToast({ message: `Added ${data.game.title}` });
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't add that game."), tone: "danger" }),
  });

  const addDiscoveryMutation = useMutation({
    mutationFn: (dg: DiscoveryGame) => addGame(dg.game.url, token),
    onMutate: (dg) => setAddingDiscoveryIds((ids) => [...ids, dg.game.id]),
    onSuccess: (_data, dg) => {
      haptics.medium();
      setAddedDiscoveryIds((ids) => [...ids, dg.game.id]);
      invalidateGames();
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't add that game."), tone: "danger" }),
    onSettled: (_d, _e, dg) =>
      setAddingDiscoveryIds((ids) => ids.filter((id) => id !== dg.game.id)),
  });

  const inviteMutation = useMutation({
    mutationFn: () => createFriendInvite(token),
    onSuccess: async ({ url }) => {
      haptics.medium();
      setInviteUrl(url);
      const result = await shareOrCopyLink(url);
      if (result === "copied") showToast({ message: "Invite link copied" });
      else if (result === "failed")
        showToast({ message: "Couldn't copy — copy the link below manually.", tone: "danger" });
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't create an invite link."), tone: "danger" }),
  });

  const moveMutation = useMutation({
    mutationFn: (input: {
      gameId: string;
      beforeGameId: string | null;
      afterGameId: string | null;
    }) =>
      moveGame(
        input.gameId,
        { beforeGameId: input.beforeGameId, afterGameId: input.afterGameId },
        token,
      ),
    onSuccess: () => {
      haptics.selection();
      invalidateGames();
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't move that game."), tone: "danger" }),
  });

  const removeMutation = useMutation({
    mutationFn: (gameId: string) => removeGame(gameId, token),
    onSuccess: () => {
      haptics.medium();
      invalidateGames();
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't remove that game."), tone: "danger" }),
  });

  const directionMutation = useMutation({
    mutationFn: (input: { game: Game; to: "asc" | "desc" }) =>
      setScoreDirection(input.game.id, input.to, token),
    onSuccess: (data, input) => {
      setMenuGame(null);
      if (data.applied) invalidateGames();
      showToast({
        message: data.applied
          ? `${input.game.title} now ranks ${input.to === "asc" ? "lower" : "higher"} scores first.`
          : "Noted. It changes when one more player asks for the same.",
      });
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't change the ranking"), tone: "danger" }),
  });

  // Play → paste loop (scope "games"). `todayKey` here is the day a paste
  // files under, so posting from a past day backfills that day deliberately.
  const { promptItemId, markPlaying, openPasteFor, dismiss } = useReturnToPaste({
    todayKey: viewDate,
    hasScoreForItem: (gameId) =>
      myGames.find((g) => g.gameId === gameId)?.standings.viewerHasPlayed ?? false,
    scope: "games",
  });
  const pasteTarget: Game | null =
    (promptItemId ? myGames.find((g) => g.gameId === promptItemId)?.game : null) ?? null;

  const upsertMutation = useMutation({
    mutationFn: async (input: {
      game: { id: string; title: string };
      scoreRaw: string;
      taught?: TaughtScoreSpec;
      extras?: ScorePostExtras;
    }) => {
      if (input.taught) await setGameScoreSpec(input.game.id, input.taught, token);
      return upsertGameScore(
        input.game.id,
        {
          periodKey: viewDate,
          scoreRaw: input.scoreRaw,
          entrySource: "paste",
          ...input.extras?.body,
        },
        token,
      );
    },
    onSuccess: async (data, input) => {
      haptics.medium();
      dismiss();
      void queryClient.invalidateQueries({ queryKey: dayKey });
      void queryClient.invalidateQueries({ queryKey: todayKey });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.games.leaderboard(input.game.id, viewDate),
      });
      showToast({ message: viewingToday ? "Score posted" : `Posted to ${viewDate}` });
      const taught = await teachAfterPost({
        gameId: input.game.id,
        periodKey: viewDate,
        hint: data.teach,
        scoreDirection: input.extras?.scoreDirection ?? null,
        askDirection: askScoreDirection(input.game.title),
        token,
      });
      if (taught) {
        invalidateGames();
        void queryClient.invalidateQueries({ queryKey: ["game-score-check"] });
      }
      const message = teachOutcomeMessage(taught, input.game.title);
      if (message) showToast({ message });
    },
    onError: (e) => showToast({ message: errorMessage(e, "Couldn't save score"), tone: "danger" }),
  });

  const onCopyScores = useCallback(async () => {
    const games = byDay.get(today)?.games ?? [];
    const dry = buildTodaysGameScoresSummary({
      shareUrl: "",
      games,
      selfId: user?.id ?? "",
      dateKey: today,
    });
    if (!dry) {
      showToast({ message: "No scores from you today yet. Post one to share a recap." });
      return;
    }
    setCopyingScores(true);
    try {
      let url = scoreShareUrl;
      if (!url) {
        const link = await createGameShareLink(token);
        url = link.url;
        setScoreShareUrl(url);
        prewarmGameShareCard(url);
      }
      const summary = buildTodaysGameScoresSummary({
        shareUrl: url,
        games,
        selfId: user?.id ?? "",
        dateKey: today,
      });
      if (summary && (await copyToClipboard(summary))) {
        haptics.light();
        showToast({ message: "Today's scores copied to clipboard" });
      } else {
        showToast({ message: "Couldn't copy to clipboard", tone: "danger" });
      }
    } catch (e) {
      showToast({ message: errorMessage(e, "Couldn't create a share link."), tone: "danger" });
    } finally {
      setCopyingScores(false);
    }
  }, [byDay, today, user?.id, scoreShareUrl, token, showToast]);

  const scorecard = useMemo(() => dayScorecard(myGames, selfId), [myGames, selfId]);
  const grouped = useMemo(() => groupRows(myGames, selfId), [myGames, selfId]);

  const openBoard = useCallback(
    (gameId: string) => router.push(routes.game(gameId, viewDate) as Href),
    [router, routes, viewDate],
  );

  const moveBy = (game: MyGame, delta: -1 | 1) => {
    const from = myGames.findIndex((g) => g.gameId === game.gameId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= myGames.length) return;
    const neighbors = neighborsForOrderedReorder(myGames, from, to);
    if (!neighbors) return;
    setMenuGame(null);
    moveMutation.mutate({
      gameId: game.gameId,
      beforeGameId: neighbors.before?.gameId ?? null,
      afterGameId: neighbors.after?.gameId ?? null,
    });
  };

  const renderRow = (mg: MyGame) => (
    <BoxScoreRow
      key={mg.gameId}
      game={mg}
      row={rowSummary(mg, selfId)}
      loading={dayLoading}
      onPress={() => openBoard(mg.gameId)}
      onLongPress={() => setMenuGame(mg)}
      onMenu={() => setMenuGame(mg)}
      onPost={() => openPasteFor({ id: mg.gameId, url: mg.game.url })}
      onPressPlayer={openProfile}
    />
  );

  let body: ReactNode;
  if (day.isPending && myGames.length === 0) {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={tokens.neon.pink} />
      </View>
    );
  } else if (day.isError && myGames.length === 0) {
    body = (
      <View style={styles.pad}>
        <Notice
          title="Couldn't load your games"
          description={errorMessage(day.error, "Check your connection and try again.")}
          action={<Button label="Retry" variant="secondary" onPress={() => void day.refetch()} />}
        />
      </View>
    );
  } else if (isEmpty) {
    body = (
      <View style={styles.pad}>
        <GamesOnboarding
          friendsLoading={friendsQuery.isPending}
          hasFriends={(friendsQuery.data?.friends.length ?? 0) > 0}
          discovery={discoveryQuery.data?.games.filter((g) => !g.inMyGames) ?? []}
          discoveryLoading={discoveryQuery.isPending}
          invitePending={inviteMutation.isPending}
          inviteUrl={inviteUrl}
          onAddFriends={() => inviteMutation.mutate()}
          onCopyInvite={() => inviteUrl && void shareOrCopyLink(inviteUrl)}
          onAddByUrl={() => setAddOpen(true)}
          onAddDiscovery={(dg) => addDiscoveryMutation.mutate(dg)}
          addingGameIds={addingDiscoveryIds}
          addedGameIds={addedDiscoveryIds}
        />
      </View>
    );
  } else {
    body = (
      <ScrollView
        testID="games-home-list"
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={day.isRefetching && !day.isPending}
            onRefresh={() => void day.refetch()}
            tintColor={tokens.neon.pink}
          />
        }
      >
        <Scorecard
          loading={dayLoading}
          played={scorecard.played}
          total={scorecard.total}
          wins={scorecard.wins}
          bestStreak={scorecard.bestStreak}
          anyPlays={scorecard.anyPlays}
          viewingToday={viewingToday}
          hasFriends={(friendsQuery.data?.friends.length ?? 1) > 0}
          onAddFriends={() => router.push(routes.friends as Href)}
        />
        <View style={[styles.rows, dayLoading && styles.rowsLoading]}>
          {grouped.toPlay.length > 0 ? (
            <SectionLabel
              label={viewingToday ? "To play" : "Not played"}
              count={grouped.toPlay.length}
            />
          ) : null}
          {grouped.toPlay.map(renderRow)}
          {grouped.played.length > 0 ? (
            <SectionLabel label="Played" count={grouped.played.length} />
          ) : null}
          {grouped.played.map(renderRow)}
        </View>
      </ScrollView>
    );
  }

  const menu = menuGame;
  const menuTeachable =
    !!user?.isAdmin && !teachAvailable && !!menu && isGameReteachable(menu.game);

  return (
    <Screen testID="games-home">
      <ScreenHeader
        left={headerLeft}
        right={
          <>
            <IconButton
              accessibilityLabel="Copy today's scores to clipboard"
              testID="games-copy-scores"
              disabled={copyingScores}
              onPress={() => void onCopyScores()}
            >
              {copyingScores ? (
                <ActivityIndicator color={tokens.text.secondary} />
              ) : (
                <PixelIcon name="copy" />
              )}
            </IconButton>
            <IconButton
              accessibilityLabel="Add a game"
              testID="fab-add-game"
              onPress={() => setAddOpen(true)}
            >
              <PixelIcon name="plus" color={tokens.neon.pink} />
            </IconButton>
            {headerTrailing}
          </>
        }
      />
      {isEmpty ? null : (
        <View style={styles.spine}>
          <DaySpine playedDays={playedDays} activeDays={activeDays} testIDPrefix="games-day" />
        </View>
      )}
      {body}

      <AddGameSheet
        visible={addOpen}
        pending={addMutation.isPending}
        onSubmit={(url) => addMutation.mutate(url)}
        onClose={() => setAddOpen(false)}
        discovery={discoveryQuery.data?.games ?? []}
        discoveryLoading={discoveryQuery.isPending}
        onAddDiscovery={(dg) => addDiscoveryMutation.mutate(dg)}
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
        periodKey={viewDate}
        onSubmit={(game, scoreRaw, extras) =>
          upsertMutation.mutate({ game, scoreRaw, ...(extras ? { extras } : {}) })
        }
        onPostToOther={(other, scoreRaw) =>
          upsertMutation.mutate({
            game: other,
            scoreRaw,
            ...(pasteTarget
              ? {
                  extras: {
                    body: { wrongGame: { gameId: pasteTarget.id, choice: "there" as const } },
                    scoreDirection: null,
                  },
                }
              : {}),
          })
        }
        onClose={dismiss}
      />

      <Sheet
        visible={!!menu}
        onRequestClose={() => setMenuGame(null)}
        onClosed={() => {
          if (reteachAfterMenu) {
            const g = reteachAfterMenu;
            setReteachAfterMenu(null);
            openPasteFor({ id: g.gameId, url: g.game.url });
          }
        }}
        testID="game-menu-sheet"
      >
        {menu ? (
          <>
            <Text variant="heading" numberOfLines={1}>
              {menu.game.title}
            </Text>
            <MenuRow
              icon="external-link"
              label="Open game"
              testID="game-menu-open"
              onPress={() => {
                setMenuGame(null);
                if (viewingToday) markPlaying({ id: menu.gameId, url: menu.game.url });
                else openExternalUrl(menu.game.url);
              }}
            />
            <MenuRow
              icon="chevron-up"
              label="Move up"
              testID="game-menu-move-up"
              disabled={myGames.findIndex((g) => g.gameId === menu.gameId) === 0}
              onPress={() => moveBy(menu, -1)}
            />
            <MenuRow
              icon="chevron-down"
              label="Move down"
              testID="game-menu-move-down"
              disabled={myGames.findIndex((g) => g.gameId === menu.gameId) === myGames.length - 1}
              onPress={() => moveBy(menu, 1)}
            />
            {menuTeachable ? (
              <MenuRow
                icon="sliders"
                label="Re-teach scoring"
                testID="game-menu-reteach"
                onPress={() => {
                  setReteachAfterMenu(menu);
                  setMenuGame(null);
                }}
              />
            ) : null}
            {teachAvailable ? (
              <View style={styles.menuDirection}>
                <Text variant="caption" tone="secondary" testID="game-menu-direction-current">
                  Ranking: {menu.game.scoreDirection === "asc" ? "lower" : "higher"} is better.
                </Text>
                <MenuRow
                  icon="sliders"
                  label={`Change to ${menu.game.scoreDirection === "asc" ? "higher" : "lower"} is better`}
                  testID="game-menu-direction"
                  onPress={() =>
                    directionMutation.mutate({
                      game: menu.game,
                      to: menu.game.scoreDirection === "asc" ? "desc" : "asc",
                    })
                  }
                />
              </View>
            ) : null}
            <MenuRow
              icon="trash"
              label="Remove from My Games"
              tone="danger"
              testID="game-menu-remove"
              onPress={async () => {
                setMenuGame(null);
                const ok = await confirm({
                  title: `Remove ${menu.game.title} from My Games?`,
                  message: "Your past scores stay — re-adding the game brings them back.",
                  confirmLabel: "Remove",
                  destructive: true,
                });
                if (ok) removeMutation.mutate(menu.gameId);
              }}
            />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <View style={styles.section}>
      <Text variant="heading" tone="secondary" style={styles.sectionText}>
        {label}
      </Text>
      <Text variant="score" tone="secondary" style={styles.sectionText}>
        {count}
      </Text>
    </View>
  );
}

function Scorecard({
  loading,
  played,
  total,
  wins,
  bestStreak,
  anyPlays,
  viewingToday,
  hasFriends,
  onAddFriends,
}: {
  loading: boolean;
  played: number;
  total: number;
  wins: number;
  bestStreak: { title: string; days: number } | null;
  anyPlays: boolean;
  viewingToday: boolean;
  hasFriends: boolean;
  onAddFriends: () => void;
}) {
  return (
    <View style={styles.scorecard} testID="games-scorecard">
      {loading ? (
        <Text variant="heading" tone="secondary">
          Loading…
        </Text>
      ) : !anyPlays ? (
        <Text variant="heading" tone="secondary">
          {viewingToday ? "Nobody's played yet" : "Nobody played"}
        </Text>
      ) : (
        <View style={styles.stats}>
          <Stat
            value={`${played}/${total}`}
            label="played"
            tone={played === total ? "success" : "primary"}
          />
          <Stat
            value={String(wins)}
            label={wins === 1 ? "win" : "wins"}
            tone={wins > 0 ? "success" : "primary"}
          />
          {bestStreak ? (
            <Stat value={`🔥${bestStreak.days}`} label={bestStreak.title} tone="success" />
          ) : (
            <Stat value="—" label="streak" tone="primary" />
          )}
        </View>
      )}
      {!loading && !hasFriends ? (
        <Pressable
          onPress={onAddFriends}
          accessibilityRole="button"
          testID="games-scorecard-add-friends"
        >
          <Text variant="caption" tone="link">
            Add friends to compete →
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: "primary" | "success";
}) {
  return (
    <View style={styles.stat}>
      <Text variant="score" tone={tone} style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text variant="caption" tone="secondary" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  testID,
  disabled = false,
  tone = "primary",
}: {
  icon: Parameters<typeof PixelIcon>[0]["name"];
  label: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
  tone?: "primary" | "danger";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      testID={testID}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.menuRow,
        pressed && !disabled && styles.menuRowPressed,
        disabled && styles.menuRowDisabled,
      ]}
    >
      <PixelIcon
        name={icon}
        color={tone === "danger" ? tokens.status.danger : tokens.text.secondary}
      />
      <Text tone={tone === "danger" ? "danger" : "primary"}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  pad: { padding: tokens.space.lg },
  spine: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.xs,
    paddingBottom: tokens.space.xs,
    backgroundColor: tokens.bg.canvas,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.bg.elevated,
    zIndex: 1,
  },
  list: { paddingBottom: tokens.space.xxl },
  scorecard: {
    marginHorizontal: tokens.space.lg,
    marginVertical: tokens.space.md,
    padding: tokens.space.md,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
    gap: tokens.space.sm,
  },
  stats: { flexDirection: "row", gap: tokens.space.md },
  stat: { flex: 1, gap: 2 },
  statValue: { fontSize: 14, lineHeight: 22 },
  rows: {},
  rowsLoading: { opacity: 0.5 },
  section: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xs,
  },
  sectionText: { fontSize: 9, lineHeight: 14 },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.sm,
  },
  menuRowPressed: { backgroundColor: tokens.bg.raised },
  menuRowDisabled: { opacity: 0.4 },
  menuDirection: { gap: tokens.space.xs },
});
