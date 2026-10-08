// Box score — one game, one day: the full ranking with recaps and reactions,
// your composer (or your row with Edit / Clear / Fix), and the game's last
// seven days as a strip. The day is the shared `viewDay`, controlled by the
// same `DateBar` as home; `?date=` from a card tap or deep link seeds it once.
//
// Posting here files the score under the day being viewed, so a puzzle
// finished after midnight can still land on "yesterday".

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { GameLeaderboardResponse } from "@workshop/shared/games";
import { STREAK_MIN_DAYS } from "@workshop/shared/games";
import { confirm, haptics, openExternalUrl, useToast } from "@workshop/ui";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { ReportSheet } from "../../moderation/ReportSheet";
import { useScoreReportFlow } from "../../moderation/useScoreReportFlow";
import { Avatar, Button, IconButton, PixelIcon, Screen, Text, tokens } from "../../theme";
import { clearGameScore, fetchGameLeaderboard, fetchMyGames, upsertGameScore } from "../api/games";
import { BoardRow } from "../components/BoardRow";
import { DateBar } from "../components/DateBar";
import { DayPickerSheet } from "../components/DayPickerSheet";
import { DayStrip, type DayStripCell } from "../components/DayStrip";
import { FixScoreSheet, type FixScoreTarget } from "../components/FixScoreSheet";
import { ReactionPickerSheet } from "../components/ReactionPickerSheet";
import { ScoreCheckPanel } from "../components/ScoreCheckPanel";
import { DAY_RANGE_LENGTH, useDayRange } from "../hooks/useDayRange";
import { useOpenProfile } from "../hooks/useOpenProfile";
import { useScoreReactions } from "../hooks/useScoreReactions";
import { askScoreDirection } from "../lib/askScoreDirection";
import { calendarLabel, localDateKey, resolveRailDate } from "../lib/gameDate";
import { goBack } from "../lib/navigation";
import { shortScore } from "../lib/shortScore";
import { teachAfterPost, teachOutcomeMessage } from "../lib/teachAfterPost";
import { type ScorePostExtras, useScoreCheck, useTeachAvailable } from "../lib/useScoreCheck";
import { useGamesRuntime } from "../runtime";
import { useViewDay } from "../state/viewDay";

const WEEKDAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

export default function GameBoard() {
  const params = useLocalSearchParams<{ id: string; date?: string }>();
  const gameId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { token, user, routes } = useGamesRuntime();
  const openProfile = useOpenProfile();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const today = localDateKey();
  const { viewDate: date, setViewDate } = useViewDay();
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only param sync
  useEffect(() => {
    if (params.date != null) setViewDate(resolveRailDate(params.date, today, 366));
  }, []);
  const [draft, setDraft] = useState("");
  const [editingScore, setEditingScore] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const teachAvailable = useTeachAvailable();
  const [fixTarget, setFixTarget] = useState<FixScoreTarget | null>(null);

  const myGamesQuery = useQuery({
    queryKey: queryKeys.games.mine(today),
    queryFn: () => fetchMyGames(today, token),
    enabled: !!token,
  });
  const myGame = myGamesQuery.data?.games.find((g) => g.gameId === gameId);
  const game = myGame?.game ?? null;

  const boardQuery = useQuery({
    queryKey: queryKeys.games.leaderboard(gameId ?? "", date),
    queryFn: () => fetchGameLeaderboard(gameId ?? "", date, token),
    enabled: !!token && !!gameId,
  });

  // The strip: your result per day over the last week, from the cached
  // per-day My Games queries (shared with home).
  const range = useDayRange(today, DAY_RANGE_LENGTH);
  const stripCells = useMemo<DayStripCell[]>(
    () =>
      range.map((day) => {
        const g = day.data?.games.find((x) => x.gameId === gameId);
        const scored = (g?.standings.entries ?? []).filter((e) => e.scoreRaw);
        const mine = scored.find((e) => e.userId === user?.id);
        return {
          date: day.date,
          weekday: WEEKDAY_LETTER[new Date(`${day.date}T12:00:00`).getDay()] ?? "",
          value: mine ? shortScore(mine) : null,
          active: scored.length > 0,
          won: mine?.rank === 1,
        };
      }),
    [range, gameId, user?.id],
  );
  const stripLoading = range.some((d) => d.isPending);

  const upsertMutation = useMutation({
    mutationFn: ({
      scoreRaw,
      periodKey,
      extras,
      postTo,
    }: {
      scoreRaw: string;
      periodKey: string;
      isEdit: boolean;
      extras?: ScorePostExtras;
      postTo?: { id: string; title: string };
    }) => {
      const target = postTo?.id ?? gameId;
      if (!target) throw new Error("missing game id");
      return upsertGameScore(
        target,
        { periodKey, scoreRaw, entrySource: "paste", ...extras?.body },
        token,
      );
    },
    onSuccess: async (data, variables) => {
      haptics.medium();
      setDraft("");
      setEditingScore(false);
      const refresh = () =>
        Promise.all([
          queryClient.invalidateQueries({
            queryKey: queryKeys.games.leaderboard(gameId ?? "", variables.periodKey),
          }),
          queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(today) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(variables.periodKey) }),
        ]);
      await refresh();
      showToast({
        message: variables.postTo
          ? `Posted to ${variables.postTo.title}`
          : variables.isEdit
            ? "Score updated"
            : "Score posted",
        tone: "success",
      });
      const taughtGameId = variables.postTo?.id ?? gameId;
      if (!taughtGameId) return;
      const taught = await teachAfterPost({
        gameId: taughtGameId,
        periodKey: variables.periodKey,
        hint: data.teach,
        scoreDirection: variables.extras?.scoreDirection ?? null,
        askDirection: askScoreDirection(variables.postTo?.title ?? game?.title ?? "this game"),
        token,
      });
      if (taught) {
        await Promise.all([
          refresh(),
          queryClient.invalidateQueries({ queryKey: ["game-score-check"] }),
        ]);
      }
      const message = teachOutcomeMessage(taught, variables.postTo?.title ?? game?.title ?? "");
      if (message) showToast({ message, tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't save score"), tone: "danger" });
    },
  });

  const clearMutation = useMutation({
    mutationFn: (periodKey: string) => {
      if (!gameId) throw new Error("missing game id");
      return clearGameScore(gameId, periodKey, token);
    },
    onSuccess: async (_data, periodKey) => {
      haptics.medium();
      setDraft("");
      setEditingScore(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.games.leaderboard(gameId ?? "", periodKey),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(today) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(periodKey) }),
      ]);
      showToast({ message: "Score cleared", tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't clear score"), tone: "danger" });
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
  const reportFlow = useScoreReportFlow(reactionCtl.closePicker);

  if (!gameId || myGamesQuery.isPending || myGamesQuery.isError || !game) {
    return (
      <Screen style={styles.center}>
        {myGamesQuery.isPending ? (
          <ActivityIndicator color={tokens.neon.pink} />
        ) : (
          <>
            <Text variant="heading">
              {myGamesQuery.isError ? "COULDN'T LOAD" : "NOT IN MY GAMES"}
            </Text>
            {myGamesQuery.isError ? (
              <Button label="Retry" variant="secondary" onPress={() => myGamesQuery.refetch()} />
            ) : (
              <Button label="Back" variant="secondary" onPress={() => goBack(routes.home)} />
            )}
          </>
        )}
      </Screen>
    );
  }

  const isToday = date === today;
  const entries = boardQuery.data?.entries ?? [];
  const myEntry = entries.find((e) => e.userId === user?.id);
  const myScore = myEntry?.scoreRaw && myEntry.scoreRaw.length > 0 ? myEntry.scoreRaw : null;
  const showComposer = !myScore || editingScore;
  const composerMode: "new" | "edit" = myScore ? "edit" : "new";
  const streak = myGame?.standings.viewerStreak ?? 0;
  const played = entries.filter((e) => e.scoreRaw).length;
  const turnout = boardQuery.isPending
    ? "LOADING"
    : played === 0
      ? isToday
        ? "NOBODY YET"
        : "NO PLAYS"
      : played === 1 && myEntry
        ? "ONLY YOU"
        : `${played} PLAYED`;

  const onDate = (key: string) => {
    setViewDate(key);
    setDraft("");
    setEditingScore(false);
  };

  const onSubmit = (extras?: ScorePostExtras) => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    upsertMutation.mutate({
      scoreRaw: trimmed,
      periodKey: date,
      isEdit: editingScore,
      ...(extras ? { extras } : {}),
    });
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen testID="game-board">
        <View style={styles.headerNav}>
          <IconButton
            accessibilityLabel="Back"
            onPress={() => goBack(routes.home)}
            testID="game-board-back"
          >
            <PixelIcon name="arrow-left" color={tokens.text.primary} />
          </IconButton>
          {game.iconUrl ? (
            <Image
              source={{ uri: game.iconUrl }}
              style={styles.icon}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[styles.icon, styles.iconFallback]}>
              <PixelIcon name="gamepad" size={16} />
            </View>
          )}
          <Text variant="heading" numberOfLines={1} style={styles.title}>
            {game.title}
          </Text>
          {streak >= STREAK_MIN_DAYS ? (
            <View style={styles.streak} testID="game-board-streak">
              <PixelIcon name="zap" size={16} color={tokens.neon.chartreuse} />
              <Text style={styles.streakText}>{streak}</Text>
            </View>
          ) : null}
          <IconButton
            accessibilityLabel={`Open ${game.title} in your browser`}
            onPress={() => openExternalUrl(game.url)}
            testID="game-board-title-link"
          >
            <PixelIcon name="external-link" color={tokens.neon.pink} />
          </IconButton>
        </View>

        <DateBar
          date={date}
          today={today}
          onChange={onDate}
          onOpenPicker={() => setPickerOpen(true)}
          testIDPrefix="board-date"
        />

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <View style={styles.stripWrap}>
            <DayStrip
              cells={stripCells}
              selected={date}
              today={today}
              onSelect={onDate}
              loading={stripLoading}
              testIDPrefix="game-board-day"
            />
            <Text style={styles.turnout} testID="game-board-turnout">
              {calendarLabel(date)} · {turnout}
            </Text>
          </View>

          {boardQuery.isPending ? (
            <View style={styles.center}>
              <ActivityIndicator color={tokens.neon.pink} />
            </View>
          ) : boardQuery.isError ? (
            <View style={styles.center}>
              <Text tone="danger">Couldn't load scores.</Text>
              <Button
                label="Try again"
                variant="secondary"
                onPress={() => boardQuery.refetch()}
                loading={boardQuery.isFetching}
                testID="game-board-scores-retry"
              />
            </View>
          ) : (
            <View style={styles.board}>
              {showComposer ? (
                <ScoreComposer
                  mode={composerMode}
                  isToday={isToday}
                  dateLabel={calendarLabel(date)}
                  draft={draft}
                  baseline={myScore ?? ""}
                  onChangeDraft={setDraft}
                  gameId={gameId}
                  periodKey={date}
                  today={today}
                  onSubmit={onSubmit}
                  onPostToOther={(other) => {
                    const trimmed = draft.trim();
                    if (trimmed.length === 0) return;
                    upsertMutation.mutate({
                      scoreRaw: trimmed,
                      periodKey: date,
                      isEdit: false,
                      postTo: other,
                      extras: {
                        body: { wrongGame: { gameId, choice: "there" } },
                        scoreDirection: null,
                      },
                    });
                  }}
                  onCancel={() => {
                    setDraft("");
                    setEditingScore(false);
                  }}
                  pending={upsertMutation.isPending}
                  userName={user?.displayName ?? null}
                  userAvatarUrl={user?.avatarUrl ?? null}
                  {...(composerMode === "new" && isToday
                    ? { onPlay: () => openExternalUrl(game.url) }
                    : {})}
                />
              ) : null}

              {entries.map((entry) => {
                const isMe = entry.userId === user?.id;
                if (isMe && showComposer) return null;
                return (
                  <BoardRow
                    key={entry.userId}
                    entry={entry}
                    game={game}
                    teachAvailable={teachAvailable}
                    isMe={isMe}
                    onPressPlayer={openProfile}
                    {...(isMe
                      ? {
                          onEdit: () => {
                            setDraft(entry.scoreRaw ?? "");
                            setEditingScore(true);
                          },
                          onClear: async () => {
                            const ok = await confirm({
                              title: isToday
                                ? "Clear your score for today?"
                                : `Clear your score for ${calendarLabel(date)}?`,
                              message: "Your result is removed. Scores on other days are kept.",
                              confirmLabel: "Clear",
                              destructive: true,
                            });
                            if (ok) clearMutation.mutate(date);
                          },
                          ...(teachAvailable && myScore
                            ? {
                                onFix: () =>
                                  setFixTarget({
                                    gameId,
                                    gameTitle: game.title,
                                    periodKey: date,
                                    scoreRaw: myScore,
                                  }),
                              }
                            : {}),
                        }
                      : {
                          onReact: (userId: string, emoji: string, cur: boolean) =>
                            reactionCtl.react(gameId, userId, emoji, cur),
                          onOpenReactionPicker: (userId: string) =>
                            reactionCtl.openPicker(gameId, userId, entry.displayName ?? null),
                        })}
                  />
                );
              })}

              {played === 0 && !showComposer ? null : played === 0 ? (
                <Text variant="caption" tone="secondary" style={styles.emptyHint}>
                  {isToday
                    ? "No friend has posted yet. Yours will be the first on the board."
                    : "Nobody posted a result that day."}
                </Text>
              ) : null}
            </View>
          )}
        </ScrollView>

        <DayPickerSheet
          visible={pickerOpen}
          selected={date}
          today={today}
          onSelect={onDate}
          onClose={() => setPickerOpen(false)}
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
              periodKey: date,
            });
          }}
        />
        <ReportSheet target={reportFlow.target} token={token} onClose={reportFlow.close} />
        <FixScoreSheet target={fixTarget} today={today} onClose={() => setFixTarget(null)} />
      </Screen>
    </KeyboardAvoidingView>
  );
}

interface ScoreComposerProps {
  mode: "new" | "edit";
  isToday: boolean;
  dateLabel: string;
  draft: string;
  baseline: string;
  onChangeDraft: (v: string) => void;
  gameId: string;
  periodKey: string;
  today: string;
  onSubmit: (extras?: ScorePostExtras) => void;
  onPostToOther: (other: { id: string; title: string }) => void;
  onCancel: () => void;
  pending: boolean;
  userName: string | null;
  userAvatarUrl?: string | null;
  onPlay?: () => void;
}

// Your slot in compose mode — first result ("new") or fixing a paste in place
// ("edit"). Enter posts on web; Shift+Enter still inserts a newline.
function ScoreComposer({
  mode,
  isToday,
  dateLabel,
  draft,
  baseline,
  onChangeDraft,
  gameId,
  periodKey,
  today,
  onSubmit,
  onPostToOther,
  onCancel,
  pending,
  userName,
  userAvatarUrl,
  onPlay,
}: ScoreComposerProps) {
  const isEdit = mode === "edit";
  const trimmed = draft.trim();
  const empty = trimmed.length === 0;
  const unchanged = isEdit && trimmed === baseline.trim();
  const check = useScoreCheck({ gameId, text: draft, periodKey, entry: "paste", today });
  const blocked = check.available && !check.canPost;
  const canSubmit = !empty && !unchanged && !pending && !blocked;
  const submit = () => onSubmit(check.available ? check.extras() : undefined);
  const [focused, setFocused] = useState(false);
  const webProps =
    Platform.OS === "web"
      ? {
          blurOnSubmit: true,
          onSubmitEditing: () => {
            if (canSubmit) submit();
          },
        }
      : {};
  return (
    <View style={styles.composer} testID="game-board-paste-slot">
      <View style={styles.composerHead}>
        <Avatar name={userName} imageUrl={userAvatarUrl} size="md" />
        <View style={styles.composerText}>
          <Text variant="label" style={styles.composerName}>
            {userName?.trim() || "You"}
            <Text style={styles.you}> · YOU</Text>
          </Text>
          <Text variant="caption" tone="secondary">
            {isEdit
              ? isToday
                ? "Edit your result"
                : `Edit your result for ${dateLabel}`
              : isToday
                ? "Paste your result to get on the board"
                : `Paste your result for ${dateLabel}`}
          </Text>
        </View>
      </View>
      <TextInput
        testID="game-board-paste-input"
        value={draft}
        onChangeText={onChangeDraft}
        placeholder="Paste your result here"
        placeholderTextColor={tokens.text.secondary}
        multiline
        autoFocus={isEdit}
        maxLength={2000}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.pasteInput, focused && styles.pasteInputFocused]}
        {...webProps}
      />
      <ScoreCheckPanel
        check={check}
        testID="game-board-check"
        onPostToOther={(id, title) => onPostToOther({ id, title })}
      />
      <View style={styles.pasteActions}>
        {onPlay ? (
          <Button label="Play" variant="secondary" onPress={onPlay} testID="game-board-play" />
        ) : null}
        {isEdit ? (
          <Button
            label="Cancel"
            variant="ghost"
            onPress={onCancel}
            disabled={pending}
            testID="game-board-edit-cancel"
          />
        ) : null}
        <Button
          label={isEdit ? "Save" : "Post score"}
          onPress={submit}
          disabled={!canSubmit}
          loading={pending}
          testID="game-board-paste-submit"
          style={styles.pasteSubmit}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.xl,
  },
  headerNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingLeft: tokens.space.xs,
    paddingRight: tokens.space.xs,
    paddingVertical: tokens.space.xs,
  },
  icon: { width: 28, height: 28, backgroundColor: tokens.bg.elevated },
  iconFallback: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  title: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18 },
  streak: { flexDirection: "row", alignItems: "center", gap: 2 },
  streakText: {
    fontFamily: tokens.font.pixel,
    fontSize: 10,
    lineHeight: 16,
    color: tokens.neon.chartreuse,
  },
  body: { paddingBottom: tokens.space.xxl * 2 },
  stripWrap: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.md,
    gap: tokens.space.sm,
  },
  turnout: {
    fontFamily: tokens.font.pixel,
    fontSize: 8,
    lineHeight: 14,
    letterSpacing: 1,
    color: tokens.text.secondary,
  },
  board: { paddingHorizontal: tokens.space.lg, paddingTop: tokens.space.md, gap: tokens.space.sm },
  emptyHint: { paddingTop: tokens.space.sm },
  composer: {
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
    backgroundColor: tokens.bg.surface,
    padding: tokens.space.md,
    gap: tokens.space.sm,
  },
  composerHead: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  composerText: { flex: 1, minWidth: 0 },
  composerName: { color: tokens.text.primary, fontSize: tokens.font.size.md },
  you: { fontFamily: tokens.font.pixel, fontSize: 8, color: tokens.neon.pinkTint },
  pasteInput: {
    minHeight: 104,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    color: tokens.text.primary,
    fontSize: tokens.font.size.sm,
    backgroundColor: tokens.bg.canvas,
    textAlignVertical: "top",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: tokens.font.size.sm + 6,
  },
  pasteInputFocused: { borderColor: tokens.neon.pink },
  pasteActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  pasteSubmit: { flexGrow: 1 },
});
