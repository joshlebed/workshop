// One game, every day. The row you tapped on TODAY continues into this
// screen's header — same mark, same place — and below it the day stepper walks
// this game's history.
//
// Rules (unchanged): pasted scores always upload to *today's* bucket whatever
// day the board is showing, and there is no future to step into.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { fetchFriends } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { GameLeaderboardResponse, GameStandingsEntry } from "@workshop/shared/games";
import type { SummarySpec } from "@workshop/shared/summarySpec";
import { confirm, haptics, openExternalUrl } from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { BackKey } from "../../components/BackKey";
import { DateStepper } from "../../components/DateStepper";
import { DETAIL_IDENTITY } from "../../components/Flight";
import { KeyPanel } from "../../components/KeyPanel";
import {
  Avatar,
  Button,
  EmptyState,
  layout,
  PixelIcon,
  Screen,
  Text,
  TextField,
  tokens,
  useToast,
} from "../../theme";
import {
  clearGameScore,
  fetchGameLeaderboard,
  fetchMyGames,
  removeGame,
  setGameScoreSpec,
  upsertGameScore,
} from "../api/games";
import { GameCover } from "../components/GameCover";
import { ReactionPickerSheet } from "../components/ReactionPickerSheet";
import { StandingsRows } from "../components/StandingsRows";
import { useScoreReactions } from "../hooks/useScoreReactions";
import { localDateKey } from "../lib/gameDate";
import { type StandingCell, scoreMark } from "../lib/matrix";
import { goBack } from "../lib/navigation";
import { isGameReteachable, specForGame } from "../lib/scoreSpecs";
import { summarizeGameScoreBody } from "../lib/scoresSummary";
import { useGamesRuntime } from "../runtime";
import { GameScorePasteSheet, type TaughtScoreSpec } from "./GameScorePasteSheet";
import { GameActions } from "./home/GameActions";

export default function GameBoard() {
  const params = useLocalSearchParams<{ id: string }>();
  const gameId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { token, user, routes } = useGamesRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const today = localDateKey();
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  // Admin "re-teach scoring" — the tap-the-score flow, which needs the paste
  // sheet's teach chips rather than this screen's plain composer.
  const [reteaching, setReteaching] = useState(false);

  // The catalog row comes from the My Games query — there's no standalone
  // `GET /v1/games/:id`. Navigation always arrives from home, so it's cached;
  // a cold deep-link refetches the list.
  const myGamesQuery = useQuery({
    queryKey: queryKeys.games.mine(today),
    queryFn: () => fetchMyGames(today, token),
    enabled: !!token,
  });
  const myGame = myGamesQuery.data?.games.find((g) => g.gameId === gameId);
  const game = myGame?.game ?? null;

  const friendsQuery = useQuery({
    queryKey: queryKeys.friends.all,
    queryFn: () => fetchFriends(token),
    enabled: !!token,
  });

  const boardQuery = useQuery({
    queryKey: queryKeys.games.leaderboard(gameId ?? "", date),
    queryFn: () => fetchGameLeaderboard(gameId ?? "", date, token),
    enabled: !!token && !!gameId,
  });

  const upsertMutation = useMutation({
    mutationFn: async ({
      scoreRaw,
      taught,
    }: {
      scoreRaw: string;
      isEdit: boolean;
      taught?: TaughtScoreSpec;
    }) => {
      if (!gameId) throw new Error("missing game id");
      // A taught parser is stored first so this very post parses with it.
      if (taught) await setGameScoreSpec(gameId, taught, token);
      return upsertGameScore(gameId, { periodKey: today, scoreRaw }, token);
    },
    onSuccess: async (_data, variables) => {
      haptics.medium();
      setDraft("");
      setEditing(false);
      setReteaching(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.games.leaderboard(gameId ?? "", today),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(today) }),
      ]);
      showToast({ message: variables.isEdit ? "Score updated" : "Score posted", tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't save score"), tone: "danger" });
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => {
      if (!gameId) throw new Error("missing game id");
      return clearGameScore(gameId, today, token);
    },
    onSuccess: async () => {
      haptics.medium();
      setDraft("");
      setEditing(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.games.leaderboard(gameId ?? "", today),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(today) }),
      ]);
      showToast({ message: "Score cleared", tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't clear score"), tone: "danger" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => {
      if (!gameId) throw new Error("missing game id");
      return removeGame(gameId, token);
    },
    onSuccess: async () => {
      haptics.medium();
      await queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(today) });
      goBack(routes.home);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't remove that game."), tone: "danger" });
    },
  });

  const reactionCtl = useScoreReactions<GameLeaderboardResponse>({
    periodKey: date,
    token,
    viewer: user ? { userId: user.id, displayName: user.displayName ?? null } : null,
    queryKey: queryKeys.games.leaderboard(gameId ?? "", date),
    readReactions: (data, _gameId, scoreUserId) =>
      data.entries.find((e) => e.userId === scoreUserId)?.reactions ?? [],
    writeReactions: (data, _gameId, scoreUserId, next) => ({
      ...data,
      entries: data.entries.map((e) => (e.userId === scoreUserId ? { ...e, reactions: next } : e)),
    }),
  });

  if (!gameId) {
    return (
      <Screen style={styles.center}>
        <EmptyState title="Missing game id" />
      </Screen>
    );
  }

  // Same as the friend profile: hold the identity slot open so the flight has
  // somewhere to land, instead of flashing a centred spinner.
  if (myGamesQuery.isPending) {
    return (
      <Screen testID="game-board">
        <View style={styles.nav}>
          <BackKey label="Today" onPress={() => goBack(routes.home)} testID="game-board-back" />
        </View>
        <View style={styles.identity}>
          <GameCover iconUrl={null} size={DETAIL_IDENTITY.size} />
          <View style={styles.identityText}>
            <View style={styles.skeletonTitle} />
          </View>
        </View>
        <View style={styles.center}>
          <ActivityIndicator color={tokens.neon.pink} />
        </View>
        <KeyPanel active="today" />
      </Screen>
    );
  }

  if (myGamesQuery.isError || !game) {
    return (
      <Screen style={styles.center}>
        <EmptyState
          title={myGamesQuery.isError ? "Can't load this game" : "Not in your games"}
          description={
            myGamesQuery.isError
              ? errorMessage(myGamesQuery.error)
              : "Add it from TODAY to see the board."
          }
          action={
            <Button label="Back to today" variant="secondary" onPress={() => goBack(routes.home)} />
          }
        />
      </Screen>
    );
  }

  const isToday = date === today;
  const entries = boardQuery.data?.entries ?? [];
  const scored = entries.filter((e) => e.scoreRaw && e.scoreRaw.length > 0);
  const myEntry = entries.find((e) => e.userId === user?.id);
  const myScore = myEntry?.scoreRaw && myEntry.scoreRaw.length > 0 ? myEntry.scoreRaw : null;
  const showComposer = isToday && (!myScore || editing);
  const soleWinner = scored.filter((e) => e.rank === 1).length === 1;
  const cells: StandingCell[] = scored.map((entry) =>
    toCell(entry, game, user?.id ?? null, soleWinner),
  );
  const host = hostOf(game.url);
  // Friends who haven't posted this day — the nudge list, and the reason the
  // bottom of this screen isn't empty.
  const posted = new Set(scored.map((e) => e.userId));
  const missing = (friendsQuery.data?.friends ?? []).filter((f) => !posted.has(f.userId));

  const onSubmit = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    upsertMutation.mutate({ scoreRaw: trimmed, isEdit: editing });
  };

  const onRemoveGame = async () => {
    const ok = await confirm({
      title: `Remove ${game.title}?`,
      message: "Your past scores stay — re-adding the game brings them back.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) removeMutation.mutate();
  };

  const onDate = (key: string) => {
    setDate(key);
    setDraft("");
    setEditing(false);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen testID="game-board">
        <View style={styles.nav}>
          <BackKey label="Today" onPress={() => goBack(routes.home)} testID="game-board-back" />
        </View>

        {/* Flight destination — `DETAIL_IDENTITY` pins the mark's size and
            offset so the row that was tapped lands exactly here. */}
        <View style={styles.identity}>
          <GameCover iconUrl={game.iconUrl} size={DETAIL_IDENTITY.size} />
          <View style={styles.identityText}>
            <Text variant="title" numberOfLines={2}>
              {game.title}
            </Text>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Play ${game.title}`}
              accessibilityHint="Opens the game in your browser"
              onPress={() => openExternalUrl(game.url)}
              testID="game-board-title-link"
              hitSlop={6}
              style={({ pressed }) => [styles.host, pressed && styles.hostPressed]}
            >
              <Text variant="caption" style={styles.hostLabel} numberOfLines={1}>
                {host ?? "Play"}
              </Text>
              <PixelIcon name="external-link" size={12} color={tokens.neon.pinkTint} />
            </Pressable>
          </View>
        </View>

        <View style={styles.stepperRow}>
          <DateStepper
            date={date}
            today={today}
            onChange={onDate}
            absolute
            testID="game-board-day"
          />
          {boardQuery.isPending ? null : (
            <Text variant="caption" tone="secondary">
              {scored.length === 0
                ? isToday
                  ? "No plays yet"
                  : "No plays"
                : `${scored.length} played`}
            </Text>
          )}
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {showComposer ? (
            <ScoreComposer
              mode={myScore ? "edit" : "new"}
              draft={draft}
              baseline={myScore ?? ""}
              onChangeDraft={setDraft}
              onSubmit={onSubmit}
              onCancel={() => {
                setDraft("");
                setEditing(false);
              }}
              pending={upsertMutation.isPending}
            />
          ) : null}

          {boardQuery.isPending ? (
            <View style={styles.center}>
              <ActivityIndicator color={tokens.neon.pink} />
            </View>
          ) : boardQuery.isError ? (
            <View style={styles.errorBlock}>
              <Text tone="danger">Couldn't load scores.</Text>
              <Button
                label="Try again"
                variant="secondary"
                size="sm"
                pixel
                onPress={() => boardQuery.refetch()}
                loading={boardQuery.isFetching}
                testID="game-board-scores-retry"
              />
            </View>
          ) : (
            <StandingsRows
              cells={cells}
              expandGrids
              selfActions={
                myScore && isToday ? (
                  <View style={styles.myActions}>
                    <TextKey
                      label="Edit"
                      onPress={() => {
                        setDraft(myEntry?.scoreRaw ?? "");
                        setEditing(true);
                      }}
                      testID="game-board-edit-score"
                    />
                    <TextKey
                      label="Clear"
                      onPress={async () => {
                        const ok = await confirm({
                          title: "Clear your score for today?",
                          message: "Your result is removed. Scores on other days are kept.",
                          confirmLabel: "Clear",
                          destructive: true,
                        });
                        if (ok) clearMutation.mutate();
                      }}
                      testID="game-board-clear-score"
                    />
                  </View>
                ) : null
              }
              onPressPlayer={(userId) => router.push(routes.friendProfile(userId) as Href)}
              onReact={(userId, emoji, reacted) =>
                reactionCtl.react(gameId, userId, emoji, reacted)
              }
              onOpenReactionPicker={(userId) =>
                reactionCtl.openPicker(
                  gameId,
                  userId,
                  cells.find((c) => c.userId === userId)?.displayName ?? null,
                )
              }
              emptyLabel={isToday ? "Nobody's played yet today." : "Nobody played this day."}
              testIDPrefix="game-board"
            />
          )}

          {missing.length > 0 ? (
            <View style={styles.missing} testID="game-board-missing">
              <Text variant="eyebrow" tone="secondary" style={styles.sectionLabel}>
                {isToday ? "Still owe a score" : "Didn't play"}
              </Text>
              <View style={styles.faces}>
                {missing.map((friend) => (
                  <Pressable
                    key={friend.userId}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${friend.displayName?.trim() || "friend"}`}
                    onPress={() => router.push(routes.friendProfile(friend.userId) as Href)}
                    style={({ pressed }) => [styles.face, pressed && styles.hostPressed]}
                  >
                    <Avatar
                      name={friend.displayName}
                      imageUrl={userAvatarImageUrl(friend.userId)}
                      size="sm"
                    />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <GameActions
            onOpenGame={() => openExternalUrl(game.url)}
            {...(user?.isAdmin && isGameReteachable(game)
              ? { onReteach: () => setReteaching(true) }
              : {})}
            onRemove={onRemoveGame}
          />
        </ScrollView>

        <GameScorePasteSheet
          item={reteaching ? game : null}
          userName={user?.displayName ?? null}
          userAvatarUrl={user?.avatarUrl ?? null}
          pending={upsertMutation.isPending}
          spec={specForGame(game)}
          canReteach
          onTeach={(_g, scoreRaw, taught) =>
            upsertMutation.mutate({ scoreRaw, isEdit: !!myScore, taught })
          }
          onSubmit={(_g, scoreRaw) => upsertMutation.mutate({ scoreRaw, isEdit: !!myScore })}
          onClose={() => setReteaching(false)}
        />

        <ReactionPickerSheet
          visible={!!reactionCtl.target}
          targetName={reactionCtl.target?.name ?? null}
          current={reactionCtl.currentEmoji}
          onPick={reactionCtl.pick}
          onRemove={reactionCtl.removeReaction}
          onClose={reactionCtl.closePicker}
        />

        <KeyPanel active="today" />
      </Screen>
    </KeyboardAvoidingView>
  );
}

function toCell(
  entry: GameStandingsEntry,
  game: { title: string; url: string | null; summarySpec?: SummarySpec | null },
  selfId: string | null,
  soleWinner: boolean,
): StandingCell {
  const body = summarizeGameScoreBody(game, entry);
  return {
    userId: entry.userId,
    displayName: entry.displayName,
    isSelf: entry.userId === selfId,
    rank: entry.rank,
    outrightFirst: entry.rank === 1 && soleWinner,
    glyph: scoreMark(entry, body),
    mark: scoreMark(entry, body),
    body,
    reactions: entry.reactions,
    updatedAt: entry.updatedAt,
  };
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A quiet text-only control — for actions that live inside a data row. */
function TextKey({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      testID={testID}
      style={({ pressed }) => [styles.textKey, pressed && styles.hostPressed]}
    >
      <Text variant="cell" tone="link">
        {label}
      </Text>
    </Pressable>
  );
}

interface ScoreComposerProps {
  mode: "new" | "edit";
  draft: string;
  baseline: string;
  onChangeDraft: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  pending: boolean;
}

// The paste slot. On today only — scores always upload to today's bucket.
function ScoreComposer({
  mode,
  draft,
  baseline,
  onChangeDraft,
  onSubmit,
  onCancel,
  pending,
}: ScoreComposerProps) {
  const isEdit = mode === "edit";
  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && !(isEdit && trimmed === baseline.trim()) && !pending;
  // On web, Enter posts — results arrive via paste, so a newline keystroke is
  // almost never intentional (Shift+Enter still inserts one). RN-Web's
  // TextInput overwrites any custom onKeyDown with its own handler, which only
  // routes Enter to onSubmitEditing when blurOnSubmit is set on a multiline.
  const webProps =
    Platform.OS === "web"
      ? {
          blurOnSubmit: true,
          onSubmitEditing: () => {
            if (canSubmit) onSubmit();
          },
        }
      : {};
  return (
    <View style={styles.composer} testID="game-board-paste-slot">
      <Text variant="eyebrow" tone="secondary" style={styles.composerLabel}>
        {isEdit ? "Fix your result" : "Paste your result"}
      </Text>
      <TextField
        testID="game-board-paste-input"
        value={draft}
        onChangeText={onChangeDraft}
        placeholder="Paste your result here"
        multiline
        mono
        autoFocus={isEdit}
        maxLength={2000}
        style={styles.input}
        {...webProps}
      />
      <View style={styles.composerActions}>
        {isEdit ? (
          <Button
            label="Cancel"
            variant="ghost"
            size="sm"
            pixel
            onPress={onCancel}
            disabled={pending}
            testID="game-board-edit-cancel"
          />
        ) : null}
        <Button
          label={isEdit ? "Save" : "Post"}
          size="sm"
          pixel
          onPress={onSubmit}
          disabled={!canSubmit}
          loading={pending}
          testID="game-board-paste-submit"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  // Sized so the identity block below starts exactly at `DETAIL_IDENTITY.top`.
  nav: { height: DETAIL_IDENTITY.top, justifyContent: "center" },
  identity: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.space.sm,
    paddingHorizontal: layout.inset,
  },
  identityText: { flex: 1, minWidth: 0, gap: 2 },
  host: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  hostPressed: { opacity: 0.6 },
  hostLabel: { color: tokens.neon.pinkTint },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.inset,
    paddingTop: tokens.space.sm,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
    paddingBottom: tokens.space.xs,
    marginTop: tokens.space.sm,
  },
  body: {
    paddingHorizontal: layout.inset,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.xl,
    gap: tokens.space.md,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: tokens.space.lg },
  errorBlock: { gap: tokens.space.sm, alignItems: "flex-start" },
  skeletonTitle: { width: 168, height: 18, backgroundColor: tokens.bg.surface },
  missing: { gap: tokens.space.xs, paddingTop: tokens.space.sm },
  sectionLabel: { letterSpacing: 1 },
  faces: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.xs, opacity: 0.5 },
  face: {},
  myActions: { flexDirection: "row", gap: tokens.space.sm, paddingTop: 2 },
  textKey: { paddingHorizontal: 2 },
  composer: { gap: tokens.space.sm },
  composerLabel: { letterSpacing: 1 },
  input: { minHeight: 72 },
  composerActions: { flexDirection: "row", justifyContent: "flex-end", gap: tokens.space.sm },
});
