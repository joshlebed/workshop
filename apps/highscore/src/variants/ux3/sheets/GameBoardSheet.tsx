// One game's board, as a sheet over the timeline.
//
// The feed answers "what happened today"; this answers "how does this one game
// go". Days move sideways here — swipe (or tap the arrows) to walk back through
// the history of a single game, while the vertical axis of the app behind you
// stays put. Scores can only ever be posted to today, so the composer only
// exists on the today page.
//
// This sheet also absorbed the old card kebab menu: opening the game, removing
// it from My Games and (for admins) re-teaching its parser all live at the
// bottom of the board they belong to, rather than behind a "⋯" in the feed.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { Game, GameLeaderboardResponse, GameStandingsEntry } from "@workshop/shared/games";
import { confirm, haptics, openExternalUrl } from "@workshop/ui";
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  clearGameScore,
  fetchGameLeaderboard,
  fetchMyGames,
  removeGame,
  setGameScoreSpec,
  upsertGameScore,
} from "../games/api/games";
import { ReactionPickerSheet } from "../games/components/ReactionPickerSheet";
import { ScoreReactions } from "../games/components/ScoreReactions";
import { useScoreReactions } from "../games/hooks/useScoreReactions";
import { localDateKey, shiftDateKey } from "../games/lib/gameDate";
import { isGameReteachable, specForGame } from "../games/lib/scoreSpecs";
import { useGamesRuntime } from "../games/runtime";
import { GameScorePasteSheet, type TaughtScoreSpec } from "../games/screens/GameScorePasteSheet";
import { SheetFrame } from "../nav/SheetFrame";
import type { SheetNav } from "../nav/SheetHost";
import { Avatar, Skeleton, Text, tokens, useToast } from "../theme";
import { dayHeading } from "../timeline/dayLabels";
import { scoreDisplay } from "../timeline/scoreDisplay";
import { DayPager } from "./DayPager";

const SWIPE_DISTANCE = 56;

export function GameBoardSheet({ gameId, nav }: { gameId: string; nav: SheetNav }) {
  const { token, user } = useGamesRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const today = localDateKey();
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState("");
  const [editingScore, setEditingScore] = useState(false);
  const [reteachOpen, setReteachOpen] = useState(false);

  const pageX = useSharedValue(0);
  const pageOpacity = useSharedValue(1);
  const pageStyle = useAnimatedStyle(() => ({
    opacity: pageOpacity.value,
    transform: [{ translateX: pageX.value }],
  }));

  // The catalog row (title / URL) comes from the My Games query — there's no
  // standalone `GET /v1/games/:id`. A cold deep link refetches the list.
  const myGamesQuery = useQuery({
    queryKey: queryKeys.games.mine(today),
    queryFn: () => fetchMyGames(today, token),
    enabled: !!token,
  });
  const myGame = myGamesQuery.data?.games.find((g) => g.gameId === gameId);
  const game = myGame?.game ?? null;

  const boardQuery = useQuery({
    queryKey: queryKeys.games.leaderboard(gameId, date),
    queryFn: () => fetchGameLeaderboard(gameId, date, token),
    enabled: !!token && !!gameId,
  });

  const goToDay = (next: string, direction: 1 | -1) => {
    if (next > today) return;
    setDate(next);
    setDraft("");
    setEditingScore(false);
    pageX.value = direction * 24;
    pageOpacity.value = 0;
    pageX.value = withTiming(0, {
      duration: tokens.motion.fast,
      easing: Easing.out(Easing.quad),
    });
    pageOpacity.value = withTiming(1, { duration: tokens.motion.fast });
  };
  const prevDay = () => goToDay(shiftDateKey(date, -1), -1);
  const nextDay = () => goToDay(shiftDateKey(date, 1), 1);

  // Horizontal-only: `failOffsetY` hands vertical drags back to the scroll
  // view and to the sheet's own dismiss gesture.
  const swipe = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onEnd((event) => {
      if (event.translationX > SWIPE_DISTANCE) runOnJS(prevDay)();
      else if (event.translationX < -SWIPE_DISTANCE) runOnJS(nextDay)();
    });

  const upsertMutation = useMutation({
    mutationFn: ({ scoreRaw }: { scoreRaw: string; isEdit: boolean }) =>
      upsertGameScore(gameId, { periodKey: today, scoreRaw }, token),
    onSuccess: async (_data, variables) => {
      haptics.medium();
      setDraft("");
      setEditingScore(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.games.leaderboard(gameId, today) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(today) }),
      ]);
      showToast({ message: variables.isEdit ? "Score updated" : "Score posted", tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't save score"), tone: "danger" });
    },
  });

  const _clearMutation = useMutation({
    mutationFn: () => clearGameScore(gameId, today, token),
    onSuccess: async () => {
      haptics.medium();
      setDraft("");
      setEditingScore(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.games.leaderboard(gameId, today) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(today) }),
      ]);
      showToast({ message: "Score cleared", tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't clear score"), tone: "danger" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => removeGame(gameId, token),
    onSuccess: async () => {
      haptics.medium();
      await queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(today) });
      nav.close();
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't remove that game."), tone: "danger" });
    },
  });

  const reteachMutation = useMutation({
    mutationFn: async ({ scoreRaw, taught }: { scoreRaw: string; taught?: TaughtScoreSpec }) => {
      if (taught) await setGameScoreSpec(gameId, taught, token);
      return upsertGameScore(gameId, { periodKey: today, scoreRaw }, token);
    },
    onSuccess: async () => {
      haptics.medium();
      setReteachOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.games.leaderboard(gameId, today) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(today) }),
      ]);
      showToast({ message: "Scoring updated", tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't save score"), tone: "danger" });
    },
  });

  const reactionCtl = useScoreReactions<GameLeaderboardResponse>({
    periodKey: date,
    token,
    viewer: user ? { userId: user.id, displayName: user.displayName ?? null } : null,
    queryKey: queryKeys.games.leaderboard(gameId, date),
    readReactions: (data, _gameId, scoreUserId) =>
      data.entries.find((e) => e.userId === scoreUserId)?.reactions ?? [],
    writeReactions: (data, _gameId, scoreUserId, next) => ({
      ...data,
      entries: data.entries.map((e) => (e.userId === scoreUserId ? { ...e, reactions: next } : e)),
    }),
  });

  const heading = dayHeading(date, today);
  const isToday = date === today;
  const entries = boardQuery.data?.entries ?? [];
  const myEntry = entries.find((e) => e.userId === user?.id);
  const otherEntries = entries.filter((e) => e.userId !== user?.id);
  const myScore = myEntry?.scoreRaw && myEntry.scoreRaw.length > 0 ? myEntry.scoreRaw : null;
  const showComposer = isToday && (!myScore || editingScore);

  const onSubmit = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    upsertMutation.mutate({ scoreRaw: trimmed, isEdit: editingScore });
  };

  const onRemove = async () => {
    const ok = await confirm({
      title: `Remove ${game?.title ?? "this game"} from your games?`,
      message: "Your past scores stay — re-adding the game brings them back.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) removeMutation.mutate();
  };

  if (myGamesQuery.isPending) {
    return (
      <SheetFrame title="Game" nav={nav} testID="game-board">
        <Skeleton lines={5} />
      </SheetFrame>
    );
  }

  if (!game) {
    return (
      <SheetFrame title="Not in your games" nav={nav} testID="game-board">
        <Text tone="secondary">
          {myGamesQuery.isError
            ? errorMessage(myGamesQuery.error)
            : "This game isn't in your games any more."}
        </Text>
      </SheetFrame>
    );
  }

  const canReteach = !!user?.isAdmin && isGameReteachable(game);

  return (
    <>
      <SheetFrame
        title={game.title}
        onPressTitle={() => openExternalUrl(game.url)}
        onPressTitleLabel={`Play ${game.title}`}
        testID="game-board"
        nav={nav}
        sub={
          <DayPager
            date={date}
            today={today}
            label={heading.label}
            sublabel={heading.date}
            onPrev={prevDay}
            onNext={nextDay}
            onJump={(daysBack) => {
              const next = shiftDateKey(today, -daysBack);
              if (next !== date) goToDay(next, next < date ? -1 : 1);
            }}
          />
        }
      >
        <GestureDetector gesture={swipe}>
          <Animated.View style={[styles.page, pageStyle]}>
            {boardQuery.isPending ? (
              <Skeleton lines={4} />
            ) : boardQuery.isError ? (
              <View style={styles.errorBlock}>
                <Text tone="danger">Couldn't load scores.</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Try again"
                  onPress={() => boardQuery.refetch()}
                  testID="game-board-scores-retry"
                  style={styles.textButton}
                >
                  <Text variant="heading" tone="link">
                    Try again
                  </Text>
                </Pressable>
              </View>
            ) : (
              <>
                {showComposer ? (
                  <ScoreComposer
                    mode={myScore ? "edit" : "new"}
                    draft={draft}
                    baseline={myScore ?? ""}
                    onChangeDraft={setDraft}
                    onSubmit={onSubmit}
                    onCancel={() => {
                      setDraft("");
                      setEditingScore(false);
                    }}
                    pending={upsertMutation.isPending}
                    userName={user?.displayName ?? null}
                    userAvatarUrl={user?.avatarUrl ?? null}
                  />
                ) : myEntry ? (
                  <EntryRow
                    entry={myEntry}
                    game={game}
                    isMe
                    {...(isToday
                      ? {
                          onEdit: () => {
                            setDraft(myEntry.scoreRaw ?? "");
                            setEditingScore(true);
                          },
                        }
                      : {})}
                  />
                ) : (
                  <View style={styles.unplayed} testID="game-board-my-unplayed">
                    <Text variant="caption" tone="muted">
                      You didn't play this day.
                    </Text>
                  </View>
                )}

                {otherEntries.map((entry) => (
                  <EntryRow
                    key={entry.userId}
                    entry={entry}
                    game={game}
                    isMe={false}
                    onReact={(userId, emoji, cur) => reactionCtl.react(gameId, userId, emoji, cur)}
                    onOpenReactionPicker={(userId) =>
                      reactionCtl.openPicker(gameId, userId, entry.displayName ?? null)
                    }
                  />
                ))}

                {entries.length === 0 ? (
                  <Text variant="caption" tone="muted">
                    {isToday ? "Nobody has played yet today." : "Nobody played."}
                  </Text>
                ) : null}
              </>
            )}
          </Animated.View>
        </GestureDetector>

        <View style={styles.manage}>
          {canReteach ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Re-teach scoring"
              onPress={() => setReteachOpen(true)}
              testID="game-menu-reteach"
              style={styles.textButton}
            >
              <Text variant="eyebrow" tone="secondary">
                Admin · re-teach scoring
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${game.title} from your games`}
            onPress={onRemove}
            testID="game-menu-remove"
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.textButton,
              (pressed || hovered) && styles.dangerPressed,
            ]}
          >
            {/* Quiet until you reach for it: a permanent red footer on every
                board makes deleting the loudest thing on the screen. */}
            <Text variant="eyebrow" tone="secondary">
              Remove from my games
            </Text>
          </Pressable>
        </View>
      </SheetFrame>

      <ReactionPickerSheet
        visible={!!reactionCtl.target}
        targetName={reactionCtl.target?.name ?? null}
        current={reactionCtl.currentEmoji}
        onPick={reactionCtl.pick}
        onRemove={reactionCtl.removeReaction}
        onClose={reactionCtl.closePicker}
      />

      <GameScorePasteSheet
        item={reteachOpen ? game : null}
        pending={reteachMutation.isPending}
        spec={specForGame(game)}
        canReteach
        onTeach={(_game, scoreRaw, taught) => reteachMutation.mutate({ scoreRaw, taught })}
        onSubmit={(_game, scoreRaw) => reteachMutation.mutate({ scoreRaw })}
        onClose={() => setReteachOpen(false)}
      />
    </>
  );
}

interface EntryRowProps {
  entry: GameStandingsEntry;
  game: Pick<Game, "title" | "url" | "summarySpec">;
  isMe: boolean;
  onEdit?: () => void;
  onReact?: (userId: string, emoji: string, currentlyReacted: boolean) => void;
  onOpenReactionPicker?: (userId: string) => void;
}

function EntryRow({ entry, game, isMe, onEdit, onReact, onOpenReactionPicker }: EntryRowProps) {
  const name = entry.displayName ?? "Someone";
  const { value, strip } = scoreDisplay(game, entry);
  const canReact = !isMe && !!onOpenReactionPicker;

  const content = (
    <View style={[styles.entry, isMe && styles.entryMe]} testID={`game-board-row-${entry.userId}`}>
      <View style={styles.entryHead}>
        <Text
          variant="score"
          tone={entry.rank === 1 ? "spotlight" : "secondary"}
          style={styles.entryRank}
        >
          {entry.rank ?? "–"}
        </Text>
        <Avatar name={entry.displayName} imageUrl={userAvatarImageUrl(entry.userId)} size="sm" />
        <Text variant="label" numberOfLines={1} style={styles.entryName}>
          {isMe ? "You" : name}
        </Text>
        {value ? (
          <Text variant="display" style={styles.entryValue}>
            {value}
          </Text>
        ) : null}
        {onEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit your score"
            onPress={onEdit}
            testID="game-board-edit-score"
            hitSlop={8}
            style={styles.rowAction}
          >
            <Text variant="eyebrow" tone="link">
              Edit
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.entryBody}>
        <Text
          variant="mono"
          tone="secondary"
          testID={`game-board-score-${entry.userId}`}
          style={styles.entryScore}
        >
          {strip ?? (value ? "" : "Played")}
        </Text>
      </View>
      {entry.reactions.length > 0 ? (
        <View style={styles.entryReactions}>
          <ScoreReactions
            reactions={entry.reactions}
            testIDPrefix={`game-board-react-${entry.userId}`}
            {...(canReact && onReact
              ? { onToggle: (emoji: string, cur: boolean) => onReact(entry.userId, emoji, cur) }
              : {})}
          />
        </View>
      ) : null}
    </View>
  );

  // Tapping a friend's row reacts to it — the same gesture as the feed, and the
  // only one. A "REACT" word under every score is the label four times.
  if (!canReact) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`React to ${name}'s score`}
      onPress={() => onOpenReactionPicker?.(entry.userId)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        (pressed || hovered) && styles.entryActive,
      ]}
    >
      {content}
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
  /** Only in edit mode: destroy today's result. Lives here, not on the row. */
  onClear?: () => void;
  pending: boolean;
  userName: string | null;
  userAvatarUrl?: string | null;
}

function ScoreComposer({
  mode,
  draft,
  baseline,
  onChangeDraft,
  onSubmit,
  onCancel,
  onClear,
  pending,
  userName,
  userAvatarUrl,
}: ScoreComposerProps) {
  const isEdit = mode === "edit";
  const trimmed = draft.trim();
  const unchanged = isEdit && trimmed === baseline.trim();
  const canSubmit = trimmed.length > 0 && !unchanged && !pending;
  // On web, Enter posts — results arrive via paste, so a newline keystroke is
  // almost never intentional (Shift+Enter still inserts one).
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
    <View style={[styles.entry, styles.entryMe]} testID="game-board-paste-slot">
      <View style={styles.entryHead}>
        <Avatar name={userName} imageUrl={userAvatarUrl} size="sm" />
        <Text variant="label" style={styles.entryName}>
          {userName?.trim() || "You"}
        </Text>
        <Text variant="eyebrow" tone="secondary">
          {isEdit ? "Editing" : "Paste to post"}
        </Text>
      </View>
      <TextInput
        testID="game-board-paste-input"
        value={draft}
        onChangeText={onChangeDraft}
        placeholder="Paste your result here"
        placeholderTextColor={tokens.text.muted}
        multiline
        autoFocus={isEdit}
        maxLength={2000}
        style={styles.input}
        {...webProps}
      />
      <View style={styles.composerActions}>
        {isEdit && onClear ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear your score for today"
            onPress={onClear}
            disabled={pending}
            testID="game-board-clear-score"
            style={styles.textButton}
          >
            <Text variant="eyebrow" tone="danger">
              Clear
            </Text>
          </Pressable>
        ) : null}
        {isEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            onPress={onCancel}
            disabled={pending}
            testID="game-board-edit-cancel"
            style={styles.textButton}
          >
            <Text variant="eyebrow" tone="secondary">
              Cancel
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isEdit ? "Save" : "Post score"}
          onPress={onSubmit}
          disabled={!canSubmit}
          testID="game-board-paste-submit"
          style={({ pressed }) => [
            styles.postButton,
            !canSubmit && styles.postButtonOff,
            pressed && canSubmit && styles.dangerPressed,
          ]}
        >
          {pending ? (
            <ActivityIndicator size="small" color={tokens.neon.pink} />
          ) : (
            <Text variant="heading" tone={canSubmit ? "link" : "secondary"}>
              {isEdit ? "Save" : "Post"}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: tokens.space.md },
  errorBlock: { gap: tokens.space.sm, alignItems: "flex-start" },
  entry: {
    gap: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    paddingLeft: tokens.space.sm,
    borderLeftWidth: tokens.bezel,
    borderLeftColor: "transparent",
  },
  entryMe: { borderLeftColor: tokens.neon.pink },
  entryHead: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  entryRank: { width: 16, textAlign: "right" },
  entryName: { flex: 1, minWidth: 0, color: tokens.text.primary },
  entryValue: { color: tokens.text.primary },
  entryBody: { paddingLeft: 16 + tokens.space.sm },
  entryReactions: { paddingLeft: 16 + tokens.space.md * 2 },
  entryActive: { backgroundColor: tokens.bg.surface },
  entryScore: { flex: 1, minWidth: 0 },
  unplayed: { paddingVertical: tokens.space.sm },
  rowAction: { paddingHorizontal: tokens.space.sm, paddingVertical: tokens.space.xs },
  input: {
    minHeight: 96,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.md,
    color: tokens.text.primary,
    fontSize: tokens.font.size.sm,
    backgroundColor: tokens.bg.canvas,
    textAlignVertical: "top",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: tokens.font.size.sm + 6,
  },
  composerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: tokens.space.md,
  },
  postButton: {
    paddingHorizontal: tokens.space.lg,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
  },
  postButtonOff: { borderColor: tokens.border.default },
  dangerPressed: { backgroundColor: tokens.bg.raised },
  textButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    alignSelf: "flex-start",
  },
  manage: {
    marginTop: tokens.space.xl,
    paddingTop: tokens.space.md,
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
    gap: tokens.space.xs,
  },
});
